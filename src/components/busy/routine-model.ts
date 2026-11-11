// โมเดลฟอร์ม/รายการ/ขอบเขตของ busy แบบ routine (R14b) — ล้วน ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/r14b-routine-model.test.ts
// กติกาที่ตรงกับเซิร์ฟเวอร์ (ADR 0012): ส่งวันจันทร์ของสัปดาห์ / 'YYYY-MM' ของเดือน · เวลาจบรับ "24:00" · เวลาจบ ≤ เริ่ม = ข้ามเที่ยงคืน
// คำนวณวัน/จำนวนวันผ่าน src/lib/calendar (planRoutine/routinePeriodStart) เท่านั้น — "วันนี้" มาจาก now ที่ผู้เรียกส่ง (กฎ 9)
import type { ApiResult } from "@/components/auth/api";
import type { FullResult } from "@/components/appointments/api";
import type { MessageRef } from "@/components/calendar/model";
import { TIME_OPTIONS } from "@/components/busy/form-model";
import {
  DEFAULT_TZ,
  addDays,
  addMonths,
  format,
  planRoutine,
  routinePeriodStart,
  routinePeriods,
  startOfWeek,
  todayIn,
  type CalendarLocale,
  type DateISO,
  type RoutineRangeKind,
} from "@/lib/calendar";
import type { RoutineOwnView } from "@/lib/data/serializers/busy-routine";
import {
  BUSY_NOTE_MAX,
  BUSY_ROUTINE_HARD_MAX_ACTIVE,
  BUSY_ROUTINE_MAX_ACTIVE,
  BUSY_ROUTINE_MAX_AHEAD_MONTHS,
  BUSY_ROUTINE_MAX_MONTHS,
  BUSY_ROUTINE_MAX_WEEKS,
  BUSY_TITLE_MAX,
} from "@/lib/shared/limits";

export type RoutineView = RoutineOwnView;
export type { RoutineRangeKind };

export const TITLE_MAX = BUSY_TITLE_MAX;
export const NOTE_MAX = BUSY_NOTE_MAX;
export const MAX_ACTIVE = BUSY_ROUTINE_MAX_ACTIVE;
export const MAX_WEEKS = BUSY_ROUTINE_MAX_WEEKS;
export const MAX_MONTHS = BUSY_ROUTINE_MAX_MONTHS;
/** ตัวเลือกช่วง: สัปดาห์ถัดไปประมาณ 52 รายการ · เดือนถึง 12 เดือน (design §2 ข้อ 4) */
export const WEEK_OPTION_COUNT = 52;
export const MONTH_OPTION_COUNT = 12;
/** ชุดที่เหลือ ≤ นี้ (หรือจบแล้ว) แสดงปุ่ม "ต่ออายุ" */
export const EXTEND_WITHIN_DAYS = 14;
/** ใช้ไป ≥ นี้จากเพดาน → เตือน "ใกล้เต็ม" (design §3) */
export const NEAR_LIMIT_FROM = 8;

/** เวลาเริ่ม 00:00–23:30 · เวลาจบ 00:30–23:30 + "24:00" (00:00 ตัดออก — ซ้ำกับ 24:00) */
export const START_OPTIONS: readonly string[] = TIME_OPTIONS;
export const MIDNIGHT = "24:00";
export const END_OPTIONS: readonly string[] = [...TIME_OPTIONS.filter((x) => x !== "00:00"), MIDNIGHT];

/** ISO 1 = จันทร์ … 7 = อาทิตย์ (WEEK_START = 1) */
export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const WEEKDAYS_ALL: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

// ───────── สถานะฟอร์ม ─────────
export type PresetId = "work" | "class" | "gym" | "weekend" | "custom";

export interface RoutineFormState {
  preset: PresetId | null;
  /** ชื่อที่ preset เติมให้ล่าสุด (ไว้แยก "ผู้ใช้พิมพ์เอง" ออกจาก "เติมให้" — preset ถัดไปทับได้เฉพาะชื่อที่เติมให้) */
  autoTitle: string | null;
  /** ISO 1–7 เรียงน้อย→มาก */
  weekdays: number[];
  allDay: boolean;
  startTime: string;
  /** อาจเป็น "24:00" */
  endTime: string;
  rangeKind: RoutineRangeKind;
  /** วันจันทร์ของสัปดาห์ (rangeKind weeks) */
  fromWeek: DateISO;
  toWeek: DateISO;
  /** 'YYYY-MM' (rangeKind months) */
  fromMonth: string;
  toMonth: string;
  title: string;
  note: string;
  hideDetail: boolean;
}

export const ymOf = (date: DateISO): string => date.slice(0, 7);
const monthStartOf = (ym: string): DateISO => `${ym}-01`;
export const shiftYm = (ym: string, n: number): string => {
  const r = addMonths(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), n);
  return `${String(r.year).padStart(4, "0")}-${String(r.month).padStart(2, "0")}`;
};

