// repo: LINE — โค้ดเชื่อมบัญชี + สถานะผูก + outbox (ADR 0007 §2 · ADR 0011 · R10 §1.4, §2)
// ห้ามส่ง line_user_id ออกไปยัง DTO · ห้าม log ค่า
import { and, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { lineLinkCode, notificationOutbox, user } from '@/db/schema';
import type { DbOrTx } from '@/db/client';
import { LINE_SEND_CAPS } from '@/lib/shared/limits';
import type { RsvpResponse } from './appointment';

export const LINE_MONTHLY_LIMIT_ERROR = 'LINE_MONTHLY_LIMIT';
export const LINE_CAP_ERROR = 'LINE_CAP';

// ───────── โค้ดเชื่อม ─────────
/** โค้ดใหม่แทนของเดิมทั้งหมดของผู้ใช้ (ผู้ใช้หนึ่งคนมีได้ทีละโค้ด) */
export async function replaceLineLinkCode(db: DbOrTx, input: { id: string; userId: string; codeHash: string; expiresAt: number }, now: number): Promise<void> {
  await db.delete(lineLinkCode).where(eq(lineLinkCode.userId, input.userId));
  await db.insert(lineLinkCode).values({ id: input.id, userId: input.userId, codeHash: input.codeHash, createdAt: now, expiresAt: input.expiresAt });
}

export async function findPendingLineLinkExpiry(db: DbOrTx, userId: string, now: number): Promise<number | null> {
  const rows = await db
    .select({ expiresAt: lineLinkCode.expiresAt })
    .from(lineLinkCode)
    .where(and(eq(lineLinkCode.userId, userId), isNull(lineLinkCode.usedAt), sql`${lineLinkCode.expiresAt} > ${now}`))
    .limit(1);
  return rows[0]?.expiresAt ?? null;
}

/** ใช้โค้ดแบบอะตอมมิก (UPDATE เดียว: ยังไม่ใช้ + ยังไม่หมดอายุ) · คืนเจ้าของ หรือ null */
export async function consumeLineLinkCode(db: DbOrTx, codeHash: string, now: number): Promise<string | null> {
  const rows = await db
    .update(lineLinkCode)
    .set({ usedAt: now })
    .where(and(eq(lineLinkCode.codeHash, codeHash), isNull(lineLinkCode.usedAt), sql`${lineLinkCode.expiresAt} > ${now}`))
    .returning({ userId: lineLinkCode.userId });
  return rows[0]?.userId ?? null;
}

/** ผูกเมื่อบัญชี active ยังไม่ผูก และ LINE นี้ยังไม่ถูกผูกกับใคร — คำสั่งเดียว · false = ชนกัน */
export async function bindLineUser(db: DbOrTx, userId: string, lineUserId: string, now: number): Promise<boolean> {
  const rows = await db
    .update(user)
    .set({ lineUserId, updatedAt: now })
    .where(
      and(
        eq(user.id, userId),
        eq(user.status, 'active'),
        isNull(user.lineUserId),
        sql`NOT EXISTS (SELECT 1 FROM user other WHERE other.line_user_id = ${lineUserId})`,
      ),
    )
    .returning({ id: user.id });
  return rows.length === 1;
}

export async function findLocaleOfUser(db: DbOrTx, userId: string): Promise<'th' | 'en' | null> {
  const rows = await db.select({ locale: user.locale }).from(user).where(eq(user.id, userId)).limit(1);
  return rows[0]?.locale ?? null;
}

export async function findLocaleByLineUser(db: DbOrTx, lineUserId: string): Promise<'th' | 'en' | null> {
  const rows = await db.select({ locale: user.locale }).from(user).where(eq(user.lineUserId, lineUserId)).limit(1);
  return rows[0]?.locale ?? null;
}

/** ยกเลิกการผูกของผู้ใช้ + ล้างโค้ด + ล้างคิว pending */
export async function unlinkLineOfUser(db: DbOrTx, userId: string, now: number): Promise<void> {
  await db.update(user).set({ lineUserId: null, updatedAt: now }).where(and(eq(user.id, userId), isNotNull(user.lineUserId)));
  await db.delete(lineLinkCode).where(eq(lineLinkCode.userId, userId));
  await deletePendingOutboxOfUser(db, userId);
}

/** unfollow: หาเจ้าของจาก LINE id แล้วยกเลิกการผูก + ล้างคิว pending · ไม่มีเจ้าของ = ไม่ทำอะไร */
export async function unlinkByLineUser(db: DbOrTx, lineUserId: string, now: number): Promise<boolean> {
  const rows = await db.update(user).set({ lineUserId: null, updatedAt: now }).where(eq(user.lineUserId, lineUserId)).returning({ id: user.id });
  const owner = rows[0]?.id;
  if (!owner) return false;
  await deletePendingOutboxOfUser(db, owner);
  return true;
}

export async function deletePendingOutboxOfUser(db: DbOrTx, userId: string): Promise<void> {
  await db.delete(notificationOutbox).where(and(eq(notificationOutbox.userId, userId), eq(notificationOutbox.status, 'pending')));
}

// ───────── outbox ─────────
export type OutboxInsert = { id: string; notificationId: string; userId: string; payload: { kind: string; params: Record<string, unknown> } };

export async function insertLineOutboxRows(db: DbOrTx, rows: readonly OutboxInsert[], now: number): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(notificationOutbox).values(
    rows.map((r) => ({ id: r.id, notificationId: r.notificationId, userId: r.userId, channel: 'line' as const, payload: r.payload, status: 'pending' as const, attempts: 0, nextAttemptAt: now, createdAt: now })),
  );
}

