/**
 * 一键创建应用（扫码授权）——OAuth 2.0 Device Flow（RFC 8628），环境无关实现。
 *
 * 为什么不用 SDK 的 registerApp：其内部走 axios/XHR，在 Electron renderer 被 CORS
 * 拦截（accounts.feishu.cn 无 CORS 头，实测 Network Error）。协议仅 begin/poll 两个
 * action，此处按 SDK 同款语义重写，出站经注入的 HttpApi（插件 requestUrl 主进程、
 * CLI 用 fetch），插件与 CLI 共用。
 *
 * 基座 preset:false（仅机器人能力、无业务权限），只申请下方显式声明的能力，
 * 与「bot 只认识一串匿名编号」的隐私理念一致。
 */
import { gzipSync } from "node:zlib";
import type { HttpApi } from "./http.ts";

/** 定时器：插件（renderer 有 window）与 Node CLI 共用。 */
const timerApi: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } =
  typeof window !== "undefined" ? window : globalThis;

const FEISHU_ACCOUNTS = "https://accounts.feishu.cn";
const LARK_ACCOUNTS = "https://accounts.larksuite.com";
const REG_ENDPOINT = "/oauth/v1/app/registration";

/** 插件运行所需的全部应用身份权限（tenant scopes）。 */
export const REQUIRED_SCOPES = [
  "im:message.p2p_msg:readonly",
  "im:message:send_as_bot",
  "im:message:readonly",
  "im:message.reactions:write_only",
  "speech_to_text:speech",
  // 允许应用修改自身开发配置（事件订阅方式切 websocket、订阅事件）
  "application:application:patch",
];

/** 需要订阅的事件。 */
export const REQUIRED_EVENTS = ["im.message.receive_v1"];

/** 扫码结果。 */
export interface RegisterResult {
  client_id: string;
  client_secret: string;
  user_info?: { open_id?: string; tenant_brand?: string };
}

export interface ScanCallbacks {
  /** 验证链接就绪：渲染二维码/链接给用户。 */
  onQRCodeReady: (info: { url: string; expireInSeconds: number }) => void;
  /** 流程状态（polling / slow_down / domain_switched）。 */
  onStatus?: (status: string) => void;
}

/** 与 SDK encodeAddons 同款：base64url(gzip(json))。 */
function encodeAddons(payload: object): string {
  const json: string = JSON.stringify(payload);
  const gz: Buffer = gzipSync(Buffer.from(json, "utf8"));
  const b64: string = gz.toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface BeginResponse {
  device_code?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface PollResponse {
  client_id?: string;
  client_secret?: string;
  user_info?: { open_id?: string; tenant_brand?: string };
  error?: string;
  error_description?: string;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = timerApi.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      timerApi.clearTimeout(timer);
      reject(new Error("abort"));
    }
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 发起扫码建应用流程。resolve 即拿到凭据；用户拒绝/超时/取消则 reject（message 为错误码）。
 * http 出站注入：插件传 obsidianHttp（requestUrl 主进程），CLI 传 nodeHttp（fetch）。
 */
export async function createAppByScan(
  http: HttpApi,
  callbacks: ScanCallbacks,
  signal: AbortSignal,
): Promise<RegisterResult> {
  // 1. begin：申请设备码与验证链接
  let begin: { status: number; data: BeginResponse };
  try {
    begin = (await http.postForm(`${FEISHU_ACCOUNTS}${REG_ENDPOINT}`, {
      action: "begin",
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id",
    })) as { status: number; data: BeginResponse };
  } catch (err) {
    throw new Error(`begin 请求失败：${err instanceof Error ? err.message : String(err)}`);
  }
  const beginData = begin.data;
  if (!beginData.device_code || !beginData.verification_uri_complete) {
    throw new Error(
      `begin 失败：HTTP ${begin.status} ${beginData.error ?? ""} ${beginData.error_description ?? ""}`.trim(),
    );
  }

  // 2. 组装确认页 URL（参数与 SDK 一致）。
  // 不带 createOnly：落地页原生提供「选择已有应用」入口——可复用既有应用
  // （如后台手动建的），addons 以增量 diff 确认，顺带补齐缺失的权限/事件。
  const qrUrl = new URL(beginData.verification_uri_complete);
  qrUrl.searchParams.set("from", "sdk");
  qrUrl.searchParams.set("source", "obsidian-feishu-diary");
  qrUrl.searchParams.set("tp", "sdk");
  qrUrl.searchParams.set("name", "Feishu Diary");
  qrUrl.searchParams.set("desc", "把飞书消息记进 Obsidian 的日记机器人");
  qrUrl.searchParams.set(
    "addons",
    encodeAddons({
      preset: false,
      scopes: { tenant: [...REQUIRED_SCOPES], user: [] },
      events: { items: { tenant: [...REQUIRED_EVENTS], user: [] } },
    }),
  );

  const expireInSeconds = beginData.expires_in ?? 600;
  callbacks.onQRCodeReady({ url: qrUrl.toString(), expireInSeconds });

  // 3. 轮询直到授权完成/过期/取消
  let interval = (beginData.interval ?? 5) * 1000;
  let baseUrl = FEISHU_ACCOUNTS;
  const deadline = Date.now() + expireInSeconds * 1000;

  for (;;) {
    const res = (await http.postForm(`${baseUrl}${REG_ENDPOINT}`, {
      action: "poll",
      device_code: beginData.device_code,
    })) as { status: number; data: PollResponse };
    const data = res.data;

    // Lark 租户：切换域名后立即重试
    if (data.user_info?.tenant_brand === "lark" && baseUrl !== LARK_ACCOUNTS) {
      baseUrl = LARK_ACCOUNTS;
      callbacks.onStatus?.("domain_switched");
      continue;
    }

    if (data.client_id && data.client_secret) {
      const result: RegisterResult = {
        client_id: data.client_id,
        client_secret: data.client_secret,
      };
      if (data.user_info) result.user_info = data.user_info;
      return result;
    }

    switch (data.error) {
      case "authorization_pending":
        callbacks.onStatus?.("polling");
        break;
      case "slow_down":
        interval += 5000;
        callbacks.onStatus?.("slow_down");
        break;
      case undefined:
        throw new Error(`poll 返回空结果：HTTP ${res.status}`);
      default:
        throw new Error(`${data.error}: ${data.error_description ?? "未知错误"}`);
    }

    if (Date.now() + interval > deadline) throw new Error("expired_token");
    await sleep(interval, signal);
  }
}
