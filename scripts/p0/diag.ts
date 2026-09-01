/**
 * P0 · 一键分诊（npm run p0:diag）：收不到事件时，把问题切成两半。
 *
 * 出站（机器人主动发消息）走得通 → 凭据/机器人能力/发送权限/版本发布全部 OK，
 * 问题锁定在入站侧（事件订阅方式、事件列表、多进程抢占连接）。
 * 出站失败 → 错误码直接指出问题。
 */
import { execSync } from "node:child_process";
import process from "node:process";

const FEISHU_BASE = "https://open.feishu.cn";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`缺少 ${name}。请先运行 npm run p0:init（会自动补全）。`);
    process.exit(1);
  }
  return value;
}

const appId = requireEnv("FEISHU_APP_ID");
const appSecret = requireEnv("FEISHU_APP_SECRET");
const ownerOpenId = process.env.FEISHU_OWNER_OPEN_ID ?? "";

// ---------- 1. 进程抢占检查（长连接集群模式：多客户端随机只有一个收到事件）----------
function countP0Processes(): number {
  try {
    const out = execSync("ps -Ao command | grep 'p0/run.ts' | grep -v grep || true", {
      encoding: "utf8",
      shell: "/bin/zsh",
    });
    return out.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return -1;
  }
}

const p0Count = countP0Processes();
console.log(`[1] p0/run.ts 在跑的进程数：${p0Count < 0 ? "未知" : p0Count}`);
if (p0Count > 1) {
  console.log(`    ⚠️ 多个进程同时挂长连接——飞书集群模式会随机挑一个推送，你看的那个可能收不到！`);
  console.log(`    处理：kill 掉多余的（lsof -ti node | xargs kill 或手动），只留一个再试。`);
}

// ---------- 2. 凭据与 token ----------
interface TokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
}

const tokenRes = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
});
const tokenBody = (await tokenRes.json()) as TokenResponse;
if (tokenBody.code !== 0 || !tokenBody.tenant_access_token) {
  console.error(
    `[2] ❌ 获取 tenant_access_token 失败：HTTP ${tokenRes.status} ${tokenBody.code} ${tokenBody.msg}`,
  );
  console.error(`    → App ID / App Secret 不对，重跑 npm run p0:init 重新生成凭据。`);
  process.exit(1);
}
console.log(`[2] ✅ 凭据有效，token 获取成功`);

// ---------- 3. 出站：机器人主动发消息 ----------
if (!ownerOpenId) {
  console.log(
    `[3] ⏭️ .env 缺 FEISHU_OWNER_OPEN_ID（旧版 init 生成），重跑 npm run p0:init 可补全后再分诊`,
  );
  process.exit(0);
}

const sendRes = await fetch(`${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${tokenBody.tenant_access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    receive_id: ownerOpenId,
    msg_type: "text",
    content: JSON.stringify({
      text: "P0 诊断：收到这条说明「机器人→你」的发送链路已通。接下来看你发的消息我能不能收到。",
    }),
  }),
});
const sendBody = (await sendRes.json().catch(() => ({}))) as { code?: number; msg?: string };

if (sendRes.ok && sendBody.code === 0) {
  console.log(`[3] ✅ 机器人已给你发了一条测试消息（飞书里应该能收到）`);
} else {
  console.error(`[3] ❌ 发送失败：HTTP ${sendRes.status} code=${sendBody.code} ${sendBody.msg}`);
  const code = sendBody.code;
  if (code === 99991672 || code === 99991679 || code === 230002) {
    console.error(`    → 权限未生效：确认「权限管理」已开通 im:message:send_as_bot，`);
    console.error(`      且「版本管理与发布」创建了新版本并已发布（未发布的版本权限不生效）`);
  } else if (code === 230001) {
    console.error(`    → 机器人能力未开启：应用能力 → 添加「机器人」`);
  } else if (code === 230013) {
    console.error(`    → 收件人不在应用可用范围内：版本发布时可用范围要包含你自己`);
  } else {
    console.error(`    → 对照 open.feishu.cn 错误码文档排查`);
  }
  process.exit(1);
}

// ---------- 4. 入站修复：订阅方式切 websocket + 订阅接收消息事件 ----------
// 实测（P0-7）：扫码创建的应用默认订阅方式即长连接，addons 的事件预填也生效。
// 此步作为幂等自愈兜底（配置漂移/后台误改/事件丢失时一键修复）。
const patchRes = await fetch(
  `${FEISHU_BASE}/open-apis/application/v7/applications/${appId}/config`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${tokenBody.tenant_access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event: {
        subscription_type: "websocket",
        add_events: ["im.message.receive_v1"],
      },
    }),
  },
);
const patchBody = (await patchRes.json().catch(() => ({}))) as { code?: number; msg?: string };

if (patchRes.ok && patchBody.code === 0) {
  console.log(`[4] ✅ 已修复入站配置：订阅方式=websocket，已订阅 im.message.receive_v1`);
  console.log(`
⚠️ 配置修改需要发布新版本才在线上生效：
   开发者后台 → 版本管理与发布 → 创建版本 → 申请发布（自审自批）
   发布完成后运行 npm run p0，在飞书发条消息验证。
`);
} else {
  console.error(
    `[4] ❌ 修复订阅配置失败：HTTP ${patchRes.status} code=${patchBody.code} ${patchBody.msg}`,
  );
  if (patchBody.code === 99991672 || patchBody.code === 99991679) {
    console.error(`    → 缺 application:application:patch 权限或权限未发布生效。`);
    console.error(
      `      处理：npm run p0:init 重扫（本次会申请该权限）→ 发布新版本 → 再跑 npm run p0:diag`,
    );
  } else {
    console.error(
      `    → 手动兜底：后台「事件与回调」→ 订阅方式选「使用长连接接收事件」（p0 在线时保存）`,
    );
    console.error(`      → 添加事件 im.message.receive_v1 → 发布新版本`);
  }
  process.exit(1);
}
