import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarDate,
  logicalDate,
  sameMinute,
  timeParts,
  weekdayOfDate,
} from "../src/util/time.ts";

const at = (s: string) => Date.parse(s);

test("timeParts 按 Asia/Shanghai 拆字段（与宿主时区无关）", () => {
  const p = timeParts(at("2026-08-31T23:05:00+08:00"));
  assert.equal(p.date, "2026-08-31");
  assert.equal(p.time, "23:05");
  assert.equal(p.weekday, "周一");
});

test("timeParts 接受 UTC 输入并换算到东八区", () => {
  const p = timeParts(at("2026-09-01T01:30:00Z")); // UTC 01:30 = 北京 09:30
  assert.equal(p.date, "2026-09-01");
  assert.equal(p.time, "09:30");
});

test("午夜 0 点归一化（无 24:xx 幽灵值）", () => {
  const p = timeParts(at("2026-09-01T00:01:00+08:00"));
  assert.equal(p.time, "00:01");
  assert.equal(p.hour, 0);
});

test("逻辑日：凌晨 4 点前算前一天，段头时间不受影响", () => {
  assert.equal(logicalDate(at("2026-09-01T03:59:00+08:00")), "2026-08-31");
  assert.equal(logicalDate(at("2026-09-01T04:00:00+08:00")), "2026-09-01");
  assert.equal(logicalDate(at("2026-09-01T03:30:00+08:00")), "2026-08-31");
  assert.equal(calendarDate(at("2026-09-01T03:30:00+08:00")), "2026-09-01");
});

test("逻辑日切换点可配置", () => {
  assert.equal(logicalDate(at("2026-09-01T05:30:00+08:00"), 6), "2026-08-31");
  assert.equal(logicalDate(at("2026-09-01T06:00:00+08:00"), 6), "2026-09-01");
});

test("sameMinute 按东八区分钟比较", () => {
  assert.ok(sameMinute(at("2026-09-01T12:00:20+08:00"), at("2026-09-01T12:00:59+08:00")));
  assert.ok(!sameMinute(at("2026-09-01T12:00:59+08:00"), at("2026-09-01T12:01:00+08:00")));
});

test("weekdayOfDate 输出逻辑日的星期", () => {
  assert.equal(weekdayOfDate("2026-08-31"), "周一");
  assert.equal(weekdayOfDate("2026-08-30"), "周日");
});
