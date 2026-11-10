// โมเดลล้วนของนัด (R4B) — ฟอร์ม→payload · error→ช่อง · ค่าตั้งต้นจากช่วงว่าง · view-model เตือนนัดทับ · RSVP optimistic
// ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/appointments-model.test.ts · วัน/เวลาคำนวณผ่าน src/lib/calendar เท่านั้น (ห้าม new Date)
import { addDays, parseLocalDateTime, toLocal, STEP_MINUTES, type CalendarLocale, type DateISO, type EpochMs } from "@/lib/calendar";
import { format } from "@/lib/calendar";
import { whenRef, type BusyKind, type MessageRef } from "@/components/calendar/model";
import type { Failure } from "./api";
import type { AppointmentDetailDto, AppointmentDto, OverlapDto, PersonDto, RsvpCountsDto, RsvpDetailDto } from "@/lib/data/serializers/appointments";
import { APPOINTMENT_DESCRIPTION_MAX, APPOINTMENT_MAX_BACKDATE_MS, APPOINTMENT_PLACE_NAME_MAX, APPOINTMENT_TITLE_MAX } from "@/lib/shared/limits";

export type Rsvp = "going" | "maybe" | "not_going";
export const RSVP_ANSWERS: readonly Rsvp[] = ["going", "maybe", "not_going"];

export const TITLE_MAX = APPOINTMENT_TITLE_MAX;
export const DESCRIPTION_MAX = APPOINTMENT_DESCRIPTION_MAX;
export const PLACE_NAME_MAX = APPOINTMENT_PLACE_NAME_MAX;

export const DEFAULT_START = "18:00";
export const DEFAULT_END = "21:00";
/** ค่าตั้งต้นจากช่วงว่าง: ยาวสุด 3 ชม. (UX §9.4) */
export const PREFILL_MAX_MINUTES = 180;

export const pad2 = (n: number): string => String(n).padStart(2, "0");
export const hhmm = (min: number): string => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;
/** 'HH:MM' (รับ '24:00') → นาทีจากเที่ยงคืน · ไม่ใช่รูปแบบ → null */
export function minutesOfClock(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 24 || mi > 59 || (h === 24 && mi > 0) ? null : h * 60 + mi;
}

/** นับ code point หลัง NFC + trim (เหมือนเซิร์ฟเวอร์) */
export const textLength = (v: string): number => [...v.normalize("NFC").trim()].length;
const cleanText = (v: string): string | null => {
  const t = v.normalize("NFC").trim();
  return t === "" ? null : t;
};
/** คำอธิบาย: ขึ้นบรรทัดได้ — \r\n → \n, ตัดหัวท้าย */
const cleanMultiline = (v: string): string | null => {
  const t = v.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  return t === "" ? null : t;
};

// ───────── สถานที่ที่เลือก ─────────
export interface PlaceValue {
  name: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
}
export const hasPlace = (p: PlaceValue | null): p is PlaceValue => p !== null && (p.name !== null || p.lat !== null || p.mapUrl !== null);

// ───────── สถานะฟอร์ม ─────────
export interface ApptFormState {
  title: string;
  /** null = ยังไม่เลือกวัน */
  date: DateISO | null;
  startTime: string;
  endTime: string;
  description: string;
  place: PlaceValue | null;
}

export function emptyForm(date: DateISO | null): ApptFormState {
  return { title: "", date, startTime: DEFAULT_START, endTime: DEFAULT_END, description: "", place: null };
}

/**
 * ค่าตั้งต้นจากช่วงว่างร่วม (X66/§9.4): เริ่ม = เริ่มช่วง (ปัดขึ้นเป็น 30 นาที) · จบ = min(จบช่วง, เริ่ม+3 ชม.) (ปัดลง)
 * ไม่มีช่วง/ช่วงสั้นเกินไป → 18:00–21:00 · จบ 24:00 → '00:00' (ข้ามคืนอัตโนมัติ)
 */
