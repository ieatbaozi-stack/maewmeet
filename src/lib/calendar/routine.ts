// R14 (ADR 0012 §4–§6, §8): busy แบบ routine — ช่วง "สัปดาห์ถึงสัปดาห์" / "เดือนถึงเดือน" + ขยายเป็นแถวละวันแบบเวลาผนัง
// pure (กฎ 9): ไม่อ่านนาฬิกา — "วันนี้" มาจาก now ที่ผู้เรียก inject · ใช้ได้ทั้งเซิร์ฟเวอร์และ client (สรุป "จะลง N วัน")
//
// กติกา
//  - เก็บวันท้องถิ่นเสมอ: weeks → start = จันทร์ของสัปดาห์ X (WEEK_START), end = อาทิตย์ของสัปดาห์ Y · months → วันที่ 1 ของเดือน A ถึงวันสุดท้ายของเดือน B (รวมปลาย)
//  - เวลาเป็นนาทีจากเที่ยงคืน: start 0–1410, end 30–1440 (ลงตัว 30) · end ≤ start = ข้ามเที่ยงคืน (จบวันถัดไป) · end = 1440 = เที่ยงคืนท้ายวัน (ไม่ข้ามวัน)
//  - occurrence ผูกกับ "วันเริ่ม" d: start = d start, end = (ข้ามคืน ? d+1 : d) end · UTC คำนวณทีละวันจากเวลาผนัง (ไม่ใช่ + k×24 ชม.)
//  - DST gap (เวลาเริ่ม/จบไม่มีจริงในวันใดวันหนึ่ง) → INVALID_LOCAL_TIME ทั้งคำขอ · fold → ครั้งแรก (parseLocalDateTime)
//  - แถวถูกสร้างตั้งแต่วันนี้ (ใน tz ของ routine) เท่านั้น แม้ช่วงเริ่มในอดีต
import { Temporal } from 'temporal-polyfill';
import { CalendarError, failIf, isCalendarError } from './errors';
import { addDays, dayOfWeek, daysBetween, eachDate, startOfWeek, toPlainDate } from './date';
import { assertTimeZone, parseLocalDateTime, parseTimeOfDay, startOfDay, toLocal, todayIn } from './zone';
import { toResult, type BusyInputError, type BusyRow } from './busy';
import { DEFAULT_TZ, MAX_YEAR, MIN_YEAR, MINUTES_PER_DAY, STEP_MINUTES, type DateISO, type EpochMs } from './constants';

export type RoutineRangeKind = 'weeks' | 'months';

/** input จาก client (ADR 0012 §4) — fromWeek/toWeek เป็นวันใดก็ได้ในสัปดาห์ (ปัดเป็นจันทร์เอง) · fromMonth/toMonth = 'YYYY-MM' */
export type RoutineRangeInput =
  | { rangeKind: 'weeks'; fromWeek: DateISO; toWeek: DateISO }
  | { rangeKind: 'months'; fromMonth: string; toMonth: string };

export interface RoutineRange {
  rangeKind: RoutineRangeKind;
  /** วันแรก (รวม) */
  startDate: DateISO;
  /** วันสุดท้าย (รวม) */
  endDate: DateISO;
  /** จำนวนสัปดาห์/เดือนที่ครอบ */
  periods: number;
}

export interface RoutineRangeOptions {
  /** weeks ยาวสุดกี่สัปดาห์ — ไม่ส่ง = ไม่ตรวจ (R14: 26) */
  maxWeeks?: number;
  /** months ยาวสุดกี่เดือน — ไม่ส่ง = ไม่ตรวจ (R14: 6) */
  maxMonths?: number;
}

/** กฎที่เก็บ (ตรงคอลัมน์ busy_routine) */
export interface RoutineRule {
  /** bitmask ISO: bit (d−1) ของ d = 1 (จันทร์) … 7 (อาทิตย์) · 1–127 */
  weekdays: number;
  allDay: boolean;
  /** นาทีจากเที่ยงคืน 0–1410 · null เมื่อ allDay */
  startMin: number | null;
  /** 30–1440 · ≤ startMin = ข้ามเที่ยงคืน · null เมื่อ allDay */
  endMin: number | null;
  startDate: DateISO;
  endDate: DateISO;
  tz: string;
}

