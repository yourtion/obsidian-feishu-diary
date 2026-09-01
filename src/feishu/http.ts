/**
 * HTTP 出站层——统一走 Obsidian requestUrl（主进程网络栈）。
 *
 * 为什么不用 fetch/axios：插件运行在 Electron renderer（origin app://obsidian.md），
 * fetch 与 XHR 都受 CORS 约束——实测 accounts.feishu.cn 不返回 CORS 头，
 * axios/XHR 直接 Network Error。requestUrl 是 Obsidian 官方推荐的插件出站方式。
 *
 * 本模块是插件内唯一的 HTTP 出站入口；p0 脚本（Node 环境，无 CORS）用裸 fetch，互不影响。
 */
import { requestUrl } from "obsidian";
import type { RequestUrlParam } from "obsidian";
import type { HttpInstance, HttpRequestOptions } from "@larksuiteoapi/node-sdk";

export interface HttpResponse {
  status: number;
  /** 解析后的 JSON；非 JSON 响应为原始文本。 */
  data: unknown;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** POST form-urlencoded（飞书设备授权流用）。非 2xx 不抛，由调用方按 data.error 判定。 */
export async function postForm(url: string, params: Record<string, string>): Promise<HttpResponse> {
  const res = await requestUrl({
    url,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    throw: false,
  });
  return { status: res.status, data: parseBody(res.text) };
}

/** 带鉴权头的 JSON 请求（飞书 OpenAPI 用）。非 2xx 不抛。 */
export async function requestJson(
  method: "GET" | "POST" | "DELETE",
  url: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<HttpResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const param: RequestUrlParam = {
    url,
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    throw: false,
  };
  const res = await requestUrl(param);
  return { status: res.status, data: parseBody(res.text) };
}

/** 二进制下载（消息资源）。非 2xx 时 buffer 为空、text 携带错误响应。 */
export async function requestBinary(
  url: string,
  token: string,
): Promise<{ status: number; buffer: ArrayBuffer; contentType: string | null; text: string }> {
  const res = await requestUrl({
    url,
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    throw: false,
  });
  return {
    status: res.status,
    buffer: res.arrayBuffer,
    contentType: res.headers["content-type"] ?? null,
    text: res.text,
  };
}

/**
 * SDK HttpInstance 的 requestUrl 实现——注入 WSClient，替换其内置 axios/XHR。
 * WSClient 建连前要 POST /callback/ws/endpoint 拿连接配置，内置实例在
 * Electron renderer 被 CORS 拦（实测 Network Error）；本实现走主进程。
 * request() 返回解析后的响应 body（与 SDK defaultHttpInstance 的拦截器语义一致）。
 */
export function createObsidianHttpInstance(): HttpInstance {
  const request = async <T>(opts: HttpRequestOptions<unknown>): Promise<T> => {
    let url = opts.url ?? "";
    if (opts.params) {
      url = `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams(opts.params).toString()}`;
    }
    const hasBody = opts.data !== undefined && opts.data !== null;
    const headers: Record<string, string> = {};
    if (hasBody && typeof opts.data === "object") headers["Content-Type"] = "application/json";
    Object.assign(headers, opts.headers ?? {});
    const param: RequestUrlParam = {
      url,
      method: (opts.method ?? "post").toUpperCase(),
      headers,
      ...(hasBody
        ? { body: typeof opts.data === "string" ? opts.data : JSON.stringify(opts.data) }
        : {}),
      throw: false,
    };
    const res = await requestUrl(param);
    return parseBody(res.text) as T;
  };
  const withMethod =
    (method: string) =>
    <T>(url: string, data?: unknown, opts: HttpRequestOptions<unknown> = {}): Promise<T> =>
      request<T>({ ...opts, url, method, data });
  return {
    request,
    get: withMethod("get"),
    delete: withMethod("delete"),
    head: withMethod("head"),
    options: withMethod("options"),
    post: withMethod("post"),
    put: withMethod("put"),
    patch: withMethod("patch"),
  };
}
