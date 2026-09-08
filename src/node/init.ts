/**
 * feishu-diary init——扫码建应用并生成配置文件（CLI 侧，不进 main.js 产物）。
 *
 * 流程：问日记目录（默认 ~/FeishuDiary）→ 终端二维码扫码（createAppByScan 与插件
 * 共用，http 注入 nodeHttp；确认页可复用已有应用）→ 写 ~/.feishu-diary.json（凭据 +
 * 扫码者 open_id 预填认主，权限 600——明文凭据不进 git 目录）。发布新版本仍需用户
 * 去开发者后台（收尾输出直达链接），见 AGENTS.md 硬知识 2/4。
 */
import process from "node:process";
import { access, chmod, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { createAppByScan, type RegisterResult } from "../feishu/register.ts";
import { nodeHttp } from "./http.ts";
import { defaultConfigFile, type FileConfig } from "./config.ts";
import { qrTerminal } from "./qrcode-terminal.ts";

const DOCS_BASE = "https://github.com/yourtion/obsidian-feishu-diary/blob/main/docs";
const DEFAULT_DIR = "~/FeishuDiary";

/** 由扫码结果 + 目录生成配置文件内容（纯函数，单测固化 ownerOpenId 预填）。 */
export function buildInitConfig(result: RegisterResult, dir: string): FileConfig {
  const config: FileConfig = {
    appId: result.client_id,
    appSecret: result.client_secret,
    dir,
  };
  const openId = result.user_info?.open_id;
  if (openId) config.ownerOpenId = openId;
  return config;
}

/** 写配置文件并收紧权限（凭据明文，600 仅本人可读写）。 */
export async function writeConfigFile(file: string, config: FileConfig): Promise<void> {
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await chmod(file, 0o600);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(homedir(), p.slice(1)) : p;
}

/** init 子命令入口（cli.ts 以 argv[0] === "init" 分发）。 */
export async function runInit(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { config: { type: "string" }, dir: { type: "string" } },
    strict: true,
  });
  const configFile = path.resolve(
    typeof values.config === "string" && values.config ? values.config : defaultConfigFile(),
  );

  console.log("feishu-diary init——扫码创建飞书应用并生成配置文件\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const abort = new AbortController();
  const onSigint = (): void => abort.abort();
  process.on("SIGINT", onSigint);

  try {
    // 已有配置：确认覆盖（旧文件备份 .bak）
    const exists = await fileExists(configFile);
    if (exists) {
      const answer = await rl.question(
        `配置文件已存在：${configFile}\n重新扫码并覆盖？（旧文件备份为 .bak）[y/N] `,
        { signal: abort.signal },
      );
      if (answer.trim().toLowerCase() !== "y") {
        console.log("已取消。");
        return;
      }
    }

    // 日记目录（--dir 跳过提问；默认 ~/ 展开为绝对路径）
    const dirArg = typeof values.dir === "string" && values.dir ? values.dir : undefined;
    const dir = dirArg
      ? path.resolve(expandHome(dirArg))
      : path.resolve(
          expandHome(
            (await rl.question(`日记目录 [${DEFAULT_DIR}]：`, { signal: abort.signal })).trim() ||
              DEFAULT_DIR,
          ),
        );

    console.log("\n正在申请二维码…");
    const result = await createAppByScan(
      nodeHttp,
      {
        onQRCodeReady: ({ url, expireInSeconds }) => {
          const qr = qrTerminal(url);
          const width = qr.split("\n")[0]?.length ?? 0;
          const cols = process.stdout.columns ?? 80;
          console.log("\n用手机飞书扫码确认（确认页也可选择已有应用复用；扫码账号即日记主人）：\n");
          console.log(qr);
          console.log();
          if (width > cols) {
            console.log(
              `（二维码 ${width} 列宽于当前终端 ${cols} 列，若上方折行：放大窗口后重跑 init，或用下方链接）`,
            );
          }
          console.log(`扫码不便？在浏览器打开：\n${url}\n`);
          console.log(
            `等待扫码确认…（约 ${Math.round(expireInSeconds / 60)} 分钟后过期，Ctrl+C 取消）`,
          );
        },
        onStatus: (status) => {
          if (status === "slow_down") console.log("（稍慢，仍在轮询…）");
          if (status === "domain_switched") console.log("（检测到 Lark 租户，已切换域名）");
        },
      },
      abort.signal,
    );

    if (exists) await rename(configFile, `${configFile}.bak`);
    await writeConfigFile(configFile, buildInitConfig(result, dir));

    console.log(`\n✓ 应用创建成功：${result.client_id}`);
    console.log(`✓ 配置已写入 ${configFile}（权限 600）\n`);
    console.log("后续步骤：");
    console.log(`  1. 发布应用（必须，未发布收不到消息）：打开`);
    console.log(`     https://open.feishu.cn/app/${result.client_id}`);
    console.log(`     「应用发布」→「版本管理与发布」→ 创建版本并发布`);
    console.log(`  2. 启动：feishu-diary（读同一配置文件，无需参数）`);
    console.log(`  3. 用飞书给机器人发条消息试试`);
    console.log(`  4. URL hooks（可选）：在配置文件加 "hooks" 字段，格式见 feishu-diary --help`);
    console.log(`  5. 开机自启（可选，macOS launchd）：${DOCS_BASE}/autostart-macos.md`);
  } catch (err) {
    if (err instanceof Error && (err.message === "abort" || err.name === "AbortError")) {
      console.log("\n已取消。");
      process.exitCode = 130;
      return;
    }
    throw err;
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
  }
}
