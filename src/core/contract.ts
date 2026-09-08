/**
 * 数据契约（v2，每月一文件，见 DECISIONS D13）。
 *
 * 布局（根目录默认 FeishuDiary/，可在设置中修改）：
 *   FeishuDiary/
 *   ├── 2026/2026-09.md
 *   └── attachments/2026/2026-08-12-2305-a3f1.jpg
 *
 * 文件结构（一个月一个文件，天内一个 ## 日段）：
 *   ---
 *   month: 2026-09
 *   source: feishu-diary
 *   ---
 *
 *   # 2026-09
 *
 *   ## 08-12 周三
 *
 *   **23:05**
 *
 *   正文段落。同一分钟内的多条消息共享一个时间戳段头（作用域为日段内）。
 *
 *   ---
 *   _(今日封存于 23:02)_
 *
 * 关键规则：
 *   - 只追加：程序永不改写历史内容（撤回是唯一例外，删除最后一个块）
 *   - 写入统一走原子读-改-写（vault.process）
 *   - frontmatter 仅创建文件时写入一次
 *   - 附件文件永不删除，撤回只删笔记内引用
 *   - v1 每日一文件的旧数据不做迁移（无存量用户），原地保留为历史数据
 */

export const SOURCE_TAG = "feishu-diary";
export const DEFAULT_ROOT_DIR = "FeishuDiary";
export const ATTACHMENTS_DIR = "attachments";
export const VOICE_PREFIX = "🎤";

import { weekdayOfDate } from "../util/time.ts";

export function frontmatter(month: string): string {
  return ["---", `month: ${month}`, `source: ${SOURCE_TAG}`, "---"].join("\n");
}

/** 新月文件的初始内容（frontmatter + 月份一级标题）。 */
export function newFileContent(month: string): string {
  return `${frontmatter(month)}\n\n# ${month}`;
}

/** 日段标题：## MM-DD 周X（月内唯一锚点，凌晨消息按逻辑日归段）。 */
export function dayHeading(logical: string): string {
  return `## ${logical.slice(5, 10)} ${weekdayOfDate(logical)}`;
}

export const DAY_HEADING_RE = /^## \d{2}-\d{2} 周[一二三四五六日]$/;

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
