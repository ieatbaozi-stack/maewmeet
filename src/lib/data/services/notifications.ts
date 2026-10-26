// service: แจ้งเตือนในแอปของฉัน — ADR 0007 §3 · action `notification.list.own` / `notification.markRead.own` (เจ้าของเท่านั้น ไม่มีข้อยกเว้นให้ super admin)
//  - ทุกคิวรีผูก user_id ของผู้เรียก → ของคนอื่นไม่ถึงชั้นข้อมูล (id ของคนอื่นใน {ids} ถูกเมินเงียบ ๆ — ไม่ยืนยันว่ามีอยู่)
//  - รายการ: ใหม่สุดก่อน keyset (createdAt, id) · bounded (ค่าเริ่มต้น 20, สูงสุด 50) · มี unreadCount ในคำตอบเดียวกัน (badge)
//  - แจ้งเตือนเกี่ยวกับนัด (appointment.*) ของกลุ่มที่ฉันไม่ได้เป็นสมาชิกแล้ว (ออก/ถูกลบ/กลุ่มถูกลบ) ไม่แสดงและไม่นับ
//  - params = ค่าดิบ (UI แปลด้วยคีย์ notifications.<kind> ตามภาษาผู้ดู · วัน-เวลาจัดรูปด้วย src/lib/calendar)
import { z } from 'zod';
import {
  countUnreadVisibleNotifications,
  listVisibleNotifications,
  markAllNotificationsRead,
  markNotificationsReadByIds,
  type NotificationCursor,
  type NotificationRow,
} from '@/lib/data/repos/notification';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { NOTIFICATION_LIST_DEFAULT, NOTIFICATION_LIST_MAX, NOTIFICATION_READ_IDS_MAX } from '@/lib/shared/limits';
import type { DataCtx } from '../context';
import { inTx } from '../tx';
import { asUser } from './group-common';
import { parseLimit } from './appointments';

/** รูปร่างเท่านั้น — ความหมายของ cursor/limit ตรวจหลังด่านสิทธิ์ */
export const notificationListQuerySchema = z.object({ cursor: z.string().max(256).optional(), limit: z.string().max(8).optional() }).strict();
export type NotificationListQuery = z.output<typeof notificationListQuerySchema>;

export const markNotificationsReadInputSchema = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(NOTIFICATION_READ_IDS_MAX) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type MarkNotificationsReadInput = z.output<typeof markNotificationsReadInputSchema>;

export type NotificationDto = {
  id: string;
  /** NotificationKind (ADR 0007 §1) — UI แปลด้วยคีย์ `notifications.<kind>` */
  kind: string;
  /** ค่าดิบตามชนิด เช่น appointment.created → { groupId, groupName, appointmentId, title, startAt (epoch ms), tz } */
  params: Record<string, unknown>;
  createdAt: number;
  /** null = ยังไม่อ่าน */
  readAt: number | null;
};

export type NotificationListDto = { notifications: NotificationDto[]; nextCursor: string | null; unreadCount: number };

const ownerRes = (actor: Actor) => ({ type: 'ownedByUser', ownerId: actor.kind === 'user' ? actor.id : '' }) as const;

const toDto = (r: NotificationRow): NotificationDto => ({
  id: r.id,
  kind: r.kind,
  params: r.params !== null && typeof r.params === 'object' && !Array.isArray(r.params) ? (r.params as Record<string, unknown>) : {},
  createdAt: r.createdAt,
  readAt: r.readAt,
});

function decodeCursor(raw: string | undefined): NotificationCursor | null {
  if (raw === undefined) return null;
  let v: { c?: unknown; i?: unknown } | null = null;
  try {
    v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { c?: unknown; i?: unknown } | null;
  } catch {
    v = null;
  }
  if (!v || typeof v !== 'object' || !Number.isSafeInteger(v.c) || typeof v.i !== 'string' || !z.uuid().safeParse(v.i).success) {
    throw new AppError('VALIDATION', { fields: { cursor: 'INVALID' } });
  }
  return { createdAt: v.c as number, id: v.i };
}

export async function listMyNotifications(actor: Actor, query: NotificationListQuery, ctx: DataCtx): Promise<NotificationListDto> {
  authorize(actor, 'notification.list.own', ownerRes(actor));
  const me = asUser(actor);
  const limit = parseLimit(query.limit, NOTIFICATION_LIST_DEFAULT, NOTIFICATION_LIST_MAX);
  const cursor = decodeCursor(query.cursor);
  const rows = await listVisibleNotifications(ctx.db, me.id, { limit: limit + 1, cursor });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    notifications: page.map(toDto),
    nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ c: last.createdAt, i: last.id }), 'utf8').toString('base64url') : null,
    unreadCount: await countUnreadVisibleNotifications(ctx.db, me.id),
  };
}

/** {ids} | {all:true} → ทำเครื่องหมายอ่านแล้วเฉพาะของฉัน · คืนจำนวนที่เปลี่ยนจริง + unreadCount ใหม่ */
export async function markMyNotificationsRead(
  actor: Actor,
  input: MarkNotificationsReadInput,
  ctx: DataCtx,
): Promise<{ updated: number; unreadCount: number }> {
  authorize(actor, 'notification.markRead.own', ownerRes(actor));
  const me = asUser(actor);
  const { now } = ctx;
  const updated = await inTx(ctx.db, (tx) =>
    'all' in input ? markAllNotificationsRead(tx, me.id, now) : markNotificationsReadByIds(tx, me.id, [...new Set(input.ids)], now),
  );
  return { updated, unreadCount: await countUnreadVisibleNotifications(ctx.db, me.id) };
}
