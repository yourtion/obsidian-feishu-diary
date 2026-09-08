/**
 * DiaryWriter——把消息块按数据契约写入月文件（v2，每月一文件）。
 *
 * 纯字符串变换拆为独立函数（可直接单测）；文件读写通过 VaultLike 注入，
 * process 语义：原子读-改-写，文件不存在时视内容为空字符串并落盘结果。
 * 月文件内每天一个 ## MM-DD 周X 日段，所有变换先定位目标日段再在段内进行
 * （凌晨消息归前一日段，该段未必在文件尾）。
 */
import {
  DAY_HEADING_RE,
  TIMESTAMP_HEADING_RE,
  dayHeading,
  newFileContent,
  sealFootnote,
  timestampHeading,
} from "./contract.ts";
import { diaryYearDir, logicalDate, prevLogicalDate, timeParts } from "../util/time.ts";

export interface VaultLike {
  process(path: string, fn: (content: string) => string): Promise<string>;
  trash(path: string): Promise<void>;
  /** 读文件内容；不存在返回 null（不落盘，区别于 process）。 */
  read(path: string): Promise<string | null>;
}

/** 撤回需要 exists 判断：不存在的文件不 process（process 会把缺失文件落盘为空文件）。 */
interface RecallVault extends VaultLike {
  exists(path: string): Promise<boolean>;
}

/**
 * 宿主环境的完整存储适配（编排层 service 用）：VaultLike 之上补附件二进制写入
 * 与存在性检查。实现见 feishu/vault-adapter.ts 与 node/vault.ts——core 只定义
 * 契约，不引入任何运行时。
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

function isDayHeadingBlock(block: string): boolean {
  return DAY_HEADING_RE.test(block);
}

function isSealBlock(block: string): boolean {
  return block.includes(SEAL_MARK);
}

function isSkeletonBlock(block: string): boolean {
  return block.startsWith("---\nmonth:") || block.startsWith("# ");
}

function isContentBlock(block: string): boolean {
  return (
    !isSealBlock(block) &&
    !TIMESTAMP_HEADING_RE.test(block) &&
    !isSkeletonBlock(block) &&
    !isDayHeadingBlock(block)
  );
}

/** 日段在块列表中的区间；key 为 MM-DD（从日标题提取，供排序与查找）。 */
interface DaySection {
  start: number;
  end: number; // 不含
  key: string;
}

/** 扫出全部日段区间（日段连续到下一个日标题或文件尾）。 */
function daySections(blocks: string[]): DaySection[] {
  const out: DaySection[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block !== undefined && isDayHeadingBlock(block)) {
      let end = i + 1;
      while (end < blocks.length && !isDayHeadingBlock(blocks[end] ?? "")) end++;
      out.push({ start: i, end, key: block.slice(3, 8) });
      i = end;
    } else {
      i++;
    }
  }
  return out;
}

function findSection(blocks: string[], logical: string): DaySection | undefined {
  const key = logical.slice(5, 10);
  return daySections(blocks).find((s) => s.key === key);
}

/** 新日段的插入位置：最后一个更早日段的段尾；无更早日段则插在首个日段前（骨架后）。 */
function insertIndexForDay(blocks: string[], logical: string): number {
  const key = logical.slice(5, 10);
  const sections = daySections(blocks);
  const earlier = sections.filter((s) => s.key < key);
  return earlier.at(-1)?.end ?? sections[0]?.start ?? blocks.length;
}

/** 段体（不含日标题）当前活跃段头：自尾向前第一个时间戳段头块。 */
function activeHeading(body: string[]): string | null {
  for (let i = body.length - 1; i >= 0; i--) {
    const block = body[i];
    if (block !== undefined && TIMESTAMP_HEADING_RE.test(block)) return block.slice(2, -2);
  }
  return null;
}

/**
 * 追加一个块到目标日段：同分钟共享段头，否则新起段头。
 * 日段不存在时按日期序插入（防补推乱序拆段）；content 为空（新建文件）时
 * 先写月骨架。
 */
export function appendBlockToContent(
  content: string,
  block: string,
  time: string,
  logical: string,
): string {
  const base = content.length > 0 ? content : newFileContent(logical.slice(0, 7));
  const blocks = splitBlocks(base.trimEnd());
  const section = findSection(blocks, logical);

  if (!section) {
    blocks.splice(
      insertIndexForDay(blocks, logical),
      0,
      dayHeading(logical),
      timestampHeading(time),
      block,
    );
    return joinBlocks(blocks);
  }
  const body = blocks.slice(section.start + 1, section.end);
  if (activeHeading(body) === time) {
    body.push(block);
  } else {
    body.push(timestampHeading(time), block);
  }
  blocks.splice(section.start + 1, section.end - section.start - 1, ...body);
  return joinBlocks(blocks);
}

