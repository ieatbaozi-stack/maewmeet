// repo: notification — ADR 0007 · params = ค่าดิบ (ไม่ใช่ข้อความแปลแล้ว) · ทุก query ผูก user_id (เจ้าของ)
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { notification } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export type NotificationRow = typeof notification.$inferSelect;

export async function insertNotification(
  db: DbOrTx,
  input: { id: string; userId: string; kind: string; params?: Record<string, unknown> },
  now: number,
): Promise<void> {
  await db.insert(notification).values({
    id: input.id,
    userId: input.userId,
    kind: input.kind,
    params: input.params ?? {},
    createdAt: now,
  });
}

export async function listNotificationsOfUser(db: DbOrTx, userId: string, limit = 50): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notification)
    .where(eq(notification.userId, userId))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function countUnreadNotifications(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
  return Number(rows[0]?.n ?? 0);
}

/** mark อ่านแล้ว — เฉพาะของเจ้าของ · คืน true ถ้ามีแถวเปลี่ยน */
export async function markNotificationRead(db: DbOrTx, userId: string, id: string, now: number): Promise<boolean> {
  const rows = await db
    .update(notification)
    .set({ readAt: now })
    .where(and(eq(notification.id, id), eq(notification.userId, userId), isNull(notification.readAt)))
    .returning({ id: notification.id });
  return rows.length === 1;
}

export async function markAllNotificationsRead(db: DbOrTx, userId: string, now: number): Promise<number> {
  const rows = await db
    .update(notification)
    .set({ readAt: now })
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    .returning({ id: notification.id });
  return rows.length;
}

/** แถวใหม่หลายแถวในคำสั่งเดียว (ผู้เรียกคือ notify() — ดู src/lib/data/notifications/notify.ts) */
export async function insertNotificationRows(
  db: DbOrTx,
  rows: readonly { id: string; userId: string; kind: string; params: Record<string, unknown> }[],
  now: number,
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(notification).values(rows.map((r) => ({ id: r.id, userId: r.userId, kind: r.kind, params: r.params, createdAt: now })));
}

/**
 * R11 §1: ลบรายการที่ยังไม่อ่านของนัดเดียวกัน + ผู้รับเดียวกัน (rsvp_changed: + ผู้ตอบคนเดิม) ก่อนเขียนรายการใหม่แทน
 * อ่านแล้วไม่ถูกแตะ — เหตุการณ์ถัดไปเป็นแถวใหม่ · เรียกใน transaction เดียวกับ notify · คืนแถวที่ลบ (ผู้เรียกรวมค่าของเดิม)
 */
export async function deleteUnreadEventRows(
  db: DbOrTx,
  input: { userIds: readonly string[]; kind: string; appointmentId: string; responderId?: string },
): Promise<{ userId: string; params: unknown }[]> {
  if (input.userIds.length === 0) return [];
  const conds: SQL[] = [
    inArray(notification.userId, [...input.userIds]),
    eq(notification.kind, input.kind),
    isNull(notification.readAt),
    sql`json_extract(${notification.params}, '$.appointmentId') = ${input.appointmentId}`,
  ];
  if (input.responderId !== undefined) conds.push(sql`json_extract(${notification.params}, '$.responderId') = ${input.responderId}`);
  return db.delete(notification).where(and(...conds)).returning({ userId: notification.userId, params: notification.params });
}

/**
 * แจ้งเตือนที่ผู้ใช้ "ควรเห็น": ชนิดที่เกี่ยวกับนัด (appointment.*) และกิจกรรมสมาชิก (group.member.joined/left/role_changed — R11) เห็นได้เฉพาะเมื่อยังเป็นสมาชิกของกลุ่มนั้นและกลุ่มยังไม่ถูกลบ
 * (ถูกลบออก/ออกเอง → ไม่เห็นความเคลื่อนไหวของกลุ่มเดิมอีก · เกิดก่อน joined_at ปัจจุบัน = ของสมาชิกภาพรอบก่อน ซ่อนแม้กลับเข้ากลุ่มแล้ว)
 * ชนิดอื่นเห็นเสมอ รวม group.member.removed ที่มีไว้บอกคนที่ถูกนำออกโดยเฉพาะ · ใช้ร่วมกันระหว่างรายการและจำนวนที่ยังไม่อ่าน
 */