export function prefillFromSegment(seg: { start: string; end: string } | null): { startTime: string; endTime: string } {
  const fallback = { startTime: DEFAULT_START, endTime: DEFAULT_END };
  if (!seg) return fallback;
  const s = minutesOfClock(seg.start);
  const e = minutesOfClock(seg.end);
  if (s === null || e === null) return fallback;
  const start = Math.ceil(s / STEP_MINUTES) * STEP_MINUTES;
  const end = Math.floor(Math.min(e, start + PREFILL_MAX_MINUTES) / STEP_MINUTES) * STEP_MINUTES;
  if (start >= 24 * 60 || end <= start) return fallback;
  return { startTime: hhmm(start), endTime: end >= 24 * 60 ? "00:00" : hhmm(end) };
}

/** วัน/เวลาสิ้นสุดจริง: เวลาจบ ≤ เวลาเริ่ม = ข้ามคืน (วันจบ = วันถัดไป) */
export function resolveEnd(s: Pick<ApptFormState, "date" | "startTime" | "endTime">): { endDate: DateISO; overnight: boolean } | null {
  if (!s.date) return null;
  return s.endTime <= s.startTime ? { endDate: addDays(s.date, 1), overnight: true } : { endDate: s.date, overnight: false };
}

/** ความยาวรวมเป็นนาที (ใน tz กลุ่ม — คิด DST ถูก) · คำนวณไม่ได้ → null */
export function durationMinutes(s: ApptFormState, tz: string): number | null {
  const end = resolveEnd(s);
  if (!end || !s.date) return null;
  try {
    const a = parseLocalDateTime(s.date, s.startTime, tz);
    const b = parseLocalDateTime(end.endDate, s.endTime, tz);
    return b > a ? Math.round((b - a) / 60_000) : null;
  } catch {
    return null;
  }
}

/** นัดที่มีอยู่ → สถานะฟอร์มแก้ไข (วัน/เวลาใน tz ของนัด) */
export function formStateOfAppointment(a: Pick<AppointmentDto, "title" | "description" | "placeName" | "lat" | "lng" | "mapUrl" | "startAt" | "endAt" | "tz">): ApptFormState {
  const s = toLocal(a.startAt, a.tz);
  const e = toLocal(a.endAt, a.tz);
  const place: PlaceValue = { name: a.placeName, lat: a.lat, lng: a.lng, mapUrl: a.mapUrl };
  return { title: a.title, date: s.date, startTime: hhmm(s.minute), endTime: hhmm(e.minute), description: a.description ?? "", place: hasPlace(place) ? place : null };
}

// ───────── form → payload ─────────
export type FieldPos = "title" | "date" | "time" | "description" | "place" | "banner";
export interface FormProblem {
  pos: FieldPos;
  ref: MessageRef;
}

export interface CreatePayload {
  title: string;
  description?: string;
  placeName?: string;
  lat?: number;
  lng?: number;
  mapUrl?: string;
  startDate: DateISO;
  startTime: string;
  endDate: DateISO;
  endTime: string;
}

export interface PatchPayload {
  title?: string;
  description?: string | null;
  placeName?: string | null;
  lat?: number | null;
  lng?: number | null;
  mapUrl?: string | null;
  startDate?: DateISO;
  startTime?: string;
  endDate?: DateISO;
  endTime?: string;
}

export interface BuildContext {
  tz: string;
  nowMs: EpochMs;
  /** ตรวจ "เริ่มย้อนหลังเกิน 1 ชม." (แก้นัดโดยไม่แตะเวลา = ไม่ตรวจ) */
  checkPast: boolean;
}

const ref = (key: string, values: Record<string, string | number> = {}): MessageRef => ({ key, values });

