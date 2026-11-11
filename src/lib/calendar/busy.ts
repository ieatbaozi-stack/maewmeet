// normalizeBusyInput — กติกา busy_block ตาม ADR 0004 §2 · R3_CONTRACT §2 (U7)
import { Temporal } from 'temporal-polyfill';
import { CalendarError, failIf, isCalendarError, type CalendarErrorCode } from './errors';
import { addDays, eachDate, toPlainDate } from './date';
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

/** R6F (ADR 0010 §2): ชุดรายวัน — ทุกวัน d ใน [startDate, endDate] (รวมปลาย) ได้ช่วง [d startTime, d endTime) หนึ่งแถว */
export interface DailyBusyInput {
  kind: 'daily';
  /** วันแรก/วันสุดท้ายของช่วง (รวมปลาย) */
  startDate: DateISO;
  endDate: DateISO;
  /** HH:mm ลงตัว 30 นาที · endTime > startTime ในวันเดียวกัน (ไม่ข้ามเที่ยงคืน) */
  startTime: string;
  endTime: string;
  tz?: string;
}

export interface DailyBusyOptions {
  /** epoch ms ปัจจุบัน (inject) — จำเป็นเมื่อใช้ maxBackdateDays */
  now?: EpochMs;
  /** จำนวนวันปฏิทินสูงสุดของช่วง (R6F: BUSY_MAX_TIMED_DAYS = 62) — ไม่ส่ง = ไม่ตรวจ */
  maxDays?: number;
  /** ลงย้อนหลังได้ไม่เกินกี่วัน ตัดสินจากวันแรกของชุด (R6F: 7) — ไม่ส่ง = ไม่ตรวจ · ต้องส่ง now ด้วย */
  maxBackdateDays?: number;
}

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
export type ExpandDailyBusyResult = { ok: true; value: BusyRow[] } | { ok: false; error: BusyInputError };

/** CalendarError → Result (ข้อผิดพลาดอื่น เช่น TypeError ของผู้เรียก โยนต่อ) — routine.ts ใช้ด้วย */
export function toResult<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: BusyInputError } {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (isCalendarError(e)) {
      const error: BusyInputError = { code: e.code, message: e.message };
      if (e.field !== undefined) error.field = e.field;
      return { ok: false, error };
    }
    throw e;
  }
}

/**
 * ตรวจ + แปลงอินพุต busy เป็นแถวที่เก็บได้ (ไม่โยน exception — คืน Result)
 *
 * - all_day: แหล่งความจริง = วันที่ลอย start ≤ end (รวมปลาย) · startAt = เที่ยงคืนต้นวันแรก, endAt = เที่ยงคืนหลังวันสุดท้าย ใน tz
 * - timed: ช่วงต่อเนื่องเดียว [start, end) end > start · เวลาลงตัว 30 นาที ·
 *   localEndDate = วันท้องถิ่นของ (end − 1 ms) → จบตรงเที่ยงคืนนับเป็นวันก่อนหน้า
 * - ลำดับตรวจ: kind/tz → รูปแบบวันที่+ปี → รูปแบบเวลา → step 30 → เวลาไม่มีจริง (DST) → ช่วง → เพดาน
 */
export function normalizeBusyInput(input: BusyInput, options: NormalizeBusyOptions = {}): NormalizeBusyResult {
  return toResult(() => normalize(input, options));
}

/**
 * R6F (ADR 0010 §2): ตรวจ + ขยายชุดรายวันเป็นแถวละวัน (ไม่โยน — คืน Result แบบเดียวกับ normalizeBusyInput) · pure ใช้ได้ทั้งเซิร์ฟเวอร์และ client
 * ลำดับตรวจ (= ลำดับรายงาน error): tz → วันที่ (รูปแบบ+ปี) → endDate < startDate → เวลา (รูปแบบ, step 30) → endTime ≤ startTime →
 * จำนวนวัน > maxDays → วันแรกย้อนหลังเกิน → แปลงทีละวัน (DST gap = INVALID_LOCAL_TIME ทั้งคำขอ · fold = ครั้งแรก)
 * UTC คำนวณ **ทีละวันจากเวลาผนัง** (ไม่ใช่วันแรก + k×24 ชม.) → ข้ามวันเปลี่ยนเวลาแล้ว 17:00 ยังเป็น 17:00 ท้องถิ่น
 * ผลเรียงตามวัน (= startAt) · localStartDate = d · localEndDate = วันของ (endAt − 1 ms) สูตรเดียวกับ timed (ไม่ข้ามเที่ยงคืน จึง = d)
 */
export function expandDailyBusyInput(input: DailyBusyInput, options: DailyBusyOptions = {}): ExpandDailyBusyResult {
  return toResult(() => expandDaily(input, options));
}

function expandDaily(input: DailyBusyInput, options: DailyBusyOptions): BusyRow[] {
  const tz = input.tz ?? DEFAULT_TZ;
  assertTimeZone(tz);
  if (options.maxBackdateDays !== undefined && options.now === undefined) {
    throw new TypeError('expandDailyBusyInput: options.now is required with maxBackdateDays');
  }
  const start = toPlainDate(input.startDate, { range: true, field: 'startDate' });
  const end = toPlainDate(input.endDate, { range: true, field: 'endDate' });
  failIf(Temporal.PlainDate.compare(end, start) < 0, 'INVALID_RANGE', 'endDate', 'endDate < startDate');
  const startMin = parseTimeOfDay(input.startTime, 'startTime');
  const endMin = parseTimeOfDay(input.endTime, 'endTime');
  failIf(startMin % STEP_MINUTES !== 0, 'TIME_NOT_ON_STEP', 'startTime', input.startTime);
  failIf(endMin % STEP_MINUTES !== 0, 'TIME_NOT_ON_STEP', 'endTime', input.endTime);
  failIf(endMin <= startMin, 'INVALID_RANGE', 'endTime', 'endTime must be after startTime (same day)');

  const startDate = start.toString();
  const endDate = end.toString();
  if (options.maxDays !== undefined) {
    failIf(exceedsMaxSpan(startDate, endDate, options.maxDays), 'SPAN_TOO_LONG', 'endDate', `more than ${options.maxDays} days`);
  }
  if (options.maxBackdateDays !== undefined && options.now !== undefined) {
    // แถววันแรกคือแถวที่เก่าที่สุด (localEndDate = startDate) — แถวนั้นผิด = ผิดทั้งชุด
    failIf(isTooFarBack(startDate, options.now, tz, options.maxBackdateDays), 'TOO_FAR_BACK', 'startDate');
  }

  return eachDate(startDate, endDate).map((d) => {
    const startAt = localToEpoch(d, input.startTime, tz, 'startTime');
    const endAt = localToEpoch(d, input.endTime, tz, 'endTime');
    failIf(endAt <= startAt, 'INVALID_RANGE', 'endTime', 'end must be after start');
    return { allDay: false, startAt, endAt, localStartDate: d, localEndDate: toLocal(endAt - 1, tz).date, tz };
  });
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

