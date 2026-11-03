// session ของหน้าเว็บ (React Server Components) — อ่านครั้งเดียวต่อ request (R7_CONTRACT §3.1 B-1)
//  - React.cache = memo ต่อ "การเรนเดอร์หนึ่ง request" ของ RSC (Next ล้างให้ทุก request) → layout/page/generateMetadata/loader
//    เรียกกี่ครั้งก็ findSessionWithUser 1 ครั้ง · touchSession ≤ 1 ครั้ง · ไม่มี module-level cache ของข้อมูลผู้ใช้
//  - นอก RSC (route handler, server action, Vitest) React.cache ไม่ memo → อ่านสดทุกครั้ง (ปลอดภัย ไม่ปนข้าม request)
//  - ข้อมูลผู้ใช้มาจาก JOIN เดียวกับ session (ไม่ต้อง findUserById ซ้ำ) · status/is_admin/must_change_pin สดจาก DB ของ request นี้
//  - session หมดอายุ/ถูกเพิกถอน/บัญชีถูกลบ → anonymous ใน request ถัดไปทันที (ไม่มีอะไรค้างข้าม request)
//  - ฐานล่ม → promise reject (ทุกผู้เรียกใน request เดียวกันเห็น error เดียวกัน) — ผู้เรียกตัดสินเอง (เช่น SessionUnavailableError)
import { cache } from 'react';
import { cookies } from 'next/headers';
import type { Actor } from '@/lib/rbac/types';
import { resolveSession, type ResolvedSession } from './session';

/**
 * Request เทียมที่มีแต่ cookie ของ request ปัจจุบัน (ตัวเดียวทั้ง request) — ส่งต่อให้ service/authCtx ได้เหมือน route handler
 * ไม่มี header อื่น (IP/UA) — ใช้เพื่ออ่าน cookie เท่านั้น
 */
export const getPageRequest = cache(async (): Promise<Request> => {
  const header = (await cookies()).toString();
  return new Request('http://internal.invalid/', { headers: header ? { cookie: header } : {} });
});

export type RequestSession = ResolvedSession & {
  /** Request เทียมตัวเดียวกับ getPageRequest() ของ request นี้ */
  readonly req: Request;
};

/**
 * session ของ request ปัจจุบัน (หน้า RSC): { req, actor, user }
 * - actor: anonymous หรือ UserActor (status อาจเป็น 'suspended' — RBAC ปฏิเสธเอง เหมือน getActor)
 * - user: แถวผู้ใช้จาก JOIN (id, username, displayName ดิบ, isAdmin, status, mustChangePin, locale, theme) · anonymous → null
 *   หน้าเว็บต้องเช็ก status === 'active' และ sanitize displayName เองเหมือนเดิม
 */
export const getRequestSession = cache(async (): Promise<RequestSession> => {
  const req = await getPageRequest();
  const s = await resolveSession(req);
  return { req, actor: s.actor, user: s.user };
});

/** actor ของ request ปัจจุบัน (หน้า RSC) — แทน `getActor(await pageRequest())` */
export async function getRequestActor(): Promise<Actor> {
  return (await getRequestSession()).actor;
}