/** ตรวจก่อนส่ง (เซิร์ฟเวอร์ตัดสินจริงอีกครั้ง) — คืนรายการปัญหา (ว่าง = ผ่าน) */
export function validateForm(s: ApptFormState, ctx: BuildContext): FormProblem[] {
  const out: FormProblem[] = [];
  const titleLen = textLength(s.title);
  if (titleLen === 0) out.push({ pos: "title", ref: ref("appointments.form.error.title.required") });
  else if (titleLen > TITLE_MAX) out.push({ pos: "title", ref: ref("appointments.form.error.title.tooLong", { max: TITLE_MAX }) });
  if (!s.date) out.push({ pos: "date", ref: ref("appointments.form.error.date.required") });
  if (s.description.normalize("NFC").replace(/\r\n?/g, "\n").trim().length > 0 && [...s.description.normalize("NFC").replace(/\r\n?/g, "\n").trim()].length > DESCRIPTION_MAX) {
    out.push({ pos: "description", ref: ref("appointments.form.error.description.tooLong", { max: DESCRIPTION_MAX }) });
  }
  if (s.place?.name && textLength(s.place.name) > PLACE_NAME_MAX) out.push({ pos: "place", ref: ref("appointments.form.error.place.tooLong", { max: PLACE_NAME_MAX }) });
  if (s.date && ctx.checkPast) {
    try {
      if (parseLocalDateTime(s.date, s.startTime, ctx.tz) < ctx.nowMs - APPOINTMENT_MAX_BACKDATE_MS) {
        out.push({ pos: "time", ref: ref("appointments.form.error.start.past", { hours: 1 }) });
      }
    } catch {
      out.push({ pos: "time", ref: ref("errors.INVALID_LOCAL_TIME") });
    }
  }
  return out;
}

export type CreateResult = { ok: true; payload: CreatePayload } | { ok: false; problems: FormProblem[] };

export function buildCreatePayload(s: ApptFormState, ctx: BuildContext): CreateResult {
  const problems = validateForm(s, ctx);
  const end = resolveEnd(s);
  if (problems.length > 0 || !end || !s.date) return { ok: false, problems };
  const p = s.place;
  const lat = p && p.lat !== null && p.lng !== null ? p.lat : null;
  const lng = p && p.lat !== null && p.lng !== null ? p.lng : null;
  const placeName = p?.name ? cleanText(p.name) : null;
  const description = cleanMultiline(s.description);
  return {
    ok: true,
    payload: {
      title: cleanText(s.title)!,
      ...(description !== null ? { description } : {}),
      ...(placeName !== null ? { placeName } : {}),
      // lat/lng ไปเป็นคู่เสมอ
      ...(lat !== null && lng !== null ? { lat, lng } : {}),
      ...(p?.mapUrl ? { mapUrl: p.mapUrl } : {}),
      startDate: s.date,
      startTime: s.startTime,
      endDate: end.endDate,
      endTime: s.endTime,
    },
  };
}

export type PatchResult = { ok: true; payload: PatchPayload | null } | { ok: false; problems: FormProblem[] };

/** แก้นัด: ส่งเฉพาะฟิลด์ที่เปลี่ยน · เวลาไปทั้งก้อนหรือไม่ไปเลย · lat/lng ไปคู่ · ล้างค่า = null (ยกเว้นชื่อ) · ไม่มีอะไรเปลี่ยน = payload null */
export function buildPatchPayload(s: ApptFormState, original: Pick<AppointmentDto, "title" | "description" | "placeName" | "lat" | "lng" | "mapUrl" | "startAt" | "endAt" | "tz">, ctx: Omit<BuildContext, "checkPast">): PatchResult {
  const before = formStateOfAppointment(original);
  const end = resolveEnd(s);
  const scheduleChanged = s.date !== before.date || s.startTime !== before.startTime || endInstantChanged(s, end, original, ctx.tz);
  const problems = validateForm(s, { ...ctx, checkPast: scheduleChanged });
  if (problems.length > 0 || !end || !s.date) return { ok: false, problems };

  const out: PatchPayload = {};
  const title = cleanText(s.title)!;
  if (title !== original.title) out.title = title;
  const description = cleanMultiline(s.description);
  if (description !== original.description) out.description = description;

  const p = s.place;
  const name = p?.name ? cleanText(p.name) : null;
  const lat = p && p.lat !== null && p.lng !== null ? p.lat : null;
  const lng = p && p.lat !== null && p.lng !== null ? p.lng : null;
  const mapUrl = p?.mapUrl ?? null;
  if (name !== original.placeName) out.placeName = name;
  if (lat !== original.lat || lng !== original.lng) {
    out.lat = lat;
    out.lng = lng;
  }
  if (mapUrl !== original.mapUrl) out.mapUrl = mapUrl;

  if (scheduleChanged) {
    out.startDate = s.date;
    out.startTime = s.startTime;
    out.endDate = end.endDate;
    out.endTime = s.endTime;
  }
  return { ok: true, payload: Object.keys(out).length === 0 ? null : out };
}

