// R16 H3 (boss B1 2026-11-18): rate limit ฝั่งอ่านแบบ global ต่อผู้ใช้ — API_READ_RATE_LIMIT (600 คำขอ/10 นาที) รวมทุก GET ที่ต้องล็อกอิน
//  - route wrapper (src/app/api/_lib/route.ts) ตัดสินว่าคำขอไหนนับ (readLimited) แล้วเรียก takeReadSlot หลังรู้ actor
//  - ถังเก็บใน rate_limit_bucket (UPSERT มีเพดาน — reserveBucket) เหมือน limiter อื่น → นับรวมข้าม instance
//  - ทางลัดใน process: ผู้ใช้ที่เพิ่งถูกปฏิเสธในหน้าต่างนี้ → 429 ทันทีโดยไม่แตะ DB จนหน้าต่างหมด (สคริปต์ยิงรัวไม่สร้างโหลด DB ต่อ)
//    เก็บแค่ userId → ปลายหน้าต่าง (epoch ms) · ไม่มีข้อมูลผู้ใช้อื่น · มีเพดานจำนวนคีย์ · หน้าต่างหมดแล้วกลับไปถาม DB ตามปกติ
import type { Db } from '@/db/client';
import { reserveBucket } from '@/lib/data/repos/rate-limit-bucket';
import { rateKey } from '@/lib/auth/throttle';
import type { Action } from '@/lib/rbac/actions';
import { isPublicAction } from '@/lib/rbac/actions';
import { AppError } from '@/lib/shared/errors';
import { API_READ_RATE_LIMIT } from '@/lib/shared/limits';
import { serialized } from './tx';

/** เพดานจำนวนผู้ใช้ที่จำว่า "ถูกปฏิเสธอยู่" ต่อ process — เกินแล้วทิ้งรายการเก่าสุด (แค่เสียทางลัด ไม่เสียความถูกต้อง: DB ยังเป็นตัวตัดสิน) */
export const READ_BLOCK_MEMO_MAX = 1000;
const blockedUntil = new Map<string, number>();

const limited = (windowEnd: number, now: number): AppError =>
  new AppError('RATE_LIMITED', undefined, { retryAfterSec: Math.max(1, Math.ceil((windowEnd - now) / 1000)) });

/**
 * คำขอนี้อยู่ใต้ limiter อ่านไหม: GET + route แบบ actor + มี action ที่ไม่ใช่สาธารณะ + ผู้เรียกเป็นผู้ใช้ที่ล็อกอิน
 * cron / health (auth ไม่ใช่ actor หรือ action null) · action สาธารณะ (pin-reset status) · anonymous → ไม่นับ
 */
export function readLimited(method: string, auth: string, action: Action | null, actorIsUser: boolean): boolean {
  return method === 'GET' && auth === 'actor' && action !== null && !isPublicAction(action) && actorIsUser;
}

/** ทางลัดใน process — โยน RATE_LIMITED ถ้าผู้ใช้นี้ถูกปฏิเสธไปแล้วในหน้าต่างที่ยังไม่หมด (ไม่แตะ DB) */
export function assertNotReadBlocked(userId: string, now: number): void {
  const until = blockedUntil.get(userId);
  if (until === undefined) return;
  if (now < until) throw limited(until, now);
  blockedUntil.delete(userId);
}

function rememberBlocked(userId: string, windowEnd: number): void {
  blockedUntil.delete(userId);
  if (blockedUntil.size >= READ_BLOCK_MEMO_MAX) {
    const oldest = blockedUntil.keys().next();
    if (!oldest.done) blockedUntil.delete(oldest.value);
  }
  blockedUntil.set(userId, windowEnd);
}

/** จองช่องอ่าน 1 ครั้ง (UPSERT อะตอมมิก มีเพดาน) · เต็ม → จำไว้ใน process แล้วโยน RATE_LIMITED + Retry-After */
export async function takeReadSlot(db: Db, userId: string, now: number): Promise<void> {
  const spec = API_READ_RATE_LIMIT;
  const slot = await serialized(db, () => reserveBucket(db, rateKey(spec, userId), spec.windowMs, spec.limit, now));
  if (slot.admitted) return;
  rememberBlocked(userId, slot.windowEnd);
  throw limited(slot.windowEnd, now);
}

/** เทสต์เท่านั้น: ล้างทางลัดใน process */
export function resetReadBlockMemoForTests(): void {
  blockedUntil.clear();
}
