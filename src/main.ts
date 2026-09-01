/**
 * Feishu Diary 插件入口。
 *
 * 管线：WSClient 事件 → 去重 → p2p 过滤 → 认主 → 意图识别 → 写库/回执。
 * 回执约定：表情两态（OnIt 执行中 → DONE 完成）；命令与异常才发文字。
 */
import { Notice, Plugin } from "obsidian";
import { FeishuChannel } from "./feishu/channel.ts";
import type { ChannelStatus, IncomingMessage } from "./feishu/channel.ts";
import { EMOJI_DONE, EMOJI_DOING, FeishuClient } from "./feishu/client.ts";
import { ObsidianVaultAdapter } from "./feishu/vault-adapter.ts";
import { classify } from "./core/intents.ts";
import { DiaryWriter } from "./core/writer.ts";
import { MessageDeduper } from "./util/dedupe.ts";
import { DEFAULT_SETTINGS, SECRET_ID } from "./settings.ts";
import type { FeishuDiarySettings } from "./settings.ts";
import { FeishuDiarySettingTab } from "./ui/settings-tab.ts";

const HELP_TEXT = [
  "我是你的日记机器人，直接发消息就会记进 Obsidian：",
  "· 发文字/图片/语音 = 记一条",
  "· 「撤回」删掉最后一条",
  "· 「记：xxx」强制记一段（防止被当成命令）",
  "· 「结束」「晚安」给今天收尾",
  "· 「在吗」看我醒着没",
  "· 「叫我XX」给我一个称呼",
].join("\n");

export default class FeishuDiaryPlugin extends Plugin {
  override settings: FeishuDiarySettings = DEFAULT_SETTINGS;
  private channel: FeishuChannel | null = null;
  private client: FeishuClient | null = null;
  private writer: DiaryWriter | null = null;
  private readonly deduper = new MessageDeduper();
  private statusBarItem: HTMLElement | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.writer = new DiaryWriter(new ObsidianVaultAdapter(this.app.vault), this.settings.rootDir);
    this.addSettingTab(new FeishuDiarySettingTab(this.app, this));
    this.statusBarItem = this.addStatusBarItem();
    this.register(() => void this.stopChannel());
    await this.startChannel();
  }

  override onunload(): void {
    this.channel = null;
    this.client = null;
  }

  private async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<FeishuDiarySettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...stored };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  get appSecret(): string {
    return this.app.secretStorage.getSecret(SECRET_ID) ?? "";
  }

  async storeAppSecret(secret: string): Promise<void> {
    this.app.secretStorage.setSecret(SECRET_ID, secret);
  }

  /** 凭据变更 / 首次配置后调用。 */
  async restartChannel(): Promise<void> {
    await this.stopChannel();
    await this.startChannel();
  }

  private async startChannel(): Promise<void> {
    const { appId } = this.settings;
    const appSecret = this.appSecret;
    if (!appId || !appSecret) {
      this.setStatus("未配置");
      return;
    }
    this.client = new FeishuClient({ appId, appSecret });
    this.channel = new FeishuChannel(
      { appId, appSecret },
      (msg) => this.handleMessage(msg),
      (s, d) => this.setStatus(s, d),
    );
    try {
      await this.channel.start();
    } catch (err) {
      console.error("[feishu-diary] 长连接启动失败:", err);
      this.setStatus("连接失败");
      new Notice(`Feishu Diary 连接失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async stopChannel(): Promise<void> {
    if (this.channel) await this.channel.stop();
    this.channel = null;
    this.client = null;
  }

  private setStatus(status: ChannelStatus | string, detail?: string): void {
    if (!this.statusBarItem) return;
    this.statusBarItem.setText(`🪶 ${status}`);
    if (detail) console.warn(`[feishu-diary] 通道状态 ${status}: ${detail}`);
  }

  // ---------- 消息处理 ----------

  private async handleMessage(msg: IncomingMessage): Promise<void> {
    if (!this.deduper.checkAndAdd(msg.messageId)) return;
    if (msg.chatType !== "p2p") return;

    if (!this.settings.ownerOpenId) {
      this.settings.ownerOpenId = msg.senderOpenId;
      await this.saveSettings();
      await this.reply(
        msg.senderOpenId,
        "已认主：从现在起，你发给我的每句话都会记进 Obsidian。发送「帮助」看用法。",
      );
    }

    if (msg.senderOpenId !== this.settings.ownerOpenId) return;

    await this.dispatchIntent(msg);
  }

  private async dispatchIntent(msg: IncomingMessage): Promise<void> {
    if (msg.messageType !== "text") {
      await this.reply(
        msg.senderOpenId,
        "这类消息我还没学会（下个版本支持图片/文件/语音）。先发文字吧。",
      );
      return;
    }

    const intent = classify(msg.text);
    switch (intent.kind) {
      case "ignore":
        return;
      case "note":
      case "forced-note":
        await this.withReceipt(msg, async () => {
          await this.writer?.append(msg.createTimeMs, intent.text);
        });
        return;
      case "recall": {
        const removed = await this.writer?.recall(Date.now());
        await this.reply(
          msg.senderOpenId,
          removed ? `已撤回：${removed.slice(0, 50)}` : "没有可以撤回的内容",
        );
        return;
      }
      case "seal": {
        const footnote = await this.writer?.seal(Date.now());
        await this.reply(
          msg.senderOpenId,
          footnote ? `今天封存于 ${footnote}，晚安。` : "今天已经封存过了。",
        );
        return;
      }
      case "ping":
        await this.reply(
          msg.senderOpenId,
          `在${this.settings.nickname ? `，${this.settings.nickname}` : ""}。`,
        );
        return;
      case "help":
        await this.reply(msg.senderOpenId, HELP_TEXT);
        return;
      case "callme":
        this.settings.nickname = intent.name;
        await this.saveSettings();
        await this.reply(msg.senderOpenId, `好的，以后叫你「${intent.name}」。`);
        return;
    }
  }

  /** 表情两态回执：doing → 工作 → done。表情失败不阻塞主流程。 */
  private async withReceipt(msg: IncomingMessage, work: () => Promise<void>): Promise<void> {
    let doingReactionId: string | null = null;
    try {
      doingReactionId = (await this.client?.addReaction(msg.messageId, EMOJI_DOING)) ?? null;
    } catch (err) {
      console.warn("[feishu-diary] 添加执行中表情失败:", err);
    }
    try {
      await work();
    } catch (err) {
      console.error("[feishu-diary] 写入失败:", err);
      await this.reply(
        msg.senderOpenId,
        `没存上：${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (doingReactionId) {
      try {
        await this.client?.removeReaction(msg.messageId, doingReactionId);
      } catch (err) {
        console.warn("[feishu-diary] 移除执行中表情失败:", err);
      }
    }
    try {
      await this.client?.addReaction(msg.messageId, EMOJI_DONE);
    } catch (err) {
      console.warn("[feishu-diary] 添加完成表情失败:", err);
    }
  }

  private async reply(openId: string, text: string): Promise<void> {
    try {
      await this.client?.sendText(openId, text);
    } catch (err) {
      console.error("[feishu-diary] 回复失败:", err);
    }
  }
}
