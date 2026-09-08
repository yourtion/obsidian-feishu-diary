/**
 * CLI 配置解析：--env-file 注入的环境 → 参数 > 环境变量 > 配置文件（~/.feishu-diary.json，
 * init 的产物，见 D12）> 默认值。
 *
 * 用户显式给的配置不落盘、每次启动重新解析；状态文件只存运行时习得的状态
 * （认主/称呼/提醒状态机），与插件 data.json 中同类字段同构。
 * 解析写成纯函数（resolveConfig/parseEnvFile/readConfigFile）便于单测。
 */
import { parseArgs } from "node:util";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import type { FeishuDiarySettings } from "../settings.ts";
import { DEFAULT_SETTINGS } from "../settings.ts";
import type { ReminderState } from "../core/reminder.ts";
import { parseHooksObject, type LoadedHooks } from "./hooks.ts";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const USAGE = `用法：feishu-diary [init] [选项]

初始化（推荐首次使用）：
  feishu-diary init          扫码一键创建飞书应用（也可在确认页复用已有应用），
                             交互生成配置文件 ~/.feishu-diary.json（含凭据与
                             主人 open_id，权限 600）

凭据（必填，参数 / 环境变量 / 配置文件三选一）：
  --app-id <id>            飞书自建应用 App ID（env: FEISHU_APP_ID）
  --app-secret <secret>    飞书自建应用 App Secret（env: FEISHU_APP_SECRET）
  --config <path>          配置文件路径，默认 ~/.feishu-diary.json
                           （env: FEISHU_DIARY_CONFIG；字段均可被参数/环境变量覆盖）

存储与状态：
  --dir <path>             日记根目录，默认 ./FeishuDiary（env: FEISHU_DIARY_DIR）
  --state-file <path>      状态文件路径，默认 <dir>/.feishu-diary-state.json
                           （存认主/称呼/提醒状态；点开头，Obsidian 不索引）
  --hooks-file <path>      URL hooks 配置文件，默认 <dir>/hooks.json
                           （env: FEISHU_HOOKS_FILE；显式指定时配置文件内联
                           hooks 失效）

可选：
  --owner-open-id <id>     预设主人 open_id（env: FEISHU_OWNER_OPEN_ID）；
                           缺省时第一条消息的发送者自动认主
  --nickname <name>        机器人称呼（也可在聊天里发「叫我XX」）
  --reminder <HH:mm>       提醒时间（东八区），默认 21:30（env: FEISHU_REMINDER_TIME）
  --no-reminder            关闭每日提醒
  --env-file <path>        额外加载 .env 文件（KEY=VALUE，# 注释）
  -h, --help               显示本帮助

配置文件（init 生成；优先级 参数 > 环境变量 > 文件 > 默认）：
  {"appId": "cli_xxx", "appSecret": "xxx", "dir": "/abs/path/FeishuDiary",
   "ownerOpenId": "ou_xxx", "reminderTime": "21:30", "reminderEnabled": true,
   "hooks": {"timeoutSec": 600, "hooks": [{"match": "…", "cmd": "…"}]}}

URL hooks（可选；「链接 → 命令」分流，改后重启生效）：
  hooks 写在配置文件 "hooks" 字段（上例）或独立文件（--hooks-file，默认
  <dir>/hooks.json，文件不存在即未启用）。文本消息里的 URL 命中 match（正则）时：
  原文照常记日记，随后执行 cmd（URL 追加为最后一个参数；不经 shell，~ 不展开，
  路径写绝对路径），stdout 追加进当天日记，非零退出/超时以文字消息回执。如：
    {"match": "https?://[^/]*\\\\.feishu\\\\.cn/", "cmd": "feishu-dl --out /abs/path"}

示例：
  npx feishu-diary init           # 扫码创建应用并生成配置文件
  feishu-diary                    # 读 ~/.feishu-diary.json 直接启动
  FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy npx feishu-diary --dir ~/diary
  npx feishu-diary --env-file ./feishu.env --dir ~/diary

开机自启（macOS launchd）见 docs/autostart-macos.md。`;

