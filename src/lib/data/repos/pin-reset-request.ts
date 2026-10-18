// repo: pin_reset_request — ADR 0002 §5 · lazy expiry: ทุกจุดที่อ่านจะ expire แถวที่เลยเวลาก่อน (ไม่พึ่ง cron)
//   approved && now >= expires_at → expired · pending && now >= pending_expires_at → expired
// การเปลี่ยนสถานะทุกตัวเป็น UPDATE … WHERE status = <เดิม> (+ เงื่อนไขเวลา) RETURNING เดียว → ใช้ซ้ำสองครั้งสำเร็จได้แค่ครั้งเดียว
// partial unique index pin_reset_one_open_uq (user_id WHERE status IN ('pending','approved')) กันซ้ำที่ชั้น DB
import { and, desc, eq, inArray, lte, or, gt } from 'drizzle-orm';
import { pinResetRequest, user } from '@/db/schema';
import type { DbOrTx } from '@/db/client';
import { DAY_MS } from '@/lib/shared/clock';
import { isUniqueViolation } from './user';

export const PIN_RESET_PENDING_TTL_MS = 7 * DAY_MS;
export const PIN_RESET_APPROVED_TTL_MS = DAY_MS;
export const REQUESTER_UA_MAX = 120;

export type PinResetRow = typeof pinResetRequest.$inferSelect;
export type PinResetStatus = PinResetRow['status'];

/** expire แถวของ user นี้ที่เลยเวลา (หรือทุกแถวถ้าไม่ระบุ) · คืนจำนวนที่เปลี่ยน */
export async function expireDuePinResets(db: DbOrTx, now: number, scope: { userId?: string; id?: string } = {}): Promise<number> {
  const scoped = [
    ...(scope.userId ? [eq(pinResetRequest.userId, scope.userId)] : []),
    ...(scope.id ? [eq(pinResetRequest.id, scope.id)] : []),
  ];
  const due = or(
    and(eq(pinResetRequest.status, 'pending'), lte(pinResetRequest.pendingExpiresAt, now)),
    and(eq(pinResetRequest.status, 'approved'), lte(pinResetRequest.expiresAt, now)),
  );
  const rows = await db
    .update(pinResetRequest)
    .set({ status: 'expired' })
    .where(and(due, ...scoped))
    .returning({ id: pinResetRequest.id });
  return rows.length;
}

