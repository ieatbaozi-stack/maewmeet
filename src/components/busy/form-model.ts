// โมเดลฟอร์มลง/แก้ busy (R3) — ล้วน ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/busy-form-model.test.ts
// ส่งวันที่ ISO ค.ศ. เสมอ (ADR 0004 §6) · เวลาเป็น 'HH:mm' ทีละ 30 นาที · คำนวณวันผ่าน src/lib/calendar เท่านั้น
import { addDays, compareDates, expandDailyBusyInput, parseLocalDateTime, DEFAULT_TZ, spanDays, STEP_MINUTES, type DateISO } from "@/lib/calendar";
import type { ApiResult } from "@/components/auth/api";
import type { MessageRef, OwnBusy } from "@/components/calendar/model";
import { hhmm, whenPartsOfOwn } from "@/components/calendar/model";
import { BUSY_MAX_BACKDATE_DAYS, BUSY_MAX_TIMED_DAYS, BUSY_NOTE_MAX, BUSY_TITLE_MAX } from "@/lib/shared/limits";

export type BusyKindChoice = "allDay" | "timed" | "multi";
/** R6F: โหมด "หลายวัน" — ทั้งวัน (เดิม) | เฉพาะช่วงเวลา (ส่ง kind:"daily") */
export type BusyScope = "allDay" | "daily";

export const TITLE_MAX = BUSY_TITLE_MAX;
export const NOTE_MAX = BUSY_NOTE_MAX;
export const BACKDATE_DAYS = BUSY_MAX_BACKDATE_DAYS;

/** ตัวเลือกเวลา 00:00 … 23:30 (ทีละ 30 นาที) */
export const TIME_OPTIONS: readonly string[] = Array.from({ length: (24 * 60) / STEP_MINUTES }, (_, i) => hhmm(i * STEP_MINUTES));

export interface BusyFormState {
  kind: BusyKindChoice;
  /** ใช้เฉพาะ kind = "multi" (ลงใหม่) */
  scope: BusyScope;
  /** ช่วงที่เลือกในตัวเลือกวัน (ปลายรวม) · null = ยังไม่เลือก */
  pickStart: DateISO | null;
  pickEnd: DateISO | null;
  startTime: string;
  endTime: string;
  title: string;
  note: string;
  hideDetail: boolean;
}

/** วันแรกที่เลือกได้ = วันนี้ − 7 (R3_CONTRACT: ลงย้อนหลังได้ไม่เกิน 7 วัน) */
export const minPickDate = (today: DateISO): DateISO => addDays(today, -BACKDATE_DAYS);

export function initialFormState(defaultDate: DateISO): BusyFormState {
  return { kind: "allDay", scope: "allDay", pickStart: defaultDate, pickEnd: defaultDate, startTime: "09:00", endTime: "10:00", title: "", note: "", hideDetail: false };
}

/** รายการของฉัน → สถานะฟอร์มแก้ไข */
export function formStateOfOwn(item: OwnBusy): BusyFormState {
  const base = { title: item.title ?? "", note: item.note ?? "", hideDetail: item.hidden };
  const p = whenPartsOfOwn(item);
  if (item.allDay) {
    return { kind: item.localStartDate === item.localEndDate ? "allDay" : "multi", scope: "allDay", pickStart: item.localStartDate, pickEnd: item.localEndDate, startTime: "09:00", endTime: "10:00", ...base };
  }
  // timed: ปลายช่วงเก็บเป็นวัน/เวลาจริงของ instant สิ้นสุด (จบ 00:00 ของวันถัดไป = วันถัดไป เวลา 00:00)
  return { kind: "timed", scope: "allDay", pickStart: p.startDate, pickEnd: p.endDate, startTime: p.startTime ?? "09:00", endTime: p.endTime ?? "10:00", ...base };
}

/** เปลี่ยนแบบฟอร์ม → ค่าที่ต้องแก้ใน state: ทั้งวัน/ช่วงเวลา ต้องไม่พ่วงช่วงหลายวันเดิมไป (กัน busy 769 ชม.) → วันจบ = วันเริ่ม */
export function kindChangePatch(s: Pick<BusyFormState, "pickStart" | "pickEnd">, kind: BusyKindChoice): Partial<BusyFormState> {
  if ((kind === "allDay" || kind === "timed") && s.pickStart) return { kind, pickEnd: s.pickStart };
  return { kind };
}

