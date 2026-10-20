// อัลกอริทึมหาวันว่างร่วม — ADR 0005 §1–2, §4 · R4A_CONTRACT §2
// pure: รับ array เข้า คืนค่าออก · ไม่แตะ DB/HTTP/นาฬิกา · ไม่กรองรายละเอียดตาม ADR 0006 (หน้าที่ของ serializer ฝั่ง Platform)
import { failIf } from './errors';
import { compareDates, daysBetween, eachDate, toPlainDate } from './date';
import { assertTimeZone, dayWindow, toLocal } from './zone';
import { MINUTES_PER_DAY, type DateISO, type EpochMs } from './constants';

/** เพดานช่วงวันที่ของ commonFreeTime (รวมปลายทั้งสอง) — ADR 0005 */
export const FREE_TIME_MAX_RANGE_DAYS = 62;

const MINUTE_MS = 60_000;

/** การตั้งค่าหน้าต่างวันของกลุ่ม (ตีความใน tz ของกลุ่ม) */
export interface GroupWindow {
  tz: string;
  /** นาทีนับจากเที่ยงคืน 0..1439 */
  winStartMin: number;
  /** 1..1440 (1440 = เที่ยงคืนถัดไป) */
  winEndMin: number;
  /** ช่วงว่างขั้นต่ำ (นาที) — ช่วงยาวเท่ากันพอดีนับว่าผ่าน */
  minFreeMin: number;
}

/** busy block ที่ lib ต้องใช้ (ตรงชื่อคอลัมน์ busy_block) */
export interface BusyInput {
  id: string;
  userId: string;
  allDay: boolean;
  startAt: EpochMs;
  endAt: EpochMs;
  localStartDate: DateISO;
  localEndDate: DateISO;
}

/** ช่วงครึ่งเปิด [start, end) เป็น epoch ms */
export interface Interval {
  start: EpochMs;
  end: EpochMs;
}

export interface FreeSegment {
  startAt: EpochMs;
  endAt: EpochMs;
  /** 'HH:MM' ใน tz กลุ่ม */
  start: string;
  /** 'HH:MM' ใน tz กลุ่ม · เที่ยงคืนถัดไป = '24:00' */
  end: string;
}

/** สมาชิกที่ไม่ว่างในวันนั้น + block ที่ทำให้ติด (ข้อมูลดิบ — ผ่าน serializer ก่อนส่งออกนอกเซิร์ฟเวอร์) */
export interface FreeTimeBlocker {
  userId: string;
  /** all-day ที่ครอบวันนั้น + timed ที่ทับหน้าต่างวัน · ว่างเปล่าได้เมื่อหน้าต่างสั้นกว่าขั้นต่ำเอง (วัน DST) */
  blocks: BusyInput[];
}

export interface FreeDay {
  date: DateISO;
  /** จำนวนสมาชิกที่ "ว่างในวันนั้น" (ADR 0005 §1) */
  freeMembers: number;
  totalMembers: number;
  /** รหัสสมาชิกที่ว่างในวันนั้น (ตามลำดับ members) */
  freeMemberIds: string[];
  /** ว่างร่วม ⇔ มี segments อย่างน้อย 1 ช่วง */
  allFree: boolean;
  segments: FreeSegment[];
  blockers: FreeTimeBlocker[];
}

/** overlap ของช่วงครึ่งเปิด [aStart,aEnd) กับ [bStart,bEnd) — ที่แตะขอบไม่ทับ */
export function overlapsRange(aStart: EpochMs, aEnd: EpochMs, bStart: EpochMs, bEnd: EpochMs): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * หน้าต่าง [w0, w1) − ยูเนียนของ intervals (sweep) · ไม่ต้องเรียง/clip มาก่อน · ช่วงยาวศูนย์/กลับด้านถูกข้าม
 * คืนช่วงว่างทั้งหมด (ยังไม่กรองขั้นต่ำ) เรียงตามเวลา
 */
export function subtract(w0: EpochMs, w1: EpochMs, intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start && i.end > w0 && i.start < w1).sort((a, b) => a.start - b.start);
  const free: Interval[] = [];
  let cur = w0;
  for (const i of sorted) {
    if (i.start > cur) free.push({ start: cur, end: i.start });
    if (i.end > cur) cur = i.end;
    if (cur >= w1) break;
  }
  if (cur < w1) free.push({ start: cur, end: w1 });
  return free;
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function assertWindow(group: GroupWindow): void {
  const { winStartMin: s, winEndMin: e, minFreeMin: m } = group;
  failIf(
    !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > MINUTES_PER_DAY || s >= e,
    'INVALID_RANGE',
    'window',
    `window ${s}..${e}`,
  );
  failIf(!Number.isInteger(m) || m < 1, 'INVALID_RANGE', 'minFree', `minFree ${m}`);
  assertTimeZone(group.tz);
}

/**
 * วันว่างร่วมของกลุ่มตลอด [fromDate, toDate] (รวมปลาย) — ADR 0005 §1–2
 * - members = รหัสสมาชิกปัจจุบัน (ซ้ำถูกตัด) · busy ของคนนอก members ถูกเมินทั้งหมด (T15, T16)
 * - timed ทำงานบน instant ครึ่งเปิดแล้ว clip เข้าหน้าต่าง · ยาวศูนย์/กลับด้านไม่มีผล (T10)
 * - all-day ปิดวัน D ทั้งวันเมื่อ localStartDate ≤ D ≤ localEndDate (วันที่ลอย ไม่แปลง tz)
 * - ช่วงเกิน 62 วัน → CalendarError SPAN_TOO_LONG (field 'to' — เพดานเดียวกับ parseDateRange ของ Platform ที่แปลงเป็น VALIDATION fields.to RANGE_TOO_LARGE) · from > to → INVALID_RANGE
 */
