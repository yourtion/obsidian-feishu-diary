/**
 * P0 · 方式 A：扫码一键创建应用（npm run p0:init）。
 *
 * 跑起来后用手机飞书扫码（或打开打印的链接）确认，
 * 自动创建自建应用并预填权限与事件订阅；凭据自动写入 scripts/p0/.env。
 *
 * ⚠️ 顺手验证 P0-7：创建完成后到开发者后台「事件与回调」看一眼——
 * 扫码创建的应用默认订阅方式是不是「长连接」？不是的话切换并记录，
 * 插件设置页的引导文案要据此调整。
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ENV_FILE = join(dirname(new URL(import.meta.url).pathname), ".env");

try {
  const result = await Lark.registerApp({
    createOnly: true,
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
        ],
        user: [],
      },
      events: { items: { tenant: ["im.message.receive_v1"], user: [] } },
    },
    onQRCodeReady: (info) => {
      console.log(`\n请在飞书中打开（${info.expireIn} 秒内有效）：\n  ${info.url}\n`);
    },
  });

  await writeFile(
    ENV_FILE,
    `FEISHU_APP_ID=${result.client_id}\nFEISHU_APP_SECRET=${result.client_secret}\n`,
    "utf8",
  );
  console.log(`✅ 应用创建成功，凭据已写入 scripts/p0/.env`);
  console.log(`   App ID: ${result.client_id}`);
  if (result.user_info?.open_id) console.log(`   扫码用户 open_id: ${result.user_info.open_id}`);
  console.log(`\n下一步：`);
  console.log(`  1. 开发者后台 →「事件与回调」：确认订阅方式为「使用长连接接收事件」、`);
  console.log(`     im.message.receive_v1 已订阅（顺手回答 P0-7：默认值是什么？）`);
  console.log(`  2. 运行 npm run p0 开始通道验证`);
} catch (e) {
  console.error("❌ 流程未完成:", e);
  process.exit(1);
}
