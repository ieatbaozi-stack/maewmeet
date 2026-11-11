// repo: บัญชีของฉัน (R5 — U13) · เปลี่ยนชื่อที่แสดง + ลบบัญชี
// การลบ = "คำสั่งแรกของธุรกรรมคือ UPDATE ที่มีเงื่อนไขในตัว" (สถานะ active + ไม่ใช่ super admin + ไม่ถือ role admin ของกลุ่มที่ยังอยู่)
//   → ล็อกเขียนถูกยึดตั้งแต่คำสั่งนั้น ไม่มีช่วง check-then-act กับการโอน admin มาให้ระหว่างลบ (R5_CONTRACT §6)
//   จากนั้นลบ/ปิดร่องรอยทั้งหมดในธุรกรรมเดียวกัน (ผู้เรียกส่ง tx) — ล้มตรงไหน rollback ทั้งก้อน
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  appointmentRsvp,
  busyBlock,
  busyRoutine,
  groupInvite,
  groupMember,
  lineLinkCode,
  loginThrottle,
  notification,
  notificationOutbox,
  pinResetRequest,
  session,
  user,
} from '@/db/schema';
import type { DbOrTx } from '@/db/client';
import type { UserRow } from './user';

/** username/username_normalized ของบัญชีที่ลบแล้ว — ไม่ผ่านรูปแบบสมัคร (มี '-' และยาว 44) จึงชนกับผู้ใช้จริงไม่ได้ */
export const DELETED_USERNAME_PREFIX = 'deleted-';

/** เงื่อนไข "ผู้ใช้นี้ถือ role admin ของกลุ่มที่ยังไม่ถูกลบ" (ใช้ใน WHERE ของคำสั่งลบ — ด่านอะตอมมิก) */
const holdsLiveGroupAdmin = (userId: string) =>
  sql`EXISTS (SELECT 1 FROM group_member gm INNER JOIN groups g ON g.id = gm.group_id
              WHERE gm.user_id = ${userId} AND gm.role = 'admin' AND g.deleted_at IS NULL)`;

