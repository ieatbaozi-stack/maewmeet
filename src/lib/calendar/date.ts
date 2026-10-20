// วันที่ลอย (PlainDate) ล้วน — ไม่ผูก tz · ADR 0004 §5
import { Temporal } from 'temporal-polyfill';
import { CalendarError, failIf } from './errors';
import { MAX_YEAR, MIN_YEAR, WEEK_START, type DateISO } from './constants';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * แปลง 'YYYY-MM-DD' → PlainDate (ปฏิเสธวันที่ไม่มีจริง เช่น 2025-02-29 → INVALID_DATE)
 * `range: true` เพิ่มการตรวจปี 2000–2100 (DATE_OUT_OF_RANGE) — ตรวจก่อนความมีจริงของวันที่
 */
export function toPlainDate(value: DateISO, opts: { range?: boolean; field?: string } = {}): Temporal.PlainDate {
  const m = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!m) throw new CalendarError('INVALID_DATE', opts.field, 'expected YYYY-MM-DD');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (opts.range) failIf(year < MIN_YEAR || year > MAX_YEAR, 'DATE_OUT_OF_RANGE', opts.field, `year ${year}`);
  try {
    return Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' });
  } catch {
    throw new CalendarError('INVALID_DATE', opts.field, value);
  }
}

/** true ถ้าเป็นวันที่ ค.ศ. ที่มีจริงและปีอยู่ใน 2000–2100 */
export function isValidDate(value: unknown): value is DateISO {
  if (typeof value !== 'string') return false;
  try {
    toPlainDate(value, { range: true });
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: DateISO, n: number): DateISO {
  failIf(!Number.isInteger(n), 'INVALID_RANGE', undefined, 'n must be an integer');
  return toPlainDate(date).add({ days: n }).toString();
}

/** -1 | 0 | 1 */
export function compareDates(a: DateISO, b: DateISO): -1 | 0 | 1 {
  return Temporal.PlainDate.compare(toPlainDate(a), toPlainDate(b)) as -1 | 0 | 1;
}

/** จำนวนวันจาก a ถึง b (b − a; ลบได้) */
export function daysBetween(a: DateISO, b: DateISO): number {
  return toPlainDate(a).until(toPlainDate(b), { largestUnit: 'days' }).days;
}

/** ทุกวันตั้งแต่ from ถึง to รวมปลายทั้งสอง · from > to → [] */
export function eachDate(from: DateISO, to: DateISO): DateISO[] {
  const start = toPlainDate(from);
  const end = toPlainDate(to);
  const out: DateISO[] = [];
  for (let d = start; Temporal.PlainDate.compare(d, end) <= 0; d = d.add({ days: 1 })) out.push(d.toString());
  return out;
}

/** วันในสัปดาห์แบบ ISO: 1 = จันทร์ … 7 = อาทิตย์ */
export function dayOfWeek(date: DateISO): number {
  return toPlainDate(date).dayOfWeek;
}

/** วันแรกของสัปดาห์ (จันทร์) ที่มี date อยู่ — ใช้ WEEK_START ไม่อ่านจาก locale */
export function startOfWeek(date: DateISO): DateISO {
  const d = toPlainDate(date);
  const back = (d.dayOfWeek - WEEK_START + 7) % 7;
  return d.subtract({ days: back }).toString();
}

export function daysInMonth(year: number, month: number): number {
  return plainYearMonth(year, month).daysInMonth;
}

/** เลื่อนเดือน (n ลบได้) */
export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  failIf(!Number.isInteger(n), 'INVALID_RANGE', undefined, 'n must be an integer');
  const ym = plainYearMonth(year, month).add({ months: n });
  return { year: ym.year, month: ym.month };
}

function plainYearMonth(year: number, month: number): Temporal.PlainYearMonth {
  failIf(!Number.isInteger(year) || !Number.isInteger(month), 'INVALID_DATE', undefined, 'year/month must be integers');
  failIf(year < MIN_YEAR || year > MAX_YEAR, 'DATE_OUT_OF_RANGE', 'year', `year ${year}`);
  failIf(month < 1 || month > 12, 'INVALID_DATE', 'month', `month ${month}`);
  return Temporal.PlainYearMonth.from({ year, month });
}

/**
 * ตารางเดือนแบบสัปดาห์เต็ม: จันทร์ก่อน/ตรงวันที่ 1 → อาทิตย์หลัง/ตรงวันสุดท้าย
 * `weeks` = 4 | 5 | 6 (ทุกสัปดาห์ครบ 7 วัน) · ช่วงยาว ≤ 42 วัน (อยู่ในเพดาน 62 ของ API)
 */
export function monthGrid(year: number, month: number): { from: DateISO; to: DateISO; weeks: 4 | 5 | 6 } {
  const ym = plainYearMonth(year, month);
  const first = ym.toPlainDate({ day: 1 });
  const last = ym.toPlainDate({ day: ym.daysInMonth });
  const from = startOfWeek(first.toString());
  const to = addDays(startOfWeek(last.toString()), 6);
  const weeks = (daysBetween(from, to) + 1) / 7;
  return { from, to, weeks: weeks as 4 | 5 | 6 };
}
