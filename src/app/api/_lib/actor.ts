// ตัวหา actor ของ request — ARCHITECTURE §2 ขั้น 3 · §4
// R0: stub คืน anonymous เสมอ (ยังไม่มี session)
// R1 (Auth & Access): เสียบ getActor จริงด้วย setActorResolver(...) จาก src/lib/auth/session.ts
//   (เช่นใน instrumentation หรือโมดูลที่ route import) หรือแทนค่า defaultResolver ในไฟล์นี้ผ่าน Lead
import type { Actor } from '@/lib/rbac/types';

export type ActorResolver = (req: Request) => Promise<Actor>;

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