function endInstantChanged(s: ApptFormState, end: { endDate: DateISO } | null, original: Pick<AppointmentDto, "endAt" | "tz">, tz: string): boolean {
  if (!end) return true;
  const e = toLocal(original.endAt, original.tz || tz);
  return e.date !== end.endDate || hhmm(e.minute) !== s.endTime;
}

// ───────── error → ตำแหน่ง/ข้อความ ─────────
export type SaveFailure = { type: "problem"; problems: FormProblem[]; openPaste: boolean } | { type: "gone" };

/** RATE_LIMITED: มี Retry-After → บอกเวลารอ (วินาที ≤ 60 · เกินนั้นเป็นนาที) · ไม่มี → ข้อความทั่วไป */
export function rateLimitedRef(values: Record<string, string | number>): MessageRef {
  const sec = values.retryAfterSec;
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return ref("errors.RATE_LIMITED");
  return sec <= 60 ? ref("appointments.rateRetry", { n: Math.ceil(sec), unit: "sec" }) : ref("appointments.rateRetry", { n: Math.ceil(sec / 60), unit: "min" });
}

/** ข้อความของความล้มเหลวที่แสดงใต้ปุ่ม (RSVP/ยกเลิก): รหัสที่ผู้ใช้แก้เองได้ใช้ errors.* · อื่นๆ ใช้ fallback */
export function actionFailureRef(f: Failure, fallbackKey: string): MessageRef {
  if (f.kind === "network") return ref(fallbackKey);
  const { code, values, key } = f.error;
  if (code === "RATE_LIMITED") return rateLimitedRef(values);
  if (code === "UNKNOWN" || code === "VALIDATION") return ref(fallbackKey);
  return ref(key, values);
}

