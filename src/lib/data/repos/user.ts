// repo: user — ADR 0002 §2–§5, §7 · query ล้วน ไม่รู้จัก actor · เวลา = now (epoch ms) ที่ผู้เรียก inject
import { and, count, eq, isNotNull } from 'drizzle-orm';
import { user } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export type UserRow = typeof user.$inferSelect;

export type NewUser = {
  id: string;
  username: string;
  usernameNormalized: string;
  displayName: string;
  pinHash: string;
  pinPepperVersion: number;
  locale?: UserRow['locale'];
  theme?: UserRow['theme'];
};

/** ข้อความ error ของ SQLite เมื่อชน unique index (libSQL: SQLITE_CONSTRAINT_UNIQUE) */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const o = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof o.code === 'string' && o.code.startsWith('SQLITE_CONSTRAINT')) return true;
    if (typeof o.message === 'string' && /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(o.message)) return true;
    cur = o.cause;
  }
  return false;
}

export async function findUserById(db: DbOrTx, id: string): Promise<UserRow | null> {
  const rows = await db.select().from(user).where(eq(user.id, id)).limit(1);
  return rows[0] ?? null;
}

/** ค้นด้วย username_normalized (ผู้เรียกทำ NFKC + lowercase มาแล้ว — D2) */
export async function findUserByUsernameNormalized(db: DbOrTx, usernameNormalized: string): Promise<UserRow | null> {
  const rows = await db.select().from(user).where(eq(user.usernameNormalized, usernameNormalized)).limit(1);
  return rows[0] ?? null;
}

/** สร้างบัญชี · ชน unique (username_normalized) → คืน `null` (ผู้เรียกแปลงเป็น USERNAME_TAKEN) */
export async function insertUser(db: DbOrTx, input: NewUser, now: number): Promise<UserRow | null> {
  try {
    const rows = await db
      .insert(user)
      .values({
        id: input.id,
        username: input.username,
        usernameNormalized: input.usernameNormalized,
        displayName: input.displayName,
        pinHash: input.pinHash,
        pinPepperVersion: input.pinPepperVersion,
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.theme ? { theme: input.theme } : {}),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rows[0] ?? null;
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

/** ตั้ง hash ใหม่ (สมัคร/เปลี่ยน PIN/ตั้งหลัง reset/rehash เวอร์ชัน pepper) · `mustChangePin` ไม่ระบุ = ไม่แตะ */
export async function setUserPin(
  db: DbOrTx,
  userId: string,
  pin: { pinHash: string; pinPepperVersion: number; mustChangePin?: boolean },
  now: number,
): Promise<void> {
  await db
    .update(user)
    .set({
      pinHash: pin.pinHash,
      pinPepperVersion: pin.pinPepperVersion,
      ...(pin.mustChangePin === undefined ? {} : { mustChangePin: pin.mustChangePin }),
      updatedAt: now,
    })
    .where(eq(user.id, userId));
}

/** rehash ตอน login สำเร็จด้วย pepper เวอร์ชันเก่า (§7.3) — เขียนก็ต่อเมื่อ hash เดิมยังเป็นค่าที่ verify มา (กันแข่งกับการเปลี่ยน PIN) */
export async function rehashUserPin(
  db: DbOrTx,
  userId: string,
  expectedOldHash: string,
  next: { pinHash: string; pinPepperVersion: number },
  now: number,
): Promise<boolean> {
  const rows = await db
    .update(user)
    .set({ pinHash: next.pinHash, pinPepperVersion: next.pinPepperVersion, updatedAt: now })
    .where(and(eq(user.id, userId), eq(user.pinHash, expectedOldHash)))
    .returning({ id: user.id });
  return rows.length === 1;
}

/** approve reset: PIN เดิมใช้ไม่ได้อีก (ADR 0002 §5) */
export async function clearUserPinHash(db: DbOrTx, userId: string, now: number): Promise<void> {
  await db.update(user).set({ pinHash: null, updatedAt: now }).where(eq(user.id, userId));
}

export async function setMustChangePin(db: DbOrTx, userId: string, value: boolean, now: number): Promise<void> {
  await db.update(user).set({ mustChangePin: value, updatedAt: now }).where(eq(user.id, userId));
}

/** จำนวนผู้ใช้ที่มี pin_hash แยกตามเวอร์ชัน pepper (health + หน้า admin + fingerprint check §7.2/§7.3) */
export async function countUsersWithPinByPepperVersion(db: DbOrTx): Promise<Record<number, number>> {
  const rows = await db
    .select({ version: user.pinPepperVersion, n: count() })
    .from(user)
    .where(isNotNull(user.pinHash))
    .groupBy(user.pinPepperVersion);
  const out: Record<number, number> = {};
  for (const r of rows) out[r.version] = Number(r.n);
  return out;
}

/** รายชื่อ super admin (ยืนยันขั้นตอน SQL ของ boss ใน OPERATIONS) — ไม่มี endpoint ใดตั้ง is_admin */
export async function listSuperAdminUsernames(db: DbOrTx): Promise<string[]> {
  const rows = await db.select({ username: user.username }).from(user).where(eq(user.isAdmin, true));
  return rows.map((r) => r.username);
}

