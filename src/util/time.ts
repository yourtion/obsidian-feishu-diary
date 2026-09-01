/**
 * 时间统一入口——全项目禁止绕过本模块直接取 Date 字段。
 *
 * 时区策略：硬编码 Asia/Shanghai（无夏令时，跨天判断恒定）。
 * 所有格式化通过 Intl 完成，不依赖宿主机器时区。
 */

export const TIMEZONE = "Asia/Shanghai";

/** 逻辑日切换点：凌晨 4 点（含）之前算前一天。 */
export const DEFAULT_DAY_START_HOUR = 4;

/** 可注入时钟，测试时替换为固定时间。 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface TimeParts {
  /** YYYY-MM-DD */
  date: string;
  year: string;
  /** HH:mm */
  time: string;
  hour: number;
  minute: number;
  weekday: string;
}

const WEEKDAY_ZH: Record<string, string> = {
  Mon: "周一",
  Tue: "周二",
  Wed: "周三",
  Thu: "周四",
  Fri: "周五",
  Sat: "周六",
  Sun: "周日",
};

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

/** 把毫秒时间戳拆成 Asia/Shanghai 时区的各字段。 */
export function timeParts(ms: number): TimeParts {
  const map = new Map<string, string>();
  for (const part of partsFormatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") map.set(part.type, part.value);
  }
  const year = map.get("year") ?? "";
  const month = map.get("month") ?? "";
  const day = map.get("day") ?? "";
  // 部分 ICU 实现午夜会给出 "24" 点，归一化为 0。
  const hour = Number(map.get("hour") ?? "0") % 24;
  const minute = Number(map.get("minute") ?? "0");
  const weekdayEn = map.get("weekday") ?? "";
  return {
    date: `${year}-${month}-${day}`,
    year,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    hour,
    minute,
    weekday: WEEKDAY_ZH[weekdayEn] ?? weekdayEn,
  };
}

/** 日历日期（Asia/Shanghai），不考虑逻辑日偏移。 */
export function calendarDate(ms: number): string {
  return timeParts(ms).date;
}

/**
 * 逻辑日：dayStartHour 之前算前一天。
 * 例：2026-08-31 03:59（dayStartHour=4）→ 2026-08-30；04:00 → 2026-08-31。
 */
export function logicalDate(ms: number, dayStartHour: number = DEFAULT_DAY_START_HOUR): string {
  const parts = timeParts(ms);
  if (parts.hour < dayStartHour) {
    return calendarDate(ms - 24 * 60 * 60 * 1000);
  }
  return parts.date;
}

/** 日记文件名：YYYY-MM-DD.md（内容为逻辑日）。 */
export function diaryFileName(logical: string): string {
  return `${logical}.md`;
}

/** 日记目录按年分组：YYYY/。 */
export function diaryYearDir(logical: string): string {
  return logical.slice(0, 4);
}

/** 附件文件名前缀：YYYY-MM-DD-HHmm。 */
export function attachmentStamp(ms: number): string {
  const p = timeParts(ms);
  return `${p.date}-${p.time.replace(":", "")}`;
}

/** 两个时间戳是否处于同一分钟（Asia/Shanghai）。 */
export function sameMinute(a: number, b: number): boolean {
  return timeParts(a).time === timeParts(b).time;
}

/** 指定日期（YYYY-MM-DD）的中文星期。取该日正午避免边界漂移。 */
export function weekdayOfDate(dateStr: string): string {
  const ms = Date.parse(`${dateStr}T12:00:00+08:00`);
  return timeParts(ms).weekday;
}