/** รหัสผิดพลาดของ API → ช่อง + ข้อความ (UX §9) */
export function mapFormFailure(f: Failure, mode: "create" | "edit"): SaveFailure {
  const one = (pos: FieldPos, r: MessageRef, openPaste = false): SaveFailure => ({ type: "problem", problems: [{ pos, ref: r }], openPaste });
  const generic = ref(mode === "edit" ? "appointments.form.error.saveEdit" : "appointments.form.error.save");
  if (f.kind === "network") return one("banner", generic);
  const { code, values } = f.error;
  switch (code) {
    case "NOT_FOUND":
      return { type: "gone" };
    case "APPOINTMENT_CANCELLED":
      return one("banner", ref("errors.APPOINTMENT_CANCELLED"));
    case "APPOINTMENT_PAST":
      return one("time", ref("appointments.form.error.start.past", { hours: 1 }));
    case "INVALID_MAP_URL":
      return one("place", ref("errors.INVALID_MAP_URL"), true);
    case "INVALID_COORDINATES":
      return one("place", ref("errors.INVALID_COORDINATES"), true);
    case "INVALID_RANGE":
      return one("time", ref("errors.INVALID_RANGE", { kind: "time" }));
    case "TIME_NOT_ON_STEP":
    case "INVALID_LOCAL_TIME":
      return one("time", ref(`errors.${code}`));
    case "INVALID_DATE":
    case "DATE_OUT_OF_RANGE":
      return one("date", ref(`errors.${code}`));
    case "LIMIT_REACHED": {
      const limit = typeof values.limit === "string" ? values.limit : "";
      const r = ref("errors.LIMIT_REACHED", { limit, ...(typeof values.max === "number" ? { max: values.max } : {}) });
      return limit === "appointmentSpan" ? one("time", r) : one("banner", r);
    }
    case "VALIDATION": {
      const problems: FormProblem[] = [];
      for (const [field, reason] of Object.entries(f.fields)) {
        if (field === "title") {
          problems.push({ pos: "title", ref: reason === "TOO_SHORT" ? ref("appointments.form.error.title.required") : reason === "TOO_LONG" ? ref("appointments.form.error.title.tooLong", { max: TITLE_MAX }) : ref("errors.VALIDATION") });
        } else if (field === "description") {
          problems.push({ pos: "description", ref: reason === "TOO_LONG" ? ref("appointments.form.error.description.tooLong", { max: DESCRIPTION_MAX }) : ref("errors.VALIDATION") });
        } else if (field === "placeName") {
          problems.push({ pos: "place", ref: reason === "TOO_LONG" ? ref("appointments.form.error.place.tooLong", { max: PLACE_NAME_MAX }) : ref("errors.VALIDATION") });
        } else if (field === "startTime" && reason === "IN_PAST") {
          problems.push({ pos: "time", ref: ref("appointments.form.error.start.past", { hours: 1 }) });
        } else if (field.endsWith("Time")) {
          problems.push({ pos: "time", ref: ref("errors.VALIDATION") });
        } else if (field.endsWith("Date")) {
          problems.push({ pos: "date", ref: ref("errors.VALIDATION") });
        }
      }
      return problems.length > 0 ? { type: "problem", problems, openPaste: false } : one("banner", ref("errors.VALIDATION"));
    }
    case "RATE_LIMITED":
      return one("banner", rateLimitedRef(values));
    case "FORBIDDEN":
    case "FEATURE_DISABLED":
      return one("banner", ref(`errors.${code}`));
    default:
      return one("banner", generic);
  }
}

export const coordsText = (p: Pick<PlaceValue, "lat" | "lng">): string | null => (p.lat !== null && p.lng !== null ? `${round5(p.lat)}, ${round5(p.lng)}` : null);
const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

// ───────── เตือนนัดทับ (view-model) ─────────
export type OverlapView =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "error" }
  | { kind: "clear" }
  | { kind: "unknown"; people: OverlapPerson[]; more: number; total: number }
  | { kind: "warn"; people: OverlapPerson[]; more: number; total: number };

export interface OverlapRow {
  key: string;
  /** ข้อความช่วงเวลา · null ไม่ควรเกิด (มีเสมอ) */
  when: MessageRef;
  /** ชื่อรายการที่เจ้าของเปิดเผย · null = "ไม่ว่าง" (ซ่อน/ไม่ได้ใส่ — ผู้ดูแยกไม่ได้) */
  title: string | null;
  /** R6D: busy = ช่วงที่ลงเอง · appointment = นัด (title = ชื่อนัดของกลุ่มนี้) · other_group_appointment = ติดนัดกลุ่มอื่น (ไม่มีชื่อ) */
  kind: BusyKind;
}
export interface OverlapPerson {
  userId: string;
  displayName: string;
  colorIndex: number;
  shapeIndex: number;
  you: boolean;
  rows: OverlapRow[];
  moreRows: number;
}

export const OVERLAP_MAX_PEOPLE = 5;
export const OVERLAP_MAX_ROWS = 2;

type OverlapItem = OverlapDto["blocked"][number]["items"][number];