export interface CliOptions {
  appId: string;
  appSecret: string;
  /** 日记根目录（已解析为绝对路径）。 */
  dir: string;
  /** 状态文件（已解析为绝对路径）。 */
  stateFile: string;
  /** URL hooks 配置文件（已解析为绝对路径；不存在即未启用）。 */
  hooksFile: string;
  /** 配置文件内联 hooks；非 null 时 hooksFile 不加载（显式 --hooks-file 时为 null）。 */
  hooksInline: LoadedHooks | null;
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

// ---------- 配置文件 ----------

/** 配置文件默认路径：~/.feishu-diary.json（init 的产物，见 node/init.ts）。 */
export function defaultConfigFile(): string {
  return path.join(homedir(), ".feishu-diary.json");
}

/** 配置文件内容（init 生成；全部字段可选，优先级 参数 > 环境变量 > 本文件 > 默认）。 */
export interface FileConfig {
  appId?: string;
  appSecret?: string;
  dir?: string;
  ownerOpenId?: string;
  nickname?: string;
  reminderTime?: string;
  reminderEnabled?: boolean;
  /** URL hooks（结构同 hooks.json）；显式 --hooks-file / FEISHU_HOOKS_FILE 时忽略。 */
  hooks?: unknown;
}

/**
 * 读取配置文件；不存在返回 null（未配置是正常路径）。非法内容抛 Error（含路径）——
 * 文件里有凭据，静默降级到默认值会写错目录，坏配置必须启动即退出。
 */
export async function readConfigFile(file: string): Promise<FileConfig | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`配置文件不是合法 JSON：${file}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`配置文件应为 JSON 对象：${file}`);
  }
  const obj = raw as Record<string, unknown>;
  for (const key of ["appId", "appSecret", "dir", "ownerOpenId", "nickname", "reminderTime"]) {
    const v = obj[key];
    if (v !== undefined && typeof v !== "string") {
      throw new Error(`配置文件 ${key} 应为字符串：${file}`);
    }
  }
  if (obj.reminderEnabled !== undefined && typeof obj.reminderEnabled !== "boolean") {
    throw new Error(`配置文件 reminderEnabled 应为布尔值：${file}`);
  }
  return obj;
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

/** 合并解析：args > env > 配置文件 > 默认。配置缺失/非法时抛 Error（信息含修复指引）。 */
export function resolveConfig(
  argv: string[],
  env: Record<string, string | undefined>,
  file?: FileConfig | null,
): CliResolution {
  const { values } = parseArgs({
    args: argv,
    options: {
      "app-id": { type: "string" },
      "app-secret": { type: "string" },
      config: { type: "string" },
      dir: { type: "string" },
      "state-file": { type: "string" },
      "hooks-file": { type: "string" },
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
  const pick = (key: string, envKey: string, fileVal?: string): string | undefined =>
    arg(key) ?? nonEmpty(env[envKey]) ?? nonEmpty(fileVal);

  const appId = pick("app-id", "FEISHU_APP_ID", file?.appId);
  const appSecret = pick("app-secret", "FEISHU_APP_SECRET", file?.appSecret);
  const missing: string[] = [];
  if (!appId) missing.push("--app-id / FEISHU_APP_ID");
  if (!appSecret) missing.push("--app-secret / FEISHU_APP_SECRET");
  if (missing.length > 0) {
    throw new Error(`缺少必填配置：${missing.join("、")}（可先运行 npx feishu-diary init）`);
  }

  const dir = path.resolve(pick("dir", "FEISHU_DIARY_DIR", file?.dir) ?? DEFAULT_SETTINGS.rootDir);
  const stateFile = path.resolve(
    pick("state-file", "FEISHU_STATE_FILE") ?? path.join(dir, ".feishu-diary-state.json"),
  );
  const hooksFileExplicit = pick("hooks-file", "FEISHU_HOOKS_FILE");
  const hooksFile = path.resolve(hooksFileExplicit ?? path.join(dir, "hooks.json"));

  const reminderTime =
    pick("reminder", "FEISHU_REMINDER_TIME", file?.reminderTime) ?? DEFAULT_SETTINGS.reminderTime;
  if (!TIME_RE.test(reminderTime)) {
    throw new Error(`提醒时间格式应为 HH:mm（东八区），收到：${reminderTime}`);
  }
  const reminderEnabled =
    values["no-reminder"] === true || nonEmpty(env["FEISHU_NO_REMINDER"])
      ? false
      : (file?.reminderEnabled ?? true);

  // 内联 hooks 只在未显式指定 hooks 文件时生效（args/env > 配置文件）
  const hooksInline =
    hooksFileExplicit === undefined && file?.hooks !== undefined
      ? parseHooksObject(file.hooks, "配置文件 hooks 字段")
      : null;

  return {
    help: false,
    config: {
      appId: appId ?? "",
      appSecret: appSecret ?? "",
      dir,
      stateFile,
      hooksFile,
      hooksInline,
      ownerOpenId: pick("owner-open-id", "FEISHU_OWNER_OPEN_ID", file?.ownerOpenId) ?? null,
      nickname: arg("nickname") ?? nonEmpty(file?.nickname) ?? "",
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
  } catch (err) {
    // 文件不存在是正常路径；损坏则大声警告——认主丢失后首条消息会重新抢注
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(
        `[feishu-diary] 状态文件读取失败，按默认状态启动（认主/称呼/提醒进度可能丢失，请检查 ${file}）：`,
        err,
      );
    }
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
