/**
 * Obsidian Vault → VaultLike 适配层。
 *
 * process 语义：文件不存在时视内容为空字符串并落盘结果；
 * 路径逐级建目录（Obsidian createFolder 不递归）。
 */
import { normalizePath, TFile, type Vault } from "obsidian";
import type { VaultLike } from "../core/writer.ts";

export class ObsidianVaultAdapter implements VaultLike {
  constructor(private readonly vault: Vault) {}

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
      await this.vault.trash(file, true);
    }
  }
}
