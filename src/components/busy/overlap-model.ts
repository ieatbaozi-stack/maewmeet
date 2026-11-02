// R6E E11 — ลง busy ทับ busy เดิมของตัวเอง: หารายการที่ทับ (pure · ไม่แตะ DOM/เครือข่าย)
// วัน/เวลาคำนวณผ่าน src/lib/calendar เท่านั้น (กฎ 9): normalizeBusyInput (เหมือนเซิร์ฟเวอร์) + overlapsRange (ครึ่งเปิด: ชนขอบพอดีไม่ทับ)
// ทดสอบที่ tests/ui/r6e-busy-overlap.test.ts
import type { OwnBusy } from "@/components/calendar/model";
import { compareDates, expandDailyBusyInput, normalizeBusyInput, overlapsRange, spanDays, type DateISO, type EpochMs } from "@/lib/calendar";
import { CALENDAR_MAX_RANGE_DAYS } from "@/lib/shared/limits";
import type { BusyPayload } from "./form-model";

/** ที่แสดงใน popup ไม่เกินเท่านี้ — เกินใช้ "และรายการอื่นอีก" (ไม่มีตัวเลข) */
export const OVERLAP_SHOW_MAX = 4;

export interface OverlapCandidate {
  allDay: boolean;
  startAt: EpochMs;
  endAt: EpochMs;
  localStartDate: DateISO;
  localEndDate: DateISO;
}

/** payload ที่กำลังจะบันทึก → ช่วงจริง (แปลงเหมือนเซิร์ฟเวอร์ ด้วย tz ของรายการ/ดีฟอลต์) · แปลงไม่ได้ = null (เซิร์ฟเวอร์ตัดสินเอง) */
export function candidateOf(p: Pick<BusyPayload, "kind" | "startDate" | "endDate" | "startTime" | "endTime" | "tz">): OverlapCandidate | null {
  const r = normalizeBusyInput({
    kind: p.kind,
    startDate: p.startDate,
    endDate: p.endDate,
    ...(p.startTime !== undefined ? { startTime: p.startTime } : {}),
    ...(p.endTime !== undefined ? { endTime: p.endTime } : {}),
    ...(p.tz !== undefined ? { tz: p.tz } : {}),
  } as Parameters<typeof normalizeBusyInput>[0]);
  if (!r.ok) return null;
  const v = r.value;
  return { allDay: v.allDay, startAt: v.startAt, endAt: v.endAt, localStartDate: v.localStartDate, localEndDate: v.localEndDate };
}

/**
 * R6F: payload → ช่วงจริงทุกรายการที่จะถูกสร้าง · daily = ขยายเป็นรายวันด้วย expandDailyBusyInput (ตัวเดียวกับเซิร์ฟเวอร์) · แปลงไม่ได้ = null
 */
export function candidatesOf(p: Pick<BusyPayload, "kind" | "startDate" | "endDate" | "startTime" | "endTime" | "tz">): OverlapCandidate[] | null {
  if (p.kind !== "daily") {
    const c = candidateOf(p as Parameters<typeof candidateOf>[0]);
    return c ? [c] : null;
  }
  if (p.startTime === undefined || p.endTime === undefined) return null;
  const r = expandDailyBusyInput({ kind: "daily", startDate: p.startDate, endDate: p.endDate, startTime: p.startTime, endTime: p.endTime, ...(p.tz !== undefined ? { tz: p.tz } : {}) });
  if (!r.ok) return null;
  return r.value.map((v) => ({ allDay: v.allDay, startAt: v.startAt, endAt: v.endAt, localStartDate: v.localStartDate, localEndDate: v.localEndDate }));
}

/** รายการเดิมที่ทับรายการใดรายการหนึ่งใน cands (ไม่ซ้ำ · เรียงตามเวลาเริ่ม) */
export function findOverlapsAny(cands: readonly OverlapCandidate[], existing: readonly OwnBusy[], selfId: string | null): OwnBusy[] {
  const hit = new Map<string, OwnBusy>();
  for (const c of cands) for (const b of findOverlaps(c, existing, selfId)) hit.set(b.id, b);
  return [...hit.values()].sort((a, b) => a.startAt - b.startAt || (a.id < b.id ? -1 : 1));
}

/** ช่วงวันรวมของทุกรายการ (ใช้เป็น query ของ GET /api/me/busy) */
export function hullOf(cands: readonly OverlapCandidate[]): OverlapCandidate {
  const first = cands[0]!;
  let a = first.localStartDate;
  let b = first.localEndDate;
  for (const c of cands) {
    if (compareDates(c.localStartDate, a) < 0) a = c.localStartDate;
    if (compareDates(c.localEndDate, b) > 0) b = c.localEndDate;
  }
  return { ...first, localStartDate: a, localEndDate: b };
}

/**
 * ทับกันไหม: ถ้ามีฝั่งใดเป็น "ทั้งวัน" เทียบตามวันท้องถิ่น (ช่วงวันแบบปิดหัวท้าย) · ไม่งั้นเทียบช่วงเวลาจริง [start,end) — แตะขอบไม่ทับ
 */
export function overlapsOwn(c: OverlapCandidate, b: Pick<OwnBusy, "allDay" | "startAt" | "endAt" | "localStartDate" | "localEndDate">): boolean {
  if (c.allDay || b.allDay) return compareDates(b.localStartDate, c.localEndDate) <= 0 && compareDates(b.localEndDate, c.localStartDate) >= 0;
  return overlapsRange(c.startAt, c.endAt, b.startAt, b.endAt);
}

/** รายการของฉันที่ทับช่วงนี้ (เรียงตามเวลาเริ่ม) · ตอนแก้ไม่นับรายการตัวเอง (selfId) */
export function findOverlaps(c: OverlapCandidate, existing: readonly OwnBusy[], selfId: string | null): OwnBusy[] {
  return existing
    .filter((b) => b.id !== selfId && overlapsOwn(c, b))
    .sort((a, b) => a.startAt - b.startAt || (a.id < b.id ? -1 : 1));
}

/** แสดงไม่เกิน max รายการ · เกิน = more (ไม่มีตัวเลข) */
export function limitOverlaps<T>(list: readonly T[], max: number = OVERLAP_SHOW_MAX): { shown: T[]; more: boolean } {
  return { shown: list.slice(0, max), more: list.length > max };
}

/** พารามิเตอร์ของ GET /api/me/busy: ช่วงวันที่ของรายการใหม่ (≤ CALENDAR_MAX_RANGE_DAYS วัน) · ยาวกว่านั้น = ไม่ส่ง (ทั้งหมดที่ยังไม่สิ้นสุด) แล้วกรองฝั่งไคลเอนต์ */
export function listQueryFor(c: OverlapCandidate): string {
  if (spanDays(c.localStartDate, c.localEndDate) > CALENDAR_MAX_RANGE_DAYS) return "";
  return `?from=${c.localStartDate}&to=${c.localEndDate}`;
}