function itemWhen(it: OverlapItem, tz: string, locale: CalendarLocale): MessageRef {
  // R6D: นัดที่ตอบไป (kind appointment/other_group_appointment) ไม่มี allDay/tz/id → timed ใน tz กลุ่ม
  if ("allDay" in it && it.allDay) return ref("calendar.day.allDay");
  const itTz = "tz" in it && it.tz ? it.tz : tz;
  const s = toLocal(it.startAt, itTz);
  const e = toLocal(it.endAt, itTz);
  if (s.date === e.date) return ref("calendar.day.range", { start: hhmm(s.minute), end: hhmm(e.minute) });
  const d = (x: DateISO) => format(x, { locale, style: "day-month" });
  return ref("busy.when.timedSpan", { startDate: d(s.date), start: hhmm(s.minute), endDate: d(e.date), end: hhmm(e.minute) });
}

/**
 * ผลตรวจนัดทับ → สิ่งที่แสดง (X55) — ไม่บล็อก
 * - unknown ไม่เคยพูดว่า "ไม่มีใครติด" · ok + ว่าง = clear (ตามที่สมาชิกลงไว้)
 * - รายการซ่อน (ไม่มี title) = "ไม่ว่าง" · ชื่อรายการแสดงเมื่อมี title เท่านั้น · ไม่มี note ในข้อมูลอยู่แล้ว
 */
export function overlapView(o: OverlapDto, ctx: { myId: string; tz: string; locale: CalendarLocale }): OverlapView {
  const all: OverlapPerson[] = o.blocked.map((b) => {
    const rows = b.items.map((it, i): OverlapRow => {
      const title = "title" in it && typeof it.title === "string" && it.title !== "" ? it.title : null;
      const kind: BusyKind = "kind" in it && (it.kind === "appointment" || it.kind === "other_group_appointment") ? it.kind : "busy";
      // นัด/นัดกลุ่มอื่นไม่มี id ของ busy → ใช้ชนิด+ลำดับเป็น key
      return { key: `${b.userId}-${"id" in it ? it.id : `${kind}${i}`}`, when: itemWhen(it, ctx.tz, ctx.locale), title, kind };
    });
    return { userId: b.userId, displayName: b.displayName, colorIndex: b.colorIndex, shapeIndex: b.shapeIndex, you: b.userId === ctx.myId, rows: rows.slice(0, OVERLAP_MAX_ROWS), moreRows: Math.max(0, rows.length - OVERLAP_MAX_ROWS) };
  });
  const people = all.slice(0, OVERLAP_MAX_PEOPLE);
  const more = Math.max(0, all.length - people.length);
  if (o.status === "unknown") return { kind: "unknown", people, more, total: all.length };
  if (all.length === 0) return { kind: "clear" };
  return { kind: "warn", people, more, total: all.length };
}

// ───────── RSVP ─────────
export type RsvpClosedReason = "cancelled" | "past" | "forbidden" | null;

export function rsvpClosedReason(a: Pick<AppointmentDetailDto, "status" | "isPast" | "permissions">): RsvpClosedReason {
  if (a.status === "cancelled") return "cancelled";
  if (a.isPast) return "past";
  if (!a.permissions.canRsvp) return "forbidden";
  return null;
}

/**
 * ตอบ RSVP แบบ optimistic (รายละเอียด): ย้ายผู้ดูออกจากรายชื่อเดิม → ใส่ในคำตอบใหม่ · นับใหม่จากรายชื่อ · "ยังไม่ตอบ" ลดหนึ่งเมื่อเพิ่งตอบครั้งแรก
 * คำตอบเดิม = ไม่เปลี่ยนอะไร (คืนอ็อบเจกต์เดิม) · ไม่แก้ค่าที่ส่งเข้า
 */
export function applyRsvp(r: RsvpDetailDto, next: Rsvp, me: PersonDto): RsvpDetailDto {
  if (r.mine === next) return r;
  const members: RsvpDetailDto["members"] = {
    going: r.members.going.filter((p) => p.userId !== me.userId),
    maybe: r.members.maybe.filter((p) => p.userId !== me.userId),
    not_going: r.members.not_going.filter((p) => p.userId !== me.userId),
  };
  members[next] = [...members[next], me];
  return {
    mine: next,
    members,
    counts: {
      going: members.going.length,
      maybe: members.maybe.length,
      not_going: members.not_going.length,
      noResponse: r.mine === null ? Math.max(0, r.counts.noResponse - 1) : r.counts.noResponse,
    },
  };
}