/**
 * วัน/เวลาสิ้นสุดจริงของแบบ "ช่วงเวลา"
 * - เลือกวันเดียว: เวลาจบ < เวลาเริ่ม → ข้ามเที่ยงคืน (วันจบ = วันถัดไป) · เวลาจบ = เวลาเริ่ม → ผิด (INVALID_RANGE)
 * - เลือกหลายวัน: วันจบ = วันสุดท้ายที่เลือก
 */
export function resolveTimedEnd(s: Pick<BusyFormState, "pickStart" | "pickEnd" | "startTime" | "endTime">): { endDate: DateISO; overnight: boolean } | null {
  if (!s.pickStart || !s.pickEnd) return null;
  if (s.pickEnd !== s.pickStart) return { endDate: s.pickEnd, overnight: true };
  if (s.endTime < s.startTime) return { endDate: addDays(s.pickStart, 1), overnight: true };
  return { endDate: s.pickStart, overnight: false };
}

/** ความยาวรวมเป็นนาทีของแบบช่วงเวลา (null = คำนวณไม่ได้/ผิดช่วง) */
export function timedMinutes(s: BusyFormState): number | null {
  const end = resolveTimedEnd(s);
  if (!end || !s.pickStart) return null;
  try {
    const a = parseLocalDateTime(s.pickStart, s.startTime, DEFAULT_TZ);
    const b = parseLocalDateTime(end.endDate, s.endTime, DEFAULT_TZ);
    return b > a ? Math.round((b - a) / 60_000) : null;
  } catch {
    return null;
  }
}

export interface DurationRef {
  key: "busy.duration.min" | "busy.duration.hour" | "busy.duration.hourMin";
  values: Record<string, number>;
}

/** < 60 → นาที · ลงตัว → ชม. · ไม่ลงตัว → ชม. + นาที */
export function durationRef(totalMin: number): DurationRef {
  const total = Math.max(0, Math.trunc(totalMin));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return { key: "busy.duration.min", values: { minutes } };
  if (minutes === 0) return { key: "busy.duration.hour", values: { hours } };
  return { key: "busy.duration.hourMin", values: { hours, minutes } };
}

/**
 * แตะวัน → ช่วงใหม่ (UX X30)
 * single: วันเดียวแล้วเสร็จ · range: แตะแรก = เริ่ม (ปลาย = เริ่ม) แล้วแตะวันหลังหรือวันเดิมอีกครั้ง = วันสุดท้าย (เสร็จ) · แตะวันก่อนวันเริ่ม = เริ่มใหม่
 */
export function pickDate(
  mode: "single" | "range",
  cur: { start: DateISO | null; end: DateISO | null; pending: boolean },
  date: DateISO,
): { start: DateISO; end: DateISO; pending: boolean; done: boolean } {
  if (mode === "single") return { start: date, end: date, pending: false, done: true };
  if (cur.pending && cur.start !== null && date >= cur.start) return { start: cur.start, end: date, pending: false, done: true };
  return { start: date, end: date, pending: true, done: false };
}

// ───────── form → payload ─────────
export interface BusyPayload {
  kind: "all_day" | "timed" | "daily";
  startDate: DateISO;
  endDate: DateISO;
  startTime?: string;
  endTime?: string;
  tz?: string;
  title: string | null;
  note: string | null;
  hideDetail: boolean;
}

/** ตำแหน่งแสดงข้อผิดพลาด (UX 7.5) */
export type ErrorPos = "date" | "time" | "banner";
export interface FormProblem {
  pos: ErrorPos;
  ref: MessageRef;
}

const cleanText = (v: string): string | null => {
  const t = v.normalize("NFC").trim();
  return t === "" ? null : t;
};
/** จำนวน code point (เหมือนฝั่งเซิร์ฟเวอร์) */
export const textLength = (v: string): number => [...v.normalize("NFC").trim()].length;

export type PayloadResult = { ok: true; payload: BusyPayload } | { ok: false; problem: FormProblem };

