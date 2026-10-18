// repo: rate_limit_bucket — ADR 0002 §3 · fixed window · เพิ่มค่าแบบอะตอมด้วย UPSERT เดียว (ไม่มี read-then-write)
//   INSERT … VALUES (key, window_start, 1)
//   ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
//                                  window_start = excluded.window_start
//   RETURNING count
// key ที่รับมา = ผ่านการ HMAC แล้ว (ผู้เรียก) · repo ไม่รู้จัก IP ดิบ
import { eq, sql } from 'drizzle-orm';
import { rateLimitBucket } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export type BucketHit = {
  /** ค่านับในหน้าต่างปัจจุบัน หลังรวมครั้งนี้ */
  count: number;
  windowStart: number;
  /** ปลายหน้าต่าง (epoch ms) — ผู้เรียกใช้คำนวณ Retry-After */
  windowEnd: number;
};

export function windowStartOf(now: number, windowMs: number): number {
  if (!Number.isInteger(windowMs) || windowMs <= 0) throw new RangeError('windowMs must be a positive integer');
  return Math.floor(now / windowMs) * windowMs;
}

/** นับ 1 ครั้งในหน้าต่าง `windowMs` ที่ครอบ `now` · หน้าต่างใหม่ → เริ่มที่ 1 */
export async function hitBucket(db: DbOrTx, key: string, windowMs: number, now: number): Promise<BucketHit> {
  const windowStart = windowStartOf(now, windowMs);
  const rows = await db
    .insert(rateLimitBucket)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitBucket.key,
      set: {
        count: sql`CASE WHEN ${rateLimitBucket.windowStart} = excluded.window_start THEN ${rateLimitBucket.count} + 1 ELSE 1 END`,
        windowStart: sql`excluded.window_start`,
      },
    })
    .returning({ count: rateLimitBucket.count });
  return { count: Number(rows[0]!.count), windowStart, windowEnd: windowStart + windowMs };
}

/** อ่านค่าโดยไม่นับ (หน้าต่างอื่น/ไม่มีแถว = 0) — สำหรับ "นับเฉพาะที่ผิด" ที่ตรวจก่อนแล้วค่อย hit ทีหลัง */
export async function peekBucket(db: DbOrTx, key: string, windowMs: number, now: number): Promise<BucketHit> {
  const windowStart = windowStartOf(now, windowMs);
  const rows = await db
    .select({ count: rateLimitBucket.count, windowStart: rateLimitBucket.windowStart })
    .from(rateLimitBucket)
    .where(eq(rateLimitBucket.key, key))
    .limit(1);
  const row = rows[0];
  const count = row && row.windowStart === windowStart ? Number(row.count) : 0;
  return { count, windowStart, windowEnd: windowStart + windowMs };
}