/** สำหรับมุมมองรายการ (มีแต่จำนวน ไม่มีรายชื่อ): ปรับจำนวนตามคำตอบเดิม→ใหม่ */
export function applyRsvpCounts(counts: RsvpCountsDto, prev: Rsvp | null, next: Rsvp): RsvpCountsDto {
  if (prev === next) return counts;
  const c = { ...counts };
  if (prev === null) c.noResponse = Math.max(0, c.noResponse - 1);
  else c[prev] = Math.max(0, c[prev] - 1);
  c[next] += 1;
  return c;
}

// ───────── สถานะนัด / วันเวลาที่แสดง ─────────
export type ApptPhase = "cancelled" | "past" | "ongoing" | "upcoming";
export function apptPhase(a: Pick<AppointmentDto, "status" | "isPast" | "startAt">, nowMs: EpochMs): ApptPhase {
  if (a.status === "cancelled") return "cancelled";
  if (a.isPast) return "past";
  return a.startAt <= nowMs ? "ongoing" : "upcoming";
}

/** ช่วงเวลาของนัดสำหรับแสดง (ใน tz ของนัด): วันเดียว HH:MM–HH:MM · ข้ามคืนวันถัดไป · หลายวัน = ทั้งวัน/เวลาปลาย */
export function appointmentWhen(a: Pick<AppointmentDto, "startAt" | "endAt" | "tz">, locale: CalendarLocale): MessageRef {
  const s = toLocal(a.startAt, a.tz);
  const e = toLocal(a.endAt, a.tz);
  const start = hhmm(s.minute);
  const end = hhmm(e.minute);
  if (s.date === e.date) return ref("calendar.day.range", { start, end });
  if (e.date === addDays(s.date, 1) && e.minute <= s.minute) return ref("appointments.when.overnight", { start, end });
  const d = (x: DateISO) => format(x, { locale, style: "day-month" });
  return ref("busy.when.timedSpan", { startDate: d(s.date), start, endDate: d(e.date), end });
}

// ───────── R6D: ชนกับนัดอื่น / นัดที่ตอบ "ไป" ─────────
export type MyConflict = AppointmentDetailDto["myConflicts"][number];

/** ช่วงเวลาของสิ่งที่ชน (ใน tz ของมันเอง) · busy ทั้งวัน = ข้อความวัน */
export function conflictWhen(c: MyConflict, locale: CalendarLocale): MessageRef {
  if (c.kind === "busy" && c.allDay) return whenRef({ allDay: true, startDate: c.localStartDate, endDate: c.localEndDate }, locale);
  return appointmentWhen(c, locale);
}

/**
 * คีย์ปุ่มยืนยัน "ไป" (R6E E2): ไม่ชนอะไร = toConfirm · ชนเฉพาะ busy ที่ลงเอง (ไม่มีนัดอื่น) = conflictConfirmBusy ("ไปนัดนี้") ·
 * ชนนัด (มีหรือไม่มี busy ร่วม) = conflictConfirm ("ไปทั้งสองนัด") · รายการถูกตัด (truncated) = ยังมีที่มองไม่เห็น อาจเป็นนัด → conflictConfirm
 */
export function goingConfirmKey(conflicts: readonly Pick<MyConflict, "kind">[], truncated = false): "toConfirm" | "conflictConfirm" | "conflictConfirmBusy" {
  if (conflicts.length === 0) return "toConfirm";
  if (truncated || conflicts.some((c) => c.kind === "appointment")) return "conflictConfirm";
  return "conflictConfirmBusy";
}

/** ต้องมี popup ยืนยันไหม: เป็น "ไป" (จากอย่างอื่น/ยังไม่ตอบ) = to · จาก "ไป" เป็นอย่างอื่น = from · นอกนั้น (maybe↔not_going/ตอบครั้งแรกเป็นสองอย่างนี้) = null */
export function rsvpConfirmKind(prev: Rsvp | null, next: Rsvp): "to" | "from" | null {
  if (prev === next) return null;
  if (next === "going") return "to";
  return prev === "going" ? "from" : null;
}