/** ตรวจก่อนส่ง (เซิร์ฟเวอร์ตัดสินจริงอีกครั้ง) แล้วประกอบ payload: ทั้งวัน/หลายวัน → all_day · ช่วงเวลา → timed · tz ส่งเฉพาะตอนแก้ (คง tz เดิมของรายการ) */
export function buildPayload(s: BusyFormState, opts: { tz?: string } = {}): PayloadResult {
  const meta = { title: cleanText(s.title), note: cleanText(s.note), hideDetail: s.hideDetail };
  const tz = opts.tz !== undefined ? { tz: opts.tz } : {};
  if (!s.pickStart || !s.pickEnd) return { ok: false, problem: { pos: "date", ref: { key: "busy.form.date.none", values: {} } } };

  if (s.kind === "allDay") return { ok: true, payload: { kind: "all_day", startDate: s.pickStart, endDate: s.pickStart, ...tz, ...meta } };
  if (s.kind === "multi") {
    if (compareDates(s.pickEnd, s.pickStart) < 0) return { ok: false, problem: { pos: "date", ref: { key: "errors.INVALID_RANGE", values: { kind: "dates" } } } };
    if (s.scope === "daily") {
      // เวลาเดิมทุกวัน ต้องจบวันเดียวกัน (ยังไม่รองรับข้ามเที่ยงคืน) · เซิร์ฟเวอร์ตัดสินจริงอีกครั้ง
      if (s.endTime <= s.startTime) return { ok: false, problem: { pos: "time", ref: { key: "busy.form.error.daily.end", values: {} } } };
      return { ok: true, payload: { kind: "daily", startDate: s.pickStart, endDate: s.pickEnd, startTime: s.startTime, endTime: s.endTime, ...tz, ...meta } };
    }
    return { ok: true, payload: { kind: "all_day", startDate: s.pickStart, endDate: s.pickEnd, ...tz, ...meta } };
  }
  const end = resolveTimedEnd(s);
  if (!end) return { ok: false, problem: { pos: "date", ref: { key: "busy.form.date.none", values: {} } } };
  // เวลาจบเท่าเวลาเริ่มในวันเดียว = ช่วงว่างเปล่า
  if (s.pickStart === s.pickEnd && s.endTime === s.startTime) return { ok: false, problem: { pos: "time", ref: { key: "errors.INVALID_RANGE", values: { kind: "time" } } } };
  return { ok: true, payload: { kind: "timed", startDate: s.pickStart, startTime: s.startTime, endDate: end.endDate, endTime: s.endTime, ...tz, ...meta } };
}

/** จำนวนวันของแบบหลายวัน (ใช้แสดง "รวม N วัน") */
export const totalDays = (s: Pick<BusyFormState, "pickStart" | "pickEnd">): number | null => (s.pickStart && s.pickEnd ? spanDays(s.pickStart, s.pickEnd) : null);

/**
 * สรุปก่อนบันทึกของ "เฉพาะช่วงเวลา": จำนวนวัน = จำนวนแถวที่ expandDailyBusyInput ให้ (ตัวเดียวกับเซิร์ฟเวอร์ — ไม่นับเอง)
 * null = ยังสรุปไม่ได้ (ยังเลือกไม่ครบ/เวลาจบ ≤ เริ่ม/เกิน 62 วัน — เซิร์ฟเวอร์ตัดสินและแจ้งเหตุตอนบันทึก)
 */
export function dailySummary(s: Pick<BusyFormState, "kind" | "scope" | "pickStart" | "pickEnd" | "startTime" | "endTime">): { count: number; start: string; end: string } | null {
  if (s.kind !== "multi" || s.scope !== "daily" || !s.pickStart || !s.pickEnd) return null;
  const r = expandDailyBusyInput(
    { kind: "daily", startDate: s.pickStart, endDate: s.pickEnd, startTime: s.startTime, endTime: s.endTime, tz: DEFAULT_TZ },
    { maxDays: BUSY_MAX_TIMED_DAYS },
  );
  return r.ok ? { count: r.value.length, start: s.startTime, end: s.endTime } : null;
}

// ───────── error → ตำแหน่ง/ข้อความ ─────────
type Failure = Extract<ApiResult<unknown>, { ok: false }>;

export type SaveFailure =
  | { type: "problem"; problem: FormProblem; invalidTime: boolean; invalidDate: boolean }
  /** รายการไม่มีแล้ว (ลบจากเครื่องอื่น/404): ปิด sheet แล้วรีเฟรชรายการ */
  | { type: "gone" };

/**
 * รหัสผิดพลาดของ API → ตำแหน่ง + ข้อความ (UX 7.5 "จับคู่ error → ตำแหน่ง")
 * INVALID_RANGE/TIME_NOT_ON_STEP/INVALID_LOCAL_TIME → ใต้แถวเวลา · INVALID_DATE/DATE_OUT_OF_RANGE/busyBackdate → ใต้ปุ่มวัน ·
 * busyCount/busySpan → แถบ alert เหนือฟอร์ม · NOT_FOUND → gone · VALIDATION → errors.VALIDATION · อื่นๆ/เครือข่าย → busy.form.error.save
 */
