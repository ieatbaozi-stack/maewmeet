// ตัวช่วยล้วน (ไม่แตะ DOM/เครือข่าย) ของหน้ากลุ่ม R2 — ทดสอบที่ tests/ui/groups-helpers.test.ts
// ICU params: docs/design/UX.md §4 "R2 — ไฟล์จริง"
import { GROUP_LIMITS } from "@/lib/shared/limits";

export type GroupRole = "admin" | "moderator" | "member";

export const MEMBER_SLOT_COUNT = 10;

/**
 * ช่อง 1–10 สำหรับ data-color / data-shape จาก colorIndex / shapeIndex 0–9 ของ API (ช่อง = index + 1)
 * ชนกันได้ — สัญญาณที่ไม่ใช่สีคือรูปทรง + ตัวอักษรย่อ (members.css) · สีกับรูปทรงเป็นอิสระต่อกัน (R6C)
 */
export function memberSlot(colorIndex: number): number {
  const n = Number.isFinite(colorIndex) ? Math.trunc(colorIndex) : 0;
  return (((n % MEMBER_SLOT_COUNT) + MEMBER_SLOT_COUNT) % MEMBER_SLOT_COUNT) + 1;
}

const THAI_LEADING_VOWELS = /^[\u0E40-\u0E44]$/u; // สระนำ เ แ โ ใ ไ (U+0E40–0E44) — ข้ามเพื่อหาพยัญชนะต้น (UX §4)
const graphemes = (s: string): string[] =>
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s), (x) => x.segment)
    : Array.from(s);

/** ตัวอักษรย่อบนอวาตาร์: ตัวแรกของชื่อที่แสดง (ไทย: พยัญชนะต้น ข้ามสระนำ) · ละติน → ตัวพิมพ์ใหญ่ · ชื่อว่าง → "?" */
export function memberInitial(displayName: string): string {
  const parts = graphemes(displayName.normalize("NFC").trim());
  const pick = parts.find((g) => !THAI_LEADING_VOWELS.test(g) && g.trim() !== "") ?? parts.find((g) => g.trim() !== "");
  if (!pick) return "?";
  // อักษรไทย: เอาเฉพาะพยัญชนะ ไม่เอาวรรณยุกต์/สระที่ซ้อนอยู่ในกลุ่มอักขระเดียวกัน (ต้ → ต)
  const first = String.fromCodePoint(pick.codePointAt(0)!);
  return /^[\u0E00-\u0E7F]$/u.test(first) ? first : pick.toLocaleUpperCase("en");
}

// ───────── วันที่ (ไม่มี src/lib/calendar ใน R2 — จัดรูปแบบจาก epoch ms ด้วย Intl + เขตเวลาชัดเจน ไม่ใช้ Date) ─────────
const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** th: "25 ต.ค. 2569" · en: "25 Oct 2026" (UX §4: ส่งเป็น string เข้า {date}/{expires}) */
export function formatShortDate(epochMs: number, locale: string, timeZone = "Asia/Bangkok"): string {
  const tag = locale === "en" ? "en-GB" : "th-TH-u-ca-buddhist";
  const key = `${tag}|${timeZone}`;
  let f = DATE_FORMATTERS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone });
    DATE_FORMATTERS.set(key, f);
  }
  return f.format(epochMs);
}

// ───────── หน้าต่างวันว่าง (D9) ─────────
export const WINDOW_STEP_MIN = 30;
export const DAY_MIN = 1440;