/** ป้ายชนที่หน้านัด: เฉพาะคนที่ตอบ "ไป" และนัดยังเปิดอยู่ */
export const showConflictBadge = (a: Pick<AppointmentDetailDto, "rsvp" | "myConflicts" | "status" | "isPast">): boolean =>
  a.rsvp.mine === "going" && a.myConflicts.length > 0 && a.status !== "cancelled" && !a.isPast;

/** เวลาของนัดที่ตอบ "ไป" ในแท็บ "ของฉัน" (วันที่ + ช่วงเวลา ใน tz ของนัด) */
export function goingWhen(a: Pick<AppointmentDto, "startAt" | "endAt" | "tz">, locale: CalendarLocale): MessageRef {
  const s = toLocal(a.startAt, a.tz);
  const e = toLocal(a.endAt, a.tz);
  return whenRef({ allDay: false, startDate: s.date, endDate: e.date, startTime: hhmm(s.minute), endTime: hhmm(e.minute) }, locale);
}

/** หมายเลขวันที่/เดือนย่อสำหรับ datebox ในแถว */
export function dateBox(localDate: DateISO, locale: CalendarLocale): { day: number; month: string } {
  return { day: Number(localDate.slice(8, 10)), month: format(localDate, { locale, style: "day-month" }).replace(/^\d+\s*/, "") };
}

/** state สำหรับ aria ของแถว (appointments.row.aria) */
export function rowState(a: Pick<AppointmentDto, "status" | "rsvp">): "cancelled" | Rsvp | "none" {
  return a.status === "cancelled" ? "cancelled" : (a.rsvp.mine ?? "none");
}

// ───────── R12: เพิ่มนัดลงปฏิทิน (ตรวจ UA เพื่อจัดลำดับ/หน้าตาเท่านั้น ไม่ใช้ตัดสินสิทธิ์) ─────────
export type CalendarOption = "ics" | "google";
export type CalendarSheetMode = { kind: "options"; order: readonly [CalendarOption, CalendarOption] } | { kind: "line" };

/** ปุ่ม "เพิ่มลงปฏิทิน" (§4.1): ตอบ "ไป" + บันทึกเสร็จ + นัด active + ยังไม่จบ */
export function showAddToCalendar(a: Pick<AppointmentDetailDto, "status" | "isPast" | "rsvp">, saving: boolean): boolean {
  return a.rsvp.mine === "going" && !saving && a.status !== "cancelled" && !a.isPast;
}

/**
 * ลำดับตัวเลือกตาม UA (§4.2/§4.4) · pure
 * - มีโทเคน `Line/` = LINE in-app browser → หน้าตาแบบบอกให้เปิดในเบราว์เซอร์ (ไม่แสดง 2 ตัวเลือก)
 * - iPhone/iPad/iPod หรือ iPadOS (UA เป็น Macintosh + maxTouchPoints > 1) → .ics ก่อน
 * - อื่น ๆ (Android ฯลฯ) → Google ก่อน
 */
export function calendarSheetMode(userAgent: string, maxTouchPoints: number): CalendarSheetMode {
  if (/\bLine\//.test(userAgent)) return { kind: "line" };
  const apple = /\b(iPhone|iPad|iPod)\b/.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1);
  return { kind: "options", order: apple ? ["ics", "google"] : ["google", "ics"] };
}

/** ลิงก์ .ics (ลิงก์ธรรมดา ไม่ใช้ next/link) */
export const calendarIcsHref = (id: string): string => `/api/appointments/${id}/calendar.ics`;
/** ลิงก์พาออกจาก LINE in-app browser (§4.4) */
export const calendarOpenExternalHref = (id: string): string => `/appointments/${id}?openExternalBrowser=1`;
