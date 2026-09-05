/**
 * FeishuDiaryService——环境无关的编排核心（Obsidian 插件与 Node CLI 共用）。
 *
 * 管线：WSClient 事件 → 去重 → p2p 过滤 → 认主 → 意图识别 → 写库/回执。
 * 回执约定：表情两态（OnIt 执行中 → DONE 完成）；命令与异常才发文字。
 *
 * 宿主负责装配注入：HTTP 出站实现、SDK HttpInstance（WSClient 建连）、存储适配、
 * 设置持久化（persist）、用户反馈（notify/onStatus）。本模块不 import obsidian——
 * CLI 产物不得拖入 Obsidian 运行时。
 */
import type { HttpInstance } from "@larksuiteoapi/node-sdk";
import { FeishuChannel } from "./feishu/channel.ts";
import type { IncomingMessage } from "./feishu/channel.ts";
import { EMOJI_DONE, EMOJI_DOING, FeishuClient } from "./feishu/client.ts";
import type { FeishuCreds } from "./feishu/client.ts";
import type { HttpApi } from "./feishu/http.ts";
import { classify } from "./core/intents.ts";
import { DiaryWriter, diaryPath } from "./core/writer.ts";
import type { StorageAdapter } from "./core/writer.ts";
import { attachmentBlock, attachmentPath } from "./core/attachments.ts";
import type { MediaKind } from "./core/attachments.ts";
import { decideReminder } from "./core/reminder.ts";
import { extFromContentType } from "./util/filename.ts";
import { MessageDeduper } from "./util/dedupe.ts";
import { logicalDate, timeParts } from "./util/time.ts";
import type { FeishuDiarySettings } from "./settings.ts";

const HELP_TEXT = [
  "我是你的日记机器人，直接发消息就会记进今天的日记：",
  "· 发文字/图片/语音 = 记一条",
  "· 「撤回」删掉最后一条",
  "· 「记：xxx」强制记一段（防止被当成命令）",
  "· 「结束」「晚安」给今天收尾",
  "· 「在吗」看我醒着没",
  "· 「叫我XX」给我一个称呼",
].join("\n");

const MEDIA_KINDS = ["image", "file", "audio", "media"];

// 定时器宿主：Obsidian 下取 window（popout 兼容），Node CLI 下取 globalThis。
const timerApi: Pick<typeof globalThis, "setInterval" | "clearInterval"> =
  typeof window !== "undefined" ? window : globalThis;

/** service 依赖的最小通道面（FeishuChannel 天然满足；测试可注入替身）。 */
export interface ChannelLike {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** service 依赖的最小客户端面（FeishuClient 天然满足；测试可注入替身）。 */
export interface ClientLike {
  sendText(openId: string, text: string): Promise<void>;
  addReaction(messageId: string, emojiType: string): Promise<string>;
  removeReaction(messageId: string, reactionId: string): Promise<void>;
  downloadResource(
    messageId: string,
    fileKey: string,
    type: "image" | "file",
  ): Promise<{ buffer: ArrayBuffer; contentType: string | null }>;
}

export interface ServiceOptions {
  /** 飞书应用凭据；restart(creds) 可更新（扫码建应用成功后）。 */
  creds: FeishuCreds;
  /** HTTP 出站实现：Obsidian requestUrl（feishu/http.ts）/ Node fetch（node/http.ts）。 */
  http: HttpApi;
  /** 注入 WSClient 的 SDK HTTP 实例（Electron 下必须；Node 下注入以统一出站行为）。 */
  httpInstance: HttpInstance;
  /** 存储适配：Obsidian Vault / Node fs。 */
  storage: StorageAdapter;
  /** 运行设置（宿主持有引用；变更经 persist 回写）。 */
  settings: FeishuDiarySettings;
  /** 设置/状态变更时持久化（Obsidian saveData / CLI 状态文件）。 */
  persist: (settings: FeishuDiarySettings) => Promise<void> | void;
  /** 需要用户注意的通知，如连接失败（Obsidian Notice / CLI stderr）。 */
  notify?: (message: string) => void;
  /** 通道状态上报（状态栏 / 控制台）。 */
  onStatus?: (status: string, detail?: string) => void;
  /** 测试注入缝：替换通道构造（默认真实 FeishuChannel）。 */
  channelFactory?: (
    creds: FeishuCreds,
    httpInstance: HttpInstance,
    onMessage: (msg: IncomingMessage) => Promise<void> | void,
    onStatus: (status: string, detail?: string) => void,
  ) => ChannelLike;
  /** 测试注入缝：替换客户端构造（默认真实 FeishuClient）。 */
  clientFactory?: (creds: FeishuCreds, http: HttpApi) => ClientLike;
}

export class FeishuDiaryService {
  private channel: ChannelLike | null = null;
  private client: ClientLike | null = null;
  private writer: DiaryWriter | null = null;
  private readonly deduper = new MessageDeduper();
  /** 消息处理串行队列（尾链）：handler 3 秒内返回 + process 读-改-写不并发。 */
  private queue: Promise<void> = Promise.resolve();
  private reminderTimer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: ServiceOptions;

