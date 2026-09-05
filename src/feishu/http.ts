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

/** 二进制下载响应（requestBinary 的返回形状）。 */
export interface BinaryResponse {
  status: number;
  buffer: ArrayBuffer;
  contentType: string | null;
  text: string;
}

/**
 * HTTP 出站 API——环境无关接口，由宿主装配层选择实现注入：
 * Obsidian 走本文件的 requestUrl 实现，Node CLI 走 node/http.ts 的 fetch 实现。
 * 类型引用（import type）零运行时成本，不会把 obsidian 拖进 CLI 产物。
 */
export interface HttpApi {
  postForm(url: string, params: Record<string, string>): Promise<HttpResponse>;
  requestJson(
    method: "GET" | "POST" | "DELETE",
    url: string,
    opts?: { token?: string; body?: unknown },
  ): Promise<HttpResponse>;
  requestBinary(url: string, token: string): Promise<BinaryResponse>;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** JSON/form 请求超时；requestUrl 不支持中止，超时仅解除调用方阻塞（底层请求继续）。 */
const JSON_TIMEOUT_MS = 15_000;
/** 二进制下载超时（附件可达数十 MB，放宽窗口）。 */
const BINARY_TIMEOUT_MS = 120_000;

/** 竞速超时：到点 reject，防止 requestUrl 挂起永久阻塞调用方。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** POST form-urlencoded（飞书设备授权流用）。非 2xx 不抛，由调用方按 data.error 判定。 */
export async function postForm(url: string, params: Record<string, string>): Promise<HttpResponse> {
  const res = await withTimeout(
    requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      throw: false,
    }),
    JSON_TIMEOUT_MS,
    `POST ${url}`,
  );
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
  const res = await withTimeout(requestUrl(param), JSON_TIMEOUT_MS, `${method} ${url}`);
  return { status: res.status, data: parseBody(res.text) };
}

/** 二进制下载（消息资源）。非 2xx 时 buffer 为空、text 携带错误响应。 */
export async function requestBinary(url: string, token: string): Promise<BinaryResponse> {
  const res = await withTimeout(
    requestUrl({
      url,
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      throw: false,
    }),
    BINARY_TIMEOUT_MS,
    `GET ${url}`,
  );
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
    const res = await withTimeout(requestUrl(param), JSON_TIMEOUT_MS, `${param.method} ${url}`);
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

/** requestUrl 实现的 HttpApi（Obsidian 装配用）。 */
export const obsidianHttp: HttpApi = { postForm, requestJson, requestBinary };
