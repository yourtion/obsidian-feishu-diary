/**
 * HTTP 出站层——Node 运行时（CLI）实现。
 *
 * Node 无 Electron renderer 的 CORS 约束（那只是 Obsidian 环境的问题），
 * 直接用全局 fetch 访问飞书域（scripts/p0 已实证）。接口与 feishu/http.ts 的
 * requestUrl 实现同构（HttpApi），由装配层选择注入。
 */
import type { HttpInstance, HttpRequestOptions } from "@larksuiteoapi/node-sdk";
import type { BinaryResponse, HttpApi, HttpResponse } from "../feishu/http.ts";

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** JSON/form 请求超时：挂起的请求中止，防编排层被单个请求永久阻塞。 */
const JSON_TIMEOUT_MS = 15_000;
/** 二进制下载超时：放宽（附件可达数十 MB，慢网也要给足窗口）。 */
const BINARY_TIMEOUT_MS = 120_000;

/** POST form-urlencoded（与 obsidian 版语义一致：非 2xx 不抛，调用方按 data.error 判定）。 */
async function postForm(url: string, params: Record<string, string>): Promise<HttpResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  });
  return { status: res.status, data: parseBody(await res.text()) };
}

/** 带鉴权头的 JSON 请求。非 2xx 不抛。 */
async function requestJson(
  method: "GET" | "POST" | "DELETE",
  url: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<HttpResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(url, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  });
  return { status: res.status, data: parseBody(await res.text()) };
}

/**
 * 二进制下载。fetch 的 body 只能读一次，故按状态分流：
 * 2xx 读 arrayBuffer；非 2xx 读 text 供调用方解析错误（与 obsidian 版兼容——
 * 调用方只在非 2xx 时消费 text）。
 */
async function requestBinary(url: string, token: string): Promise<BinaryResponse> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(BINARY_TIMEOUT_MS),
  });
  const contentType = res.headers.get("content-type");
  if (res.status >= 200 && res.status < 300) {
    return { status: res.status, buffer: await res.arrayBuffer(), contentType, text: "" };
  }
  return { status: res.status, buffer: new ArrayBuffer(0), contentType, text: await res.text() };
}

/** 全局 fetch 实现的 HttpApi（CLI 装配用）。 */
export const nodeHttp: HttpApi = { postForm, requestJson, requestBinary };

/**
 * SDK HttpInstance 的 fetch 实现——注入 WSClient（建连拉配置的
 * POST /callback/ws/endpoint）。request() 返回解析后的响应 body，
 * 与 SDK defaultHttpInstance 的拦截器语义一致（对齐 obsidian 版实现）。
 */
export function createNodeHttpInstance(): HttpInstance {
  const request = async <T>(opts: HttpRequestOptions<unknown>): Promise<T> => {
    let url = opts.url ?? "";
    if (opts.params) {
      url = `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams(opts.params).toString()}`;
    }
    const hasBody = opts.data !== undefined && opts.data !== null;
    const headers: Record<string, string> = {};
    if (hasBody && typeof opts.data === "object") headers["Content-Type"] = "application/json";
    Object.assign(headers, opts.headers ?? {});
    const res = await fetch(url, {
      method: (opts.method ?? "post").toUpperCase(),
      headers,
      ...(hasBody
        ? { body: typeof opts.data === "string" ? opts.data : JSON.stringify(opts.data) }
        : {}),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    return parseBody(await res.text()) as T;
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
