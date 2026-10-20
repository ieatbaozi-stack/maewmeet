// view-model ล้วนของมุมมอง "ว่างตรงกัน" (R4A, UX §8) — ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/availability-model.test.ts
// วัน/เวลาคำนวณผ่าน src/lib/calendar เท่านั้น (ห้าม new Date) · ใช้ตัวช่วยของ R3 ซ้ำ (spanOf/segmentOn/segmentLabel/segmentTitle/fetchRange/joinNames)
import { daysBetween, format, type CalendarLocale, type DateISO, type EpochMs } from "@/lib/calendar";
import {
  segmentLabel,
  segmentOn,
  segmentTitle,
  spanOf,
  type DaySegment,
  type MemberInfo,
  type MessageRef,
  type SharedBusy,
} from "@/components/calendar/model";

export { fetchRange } from "@/components/calendar/model";

// ───────── ชนิดข้อมูล (ตรงกับ GroupAvailabilityDto — ไม่ import ฝั่งเซิร์ฟเวอร์ลง model) ─────────
export interface AvSegment {
  startAt: EpochMs;
  endAt: EpochMs;
  /** 'HH:MM' ใน tz กลุ่ม (ปลายเที่ยงคืน = '24:00') */
  start: string;
  end: string;
}

export interface AvBlocker {
  userId: string;
  items: SharedBusy[];
}

export interface AvDay {
  date: DateISO;
  freeMembers: number;
  totalMembers: number;
  allFree: boolean;
  notFreeUserIds: string[];
  segments: AvSegment[];
  blockers: AvBlocker[];
}

export interface AvGroup {
  id: string;
  tz: string;
  windowStartMin: number;
  windowEndMin: number;
  minFreeMinutes: number;
}

export interface AvData {
  group: AvGroup;
  from: DateISO;
  to: DateISO;
  members: MemberInfo[];
  days: AvDay[];
  truncated: boolean;
}

// ───────── สถานะช่องวัน (UX §8.3 "ลำดับของสถานะช่องวัน") ─────────
export type DayState = "past" | "all" | "none" | "nocommon" | "partial";
/** ระดับพื้นของ partial: < 50% = few (ลายเฉียง) · 50–74% = low · ≥ 75% = mid */
export type PartialLevel = "few" | "low" | "mid";

export interface DayClass {
  state: DayState;
  level: PartialLevel | null;
}

export function partialLevel(free: number, total: number): PartialLevel {
  if (total <= 0) return "few";
  const pct = (free / total) * 100;
  return pct < 50 ? "few" : pct < 75 ? "low" : "mid";
}

/**
 * past (วันที่ < วันนี้) → all (allFree) → none (ว่าง 0) → nocommon (ว่างครบทุกคนแต่ allFree=false = T24) → partial
 * T24 ต้องแยกจาก all เสมอ: 3/3 ไม่ได้แปลว่าว่างร่วม
 */
export function classifyDay(day: Pick<AvDay, "date" | "allFree" | "freeMembers" | "totalMembers">, today: DateISO): DayClass {
  if (day.date < today) return { state: "past", level: null };
  if (day.allFree) return { state: "all", level: null };
  if (day.freeMembers <= 0) return { state: "none", level: null };
  if (day.freeMembers >= day.totalMembers) return { state: "nocommon", level: null };
  return { state: "partial", level: partialLevel(day.freeMembers, day.totalMembers) };
}

/** วันที่แตะเปิดรายละเอียดได้ (วันที่ผ่านแล้ว/ไม่มีข้อมูลกดไม่ได้) */
export const isSelectable = (c: DayClass | null): boolean => c !== null && c.state !== "past";

/** ตัวเลข "X/Y" แสดงทุกสถานะยกเว้น all/past */
export const showsFraction = (state: DayState): boolean => state !== "all" && state !== "past";

export const dayMap = (days: readonly AvDay[]): Map<DateISO, AvDay> => new Map(days.map((d) => [d.date, d]));

// ───────── วันที่แบบสั้นมีวันในสัปดาห์ (lib ไม่มีสไตล์นี้ → ประกอบจาก weekday + day-month) ─────────
/** th: "อาทิตย์ 25 ต.ค." (long = วันอาทิตย์) · en: "Sunday 25 Oct" / "Sun 25 Oct" */
export function weekdayDate(date: DateISO, locale: CalendarLocale, width: "short" | "long"): string {
  return `${format(date, { locale, style: width === "long" ? "weekday-long" : "weekday-short" })} ${format(date, { locale, style: "day-month" })}`;
}

