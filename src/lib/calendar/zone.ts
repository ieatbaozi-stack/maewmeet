// แปลงระหว่างเวลาท้องถิ่น (วัน + นาที) ↔ instant (epoch ms UTC) · ADR 0004 §5
import { Temporal } from 'temporal-polyfill';
import { CalendarError, failIf } from './errors';
import { daysBetween, toPlainDate } from './date';
import { MINUTES_PER_DAY, type DateISO, type EpochMs } from './constants';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

let supported: Set<string> | undefined;
const validTz = new Map<string, boolean>();

/** true ถ้าเป็นชื่อ IANA ที่ใช้ได้ (ตัวพิมพ์ตรง, ไม่รับรูปแบบ offset เช่น +07:00) */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  const cached = validTz.get(tz);
  if (cached !== undefined) return cached;
  supported ??= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  let ok = supported.has(tz);
  if (!ok && !/^[+-]/.test(tz)) {
    try {
      ok = Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(tz).timeZoneId === tz;
    } catch {
      ok = false;
    }
  }
  validTz.set(tz, ok);
  return ok;
}

export function assertTimeZone(tz: string, field = 'tz'): void {
  if (!isValidTimeZone(tz)) throw new CalendarError('INVALID_TZ', field, String(tz));
}

/** 'HH:mm' → นาทีนับจากเที่ยงคืน (0..1439) · รูปแบบผิด → INVALID_TIME */
export function parseTimeOfDay(time: string, field?: string): number {
  const m = typeof time === 'string' ? TIME_RE.exec(time) : null;
  if (!m) throw new CalendarError('INVALID_TIME', field, 'expected HH:mm');
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * วัน + เวลาท้องถิ่น + tz → epoch ms
 * - เวลาที่ไม่มีจริง (DST gap) → INVALID_LOCAL_TIME
 * - เวลาที่เกิดสองครั้ง (DST fold) → ใช้ครั้งแรก (earlier) ไม่ปฏิเสธ
 * - ปีต้องอยู่ 2000–2100 (DATE_OUT_OF_RANGE)
 */
export function parseLocalDateTime(dateISO: DateISO, timeHHmm: string, tz: string): EpochMs {
  const date = toPlainDate(dateISO, { range: true, field: 'date' });
  const minute = parseTimeOfDay(timeHHmm, 'time');
  assertTimeZone(tz);
  const dt = date.toPlainDateTime({ hour: Math.floor(minute / 60), minute: minute % 60 });
  try {
    return dt.toZonedDateTime(tz, { disambiguation: 'reject' }).epochMilliseconds;
  } catch {
    // reject ปฏิเสธทั้ง gap และ fold: แยกด้วยการดูว่า 'earlier' ยังได้เวลาผนังเดิมหรือไม่
    const earlier = dt.toZonedDateTime(tz, { disambiguation: 'earlier' });
    if (earlier.toPlainDateTime().equals(dt)) return earlier.epochMilliseconds;
    throw new CalendarError('INVALID_LOCAL_TIME', 'time', `${dateISO} ${timeHHmm} ${tz}`);
  }
}

/** epoch ms → วันท้องถิ่น + นาทีนับจากเที่ยงคืน (0..1439, ปัดเศษวินาทีทิ้ง) */
export function toLocal(epochMs: EpochMs, tz: string): { date: DateISO; minute: number } {
  failIf(!Number.isFinite(epochMs), 'INVALID_RANGE', undefined, 'epochMs must be finite');
  assertTimeZone(tz);
  const z = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(tz);
  return { date: z.toPlainDate().toString(), minute: z.hour * 60 + z.minute };
}

/** เที่ยงคืนต้นวัน (startOfDay จริง — รองรับ tz ที่วันเริ่มไม่ใช่ 00:00) */
export function startOfDay(dateISO: DateISO, tz: string): EpochMs {
  assertTimeZone(tz);
  return toPlainDate(dateISO).toZonedDateTime({ timeZone: tz }).epochMilliseconds;
}

/**
 * หน้าต่าง [start, end) ของวัน date ระหว่างนาที startMin..endMin ตามเวลาผนังใน tz
 * (endMin = 1440 = เที่ยงคืนถัดไป) · เวลาผนังที่ตกใน DST gap เลื่อนไปข้างหน้า (ไม่ปฏิเสธ)
 * ต้อง 0 ≤ startMin < endMin ≤ 1440 มิฉะนั้น INVALID_RANGE
 */
export function dayWindow(dateISO: DateISO, startMin: number, endMin: number, tz: string): [EpochMs, EpochMs] {
  failIf(
    !Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > MINUTES_PER_DAY || startMin >= endMin,
    'INVALID_RANGE',
    undefined,
    `window ${startMin}..${endMin}`,
  );
  assertTimeZone(tz);
  const date = toPlainDate(dateISO);
  return [wallToEpoch(date, startMin, tz), wallToEpoch(date, endMin, tz)];
}

function wallToEpoch(date: Temporal.PlainDate, minute: number, tz: string): EpochMs {
  if (minute === 0) return date.toZonedDateTime({ timeZone: tz }).epochMilliseconds;
  if (minute === MINUTES_PER_DAY) return date.add({ days: 1 }).toZonedDateTime({ timeZone: tz }).epochMilliseconds;
  return date
    .toPlainDateTime({ hour: Math.floor(minute / 60), minute: minute % 60 })
    .toZonedDateTime(tz, { disambiguation: 'compatible' }).epochMilliseconds;
}

/** วันนี้ใน tz ณ เวลา nowMs (inject เสมอ — lib ไม่อ่านนาฬิกาเอง) */
export function todayIn(tz: string, nowMs: EpochMs): DateISO {
  return toLocal(nowMs, tz).date;
}

/** "อีกกี่วัน" เป็นวันปฏิทินใน tz ของนัด (U11) — วันนี้ = 0, พรุ่งนี้ = 1, ผ่านไปแล้วเป็นลบ */
export function daysUntil(nowMs: EpochMs, startAtMs: EpochMs, tz: string): number {
  return daysBetween(todayIn(tz, nowMs), toLocal(startAtMs, tz).date);
}
