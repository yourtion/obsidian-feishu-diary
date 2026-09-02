/**
 * CLI 配置解析：--env-file 注入的环境 → 参数 > 环境变量 > 默认值。
 *
 * 用户显式给的配置（凭据/目录/提醒开关等）不落盘、每次启动重新解析；
 * 状态文件只存运行时习得的状态（认主/称呼/提醒状态机），与插件 data.json
 * 中同类字段同构。解析写成纯函数（resolveConfig/parseEnvFile）便于单测。
 */
import { parseArgs } from "node:util";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { FeishuDiarySettings } from "../settings.ts";
import { DEFAULT_SETTINGS } from "../settings.ts";
import type { ReminderState } from "../core/reminder.ts";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const USAGE = `用法：feishu-diary [选项]

凭据（必填，参数或环境变量二选一）：
  --app-id <id>            飞书自建应用 App ID（env: FEISHU_APP_ID）
  --app-secret <secret>    飞书自建应用 App Secret（env: FEISHU_APP_SECRET）

存储与状态：
  --dir <path>             日记根目录，默认 ./FeishuDiary（env: FEISHU_DIARY_DIR）
  --state-file <path>      状态文件路径，默认 <dir>/.feishu-diary-state.json
                           （存认主/称呼/提醒状态；点开头，Obsidian 不索引）

可选：
  --owner-open-id <id>     预设主人 open_id（env: FEISHU_OWNER_OPEN_ID）；
                           缺省时第一条消息的发送者自动认主
  --nickname <name>        机器人称呼（也可在聊天里发「叫我XX」）
  --reminder <HH:mm>       提醒时间（东八区），默认 21:30（env: FEISHU_REMINDER_TIME）
  --no-reminder            关闭每日提醒
  --env-file <path>        额外加载 .env 文件（KEY=VALUE，# 注释）
  -h, --help               显示本帮助

示例：
  FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy npx feishu-diary --dir ~/diary
  npx feishu-diary --env-file ./feishu.env --dir ~/diary`;

export interface CliOptions {
  appId: string;
  appSecret: string;
  /** 日记根目录（已解析为绝对路径）。 */
  dir: string;
  /** 状态文件（已解析为绝对路径）。 */
  stateFile: string;
  ownerOpenId: string | null;
  nickname: string;
  reminderEnabled: boolean;
  reminderTime: string;
}

export interface CliResolution {
  help: boolean;
  /** help 为 true 时为 null。 */
  config: CliOptions | null;
}

/** 解析 .env 文本：KEY=VALUE 行，# 注释，成对引号剥壳，值可含 =。 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** 合并解析：args > env > 默认。配置缺失/非法时抛 Error（信息含修复指引）。 */
export function resolveConfig(
  argv: string[],
  env: Record<string, string | undefined>,
): CliResolution {
  const { values } = parseArgs({
    args: argv,
    options: {
      "app-id": { type: "string" },
      "app-secret": { type: "string" },
      dir: { type: "string" },
      "state-file": { type: "string" },
      "owner-open-id": { type: "string" },
      nickname: { type: "string" },
      reminder: { type: "string" },
      "no-reminder": { type: "boolean" },
      "env-file": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) return { help: true, config: null };

  const argValues = values as Record<string, string | boolean | undefined>;
  const arg = (key: string): string | undefined => {
    const v = argValues[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const pick = (key: string, envKey: string): string | undefined =>
    arg(key) ?? nonEmpty(env[envKey]);

  const appId = pick("app-id", "FEISHU_APP_ID");
  const appSecret = pick("app-secret", "FEISHU_APP_SECRET");
  const missing: string[] = [];
  if (!appId) missing.push("--app-id / FEISHU_APP_ID");
  if (!appSecret) missing.push("--app-secret / FEISHU_APP_SECRET");
  if (missing.length > 0) throw new Error(`缺少必填配置：${missing.join("、")}`);

  const dir = path.resolve(pick("dir", "FEISHU_DIARY_DIR") ?? DEFAULT_SETTINGS.rootDir);
  const stateFile = path.resolve(
    pick("state-file", "FEISHU_STATE_FILE") ?? path.join(dir, ".feishu-diary-state.json"),
  );

  const reminderTime = pick("reminder", "FEISHU_REMINDER_TIME") ?? DEFAULT_SETTINGS.reminderTime;
  if (!TIME_RE.test(reminderTime)) {
    throw new Error(`提醒时间格式应为 HH:mm（东八区），收到：${reminderTime}`);
  }
  const reminderEnabled = !(values["no-reminder"] === true || nonEmpty(env["FEISHU_NO_REMINDER"]));

  return {
    help: false,
    config: {
      appId: appId ?? "",
      appSecret: appSecret ?? "",
      dir,
      stateFile,
      ownerOpenId: pick("owner-open-id", "FEISHU_OWNER_OPEN_ID") ?? null,
      nickname: arg("nickname") ?? "",
      reminderEnabled,
      reminderTime,
    },
  };
}

function nonEmpty(v: string | undefined): string | undefined {
  return v !== undefined && v.length > 0 ? v : undefined;
}

// ---------- 状态文件 ----------

/** 状态文件内容：与插件 data.json 中同类字段同构（用户显式配置不写入）。 */
export interface CliState {
  ownerOpenId: string | null;
  nickname: string;
  reminderState: ReminderState;
}

/** 读取状态文件；不存在或损坏时返回 null（按默认状态启动）。 */
export async function loadState(file: string): Promise<Partial<CliState> | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Partial<CliState>;
  } catch {
    return null;
  }
}

/** 原子写状态文件（同目录 tmp + rename）。 */
export async function saveState(file: string, state: CliState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** 由 CLI 配置 + 状态文件合成 service 需要的运行设置。 */
export function buildSettings(
  config: CliOptions,
  state: Partial<CliState> | null,
): FeishuDiarySettings {
  return {
    rootDir: config.dir,
    appId: config.appId,
    ownerOpenId: config.ownerOpenId ?? state?.ownerOpenId ?? null,
    nickname: config.nickname || state?.nickname || "",
    reminderEnabled: config.reminderEnabled,
    reminderTime: config.reminderTime,
    reminderState: state?.reminderState ?? { ...DEFAULT_SETTINGS.reminderState },
  };
}