/** 封存目标日段：段内已存在注脚返回 null（不重复封存）；段不存在则建段留痕。 */
export function sealContent(content: string, time: string, logical: string): string | null {
  const base = content.length > 0 ? content : newFileContent(logical.slice(0, 7));
  const blocks = splitBlocks(base.trimEnd());
  const section = findSection(blocks, logical);

  if (!section) {
    blocks.splice(insertIndexForDay(blocks, logical), 0, dayHeading(logical), sealFootnote(time));
    return joinBlocks(blocks);
  }
  const body = blocks.slice(section.start + 1, section.end);
  if (body.some((b) => b !== undefined && isSealBlock(b))) return null;
  body.push(sealFootnote(time));
  blocks.splice(section.start + 1, section.end - section.start - 1, ...body);
  return joinBlocks(blocks);
}

export interface RecallResult {
  content: string;
  /** 被删除的块内容；无可撤回时为 null 且 content 原样返回。 */
  removed: string | null;
  /** 撤回后整月只剩骨架（frontmatter+月标题），应 trash 整个文件。 */
  empty: boolean;
}

/**
 * 撤回目标日段的最后一个内容块。
 * - 跳过段尾的封存注脚（注脚保留）
 * - 段内删空（只剩注脚或空）时整个日段一并回收
 * - 全月只剩骨架时标记 empty，由调用方 trash 文件
 */
export function recallLastFromContent(content: string, logical: string): RecallResult {
  const blocks = splitBlocks(content.trimEnd());
  const section = findSection(blocks, logical);
  if (!section) return { content, removed: null, empty: false };

  const body = blocks.slice(section.start + 1, section.end);
  let target = -1;
  for (let i = body.length - 1; i >= 0; i--) {
    const block = body[i];
    if (block !== undefined && isContentBlock(block)) {
      target = i;
      break;
    }
  }
  if (target === -1) return { content, removed: null, empty: false };

  const removed = body[target] ?? "";
  const rest = body.filter((_, i) => i !== target);
  let newBody: string[];
  if (rest.some((b) => b !== undefined && isContentBlock(b))) {
    // 段内还有内容：原样保留（注脚与段头不动）
    newBody = rest;
  } else if (rest.some((b) => b !== undefined && isSealBlock(b))) {
    // 只剩注脚：回收孤立段头，注脚保留（对齐 v1；晚安留痕使 hasEntry 仍为 true）
    newBody = rest.filter((b) => b === undefined || !TIMESTAMP_HEADING_RE.test(b));
  } else {
    // 段体已空：整个日段回收
    newBody = [];
  }
  if (newBody.length === 0) {
    blocks.splice(section.start, section.end - section.start);
  } else {
    blocks.splice(section.start + 1, section.end - section.start - 1, ...newBody);
  }
  const remaining = blocks.filter((b) => b !== undefined && b.length > 0);
  return {
    content: joinBlocks(blocks),
    removed,
    empty: remaining.length > 0 && remaining.every((b) => isSkeletonBlock(b ?? "")),
  };
}

/** 月文件相对路径：rootDir/YYYY/YYYY-MM.md（logical 取年月；月初凌晨自然落上月文件）。 */
export function diaryPath(rootDir: string, logical: string): string {
  return `${rootDir}/${diaryYearDir(logical)}/${logical.slice(0, 7)}.md`;
}

export class DiaryWriter {
  private readonly vault: RecallVault;
  private readonly rootDir: string;

  constructor(vault: RecallVault, rootDir: string) {
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

  /** 封存当前逻辑日；返回注脚时间，今天已封存返回 null。 */
  async seal(nowMs: number): Promise<string | null> {
    const logical = logicalDate(nowMs);
    const time = timeParts(nowMs).time;
    const path = diaryPath(this.rootDir, logical);
    let footnote: string | null = null;
    await this.vault.process(path, (content) => {
      const sealed = sealContent(content, time, logical);
      if (sealed === null) return content;
      footnote = time;
      return sealed;
    });
    return footnote;
  }

  /**
   * 撤回最后一个内容块：先试当前逻辑日，无可删时回退上一个逻辑日
   * （凌晨跨 4 点边界撤回昨晚内容；月初则落到上月月文件）。返回被删内容；
   * 无可删返回 null。整月撤空后 trash 文件。
   */
  async recall(nowMs: number): Promise<string | null> {
    const logical = logicalDate(nowMs);
    return (
      (await this.recallInLogical(logical)) ??
      (await this.recallInLogical(prevLogicalDate(logical)))
    );
  }

  private async recallInLogical(logical: string): Promise<string | null> {
    const path = diaryPath(this.rootDir, logical);
    // 文件不存在直接跳过（process 会把缺失文件落盘为空文件）
    if (!(await this.vault.exists(path))) return null;
    let removed: string | null = null;
    let empty = false;
    await this.vault.process(path, (content) => {
      const result = recallLastFromContent(content, logical);
      removed = result.removed;
      empty = result.empty;
      return result.content;
    });
    if (removed !== null && empty) await this.vault.trash(path);
    return removed;
  }

  /** 该逻辑日是否已有日段（提醒 tick 判断「今天写没写」；封存留痕的段也算）。 */
  async hasEntry(logical: string): Promise<boolean> {
    const content = await this.vault.read(diaryPath(this.rootDir, logical));
    if (content === null) return false;
    return findSection(splitBlocks(content.trimEnd()), logical) !== undefined;
  }
}
