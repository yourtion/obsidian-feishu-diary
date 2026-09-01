import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_REMINDER_STATE, decideReminder } from "../src/core/reminder.ts";

const at = (s: string) => ({ today: s, hasTodayEntry: false });
const logged = (s: string) => ({ today: s, hasTodayEntry: true });

test("当天没记且没提过 → 提醒并计数", () => {
  const d = decideReminder(DEFAULT_REMINDER_STATE, at("2026-09-01"));
  assert.equal(d.remind, true);
  assert.deepEqual(d.state, { lastRemindDate: "2026-09-01", missStreak: 1 });
});

test("当天已记 → 不提且清零计数", () => {
  const state = { lastRemindDate: "2026-08-30", missStreak: 2 };
  const d = decideReminder(state, logged("2026-09-01"));
  assert.equal(d.remind, false);
  assert.equal(d.state.missStreak, 0);
});

test("同一天已提过 → 不重复提", () => {
  const state = { lastRemindDate: "2026-09-01", missStreak: 1 };
  const d = decideReminder(state, at("2026-09-01"));
  assert.equal(d.remind, false);
  assert.equal(d.state, state); // 原样返回，不产生新状态
});

test("连续 3 天未响应 → 沉默", () => {
  const state = { lastRemindDate: "2026-08-31", missStreak: 3 };
  const d = decideReminder(state, at("2026-09-01"));
  assert.equal(d.remind, false);
  assert.deepEqual(d.state, state);
});

test("沉默后用户记日记 → 计数清零恢复提醒", () => {
  const silent = { lastRemindDate: "2026-09-01", missStreak: 3 };
  const reset = decideReminder(silent, logged("2026-09-02"));
  assert.equal(reset.remind, false);
  assert.equal(reset.state.missStreak, 0);
  const next = decideReminder(reset.state, at("2026-09-03"));
  assert.equal(next.remind, true);
  assert.equal(next.state.missStreak, 1);
});

test("提过但没记 → 次日继续提、计数递增", () => {
  const day1 = decideReminder(DEFAULT_REMINDER_STATE, at("2026-09-01"));
  const day2 = decideReminder(day1.state, at("2026-09-02"));
  assert.equal(day2.remind, true);
  assert.equal(day2.state.missStreak, 2);
  const day3 = decideReminder(day2.state, at("2026-09-03"));
  assert.equal(day3.state.missStreak, 3);
  // 第 4 天起沉默
  const day4 = decideReminder(day3.state, at("2026-09-04"));
  assert.equal(day4.remind, false);
});
