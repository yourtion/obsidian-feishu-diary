/**
 * Node fs → StorageAdapter 适配层（CLI 运行时）。
 *
 * process 语义与 Obsidian 版一致：文件不存在时视内容为空字符串并落盘结果；
 * 落盘走同目录 tmp + rename 原子替换（单进程串行写，与「同一应用仅一个
 * 客户端在线」的飞书长连接约束一致）。trash 移入根目录 .trash/——
 * 可恢复、跨平台、零依赖（Obsidian 的 .trash 目录同款语义）。
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomSuffix } from "../util/filename.ts";
import type { StorageAdapter } from "../core/writer.ts";

export class NodeFsVaultAdapter implements StorageAdapter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async process(filePath: string, fn: (content: string) => string): Promise<string> {
    let current = "";
    try {
      current = await readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const next = fn(current);
    await mkdir(path.dirname(filePath), { recursive: true });
    // tmp 与目标同目录保证同分区，rename 原子替换。
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(tmp, next, "utf8");
      await rename(tmp, filePath);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return next;
  }

  async trash(filePath: string): Promise<void> {
    if (!(await this.exists(filePath))) return;
    const trashDir = path.join(this.rootDir, ".trash");
    await mkdir(trashDir, { recursive: true });
    const target = await this.dedupName(trashDir, path.basename(filePath));
    await rename(filePath, target);
  }

  /**
   * 写入二进制附件；同名冲突时插入 4 位随机后缀消解（同分钟两条同名图片）。
   * 返回实际落盘的文件名（basename）。
   */
  async writeBinary(filePath: string, data: ArrayBuffer): Promise<string> {
    let target = filePath;
    if (await this.exists(target)) {
      const dot = target.lastIndexOf(".");
      const suffix = `-${randomSuffix()}`;
      target =
        dot > target.lastIndexOf(path.sep)
          ? `${target.slice(0, dot)}${suffix}${target.slice(dot)}`
          : `${target}${suffix}`;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(data));
    return path.basename(target);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return false;
    }
  }

  /** 目录内同名冲突消解：name.ext → name-xxxx.ext。 */
  private async dedupName(dir: string, name: string): Promise<string> {
    let target = path.join(dir, name);
    while (await this.exists(target)) {
      const dot = name.lastIndexOf(".");
      const suffixed =
        dot > 0
          ? `${name.slice(0, dot)}-${randomSuffix()}${name.slice(dot)}`
          : `${name}-${randomSuffix()}`;
      target = path.join(dir, suffixed);
    }
    return target;
  }
}
