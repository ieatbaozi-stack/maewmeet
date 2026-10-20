// normalizeBusyInput — กติกา busy_block ตาม ADR 0004 §2 · R3_CONTRACT §2 (U7)
import { Temporal } from 'temporal-polyfill';
import { CalendarError, failIf, isCalendarError, type CalendarErrorCode } from './errors';
import { addDays, toPlainDate } from './date';
import { assertTimeZone, parseLocalDateTime, parseTimeOfDay, startOfDay, toLocal } from './zone';
import { exceedsMaxSpan, isTooFarBack } from './limits';
import { DEFAULT_TZ, STEP_MINUTES, TIMED_MAX_DAYS, type DateISO, type EpochMs } from './constants';

export interface AllDayBusyInput {
  kind: 'all_day';
  /** วันที่ท้องถิ่น ค.ศ. YYYY-MM-DD (วันที่ลอย) */
  startDate: DateISO;
  /** รวมปลาย (end ≥ start) */
  endDate: DateISO;
  tz?: string;
}

export interface TimedBusyInput {
  kind: 'timed';
  startDate: DateISO;
  /** HH:mm ลงตัว 30 นาที */
  startTime: string;
  endDate: DateISO;
  endTime: string;
  tz?: string;
}

export type BusyInput = AllDayBusyInput | TimedBusyInput;

/** ชื่อฟิลด์ตรงกับคอลัมน์ busy_block (src/db/schema.ts) */
export interface BusyRow {
  allDay: boolean;
  startAt: EpochMs;
  endAt: EpochMs;
  localStartDate: DateISO;
  localEndDate: DateISO;
  tz: string;
}

export interface BusyLimitOptions {
  /** ช่วงเดียวครอบได้ไม่เกินกี่วันปฏิทิน (ทั้งสองแบบ) — ไม่ส่ง = ไม่ตรวจ · R3: 366 */
  maxSpanDays?: number;
  /** ลงย้อนหลังได้ไม่เกินกี่วัน (ดู isTooFarBack) — ไม่ส่ง = ไม่ตรวจ · ต้องส่ง now ด้วย · R3: 7 */
  maxBackdateDays?: number;
  /** busy แบบมีเวลายาวสุดกี่วัน (ความยาวจริง ไม่ใช่นับวันปฏิทิน) — ดีฟอลต์ 62 ตาม ADR 0004 §2 · null = ไม่ตรวจ */
  maxTimedDays?: number | null;
}

export interface NormalizeBusyOptions extends BusyLimitOptions {
  /** epoch ms ปัจจุบัน (inject) — จำเป็นเมื่อใช้ maxBackdateDays */
  now?: EpochMs;
}

export interface BusyInputError {
  code: CalendarErrorCode;
  field?: string;
  message: string;
}

export type NormalizeBusyResult = { ok: true; value: BusyRow } | { ok: false; error: BusyInputError };

/**
 * ตรวจ + แปลงอินพุต busy เป็นแถวที่เก็บได้ (ไม่โยน exception — คืน Result)
 *
 * - all_day: แหล่งความจริง = วันที่ลอย start ≤ end (รวมปลาย) · startAt = เที่ยงคืนต้นวันแรก, endAt = เที่ยงคืนหลังวันสุดท้าย ใน tz
 * - timed: ช่วงต่อเนื่องเดียว [start, end) end > start · เวลาลงตัว 30 นาที ·
 *   localEndDate = วันท้องถิ่นของ (end − 1 ms) → จบตรงเที่ยงคืนนับเป็นวันก่อนหน้า
 * - ลำดับตรวจ: kind/tz → รูปแบบวันที่+ปี → รูปแบบเวลา → step 30 → เวลาไม่มีจริง (DST) → ช่วง → เพดาน
 */
export function normalizeBusyInput(input: BusyInput, options: NormalizeBusyOptions = {}): NormalizeBusyResult {
  try {
    return { ok: true, value: normalize(input, options) };
  } catch (e) {
    if (isCalendarError(e)) {
      const error: BusyInputError = { code: e.code, message: e.message };
      if (e.field !== undefined) error.field = e.field;
      return { ok: false, error };
    }
    throw e;
  }
}

function normalize(input: BusyInput, options: NormalizeBusyOptions): BusyRow {
  const tz = input.tz ?? DEFAULT_TZ;
  assertTimeZone(tz);
  if (options.maxBackdateDays !== undefined && options.now === undefined) {
    throw new TypeError('normalizeBusyInput: options.now is required with maxBackdateDays');
  }

  const row = input.kind === 'all_day' ? normalizeAllDay(input, tz) : normalizeTimed(input, tz, options);

  if (options.maxSpanDays !== undefined) {
    failIf(exceedsMaxSpan(row.localStartDate, row.localEndDate, options.maxSpanDays), 'SPAN_TOO_LONG', 'endDate');
  }
  if (options.maxBackdateDays !== undefined && options.now !== undefined) {
    failIf(isTooFarBack(row.localEndDate, options.now, tz, options.maxBackdateDays), 'TOO_FAR_BACK', 'startDate');
  }
  return row;
}

function normalizeAllDay(input: AllDayBusyInput, tz: string): BusyRow {
  const start = toPlainDate(input.startDate, { range: true, field: 'startDate' });
  const end = toPlainDate(input.endDate, { range: true, field: 'endDate' });
  failIf(Temporal.PlainDate.compare(end, start) < 0, 'INVALID_RANGE', 'endDate', 'endDate < startDate');
  const localStartDate = start.toString();
  const localEndDate = end.toString();
  return {
    allDay: true,
    startAt: startOfDay(localStartDate, tz),
    endAt: startOfDay(addDays(localEndDate, 1), tz),
    localStartDate,
    localEndDate,
    tz,
  };
}

function normalizeTimed(input: TimedBusyInput, tz: string, options: NormalizeBusyOptions): BusyRow {
  // รูปแบบ + ปี (ทั้งสองปลายก่อน เพื่อรายงานฟิลด์ที่ผิดให้ตรง)
  toPlainDate(input.startDate, { range: true, field: 'startDate' });
  toPlainDate(input.endDate, { range: true, field: 'endDate' });
  const startMin = parseTimeOfDay(input.startTime, 'startTime');
  const endMin = parseTimeOfDay(input.endTime, 'endTime');
  failIf(startMin % STEP_MINUTES !== 0, 'TIME_NOT_ON_STEP', 'startTime', input.startTime);
  failIf(endMin % STEP_MINUTES !== 0, 'TIME_NOT_ON_STEP', 'endTime', input.endTime);

  const startAt = localToEpoch(input.startDate, input.startTime, tz, 'startTime');
  const endAt = localToEpoch(input.endDate, input.endTime, tz, 'endTime');
  failIf(endAt <= startAt, 'INVALID_RANGE', 'endTime', 'end must be after start');

  const maxTimedDays = options.maxTimedDays === undefined ? TIMED_MAX_DAYS : options.maxTimedDays;
  if (maxTimedDays !== null) {
    failIf(endAt - startAt > maxTimedDays * 86_400_000, 'SPAN_TOO_LONG', 'endDate', `longer than ${maxTimedDays} days`);
  }

  return {
    allDay: false,
    startAt,
    endAt,
    localStartDate: toLocal(startAt, tz).date,
    localEndDate: toLocal(endAt - 1, tz).date,
    tz,
  };
}

function localToEpoch(date: DateISO, time: string, tz: string, field: string): EpochMs {
  try {
    return parseLocalDateTime(date, time, tz);
  } catch (e) {
    if (isCalendarError(e)) throw new CalendarError(e.code, field, e.message);
    throw e;
  }
}

