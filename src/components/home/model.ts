// view-model ล้วนของหน้าหลัก (R4B U11 · UX §9 X47–X52) — ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/home-model.test.ts
// วัน-เวลาจัดรูปใน tz ของนัดผ่าน src/lib/calendar (พ.ศ. ในภาษาไทย · 24 ชม.) · "อีก N วัน" ใช้ daysUntil ที่ API ส่งมา (วันปฏิทินใน tz นัด)
import { weekdayShort } from "@/components/shell/weekday";
import { DEFAULT_TZ, addDays, format, isValidTimeZone, toLocal, type CalendarLocale } from "@/lib/calendar";

export type RsvpAnswer = "going" | "maybe" | "not_going";
export const RSVP_ANSWERS: readonly RsvpAnswer[] = ["going", "maybe", "not_going"];
export const isRsvpAnswer = (v: unknown): v is RsvpAnswer => v === "going" || v === "maybe" || v === "not_going";

/** จำนวนรายการที่ขอจาก GET /api/me/appointments (การ์ดถัดไป + แถวต่อๆ ไป) */
export const HOME_LIMIT = 20;

export interface RsvpCounts {
  going: number;
  maybe: number;
  not_going: number;
  noResponse: number;
}

export interface RsvpSummary {
  counts: RsvpCounts;
  mine: RsvpAnswer | null;
}

/** ส่วนของ AppointmentDto ที่หน้าหลักใช้ (GET /api/me/appointments — ไม่มีรายชื่อสมาชิก) */
export interface HomeAppointment {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
  startAt: number;
  endAt: number;
  tz: string;
  localDate: string;
  status: "active" | "cancelled";
  isPast: boolean;
  daysUntil: number;
  rsvp: RsvpSummary;
}

// ───────── การ์ดถัดไป / รายการ ─────────
/**
 * แยก "นัดถัดไป" ออกจากรายการที่เหลือ: เอาเฉพาะนัด active ที่ยังไม่ผ่าน (API กรองให้แล้ว กรองซ้ำเพื่อกันข้อมูลหลุด)
 * เรียงตามเวลาเริ่ม (เสมอกันใช้ id) · กำลังเกิดขึ้นนับเป็นนัดถัดไป (UX 9.7 ข้อ 2) · นัดที่ยกเลิกไม่เป็นการ์ดถัดไป
 */
