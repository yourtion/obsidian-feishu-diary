/**
 * P0 通道验证脚本（主链路）。
 *
 * 验证目标：
 *  1. WebSocket 长连接收消息（官方 SDK 路线）
 *  2. 机器人主动发消息（官方 SDK 路线）
 *  3. 表情回复两态：执行中 → 完成（裸 REST 路线，验证自实现可行性）
 *  4. 消息资源下载：image / file / audio / media（裸 REST 路线）
 *  5. 断线补推观察：所有事件落 p0-log.jsonl，断网重连后对照
 *
 * 事件 handler 刻意「先落盘、重活异步」——模拟插件里应对 3 秒时限的方式。
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

const HERE = dirname(new URL(import.meta.url).pathname);
const DOWNLOAD_DIR = join(HERE, "downloads");
const LOG_FILE = join(HERE, "p0-log.jsonl");

const FEISHU_BASE = "https://open.feishu.cn";
/** 执行中表情（飞书「收到」）。若该 key 无效，可换 "THUMBSUP" 等再试。 */
const EMOJI_DOING = "OnIt";
/** 完成表情（飞书「✅」）。 */
const EMOJI_DONE = "DONE";

const appId = requireEnv("FEISHU_APP_ID");
const appSecret = requireEnv("FEISHU_APP_SECRET");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`缺少 ${name}。请先 cp scripts/p0/.env.example scripts/p0/.env 并填写。`);
    process.exit(1);
  }
  return value;
}

// ---------- 事件结构（im.message.receive_v1，schema 2.0）----------
interface ReceiveEvent {
  event?: {
    sender?: { sender_id?: { open_id?: string }; sender_type?: string };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      create_time?: string;
      content?: string;
    };
  };
}

// ---------- 裸 REST：tenant_access_token 自管理（验证自实现路线）----------
let tokenCache: { token: string; expireAt: number } | null = null;

async function tenantAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expireAt) return tokenCache.token;
  const res = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const body = (await res.json()) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败: HTTP ${res.status} ${body.code} ${body.msg}`);
  }
  const expire = (body.expire ?? 3600) * 1000;
  tokenCache = { token: body.tenant_access_token, expireAt: Date.now() + expire - 5 * 60_000 };
  console.log(`[token] 已获取，${Math.round(expire / 60000)} 分钟后过期`);
  return tokenCache.token;
}

interface ApiResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function apiJson(path: string, init: RequestInit): Promise<ApiResult> {
  const token = await tenantAccessToken();
  const res = await fetch(`${FEISHU_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  let body: unknown = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { ok: res.ok, status: res.status, body };
}

// ---------- 表情回复两态 ----------
async function addReaction(messageId: string, emoji: string): Promise<string | null> {
  const r = await apiJson(`/open-apis/im/v1/messages/${messageId}/reactions`, {
    method: "POST",
    body: JSON.stringify({ reaction_type: { emoji_type: emoji } }),
  });
  const reactionId =
    (r.body as { data?: { reaction_id?: string } } | null)?.data?.reaction_id ?? null;
  console.log(
    `[reaction] +${emoji} → HTTP ${r.status} ${reactionId ?? JSON.stringify(r.body).slice(0, 120)}`,
  );
  return reactionId;
}

async function removeReaction(messageId: string, reactionId: string): Promise<void> {
  const r = await apiJson(`/open-apis/im/v1/messages/${messageId}/reactions/${reactionId}`, {
    method: "DELETE",
  });
  console.log(`[reaction] 移除 ${reactionId.slice(0, 12)}… → HTTP ${r.status}`);
}

// ---------- 资源下载 ----------
function sanitizeFileName(name: string): string {
  // 文件名消毒：去除路径分隔符与控制字符（控制字符匹配是有意为之）。
  // oxlint-disable-next-line no-control-regex
  return name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").slice(0, 120) || "unnamed";
}