/** กลุ่ม (ที่ยังไม่ลบ) ที่ผู้ใช้ถือ role admin — ส่งให้ UI ใน 409 ADMIN_TRANSFER_REQUIRED */
export async function listLiveGroupsAdminedBy(db: DbOrTx, userId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db.all<{ id: string; name: string }>(sql`
    SELECT g.id AS id, g.name AS name FROM group_member gm INNER JOIN groups g ON g.id = gm.group_id
     WHERE gm.user_id = ${userId} AND gm.role = 'admin' AND g.deleted_at IS NULL
     ORDER BY lower(g.name), g.id`);
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** เปลี่ยนชื่อที่แสดง (เฉพาะบัญชี active) · คืนแถวใหม่ หรือ null */
export async function updateDisplayName(db: DbOrTx, userId: string, displayName: string, now: number): Promise<UserRow | null> {
  const rows = await db
    .update(user)
    .set({ displayName, updatedAt: now })
    .where(and(eq(user.id, userId), eq(user.status, 'active')))
    .returning();
  return rows[0] ?? null;
}

/**
 * ขั้นแรกของการลบบัญชี (ต้องเป็นคำสั่งแรกในธุรกรรม): active → deleted พร้อมล้างตัวระบุทั้งหมด
 * เงื่อนไขในคำสั่งเดียว: status = 'active' · is_admin = 0 · ไม่ถือ role admin ของกลุ่มที่ยังอยู่
 * คืน false = เงื่อนไขไม่ตรง (ผู้เรียกวินิจฉัยต่อ — การอ่านหลังจากนี้ไม่มีผลต่อความถูกต้อง)
 */
export async function markUserDeletedGuarded(db: DbOrTx, userId: string, now: number): Promise<boolean> {
  const rows = await db
    .update(user)
    .set({
      status: 'deleted',
      deletedAt: now,
      updatedAt: now,
      pinHash: null,
      mustChangePin: false,
      displayName: '',
      username: sql`${DELETED_USERNAME_PREFIX} || ${user.id}`,
      usernameNormalized: sql`${DELETED_USERNAME_PREFIX} || ${user.id}`,
      lineUserId: null,
    })
    .where(and(eq(user.id, userId), eq(user.status, 'active'), eq(user.isAdmin, false), sql`NOT ${holdsLiveGroupAdmin(userId)}`))
    .returning({ id: user.id });
  return rows.length === 1;
}

export type PurgeCounts = {
  sessions: number;
  memberships: number;
  busy: number;
  /** R14: กฎ busy_routine (แถวของ routine นับใน busy แล้ว) */
  routines: number;
  rsvps: number;
  notifications: number;
  invitesRevoked: number;
  directInvitesClosed: number;
  pinResetsCancelled: number;
};

/**
 * ลบ/ปิดร่องรอยของผู้ใช้ที่ถูกลบ (R5_CONTRACT §2 ข้อ 2) — เรียกในธุรกรรมเดียวกับ markUserDeletedGuarded
 *  - session ทั้งหมด · สมาชิกภาพทุกกลุ่ม (รวมกลุ่มที่ลบแล้ว) · busy ทั้งหมด · RSVP · notification + outbox ของตัวเอง
 *  - คำเชิญ/โค้ดที่ผู้ใช้สร้างและยัง active → revoked · คำเชิญตรงที่ส่งถึงผู้ใช้และยัง active → declined (ไม่แจ้งผู้เชิญ)
 *  - คำขอ reset PIN ที่ค้าง (pending/approved) → cancelled · อุปกรณ์/ประเทศของคำขอทุกแถว → NULL · ตัวนับ login ของ username เดิม (ผู้สมัครชื่อนี้ใหม่ต้องไม่รับล็อกไปด้วย)
 *  - ชื่อของผู้ใช้ใน params ของแจ้งเตือนคนอื่น (inviterName / inviteeName / actorName / responderName / memberName ที่เก็บ ณ เวลาเกิด) → '' (UI แสดง "บัญชีที่ถูกลบ") · ตัวอ้างอิงภายใน (actorId/responderId/memberId) ถูกลบออกพร้อมกัน
 * นัดที่ผู้ใช้สร้างยังอยู่ (created_by ชี้ id เดิม — serializer แสดงผู้สร้างเป็น null เพราะไม่ใช่สมาชิกแล้ว)
 */
export async function purgeDeletedUserFootprint(
  db: DbOrTx,
  input: { userId: string; /** คีย์ login_throttle ของ username เดิม (`usernameThrottleKey` ของ auth) */ loginThrottleKey: string },
  now: number,
): Promise<PurgeCounts> {
  const { userId } = input;
  // แจ้งเตือนของคนอื่นที่อ้างชื่อผู้ใช้นี้ — ทำก่อนปิดคำเชิญ (อ้างด้วย inviteId ของคำเชิญที่ผู้ใช้สร้าง/ได้รับ)
  await db.run(sql`
    UPDATE notification SET params = json_set(params, '$.inviterName', '')
     WHERE kind = 'group.invite.received' AND user_id <> ${userId}
       AND json_extract(params, '$.inviteId') IN (SELECT id FROM group_invite WHERE created_by = ${userId})`);
  await db.run(sql`
    UPDATE notification SET params = json_set(params, '$.inviteeName', '')
     WHERE kind IN ('group.invite.accepted', 'group.invite.declined') AND user_id <> ${userId}
       AND json_extract(params, '$.inviteId') IN (SELECT id FROM group_invite WHERE invitee_user_id = ${userId})`);
  // R11-7: แจ้งเตือนเหตุการณ์นัด/สมาชิกของคนอื่นที่อ้างผู้ใช้นี้ — อ้างผ่าน id ภายในใน params · ล้างชื่อ + ลบ id ออก
  await db.run(sql`
    UPDATE notification SET params = json_set(json_remove(params, '$.actorId'), '$.actorName', '')
     WHERE kind IN ('appointment.cancelled', 'appointment.updated') AND user_id <> ${userId}
       AND json_extract(params, '$.actorId') = ${userId}`);
  await db.run(sql`
    UPDATE notification SET params = json_set(json_remove(params, '$.responderId'), '$.responderName', '')
     WHERE kind = 'appointment.rsvp_changed' AND user_id <> ${userId}
       AND json_extract(params, '$.responderId') = ${userId}`);
  await db.run(sql`
    UPDATE notification SET params = json_set(json_remove(params, '$.memberId'), '$.memberName', '')
     WHERE kind IN ('group.member.joined', 'group.member.left') AND user_id <> ${userId}
       AND json_extract(params, '$.memberId') = ${userId}`);

  const sessions = await db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id });
  const memberships = await db.delete(groupMember).where(eq(groupMember.userId, userId)).returning({ g: groupMember.groupId });
  const busy = await db.delete(busyBlock).where(eq(busyBlock.userId, userId)).returning({ id: busyBlock.id });
  // R14 (ADR 0012 §8): บัญชีถูก anonymize ไม่ได้ลบแถว user → FK cascade จาก user ไม่ทำงาน · ลบกฎ routine เอง (skip ตาม FK cascade ของ busy_routine)
  const routines = await db.delete(busyRoutine).where(eq(busyRoutine.userId, userId)).returning({ id: busyRoutine.id });
  const rsvps = await db.delete(appointmentRsvp).where(eq(appointmentRsvp.userId, userId)).returning({ a: appointmentRsvp.appointmentId });
  await db.delete(notificationOutbox).where(eq(notificationOutbox.userId, userId));
  await db.delete(lineLinkCode).where(eq(lineLinkCode.userId, userId));
  const notifications = await db.delete(notification).where(eq(notification.userId, userId)).returning({ id: notification.id });
  const invitesRevoked = await db
    .update(groupInvite)
    .set({ status: 'revoked', revokedAt: now, revokedBy: userId })
    .where(and(eq(groupInvite.createdBy, userId), eq(groupInvite.status, 'active')))
    .returning({ id: groupInvite.id });
  const directInvitesClosed = await db
    .update(groupInvite)
    .set({ status: 'declined' })
    .where(and(eq(groupInvite.inviteeUserId, userId), eq(groupInvite.kind, 'direct'), eq(groupInvite.status, 'active')))
    .returning({ id: groupInvite.id });
  const pinResetsCancelled = await db
    .update(pinResetRequest)
    .set({ status: 'cancelled' })
    .where(and(eq(pinResetRequest.userId, userId), inArray(pinResetRequest.status, ['pending', 'approved'])))
    .returning({ id: pinResetRequest.id });
  // ข้อมูลอุปกรณ์/ประเทศของคำขอ reset ทุกแถวของผู้ใช้ (ทุกสถานะ) → NULL · แถวคงไว้เพื่อความปลอดภัย (สถานะ + เวลา) — QA R5 L2 / Sec Info 2
  await db.update(pinResetRequest).set({ requesterUa: null, requesterCountry: null }).where(eq(pinResetRequest.userId, userId));
  await db.delete(loginThrottle).where(eq(loginThrottle.key, input.loginThrottleKey));

  return {
    sessions: sessions.length,
    memberships: memberships.length,
    busy: busy.length,
    routines: routines.length,
    rsvps: rsvps.length,
    notifications: notifications.length,
    invitesRevoked: invitesRevoked.length,
    directInvitesClosed: directInvitesClosed.length,
    pinResetsCancelled: pinResetsCancelled.length,
  };
}