/** ผู้ใช้ (ใน userIds) ที่ active และเชื่อม LINE แล้ว */
export async function usersWithLine(db: DbOrTx, userIds: readonly string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.id, [...userIds]), eq(user.status, 'active'), isNotNull(user.lineUserId)));
  return new Set(rows.map((r) => r.id));
}

export type OutboxRow = typeof notificationOutbox.$inferSelect;

/** scope = เฉพาะแถวของชนิด + นัดนี้ (ส่งทันทีหลังยกเลิกนัด R11 §2) · ไม่ระบุ = ทุกแถวที่ถึงกำหนด (cron) */
export type OutboxScope = { kind: string; appointmentId: string };

export async function listDueLineOutbox(db: DbOrTx, now: number, limit: number, scope?: OutboxScope): Promise<OutboxRow[]> {
  const scoped = scope
    ? [sql`json_extract(${notificationOutbox.payload}, '$.kind') = ${scope.kind}`, sql`json_extract(${notificationOutbox.payload}, '$.params.appointmentId') = ${scope.appointmentId}`]
    : [];
  return db
    .select()
    .from(notificationOutbox)
    .where(and(eq(notificationOutbox.status, 'pending'), eq(notificationOutbox.channel, 'line'), lte(notificationOutbox.nextAttemptAt, now), ...scoped))
    .orderBy(notificationOutbox.nextAttemptAt, notificationOutbox.id)
    .limit(limit);
}

/**
 * จองรอบส่ง: เพิ่ม attempts + ตั้งเวลาลองใหม่ไว้ล่วงหน้า — คำสั่งเดียว รันพร้อมกันได้ผู้ชนะคนเดียว · ล้มกลางทาง = ลองรอบถัดไป (retry key เดิม LINE ไม่ส่งซ้ำ)
 * เพดาน LINE_SEND_CAPS อยู่ในคำสั่งเดียวกัน (กัน race ข้าม instance): นับแถวอื่นที่ส่งแล้วใน 24 ชม. + แถวที่จองแล้วแต่ยังไม่จบ (attempts > 0) · แถวตัวเองไม่นับ
 * คืน false = แพ้การจอง หรือเกินเพดาน (แยกด้วย capOutboxRow)
 */
export async function claimOutboxRow(
  db: DbOrTx,
  row: Pick<OutboxRow, 'id' | 'attempts' | 'userId'>,
  target: { kind: string; appointmentId: string },
  nextAttemptAt: number,
  now: number,
): Promise<boolean> {
  const counted = sql`((o.status = 'sent' AND o.sent_at > ${now - LINE_SEND_CAPS.windowMs}) OR (o.status = 'pending' AND o.attempts > 0))`;
  const rows = await db
    .update(notificationOutbox)
    .set({ attempts: row.attempts + 1, nextAttemptAt })
    .where(
      and(
        eq(notificationOutbox.id, row.id),
        eq(notificationOutbox.status, 'pending'),
        eq(notificationOutbox.attempts, row.attempts),
        lte(notificationOutbox.nextAttemptAt, now),
        sql`(SELECT count(*) FROM notification_outbox o WHERE o.user_id = ${row.userId} AND o.id <> ${row.id} AND ${counted}) < ${LINE_SEND_CAPS.perUser}`,
        sql`(SELECT count(*) FROM notification_outbox o WHERE o.user_id = ${row.userId} AND o.id <> ${row.id} AND ${counted}
              AND json_extract(o.payload, '$.kind') = ${target.kind} AND json_extract(o.payload, '$.params.appointmentId') = ${target.appointmentId}) < ${LINE_SEND_CAPS.perAppointmentKindUser}`,
      ),
    )
    .returning({ id: notificationOutbox.id });
  return rows.length === 1;
}

