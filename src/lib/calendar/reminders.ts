// กำหนดเวลาเตือนก่อนนัด — R10_CONTRACT §1.2 · ADR 0011 §2 · pure: ไม่อ่านนาฬิกา (now มาจากผู้เรียก)
//  - reminder_1d / rsvp_nudge: startAt − 24 ชม. · ถ้าตกช่วงเงียบ 22:00–07:59 (เวลาท้องถิ่นของนัด) เลื่อนไป 08:00 ถัดไป · ต้องเหลือเวลา ≥ 3 ชม.
//  - reminder_1h: startAt − 60 นาที (ไม่มีช่วงเงียบ) · ต้องเหลือเวลา ≥ 15 นาที
//  - scheduledAt > startAt − ระยะเตือน (เทียบก่อนเลื่อนช่วงเงียบ) = สร้าง/เลื่อนกระชั้น → ข้ามชนิดนั้นถาวร
import { addDays } from './date';
import { dayWindow, toLocal } from './zone';
import type { EpochMs } from './constants';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const REMINDER_KINDS = ['appointment.reminder_1d', 'appointment.reminder_1h', 'appointment.rsvp_nudge'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export type ReminderRule = {
  /** ถึงกำหนดก่อนเริ่มนัดเท่าไร (ms) */
  readonly leadMs: number;
  /** ต้องเหลือเวลาก่อนเริ่มอย่างน้อยเท่าไรจึงจะส่ง (ms) */
  readonly minLeadMs: number;
  readonly quietHours: boolean;
};

export const REMINDER_RULES: Readonly<Record<ReminderKind, ReminderRule>> = {
  'appointment.reminder_1d': { leadMs: 24 * HOUR_MS, minLeadMs: 3 * HOUR_MS, quietHours: true },
  'appointment.reminder_1h': { leadMs: 60 * MINUTE_MS, minLeadMs: 15 * MINUTE_MS, quietHours: false },
  'appointment.rsvp_nudge': { leadMs: 24 * HOUR_MS, minLeadMs: 3 * HOUR_MS, quietHours: true },
};

/** ช่วงเงียบเป็นนาทีนับจากเที่ยงคืน: ตั้งแต่ 22:00 ถึงก่อน 08:00 */
export const REMINDER_QUIET_START_MIN = 22 * 60;
export const REMINDER_QUIET_END_MIN = 8 * 60;

/** startAt − ระยะเตือน (ก่อนเลื่อนช่วงเงียบ) */
export function reminderRawDueAt(kind: ReminderKind, startAt: EpochMs): EpochMs {
  return startAt - REMINDER_RULES[kind].leadMs;
}

/** เวลาถึงกำหนดจริงของชนิดนั้น (รวมการเลื่อนออกจากช่วงเงียบ) */
export function reminderDueAt(kind: ReminderKind, startAt: EpochMs, tz: string): EpochMs {
  const raw = reminderRawDueAt(kind, startAt);
  if (!REMINDER_RULES[kind].quietHours) return raw;
  const local = toLocal(raw, tz);
  if (local.minute >= REMINDER_QUIET_END_MIN && local.minute < REMINDER_QUIET_START_MIN) return raw;
  const date = local.minute >= REMINDER_QUIET_START_MIN ? addDays(local.date, 1) : local.date;
  return dayWindow(date, REMINDER_QUIET_END_MIN, REMINDER_QUIET_END_MIN + 1, tz)[0];
}

/** ยังส่งได้ตามเงื่อนไข "เหลือเวลาก่อนเริ่ม" (ใช้ซ้ำตอนส่งจริง: คิวค้าง/ตัวตั้งเวลาพลาดห้ามส่งย้อนหลัง) · เท่ากันพอดี = ส่ง */
export function reminderStillSendable(kind: ReminderKind, startAt: EpochMs, now: EpochMs): boolean {
  return startAt - now >= REMINDER_RULES[kind].minLeadMs;
}

export type ReminderDecision = 'send' | 'not_due' | 'scheduled_too_close' | 'too_late';

export function decideReminder(input: { kind: ReminderKind; startAt: EpochMs; tz: string; scheduledAt: EpochMs; now: EpochMs }): ReminderDecision {
  if (input.scheduledAt > reminderRawDueAt(input.kind, input.startAt)) return 'scheduled_too_close';
  if (input.now < reminderDueAt(input.kind, input.startAt, input.tz)) return 'not_due';
  return reminderStillSendable(input.kind, input.startAt, input.now) ? 'send' : 'too_late';
}
