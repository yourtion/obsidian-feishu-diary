/**
 * Obsidian Vault → VaultLike 适配层。
 *
 * process 语义：文件不存在时视内容为空字符串并落盘结果；
 * 路径逐级建目录（Obsidian createFolder 不递归）。
 */
import { normalizePath, TFile, type FileManager, type Vault } from "obsidian";
import type { StorageAdapter } from "../core/writer.ts";
import { randomSuffix } from "../util/filename.ts";

export class ObsidianVaultAdapter implements StorageAdapter {
  private readonly vault: Vault;
  private readonly fileManager: FileManager;

  constructor(vault: Vault, fileManager: FileManager) {
    this.vault = vault;
    this.fileManager = fileManager;
  }

  private async ensureFolders(path: string): Promise<void> {
    const segments = path.split("/").slice(0, -1);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const normalized = normalizePath(current);
      if (!this.vault.getAbstractFileByPath(normalized)) {
        await this.vault.createFolder(normalized);
      }
    }
  }

  async process(path: string, fn: (content: string) => string): Promise<string> {
    const normalized = normalizePath(path);
    let file = this.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      await this.ensureFolders(normalized);
      await this.vault.create(normalized, "");
      file = this.vault.getAbstractFileByPath(normalized);
    }
    if (!(file instanceof TFile)) {
      throw new Error(`vault.process: cannot resolve ${normalized}`);
    }
    return this.vault.process(file, fn);
  }

  async trash(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const file = this.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      // trashFile 尊重用户的删除偏好（系统废纸篓 / .trash 目录）。
      await this.fileManager.trashFile(file);
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
  }

  /**
   * 写入二进制附件；同名冲突时插入 4 位随机后缀消解（同分钟两条同名图片）。
   * 返回实际落盘的文件名（wikilink 用）。
   */
  async writeBinary(path: string, data: ArrayBuffer): Promise<string> {
    const normalized = normalizePath(path);
    let target = normalized;
    if (this.vault.getAbstractFileByPath(target)) {
      const dot = normalized.lastIndexOf(".");
      const suffix = `-${randomSuffix()}`;
      target =
        dot > normalized.lastIndexOf("/")
          ? normalizePath(`${normalized.slice(0, dot)}${suffix}${normalized.slice(dot)}`)
          : normalizePath(`${normalized}${suffix}`);
    }
    await this.ensureFolders(target);
    await this.vault.createBinary(target, data);
    return target.slice(target.lastIndexOf("/") + 1);
  }
}
