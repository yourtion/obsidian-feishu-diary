/**
 * FeishuClient——飞书开放平台 REST 封装（tenant_access_token 自管理）。
 *
 * 长连接（WSClient）由 @larksuiteoapi/node-sdk 承担；本类只做简单 REST 调用，
 * 依赖面最小，便于在 Electron renderer 环境下排查问题。
 */

const FEISHU_BASE = "https://open.feishu.cn";

export class FeishuApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: number,
    msg: string,
  ) {
    super(`feishu api error: HTTP ${httpStatus} code=${code} ${msg}`);
    this.name = "FeishuApiError";
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

  constructor(private readonly creds: FeishuCreds) {}

  private async tenantAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expireAt) return this.tokenCache.token;
    const res = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.creds.appId, app_secret: this.creds.appSecret }),
    });
    const body = (await res.json()) as {
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

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const token = await this.tenantAccessToken();
    const res = await fetch(`${FEISHU_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const body = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
    if (!res.ok || body.code !== 0) {
      throw new FeishuApiError(res.status, body.code ?? -1, body.msg ?? res.statusText);
    }
    return body;
  }

  /** 给用户发文本消息（p2p）。 */
  async sendText(openId: string, text: string): Promise<void> {
    await this.request("/open-apis/im/v1/messages?receive_id_type=open_id", {
      method: "POST",
      body: JSON.stringify({
        receive_id: openId,
        content: JSON.stringify({ text }),
        msg_type: "text",
      }),
    });
  }

  /** 添加表情回复，返回 reaction_id。 */
  async addReaction(messageId: string, emojiType: string): Promise<string> {
    const body = (await this.request(`/open-apis/im/v1/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ reaction_type: { emoji_type: emojiType } }),
    })) as { data?: { reaction_id?: string } };
    const reactionId = body.data?.reaction_id;
    if (!reactionId) throw new FeishuApiError(200, -1, "addReaction: no reaction_id in response");
    return reactionId;
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    await this.request(`/open-apis/im/v1/messages/${messageId}/reactions/${reactionId}`, {
      method: "DELETE",
    });
  }

  /** 下载消息资源（image 用 type=image，其余用 file），返回二进制。 */
  async downloadResource(
    messageId: string,
    fileKey: string,
    type: "image" | "file",
  ): Promise<ArrayBuffer> {
    const token = await this.tenantAccessToken();
    const res = await fetch(
      `${FEISHU_BASE}/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
      throw new FeishuApiError(res.status, body.code ?? -1, body.msg ?? "download failed");
    }
    return res.arrayBuffer();
  }
}

/** 表情回复的两态 emoji key（飞书表情 key，P0 实测后如有更贴切的再调整）。 */
export const EMOJI_DOING = "OnIt";
export const EMOJI_DONE = "DONE";