export interface ExpandRoutineOptions {
  /** สร้างเฉพาะวัน ≥ fromDate (ปกติ = วันนี้ใน tz ของ routine) */
  fromDate?: DateISO;
  /** วันที่ถูกลบ/แยกไปแล้ว (local_date ของวันเริ่ม) — ไม่สร้างซ้ำ */
  skip?: Iterable<DateISO>;
}

export type RoutineResult<T> = { ok: true; value: T } | { ok: false; error: BusyInputError };

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** 'YYYY-MM' → PlainYearMonth (ปี 2000–2100 → DATE_OUT_OF_RANGE · เดือนผิด → INVALID_DATE) */
function toYearMonth(value: string, field: string): Temporal.PlainYearMonth {
  const m = typeof value === 'string' ? MONTH_RE.exec(value) : null;
  if (!m) throw new CalendarError('INVALID_DATE', field, 'expected YYYY-MM');
  const year = Number(m[1]);
  const month = Number(m[2]);
  failIf(year < MIN_YEAR || year > MAX_YEAR, 'DATE_OUT_OF_RANGE', field, `year ${year}`);
  failIf(month < 1 || month > 12, 'INVALID_DATE', field, value);
  return Temporal.PlainYearMonth.from({ year, month });
}

const monthIndex = (ym: { year: number; month: number }): number => ym.year * 12 + ym.month;

/** วันเริ่มของ "ช่วง" (สัปดาห์ = จันทร์ · เดือน = วันที่ 1) ที่มี date อยู่ — ใช้ปัด `from` ของ PATCH/DELETE */
export function routinePeriodStart(date: DateISO, kind: RoutineRangeKind): DateISO {
  if (kind === 'weeks') return startOfWeek(date);
  return toPlainDate(date).with({ day: 1 }).toString();
}

/** จำนวนสัปดาห์/เดือนที่ [startDate, endDate] ครอบ (นับตามช่วงที่มีวันนั้นอยู่) */
export function routinePeriods(kind: RoutineRangeKind, startDate: DateISO, endDate: DateISO): number {
  if (kind === 'weeks') return daysBetween(startOfWeek(startDate), startOfWeek(endDate)) / 7 + 1;
  const a = toPlainDate(startDate);
  const b = toPlainDate(endDate);
  return monthIndex(b) - monthIndex(a) + 1;
}

/**
 * ช่วงของ routine → วันท้องถิ่น [startDate, endDate] (รวมปลาย) · pure ไม่โยน (Result)
 * ลำดับตรวจ: รูปแบบ+ปี (ทั้งสองปลาย) → ปลาย < ต้น (INVALID_RANGE ที่ฟิลด์ปลาย) → ยาวเกิน (SPAN_TOO_LONG ที่ฟิลด์ปลาย)
 */
export function routineRange(input: RoutineRangeInput, options: RoutineRangeOptions = {}): RoutineResult<RoutineRange> {
  return toResult(() => computeRange(input, options));
}

function computeRange(input: RoutineRangeInput, options: RoutineRangeOptions): RoutineRange {
  if (input.rangeKind === 'weeks') {
    const from = toPlainDate(input.fromWeek, { range: true, field: 'fromWeek' });
    const to = toPlainDate(input.toWeek, { range: true, field: 'toWeek' });
    const startDate = startOfWeek(from.toString());
    const endDate = addDays(startOfWeek(to.toString()), 6);
    failIf(startOfWeek(to.toString()) < startDate, 'INVALID_RANGE', 'toWeek', 'toWeek < fromWeek');
    const periods = routinePeriods('weeks', startDate, endDate);
    if (options.maxWeeks !== undefined) failIf(periods > options.maxWeeks, 'SPAN_TOO_LONG', 'toWeek', `more than ${options.maxWeeks} weeks`);
    return { rangeKind: 'weeks', startDate, endDate, periods };
  }
  if (input.rangeKind === 'months') {
    const from = toYearMonth(input.fromMonth, 'fromMonth');
    const to = toYearMonth(input.toMonth, 'toMonth');
    failIf(monthIndex(to) < monthIndex(from), 'INVALID_RANGE', 'toMonth', 'toMonth < fromMonth');
    const periods = monthIndex(to) - monthIndex(from) + 1;
    if (options.maxMonths !== undefined) failIf(periods > options.maxMonths, 'SPAN_TOO_LONG', 'toMonth', `more than ${options.maxMonths} months`);
    return {
      rangeKind: 'months',
      startDate: from.toPlainDate({ day: 1 }).toString(),
      endDate: to.toPlainDate({ day: to.daysInMonth }).toString(),
      periods,
    };
  }
  throw new CalendarError('INVALID_RANGE', 'rangeKind', 'expected weeks | months');
}