export function splitHome(list: readonly HomeAppointment[]): { next: HomeAppointment | null; later: HomeAppointment[] } {
  const live = list
    .filter((a) => a.status === "active" && !a.isPast)
    .slice()
    .sort((a, b) => a.startAt - b.startAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { next: live[0] ?? null, later: live.slice(1) };
}

/** เหลือรายการเกินเพดานที่ขอไหม: ได้ครบ limit พอดี = อาจมีต่อ → ขึ้น home.moreNote (API ไม่ส่ง total) */
export const maybeTruncated = (count: number, limit: number = HOME_LIMIT): boolean => count >= limit;

export type CountdownKind = "ongoing" | "today" | "tomorrow" | "days";

/** ป้ายบนแถบการ์ด: กำลังจัดอยู่ > วันนี้ > พรุ่งนี้ > อีก N วัน (days<0 ที่ไม่ได้กำลังจัด = ขอบเวลา → วันนี้) */
export function countdownKind(a: Pick<HomeAppointment, "daysUntil" | "startAt" | "endAt">, nowMs: number): CountdownKind {
  if (a.startAt <= nowMs && nowMs < a.endAt) return "ongoing";
  if (a.daysUntil <= 0) return "today";
  if (a.daysUntil === 1) return "tomorrow";
  return "days";
}

/** ป้ายนับถอยหลังของแถว "นัดถัดๆ ไป" (R6A F4): kind + จำนวนวันที่ไม่ติดลบ (สำหรับ home.countdown.aria) */
export function rowCountdown(a: Pick<HomeAppointment, "daysUntil" | "startAt" | "endAt">, nowMs: number): { kind: CountdownKind; days: number } {
  const kind = countdownKind(a, nowMs);
  return { kind, days: kind === "today" || kind === "ongoing" ? 0 : kind === "tomorrow" ? 1 : a.daysUntil };
}

// ───────── จำนวน RSVP บนการ์ด ─────────
export type CountAnswer = RsvpAnswer | "none";

/** ชิปจำนวนบนการ์ดนัดถัดไป (R6A B1): ไป แสดงเสมอ · อาจไป/ไม่ไป/ยังไม่ตอบ แสดงเมื่อ > 0 · ลำดับเดียวกับหน้ารายละเอียดนัด */
export function rsvpCountItems(c: RsvpCounts): { answer: CountAnswer; count: number }[] {
  const all: { answer: CountAnswer; count: number }[] = [
    { answer: "going", count: c.going },
    { answer: "maybe", count: c.maybe },
    { answer: "not_going", count: c.not_going },
    { answer: "none", count: c.noResponse },
  ];
  return all.filter((x) => x.answer === "going" || x.count > 0);
}

// ───────── วัน-เวลา ─────────
const safeTz = (tz: string): string => (isValidTimeZone(tz) ? tz : DEFAULT_TZ);

/** "วันเสาร์ 24 ต.ค. 2569" / "Saturday 24 Oct 2026" — แถบบนการ์ดใหญ่ */
export function longDateLabel(a: Pick<HomeAppointment, "startAt" | "tz">, locale: CalendarLocale): string {
  const tz = safeTz(a.tz);
  return `${format(a.startAt, { locale, style: "weekday-long", tz })} ${format(a.startAt, { locale, style: "date-medium", tz })}`;
}

/** "เสาร์ 24 ต.ค." — แถวในรายการ / aria */
export function shortDateLabel(a: Pick<HomeAppointment, "startAt" | "tz">, locale: CalendarLocale): string {
  const tz = safeTz(a.tz);
  return `${weekdayShort(a.startAt, { locale, tz })} ${format(a.startAt, { locale, style: "day-month", tz })}`;
}

export type TimeRange =
  | { kind: "same"; text: string }
  /** จบวันถัดไป → appointments.when.overnight {start,end} */
  | { kind: "overnight"; start: string; end: string }
  /** จบหลังจากนั้นหลายวัน → แสดงวันที่จบด้วย (เฉพาะเมื่อต่างวันท้องถิ่น) */
  | { kind: "multi"; text: string };

/** ช่วงเวลา "18:00–21:00" · ข้ามคืน/หลายวันแสดงวันที่จบเฉพาะเมื่อวันท้องถิ่นไม่ตรงกัน (ใน tz ของนัด) */
export function timeRange(a: Pick<HomeAppointment, "startAt" | "endAt" | "tz">, locale: CalendarLocale): TimeRange {
  const tz = safeTz(a.tz);
  const start = format(a.startAt, { locale, style: "time", tz });
  const end = format(a.endAt, { locale, style: "time", tz });
  const s = toLocal(a.startAt, tz).date;
  const e = toLocal(a.endAt, tz).date;
  if (s === e) return { kind: "same", text: `${start}–${end}` };
  if (addDays(s, 1) === e) return { kind: "overnight", start, end };
  return { kind: "multi", text: `${start} – ${format(e, { locale, style: "day-month" })} ${end}` };
}

/** วันที่/เดือนบนกล่องวันของแถว: เลขวันที่ (ใน tz นัด) + วันที่ล้วนสำหรับจัดรูปชื่อเดือน */
export function dateBox(a: Pick<HomeAppointment, "startAt" | "tz">): { day: number; date: string } {
  const date = toLocal(a.startAt, safeTz(a.tz)).date;
  return { day: Number(date.slice(8, 10)), date };
}

// ───────── สถานที่ ─────────
const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
};

export interface PlaceView {
  /** ชื่อที่แสดง: ชื่อสถานที่ หรือโฮสต์ของลิงก์ (มีแต่ลิงก์) */
  label: string;
  /** ลิงก์เปิดแอปแผนที่: mapUrl (https เท่านั้น) หรือ OSM จากพิกัด · null = ไม่มีที่เปิด */
  href: string | null;
  /** true = ไม่มีชื่อ แสดงโฮสต์ → ใช้ข้อความ places.openLink แทน */
  linkOnly: boolean;
  host: string | null;
}

const validCoord = (lat: number | null, lng: number | null): lat is number =>
  lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** สถานที่ของนัด · ไม่มีชื่อ/พิกัด/ลิงก์เลย → null · ลิงก์ที่ไม่ใช่ https ถูกทิ้ง (กัน javascript:/data:) */
export function placeView(a: Pick<HomeAppointment, "placeName" | "lat" | "lng" | "mapUrl">): PlaceView | null {
  const name = a.placeName?.trim() ? a.placeName.trim() : null;
  const url = a.mapUrl && /^https:\/\//i.test(a.mapUrl) && hostOf(a.mapUrl) ? a.mapUrl : null;
  const host = url ? hostOf(url) : null;
  const coordHref = validCoord(a.lat, a.lng)
    ? `https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=17/${a.lat}/${a.lng}`
    : null;
  const href = url ?? coordHref;
  if (!name && !href) return null;
  if (name) return { label: name, href, linkOnly: false, host };
  return { label: host ?? "", href, linkOnly: host !== null, host };
}

