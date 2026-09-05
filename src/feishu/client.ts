/**
 * FeishuClient——飞书开放平台 REST 封装（tenant_access_token 自管理）。
 *
 * HTTP 出站经 HttpApi 注入（接口见 http.ts）：Obsidian 下为 requestUrl 实现
 * （Electron renderer 的 fetch/XHR 受 CORS 约束），Node CLI 下为 fetch 实现。
 * 长连接（WSClient）由 SDK 承担，其 HTTP 层由装配层注入同款实现。
 */

import type { BinaryResponse, HttpApi, HttpResponse } from "./http.ts";

export class FeishuApiError extends Error {
  readonly httpStatus: number;
  readonly code: number;

  constructor(httpStatus: number, code: number, msg: string) {
    super(`feishu api error: HTTP ${httpStatus} code=${code} ${msg}`);
    this.name = "FeishuApiError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

interface TokenCache {
  token: string;
  expireAt: number;
}

export interface FeishuCreds {
  appId: string;
  appSecret: string;
}

export class FeishuClient {
  private tokenCache: TokenCache | null = null;
  /** 单飞：并发未命中时共享同一次取 token 请求，不重复打接口。 */
  private tokenPromise: Promise<string> | null = null;
  private readonly creds: FeishuCreds;
  private readonly http: HttpApi;

  constructor(creds: FeishuCreds, http: HttpApi) {
    this.creds = creds;
    this.http = http;
  }

  private tenantAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expireAt) {
      return Promise.resolve(this.tokenCache.token);
    }
    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  private async fetchToken(): Promise<string> {
    const res = await this.http.requestJson(
      "POST",
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        body: { app_id: this.creds.appId, app_secret: this.creds.appSecret },
      },
    );
    const body = res.data as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (body.code !== 0 || !body.tenant_access_token) {
      throw new FeishuApiError(
        res.status,
        body.code ?? -1,
        body.msg ?? "get tenant_access_token failed",
      );
    }
    const ttl = (body.expire ?? 3600) * 1000;
    this.tokenCache = { token: body.tenant_access_token, expireAt: Date.now() + ttl - 5 * 60_000 };
    return this.tokenCache.token;
  }

  /** 响应是否为 token 失效（HTTP 401，或飞书 99991663/99991679：token 不存在/无效）。 */
  private isStaleToken(status: number, code: number | undefined): boolean {
    return status === 401 || code === 99991663 || code === 99991679;
  }

  private async request(
    path: string,
    method: "POST" | "DELETE",
    body?: unknown,
  ): Promise<HttpResponse> {
    const doRequest = async (): Promise<HttpResponse> => {
      const token = await this.tenantAccessToken();
      return this.http.requestJson(method, `https://open.feishu.cn${path}`, { token, body });
    };
    let res = await doRequest();
    let data = res.data as { code?: number; msg?: string };
    // token 提前失效：作废缓存取新 token 重试一次
    if (this.isStaleToken(res.status, data.code)) {
      this.tokenCache = null;
      res = await doRequest();
      data = res.data as { code?: number; msg?: string };
    }
    if (!judgeOk(res) || data.code !== 0) {
      throw new FeishuApiError(res.status, data.code ?? -1, data.msg ?? String(res.data));
    }
    return res;
  }

  /** 给用户发文本消息（p2p）。 */
  async sendText(openId: string, text: string): Promise<void> {
    await this.request("/open-apis/im/v1/messages?receive_id_type=open_id", "POST", {
      receive_id: openId,
      content: JSON.stringify({ text }),
      msg_type: "text",
    });
  }

  /** 添加表情回复，返回 reaction_id。 */
  async addReaction(messageId: string, emojiType: string): Promise<string> {
    const res = await this.request(`/open-apis/im/v1/messages/${messageId}/reactions`, "POST", {
      reaction_type: { emoji_type: emojiType },
    });
    const reactionId = (res.data as { data?: { reaction_id?: string } }).data?.reaction_id;
    if (!reactionId)
      throw new FeishuApiError(res.status, -1, "addReaction: no reaction_id in response");
    return reactionId;
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    await this.request(`/open-apis/im/v1/messages/${messageId}/reactions/${reactionId}`, "DELETE");
  }

  /** 下载消息资源（image 用 type=image，其余用 file），返回二进制与 Content-Type。 */
  async downloadResource(
    messageId: string,
    fileKey: string,
    type: "image" | "file",
  ): Promise<{ buffer: ArrayBuffer; contentType: string | null }> {
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`;
    const doDownload = async (): Promise<BinaryResponse> => {
      const token = await this.tenantAccessToken();
      return this.http.requestBinary(url, token);
    };
    let res = await doDownload();
    if (res.status === 401) {
      // token 提前失效：作废缓存取新 token 重试一次
      this.tokenCache = null;
      res = await doDownload();
    }
    if (res.status < 200 || res.status >= 300 || res.buffer.byteLength === 0) {
      const err = parseBody(res.text) as { code?: number; msg?: string };
      throw new FeishuApiError(res.status, err.code ?? -1, err.msg ?? res.text.slice(0, 120));
    }
    return { buffer: res.buffer, contentType: res.contentType };
  }
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { msg: text };
  }
}

function judgeOk(res: HttpResponse): boolean {
  return res.status >= 200 && res.status < 300;
}

/** 表情回复的两态 emoji key（飞书表情 key，P0 实测通过）。 */
export const EMOJI_DOING = "OnIt";
export const EMOJI_DONE = "DONE";
