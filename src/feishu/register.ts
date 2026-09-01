/**
 * 一键创建应用（扫码授权）——基于 SDK registerApp（OAuth 2.0 Device Flow，RFC 8628）。
 *
 * 用户在飞书扫码确认后：自动创建企业自建应用、按 addons 预填权限与事件订阅，
 * 直接返回 App ID / App Secret，无需手动进入开发者后台。
 *
 * 基座选择 preset:false（仅机器人能力、无业务权限），只申请下方显式声明的能力，
 * 与「bot 只认识一串匿名编号」的隐私理念一致。
 *
 * ⚠️ 事件订阅方式（长连接）属于敏感配置，不能随 addons 预填——若新应用默认
 * 不是长连接，用户仍需在开发者后台把订阅方式切为「使用长连接接收事件」。
 */
import { registerApp } from "@larksuiteoapi/node-sdk";

/** registerApp 返回值（SDK 未导出该接口类型，按结构重新声明）。 */
export interface RegisterResult {
  client_id: string;
  client_secret: string;
  user_info?: { open_id?: string };
}

/** 插件运行所需的全部应用身份权限（tenant scopes）。 */
export const REQUIRED_SCOPES = [
  "im:message.p2p_msg:readonly",
  "im:message:send_as_bot",
  "im:message:readonly",
  "im:message.reactions:write_only",
  "speech_to_text:speech",
  // 允许应用修改自身开发配置（事件订阅方式切 websocket、订阅事件）
  "application:application:patch",
] as const;

/** 需要订阅的事件。 */
export const REQUIRED_EVENTS = ["im.message.receive_v1"] as const;

export interface ScanCallbacks {
  /** 验证链接就绪：渲染二维码/链接给用户。 */
  onQRCodeReady: (info: { url: string; expireInSeconds: number }) => void;
  /** 流程状态（polling / slow_down / domain_switched）。 */
  onStatus?: (status: string) => void;
}

/**
 * 发起扫码建应用流程。resolve 即拿到凭据；用户拒绝/超时/取消则 reject（code 字段）。
 */
export function createAppByScan(
  callbacks: ScanCallbacks,
  signal: AbortSignal,
): Promise<RegisterResult> {
  return registerApp({
    source: "obsidian-feishu-diary",
    createOnly: true,
    appPreset: {
      name: "Feishu Diary",
      desc: "把飞书消息记进 Obsidian 的日记机器人（{user} 自用）",
    },
    addons: {
      preset: false,
      scopes: { tenant: [...REQUIRED_SCOPES], user: [] },
      events: { items: { tenant: [...REQUIRED_EVENTS], user: [] } },
    },
    signal,
    onQRCodeReady: (info) =>
      callbacks.onQRCodeReady({ url: info.url, expireInSeconds: info.expireIn }),
    onStatusChange: (info) => callbacks.onStatus?.(info.status),
  });
}