// ───────── RSVP (optimistic + rollback) ─────────
/** นับใหม่เมื่อฉันเปลี่ยนคำตอบ: ถอนคำตอบเดิม (ไม่มี = ลด "ยังไม่ตอบ") แล้วเพิ่มคำตอบใหม่ — ไม่ติดลบ */
export function applyChoice(s: RsvpSummary, choice: RsvpAnswer): RsvpSummary {
  if (s.mine === choice) return s;
  const counts: RsvpCounts = { ...s.counts };
  if (s.mine === null) counts.noResponse = Math.max(0, counts.noResponse - 1);
  else counts[s.mine] = Math.max(0, counts[s.mine] - 1);
  counts[choice] += 1;
  return { counts, mine: choice };
}

export interface RsvpEntry {
  /** ค่าที่แสดง (ผลคาดการณ์ระหว่างบันทึก) */
  summary: RsvpSummary;
  /** คำตอบที่กำลังบันทึก · null = ว่าง */
  saving: RsvpAnswer | null;
  /** ค่าก่อนกด — ใช้ย้อนกลับเมื่อบันทึกไม่สำเร็จ */
  before: RsvpSummary | null;
  /** เลขคำขอล่าสุดของนัดนี้ — ผลของคำขอเก่ากว่าถูกทิ้ง */
  seq: number;
  /** ข้อความผิดพลาดใต้ปุ่ม: คีย์ errors.* หรือ "generic" (= appointments.rsvp.error) */
  error: string | null;
}

export type RsvpState = Record<string, RsvpEntry>;

export type RsvpAction =
  | { type: "choose"; id: string; base: RsvpSummary; choice: RsvpAnswer; seq: number }
  | { type: "saved"; id: string; seq: number; summary: RsvpSummary }
  | { type: "failed"; id: string; seq: number; error: string }
  | { type: "forget"; id: string };

/**
 * reducer ของ RSVP ต่อนัด: choose = ปรับทันที (optimistic) · saved = ใช้ค่าจากเซิร์ฟเวอร์ · failed = ย้อนกลับ + ขึ้นข้อความ
 * ผลที่ seq ไม่ตรงกับคำขอล่าสุดถูกเมิน (กดรัวๆ/ตอบช้า) — ไม่เขียนทับค่าที่ใหม่กว่า
 */
export function rsvpReducer(state: RsvpState, action: RsvpAction): RsvpState {
  switch (action.type) {
    case "choose": {
      const cur = state[action.id];
      if (cur?.saving) return state; // กำลังบันทึกอยู่ — ไม่ซ้อนคำขอ
      const base = cur?.summary ?? action.base;
      if (base.mine === action.choice) return state;
      return {
        ...state,
        [action.id]: { summary: applyChoice(base, action.choice), saving: action.choice, before: base, seq: action.seq, error: null },
      };
    }
    case "saved": {
      const cur = state[action.id];
      if (!cur || cur.seq !== action.seq) return state;
      return { ...state, [action.id]: { summary: action.summary, saving: null, before: null, seq: cur.seq, error: null } };
    }
    case "failed": {
      const cur = state[action.id];
      if (!cur || cur.seq !== action.seq || !cur.before) return state;
      return { ...state, [action.id]: { summary: cur.before, saving: null, before: null, seq: cur.seq, error: action.error } };
    }
    case "forget": {
      const cur = state[action.id];
      if (!cur || cur.saving) return state;
      const { [action.id]: _drop, ...rest } = state;
      void _drop;
      return rest;
    }
  }
}

/** ค่า RSVP ที่แสดง: ถ้ามีรายการแก้ในเครื่องใช้ค่านั้น ไม่งั้นใช้ของเซิร์ฟเวอร์ */
export const displayRsvp = (a: Pick<HomeAppointment, "id" | "rsvp">, state: RsvpState): RsvpSummary => state[a.id]?.summary ?? a.rsvp;

/** รหัส error ที่ควรโชว์ข้อความเฉพาะแทนข้อความทั่วไปของ RSVP (นัดเปลี่ยนสถานะระหว่างทาง) */
export const RSVP_CLOSED_CODES = ["APPOINTMENT_CANCELLED", "APPOINTMENT_PAST", "NOT_FOUND", "FORBIDDEN"] as const;
export const rsvpErrorKey = (code: string): string => ((RSVP_CLOSED_CODES as readonly string[]).includes(code) ? `errors.${code}` : "generic");

/** คำขอโหลดซ้ำ (focus/ลองอีกครั้ง) ที่ยังตามหลังคำขอใหม่กว่าหรือหลังคอมโพเนนต์ถอดแล้ว ต้องถูกทิ้ง */
export const isCurrentRequest = (mine: number, latest: number, alive: boolean): boolean => alive && mine === latest;
