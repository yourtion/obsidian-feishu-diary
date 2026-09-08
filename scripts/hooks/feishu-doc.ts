/**
 * URL hook 示例：拉取飞书文档内容（wiki / docx / 旧版 doc），stdout 进当天日记。
 *
 * 用法：node scripts/hooks/feishu-doc.ts <飞书文档 URL>
 * 凭据经环境变量注入（FEISHU_APP_ID / FEISHU_APP_SECRET）——CLI 用 --env-file
 * 启动后，hook 子进程天然继承，hooks.json 里无需重复配置。
 *
 * 权限前提（两者都要）：
 *   1. 应用具备 docx:document:readonly / wiki:wiki:readonly scope；
 *   2. 文档对应用可见——把机器人加为文档协作者（或文档开启「组织内获得链接的人可阅读」）。
 * 缺任一会 403（99991672），错误信息经 stderr 回执到聊天。
 */
import process from "node:process";

const FEISHU_BASE = "https://open.feishu.cn";
/** 落日记的内容上限（字），超长截断——全文另存可在此改为写文件。 */
const MAX_CONTENT = 4000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`缺少环境变量 ${name}（hook 子进程从 CLI 进程继承，CLI 需 --env-file 启动）`);
    process.exit(1);
  }
  return value;
}

const appId = requireEnv("FEISHU_APP_ID");
const appSecret = requireEnv("FEISHU_APP_SECRET");

const url = process.argv[2] ?? "";
const matched = /\/(docx|wiki|docs|doc)\/([A-Za-z0-9]+)/.exec(url);
if (!matched) {
  console.error(`不是飞书文档链接（未识别 docx/wiki/docs 路径）：${url}`);
  process.exit(1);
}
const kind = matched[1] === "wiki" ? "wiki" : matched[1] === "docx" ? "docx" : "doc";
const linkToken = matched[2]!;

interface ApiBody {
  code?: number;
  msg?: string;
  data?: unknown;
}

async function callApi(path: string, token: string): Promise<ApiBody> {
  const res = await fetch(`${FEISHU_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as ApiBody;
}

function failAt(step: string, body: ApiBody): never {
  const hint =
    body.code === 99991672 ? "（应用缺 scope，或文档未授权给机器人——把机器人加为文档协作者）" : "";
  console.error(`飞书文档拉取失败 @${step}：code=${body.code} ${body.msg}${hint}`);
  process.exit(1);
}

// ---------- tenant_access_token ----------
const tokenRes = (await (
  await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
).json()) as { code?: number; msg?: string; tenant_access_token?: string };
if (tokenRes.code !== 0 || !tokenRes.tenant_access_token) {
  console.error(`获取 tenant_access_token 失败：${tokenRes.code} ${tokenRes.msg}`);
  process.exit(1);
}
const tenantToken = tokenRes.tenant_access_token;

// ---------- wiki 链接先换 obj_token ----------
let docType = kind;
let docToken = linkToken;
let title = "";
if (kind === "wiki") {
  const node = await callApi(
    `/open-apis/wiki/v2/spaces/get_node?token=${linkToken}&obj_type=wiki`,
    tenantToken,
  );
  if (node.code !== 0) failAt("wiki 节点解析", node);
  const n = (node.data as { node?: { obj_token?: string; obj_type?: string; title?: string } })
    ?.node;
  if (!n?.obj_token) failAt("wiki 节点解析", { code: -1, msg: "响应缺 obj_token" });
  docType = n.obj_type === "doc" ? "doc" : "docx";
  docToken = n.obj_token;
  title = n.title ?? "";
}

// ---------- raw_content ----------
const rawPath =
  docType === "docx"
    ? `/open-apis/docx/v1/documents/${docToken}/raw_content`
    : `/open-apis/doc/v2/documents/${docToken}/raw_content`;
const doc = await callApi(rawPath, tenantToken);
if (doc.code !== 0) failAt(docType === "docx" ? "docx 原文" : "doc 原文", doc);
const content = (doc.data as { content?: string } | undefined)?.content ?? "";

const trimmed =
  content.length > MAX_CONTENT ? `${content.slice(0, MAX_CONTENT)}…（已截断）` : content;
const label = title ? `《${title}》` : "";
console.log(`飞书文档${label}已拉取（${content.length} 字）：\n\n${trimmed}`);