/** นาทีนับจากเที่ยงคืน → "HH:MM" (1440 → "24:00") */
export function formatClock(min: number): string {
  const m = Math.max(0, Math.min(DAY_MIN, Math.trunc(min)));
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export type DurationRef =
  | { key: "durationMin"; values: { minutes: number } }
  | { key: "durationHour"; values: { hours: number } }
  | { key: "durationHourMin"; values: { hours: number; minutes: number } };

/** ระยะเวลาเป็นคีย์ groupSettings.window.<key> + ค่า ICU (< 60 → นาที · ลงตัว → ชม. · ไม่ลงตัว → ชม.+นาที) */
export function durationRef(totalMin: number): DurationRef {
  const total = Math.max(0, Math.trunc(totalMin));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return { key: "durationMin", values: { minutes } };
  if (minutes === 0) return { key: "durationHour", values: { hours } };
  return { key: "durationHourMin", values: { hours, minutes } };
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let n = from; n <= to; n += step) out.push(n);
  return out;
};
/** ตัวเลือกเริ่ม/จบ/ขั้นต่ำ — เลื่อนทีละ 30 นาที */
export const WINDOW_START_OPTIONS = range(0, DAY_MIN - WINDOW_STEP_MIN, WINDOW_STEP_MIN);
export const WINDOW_END_OPTIONS = range(WINDOW_STEP_MIN, DAY_MIN, WINDOW_STEP_MIN);
export const WINDOW_MIN_OPTIONS = range(WINDOW_STEP_MIN, DAY_MIN, WINDOW_STEP_MIN);

/** กฎเดียวกับ assertFreeWindow ฝั่งเซิร์ฟเวอร์ (ใช้ปิดปุ่มบันทึกเท่านั้น — เซิร์ฟเวอร์ตัดสินจริง) */
export function isWindowValid(start: number, end: number, minFree: number): boolean {
  const step = (n: number) => Number.isInteger(n) && n % WINDOW_STEP_MIN === 0;
  return start >= 0 && start < end && end <= DAY_MIN && step(start) && step(end) && minFree >= WINDOW_STEP_MIN && step(minFree) && minFree <= end - start;
}

// ───────── ชื่อกลุ่ม ─────────
/** จำนวนตัวอักษรแบบ code point (เหมือนฝั่งเซิร์ฟเวอร์) หลัง NFC + trim */
export function groupNameLength(raw: string): number {
  return [...raw.normalize("NFC").trim()].length;
}
export const GROUP_NAME_MAX = GROUP_LIMITS.nameMax;

/** ปุ่มยืนยันลบกลุ่มกดได้เมื่อพิมพ์ชื่อตรงตัว (trim แล้วเทียบตรงๆ — UX §4); กันมือพลาดเท่านั้น */
export function deleteTypeMatches(typed: string, groupName: string): boolean {
  return typed.trim() === groupName.trim() && groupName.trim() !== "";
}

// ───────── สิทธิ์ (ซ่อนปุ่มเท่านั้น — เซิร์ฟเวอร์ตรวจจริงทุก endpoint · CLAUDE.md ข้อ 6) ─────────
/** myRole = null = super admin ที่ไม่ใช่สมาชิก (คนนอกอื่นได้ 404 ไปแล้ว) → ใช้ปุ่มของ admin */
export function viewerRole(myRole: GroupRole | null): GroupRole {
  return myRole ?? "admin";
}

export interface MemberActionSet {
  /** role ใหม่ที่ตั้งได้ (member ↔ moderator) หรือ null */
  setRole: "moderator" | "member" | null;
  transfer: boolean;
  remove: boolean;
}
export const NO_ACTIONS: MemberActionSet = { setRole: null, transfer: false, remove: false };

/** สะท้อน PRD §3 แถว 12/14/15: admin ทำกับทุกคนที่ไม่ใช่ตัวเอง/admin · moderator ลบได้เฉพาะ member */
export function memberActions(viewer: GroupRole, target: GroupRole, isSelf: boolean): MemberActionSet {
  if (isSelf || target === "admin") return NO_ACTIONS;
  if (viewer === "admin") return { setRole: target === "moderator" ? "member" : "moderator", transfer: true, remove: true };
  if (viewer === "moderator" && target === "member") return { setRole: null, transfer: false, remove: true };
  return NO_ACTIONS;
}

export const canEditSettings = (viewer: GroupRole): boolean => viewer === "admin" || viewer === "moderator";
