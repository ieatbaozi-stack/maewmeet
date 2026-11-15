// โมเดล "เว้นบางวัน" ของแบบประจำ (R15a §1.1 · R15_FEEDBACK §3 · ADR 0012 §13) — ล้วน ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/r15a-skip-model.test.ts
// วัน/สัปดาห์/เดือนคำนวณผ่าน src/lib/calendar เท่านั้น (กฎ 9) · "วันนี้" มาจากผู้เรียก (todayIn ใน tz ของชุด) — วันนี้นับว่ายังไม่ผ่าน (เว้นได้)
import type { ApiResult } from "@/components/auth/api";
import type { FullResult } from "@/components/appointments/api";
import { messageRefOf, type MessageRef } from "@/i18n/auth-messages";
import { daysInMonth, eachDate, routineOccursOn, startOfWeek, weekdaysToMask, type DateISO } from "@/lib/calendar";
import { BUSY_ROUTINE_SKIP_MAX_DAYS } from "@/lib/shared/limits";
import type { RoutineView } from "./routine-model";

/** เพดานวันต่อคำขอ (ตรงกับเซิร์ฟเวอร์ LIMIT_REACHED skipDays) */
export const SKIP_MAX_DAYS = BUSY_ROUTINE_SKIP_MAX_DAYS;

export type SkipMode = "skip" | "restore";

const ref = (key: string, values: Record<string, string | number> = {}): MessageRef => ({ key, values });

// ───────── ชุดวันที่ใช้วาดปฏิทิน ─────────
export interface SkipPool {
  /** วันของชุดที่ยังไม่ผ่าน (≥ วันนี้) รวมวันที่เว้นไว้ที่กฎปัจจุบันไม่มีแล้ว (แยกแก้/แก้กฎ) — เรียงจากน้อย ไม่ซ้ำ */
  days: DateISO[];
  /** วันที่เว้นไว้และยังไม่ผ่าน (เรียงจากน้อย) */
  skipped: DateISO[];
  /** วันที่ยังเว้นได้ = days − skipped */
  available: DateISO[];
}

export function skipPool(r: Pick<RoutineView, "weekdays" | "startDate" | "endDate" | "skippedDates">, today: DateISO): SkipPool {
  const skipped = [...new Set(r.skippedDates)].filter((d) => d >= today).sort();
  const from = r.startDate > today ? r.startDate : today;
  const days: DateISO[] = [];
  if (from <= r.endDate) {
    const rule = { weekdays: weekdaysToMask(r.weekdays), startDate: r.startDate, endDate: r.endDate };
    for (const d of eachDate(from, r.endDate)) if (routineOccursOn(rule, d)) days.push(d);
  }
  const all = [...new Set([...days, ...skipped])].sort();
  const sk = new Set(skipped);
  return { days: all, skipped, available: all.filter((d) => !sk.has(d)) };
}

/** แสดงปุ่ม "เว้นบางวัน" เมื่อชุดยังไม่จบ หรือยังมีวันเว้นที่คืนได้ */
export const canSkip = (r: Pick<RoutineView, "endDate" | "skippedDates">, today: DateISO): boolean => r.endDate >= today || r.skippedDates.some((d) => d >= today);

/** จำนวนวันเว้นที่ยังไม่ผ่าน (ชิป "เว้นไว้ N วัน") — 0 = ซ่อนชิป */
export const skippedUpcoming = (r: Pick<RoutineView, "skippedDates">, today: DateISO): number => new Set(r.skippedDates.filter((d) => d >= today)).size;

/** โหมดตั้งต้นของแผ่น: เว้นวัน · ถ้าไม่เหลือวันให้เว้นแต่มีวันที่เว้นไว้ → เริ่มที่แท็บคืน */
export const initialMode = (p: SkipPool): SkipMode => (p.available.length === 0 && p.skipped.length > 0 ? "restore" : "skip");

// ───────── เดือน/ตาราง ─────────
export const ymOf = (d: DateISO): string => d.slice(0, 7);

/** เดือน (YYYY-MM) ที่มีวันของชุด เรียงจากน้อย — ขอบเขตปุ่ม ‹ › */
export function poolMonths(days: readonly DateISO[]): string[] {
  return [...new Set(days.map(ymOf))].sort();
}

export const shiftMonth = (months: readonly string[], ym: string, n: -1 | 1): string | null => {
  const i = months.indexOf(ym);
  return i < 0 ? null : (months[i + n] ?? null);
};

/** เดือนเริ่มต้น: เดือนของวันแรกที่เลือกได้ในโหมดนั้น */
export function initialMonth(p: SkipPool, mode: SkipMode): string | null {
  const first = (mode === "skip" ? p.available : p.skipped)[0] ?? p.days[0];
  return first ? ymOf(first) : null;
}

export type SkipCell =
  /** ว่างก่อนวันที่ 1 ของเดือน (ให้ตารางเริ่มตรงวันในสัปดาห์) */
  | { type: "blank"; key: string }
  /** วันนอกชุด/ก่อนวันนี้ — ตัวเลขจาง ไม่ใช่ปุ่ม */
  | { type: "off"; key: string; date: DateISO; day: number }
  | { type: "day"; key: string; date: DateISO; day: number; skipped: boolean };

/**
 * ตารางของเดือน: เริ่มที่ "สัปดาห์แรกที่ยังมีวันของชุด" (ไม่แสดงสัปดาห์ที่ผ่านไปแล้ว) ถึงวันสุดท้ายของเดือน · 7 คอลัมน์เริ่มจันทร์ (WEEK_START)
 */
