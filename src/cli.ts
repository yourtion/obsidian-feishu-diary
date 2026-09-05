/**
 * feishu-diary CLI 入口——无 Obsidian 环境的常驻服务（npx feishu-diary）。
 *
 * 装配：env/args 配置 + Node fs 存储 + fetch HTTP → FeishuDiaryService（service.ts，
 * 与插件共用编排）。SIGINT/SIGTERM 优雅退出。用法见 --help（USAGE 在 node/config.ts）。
 */
import process from "node:process";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { FeishuDiaryService } from "./service.ts";
import { channelStatusLabel } from "./feishu/channel.ts";
import { createNodeHttpInstance, nodeHttp } from "./node/http.ts";
import { NodeFsVaultAdapter } from "./node/vault.ts";
import { loadHooks, runShellHook } from "./node/hooks.ts";
import {
  USAGE,
  buildSettings,
  loadState,
  parseEnvFile,
  resolveConfig,
  saveState,
} from "./node/config.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const env: Record<string, string | undefined> = { ...process.env };

  // --env-file 需要先于正式解析注入（不 strict 轻取一次，避免重复定义参数表）。
  const { values: peek } = parseArgs({
    args: argv,
    options: { "env-file": { type: "string" } },
    strict: false,
  });
  const envFile = typeof peek["env-file"] === "string" ? peek["env-file"] : undefined;
  if (envFile) {
    Object.assign(env, parseEnvFile(await readFile(envFile, "utf8")));
  }

  let resolution;
  try {
    resolution = resolveConfig(argv, env);
  } catch (err) {
    console.error(`\n配置错误：${err instanceof Error ? err.message : String(err)}\n`);
    console.error(USAGE);
    process.exit(2);
  }
  if (resolution.help) {
    console.log(USAGE);
    return;
  }
  const config = resolution.config;
  if (!config) return;

  // hooks.json 坏配置直接退出（配置错误不该带病启动）；不存在 = 未启用。
  let hooks;
  try {
    hooks = await loadHooks(config.hooksFile);
  } catch (err) {
    console.error(`\nhooks 配置错误：${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }

  const state = await loadState(config.stateFile);
  const settings = buildSettings(config, state);
  const service = new FeishuDiaryService({
    creds: { appId: config.appId, appSecret: config.appSecret },
    http: nodeHttp,
    httpInstance: createNodeHttpInstance(),
    storage: new NodeFsVaultAdapter(config.dir),
    settings,
    persist: async (s) => {
      await saveState(config.stateFile, {
        ownerOpenId: s.ownerOpenId,
        nickname: s.nickname,
        reminderState: s.reminderState,
      });
    },
    notify: (message) => console.error(`[feishu-diary] ${message}`),
    onStatus: (status, detail) =>
      console.log(
        `[feishu-diary] 通道状态：${channelStatusLabel(status)}${detail ? `（${detail}）` : ""}`,
      ),
    hooks: hooks.rules,
    hookRunner: (cmd, url) => runShellHook(cmd, url, hooks.timeoutMs),
  });

  console.log("[feishu-diary] 启动");
  console.log(`  日记目录：${config.dir}`);
  console.log(`  应用：${config.appId}`);
  console.log(`  认主：${settings.ownerOpenId ?? "待首消息自动认主"}`);
  console.log(`  提醒：${settings.reminderEnabled ? `${settings.reminderTime}（东八区）` : "关"}`);
  console.log(`  状态文件：${config.stateFile}`);
  console.log(
    `  URL hooks：${hooks.rules.length > 0 ? `${hooks.rules.length} 条（${config.hooksFile}，超时 ${Math.round(hooks.timeoutMs / 1000)}s）` : "未启用"}`,
  );

  await service.start();

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[feishu-diary] 收到 ${signal}，正在关闭…`);
    void service.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[feishu-diary] 启动失败:", err);
  process.exit(1);
});