// ───────── วันในสัปดาห์ ─────────

/** [1..7] (ไม่ซ้ำ, ≥ 1 ตัว) → bitmask · ว่าง → WEEKDAYS_REQUIRED · นอก 1–7 / ซ้ำ / ไม่ใช่จำนวนเต็ม → INVALID_WEEKDAYS */
export function weekdaysToMask(days: readonly number[]): number {
  failIf(!Array.isArray(days), 'INVALID_WEEKDAYS', 'weekdays');
  failIf(days.length === 0, 'WEEKDAYS_REQUIRED', 'weekdays');
  let mask = 0;
  for (const d of days) {
    failIf(!Number.isInteger(d) || d < 1 || d > 7, 'INVALID_WEEKDAYS', 'weekdays', String(d));
    const bit = 1 << (d - 1);
    failIf((mask & bit) !== 0, 'INVALID_WEEKDAYS', 'weekdays', `duplicate ${d}`);
    mask |= bit;
  }
  return mask;
}

/** bitmask → [1..7] เรียงจันทร์ → อาทิตย์ */
export function maskToWeekdays(mask: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= 7; d++) if ((mask & (1 << (d - 1))) !== 0) out.push(d);
  return out;
}

const isValidMask = (mask: number): boolean => Number.isInteger(mask) && mask >= 1 && mask <= 127;

// ───────── เวลา ─────────

/**
 * 'HH:mm' สองปลาย → นาที · end รับ "24:00" (= 1440) · end "00:00" = เที่ยงคืนท้ายวัน (= 1440) · ลงตัว 30
 * start == end → INVALID_RANGE (field endTime) · end < start = ข้ามเที่ยงคืน (ถูกต้อง)
 */
export function parseRoutineTimes(startTime: string, endTime: string): { startMin: number; endMin: number } {
  const startMin = parseTimeOfDay(startTime, 'startTime');
  const endMin = endTime === '24:00' ? MINUTES_PER_DAY : parseTimeOfDay(endTime, 'endTime') || MINUTES_PER_DAY;
  failIf(startMin % STEP_MINUTES !== 0, 'TIME_NOT_ON_STEP', 'startTime', startTime);
  failIf(endMin % STEP_MINUTES !== 0, 'TIME_NOT_ON_STEP', 'endTime', endTime);
  failIf(startMin === endMin, 'INVALID_RANGE', 'endTime', 'endTime must differ from startTime');
  return { startMin, endMin };
}