// ───────── ช่วงเวลา ─────────
export const segmentMinutes = (s: Pick<AvSegment, "startAt" | "endAt">): number => Math.round((s.endAt - s.startAt) / 60_000);

/** ช่วงที่ยาวที่สุด (เท่ากัน = ช่วงเช้ากว่า) · null ถ้าไม่มีช่วง */
export function longestSegment<T extends Pick<AvSegment, "startAt" | "endAt">>(segments: readonly T[]): T | null {
  let best: T | null = null;
  for (const s of segments) {
    if (best === null) best = s;
    else {
      const d = segmentMinutes(s);
      const b = segmentMinutes(best);
      if (d > b || (d === b && s.startAt < best.startAt)) best = s;
    }
  }
  return best;
}

/** ระยะเวลา → ข้อความ busy.duration.* (< 60 นาที = min · ลงตัว = hour · ไม่ลงตัว = hourMin) */
export function durationMsg(totalMin: number): MessageRef {
  const total = Math.max(0, Math.trunc(totalMin));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return { key: "busy.duration.min", values: { minutes } };
  if (minutes === 0) return { key: "busy.duration.hour", values: { hours } };
  return { key: "busy.duration.hourMin", values: { hours, minutes } };
}

/** 'HH:MM' ของนาทีในวัน (1440 → '24:00') — ใช้กับหน้าต่างของกลุ่ม */
export function clockOf(min: number): string {
  const m = Math.max(0, Math.min(1440, Math.trunc(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ───────── สรุปบนสุด (X37, X38) ─────────
export interface FirstSummary {
  kind: "first";
  day: AvDay;
  /** วัน (>= 0) จากวันนี้ — 0 = วันนี้ 1 = พรุ่งนี้ */
  relativeDays: number;
  longest: AvSegment;
  /** จำนวนวันว่างร่วมทั้งหมดที่ >= วันนี้ ในช่วงที่เห็น */
  count: number;
}

export interface NoneSummary {
  kind: "none";
  /** วันใกล้เคียงที่สุด (ว่างมากสุด >= วันนี้, เท่ากันเอาวันก่อน) · null ถ้าไม่มีวัน/ไม่มีใครว่างเลย */
  closest: AvDay | null;
  /** closest เป็นเคส T24 (ทุกคนว่างแต่ไม่มีช่วงตรงกัน) */
  closestNoOverlap: boolean;
  /** ผู้ที่นับว่าไม่ว่างในวัน closest (ลำดับสมาชิก) */
  closestBlockerIds: string[];
}

export type Summary = FirstSummary | NoneSummary;

/** วันแรกที่ allFree และ >= วันนี้ */
export function earliestAllFree(days: readonly AvDay[], today: DateISO): AvDay | null {
  let best: AvDay | null = null;
  for (const d of days) if (d.allFree && d.date >= today && (best === null || d.date < best.date)) best = d;
  return best;
}

/** วัน >= วันนี้ ที่ freeMembers มากสุด (เท่ากันเอาวันก่อน) · ไม่มีใครว่างเลยทั้งช่วง = null */
export function closestDay(days: readonly AvDay[], today: DateISO): AvDay | null {
  let best: AvDay | null = null;
  for (const d of days) {
    if (d.date < today || d.freeMembers <= 0) continue;
    if (best === null || d.freeMembers > best.freeMembers || (d.freeMembers === best.freeMembers && d.date < best.date)) best = d;
  }
  return best;
}

export function summarize(days: readonly AvDay[], today: DateISO): Summary {
  const first = earliestAllFree(days, today);
  const longest = first ? longestSegment(first.segments) : null;
  if (first && longest) {
    const count = days.filter((d) => d.allFree && d.date >= today).length;
    return { kind: "first", day: first, relativeDays: daysBetween(today, first.date), longest, count };
  }
  const closest = closestDay(days, today);
  return {
    kind: "none",
    closest,
    closestNoOverlap: closest !== null && closest.freeMembers >= closest.totalMembers,
    closestBlockerIds: closest ? closest.notFreeUserIds : [],
  };
}

/** ไม่มีใครลงวันไม่ว่างเลยในช่วงที่เห็น (ทุกวันไม่มี blockers) — ผลทุกวันจะดูว่างหมด (X43) */
export const nobodyLoggedBusy = (days: readonly AvDay[]): boolean => days.length > 0 && days.every((d) => d.blockers.length === 0);

/** วันที่แผงขวา (iPad) แสดงตอนยังไม่เลือก: วันแรกที่ว่างร่วม → ใกล้เคียงที่สุด → วันแรกที่กดได้ในช่วง */
export function defaultPanelDate(days: readonly AvDay[], today: DateISO): DateISO | null {
  const s = summarize(days, today);
  if (s.kind === "first") return s.day.date;
  if (s.closest) return s.closest.date;
  return days.find((d) => d.date >= today)?.date ?? null;
}

// ───────── รายละเอียดวัน (X40–X42) ─────────
export type StatusVariant = "all" | "partial" | "nocommon" | "none";

export function statusVariant(day: Pick<AvDay, "allFree" | "freeMembers" | "totalMembers">): StatusVariant {
  if (day.allFree) return "all";
  if (day.freeMembers <= 0) return "none";
  if (day.freeMembers >= day.totalMembers) return "nocommon";
  return "partial";
}

export interface BlockerEntry {
  key: string;
  /** ป้ายเวลา (calendar.day.range/fromPrev/toNext/allDay) + "วันที่ n จาก m" */
  when: MessageRef;
  dayOf: MessageRef | null;
  /** ชื่อรายการ — null = ซ่อน/ไม่ได้ใส่ → UI แสดง "ไม่ว่าง" (calendar.day.busyPlain) */
  title: string | null;
  from: number;
}

export interface BlockerRow {
  member: MemberInfo;
  /** นับว่าไม่ว่าง (อยู่ใน notFreeUserIds) */
  flagged: boolean;
  entries: BlockerEntry[];
}

export interface DayBlockers {
  rows: BlockerRow[];
  /** สมาชิกที่ไม่มีรายการในวันนี้ (ไม่ได้ลงว่าติด — ไม่ใช่ "ว่าง") */
  noBusy: MemberInfo[];
}

/** "ต่อจากเมื่อวาน/ต่อไปพรุ่งนี้" คำนวณจากวันที่ท้องถิ่น (spanOf ใน tz กลุ่ม) ไม่ใช่จากเวลาที่ API ตัดมา */
export function entryOf(item: SharedBusy, date: DateISO, groupTz: string): BlockerEntry | null {
  const seg: DaySegment | null = segmentOn(spanOf(item, groupTz), date);
  if (!seg) return null;
  const label = segmentLabel(seg);
  return { key: `${item.id}-${seg.from}`, when: label.ref, dayOf: label.dayOf, title: segmentTitle(seg), from: seg.from };
}

/** แถว "ใครไม่ว่างเมื่อไร": นับว่าไม่ว่างก่อน แล้วตามลำดับสมาชิก · คนที่ไม่มีรายการ → noBusy */
export function dayBlockers(day: Pick<AvDay, "date" | "blockers" | "notFreeUserIds">, members: readonly MemberInfo[], groupTz: string): DayBlockers {
  const flaggedIds = new Set(day.notFreeUserIds);
  const byUser = new Map<string, BlockerEntry[]>();
  for (const b of day.blockers) {
    const entries = b.items.map((it) => entryOf(it, day.date, groupTz)).filter((e): e is BlockerEntry => e !== null);
    if (entries.length > 0) byUser.set(b.userId, entries.sort((a, c) => a.from - c.from));
  }
  const rows: BlockerRow[] = [];
  const noBusy: MemberInfo[] = [];
  for (const m of members) {
    const entries = byUser.get(m.userId);
    const flagged = flaggedIds.has(m.userId);
    if (entries || flagged) rows.push({ member: m, flagged, entries: entries ?? [] });
    else noBusy.push(m);
  }
  // sort เสถียร: flagged ก่อน (ลำดับสมาชิกเดิมคงไว้ในแต่ละกลุ่ม)
  const ordered = [...rows.filter((r) => r.flagged), ...rows.filter((r) => !r.flagged)];
  return { rows: ordered, noBusy };
}

// ───────── รายชื่อ (กติกาชื่อ UX §8.5) ─────────
export const NAMES_SHOWN = 3;

/** ≤ 3 คน = ทั้งหมดต่อด้วยคำเชื่อม (joinNames) · > 3 = 3 ชื่อแรกคั่น ", " + "และอีก N คน" */
export function nameParts(names: readonly string[]): { shown: string[]; more: number } {
  if (names.length <= NAMES_SHOWN) return { shown: [...names], more: 0 };
  return { shown: names.slice(0, NAMES_SHOWN), more: names.length - NAMES_SHOWN };
}

/** ชื่อที่นับว่าไม่ว่างตามลำดับสมาชิก */
export const namesOf = (ids: readonly string[], members: readonly MemberInfo[]): string[] => {
  const set = new Set(ids);
  return members.filter((m) => set.has(m.userId)).map((m) => m.displayName);
};