  constructor(opts: ServiceOptions) {
    this.opts = opts;
  }

  get settings(): FeishuDiarySettings {
    return this.opts.settings;
  }

  async start(): Promise<void> {
    const { creds, http, httpInstance, storage } = this.opts;
    if (!creds.appId || !creds.appSecret) {
      this.reportStatus("未配置");
      return;
    }
    this.client = this.opts.clientFactory
      ? this.opts.clientFactory(creds, http)
      : new FeishuClient(creds, http);
    this.writer = new DiaryWriter(storage, this.opts.settings.rootDir);
    this.channel = this.opts.channelFactory
      ? this.opts.channelFactory(
          creds,
          httpInstance,
          (msg) => this.handleMessage(msg),
          (s, d) => this.reportStatus(s, d),
        )
      : new FeishuChannel(
          creds,
          httpInstance,
          (msg) => this.handleMessage(msg),
          (s, d) => this.reportStatus(s, d),
        );
    try {
      await this.channel.start();
    } catch (err) {
      console.error("[feishu-diary] 长连接启动失败:", err);
      this.reportStatus("连接失败");
      this.opts.notify?.(
        `Feishu Diary 连接失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // 开机补发：错过到点的提醒在启动时补一次；此后每分钟 tick。
    // 连接失败不阻断提醒——REST 发送独立于 WS，tick 内自行容错。
    void this.tickReminder();
    this.reminderTimer = timerApi.setInterval(() => void this.tickReminder(), 60_000);
  }

  async stop(): Promise<void> {
    if (this.reminderTimer !== null) {
      timerApi.clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
    if (this.channel) await this.channel.stop();
    this.channel = null;
    this.client = null;
  }

  /** 凭据变更 / 首次配置后调用；传入 creds 时同时更新（如扫码建应用成功后）。 */
  async restart(creds?: FeishuCreds): Promise<void> {
    if (creds) this.opts.creds = creds;
    await this.stop();
    await this.start();
  }

  private reportStatus(status: string, detail?: string): void {
    if (detail) console.warn(`[feishu-diary] 通道状态 ${status}: ${detail}`);
    this.opts.onStatus?.(status, detail);
  }

  private async persistSettings(): Promise<void> {
    await this.opts.persist(this.opts.settings);
  }

  // ---------- 消息处理 ----------

  private async handleMessage(msg: IncomingMessage): Promise<void> {
    if (!this.deduper.checkAndAdd(msg.messageId)) return;
    if (msg.chatType !== "p2p") return;

    if (!this.opts.settings.ownerOpenId) {
      this.opts.settings.ownerOpenId = msg.senderOpenId;
      await this.persistSettings();
      void this.reply(
        msg.senderOpenId,
        "已认主：从现在起，你发给我的每句话都会记进日记。发送「帮助」看用法。",
      );
    }

    if (msg.senderOpenId !== this.opts.settings.ownerOpenId) return;

    // 意图分发（含附件下载等重活）异步执行：事件 handler 须 3 秒内返回，
    // 否则触发服务端超时重推（去重能兜住，但白白浪费）。
    // 链式队列保串行——并发 process（读-改-写）会竞态丢更新。
    const task = this.queue.then(() => this.dispatchIntent(msg));
    this.queue = task.catch((err) => {
      console.error("[feishu-diary] 消息处理失败:", err);
    });
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
        // 用消息真实时间定位逻辑日（与 append 同基准），凌晨跨 4 点边界由 writer 回退兜底
        const removed = await this.writer?.recall(msg.createTimeMs);
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
          `在${this.opts.settings.nickname ? `，${this.opts.settings.nickname}` : ""}。`,
        );
        return;
      case "help":
        await this.reply(msg.senderOpenId, HELP_TEXT);
        return;
      case "callme":
        this.opts.settings.nickname = intent.name;
        await this.persistSettings();
        await this.reply(msg.senderOpenId, `好的，以后叫你「${intent.name}」。`);
        return;
    }
  }

  /**
   * 媒体消息入库：下载资源 → 存 attachments/ → 笔记写块。
   * 失败（超 100MB、资源过期等）由 withReceipt 捕获并文字回执。
   */
  private async handleMedia(msg: IncomingMessage): Promise<void> {
    const { client, writer } = this;
    const storage = this.opts.storage;
    if (!client || !writer) throw new Error("服务未完成初始化，请重启");

    const kind = msg.messageType as MediaKind;
    const content = parseContentJson(msg.content);

    // image 消息只有 image_key；audio/file/media 用 file_key（media 的封面图略过）。
    const rawKey = kind === "image" ? content.image_key : content.file_key;
    const fileKey = typeof rawKey === "string" ? rawKey : "";
    if (!fileKey) throw new Error(`消息缺 file_key（${kind}）`);

    const rawName = content.file_name;
    const displayName =
      kind === "image"
        ? "image"
        : kind === "audio"
          ? "voice"
          : typeof rawName === "string" && rawName
            ? rawName
            : "file";

    const { buffer, contentType } = await client.downloadResource(
      msg.messageId,
      fileKey,
      kind === "image" ? "image" : "file",
    );
    // 语音恒为 Ogg/Opus；file/media 文件名自带扩展名；图片从 Content-Type 推断。
    const ext = kind === "audio" ? ".opus" : extFromContentType(contentType);
    const path = attachmentPath(this.opts.settings.rootDir, msg.createTimeMs, displayName, ext);
    const savedName = await storage.writeBinary(path, buffer);
    await writer.append(msg.createTimeMs, attachmentBlock(kind, savedName));
  }

  /**
   * 每日提醒 tick：到点（HH:mm ≥ reminderTime）且当天没记才提；
   * 状态每次 tick 持久化；发送按返回码记录，不重试（零预判）。
   */
  private async tickReminder(): Promise<void> {
    const settings = this.opts.settings;
    if (!settings.reminderEnabled || !settings.ownerOpenId || !this.client) return;
    const now = Date.now();
    if (timeParts(now).time < settings.reminderTime) return;

    const today = logicalDate(now);
    const hasTodayEntry = await this.opts.storage.exists(diaryPath(settings.rootDir, today));

    const decision = decideReminder(settings.reminderState, { today, hasTodayEntry });
    if (decision.state !== settings.reminderState) {
      settings.reminderState = decision.state;
      await this.persistSettings();
    }
    if (!decision.remind) return;

    const nickname = settings.nickname ? `，${settings.nickname}` : "";
    try {
      await this.client.sendText(
        settings.ownerOpenId,
        `今天还没记日记，睡前跟我说两句吧${nickname}。`,
      );
    } catch (err) {
      console.warn("[feishu-diary] 提醒发送失败（今日不再重试）:", err);
    }
  }

  /** 记了日记即视为响应提醒：清零沉默计数（否则连提 3 天后进入永久沉默）。 */
  private resetReminderStreak(): void {
    if (this.opts.settings.reminderState.missStreak !== 0) {
      this.opts.settings.reminderState = {
        ...this.opts.settings.reminderState,
        missStreak: 0,
      };
      void this.persistSettings();
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
      // 失败也要摘掉执行中表情（两态回执约定），失败状态由文字回执表达
      await this.removeDoingReaction(msg.messageId, doingReactionId);
      await this.reply(
        msg.senderOpenId,
        `没存上：${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    await this.removeDoingReaction(msg.messageId, doingReactionId);
    try {
      await this.client?.addReaction(msg.messageId, EMOJI_DONE);
    } catch (err) {
      console.warn("[feishu-diary] 添加完成表情失败:", err);
    }
  }

  /** 摘掉执行中表情；失败不阻塞主流程。 */
  private async removeDoingReaction(messageId: string, reactionId: string | null): Promise<void> {
    if (!reactionId) return;
    try {
      await this.client?.removeReaction(messageId, reactionId);
    } catch (err) {
      console.warn("[feishu-diary] 移除执行中表情失败:", err);
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

/** 媒体消息 content 解析；畸形 JSON 转为可读错误（withReceipt 会转成文字回执）。 */
function parseContentJson(raw: string): Record<string, unknown> {
  const empty = raw.trim().length === 0;
  if (empty) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error("消息内容不是合法 JSON，无法提取附件");
  }
}
