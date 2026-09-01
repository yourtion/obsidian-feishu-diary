/**
 * 数据契约（v1，feishu-diary 独立目录版）。
 *
 * 布局（根目录默认 FeishuDiary/，可在设置中修改）：
 *   FeishuDiary/
 *   ├── 2026/2026-08-12.md
 *   └── attachments/2026/2026-08-12-2305-a3f1.jpg
 *
 * 文件结构：
 *   ---
 *   date: 2026-08-12
 *   weekday: 周三
 *   source: feishu-diary
 *   ---
 *
 *   # 2026-08-12
 *
 *   **23:05**
 *
 *   正文段落。同一分钟内的多条消息共享一个时间戳段头。
 *
 *   ---
 *   _(今日封存于 23:02)_
 *
 * 关键规则：
 *   - 只追加：程序永不改写历史内容（撤回是唯一例外，删除最后一个块）
 *   - 写入统一走原子读-改-写（vault.process）
 *   - frontmatter 仅创建文件时写入一次
 *   - 附件文件永不删除，撤回只删笔记内引用
 */

export const SOURCE_TAG = "feishu-diary";
export const DEFAULT_ROOT_DIR = "FeishuDiary";
export const ATTACHMENTS_DIR = "attachments";
export const VOICE_PREFIX = "🎤";

import type { TimeParts } from "../util/time.ts";

export function frontmatter(parts: TimeParts): string {
  return [
    "---",
    `date: ${parts.date}`,
    `weekday: ${parts.weekday}`,
    `source: ${SOURCE_TAG}`,
    "---",
  ].join("\n");
}

/** 新日记文件的初始内容（frontmatter + 一级标题）。 */
export function newFileContent(parts: TimeParts): string {
  return `${frontmatter(parts)}\n\n# ${parts.date}`;
}

/** 段头块：**HH:mm**。 */
export function timestampHeading(time: string): string {
  return `**${time}**`;
}

export const TIMESTAMP_HEADING_RE = /^\*\*\d{2}:\d{2}\*\*$/;

/** 封存注脚。 */
export function sealFootnote(time: string): string {
  return `---\n_(今日封存于 ${time})_`;
}

export const SEAL_RE = /^_\(今日封存于 \d{2}:\d{2}\)_$/;
