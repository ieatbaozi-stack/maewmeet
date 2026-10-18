// repo: notification — ADR 0007 · params = ค่าดิบ (ไม่ใช่ข้อความแปลแล้ว) · ทุก query ผูก user_id (เจ้าของ)
import { and, count, desc, eq, isNull } from 'drizzle-orm';
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
