// repo: session — ADR 0002 §4 · `id` = SHA-256(token) hex (ผู้เรียก hash มาแล้ว ไม่มี token ดิบในไฟล์นี้)
// อ่าน session = JOIN เดียวดึง status/is_admin/must_change_pin สดจาก DB ทุกครั้ง
import { and, eq, gt, lte, ne } from 'drizzle-orm';
import { session, user } from '@/db/schema';
import type { DbOrTx } from '@/db/client';
import { DAY_MS } from '@/lib/shared/clock';

export const SESSION_TTL_MS = 60 * DAY_MS;
export const SESSION_RENEW_BELOW_MS = 30 * DAY_MS;
export const SESSION_TOUCH_INTERVAL_MS = DAY_MS;
export const SESSION_UA_MAX = 200;

export type SessionRow = typeof session.$inferSelect;
export type SessionWithUser = {
  session: SessionRow;
  user: {
    id: string;
    username: string;
    displayName: string;
    isAdmin: boolean;
    status: 'active' | 'suspended' | 'deleted';
    mustChangePin: boolean;
    locale: 'th' | 'en';
    theme: 'system' | 'light' | 'dark';
  };
};

export async function insertSession(
  db: DbOrTx,
  input: { id: string; userId: string; userAgent?: string | null },
  now: number,
): Promise<SessionRow> {
  const rows = await db
    .insert(session)
    .values({
      id: input.id,
      userId: input.userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      lastSeenAt: now,
      userAgent: input.userAgent ? input.userAgent.slice(0, SESSION_UA_MAX) : null,
    })
    .returning();
  return rows[0]!;
}

/** session ที่ยังไม่หมดอายุ (expires_at > now) + user สด · ไม่พบ/หมดอายุ → null */
export async function findSessionWithUser(db: DbOrTx, sessionId: string, now: number): Promise<SessionWithUser | null> {
  const rows = await db
    .select({
      session,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        status: user.status,
        mustChangePin: user.mustChangePin,
        locale: user.locale,
        theme: user.theme,
      },
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(and(eq(session.id, sessionId), gt(session.expiresAt, now)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * sliding: เหลือ < 30 วัน → ต่อเป็น now + 60 วัน · last_seen_at อัปเดตไม่เกินวันละครั้ง (ADR 0001 row writes)
 * คืนแถวที่เปลี่ยน หรือ null ถ้าไม่มีอะไรต้องเขียน (ไม่เขียนเลย = ไม่เสีย row write)
 */
export async function touchSession(db: DbOrTx, s: SessionRow, now: number): Promise<SessionRow | null> {
  const renew = s.expiresAt - now < SESSION_RENEW_BELOW_MS;
  const seen = now - s.lastSeenAt >= SESSION_TOUCH_INTERVAL_MS;
  if (!renew && !seen) return null;
  const rows = await db
    .update(session)
    .set({ lastSeenAt: now, ...(renew ? { expiresAt: now + SESSION_TTL_MS } : {}) })
    .where(and(eq(session.id, s.id), gt(session.expiresAt, now)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteSession(db: DbOrTx, sessionId: string): Promise<void> {
  await db.delete(session).where(eq(session.id, sessionId));
}

/** ออกจากระบบทุกเครื่อง / ระงับ / ลบบัญชี · คืนจำนวนที่ลบ */
export async function deleteAllSessionsOfUser(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id });
  return rows.length;
}

/** เปลี่ยน PIN / ตั้ง PIN หลัง reset → ลบ session อื่น เหลือเครื่องปัจจุบัน */
export async function deleteOtherSessionsOfUser(db: DbOrTx, userId: string, keepSessionId: string): Promise<number> {
  const rows = await db
    .delete(session)
    .where(and(eq(session.userId, userId), ne(session.id, keepSessionId)))
    .returning({ id: session.id });
  return rows.length;
}

/** กวาดที่หมดอายุ (cron ทำอยู่แล้ว — มีไว้ให้เทสต์/สคริปต์) */
export async function deleteExpiredSessions(db: DbOrTx, now: number): Promise<number> {
  const rows = await db.delete(session).where(lte(session.expiresAt, now)).returning({ id: session.id });
  return rows.length;
}