export function commonFreeTime(
  group: GroupWindow,
  members: readonly string[],
  busyBlocks: readonly BusyInput[],
  fromDate: DateISO,
  toDate: DateISO,
): FreeDay[] {
  const from = toPlainDate(fromDate, { range: true, field: 'from' }).toString();
  const to = toPlainDate(toDate, { range: true, field: 'to' }).toString();
  failIf(compareDates(from, to) > 0, 'INVALID_RANGE', 'to', 'from after to');
  failIf(daysBetween(from, to) + 1 > FREE_TIME_MAX_RANGE_DAYS, 'SPAN_TOO_LONG', 'to', `more than ${FREE_TIME_MAX_RANGE_DAYS} days`);
  assertWindow(group);

  const memberIds = [...new Set(members)];
  const memberSet = new Set(memberIds);
  const timedBy = new Map<string, BusyInput[]>();
  const allDayBy = new Map<string, BusyInput[]>();
  for (const id of memberIds) {
    timedBy.set(id, []);
    allDayBy.set(id, []);
  }
  for (const b of busyBlocks) {
    if (!memberSet.has(b.userId)) continue;
    if (b.allDay) allDayBy.get(b.userId)!.push(b);
    else if (b.endAt > b.startAt) timedBy.get(b.userId)!.push(b);
  }

  const minMs = group.minFreeMin * MINUTE_MS;
  const result: FreeDay[] = [];

  for (const date of eachDate(from, to)) {
    const [w0, w1] = dayWindow(date, group.winStartMin, group.winEndMin, group.tz);
    const todays: Interval[] = [];
    const freeIds: string[] = [];
    const blockers: FreeTimeBlocker[] = [];
    let anyAllDay = false;

    for (const id of memberIds) {
      const dayBlocks = allDayBy.get(id)!.filter((b) => b.localStartDate <= date && date <= b.localEndDate);
      const timed = timedBy.get(id)!.filter((b) => overlapsRange(b.startAt, b.endAt, w0, w1));
      const mine: Interval[] = timed.map((b) => ({ start: Math.max(b.startAt, w0), end: Math.min(b.endAt, w1) }));
      for (const i of mine) todays.push(i);
      if (dayBlocks.length > 0) anyAllDay = true;
      const free = dayBlocks.length === 0 && subtract(w0, w1, mine).some((s) => s.end - s.start >= minMs);
      if (free) freeIds.push(id);
      else blockers.push({ userId: id, blocks: [...dayBlocks, ...timed] });
    }

    const segments: FreeSegment[] = anyAllDay
      ? []
      : subtract(w0, w1, todays)
          .filter((s) => s.end - s.start >= minMs)
          .map((s) => ({
            startAt: s.start,
            endAt: s.end,
            start: hhmm(toLocal(s.start, group.tz).minute),
            end: s.end === w1 && group.winEndMin === MINUTES_PER_DAY ? '24:00' : hhmm(toLocal(s.end, group.tz).minute),
          }));

    result.push({
      date,
      freeMembers: freeIds.length,
      totalMembers: memberIds.length,
      freeMemberIds: freeIds,
      allFree: segments.length > 0,
      segments,
      blockers,
    });
  }
  return result;
}

export interface AppointmentBlockedMember {
  userId: string;
  blocks: BusyInput[];
}

/**
 * U10.1 (ADR 0005 §4): สมาชิกที่ไม่ว่างระหว่างนัด [startAt, endAt) —
 * มี timed busy ทับช่วงนัด (ที่แตะขอบไม่ทับ) หรือมี all-day ครอบวันท้องถิ่นใด ๆ (ใน tz) ที่นัดครอบ
 * วันท้องถิ่นของนัด = วันของ startAt ถึงวันของ endAt − 1 ms · คืนตามลำดับ members · คนนอก members ถูกเมิน
 */
export function membersBlockedDuring(
  startAt: EpochMs,
  endAt: EpochMs,
  tz: string,
  members: readonly string[],
  blocks: readonly BusyInput[],
): AppointmentBlockedMember[] {
  failIf(!(endAt > startAt), 'INVALID_RANGE', 'endAt', 'endAt must be after startAt');
  const firstDate = toLocal(startAt, tz).date;
  const lastDate = toLocal(endAt - 1, tz).date;
  const memberIds = [...new Set(members)];
  const memberSet = new Set(memberIds);
  const by = new Map<string, BusyInput[]>();
  for (const b of blocks) {
    if (!memberSet.has(b.userId)) continue;
    const hit = b.allDay
      ? b.localStartDate <= lastDate && b.localEndDate >= firstDate
      : b.endAt > b.startAt && overlapsRange(b.startAt, b.endAt, startAt, endAt);
    if (!hit) continue;
    const list = by.get(b.userId);
    if (list) list.push(b);
    else by.set(b.userId, [b]);
  }
  return memberIds.filter((id) => by.has(id)).map((id) => ({ userId: id, blocks: by.get(id)! }));
}