/** สร้างคำขอ pending · ชน partial unique (มีคำขอเปิดอยู่แล้ว) → null (ผู้เรียกตอบ 202 เหมือนเดิม) */
export async function createPendingPinReset(
  db: DbOrTx,
  input: { id: string; userId: string; deviceTokenHash: string; requesterUa?: string | null; requesterCountry?: string | null },
  now: number,
): Promise<PinResetRow | null> {
  await expireDuePinResets(db, now, { userId: input.userId }); // คำขอเก่าที่เลยเวลาต้องไม่บังคำขอใหม่
  try {
    const rows = await db
      .insert(pinResetRequest)
      .values({
        id: input.id,
        userId: input.userId,
        status: 'pending',
        deviceTokenHash: input.deviceTokenHash,
        requesterUa: input.requesterUa ? input.requesterUa.slice(0, REQUESTER_UA_MAX) : null,
        requesterCountry: input.requesterCountry ? input.requesterCountry.slice(0, 8) : null,
        requestedAt: now,
        pendingExpiresAt: now + PIN_RESET_PENDING_TTL_MS,
      })
      .returning();
    return rows[0] ?? null;
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

/** คำขอที่เปิดอยู่ (pending/approved ที่ยังไม่หมดอายุ) ของ user — หลัง lazy expiry */
export async function findOpenPinResetByUser(db: DbOrTx, userId: string, now: number): Promise<PinResetRow | null> {
  await expireDuePinResets(db, now, { userId });
  const rows = await db
    .select()
    .from(pinResetRequest)
    .where(and(eq(pinResetRequest.userId, userId), inArray(pinResetRequest.status, ['pending', 'approved'])))
    .limit(1);
  return rows[0] ?? null;
}

/** คำขอ approved ที่ยังใช้ได้ (now < expires_at) ของ user — ใช้ตอน login ด้วย 123456 */
export async function findUsableApprovedPinReset(db: DbOrTx, userId: string, now: number): Promise<PinResetRow | null> {
  await expireDuePinResets(db, now, { userId });
  const rows = await db
    .select()
    .from(pinResetRequest)
    .where(and(eq(pinResetRequest.userId, userId), eq(pinResetRequest.status, 'approved'), gt(pinResetRequest.expiresAt, now)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findPinResetById(db: DbOrTx, id: string, now: number): Promise<PinResetRow | null> {
  await expireDuePinResets(db, now, { id });
  const rows = await db.select().from(pinResetRequest).where(eq(pinResetRequest.id, id)).limit(1);
  return rows[0] ?? null;
}

/** คำขอล่าสุดที่ผูกกับเครื่องนี้ (cookie mm_reset → hash) สำหรับ GET /api/auth/pin-reset/status */
export async function findLatestPinResetByDevice(db: DbOrTx, deviceTokenHash: string, now: number): Promise<PinResetRow | null> {
  const rows = await db
    .select({ id: pinResetRequest.id })
    .from(pinResetRequest)
    .where(eq(pinResetRequest.deviceTokenHash, deviceTokenHash))
    .orderBy(desc(pinResetRequest.requestedAt))
    .limit(1);
  const id = rows[0]?.id;
  return id ? findPinResetById(db, id, now) : null;
}

export type PendingPinResetListItem = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  requestedAt: number;
  pendingExpiresAt: number;
  requesterUa: string | null;
  requesterCountry: string | null;
};

/** รายการ pending ที่ยังไม่หมดอายุ สำหรับหน้า admin (เก่าสุดก่อน) */
export async function listPendingPinResets(db: DbOrTx, now: number): Promise<PendingPinResetListItem[]> {
  await expireDuePinResets(db, now);
  return db
    .select({
      id: pinResetRequest.id,
      userId: pinResetRequest.userId,
      username: user.username,
      displayName: user.displayName,
      requestedAt: pinResetRequest.requestedAt,
      pendingExpiresAt: pinResetRequest.pendingExpiresAt,
      requesterUa: pinResetRequest.requesterUa,
      requesterCountry: pinResetRequest.requesterCountry,
    })
    .from(pinResetRequest)
    .innerJoin(user, eq(user.id, pinResetRequest.userId))
    .where(eq(pinResetRequest.status, 'pending'))
    .orderBy(pinResetRequest.requestedAt);
}

/** pending → approved (ต้องยังไม่เลย pending_expires_at) · expires_at = now + 24 ชม. · ไม่ใช่ pending → null */
export async function approvePinReset(db: DbOrTx, id: string, decidedBy: string, now: number): Promise<PinResetRow | null> {
  const rows = await db
    .update(pinResetRequest)
    .set({ status: 'approved', decidedBy, decidedAt: now, expiresAt: now + PIN_RESET_APPROVED_TTL_MS })
    .where(and(eq(pinResetRequest.id, id), eq(pinResetRequest.status, 'pending'), gt(pinResetRequest.pendingExpiresAt, now)))
    .returning();
  return rows[0] ?? null;
}

/** pending → rejected */
export async function rejectPinReset(db: DbOrTx, id: string, decidedBy: string, now: number): Promise<PinResetRow | null> {
  const rows = await db
    .update(pinResetRequest)
    .set({ status: 'rejected', decidedBy, decidedAt: now })
    .where(and(eq(pinResetRequest.id, id), eq(pinResetRequest.status, 'pending'), gt(pinResetRequest.pendingExpiresAt, now)))
    .returning();
  return rows[0] ?? null;
}

/** approved → used (ต้อง now < expires_at) · ใช้ซ้ำ/หมดอายุ → null */
export async function markPinResetUsed(db: DbOrTx, id: string, now: number): Promise<PinResetRow | null> {
  const rows = await db
    .update(pinResetRequest)
    .set({ status: 'used', usedAt: now })
    .where(and(eq(pinResetRequest.id, id), eq(pinResetRequest.status, 'approved'), gt(pinResetRequest.expiresAt, now)))
    .returning();
  return rows[0] ?? null;
}

/** pending → cancelled (login/เปลี่ยน PIN ด้วย PIN เดิมสำเร็จ — U2 AC) · คืนแถวที่ถูกยกเลิก หรือ null ถ้าไม่มี pending */
export async function cancelPendingPinResetOfUser(db: DbOrTx, userId: string, now: number): Promise<PinResetRow | null> {
  await expireDuePinResets(db, now, { userId });
  const rows = await db
    .update(pinResetRequest)
    .set({ status: 'cancelled' })
    .where(and(eq(pinResetRequest.userId, userId), eq(pinResetRequest.status, 'pending')))
    .returning();
  return rows[0] ?? null;
}
