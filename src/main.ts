/**
 * Feishu Diary 插件入口。
 *
 * 管线：WSClient 事件 → 去重 → p2p 过滤 → 认主 → 意图识别 → 写库/回执。
 * 回执约定：表情两态（OnIt 执行中 → DONE 完成）；命令与异常才发文字。
 */
import { Notice, Plugin } from "obsidian";
import { FeishuChannel } from "./feishu/channel.ts";
import type { IncomingMessage } from "./feishu/channel.ts";
import { EMOJI_DONE, EMOJI_DOING, FeishuClient } from "./feishu/client.ts";
import { ObsidianVaultAdapter } from "./feishu/vault-adapter.ts";
import { createObsidianHttpInstance } from "./feishu/http.ts";
import { classify } from "./core/intents.ts";
import { DiaryWriter, diaryPath } from "./core/writer.ts";
import { attachmentBlock, attachmentPath } from "./core/attachments.ts";
import type { MediaKind } from "./core/attachments.ts";
import { decideReminder } from "./core/reminder.ts";
import { extFromContentType } from "./util/filename.ts";
import { MessageDeduper } from "./util/dedupe.ts";
import { logicalDate, timeParts } from "./util/time.ts";
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

const MEDIA_KINDS = ["image", "file", "audio", "media"];

export default class FeishuDiaryPlugin extends Plugin {
  override settings: FeishuDiarySettings = DEFAULT_SETTINGS;
  private channel: FeishuChannel | null = null;
  private client: FeishuClient | null = null;
  private writer: DiaryWriter | null = null;
  private vaultAdapter: ObsidianVaultAdapter | null = null;
  private readonly deduper = new MessageDeduper();
  private statusBarItem: HTMLElement | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.vaultAdapter = new ObsidianVaultAdapter(this.app.vault, this.app.fileManager);
    this.writer = new DiaryWriter(this.vaultAdapter, this.settings.rootDir);
    this.addSettingTab(new FeishuDiarySettingTab(this.app, this));
    this.statusBarItem = this.addStatusBarItem();
    this.register(() => void this.stopChannel());
    await this.startChannel();
    // 开机补发：错过到点的提醒在启动时补一次；此后每分钟 tick。
    void this.tickReminder();
    this.registerInterval(window.setInterval(() => void this.tickReminder(), 60_000));
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

  /** 扫码一键创建应用成功后：写入凭据、扫码者提前认主、重连。 */
  async applyScanResult(appId: string, appSecret: string, openId?: string): Promise<void> {
    this.settings.appId = appId;
    if (!this.settings.ownerOpenId && openId) this.settings.ownerOpenId = openId;
    await this.saveSettings();
    await this.storeAppSecret(appSecret);
    await this.restartChannel();
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
      createObsidianHttpInstance(),
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

  private setStatus(status: string, detail?: string): void {
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
      if (MEDIA_KINDS.includes(msg.messageType)) {
        await this.withReceipt(msg, () => this.handleMedia(msg));
      } else {
        await this.reply(
          msg.senderOpenId,
          "这类消息我还没学会。支持：文字、图片、文件、语音、视频。",
        );
      }
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

  /**
   * 媒体消息入库：下载资源 → 存 attachments/ → 笔记写块。
   * 失败（超 100MB、资源过期等）由 withReceipt 捕获并文字回执。
   */
  private async handleMedia(msg: IncomingMessage): Promise<void> {
    const { client, vaultAdapter, writer } = this;
    if (!client || !vaultAdapter || !writer) throw new Error("插件未完成初始化，请重载");

    const kind = msg.messageType as MediaKind;
    const content = JSON.parse(msg.content || "{}") as Record<string, unknown>;

    // image 消息只有 image_key；audio/file/media 用 file_key（media 的封面图略过）。
    const fileKey =
      kind === "image" ? String(content.image_key ?? "") : String(content.file_key ?? "");
    if (!fileKey) throw new Error(`消息缺 file_key（${kind}）`);

    const displayName =
      kind === "image" ? "image" : kind === "audio" ? "voice" : String(content.file_name ?? "file");

    const { buffer, contentType } = await client.downloadResource(
      msg.messageId,
      fileKey,
      kind === "image" ? "image" : "file",
    );
    // 语音恒为 Ogg/Opus；file/media 文件名自带扩展名；图片从 Content-Type 推断。
    const ext = kind === "audio" ? ".opus" : extFromContentType(contentType);
    const path = attachmentPath(this.settings.rootDir, msg.createTimeMs, displayName, ext);
    const savedName = await vaultAdapter.writeBinary(path, buffer);
    await writer.append(msg.createTimeMs, attachmentBlock(kind, savedName));
  }

  /**
   * 每日提醒 tick：到点（HH:mm ≥ reminderTime）且当天没记才提；
   * 状态每次 tick 持久化；发送按返回码记录，不重试（零预判）。
   */
  private async tickReminder(): Promise<void> {
    if (!this.settings.reminderEnabled || !this.settings.ownerOpenId || !this.client) return;
    const now = Date.now();
    if (timeParts(now).time < this.settings.reminderTime) return;

    const today = logicalDate(now);
    const hasTodayEntry =
      this.app.vault.getAbstractFileByPath(diaryPath(this.settings.rootDir, today)) !== null;

    const decision = decideReminder(this.settings.reminderState, { today, hasTodayEntry });
    if (decision.state !== this.settings.reminderState) {
      this.settings.reminderState = decision.state;
      await this.saveSettings();
    }
    if (!decision.remind) return;

    const nickname = this.settings.nickname ? `，${this.settings.nickname}` : "";
    try {
      await this.client.sendText(
        this.settings.ownerOpenId,
        `今天还没记日记，睡前跟我说两句吧${nickname}。`,
      );
    } catch (err) {
      console.warn("[feishu-diary] 提醒发送失败（今日不再重试）:", err);
    }
  }

  /** 记了日记即视为响应提醒：清零沉默计数（否则连提 3 天后进入永久沉默）。 */
  private resetReminderStreak(): void {
    if (this.settings.reminderState.missStreak !== 0) {
      this.settings.reminderState = { ...this.settings.reminderState, missStreak: 0 };
      void this.saveSettings();
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
      this.resetReminderStreak();
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
