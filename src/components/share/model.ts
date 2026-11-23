// view-model ล้วนของแชร์นัด/แขก (R18 §S · ADR 0016 · UX R18_SHARE_FLOW) — ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/share-model.test.ts
// สิทธิ์จริงตรวจที่เซิร์ฟเวอร์ทุกครั้ง · ฟังก์ชันในไฟล์นี้ใช้ตัดสินแค่ "แสดงอะไร" ไม่ใช่ "ทำได้ไหม"
import type { Failure } from "@/components/appointments/api";
import { safeNext } from "@/lib/shared/safe-next";
import { APPOINTMENT_GUESTS_MAX } from "@/lib/shared/limits";

export type Answer = "going" | "maybe" | "not_going";

export interface GoingMaybe {
  going: number;
  maybe: number;
}

/** ตัวเลขบนการ์ดลิงก์ (ไม่มีชื่อ/avatar): ศูนย์ทั้งคู่ = none · อย่างใดอย่างหนึ่งเป็น 0 ซ่อนส่วนนั้น */
export function previewCountParts(c: GoingMaybe): { none: boolean; going: number | null; maybe: number | null } {
  const going = Number.isFinite(c.going) && c.going > 0 ? Math.trunc(c.going) : 0;
  const maybe = Number.isFinite(c.maybe) && c.maybe > 0 ? Math.trunc(c.maybe) : 0;
  return { none: going === 0 && maybe === 0, going: going > 0 ? going : null, maybe: maybe > 0 ? maybe : null };
}

/**
 * ปลายทาง login/สมัครจากหน้าลิงก์: `?next=/i/<token>` เฉพาะเมื่อ path ผ่าน allowlist (เหมือนฝั่งเซิร์ฟเวอร์) · ไม่ผ่าน → ไม่ใส่
 * encodeURIComponent: อักขระใน token เป็น [A-Za-z0-9_-] แต่ "/" ใน path ต้อง encode ตามปกติ
 */
export function authHref(base: "/login" | "/signup", token: string): string {
  const next = safeNext(`/i/${token}`);
  return next === "/" ? base : `${base}?next=${encodeURIComponent(next)}`;
}

/** query `next` ของหน้า login/signup → ค่าที่ส่งต่อให้ฟอร์ม ('/' = ไม่มี) */
export function nextFromSearch(raw: string | string[] | undefined): string {
  return safeNext(Array.isArray(raw) ? raw[0] : raw);
}

/** ลิงก์ไปหน้าสมัคร/เข้าสู่ระบบที่พก `next` ต่อ (ไม่มี next ปลอดภัย → ลิงก์เปล่า) */
export function withNext(base: "/login" | "/signup", next: string): string {
  return next === "/" ? base : `${base}?next=${encodeURIComponent(next)}`;
}

/** ปลายทางหลังเข้าสู่ระบบ: ต้องเปลี่ยน PIN ก่อนเสมอ · ไม่งั้นไป next (ผ่าน allowlist ซ้ำ) */
export function postAuthDestination(mustChangePin: boolean, next: string): string {
  return mustChangePin ? "/set-pin" : safeNext(next);
}

export type JoinFailure = "full" | "expired" | "invalid" | "rate" | "error";

/** ความล้มเหลวของ POST /api/share/join → หน้าสถานะที่ตรง (หรือข้อความใต้ปุ่ม) */
export function joinFailure(f: Failure): JoinFailure {
  if (f.kind !== "api") return "error";
  switch (f.error.code) {
    case "SHARE_FULL":
      return "full";
    case "SHARE_LINK_EXPIRED":
      return "expired";
    case "SHARE_LINK_INVALID":
      return "invalid";
    case "RATE_LIMITED":
      return "rate";
    default:
      return "error";
  }
}

/** ข้อความผิดพลาดของ sheet ชวน (share.error.*) */
export function shareErrorKey(f: Failure, fallback: "generic" | "revoke" = "generic"): string {
  if (f.kind === "api") {
    if (f.error.code === "APPOINTMENT_CANCELLED") return "share.error.cancelled";
    if (f.error.code === "APPOINTMENT_PAST") return "share.error.past";
    if (f.error.code === "RATE_LIMITED") return "share.error.rate";
  }
  return `share.error.${fallback}`;
}

/** บรรทัดเพดานแขก: เต็ม = เตือน (ไอคอน + --warn-ink) */
export function guestLimit(count: number, max: number = APPOINTMENT_GUESTS_MAX): { count: number; max: number; full: boolean } {
  const n = Math.max(0, Math.trunc(count));
  return { count: n, max, full: n >= max };
}

export interface ShareLinkLike {
  id: string;
  mine: boolean;
  createdBy: { displayName: string } | null;
  url?: string;
}

/** ลิงก์ของคนอื่นที่ผู้ดูปิดได้ (เซิร์ฟเวอร์ส่งมาเฉพาะที่ปิดได้) — แสดงเป็นรายการใน sheet เมื่อมีมากกว่าของตัวเอง */
export function othersLinks<T extends ShareLinkLike>(links: readonly T[] | undefined): T[] {
  return (links ?? []).filter((l) => !l.mine);
}

/** คำตอบแขกสำหรับรายการ: null = ยังไม่ตอบ */
export function guestAnswerKey(response: Answer | null): string {
  return response === null ? "guests.noReply" : `appointments.rsvp.answer.${response}`;
}

/** ปิดตอบด้วยเหตุผลใด (มุมมองแขก) — ยกเลิก/ผ่านแล้ว/ไม่มีสิทธิ์ · null = ตอบได้ (เซิร์ฟเวอร์ตัดสินจริง) */
export function guestRsvpClosed(a: { status: "active" | "cancelled"; isPast: boolean; permissions: { canRsvp: boolean } }): "cancelled" | "past" | "forbidden" | null {
  if (a.status === "cancelled") return "cancelled";
  if (a.isPast) return "past";
  if (!a.permissions.canRsvp) return "forbidden";
  return null;
}

/** นับใหม่ทันทีที่แขกตอบ (optimistic) — คืนค่าเดิมถ้าคำตอบเดิม · ไม่ติดลบ · ไม่ไป ไม่อยู่ในตัวเลขที่แขกเห็น */
export function applyGuestAnswer<T extends { myRsvp: Answer | null; counts: GoingMaybe }>(a: T, next: Answer): T {
  if (a.myRsvp === next) return a;
  const counts = { ...a.counts };
  if (a.myRsvp === "going") counts.going = Math.max(0, counts.going - 1);
  if (a.myRsvp === "maybe") counts.maybe = Math.max(0, counts.maybe - 1);
  if (next === "going") counts.going += 1;
  if (next === "maybe") counts.maybe += 1;
  return { ...a, myRsvp: next, counts };
}
