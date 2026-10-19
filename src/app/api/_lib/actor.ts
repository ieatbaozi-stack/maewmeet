// ตัวหา actor ของ request — ARCHITECTURE §2 ขั้น 3 · §4
// R0: stub คืน anonymous เสมอ (ยังไม่มี session)
// R1 (Auth & Access): เสียบ getActor จริงด้วย setActorResolver(...) จาก src/lib/auth/session.ts (ดูสัญญา GetActor ด้านล่าง)
//   (เช่นใน instrumentation หรือโมดูลที่ route import) หรือแทนค่า defaultResolver ในไฟล์นี้ผ่าน Lead
import type { Actor } from '@/lib/rbac/types';

/**
 * สัญญากับ Auth & Access (R1_CONTRACT §4): `src/lib/auth/session.ts` export `getActor: GetActor`
 * - อ่าน cookie session จาก `req.headers.get('cookie')` (ไม่พึ่ง next/headers → เทสต์เรียก handler ตรงได้)
 * - ไม่พบ/หมดอายุ → { kind: 'anonymous' } · พบ → UserActor ที่ status/isSuperAdmin/mustChangePin อ่านสดจาก DB
 * - ห้ามโยน error ธรรมดาเมื่อไม่มี session (โยนได้เฉพาะ AppError ที่ route แปลงเป็น response เช่น ฐานล่ม)
 * จุดเสียบ: `setActorResolver(getActor)` (คืนฟังก์ชันถอด) · ค่าเริ่มต้น = anonymous
 */
export type GetActor = (req: Request) => Promise<Actor>;
export type ActorResolver = GetActor;

const ANONYMOUS: Actor = Object.freeze({ kind: 'anonymous' });

export const anonymousActorResolver: ActorResolver = async () => ANONYMOUS;

let resolver: ActorResolver = anonymousActorResolver;

export function resolveActor(req: Request): Promise<Actor> {
  return resolver(req);
}

/** แทนตัวหา actor (R1 session · เทสต์เมทริกซ์ HTTP) — คืนฟังก์ชันคืนค่าเดิม */
export function setActorResolver(next: ActorResolver): () => void {
  const prev = resolver;
  resolver = next;
  return () => {
    resolver = prev;
  };
}