export function initialRoutineState(today: DateISO): RoutineFormState {
  const monday = startOfWeek(today);
  return {
    preset: null,
    autoTitle: null,
    weekdays: [],
    allDay: false,
    startTime: "09:00",
    endTime: "10:00",
    rangeKind: "weeks",
    fromWeek: monday,
    toWeek: monday,
    fromMonth: ymOf(today),
    toMonth: ymOf(today),
    title: "",
    note: "",
    hideDetail: false,
  };
}

// ───────── preset ─────────
interface PresetDef {
  weekdays?: number[];
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  /** คีย์ชื่อเริ่มต้นใต้ busy.routine.preset.* (ไม่มี = ล้างชื่อที่เติมให้) */
  titleKey?: "work" | "class" | "gym" | "weekendTitle";
}

export const PRESETS: Readonly<Record<PresetId, PresetDef>> = {
  work: { weekdays: [1, 2, 3, 4, 5], allDay: false, startTime: "09:00", endTime: "18:00", titleKey: "work" },
  class: { weekdays: [1, 2, 3, 4, 5], allDay: false, titleKey: "class" },
  gym: { weekdays: [], allDay: false, titleKey: "gym" },
  weekend: { weekdays: [6, 7], allDay: true, titleKey: "weekendTitle" },
  custom: { weekdays: [], allDay: false },
};
export const PRESET_IDS: readonly PresetId[] = ["work", "class", "gym", "weekend", "custom"];

/**
 * กด preset → เติมเฉพาะที่ preset กำหนด · ชื่อ: เติมเมื่อช่องว่างหรือยังเป็นชื่อที่ preset ก่อนหน้าเติมให้ (ไม่ทับที่ผู้ใช้พิมพ์)
 * บันทึกส่วนตัว/ซ่อนรายละเอียด/ช่วงวันที่ ไม่แตะ · titleText = ข้อความชื่อตามภาษาปัจจุบัน (ผู้เรียกแปลให้) · ไม่มีชื่อ preset = "" (custom)
 */
export function applyPreset(s: RoutineFormState, id: PresetId, titleText: string): RoutineFormState {
  const p = PRESETS[id];
  const replaceTitle = s.title === "" || (s.autoTitle !== null && s.title === s.autoTitle);
  const next: RoutineFormState = { ...s, preset: id };
  if (p.weekdays) next.weekdays = [...p.weekdays];
  if (p.allDay !== undefined) next.allDay = p.allDay;
  if (p.startTime !== undefined) next.startTime = p.startTime;
  if (p.endTime !== undefined) next.endTime = p.endTime;
  if (replaceTitle) {
    next.title = clipText(titleText, TITLE_MAX);
    next.autoTitle = titleText === "" ? null : next.title;
  }
  return next;
}

export function clipText(v: string, max: number): string {
  const chars = [...v];
  return chars.length > max ? chars.slice(0, max).join("") : v;
}

// ───────── วันในสัปดาห์ ─────────
export function toggleWeekday(days: readonly number[], d: number): number[] {
  return days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b);
}

export const QUICK_WEEKDAYS: Readonly<Record<"weekdays" | "weekend" | "every", readonly number[]>> = {
  weekdays: [1, 2, 3, 4, 5],
  weekend: [6, 7],
  every: WEEKDAYS_ALL,
};

export type QuickWeekdays = keyof typeof QUICK_WEEKDAYS;

/** ชุดที่ตรงกับปุ่มลัดตัวไหน (ไว้ aria-pressed) · ไม่ตรง = null */
export function quickMatch(days: readonly number[]): QuickWeekdays | null {
  for (const k of Object.keys(QUICK_WEEKDAYS) as QuickWeekdays[]) {
    const q = QUICK_WEEKDAYS[k];
    if (q.length === days.length && q.every((d, i) => d === days[i])) return k;
  }
  return null;
}

export type WeekdayPart = { kind: "every" } | { kind: "range"; from: number; to: number } | { kind: "day"; day: number };

/** สรุปวันสำหรับบรรทัดสรุป: ทั้ง 7 = every · ติดกัน ≥ 3 วัน = ช่วง (จ.–ศ.) · นอกนั้นเรียงทีละวัน (จ. อ. พฤ. ศ.) */
export function weekdayParts(days: readonly number[]): WeekdayPart[] {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return [{ kind: "every" }];
  const out: WeekdayPart[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    if (j - i + 1 >= 3) out.push({ kind: "range", from: sorted[i]!, to: sorted[j]! });
    else for (let k = i; k <= j; k++) out.push({ kind: "day", day: sorted[k]! });
    i = j + 1;
  }
  return out;
}