/** นาที → 'HH:mm' (1440 → "24:00") */
export function formatRoutineTime(minute: number): string {
  failIf(!Number.isInteger(minute) || minute < 0 || minute > MINUTES_PER_DAY, 'INVALID_TIME', undefined, String(minute));
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** true = ข้ามเที่ยงคืน (จบวันถัดไป) */
export const isOvernight = (startMin: number, endMin: number): boolean => endMin <= startMin;

// ───────── ขยาย ─────────

/**
 * กฎ → แถวละวัน (BusyRow) เรียงตามวัน · pure ไม่โยน (Result) · 0 แถวไม่ใช่ error ที่นี่ (ผู้เรียกตัดสิน — ดู planRoutine)
 * วันที่สร้าง = d ใน [max(startDate, fromDate), endDate] ที่ bit ของ dayOfWeek(d) ตั้งอยู่ และไม่อยู่ใน skip
 */
export function expandRoutine(rule: RoutineRule, options: ExpandRoutineOptions = {}): RoutineResult<BusyRow[]> {
  return toResult(() => expand(rule, options));
}

function validateRule(rule: RoutineRule): void {
  assertTimeZone(rule.tz);
  toPlainDate(rule.startDate, { range: true, field: 'startDate' });
  toPlainDate(rule.endDate, { range: true, field: 'endDate' });
  failIf(rule.endDate < rule.startDate, 'INVALID_RANGE', 'endDate', 'endDate < startDate');
  failIf(!isValidMask(rule.weekdays), 'INVALID_WEEKDAYS', 'weekdays', String(rule.weekdays));
  if (rule.allDay) {
    failIf(rule.startMin !== null || rule.endMin !== null, 'INVALID_RANGE', 'startTime', 'all-day routine has no time');
    return;
  }
  const s = rule.startMin;
  const e = rule.endMin;
  failIf(s === null || !Number.isInteger(s) || s < 0 || s >= MINUTES_PER_DAY, 'INVALID_TIME', 'startTime');
  failIf(e === null || !Number.isInteger(e) || e < STEP_MINUTES || e > MINUTES_PER_DAY, 'INVALID_TIME', 'endTime');
  failIf(s! % STEP_MINUTES !== 0, 'TIME_NOT_ON_STEP', 'startTime');
  failIf(e! % STEP_MINUTES !== 0, 'TIME_NOT_ON_STEP', 'endTime');
  failIf(s === e, 'INVALID_RANGE', 'endTime', 'endTime must differ from startTime');
}

function expand(rule: RoutineRule, options: ExpandRoutineOptions): BusyRow[] {
  validateRule(rule);
  const tz = rule.tz;
  let from = rule.startDate;
  if (options.fromDate !== undefined) {
    toPlainDate(options.fromDate, { range: true, field: 'fromDate' });
    if (options.fromDate > from) from = options.fromDate;
  }
  const skip = new Set(options.skip ?? []);
  const out: BusyRow[] = [];
  for (const d of eachDate(from, rule.endDate)) {
    if ((rule.weekdays & (1 << (dayOfWeek(d) - 1))) === 0 || skip.has(d)) continue;
    if (rule.allDay) {
      out.push({ allDay: true, startAt: startOfDay(d, tz), endAt: startOfDay(addDays(d, 1), tz), localStartDate: d, localEndDate: d, tz });
      continue;
    }
    const startMin = rule.startMin!;
    const endMin = rule.endMin!;
    const startAt = wallToEpoch(d, startMin, tz, 'startTime');
    const endDay = isOvernight(startMin, endMin) ? addDays(d, 1) : d;
    const endAt = endMin === MINUTES_PER_DAY ? startOfDay(addDays(d, 1), tz) : wallToEpoch(endDay, endMin, tz, 'endTime');
    failIf(endAt <= startAt, 'INVALID_RANGE', 'endTime', 'end must be after start');
    out.push({ allDay: false, startAt, endAt, localStartDate: d, localEndDate: toLocal(endAt - 1, tz).date, tz });
  }
  return out;
}

/** เวลาผนัง → epoch · DST gap = INVALID_LOCAL_TIME (ชี้ฟิลด์เวลา) · fold = ครั้งแรก */
function wallToEpoch(date: DateISO, minute: number, tz: string, field: string): EpochMs {
  try {
    return parseLocalDateTime(date, formatRoutineTime(minute), tz);
  } catch (e) {
    if (isCalendarError(e)) throw new CalendarError(e.code, field, e.message);
    throw e;
  }
}

// ───────── ทั้งคำขอ (POST/PATCH และสรุปฝั่ง client) ─────────

export interface RoutineSpec {
  range: RoutineRangeInput;
  weekdays: readonly number[];
  allDay: boolean;
  /** HH:mm (เมื่อไม่ใช่ allDay) */
  startTime?: string | undefined;
  /** HH:mm หรือ "24:00" (เมื่อไม่ใช่ allDay) */
  endTime?: string | undefined;
  tz?: string | undefined;
}

export interface RoutinePlanOptions {
  now: EpochMs;
  maxWeeks: number;
  maxMonths: number;
  /** end_date ≤ วันนี้ + N เดือน (R14: 12) */
  maxAheadMonths: number;
  /** แทนวันแรกของกฎ (PATCH แบบแยก: start = from ที่ปัดแล้ว) — ช่วง/เพดานความยาวคิดจาก [startDate นี้, ปลายช่วง] */
  startDate?: DateISO;
  skip?: Iterable<DateISO>;
  /** false = 0 แถวไม่เป็น error (PATCH แก้ในที่) · ดีฟอลต์ true */
  requireOccurrence?: boolean;
}

export interface RoutinePlan {
  rangeKind: RoutineRangeKind;
  rule: RoutineRule;
  /** วันนี้ใน tz ของ routine ณ now */
  today: DateISO;
  /** แถวที่จะสร้าง (ตั้งแต่วันนี้) */
  rows: BusyRow[];
}

/**
 * ตรวจ + ขยายทั้งคำขอตามลำดับ ADR 0012 §6: tz → ช่วง (รูปแบบ/ปี/ลำดับ) → ยาวเกิน → ไกลเกิน → จบไปแล้ว → วันในสัปดาห์ → เวลา → ขยาย (DST) → 0 วัน
 * pure ไม่โยน (Result) · เพดานจำนวน routine/แถว ไม่อยู่ที่นี่ (ตัดสินใน SQL คำสั่งเดียว)
 */
export function planRoutine(spec: RoutineSpec, options: RoutinePlanOptions): RoutineResult<RoutinePlan> {
  return toResult(() => plan(spec, options));
}

function plan(spec: RoutineSpec, options: RoutinePlanOptions): RoutinePlan {
  const tz = spec.tz ?? DEFAULT_TZ;
  assertTimeZone(tz);
  const kind = spec.range.rangeKind;
  const endField = kind === 'weeks' ? 'toWeek' : 'toMonth';
  const range = computeRange(spec.range, {});
  let startDate = range.startDate;
  if (options.startDate !== undefined) {
    toPlainDate(options.startDate, { range: true, field: 'from' });
    startDate = options.startDate;
    failIf(range.endDate < startDate, 'INVALID_RANGE', endField, 'range ends before from');
  }
  const endDate = range.endDate;
  const periods = routinePeriods(kind, startDate, endDate);
  const maxPeriods = kind === 'weeks' ? options.maxWeeks : options.maxMonths;
  failIf(periods > maxPeriods, 'SPAN_TOO_LONG', endField, `more than ${maxPeriods} ${kind}`);
  const today = todayIn(tz, options.now);
  const latest = toPlainDate(today).add({ months: options.maxAheadMonths }).toString();
  failIf(endDate > latest, 'TOO_FAR_AHEAD', endField, `after ${latest}`);
  failIf(endDate < today, 'RANGE_ENDED', endField, `ended before ${today}`);
  const weekdays = weekdaysToMask(spec.weekdays);

  let startMin: number | null = null;
  let endMin: number | null = null;
  if (!spec.allDay) {
    if (spec.startTime === undefined) throw new CalendarError('INVALID_TIME', 'startTime', 'required');
    if (spec.endTime === undefined) throw new CalendarError('INVALID_TIME', 'endTime', 'required');
    ({ startMin, endMin } = parseRoutineTimes(spec.startTime, spec.endTime));
  }
  const rule: RoutineRule = { weekdays, allDay: spec.allDay, startMin, endMin, startDate, endDate, tz };
  const rows = expand(rule, { fromDate: today, ...(options.skip ? { skip: options.skip } : {}) });
  if (options.requireOccurrence !== false) failIf(rows.length === 0, 'NO_OCCURRENCE', 'weekdays');
  return { rangeKind: kind, rule, today, rows };
}