export function mapSaveFailure(res: Failure, kind: BusyKindChoice): SaveFailure {
  const problem = (pos: ErrorPos, ref: MessageRef, extra: { invalidTime?: boolean; invalidDate?: boolean } = {}): SaveFailure => ({
    type: "problem",
    problem: { pos, ref },
    invalidTime: extra.invalidTime ?? false,
    invalidDate: extra.invalidDate ?? false,
  });
  if (res.kind === "network") return problem("banner", { key: "busy.form.error.save", values: {} });
  const { code, values } = res.error;
  switch (code) {
    case "NOT_FOUND":
      return { type: "gone" };
    case "INVALID_RANGE": {
      const dates = kind !== "timed";
      return problem(dates ? "date" : "time", { key: "errors.INVALID_RANGE", values: { kind: dates ? "dates" : "time" } }, dates ? { invalidDate: true } : { invalidTime: true });
    }
    case "TIME_NOT_ON_STEP":
    case "INVALID_LOCAL_TIME":
      return problem("time", { key: `errors.${code}`, values: {} }, { invalidTime: true });
    case "INVALID_DATE":
    case "DATE_OUT_OF_RANGE":
      return problem("date", { key: `errors.${code}`, values: {} }, { invalidDate: true });
    case "LIMIT_REACHED": {
      const limit = typeof values.limit === "string" ? values.limit : "";
      const ref: MessageRef = { key: "errors.LIMIT_REACHED", values: { limit, ...(typeof values.max === "number" ? { max: values.max } : {}) } };
      return limit === "busyBackdate" ? problem("date", ref, { invalidDate: true }) : problem("banner", ref);
    }
    case "VALIDATION":
      return problem("banner", { key: "errors.VALIDATION", values: {} });
    default:
      return problem("banner", { key: "busy.form.error.save", values: {} });
  }
}

/**
 * R6F: error ของ POST kind:"daily" → ข้อความ busy.form.error.daily.* (ทุกข้อบอกว่ายังไม่ได้บันทึกสักวัน · ฟอร์มคงค่า)
 * LIMIT_REACHED busyCount/busySpan → banner · busyBackdate → ใต้ปุ่มวัน · INVALID_RANGE kind=time → ใต้แถวเวลา · RATE_LIMITED → daily.rate ·
 * รหัสทั่วไปของวัน/เวลา (INVALID_DATE, TIME_NOT_ON_STEP …) ใช้ errors.* เดิม · อื่นๆ/เครือข่าย → daily.generic
 */
export function mapDailySaveFailure(res: Failure): SaveFailure {
  const problem = (pos: ErrorPos, ref: MessageRef, extra: { invalidTime?: boolean; invalidDate?: boolean } = {}): SaveFailure => ({
    type: "problem",
    problem: { pos, ref },
    invalidTime: extra.invalidTime ?? false,
    invalidDate: extra.invalidDate ?? false,
  });
  const generic = () => problem("banner", { key: "busy.form.error.daily.generic", values: {} });
  if (res.kind === "network") return generic();
  const { code, values } = res.error;
  const max: Record<string, number> = typeof values.max === "number" ? { max: values.max } : {};
  switch (code) {
    case "LIMIT_REACHED": {
      const limit = typeof values.limit === "string" ? values.limit : "";
      if (limit === "busyCount") return problem("banner", { key: "busy.form.error.daily.count", values: max });
      if (limit === "busySpan") return problem("banner", { key: "busy.form.error.daily.span", values: max });
      if (limit === "busyBackdate") return problem("date", { key: "busy.form.error.daily.backdate", values: max }, { invalidDate: true });
      return generic();
    }
    case "INVALID_RANGE":
      return values.kind === "time"
        ? problem("time", { key: "busy.form.error.daily.end", values: {} }, { invalidTime: true })
        : problem("date", { key: "errors.INVALID_RANGE", values: { kind: "dates" } }, { invalidDate: true });
    case "RATE_LIMITED":
      return problem("banner", { key: "busy.form.error.daily.rate", values: {} });
    case "TIME_NOT_ON_STEP":
    case "INVALID_LOCAL_TIME":
      return problem("time", { key: `errors.${code}`, values: {} }, { invalidTime: true });
    case "INVALID_DATE":
    case "DATE_OUT_OF_RANGE":
      return problem("date", { key: `errors.${code}`, values: {} }, { invalidDate: true });
    case "VALIDATION":
      return problem("banner", { key: "errors.VALIDATION", values: {} });
    default:
      return generic();
  }
}
