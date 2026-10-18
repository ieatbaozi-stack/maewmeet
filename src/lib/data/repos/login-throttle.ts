// repo: login_throttle — ADR 0002 §3 · key = 'u:' + username_normalized (มีบัญชีหรือไม่ก็ตาม)
// repo เก็บแค่ตัวนับ + locked_until · "ตารางเวลาล็อก" (2^(f-5) นาที) เป็นของ Auth ส่งมาเป็นฟังก์ชัน
import { eq, sql } from 'drizzle-orm';
import { loginThrottle } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export type LoginThrottleRow = typeof loginThrottle.$inferSelect;

export async function getLoginThrottle(db: DbOrTx, key: string): Promise<LoginThrottleRow | null> {
  const rows = await db.select().from(loginThrottle).where(eq(loginThrottle.key, key)).limit(1);
  return rows[0] ?? null;
}

/** ล็อกอยู่ไหมตอน now → วินาทีที่เหลือ (ปัดขึ้น) หรือ 0 */
export function lockRemainingSec(row: Pick<LoginThrottleRow, 'lockedUntil'> | null, now: number): number {
  if (!row?.lockedUntil || row.lockedUntil <= now) return 0;
  return Math.ceil((row.lockedUntil - now) / 1000);
}

/**
 * บันทึกการล็อกอินผิด 1 ครั้ง: failures += 1 แบบอะตอมด้วย UPSERT เดียว แล้วตั้ง locked_until
 * จาก `lockMsFor(failures)` (0 / ไม่ระบุ = ไม่ล็อก) · คืนแถวหลังอัปเดต
 */
export async function recordLoginFailure(
  db: DbOrTx,
  key: string,
  now: number,
  lockMsFor: (failures: number) => number,
): Promise<LoginThrottleRow> {
  const up = await db
    .insert(loginThrottle)
    .values({ key, failures: 1, lockedUntil: null, updatedAt: now })
    .onConflictDoUpdate({
      target: loginThrottle.key,
      set: { failures: sql`${loginThrottle.failures} + 1`, updatedAt: now },
    })
    .returning();
  const failures = up[0]!.failures;
  const lockMs = lockMsFor(failures);
  if (lockMs > 0) {
    const rows = await db
      .update(loginThrottle)
      .set({ lockedUntil: now + lockMs })
      .where(eq(loginThrottle.key, key))
      .returning();
    return rows[0]!;
  }
  return up[0]!;
}

/** สำเร็จ 1 ครั้ง → failures = 0, ปลดล็อก (แถวคงไว้ให้ cron กวาดตามอายุ) · super admin unlock ใช้ตัวเดียวกัน */
export async function resetLoginThrottle(db: DbOrTx, key: string, now: number): Promise<void> {
  await db
    .update(loginThrottle)
    .set({ failures: 0, lockedUntil: null, updatedAt: now })
    .where(eq(loginThrottle.key, key));
}

export async function countLoginThrottles(db: DbOrTx): Promise<number> {
  const rows = await db.select({ key: loginThrottle.key }).from(loginThrottle);
  return rows.length;
}
