// repo: login_throttle — ADR 0002 §3 · key = 'u:' + username_normalized (มีบัญชีหรือไม่ก็ตาม)
// repo เก็บแค่ตัวนับ + locked_until · "ตารางเวลาล็อก" (2^(f-5) นาที) เป็นของ Auth ส่งมาเป็นฟังก์ชัน
import { eq, sql, type SQL } from 'drizzle-orm';
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

export type LoginReservation =
  | { admitted: true; row: LoginThrottleRow }
  /** ล็อกอยู่ (ไม่ได้นับ ไม่ต้อง verify) — lockedUntil = การตัดสินใจเดิมที่ยังมีผล */
  | { admitted: false; lockedUntil: number };

/**
 * locked_until ใหม่เมื่อ failures เพิ่มเป็น (failures + 1): สร้างเป็น CASE ใน SQL จากตาราง `lockMsFor` (แหล่งความจริงเดียว)
 * f < เกณฑ์ → NULL · f ถึงเพดานแล้ว → ELSE = เพดาน
 */
function nextLockedUntilSql(now: number, lockMsFor: (failures: number) => number): SQL {
  const first = Array.from({ length: 64 }, (_, i) => i + 1).find((f) => lockMsFor(f) > 0) ?? 1;
  const whens: SQL[] = [];
  let last = first;
  for (let f = first; f < first + 24; f++) {
    whens.push(sql`WHEN ${f} THEN ${now + lockMsFor(f)}`);
    last = f;
  }
  return sql`CASE WHEN ${loginThrottle.failures} + 1 < ${first} THEN NULL ELSE CASE ${loginThrottle.failures} + 1 ${sql.join(whens, sql` `)} ELSE ${now + lockMsFor(last + 1)} END END`;
}

/**
 * จอง "ความพยายาม 1 ครั้ง" ก่อน verify — UPSERT เดียวอะตอมมิก (ไม่มีช่วง check-then-act):
 *   - ไม่ได้ล็อกอยู่ (locked_until NULL หรือ ≤ now): failures += 1 และตั้ง locked_until ตามตาราง (ถึงเกณฑ์) → admitted
 *   - ล็อกอยู่: ไม่แก้อะไรเลย (ไม่นับเพิ่ม · การตัดสินใจเดิมคงอยู่) → DO UPDATE … WHERE เป็นเท็จ → ไม่มีแถวกลับ → rejected
 * ผู้เรียกต้อง verify เฉพาะเมื่อ admitted · สำเร็จ → resetLoginThrottle · ผิด → ใช้ row ที่ได้ตอบทันที (ไม่ต้องเขียนซ้ำ)
 * ครั้งที่ถึงเกณฑ์ (เช่น ครั้งที่ 5) ยังถือว่า admitted (verify ได้ 1 ครั้ง) แต่ทุกคำขอที่ตามมาถูกปฏิเสธโดยไม่ verify
 */
export async function reserveLoginAttempt(
  db: DbOrTx,
  key: string,
  now: number,
  lockMsFor: (failures: number) => number,
): Promise<LoginReservation> {
  const rows = await db
    .insert(loginThrottle)
    .values({ key, failures: 1, lockedUntil: lockMsFor(1) > 0 ? now + lockMsFor(1) : null, updatedAt: now })
    .onConflictDoUpdate({
      target: loginThrottle.key,
      set: {
        failures: sql`${loginThrottle.failures} + 1`,
        lockedUntil: nextLockedUntilSql(now, lockMsFor),
        updatedAt: now,
      },
      setWhere: sql`${loginThrottle.lockedUntil} IS NULL OR ${loginThrottle.lockedUntil} <= ${now}`,
    })
    .returning();
  if (rows[0]) return { admitted: true, row: rows[0] };
  const cur = await getLoginThrottle(db, key);
  // อ่านซ้ำเพื่อบอกเวลาที่เหลือ — ถ้าล็อกหมดอายุพอดีระหว่างนี้ ให้ถือว่าเหลือ ≥ 1 วินาที (ลองใหม่ได้)
  return { admitted: false, lockedUntil: Math.max(cur?.lockedUntil ?? 0, now + 1) };
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