/** จองไม่ได้และแถวยังไม่ถูกใครแตะ = เกินเพดาน → dead · false = แพ้การจองให้รอบอื่น */
export async function capOutboxRow(db: DbOrTx, row: Pick<OutboxRow, 'id' | 'attempts'>, now: number): Promise<boolean> {
  const rows = await db
    .update(notificationOutbox)
    .set({ status: 'dead', lastError: LINE_CAP_ERROR })
    .where(and(eq(notificationOutbox.id, row.id), eq(notificationOutbox.status, 'pending'), eq(notificationOutbox.attempts, row.attempts), lte(notificationOutbox.nextAttemptAt, now)))
    .returning({ id: notificationOutbox.id });
  return rows.length === 1;
}

/** lastError = รหัสล้วน ไม่มีเนื้อหา (ADR 0011 §5) */
export async function finishOutboxRow(db: DbOrTx, id: string, status: 'sent' | 'dead', lastError: string | null, now: number): Promise<void> {
  await db
    .update(notificationOutbox)
    .set({ status, lastError, sentAt: status === 'sent' ? now : null })
    .where(eq(notificationOutbox.id, id));
}

/** ชน 429 monthly limit: ตั้ง next_attempt_at = เวลาที่ชนจริง (ค่าจากตอนจองอาจล้ำไปเดือนถัดไป) ให้ lineMonthlyLimitHit นับถูกเดือน */
export async function markOutboxMonthlyLimit(db: DbOrTx, id: string, now: number): Promise<void> {
  await db.update(notificationOutbox).set({ status: 'dead', lastError: LINE_MONTHLY_LIMIT_ERROR, nextAttemptAt: now }).where(eq(notificationOutbox.id, id));
}

export async function markOutboxRetry(db: DbOrTx, id: string, lastError: string): Promise<void> {
  await db.update(notificationOutbox).set({ lastError }).where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, 'pending')));
}

/** โควตาเดือนหมด: ทุกแถว LINE ที่ค้าง → dead · คืนจำนวน */
export async function deadAllPendingLine(db: DbOrTx, now: number): Promise<number> {
  const rows = await db
    .update(notificationOutbox)
    .set({ status: 'dead', lastError: LINE_MONTHLY_LIMIT_ERROR, nextAttemptAt: now })
    .where(and(eq(notificationOutbox.status, 'pending'), eq(notificationOutbox.channel, 'line')))
    .returning({ id: notificationOutbox.id });
  return rows.length;
}

/** เดือนนี้เคยชนโควตาแล้วหรือยัง — next_attempt_at ของแถวรหัสนี้ = เวลาที่ชนจริง (markOutboxMonthlyLimit / deadAllPendingLine) */
export async function lineMonthlyLimitHit(db: DbOrTx, monthStart: number): Promise<boolean> {
  const rows = await db
    .select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(and(eq(notificationOutbox.status, 'dead'), eq(notificationOutbox.lastError, LINE_MONTHLY_LIMIT_ERROR), sql`${notificationOutbox.nextAttemptAt} >= ${monthStart}`))
    .limit(1);
  return rows.length === 1;
}

export type OutboxSendContext = {
  apptStatus: string | null;
  apptStartAt: number | null;
  groupDeleted: boolean;
  userStatus: string;
  lineUserId: string | null;
  locale: 'th' | 'en';
  response: RsvpResponse | null;
};

/** ข้อมูลตรวจซ้ำก่อนส่ง — คำตอบนับเฉพาะสมาชิกปัจจุบัน + updated_at >= joined_at (ADR 0009 §1) */
export async function loadOutboxSendContext(db: DbOrTx, input: { userId: string; appointmentId: string }): Promise<OutboxSendContext | null> {
  const rows = await db.all<{
    status: string | null;
    start_at: number | null;
    deleted_at: number | null;
    group_id: string | null;
    user_status: string;
    line_user_id: string | null;
    locale: 'th' | 'en';
    response: RsvpResponse | null;
  }>(sql`
    SELECT a.status AS status, a.start_at AS start_at, g.id AS group_id, g.deleted_at AS deleted_at,
           u.status AS user_status, u.line_user_id AS line_user_id, u.locale AS locale, r.response AS response
    FROM user u
    LEFT JOIN appointment a ON a.id = ${input.appointmentId}
    LEFT JOIN groups g ON g.id = a.group_id
    LEFT JOIN group_member gm ON gm.group_id = a.group_id AND gm.user_id = u.id
    LEFT JOIN appointment_rsvp r ON r.appointment_id = a.id AND r.user_id = gm.user_id AND r.updated_at >= gm.joined_at
    WHERE u.id = ${input.userId}`);
  const r = rows[0];
  if (!r) return null;
  return {
    apptStatus: r.status,
    apptStartAt: r.start_at === null ? null : Number(r.start_at),
    groupDeleted: r.group_id === null || r.deleted_at !== null,
    userStatus: r.user_status,
    lineUserId: r.line_user_id,
    locale: r.locale,
    response: r.response,
  };
}
