/**
 * FeishuChannel——长连接通道：建连、事件规范化、状态上报、优雅启停。
 *
 * 约束（来自飞书长连接官方说明）：
 *  - 事件 handler 须 3 秒内处理完成且不抛异常，否则触发超时重推
 *  - 事件可能重复推送，必须按 message_id 去重（由上层 MessageDeduper 承担）
 *
 * 本类只做通道与规范化，不做业务；handler 的异常在这里兜底吞掉并记录。
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import type { HttpInstance } from "@larksuiteoapi/node-sdk";
import type { FeishuCreds } from "./client.ts";

export interface IncomingMessage {
  messageId: string;
  chatId: string;
  chatType: string;
  messageType: string;
  /** 消息真实发生时间（毫秒，来自飞书事件）。 */
  createTimeMs: number;
  senderOpenId: string;
  /** 原始 content JSON 字符串。 */
  content: string;
  /** text 类型消息解析出的纯文本；其余类型为空串。 */
  text: string;
}

export type ChannelStatus = "connecting" | "online" | "reconnecting" | "offline" | "failed";

/**
 * SDK 长连接 handler 收到的事件（im.message.receive_v1，schema 2.0）。
 * 注意：SDK 的 EventDispatcher.parse 已把 header/event 展平到顶层，
 * handler 拿到的是 { schema, event_id, event_type, ..., sender, message }，
 * 不是 webhook 原始的 { header, event: { sender, message } } 包装结构。
 */
interface RawReceiveEvent {
  sender?: { sender_id?: { open_id?: string } };
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    create_time?: string;
    content?: string;
  };
}

/** SDK 原始事件 → IncomingMessage；结构性不完整时返回 null。 */
export function normalizeIncoming(raw: unknown): IncomingMessage | null {
  const data = raw as RawReceiveEvent | null;
  const message = data?.message;
  const openId = data?.sender?.sender_id?.open_id;
  if (!message?.message_id || !message.chat_id || !openId) return null;

  let text = "";
  if (message.message_type === "text") {
    try {
      text = String((JSON.parse(message.content ?? "{}") as { text?: string }).text ?? "");
    } catch {
      text = "";
    }
  }

  return {
    messageId: message.message_id,
    chatId: message.chat_id,
    chatType: message.chat_type ?? "",
    messageType: message.message_type ?? "",
    createTimeMs: Number(message.create_time ?? Date.now()),
    senderOpenId: openId,
    content: message.content ?? "",
    text,
  };
}

export class FeishuChannel {
  private wsClient: Lark.WSClient | null = null;
  private readonly creds: FeishuCreds;
  private readonly httpInstance: HttpInstance;
  private readonly onMessage: (msg: IncomingMessage) => Promise<void> | void;
  private readonly onStatus: (status: ChannelStatus, detail?: string) => void;

  constructor(
    creds: FeishuCreds,
    httpInstance: HttpInstance,
    onMessage: (msg: IncomingMessage) => Promise<void> | void,
    onStatus: (status: ChannelStatus, detail?: string) => void,
  ) {
    this.creds = creds;
    this.httpInstance = httpInstance;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
  }

  async start(): Promise<void> {
    this.onStatus("connecting");
    const wsClient = new Lark.WSClient({
      appId: this.creds.appId,
      appSecret: this.creds.appSecret,
      loggerLevel: Lark.LoggerLevel.warn,
      // SDK 内置 axios/XHR 在 Electron renderer 被 CORS 拦（建连拉配置即失败），
      // httpInstance 由装配层注入（Obsidian 下为 requestUrl 实现）。
      httpInstance: this.httpInstance,
      onReady: () => this.onStatus("online"),
      onReconnecting: () => this.onStatus("reconnecting"),
      onReconnected: () => this.onStatus("online"),
      onError: (err: Error) => this.onStatus("failed", err.message),
    });
    this.wsClient = wsClient;
    await wsClient.start({
      eventDispatcher: new Lark.EventDispatcher({}).register({
        "im.message.receive_v1": (data: unknown) => this.dispatch(data),
      }),
    });
  }

  async stop(): Promise<void> {
    const client = this.wsClient;
    this.wsClient = null;
    if (client) client.close();
    this.onStatus("offline");
  }

  /** 事件入口：规范化 + 业务回调，任何异常在此兜底（不抛出 = 不触发重推）。 */
  private async dispatch(raw: unknown): Promise<void> {
    try {
      const msg = normalizeIncoming(raw);
      if (msg) await this.onMessage(msg);
    } catch (err) {
      console.error("[feishu-diary] 事件处理异常（已吞掉防重推）:", err);
    }
  }
}