export const nextWeekday = (d: number): number => (d % 7) + 1;

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** "จ.–ศ." / "จ. อ. พฤ. ศ." / "ทุกวัน" — ข้อความย่อวันสำหรับสรุป/รายการ (คีย์ busy.routine.weekdays.*) */
export function weekdaysText(t: Translate, days: readonly number[]): string {
  const short = (d: number) => t(`busy.routine.weekdays.short.${WEEKDAY_KEYS[d - 1]}`);
  return weekdayParts(days)
    .map((p) => (p.kind === "every" ? t("busy.routine.weekdays.every") : p.kind === "range" ? t("busy.routine.weekdays.range", { from: short(p.from), to: short(p.to) }) : short(p.day)))
    .join(" ");
}

// ───────── เวลา ─────────
export const isMidnightEnd = (end: string): boolean => end === MIDNIGHT;
/** จบ ≤ เริ่ม (และไม่ใช่ 24:00) = ข้ามเที่ยงคืน · จบ = เริ่ม ใช้ไม่ได้ (timeInvalid) */
export const isOvernightTimes = (start: string, end: string): boolean => !isMidnightEnd(end) && end <= start;
export const timeInvalid = (s: Pick<RoutineFormState, "allDay" | "startTime" | "endTime">): boolean => !s.allDay && s.startTime === s.endTime;

// ───────── ช่วง (สัปดาห์/เดือน) ─────────
export interface PeriodOption {
  /** weeks: วันจันทร์ · months: 'YYYY-MM' */
  value: string;
  /** วันแรก/วันสุดท้ายของช่วง */
  start: DateISO;
  end: DateISO;
  current: boolean;
}

const monthEnd = (ym: string): DateISO => addDays(`${shiftYm(ym, 1)}-01`, -1);

/** รายการช่วงเริ่มที่ firstValue ไปข้างหน้า count รายการ · current = ช่วงที่มีวันนี้อยู่ */
export function periodOptions(kind: RoutineRangeKind, firstValue: string, count: number, today: DateISO): PeriodOption[] {
  const out: PeriodOption[] = [];
  for (let i = 0; i < count; i++) {
    if (kind === "weeks") {
      const start = addDays(firstValue, i * 7);
      const end = addDays(start, 6);
      out.push({ value: start, start, end, current: today >= start && today <= end });
    } else {
      const value = shiftYm(firstValue, i);
      out.push({ value, start: monthStartOf(value), end: monthEnd(value), current: ymOf(today) === value });
    }
  }
  return out;
}