async function downloadResource(
  messageId: string,
  fileKey: string,
  type: "image" | "file",
  saveAs: string,
): Promise<void> {
  const token = await tenantAccessToken();
  const res = await fetch(
    `${FEISHU_BASE}/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log(`[download] 失败 HTTP ${res.status} ${text.slice(0, 160)}`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const target = join(DOWNLOAD_DIR, sanitizeFileName(saveAs));
  await writeFile(target, buf);
  console.log(`[download] 已保存 ${saveAs}（${(buf.length / 1024).toFixed(1)} KB）`);
}

// ---------- 事件落盘（断线补推对照用）----------
async function logEvent(kind: string, payload: Record<string, unknown>): Promise<void> {
  const record = { ts: new Date().toISOString(), kind, ...payload };
  await appendFile(LOG_FILE, `${JSON.stringify(record)}\n`, "utf8");
}

// ---------- 官方 SDK：收发消息 ----------
const client = new Lark.Client({ appId, appSecret, loggerLevel: Lark.LoggerLevel.warn });

async function replyText(chatId: string, text: string): Promise<void> {
  await client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      content: JSON.stringify({ text }),
      msg_type: "text",
    },
  });
  console.log(`[send] 已发送主动文本消息`);
}

// ---------- 资源类消息处理 ----------
async function handleResource(
  msg: NonNullable<NonNullable<ReceiveEvent["event"]>["message"]>,
): Promise<void> {
  let content: Record<string, unknown> = {};
  try {
    content = JSON.parse(msg.content ?? "{}") as Record<string, unknown>;
  } catch {
    /* content 非法则跳过下载 */
  }
  const messageId = msg.message_id ?? "";
  const createTime = Number(msg.create_time ?? Date.now());
  const stamp = new Date(createTime).toISOString().replace(/[-:T]/g, "").slice(0, 15);

  if (msg.message_type === "image" && typeof content.image_key === "string") {
    await downloadResource(messageId, content.image_key, "image", `${stamp}-image.png`);
  } else if (msg.message_type === "file" && typeof content.file_key === "string") {
    await downloadResource(
      messageId,
      content.file_key,
      "file",
      `${stamp}-${String(content.file_name ?? "file")}`,
    );
  } else if (msg.message_type === "audio" && typeof content.file_key === "string") {
    await downloadResource(
      messageId,
      content.file_key,
      "file",
      `${stamp}-audio-${String(content.duration ?? 0)}ms.opus`,
    );
  } else if (msg.message_type === "media" && typeof content.file_key === "string") {
    await downloadResource(
      messageId,
      content.file_key,
      "file",
      `${stamp}-${String(content.file_name ?? "video.mp4")}`,
    );
  } else {
    console.log(`[download] 跳过类型 ${msg.message_type}（不支持或无 file_key）`);
  }
}

// ---------- 事件入口（3 秒时限：轻活同步，重活异步不 await）----------
async function onReceive(data: ReceiveEvent): Promise<void> {
  const ev = data.event;
  const msg = ev?.message;
  const sender = ev?.sender;
  if (!msg?.message_id) return;

  const createTimeLocal = new Date(Number(msg.create_time ?? Date.now())).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
  });
  const summary =
    msg.message_type === "text"
      ? (JSON.parse(msg.content ?? "{}").text ?? "")
      : (msg.content ?? "").slice(0, 80);
  console.log(`\n[event] ${msg.chat_type ?? "?"} | ${msg.message_type} | ${msg.message_id}`);
  console.log(
    `       create_time=${createTimeLocal} | open_id=${sender?.sender_id?.open_id?.slice(0, 16)}…`,
  );
  console.log(`       content=${String(summary).slice(0, 120)}`);

  const record = {
    message_id: msg.message_id,
    chat_id: msg.chat_id,
    chat_type: msg.chat_type,
    message_type: msg.message_type,
    create_time: msg.create_time,
    open_id: sender?.sender_id?.open_id,
    content: msg.content?.slice(0, 500),
  };
  await logEvent("im.message.receive_v1", record);

  if (msg.chat_type !== "p2p") {
    console.log("       （群聊消息，跳过——MVP 只处理单聊）");
    return;
  }

  // 重活异步执行，不阻塞 handler 返回（模拟插件内队列）
  void (async () => {
    try {
      const doingReaction = await addReaction(msg.message_id as string, EMOJI_DOING);
      await replyText(
        msg.chat_id as string,
        `[p0] 已收到 ${msg.message_type} 消息，create_time=${createTimeLocal}`,
      );
      if (["image", "file", "audio", "media"].includes(msg.message_type ?? "")) {
        await handleResource(msg);
      }
      if (doingReaction) {
        await removeReaction(msg.message_id as string, doingReaction);
      }
      await addReaction(msg.message_id as string, EMOJI_DONE);
      console.log(`[pipeline] 完成 ✅`);
    } catch (err) {
      console.error(`[pipeline] 失败 ❌`, err);
      await logEvent("pipeline-error", { message_id: msg.message_id, error: String(err) });
    }
  })();
}

// ---------- 启动 ----------
async function main(): Promise<void> {
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  console.log(`P0 通道验证启动（SDK ${LarkWsClientVersion()}）`);
  console.log(`事件日志: ${LOG_FILE}`);
  console.log(`下载目录: ${DOWNLOAD_DIR}`);
  console.log(`等待消息中——请在飞书里给机器人发文字 / 图片 / 文件 / 语音试试（Ctrl+C 退出）\n`);

  const wsClient = new Lark.WSClient({ appId, appSecret, loggerLevel: Lark.LoggerLevel.info });
  await wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": onReceive,
    }),
  });
  await logEvent("startup", { note: "ws client started" });
}

function LarkWsClientVersion(): string {
  return (Lark as unknown as { VERSION?: string }).VERSION ?? "unknown";
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
