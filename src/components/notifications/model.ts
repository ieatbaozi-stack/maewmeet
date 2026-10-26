// view-model ล้วนของแจ้งเตือนในแอป (R4B ADR 0007 · UX §9 X64–X65) — ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/notifications-model.test.ts
// เวลา/วันที่ผ่าน src/lib/calendar เท่านั้น · ค่าจากผู้ใช้ (ชื่อกลุ่ม/นัด/คน) ห่อ isolate ก่อนเข้า ICU (UX §9.6)
import { weekdayShort } from "@/components/shell/weekday";
import { DEFAULT_TZ, addDays, format, isValidTimeZone, toLocal, todayIn, type CalendarLocale } from "@/lib/calendar";

export interface NotificationItem {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  createdAt: number;
  readAt: number | null;
}

export interface NotificationPage {
  notifications: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

/** เก็บแจ้งเตือนไว้กี่วัน (ADR 0007 / R4B-7: cron ลบ > 90 วัน) — ข้อความท้ายหน้า */
export const NOTIFICATION_RETENTION_DAYS = 90;
export const NOTIFICATION_PAGE_SIZE = 20;

// ───────── ป้ายจำนวนบนกระดิ่ง ─────────
/** ตัวเลขบนป้าย: 0/ไม่ทราบ → ไม่แสดง · > 9 → "9+" (UX X64) */
export function badgeText(count: number | null): string | null {
  if (count === null || !Number.isFinite(count) || count <= 0) return null;
  return count > 9 ? "9+" : String(Math.trunc(count));
}

/** จำนวนที่ส่งเข้า ICU ของ aria กระดิ่ง (null/ติดลบ → 0) */
export function bellCount(count: number | null): number {
  return count === null || !Number.isFinite(count) || count < 0 ? 0 : Math.trunc(count);
}

// ───────── อัปเดตจำนวนยังไม่อ่าน ─────────
/** อ่านรายการเดียวในเครื่อง: ลด 1 เฉพาะถ้ารายการนั้นยังไม่อ่าน (กดซ้ำไม่ลดซ้ำ) · ไม่ต่ำกว่า 0 */
export function unreadAfterMarkOne(unread: number, wasUnread: boolean): number {
  return wasUnread ? Math.max(0, unread - 1) : Math.max(0, unread);
}

/**
 * การตอบกลับ "ขอจำนวนยังไม่อ่านใหม่" ใช้ได้ไหม (stale-response guard):
 * ทิ้งถ้ามีคำขอใหม่กว่าออกไปแล้ว หรือมีการแก้จำนวนในเครื่อง (mark read) หลังจากส่งคำขอนี้
 */
export function shouldApplyRefresh(start: { seq: number; gen: number }, now: { seq: number; gen: number }): boolean {
  return start.seq === now.seq && start.gen === now.gen;
}

// ───────── รายการ ─────────
export const unreadOf = (items: readonly NotificationItem[]): number => items.reduce((n, i) => n + (i.readAt === null ? 1 : 0), 0);

export function markIdsRead(items: readonly NotificationItem[], ids: readonly string[], now: number): NotificationItem[] {
  const set = new Set(ids);
  return items.map((i) => (set.has(i.id) && i.readAt === null ? { ...i, readAt: now } : i));
}

export function markAllRead(items: readonly NotificationItem[], now: number): NotificationItem[] {
  return items.map((i) => (i.readAt === null ? { ...i, readAt: now } : i));
}

/** ต่อหน้าถัดไปท้ายรายการ ตัด id ซ้ำ (ระหว่างโหลดอาจมีแถวใหม่ทำให้ขอบหน้าเลื่อน) — คงลำดับเดิม */
export function mergePage(existing: readonly NotificationItem[], incoming: readonly NotificationItem[]): NotificationItem[] {
  const seen = new Set(existing.map((i) => i.id));
  return [...existing, ...incoming.filter((i) => !seen.has(i.id))];
}

// ───────── ข้อความ ─────────
const ISOLATE = /[\u202a-\u202e\u2066-\u2069]/g;
/** ห่อค่าจากผู้ใช้ด้วย FSI…PDI (U+2068…U+2069) กันทิศทางข้อความรั่วออกนอกชื่อ · ตัด isolate/embedding ที่แฝงมาในค่าก่อน */
export function isolate(value: string): string {
  return `\u2068${value.replace(ISOLATE, "")}\u2069`;
}

const safeTz = (tz: unknown): string => (typeof tz === "string" && isValidTimeZone(tz) ? tz : DEFAULT_TZ);

/** "เสาร์ 24 ต.ค. 18:00" / "Sat 24 Oct 18:00" ใน tz ที่ระบุ (ใช้เป็น {when}/{expiresAt}) */
export function whenLabel(epochMs: number, tz: string, locale: CalendarLocale): string {
  const z = safeTz(tz);
  return `${weekdayShort(epochMs, { locale, tz: z })} ${format(epochMs, { locale, style: "day-month", tz: z })} ${format(epochMs, { locale, style: "time", tz: z })}`;
}

export type NotificationIcon = "calendar-plus" | "user-plus" | "circle-check" | "user-minus" | "key" | "shield" | "info";
export type NotificationTone = "appt" | "invite" | "ok" | "plain";

export interface NotificationView {
  known: boolean;
  /** คีย์เต็ม เช่น notifications.appointment.created */
  messageKey: string;
  values: Record<string, string>;
  icon: NotificationIcon;
  tone: NotificationTone;
  /** ปลายทางเมื่อแตะ (UX 9.5 ข้อ 6) · null = ไม่มีที่ไป */
  href: string | null;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const id = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
const ms = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const UNKNOWN: NotificationView = { known: false, messageKey: "notifications.unknown", values: {}, icon: "info", tone: "plain", href: null };

/**
 * แจ้งเตือนหนึ่งแถว → ข้อความ + ค่า ICU + ไอคอน + ปลายทาง
 * ชนิดไม่รู้จัก หรือ params ไม่ครบ/ผิดชนิด → notifications.unknown (ไม่เดา ไม่โชว์ค่าดิบ)
 * ปลายทาง: appointment.* → /appointments/<id> · invite.received → /groups · accepted|declined → /groups/<gid> · pin_reset.* → /me
 */
export function notificationView(kind: string, params: Record<string, unknown>, locale: CalendarLocale): NotificationView {
  switch (kind) {
    case "appointment.created": {
      const groupName = str(params.groupName);
      const title = str(params.title);
      const appointmentId = id(params.appointmentId);
      const startAt = ms(params.startAt);
      if (!groupName || !title || !appointmentId || startAt === null) return UNKNOWN;
      return {
        known: true,
        messageKey: "notifications.appointment.created",
        values: { groupName: isolate(groupName), title: isolate(title), when: whenLabel(startAt, safeTz(params.tz), locale) },
        icon: "calendar-plus",
        tone: "appt",
        href: `/appointments/${appointmentId}`,
      };
    }
    case "group.invite.received": {
      const groupName = str(params.groupName);
      const inviterName = str(params.inviterName);
      if (!groupName || !inviterName) return UNKNOWN;
      return {
        known: true,
        messageKey: "notifications.group.invite.received",
        values: { groupName: isolate(groupName), inviterName: isolate(inviterName) },
        icon: "user-plus",
        tone: "invite",
        href: "/groups",
      };
    }
    case "group.invite.accepted":
    case "group.invite.declined": {
      const groupName = str(params.groupName);
      const inviteeName = str(params.inviteeName);
      const gid = id(params.groupId);
      if (!groupName || !inviteeName || !gid) return UNKNOWN;
      const accepted = kind === "group.invite.accepted";
      return {
        known: true,
        messageKey: `notifications.${kind}`,
        values: { groupName: isolate(groupName), inviteeName: isolate(inviteeName) },
        icon: accepted ? "circle-check" : "user-minus",
        tone: accepted ? "ok" : "plain",
        href: `/groups/${gid}`,
      };
    }
    case "pin_reset.approved": {
      const expiresAt = ms(params.expiresAt);
      if (expiresAt === null) return UNKNOWN;
      return { known: true, messageKey: "notifications.pin_reset.approved", values: { expiresAt: whenLabel(expiresAt, DEFAULT_TZ, locale) }, icon: "key", tone: "plain", href: "/me" };
    }
    case "pin_reset.cancelled_by_login":
      return { known: true, messageKey: "notifications.pin_reset.cancelled_by_login", values: {}, icon: "shield", tone: "plain", href: "/me" };
    default:
      return UNKNOWN;
  }
}

export interface TimeLabel {
  key: string;
  values: Record<string, string | number>;
}

/**
 * เวลาของแถว (วันท้องถิ่น Asia/Bangkok): < 1 นาที "เมื่อสักครู่" · < 1 ชม. "N นาทีที่แล้ว" · วันนี้ "N ชม.ที่แล้ว" ·
 * เมื่อวาน "เมื่อวาน HH:MM" · เก่ากว่า "วัน วันที่ · HH:MM"
 */
export function timeLabel(createdAt: number, nowMs: number, locale: CalendarLocale): TimeLabel {
  const diff = Math.max(0, nowMs - createdAt);
  if (diff < 60_000) return { key: "notifications.time.justNow", values: {} };
  if (diff < 3_600_000) return { key: "notifications.time.minutes", values: { count: Math.floor(diff / 60_000) } };
  const today = todayIn(DEFAULT_TZ, nowMs);
  const day = toLocal(createdAt, DEFAULT_TZ).date;
  const time = format(createdAt, { locale, style: "time", tz: DEFAULT_TZ });
  if (day === today && diff < 86_400_000) return { key: "notifications.time.hours", values: { count: Math.floor(diff / 3_600_000) } };
  if (day === addDays(today, -1)) return { key: "notifications.time.yesterday", values: { time } };
  const date = `${weekdayShort(day, { locale })} ${format(day, { locale, style: "day-month" })}`;
  return { key: "notifications.time.date", values: { date, time } };
}
