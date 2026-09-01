/**
 * 意图识别——把用户发给 bot 的文本映射为结构化意图。
 *
 * 设计规则（复刻原项目踩坑经验，词表与文案为本项目独立编写）：
 *   - 命令词精确匹配整条消息，不做前缀/包含匹配（避免长句误触）
 *   - 长度闸门：超过闸门的长消息一律视为正文
 *   - 「记：」是防误吞逃生口：冒号后的内容强制落库，绝不判为命令
 *   - 空白消息忽略
 */

export type Intent =
  | { kind: "ignore" }
  | { kind: "note"; text: string }
  | { kind: "forced-note"; text: string }
  | { kind: "recall" }
  | { kind: "seal" }
  | { kind: "ping" }
  | { kind: "help" }
  | { kind: "callme"; name: string };

/** 精确匹配命令词表（整条消息 === 词）。 */
const EXACT_COMMANDS: ReadonlyArray<{ words: readonly string[]; intent: Intent }> = [
  { words: ["撤回", "撤销"], intent: { kind: "recall" } },
  { words: ["结束", "晚安", "睡了", "收工"], intent: { kind: "seal" } },
  { words: ["在吗", "在么", "在不"], intent: { kind: "ping" } },
  { words: ["帮助", "help", "？", "?"], intent: { kind: "help" } },
];

/** 命令只可能出现在很短的消息里；超过该长度直接按正文处理。 */
const MAX_COMMAND_LENGTH = 8;

/** 「记：」逃生口支持全角/半角冒号。 */
const FORCED_NOTE_RE = /^记[:：]\s*(.*)$/s;

/** 「叫我XX」设置称呼，名字长度限制防止滥用。 */
const CALLME_RE = /^叫我\s*(.{1,16})$/;

export function classify(raw: string): Intent {
  const text = raw.trim();
  if (text.length === 0) return { kind: "ignore" };

  const forced = FORCED_NOTE_RE.exec(text);
  if (forced) {
    const body = forced[1]?.trim() ?? "";
    if (body.length > 0) return { kind: "forced-note", text: body };
  }

  const callme = CALLME_RE.exec(text);
  if (callme) {
    const name = callme[1]?.trim() ?? "";
    if (name.length > 0 && name.length <= 16) return { kind: "callme", name };
  }

  if (text.length <= MAX_COMMAND_LENGTH) {
    for (const entry of EXACT_COMMANDS) {
      if (entry.words.includes(text)) return entry.intent;
    }
  }

  return { kind: "note", text };
}
