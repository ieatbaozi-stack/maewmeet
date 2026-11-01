// view-model ล้วนของแท็บปฏิทิน (R3) — ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/calendar-model.test.ts
// วันที่เป็น PlainDate ('YYYY-MM-DD') เสมอ · คำนวณวัน/เวลาผ่าน src/lib/calendar เท่านั้น (ห้าม new Date) · ICU params: docs/design/UX.md §7.5
import {
  MAX_YEAR,
  MIN_YEAR,
  addDays,
  addMonths,
  compareDates,
  daysBetween,
  eachDate,
  format,
  monthGrid,
  spanDays,
  toLocal,
  type CalendarLocale,
  type DateISO,
  type EpochMs,
} from "@/lib/calendar";

// ───────── ชนิดข้อมูล (ตรงกับ GroupCalendarDto / BusyOwnView ของ API — ไม่ import ฝั่งเซิร์ฟเวอร์) ─────────
export interface MemberInfo {
  userId: string;
  displayName: string;
  /** 0–9 */
  colorIndex: number;
  /** 0–9 · อิสระจากสี (R6C) */
  shapeIndex: number;
}

/** รายการ busy ที่เพื่อนเห็น: ไม่มี note · รายการซ่อน/ไม่ได้ใส่ → ไม่มีฟิลด์ title เลย */
export interface SharedBusy {
  id: string;
  userId: string;
  allDay: boolean;
  startAt: EpochMs;
  endAt: EpochMs;
  localStartDate: DateISO;
  localEndDate: DateISO;
  tz: string;
  title?: string;
}

export interface OwnBusy {
  id: string;
  allDay: boolean;
  startAt: EpochMs;
  endAt: EpochMs;
  localStartDate: DateISO;
  localEndDate: DateISO;
  tz: string;
  title: string | null;
  note: string | null;
  hidden: boolean;
}

export interface MessageRef {
  key: string;
  values: Record<string, string | number>;
}

// ───────── ตารางเดือน ─────────
export interface MonthCell {
  date: DateISO;
  day: number;
  outside: boolean;
  today: boolean;
}

