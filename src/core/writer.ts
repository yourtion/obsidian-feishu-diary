/**
 * DiaryWriter——把消息块按数据契约写入日记文件。
 *
 * 纯字符串变换拆为独立函数（可直接单测）；文件读写通过 VaultLike 注入，
 * process 语义：原子读-改-写，文件不存在时视内容为空字符串并落盘结果。
 */
import { newFileContent, TIMESTAMP_HEADING_RE, timestampHeading } from "./contract.ts";
import { diaryYearDir, logicalDate, timeParts, weekdayOfDate } from "../util/time.ts";
import type { TimeParts } from "../util/time.ts";

export interface VaultLike {
  process(path: string, fn: (content: string) => string): Promise<string>;
  trash(path: string): Promise<void>;
}

/**
 * 宿主环境的完整存储适配（编排层 service 用）：VaultLike 之上补附件二进制写入
 * 与存在性检查（提醒 tick 检查当天日记）。实现见 feishu/vault-adapter.ts 与
 * node/vault.ts——core 只定义契约，不引入任何运行时。
 */
export interface StorageAdapter extends VaultLike {
  /** 写入二进制附件；同名冲突时插入随机后缀消解，返回实际落盘文件名（basename）。 */
  writeBinary(path: string, data: ArrayBuffer): Promise<string>;
  /** 文件是否存在。 */
  exists(path: string): Promise<boolean>;
}

const SEAL_MARK = "_(今日封存于";

/** 把内容按空行切成块（frontmatter 内部无空行，天然是一整块）。 */
function splitBlocks(content: string): string[] {
  return content.split(/\n{2,}/);
}

function joinBlocks(blocks: string[]): string {
  return blocks.join("\n\n");
}

/** 文件当前活跃段头：自尾向前第一个时间戳段头块。 */
function activeHeading(blocks: string[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block && TIMESTAMP_HEADING_RE.test(block)) return block.slice(2, -2);
  }
  return null;
}

function isSealBlock(block: string): boolean {
  return block.includes(SEAL_MARK);
}

function isSkeletonBlock(block: string): boolean {
  return block.startsWith("---\ndate:") || block.startsWith("# ");
}

function isContentBlock(block: string): boolean {
  return !isSealBlock(block) && !TIMESTAMP_HEADING_RE.test(block) && !isSkeletonBlock(block);
}

/**
 * 追加一个块：同分钟共享段头，否则新起段头。
 * content 为空（新建文件）时先写 frontmatter + 标题。
 */
export function appendBlockToContent(
  content: string,
  block: string,
  time: string,
  logical: string,
): string {
  const base = content.length > 0 ? content : newFileContent(fileParts(logical));
  const trimmed = base.trimEnd();
  const heading = activeHeading(splitBlocks(trimmed));
  if (heading === time) return `${trimmed}\n\n${block}`;
  return `${trimmed}\n\n${timestampHeading(time)}\n\n${block}`;
}

/** 追加封存注脚。已封存（任意位置存在注脚）返回 null，不重复封存。 */
export function sealContent(content: string, time: string): string | null {
  const trimmed = content.trimEnd();
  if (trimmed.includes(SEAL_MARK)) return null;
  return `${trimmed}\n\n---\n_(今日封存于 ${time})_`;
}

export interface RecallResult {
  content: string;
  /** 被删除的块内容；无可撤回时为 null 且 content 原样返回。 */
  removed: string | null;
  /** 撤回后文件只剩骨架（frontmatter+标题），应 trash 整个文件。 */
  empty: boolean;
}

/**
 * 撤回最后一个内容块。
 * - 跳过尾部的封存注脚（注脚保留）
 * - 删除内容块后若已无内容块，孤立段头一并回收
 * - 只剩骨架时标记 empty，由调用方 trash 文件
 */
export function recallLastFromContent(content: string): RecallResult {
  const trimmed = content.trimEnd();
  const blocks = splitBlocks(trimmed);

  let target = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block && isContentBlock(block)) {
      target = i;
      break;
    }
  }
  if (target === -1) return { content, removed: null, empty: false };

  const removed = blocks[target] ?? "";
  const rest = blocks.filter((_, i) => i !== target);
  const cleaned = rest.some((b) => b !== undefined && isContentBlock(b))
    ? rest
    : rest.filter((b) => b === undefined || !TIMESTAMP_HEADING_RE.test(b));
  const remaining = cleaned.filter((b) => b !== undefined && b.length > 0);

  return {
    content: joinBlocks(cleaned),
    removed,
    empty: remaining.every((b) => isSkeletonBlock(b)) && remaining.length > 0,
  };
}

/** 日记文件相对路径：rootDir/YYYY/YYYY-MM-DD.md。 */
export function diaryPath(rootDir: string, logical: string): string {
  return `${rootDir}/${diaryYearDir(logical)}/${logical}.md`;
}

/** frontmatter 反映逻辑日（date/weekday=逻辑日）。 */
function fileParts(logical: string): TimeParts {
  return {
    date: logical,
    year: logical.slice(0, 4),
    time: "",
    hour: 0,
    minute: 0,
    weekday: weekdayOfDate(logical),
  };
}

export class DiaryWriter {
  private readonly vault: VaultLike;
  private readonly rootDir: string;

  constructor(vault: VaultLike, rootDir: string) {
    this.vault = vault;
    this.rootDir = rootDir;
  }

  /** 追加一个消息块；ms 为消息真实时间（段头/逻辑日均按它计算）。 */
  async append(ms: number, block: string): Promise<void> {
    const logical = logicalDate(ms);
    const time = timeParts(ms).time;
    const path = diaryPath(this.rootDir, logical);
    await this.vault.process(path, (content) =>
      appendBlockToContent(content, block, time, logical),
    );
  }

  /** 封存当前逻辑日文件；返回注脚时间，已封存返回 null。 */
  async seal(nowMs: number): Promise<string | null> {
    const logical = logicalDate(nowMs);
    const time = timeParts(nowMs).time;
    const path = diaryPath(this.rootDir, logical);
    let footnote: string | null = null;
    await this.vault.process(path, (content) => {
      const sealed = sealContent(content, time);
      if (sealed === null) return content;
      footnote = time;
      return sealed;
    });
    return footnote;
  }

  /**
   * 撤回当前逻辑日文件的最后一个内容块。
   * 返回被删内容；无可删返回 null。文件撤空后 trash 整个文件。
   */
  async recall(nowMs: number): Promise<string | null> {
    const logical = logicalDate(nowMs);
    const path = diaryPath(this.rootDir, logical);
    let removed: string | null = null;
    let empty = false;
    await this.vault.process(path, (content) => {
      const result = recallLastFromContent(content);
      removed = result.removed;
      empty = result.empty;
      return result.content;
    });
    if (removed !== null && empty) await this.vault.trash(path);
    return removed;
  }
}
