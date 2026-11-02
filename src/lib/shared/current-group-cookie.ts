// คุกกี้ "กลุ่มปัจจุบัน" `mm_group` — R6D G1 · ADR 0009 §5 · ที่เดียวที่รู้ชื่อ/รูปคุกกี้ (platform) — auth import ตัวลบไปใช้ตอน logout
//  - เก็บแค่ group id (uuid) · ไม่เข้ารหัส/ไม่เซ็น: id ไม่ลับ และค่าถูกตรวจทุกครั้งที่อ่าน (uuid + อยู่ในกลุ่มของฉัน)
//  - ตั้งที่เซิร์ฟเวอร์เท่านั้น (PUT /api/me/current-group หลังตรวจสมาชิกจริง) · HttpOnly · SameSite=Lax · Secure · อายุ 1 ปี (รูปเดียวกับ /api/prefs)
//  - ค่าคุกกี้ไม่ถูก log และไม่สะท้อนกลับใน response
import { z } from 'zod';

export const CURRENT_GROUP_COOKIE = 'mm_group';
export const CURRENT_GROUP_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60; // 1 ปี

/** รูปเดียวกับ CookieSpec ของ route wrapper (ใช้ผ่าน `reply({cookies})` ได้ตรง ๆ) */
export type CurrentGroupCookie = {
  name: typeof CURRENT_GROUP_COOKIE;
  value: string;
  maxAgeSec: number;
  path: '/';
  sameSite: 'Lax';
  secure: true;
  httpOnly: true;
};

const spec = (value: string, maxAgeSec: number): CurrentGroupCookie => ({
  name: CURRENT_GROUP_COOKIE,
  value,
  maxAgeSec,
  path: '/',
  sameSite: 'Lax',
  secure: true,
  httpOnly: true,
});

/** ตั้งคุกกี้ให้ชี้กลุ่ม gid — ผู้เรียกต้องตรวจสมาชิกภาพมาแล้ว (service rememberCurrentGroup) */
export const currentGroupCookie = (gid: string): CurrentGroupCookie => spec(gid, CURRENT_GROUP_COOKIE_MAX_AGE_SEC);

/** ลบคุกกี้ (Max-Age=0) — ให้ auth ใส่ใน `cookies` ของ reply ตอน logout / logout-all (ลบบัญชี: /api/me/delete ใส่แล้ว) */
export const clearCurrentGroupCookie = (): CurrentGroupCookie => spec('', 0);

const uuid = z.uuid();

/** ค่าคุกกี้ดิบ → group id ถ้าเป็น uuid · อื่น ๆ (ไม่มี/ว่าง/มั่ว) → null (ไม่ error) */
export function parseCurrentGroupCookie(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return uuid.safeParse(raw).success ? raw : null;
}

export type CalendarGroupChoice = {
  /** กลุ่มที่จะแสดง (เป็นกลุ่มของฉันเสมอ) */
  gid: string;
  /** มี ?g= แต่ไม่ใช่กลุ่มของฉัน → true (UI แจ้งสั้น ๆ) · คุกกี้ใช้ไม่ได้ → false เสมอ (ไม่รั่วว่ากลุ่มนั้นมีอยู่ — R6D-2) */
  groupMissing: boolean;
  /** ?g= เป็นกลุ่มของฉันแต่ต่างจากคุกกี้ → gid ที่หน้าควรจำ (เรนเดอร์ <RememberGroup>) · อื่น ๆ null */
  rememberGid: string | null;
};

/**
 * เลือกกลุ่มของ /calendar (ADR 0009 §5): `?g=` (ถ้าเป็นกลุ่มของฉัน) → คุกกี้ (uuid และอยู่ในกลุ่มของฉัน) → กลุ่มแรก
 * pure — ใช้รายชื่อกลุ่มที่โหลดอยู่แล้ว (0 query เพิ่ม) · `myGroupIds` ต้องไม่ว่าง (ผู้เรียกจัดการกรณีไม่มีกลุ่มเอง)
 */
export function chooseCalendarGroup(myGroupIds: readonly string[], g: string | undefined, rawCookie: string | null | undefined): CalendarGroupChoice {
  const first = myGroupIds[0];
  if (first === undefined) throw new Error('chooseCalendarGroup: no groups');
  const remembered = parseCurrentGroupCookie(rawCookie);
  const fromCookie = remembered !== null && myGroupIds.includes(remembered) ? remembered : null;
  const asked = g !== undefined && g !== '' ? g : null;
  if (asked !== null && myGroupIds.includes(asked)) {
    return { gid: asked, groupMissing: false, rememberGid: asked === remembered ? null : asked };
  }
  return { gid: fromCookie ?? first, groupMissing: asked !== null, rememberGid: null };
}
