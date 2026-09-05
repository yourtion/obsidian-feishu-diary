/**
 * URL hooks 的 CLI 执行器：hooks.json 加载 + 子进程执行（不进 main.js 产物）。
 *
 * 约定（见 DECISIONS D11）：
 *  - 命令不经 shell 直起（spawn(bin, [...args, url])），URL 追加为最后一个参数——
 *    单 argv 传递，无注入与断词风险；也因此 ~ 与通配符不展开，路径写绝对路径
 *  - stdout（截断至 256KB）由 service 追加进当天日记；stderr 只用于错误回执
 *  - 超时 SIGTERM；非零退出码视为失败（错误含 stderr 摘要）
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { UrlHookRule } from "../core/urls.ts";

export const DEFAULT_HOOK_TIMEOUT_MS = 600_000;
const STDOUT_CAP = 256 * 1024;
const STDERR_CAP = 16 * 1024;

/** 引号感知的空白切分：'...' / "..." 内空格保留；不做转义与变量展开（够用）。 */
export function tokenize(cmd: string): string[] {
  const parts: string[] = [];
  for (const m of cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    parts.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return parts;
}

/**
 * 执行一条 hook 命令：URL 追加为最后一个参数。
 * 成功 resolve stdout（已截断）；失败 reject（启动失败/超时/非零退出，含 stderr 摘要）。
 */
export function runShellHook(cmd: string, url: string, timeoutMs: number): Promise<string> {
  const parts = tokenize(cmd);
  const bin = parts[0];
  if (!bin) return Promise.reject(new Error(`hooks 命令为空：${cmd}`));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...parts.slice(1), url], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (value: string | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`命令超时（${Math.round(timeoutMs / 1000)}s）：${cmd}`));
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (out.length < STDOUT_CAP) out += chunk.toString("utf8").slice(0, STDOUT_CAP - out.length);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (err.length < STDERR_CAP) err += chunk.toString("utf8").slice(0, STDERR_CAP - err.length);
    });
    child.on("error", (e) => finish(new Error(`命令无法启动：${bin}（${e.message}）`)));
    child.on("close", (code) => {
      if (code === 0) finish(out);
      else finish(new Error(`命令退出码 ${code}：${cmd}\n${err.trim()}`));
    });
  });
}

// ---------- hooks.json ----------

export interface LoadedHooks {
  rules: UrlHookRule[];
  timeoutMs: number;
}

/** 解析并校验 hooks.json 文本；任何配置错误抛 Error（信息含修复指引）。 */
export function parseHooksFile(json: string): LoadedHooks {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("hooks.json 不是合法 JSON");
  }
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = obj.hooks;
  if (!Array.isArray(list)) throw new Error('hooks.json 缺少 "hooks" 数组');

  const rules: UrlHookRule[] = [];
  for (const [i, entry] of list.entries()) {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const match = item.match;
    const cmd = item.cmd;
    if (typeof match !== "string" || match.length === 0) {
      throw new Error(`hooks.json 第 ${i + 1} 条缺少非空 match`);
    }
    if (typeof cmd !== "string" || cmd.length === 0) {
      throw new Error(`hooks.json 第 ${i + 1} 条缺少非空 cmd`);
    }
    try {
      rules.push({ match: new RegExp(match), cmd });
    } catch {
      throw new Error(`hooks.json 第 ${i + 1} 条 match 不是合法正则：${match}`);
    }
  }

  const timeoutSec = obj.timeoutSec;
  const timeoutMs = timeoutSec === undefined ? DEFAULT_HOOK_TIMEOUT_MS : Number(timeoutSec) * 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`hooks.json timeoutSec 应为正数（秒），收到：${String(timeoutSec)}`);
  }
  return { rules, timeoutMs };
}

/** 读取 hooks 文件；不存在视为无 hooks（正常路径），其余错误上抛。 */
export async function loadHooks(file: string): Promise<LoadedHooks> {
  let json: string;
  try {
    json = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { rules: [], timeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
    }
    throw err;
  }
  return parseHooksFile(json);
}
