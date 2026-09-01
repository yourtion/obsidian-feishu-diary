/**
 * P0 · 方式 A：扫码一键创建应用（npm run p0:init）。
 *
 * 幂等可重跑：
 *  - .env 不存在或无 FEISHU_APP_ID → 创建模式（createOnly，扫码即建新应用）
 *  - .env 已有 FEISHU_APP_ID        → 更新模式（传 appId，补全权限与 open_id）
 *
 * 凭据自动写入 scripts/p0/.env（App ID / App Secret / 扫码用户 open_id）。
 *
 * ⚠️ 顺手验证 P0-7：创建完成后到开发者后台「事件与回调」看一眼——
 * 扫码创建的应用默认订阅方式是不是「长连接」？不是的话切换并记录。
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ENV_FILE = join(dirname(new URL(import.meta.url).pathname), ".env");

const existing = await readFile(ENV_FILE, "utf8").catch(() => "");
const existingAppId = /^FEISHU_APP_ID=(\S+)$/m.exec(existing)?.[1];
const mode = existingAppId ? `更新已有应用 ${existingAppId}` : "创建新应用";
console.log(`模式：${mode}\n`);

try {
  const result = await Lark.registerApp({
    ...(existingAppId ? { appId: existingAppId } : { createOnly: true }),
    appPreset: {
      name: "Feishu Diary",
      desc: "把飞书消息记进 Obsidian 的日记机器人",
    },
    addons: {
      preset: false,
      scopes: {
        tenant: [
          "im:message.p2p_msg:readonly",
          "im:message:send_as_bot",
          "im:resource",
          "im:message.reactions:send",
          "speech_to_text:speech",
          "application:application:patch",
        ],
        user: [],
      },
      events: { items: { tenant: ["im.message.receive_v1"], user: [] } },
    },
    onQRCodeReady: (info) => {
      console.log(`请在飞书中打开（${info.expireIn} 秒内有效）：\n  ${info.url}\n`);
    },
  });

  const openId = result.user_info?.open_id ?? "";
  await writeFile(
    ENV_FILE,
    `FEISHU_APP_ID=${result.client_id}\nFEISHU_APP_SECRET=${result.client_secret}\nFEISHU_OWNER_OPEN_ID=${openId}\n`,
    "utf8",
  );
  console.log(`✅ ${mode}成功，凭据已写入 scripts/p0/.env`);
  console.log(`   App ID: ${result.client_id}`);
  if (openId) console.log(`   扫码用户 open_id: ${openId}`);
  console.log(`\n下一步：`);
  console.log(`  1. 开发者后台 →「事件与回调」：确认订阅方式为「使用长连接接收事件」、`);
  console.log(`     im.message.receive_v1 已订阅（顺手回答 P0-7：默认值是什么？）`);
  console.log(`  2. 若改了权限/事件 →「版本管理与发布」创建新版本并发布`);
  console.log(`  3. 运行 npm run p0 验证收消息，或 npm run p0:diag 一键分诊`);
} catch (e) {
  console.error("❌ 流程未完成:", e);
  process.exit(1);
}
