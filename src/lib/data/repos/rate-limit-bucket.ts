// repo: rate_limit_bucket — ADR 0002 §3 · fixed window · เพิ่มค่าแบบอะตอมด้วย UPSERT เดียว (ไม่มี read-then-write)
//   INSERT … VALUES (key, window_start, 1)
//   ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
//                                  window_start = excluded.window_start
//   RETURNING count
// key ที่รับมา = ผ่านการ HMAC แล้ว (ผู้เรียก) · repo ไม่รู้จัก IP ดิบ
import { and, eq, sql } from 'drizzle-orm';
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

export type BucketReservation = { admitted: boolean; windowEnd: number };

/**
 * จองช่อง 1 ครั้งแบบมีเพดาน (UPSERT เดียวอะตอมมิก): หน้าต่างใหม่ → เริ่มที่ 1 · หน้าต่างเดิมและ count < limit → +1 · เต็มแล้ว → ไม่แก้ (DO UPDATE … WHERE เท็จ → ไม่มีแถวกลับ)
 * ผู้ถูกปฏิเสธจึงไม่ทำให้ count เกิน limit · ผู้เรียกคืนช่อง (refundBucket) เมื่อ login สำเร็จ/ถูกปฏิเสธโดยไม่ verify
 */
export async function reserveBucket(db: DbOrTx, key: string, windowMs: number, limit: number, now: number): Promise<BucketReservation> {
  const windowStart = windowStartOf(now, windowMs);
  const windowEnd = windowStart + windowMs;
  if (limit < 1) return { admitted: false, windowEnd };
  const rows = await db
    .insert(rateLimitBucket)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitBucket.key,
      set: {
        count: sql`CASE WHEN ${rateLimitBucket.windowStart} = excluded.window_start THEN ${rateLimitBucket.count} + 1 ELSE 1 END`,
        windowStart: sql`excluded.window_start`,
      },
      setWhere: sql`${rateLimitBucket.windowStart} <> excluded.window_start OR ${rateLimitBucket.count} < ${limit}`,
    })
    .returning({ count: rateLimitBucket.count });
  return { admitted: rows.length > 0, windowEnd };
}

/** คืนช่องที่จองไว้ 1 ช่อง (ลด count ในหน้าต่างปัจจุบัน ไม่ต่ำกว่า 0) — หน้าต่างเปลี่ยนไปแล้วไม่ทำอะไร */
export async function refundBucket(db: DbOrTx, key: string, windowMs: number, now: number): Promise<void> {
  await db
    .update(rateLimitBucket)
    .set({ count: sql`MAX(${rateLimitBucket.count} - 1, 0)` })
    .where(and(eq(rateLimitBucket.key, key), eq(rateLimitBucket.windowStart, windowStartOf(now, windowMs))));
}