export function buildSkipMonth(ym: string, pool: SkipPool): SkipCell[] {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const monthStart = `${ym}-01`;
  const last = `${ym}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  const firstDay = pool.days.find((d) => ymOf(d) === ym);
  if (!firstDay) return [];
  const sk = new Set(pool.skipped);
  const inPool = new Set(pool.days);
  const cells: SkipCell[] = [];
  for (const d of eachDate(startOfWeek(firstDay), last)) {
    if (d < monthStart) cells.push({ type: "blank", key: `b-${d}` });
    else if (inPool.has(d)) cells.push({ type: "day", key: d, date: d, day: Number(d.slice(8)), skipped: sk.has(d) });
    else cells.push({ type: "off", key: d, date: d, day: Number(d.slice(8)) });
  }
  return cells;
}

// ───────── เลือกวัน ─────────
/** สลับการเลือก — เลือกครบเพดานแล้วจะเลือกเพิ่มไม่ได้ (คืนค่าเดิม) · เรียงจากน้อย */
export function togglePick(picked: readonly DateISO[], date: DateISO, max: number = SKIP_MAX_DAYS): DateISO[] {
  if (picked.includes(date)) return picked.filter((d) => d !== date);
  if (picked.length >= max) return [...picked];
  return [...picked, date].sort();
}

export const atLimit = (picked: readonly DateISO[], max: number = SKIP_MAX_DAYS): boolean => picked.length >= max;

/** สถานะช่องวันตามโหมด — ผลที่ UI แปลงเป็นคลาส/aria */
export type DayState = "plain" | "picked" | "skipped" | "restorable" | "restorePicked" | "locked";

export function dayState(mode: SkipMode, cell: { skipped: boolean; date: DateISO }, picked: readonly DateISO[], max: number = SKIP_MAX_DAYS): DayState {
  const on = picked.includes(cell.date);
  if (mode === "skip") {
    if (cell.skipped) return "skipped"; // เว้นไว้แล้ว: กดไม่ได้ (aria-disabled) แต่ยังโฟกัส/อ่านได้
    if (on) return "picked";
    return atLimit(picked, max) ? "locked" : "plain";
  }
  if (!cell.skipped) return "locked";
  if (on) return "restorePicked";
  return atLimit(picked, max) ? "locked" : "restorable";
}

/** ค่า state ของข้อความ skip.day.aria */
export const ariaState = (s: DayState): "on" | "skipped" | "off" => (s === "picked" || s === "restorePicked" ? "on" : s === "skipped" || s === "restorable" ? "skipped" : "off");

/** ช่องกดได้ (เปลี่ยนการเลือก) */
export const isInteractive = (s: DayState): boolean => s === "plain" || s === "picked" || s === "restorable" || s === "restorePicked";

// ───────── คำขอ + ผล ─────────
export interface SkipRequest {
  path: string;
  body: { add: DateISO[] } | { remove: DateISO[] };
}

export function skipRequest(routineId: string, mode: SkipMode, picked: readonly DateISO[]): SkipRequest {
  const dates = [...picked].sort();
  return { path: `/api/me/busy-routines/${routineId}/skips`, body: mode === "skip" ? { add: dates } : { remove: dates } };
}

/** จำนวนที่แสดงใน toast: ใช้ค่าจริงจากเซิร์ฟเวอร์ ถ้าเป็น 0 (เว้นซ้ำวันที่เว้นอยู่แล้ว) ใช้จำนวนที่ผู้ใช้เลือก */
export function doneCount(mode: SkipMode, res: { skipped?: unknown; restored?: unknown } | undefined, picked: number): number {
  const n = mode === "skip" ? res?.skipped : res?.restored;
  return typeof n === "number" && n > 0 ? n : picked;
}

type Failure = Extract<FullResult<unknown> | ApiResult<unknown>, { ok: false }>;
export type SkipFailure = { type: "gone" } | { type: "error"; refs: MessageRef[] };

/**
 * ผลล้มเหลว → ข้อความ (R15_FEEDBACK §3.3) ทุกข้อความบอกว่า "ยังไม่มีอะไรเปลี่ยน"
 * NOT_FOUND = ชุดหาย (gone) · VALIDATION = วันที่เลือกผ่านไป/ไม่อยู่ในชุด (stale) · RATE_LIMITED = skip.error.rate
 * LIMIT_REACHED skipDays → errors.LIMIT_REACHED · routineRows (คืนวันแล้วแถวรวมเกินเพดาน) → busy.routine.error.routineRows · อื่นๆ/เครือข่าย = generic
 */
export function mapSkipFailure(res: Failure): SkipFailure {
  const generic: SkipFailure = { type: "error", refs: [ref("busy.routine.skip.error.generic")] };
  if (res.kind === "network") return generic;
  const { code, values } = res.error;
  switch (code) {
    case "NOT_FOUND":
      return { type: "gone" };
    case "VALIDATION":
      return { type: "error", refs: [ref("busy.routine.skip.error.stale")] };
    case "RATE_LIMITED":
      return { type: "error", refs: [ref("busy.routine.skip.error.rate")] };
    case "LIMIT_REACHED": {
      const limit = typeof values.limit === "string" ? values.limit : "";
      if (limit === "routineRows") return { type: "error", refs: [ref("busy.routine.error.routineRows", { max: typeof values.max === "number" ? values.max : 1500 })] };
      return { type: "error", refs: [messageRefOf(res.error)] };
    }
    default:
      return generic;
  }
}
