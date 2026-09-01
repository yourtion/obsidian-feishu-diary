/**
 * 每日提醒决策（纯函数，规则复刻原项目思路）：
 *  - 到点检查（默认 21:30），当天逻辑日还没记才提醒
 *  - 连续 3 次提醒都没有后续记录 → 沉默（用户记日记即重置）
 *  - 同一逻辑日最多提醒一次（错过到点由开机补发，本模块不管时机）
 */

export interface ReminderState {
  /** 上次发提醒的逻辑日（YYYY-MM-DD）。 */
  lastRemindDate: string | null;
  /** 连续提醒未被响应的天数（发出提醒 +1，用户记日记清零）。 */
  missStreak: number;
}

export const DEFAULT_REMINDER_STATE: ReminderState = {
  lastRemindDate: null,
  missStreak: 0,
};

/** 连续未响应达到该值后进入沉默。 */
export const SILENCE_THRESHOLD = 3;

export interface ReminderDecision {
  remind: boolean;
  state: ReminderState;
}

/**
 * 判定是否提醒。
 * today = 当前逻辑日；hasTodayEntry = 当天逻辑日日记文件是否已有内容。
 */
export function decideReminder(
  state: ReminderState,
  opts: { today: string; hasTodayEntry: boolean },
): ReminderDecision {
  if (opts.hasTodayEntry) {
    return { remind: false, state: { lastRemindDate: state.lastRemindDate, missStreak: 0 } };
  }
  if (state.lastRemindDate === opts.today) {
    return { remind: false, state };
  }
  if (state.missStreak >= SILENCE_THRESHOLD) {
    return { remind: false, state };
  }
  return {
    remind: true,
    state: { lastRemindDate: opts.today, missStreak: state.missStreak + 1 },
  };
}