/** วันสุดท้ายที่ลงล่วงหน้าได้ = วันนี้ + 12 เดือน */
export function latestEnd(today: DateISO): DateISO {
  const { year, month } = addMonths(Number(today.slice(0, 4)), Number(today.slice(5, 7)), BUSY_ROUTINE_MAX_AHEAD_MONTHS);
  const dim = Number(monthEnd(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`).slice(8, 10));
  const day = Math.min(Number(today.slice(8, 10)), dim);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const maxPeriods = (kind: RoutineRangeKind): number => (kind === "weeks" ? MAX_WEEKS : MAX_MONTHS);

export function rangeValues(s: RoutineFormState): { from: string; to: string } {
  return s.rangeKind === "weeks" ? { from: s.fromWeek, to: s.toWeek } : { from: s.fromMonth, to: s.toMonth };
}

const valueStart = (kind: RoutineRangeKind, v: string): DateISO => (kind === "weeks" ? v : monthStartOf(v));

/** ตัวเลือก "ถึง" ใช้ได้ไหม: ไม่ก่อน "ตั้งแต่" · ไม่ยาวเกินเพดาน · ไม่ไกลเกิน 12 เดือน */
export function toOptionDisabled(kind: RoutineRangeKind, from: string, opt: PeriodOption, today: DateISO): boolean {
  if (opt.value < from) return true;
  if (routinePeriods(kind, valueStart(kind, from), opt.end) > maxPeriods(kind)) return true;
  return opt.end > latestEnd(today);
}

/**
 * เลือก "ตั้งแต่" ใหม่ → "ถึง" ตามอัตโนมัติ (design §2 ข้อ 4): ถ้า "ถึง" < "ตั้งแต่" ดันไปเท่ากัน · ถ้ายาวเกินเพดาน ดึงกลับมาที่เพดาน
 * ทำให้ฟอร์มไม่เคยอยู่ในสถานะที่ UI ปล่อยให้ยิงช่วงผิดลำดับ/ยาวเกิน (เซิร์ฟเวอร์ตรวจซ้ำเสมอ)
 */
export function setRangeFrom(s: RoutineFormState, value: string): RoutineFormState {
  if (s.rangeKind === "weeks") {
    let to = s.toWeek < value ? value : s.toWeek;
    const cap = addDays(value, (MAX_WEEKS - 1) * 7);
    if (to > cap) to = cap;
    return { ...s, fromWeek: value, toWeek: to };
  }
  let to = s.toMonth < value ? value : s.toMonth;
  const cap = shiftYm(value, MAX_MONTHS - 1);
  if (to > cap) to = cap;
  return { ...s, fromMonth: value, toMonth: to };
}

export function setRangeTo(s: RoutineFormState, value: string): RoutineFormState {
  return s.rangeKind === "weeks" ? { ...s, toWeek: value } : { ...s, toMonth: value };
}

/** สลับ สัปดาห์ ↔ เดือน: ช่วงเดิมแปลงเป็นช่วงที่ครอบวันเดียวกัน (เริ่มวันแรก → สิ้นสุดวันท้าย) แล้วกันเพดานใหม่ */
export function setRangeKind(s: RoutineFormState, kind: RoutineRangeKind): RoutineFormState {
  if (kind === s.rangeKind) return s;
  if (kind === "months") {
    const next: RoutineFormState = { ...s, rangeKind: "months", fromMonth: ymOf(s.fromWeek), toMonth: ymOf(addDays(s.toWeek, 6)) };
    return setRangeFrom(next, next.fromMonth);
  }
  const next: RoutineFormState = { ...s, rangeKind: "weeks", fromWeek: startOfWeek(monthStartOf(s.fromMonth)), toWeek: startOfWeek(monthEnd(s.toMonth)) };
  return setRangeFrom(next, next.fromWeek);
}

export type ShortcutId = "thisMonth" | "next4Weeks" | "next3Months";
export const SHORTCUT_IDS: readonly ShortcutId[] = ["thisMonth", "next4Weeks", "next3Months"];

/** ทางลัดช่วง (design §2 ข้อ 4) — ทับเฉพาะส่วนช่วง */
export function applyShortcut(s: RoutineFormState, id: ShortcutId, today: DateISO): RoutineFormState {
  if (id === "thisMonth") return { ...s, rangeKind: "months", fromMonth: ymOf(today), toMonth: ymOf(today) };
  if (id === "next3Months") return { ...s, rangeKind: "months", fromMonth: ymOf(today), toMonth: shiftYm(ymOf(today), 2) };
  const monday = startOfWeek(today);
  return { ...s, rangeKind: "weeks", fromWeek: monday, toWeek: addDays(monday, 21) };
}

/** ข้อความช่วงสัปดาห์ { start, end } สำหรับ `range.week` — "16–22 พ.ย." ถ้าเดือนเดียวกันตัดเดือนหน้าตัวเลขแรก · ห้ามเลขสัปดาห์ */
export function weekRangeValues(monday: DateISO, locale: CalendarLocale): { start: string; end: string } {
  const sunday = addDays(monday, 6);
  const end = format(sunday, { locale, style: "day-month" });
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  const start = sameMonth ? String(Number(monday.slice(8, 10))) : format(monday, { locale, style: "day-month" });
  return { start, end };
}

/** เดือน ตามภาษา ("พฤศจิกายน พ.ศ. 2569" / "November 2026") */
/** ช่วงเวลา "09:00–18:00" — word joiner รอบขีดกลาง ไม่ตัดบรรทัดตรงขีด */
export const timeRangeText = (start: string, end: string): string => `${start}⁠–⁠${end}`;

/** ช่วงวันที่ในแถวรายการ: ปีเดียวกัน "1–30 พ.ย. 2569" / "1 พ.ย.–30 ธ.ค. 2569" · ต่างปีใช้ date-medium ทั้งสองข้าง */
export function dateSpanText(start: DateISO, end: DateISO, locale: CalendarLocale): string {
  const endMed = format(end, { locale, style: "date-medium" });
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${format(start, { locale, style: "date-medium" })} – ${endMed}`;
  const startText = start.slice(0, 7) === end.slice(0, 7) ? String(Number(start.slice(8, 10))) : format(start, { locale, style: "day-month" });
  return `${startText}⁠–⁠${endMed}`;
}

export const monthLabel = (ym: string, locale: CalendarLocale): string => format(monthStartOf(ym), { locale, style: "month-year" });

// ───────── แผน / สรุป ─────────
export interface RoutineProblem {
  pos: "banner" | "weekdays" | "time" | "range" | "to" | "summary";
  /** ข้อความหนึ่งหรือหลายบรรทัด (เช่น rate limit + เวลารอ) */
  refs: MessageRef[];
}
const ref = (key: string, values: Record<string, string | number> = {}): MessageRef => ({ key, values });
const problem = (pos: RoutineProblem["pos"], ...refs: MessageRef[]): RoutineProblem => ({ pos, refs });

export type RoutineSummary =
  /** ยังไม่เลือกวัน / เวลาจบ = เริ่ม — ยังไม่สรุป */
  | { kind: "none" }
  /** อินพุตที่ client รู้แล้วว่าเซิร์ฟเวอร์จะปฏิเสธ (ช่วงจบไปแล้ว, DST ฯลฯ) */
  | { kind: "invalid"; problem: RoutineProblem }
  | { kind: "zero"; rangeStart: DateISO; rangeEnd: DateISO }
  | { kind: "ok"; count: number; rangeStart: DateISO; rangeEnd: DateISO; pastStart: boolean };

export interface PlanOptions {
  /** แก้ "ตั้งแต่ช่วงนี้ไป" ที่แยกชุด: วันแรกของชุดใหม่ (ช่วงเริ่มที่นี่) */
  splitStart?: DateISO;
}

export const rangeInput = (s: RoutineFormState) =>
  s.rangeKind === "weeks"
    ? ({ rangeKind: "weeks", fromWeek: s.fromWeek, toWeek: s.toWeek } as const)
    : ({ rangeKind: "months", fromMonth: s.fromMonth, toMonth: s.toMonth } as const);

/** จำนวนวัน/ช่วงที่จะลง — ใช้ planRoutine ตัวเดียวกับเซิร์ฟเวอร์ (ไม่นับเอง) · now = epoch ms ณ ตอนนี้ (clock.now()) */
export function summarize(s: RoutineFormState, now: number, opts: PlanOptions = {}): RoutineSummary {
  if (s.weekdays.length === 0 || timeInvalid(s)) return { kind: "none" };
  const r = planRoutine(
    {
      range: rangeInput(s),
      weekdays: s.weekdays,
      allDay: s.allDay,
      ...(s.allDay ? {} : { startTime: s.startTime, endTime: s.endTime }),
      tz: DEFAULT_TZ,
    },
    {
      now,
      maxWeeks: MAX_WEEKS,
      maxMonths: MAX_MONTHS,
      maxAheadMonths: BUSY_ROUTINE_MAX_AHEAD_MONTHS,
      requireOccurrence: false,
      ...(opts.splitStart !== undefined ? { startDate: opts.splitStart } : {}),
    },
  );
  if (!r.ok) return { kind: "invalid", problem: planProblem(r.error.code, s.rangeKind) };
  const today = todayIn(DEFAULT_TZ, now);
  const { rule, rows } = r.value;
  if (rows.length === 0) return { kind: "zero", rangeStart: rule.startDate, rangeEnd: rule.endDate };
  return { kind: "ok", count: rows.length, rangeStart: rule.startDate, rangeEnd: rule.endDate, pastStart: rule.startDate < today };
}

/** รหัสของ planRoutine → ข้อความ (ตรงกับที่เซิร์ฟเวอร์ตอบ — routineInputError) */
function planProblem(code: string, kind: RoutineRangeKind): RoutineProblem {
  switch (code) {
    case "RANGE_ENDED":
      return problem("range", ref("busy.routine.error.ended"));
    case "SPAN_TOO_LONG":
      return problem("range", kind === "weeks" ? ref("busy.routine.error.spanWeeks", { max: MAX_WEEKS }) : ref("busy.routine.error.spanMonths", { max: MAX_MONTHS }));
    case "TOO_FAR_AHEAD":
      return problem("to", ref("busy.routine.error.ahead", { max: BUSY_ROUTINE_MAX_AHEAD_MONTHS }));
    case "INVALID_LOCAL_TIME":
      return problem("time", ref("busy.routine.error.dst"));
    case "INVALID_RANGE":
      return problem("range", ref("errors.INVALID_RANGE", { kind: "dates" }));
    default:
      return problem("banner", ref("busy.routine.error.generic"));
  }
}

/** ปุ่มบันทึกกดได้ไหม: เลือกวัน เวลาถูก และสรุปเป็น ok (0 วัน/ผิดเงื่อนไข = ปิด) */
export const canSubmit = (s: RoutineFormState, summary: RoutineSummary): boolean => s.weekdays.length > 0 && !timeInvalid(s) && summary.kind === "ok";

// ───────── payload ─────────
export interface RoutinePayload {
  rangeKind: RoutineRangeKind;
  fromWeek?: DateISO;
  toWeek?: DateISO;
  fromMonth?: string;
  toMonth?: string;
  weekdays: number[];
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  title: string | null;
  note: string | null;
  hideDetail: boolean;
  /** แก้ "ตั้งแต่…ไป" เท่านั้น */
  from?: DateISO;
}

const cleanText = (v: string): string | null => {
  const t = v.normalize("NFC").trim();
  return t === "" ? null : t;
};

/** ฟอร์ม → body ของ POST/PATCH (ไม่ส่ง tz — เซิร์ฟเวอร์ใช้ DEFAULT_TZ / tz เดิมของชุด · .strict() ไม่มีฟิลด์เกิน) */
export function buildRoutinePayload(s: RoutineFormState, opts: { from?: DateISO } = {}): RoutinePayload {
  return {
    ...(s.rangeKind === "weeks" ? { rangeKind: "weeks" as const, fromWeek: s.fromWeek, toWeek: s.toWeek } : { rangeKind: "months" as const, fromMonth: s.fromMonth, toMonth: s.toMonth }),
    weekdays: [...s.weekdays],
    allDay: s.allDay,
    ...(s.allDay ? {} : { startTime: s.startTime, endTime: s.endTime }),
    title: cleanText(s.title),
    note: cleanText(s.note),
    hideDetail: s.hideDetail,
    ...(opts.from !== undefined ? { from: opts.from } : {}),
  };
}

// ───────── routine จากเซิร์ฟเวอร์ → ฟอร์มแก้ ─────────
export type EditScope = "all" | "from";

/**
 * ค่าเริ่มของฟอร์มแก้
 * - all: ตั้งแต่ = ช่วงที่มีวันนี้ (ถ้าชุดเริ่มก่อนนั้น) — วันที่ผ่านแล้วไม่ถูกแก้ และต่ออายุชุดที่ยาวได้ไม่ชนเพดานความยาว (เซิร์ฟเวอร์คิดความยาวจากช่วงที่ส่ง)
 * - from: ตั้งแต่ = ช่วงที่เลือก (periodStart) · ล็อกในฟอร์ม
 */
export function formStateOfRoutine(r: RoutineView, scope: EditScope, periodStart: DateISO, today: DateISO): RoutineFormState {
  const thisPeriod = routinePeriodStart(today, r.rangeKind);
  const start = scope === "from" ? periodStart : r.startDate > thisPeriod ? r.startDate : thisPeriod;
  const base = initialRoutineState(today);
  return {
    ...base,
    weekdays: [...r.weekdays],
    allDay: r.allDay,
    startTime: r.startTime ?? "09:00",
    endTime: r.endTime ?? "10:00",
    rangeKind: r.rangeKind,
    fromWeek: r.rangeKind === "weeks" ? start : base.fromWeek,
    // ต่ออายุชุดที่จบแล้ว: วันจบเดิมอยู่ก่อน "ตั้งแต่" → ตั้ง "ถึง" = "ตั้งแต่" (ไม่เปิดมาพร้อม error ช่วงกลับด้าน)
    toWeek: r.rangeKind === "weeks" ? (startOfWeek(r.endDate) < start ? start : startOfWeek(r.endDate)) : base.toWeek,
    fromMonth: r.rangeKind === "months" ? ymOf(start) : base.fromMonth,
    toMonth: r.rangeKind === "months" ? (ymOf(r.endDate) < ymOf(start) ? ymOf(start) : ymOf(r.endDate)) : base.toMonth,
    title: r.title ?? "",
    note: r.note ?? "",
    hideDetail: r.hidden,
  };
}

// ───────── รายการ "แบบประจำของฉัน" ─────────
export const isEnded = (r: Pick<RoutineView, "endDate">, today: DateISO): boolean => r.endDate < today;
export const canExtend = (r: Pick<RoutineView, "endDate" | "remaining">, today: DateISO): boolean => isEnded(r, today) || r.remaining <= EXTEND_WITHIN_DAYS;

/** ที่ยังไม่จบก่อน (ลำดับเดิมจากเซิร์ฟเวอร์) แล้วที่จบแล้ว */
export function splitRoutines(list: readonly RoutineView[], today: DateISO): { active: RoutineView[]; ended: RoutineView[] } {
  return { active: list.filter((r) => !isEnded(r, today)), ended: list.filter((r) => isEnded(r, today)) };
}

export const nearRoutineLimit = (activeCount: number): boolean => activeCount >= NEAR_LIMIT_FROM;

// ───────── ขอบเขตแก้/ลบ ─────────
export type ScopeAction = "edit" | "delete";
export type ScopeChoice = "one" | "from" | "all";

export interface ScopeTarget {
  routine: RoutineView;
  /** แตะวันของ routine ในปฏิทิน = วันนั้น (busyId ของแถวและวันเริ่ม) · แตะแถวในรายการ = null */
  day: { busyId: string; date: DateISO } | null;
}

/**
 * ตัวเลือกขอบเขต: แถววัน → "one" ก่อน · "from" ซ่อนเมื่อช่วงอ้างอิงคือช่วงแรกของชุด (ผลเท่ากับทั้งหมด) หรือชุดจบแล้ว · "all" มีเสมอ
 * อ้างอิง: แถววัน = ช่วงของวันที่แตะ · แถวรายการ = ช่วงที่กำลังเป็นอยู่ (ยังไม่เริ่ม → ช่วงแรกของชุด)
 */
export function scopeChoices(t: ScopeTarget, today: DateISO): { choices: ScopeChoice[]; periodStart: DateISO } {
  const { routine: r } = t;
  const ref = t.day ? t.day.date : today < r.startDate ? r.startDate : today > r.endDate ? r.endDate : today;
  const periodStart = routinePeriodStart(ref, r.rangeKind);
  const choices: ScopeChoice[] = [];
  if (t.day) choices.push("one");
  if (!isEnded(r, today) && periodStart > r.startDate && periodStart <= r.endDate) choices.push("from");
  choices.push("all");
  return { choices, periodStart };
}

export interface RoutineRequest {
  method: "PATCH" | "DELETE";
  path: string;
  body?: RoutinePayload;
}

/** ขอบเขต → คำขอ API (ตาม ADR 0012 §5): ลบ one = DELETE /busy/:id · from = ?from= · all = ไม่ส่ง from */
export function deleteRequest(choice: ScopeChoice, t: ScopeTarget, periodStart: DateISO): RoutineRequest {
  if (choice === "one") return { method: "DELETE", path: `/api/me/busy/${encodeURIComponent(t.day?.busyId ?? "")}` };
  const base = `/api/me/busy-routines/${encodeURIComponent(t.routine.id)}`;
  return choice === "from" ? { method: "DELETE", path: `${base}?from=${periodStart}` } : { method: "DELETE", path: base };
}

/** แก้ from/all → PATCH /busy-routines/:id (from เฉพาะ "ตั้งแต่…ไป") · "one" ไม่ผ่านที่นี่ (เปิดฟอร์ม busy เดิม แล้ว PATCH /busy/:id) */
export function updateRequest(routineId: string, s: RoutineFormState, scope: EditScope, periodStart: DateISO): RoutineRequest {
  return {
    method: "PATCH",
    path: `/api/me/busy-routines/${encodeURIComponent(routineId)}`,
    body: buildRoutinePayload(s, scope === "from" ? { from: periodStart } : {}),
  };
}

/** แก้ "ตั้งแต่ช่วงนี้ไป" แยกชุดหรือไม่ — ตรงกับเงื่อนไขเซิร์ฟเวอร์: ช่วงเริ่ม > วันนี้ และ > วันแรกของชุด */
export const isSplitEdit = (r: Pick<RoutineView, "startDate">, scope: EditScope, periodStart: DateISO, today: DateISO): boolean => scope === "from" && periodStart > today && periodStart > r.startDate;

export type RoutineDone =
  | { type: "created"; count: number }
  | { type: "updated" }
  | { type: "deletedOne" }
  | { type: "stopped"; periodStart: DateISO; rangeKind: RoutineRangeKind }
  | { type: "deletedAll" }
  | { type: "gone" };

/** ผลสำเร็จ → ข้อความ toast (stopped: {date} = วันเริ่มของสัปดาห์/เดือนที่เลือก) */
export function doneRef(d: RoutineDone, locale: CalendarLocale): MessageRef {
  switch (d.type) {
    case "created":
      return ref("busy.routine.toast.saved", { count: d.count });
    case "updated":
      return ref("busy.routine.toast.updated");
    case "deletedOne":
      return ref("busy.routine.toast.deletedOne");
    case "stopped":
      return ref("busy.routine.toast.stopped", { date: d.rangeKind === "weeks" ? format(d.periodStart, { locale, style: "date-long" }) : monthLabel(ymOf(d.periodStart), locale) });
    case "deletedAll":
      return ref("busy.routine.toast.deletedAll");
    case "gone":
      return ref("busy.routine.error.gone");
  }
}

// ───────── error → ตำแหน่ง/ข้อความ ─────────
type Failure = Extract<FullResult<unknown> | ApiResult<unknown>, { ok: false }>;

export type RoutineMode = "create" | "edit" | "editSplit";

export type RoutineFailure =
  | { type: "problem"; problem: RoutineProblem }
  /** NOT_FOUND — รายการหายไปแล้ว: ปิด sheet + รีเฟรชรายการ */
  | { type: "gone" }
  /** CONFLICT — ถูกแก้ซ้อน (updated_at เปลี่ยน): รีเฟรชรายการแล้วให้ลองอีกครั้ง (แบนเนอร์ error.save) */
  | { type: "conflict"; problem: RoutineProblem };

function rateRefs(values: Record<string, string | number>): MessageRef[] {
  const out = [ref("busy.routine.error.rate")];
  const sec = values.retryAfterSec;
  if (typeof sec === "number" && Number.isFinite(sec) && sec > 0) {
    out.push(sec <= 60 ? ref("appointments.rateRetry", { n: Math.ceil(sec), unit: "sec" }) : ref("appointments.rateRetry", { n: Math.ceil(sec / 60), unit: "min" }));
  }
  return out;
}

/**
 * ทุกรูป error ของเซิร์ฟเวอร์ → ข้อความ busy.routine.error.* (design §6)
 * - routines: สร้าง = routines · แก้แยกชุดที่ชนเพดานแข็ง 20 = routinesEdit · (ต่ออายุชุดที่จบแล้วตอนเต็ม 10 = routines)
 * - NO_OCCURRENCE: สร้าง/แก้แยกชุด = noOccurrence (ใกล้สรุป) · แก้ในที่ = noOccurrenceEdit
 * - routineSpan: spanWeeks/spanMonths ตามชนิดช่วง · routineAhead ใต้ช่อง "ถึง"
 */
export function mapRoutineFailure(res: Failure, ctx: { mode: RoutineMode; rangeKind: RoutineRangeKind }): RoutineFailure {
  const generic = problem("banner", ref("busy.routine.error.generic"));
  if (res.kind === "network") return { type: "problem", problem: generic };
  const { code, values } = res.error;
  const fields = "fields" in res ? res.fields : {};
  const maxOf = (fallback: number): number => (typeof values.max === "number" ? values.max : fallback);
  switch (code) {
    case "NOT_FOUND":
      return { type: "gone" };
    case "CONFLICT":
      return { type: "conflict", problem: problem("banner", ref("busy.routine.error.save")) };
    case "RATE_LIMITED":
      return { type: "problem", problem: problem("banner", ...rateRefs(values)) };
    case "LIMIT_REACHED": {
      const limit = typeof values.limit === "string" ? values.limit : "";
      switch (limit) {
        case "routines": {
          const max = maxOf(BUSY_ROUTINE_MAX_ACTIVE);
          const split = ctx.mode !== "create" && max >= BUSY_ROUTINE_HARD_MAX_ACTIVE;
          return { type: "problem", problem: problem("banner", ref(split ? "busy.routine.error.routinesEdit" : "busy.routine.error.routines", { max })) };
        }
        case "routineRows":
          return { type: "problem", problem: problem("banner", ref("busy.routine.error.routineRows", { max: maxOf(1500) })) };
        case "routineSpan": {
          const kind = values.rangeKind === "weeks" || values.rangeKind === "months" ? values.rangeKind : ctx.rangeKind;
          return { type: "problem", problem: problem("range", kind === "weeks" ? ref("busy.routine.error.spanWeeks", { max: maxOf(MAX_WEEKS) }) : ref("busy.routine.error.spanMonths", { max: maxOf(MAX_MONTHS) })) };
        }
        case "routineAhead":
          return { type: "problem", problem: problem("to", ref("busy.routine.error.ahead", { max: maxOf(BUSY_ROUTINE_MAX_AHEAD_MONTHS) })) };
        default:
          return { type: "problem", problem: problem("banner", ref("errors.LIMIT_REACHED", { limit, ...(typeof values.max === "number" ? { max: values.max } : {}) })) };
      }
    }
    case "INVALID_RANGE":
      if (values.kind === "time") return { type: "problem", problem: problem("time", ref("busy.routine.error.end")) };
      if (values.reason === "ENDED") return { type: "problem", problem: problem("range", ref("busy.routine.error.ended")) };
      return { type: "problem", problem: problem("range", ref("errors.INVALID_RANGE", { kind: "dates" })) };
    case "INVALID_LOCAL_TIME":
      return { type: "problem", problem: problem("time", ref("busy.routine.error.dst")) };
    case "TIME_NOT_ON_STEP":
      return { type: "problem", problem: problem("time", ref("errors.TIME_NOT_ON_STEP")) };
    case "INVALID_DATE":
    case "DATE_OUT_OF_RANGE":
      return { type: "problem", problem: problem("range", ref(`errors.${code}`)) };
    case "VALIDATION":
      if (fields.weekdays === "REQUIRED") return { type: "problem", problem: problem("weekdays", ref("busy.routine.error.weekdaysRequired")) };
      if (fields.weekdays === "NO_OCCURRENCE") {
        return { type: "problem", problem: ctx.mode === "edit" ? problem("banner", ref("busy.routine.error.noOccurrenceEdit")) : problem("summary", ref("busy.routine.error.noOccurrence")) };
      }
      return { type: "problem", problem: generic };
    default:
      return { type: "problem", problem: generic };
  }
}

/** ข้อความล้มเหลวของการลบ (ใน sheet ขอบเขต): NOT_FOUND = หายแล้ว (gone) · RATE_LIMITED = rate · อื่นๆ = generic */
export function mapDeleteFailure(res: Failure): RoutineFailure {
  if (res.kind === "network") return { type: "problem", problem: problem("banner", ref("busy.routine.error.generic")) };
  const { code, values } = res.error;
  if (code === "NOT_FOUND") return { type: "gone" };
  if (code === "RATE_LIMITED") return { type: "problem", problem: problem("banner", ...rateRefs(values)) };
  if (code === "CONFLICT") return { type: "conflict", problem: problem("banner", ref("busy.routine.error.save")) };
  return { type: "problem", problem: problem("banner", ref("busy.routine.error.generic")) };
}