export interface MonthModel {
  year: number;
  month: number;
  from: DateISO;
  to: DateISO;
  weeks: 4 | 5 | 6;
  /** weeks × 7 ช่อง เรียงจันทร์ → อาทิตย์ */
  cells: MonthCell[];
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
export const monthStart = (year: number, month: number): DateISO => `${year}-${pad2(month)}-01`;
/** 'YYYY-MM' ของวันที่ */
export const monthKey = (date: DateISO): string => date.slice(0, 7);
export const ymOf = (date: DateISO): { year: number; month: number } => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

export function buildMonth(year: number, month: number, today: DateISO): MonthModel {
  const g = monthGrid(year, month);
  const key = `${year}-${pad2(month)}`;
  const cells = eachDate(g.from, g.to).map((date) => ({
    date,
    day: Number(date.slice(8, 10)),
    outside: monthKey(date) !== key,
    today: date === today,
  }));
  return { year, month, from: g.from, to: g.to, weeks: g.weeks, cells };
}

/** ช่วงที่ขอ API ได้: ตารางเดือนของ 2000-01 / 2100-12 ล้นไปปี 1999/2101 ซึ่ง API ปฏิเสธ → ตัดให้อยู่ใน 2000-01-01..2100-12-31 */
export function fetchRange(from: DateISO, to: DateISO): { from: DateISO; to: DateISO } {
  const lo = `${MIN_YEAR}-01-01`;
  const hi = `${MAX_YEAR}-12-31`;
  return { from: from < lo ? lo : from, to: to > hi ? hi : to };
}

/** ลูกศรในตารางเดือน → วันที่ปลายทาง (null = ไม่ขยับ/ไม่ใช่ลูกศร) */
export function arrowTarget(cells: readonly { date: DateISO }[], current: DateISO, key: string): DateISO | null {
  const delta = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : key === "ArrowUp" ? -7 : key === "ArrowDown" ? 7 : 0;
  if (!delta) return null;
  const i = cells.findIndex((c) => c.date === current);
  if (i < 0) return null;
  return cells[i + delta]?.date ?? null;
}

/** เลื่อนเดือน; ชนขอบปี 2000–2100 → null (ปุ่มปิด) */
export function shiftMonth(year: number, month: number, n: number): { year: number; month: number } | null {
  try {
    return addMonths(year, month, n);
  } catch {
    return null;
  }
}

// ───────── จุดสมาชิกในช่องวัน (UX X23) ─────────
export interface DotLayout {
  /** จำนวนจุดที่วาด */
  shown: number;
  /** N ของ "+N" (0 = ไม่มี) */
  more: number;
  /** "+N" สองหลัก → กว้าง 3 คอลัมน์ */
  wide: boolean;
}

/** n ≤ 8 = จุดครบ · n > 8 = 6 จุด + "+(n−6)" · ถ้า n−6 ≥ 10 = 5 จุด + "+(n−5)" กว้าง */
export function dotLayout(n: number): DotLayout {
  const count = Math.max(0, Math.trunc(n));
  if (count <= 8) return { shown: count, more: 0, wide: false };
  if (count - 6 <= 9) return { shown: 6, more: count - 6, wide: false };
  return { shown: 5, more: count - 5, wide: true };
}

// ───────── ช่วงของรายการ busy ในมุมมองกลุ่ม ─────────
/** ช่วงที่รายการครอบ ในวันท้องถิ่นของกลุ่ม: allDay ใช้วันที่ลอยตรงๆ · timed คำนวณจาก instant ใน tz กลุ่ม */
export interface ItemSpan {
  item: SharedBusy;
  firstDate: DateISO;
  lastDate: DateISO;
  /** นาทีเริ่มในวัน firstDate (0 สำหรับทั้งวัน) */
  startMin: number;
  /** นาทีสิ้นสุดในวัน lastDate (1440 = ปลายวัน) */
  endMin: number;
}

export function spanOf(item: SharedBusy, groupTz: string): ItemSpan {
  if (item.allDay) return { item, firstDate: item.localStartDate, lastDate: item.localEndDate, startMin: 0, endMin: 1440 };
  const s = toLocal(item.startAt, groupTz);
  const e = toLocal(item.endAt, groupTz);
  // จบตรงเที่ยงคืนพอดี = วันสุดท้ายคือวันก่อนหน้า (ตรงกับ localEndDate ฝั่งเซิร์ฟเวอร์)
  const lastDate = e.minute === 0 ? addDays(e.date, -1) : e.date;
  return { item, firstDate: s.date, lastDate, startMin: s.minute, endMin: e.minute === 0 ? 1440 : e.minute };
}

export interface DaySegment {
  item: SharedBusy;
  /** นาทีเริ่ม/จบในวันนั้น 0..1440 */
  from: number;
  to: number;
  /** ต่อมาจากวันก่อน / ต่อไปวันถัดไป (ตัดขอบเรียบด้านนั้นบนแถบ) */
  cutStart: boolean;
  cutEnd: boolean;
  /** ทั้งวัน: วันที่ n จาก total (total = 1 → ไม่แสดง) */
  dayN: number;
  dayTotal: number;
}

export function segmentOn(span: ItemSpan, date: DateISO): DaySegment | null {
  if (date < span.firstDate || date > span.lastDate) return null;
  const { item } = span;
  const first = date === span.firstDate;
  const last = date === span.lastDate;
  return {
    item,
    from: first ? span.startMin : 0,
    to: last ? span.endMin : 1440,
    cutStart: !first,
    cutEnd: !last,
    dayN: item.allDay ? daysBetween(span.firstDate, date) + 1 : 1,
    dayTotal: item.allDay ? spanDays(span.firstDate, span.lastDate) : 1,
  };
}

/** วัน → เซตของ userId ที่ติดวันนั้น (เฉพาะวันในช่วง [from, to]) */
export function busyUsersByDate(spans: readonly ItemSpan[], from: DateISO, to: DateISO): Map<DateISO, Set<string>> {
  const out = new Map<DateISO, Set<string>>();
  for (const sp of spans) {
    const lo = compareDates(sp.firstDate, from) < 0 ? from : sp.firstDate;
    const hi = compareDates(sp.lastDate, to) > 0 ? to : sp.lastDate;
    if (compareDates(lo, hi) > 0) continue;
    for (const d of eachDate(lo, hi)) {
      let set = out.get(d);
      if (!set) out.set(d, (set = new Set()));
      set.add(sp.item.userId);
    }
  }
  return out;
}

// ───────── มุมมองวัน ─────────
export interface DayRow {
  member: MemberInfo;
  segments: DaySegment[];
}

/** แถวต่อสมาชิก (ลำดับตามที่ API ให้: คุณก่อน แล้วตามช่องสี) · segments เรียงตามเวลาเริ่ม */
export function dayRows(members: readonly MemberInfo[], spans: readonly ItemSpan[], date: DateISO): DayRow[] {
  const byUser = new Map<string, DaySegment[]>();
  for (const sp of spans) {
    const seg = segmentOn(sp, date);
    if (!seg) continue;
    const list = byUser.get(sp.item.userId);
    if (list) list.push(seg);
    else byUser.set(sp.item.userId, [seg]);
  }
  return members.map((member) => ({
    member,
    segments: (byUser.get(member.userId) ?? []).sort((a, b) => a.from - b.from || a.to - b.to),
  }));
}

/** ตำแหน่ง/ความกว้างของแถบบนราง 00–24 (เปอร์เซ็นต์ 2 ตำแหน่ง) */
export function stripBox(seg: Pick<DaySegment, "from" | "to">): { start: string; width: string } {
  const pct = (min: number) => `${((Math.max(0, Math.min(1440, min)) / 1440) * 100).toFixed(2)}%`;
  return { start: pct(seg.from), width: pct(seg.to - seg.from) };
}

export const nowPercent = (minute: number): string => `${((Math.max(0, Math.min(1440, minute)) / 1440) * 100).toFixed(2)}%`;

/** นาทีในวัน → 'HH:mm' (1440 → '24:00') */
export function hhmm(min: number): string {
  const m = Math.max(0, Math.min(1440, Math.trunc(min)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** ป้ายเวลาของช่วงในรายการ "ใครไม่ว่างเมื่อไร" (UX 7.5) */
export function segmentLabel(seg: DaySegment): { ref: MessageRef; dayOf: MessageRef | null } {
  if (seg.item.allDay) {
    return {
      ref: { key: "calendar.day.allDay", values: {} },
      dayOf: seg.dayTotal > 1 ? { key: "calendar.day.dayOf", values: { n: seg.dayN, total: seg.dayTotal } } : null,
    };
  }
  if (seg.cutStart && seg.cutEnd) return { ref: { key: "calendar.day.allDay", values: {} }, dayOf: null };
  if (seg.cutStart) return { ref: { key: "calendar.day.fromPrev", values: { end: hhmm(seg.to) } }, dayOf: null };
  if (seg.cutEnd) return { ref: { key: "calendar.day.toNext", values: { start: hhmm(seg.from) } }, dayOf: null };
  return { ref: { key: "calendar.day.range", values: { start: hhmm(seg.from), end: hhmm(seg.to) } }, dayOf: null };
}

/** รายการที่ซ่อน/ไม่ได้ใส่ "ทำอะไร" = ไม่มีฟิลด์ title → "ไม่ว่าง" (ผู้ดูแยกไม่ได้ — UX X28) */
export const segmentTitle = (seg: DaySegment): string | null => (typeof seg.item.title === "string" && seg.item.title !== "" ? seg.item.title : null);

// ───────── ข้อความ "เมื่อไร" ของรายการ (รายการของฉัน + สรุปในฟอร์ม) ─────────
export interface WhenParts {
  allDay: boolean;
  startDate: DateISO;
  endDate: DateISO;
  /** 'HH:mm' (timed เท่านั้น) */
  startTime?: string;
  endTime?: string;
}

const shortDate = (date: DateISO, locale: CalendarLocale): string => format(date, { locale, style: "day-month" });

/** busy.when.* + ค่า ICU — วันที่ format ด้วย lib (พ.ศ. ในภาษาไทย) */
export function whenRef(p: WhenParts, locale: CalendarLocale): MessageRef {
  if (p.allDay) {
    if (p.startDate === p.endDate) return { key: "busy.when.allDay", values: { date: shortDate(p.startDate, locale) } };
    const sameYear = p.startDate.slice(0, 4) === p.endDate.slice(0, 4);
    const f = (d: DateISO) => (sameYear ? shortDate(d, locale) : format(d, { locale, style: "date-medium" }));
    return { key: "busy.when.days", values: { start: f(p.startDate), end: f(p.endDate), count: spanDays(p.startDate, p.endDate) } };
  }
  const start = p.startTime ?? "00:00";
  let end = p.endTime ?? "00:00";
  let endDate = p.endDate;
  // จบตรงเที่ยงคืนของวันถัดไป = "ถึง 24:00" ของวันเดียวกัน
  if (end === "00:00" && endDate === addDays(p.startDate, 1)) {
    end = "24:00";
    endDate = p.startDate;
  }
  if (endDate === p.startDate) return { key: "busy.when.timed", values: { date: shortDate(p.startDate, locale), start, end } };
  return { key: "busy.when.timedSpan", values: { startDate: shortDate(p.startDate, locale), start, endDate: shortDate(endDate, locale), end } };
}

/** รายการของฉัน → ส่วนประกอบของ "เมื่อไร" (เวลาแสดงใน tz ของรายการ) */
export function whenPartsOfOwn(item: OwnBusy): WhenParts {
  if (item.allDay) return { allDay: true, startDate: item.localStartDate, endDate: item.localEndDate };
  const s = toLocal(item.startAt, item.tz);
  const e = toLocal(item.endAt, item.tz);
  return { allDay: false, startDate: s.date, endDate: e.date, startTime: hhmm(s.minute), endTime: hhmm(e.minute) };
}

export interface MineGroup {
  /** 'YYYY-MM-01' ของเดือนที่รายการเริ่ม (ใช้ format เป็นหัวเดือน) */
  month: DateISO;
  items: OwnBusy[];
}

/** เรียงตามเวลาเริ่ม แล้วจัดกลุ่มตามเดือนของวันเริ่ม */
export function groupMineByMonth(items: readonly OwnBusy[]): MineGroup[] {
  const sorted = [...items].sort((a, b) => a.startAt - b.startAt || (a.id < b.id ? -1 : 1));
  const groups: MineGroup[] = [];
  for (const it of sorted) {
    const first = it.allDay ? it.localStartDate : toLocal(it.startAt, it.tz).date;
    const month = monthStart(Number(first.slice(0, 4)), Number(first.slice(5, 7)));
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(it);
    else groups.push({ month, items: [it] });
  }
  return groups;
}

/** กำลังติดอยู่ตอนนี้ (start ≤ now < end) */
export const isOngoing = (item: Pick<OwnBusy, "startAt" | "endAt">, nowMs: EpochMs): boolean => item.startAt <= nowMs && nowMs < item.endAt;

/** ใกล้เต็มเพดานรายการ (≥ 90%) */
export const nearLimit = (count: number, max: number): boolean => max > 0 && count >= Math.ceil(max * 0.9);

/**
 * รวมรายชื่อเป็นประโยค — เขียนเองแทน Intl.ListFormat เพราะ ICU ของ Node (เซิร์ฟเวอร์) กับเบราว์เซอร์ตัวคั่นไม่เหมือนกัน → hydrate ไม่ตรง (React #418)
 * คำเชื่อม `and` มาจากข้อความ (calendar.day.listAnd) · ไทย: "ก ข และค" ไม่ใช้จุลภาค · อังกฤษ: "A, B and C"
 */
export function joinNames(names: readonly string[], and: string, locale: CalendarLocale): string {
  if (names.length <= 1) return names[0] ?? "";
  const head = names.slice(0, -1);
  const last = names[names.length - 1] ?? "";
  // ไทย: "ก ข และค" · ชื่อที่ขึ้นต้นด้วยตัวอักษรไทยติดคำเชื่อม ชื่อละติน/ตัวเลขเว้นวรรค ("และ Cat") — ถ้าไม่เว้น อ่านเป็น "และCat"
  const glue = /^[\u0E00-\u0E7F]/.test(last) ? "" : " ";
  return locale === "th" ? `${head.join(" ")} ${and}${glue}${last}` : `${head.join(", ")} ${and} ${last}`;
}