const visibleToOwner: SQL = sql`((${notification.kind} NOT LIKE 'appointment.%' AND ${notification.kind} NOT IN ('group.member.joined', 'group.member.left', 'group.member.role_changed')) OR EXISTS (
  SELECT 1 FROM group_member gm INNER JOIN groups g ON g.id = gm.group_id
  WHERE gm.user_id = ${notification.userId} AND g.deleted_at IS NULL AND gm.group_id = json_extract(${notification.params}, '$.groupId')
    AND ${notification.createdAt} >= gm.joined_at))`;

export type NotificationCursor = { createdAt: number; id: string };

/** ชนิดที่มีเพดาน unread ต่อกลุ่มต่อผู้รับ นับแยกชนิด (SEC M1 · R11 §1, security R11 M1/L1) — group.member.removed ไม่มีเพดาน */
export type UnreadCappedKind = 'appointment.created' | 'appointment.cancelled' | 'group.member.joined' | 'group.member.left' | 'group.member.role_changed';

/** ใหม่สุดก่อน keyset (created_at, id) · ขอ limit+1 เพื่อรู้ว่ามีหน้าถัดไป */
export async function listVisibleNotifications(
  db: DbOrTx,
  userId: string,
  q: { limit: number; cursor: NotificationCursor | null },
): Promise<NotificationRow[]> {
  const conds: SQL[] = [eq(notification.userId, userId), visibleToOwner];
  if (q.cursor) conds.push(sql`(${notification.createdAt}, ${notification.id}) < (${q.cursor.createdAt}, ${q.cursor.id})`);
  return db
    .select()
    .from(notification)
    .where(and(...conds))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(q.limit);
}

export async function countUnreadVisibleNotifications(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt), visibleToOwner));
  return Number(rows[0]?.n ?? 0);
}

/** mark อ่านแล้วตาม id — เฉพาะของเจ้าของ (id ของคนอื่นถูกเมินเงียบ ๆ) · คืนจำนวนแถวที่เปลี่ยน */
export async function markNotificationsReadByIds(db: DbOrTx, userId: string, ids: readonly string[], now: number): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(notification)
    .set({ readAt: now })
    .where(and(eq(notification.userId, userId), inArray(notification.id, [...ids]), isNull(notification.readAt)))
    .returning({ id: notification.id });
  return rows.length;
}

/**
 * ผู้ใช้ (ใน userIds) ที่ยังรับชนิดนี้ของกลุ่มนี้เพิ่มได้ = unread ที่ "เห็นได้" ของชนิดนั้นในกลุ่มนั้น < max (ใช้ coalesce กันกระดิ่งท่วม · นับแยกชนิด)
 * นับด้วยคำสั่งเดียว แล้วผู้เรียกเขียนทีเดียว — แข่งกันได้เกินเพดานไม่เกินจำนวนนัดที่สร้างพร้อมกัน ซึ่งถูก limiter ต่อผู้ใช้/ต่อกลุ่มจำกัดอยู่แล้ว
 */
export async function usersUnderUnreadCap(db: DbOrTx, userIds: readonly string[], kind: UnreadCappedKind, groupId: string, max: number): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: notification.userId, n: count() })
    .from(notification)
    .where(
      and(
        inArray(notification.userId, [...userIds]),
        eq(notification.kind, kind),
        isNull(notification.readAt),
        sql`json_extract(${notification.params}, '$.groupId') = ${groupId}`,
        visibleToOwner,
      ),
    )
    .groupBy(notification.userId);
  const full = new Set(rows.filter((r) => Number(r.n) >= max).map((r) => r.userId));
  return new Set(userIds.filter((u) => !full.has(u)));
}
