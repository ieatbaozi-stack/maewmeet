// repo: ลบคำเชิญเก่าถาวร (R18 D1) — เรียกจาก cron รายวันเท่านั้น · query ล้วน ไม่รู้จัก actor
//
// "จบแล้ว" = เวลาสิ้นสุด max(expires_at, revoked_at) <= cutoff (cutoff = now − INVITE_RETENTION_DAYS วันปฏิทิน · คำนวณใน service ด้วย src/lib/calendar)
//   ใช้ได้กับทุกสถานะ: accepted/declined/revoked/expired · active ที่ยังไม่หมดอายุไม่มีทางเข้าเงื่อนไข (expires_at > now > cutoff)
//   active ที่หมดอายุแล้วแต่ cron ยังไม่ได้เปลี่ยนเป็น expired ก็นับว่าจบ (หมดอายุ = จบ ตาม expiredInvites ใน maintenance.ts)
//
// สิ่งที่อ้าง group_invite.id (สำรวจ schema 2026-11-20):
//   ไม่มี FK ชี้มาที่ group_invite
//   notification.params.inviteId (group.invite.received / accepted / declined) — purgeDeletedUserFootprint (repos/account.ts) ใช้ inviteId
//     → group_invite.created_by / invitee_user_id เพื่อหาแจ้งเตือนที่ต้องล้างชื่อตอนลบบัญชี · ถ้าลบคำเชิญเฉย ๆ การล้างชื่อนั้นจะหาแถวไม่เจอ
//     จึง "ประทับ" id ผู้เชิญ/ผู้ถูกเชิญลง params (inviterId / inviteeId — คีย์ภายใน ไม่ออกทาง API ดู INTERNAL_PARAM_KEYS) ก่อนลบ ในธุรกรรมเดียวกัน
//   audit_log.target_id / meta.inviteId — เป็นแค่ข้อความ id ไม่ join กลับมาที่ตารางนี้ → หน้า audit อ่านได้ตามเดิม (ไม่ลบ audit)
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';

/** เงื่อนไข "จบแล้วและเลยกำหนดเก็บ" — ที่เดียวที่ใช้ทั้งเลือกและลบ */
const due = (cutoff: number): SQL => sql`expires_at <= ${cutoff} AND (revoked_at IS NULL OR revoked_at <= ${cutoff})`;

export type InvitePurgeBatch = { deleted: number; more: boolean };

/**
 * ลบคำเชิญที่ถึงกำหนด 1 ชุด (ไม่เกิน limit แถว · เก่าสุดก่อน) — ต้องเรียกในธุรกรรมเขียน (ผู้เรียกส่ง tx)
 * ลำดับ: เลือก id → ประทับ inviterId/inviteeId ลงแจ้งเตือนที่อ้างคำเชิญเหล่านั้น → ลบ (ตรวจเงื่อนไขซ้ำใน DELETE)
 * more = ชุดนี้เต็ม limit (อาจยังมีค้าง)
 */
export async function purgeDueInvitesBatch(db: DbOrTx, cutoff: number, limit: number): Promise<InvitePurgeBatch> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM group_invite WHERE ${due(cutoff)} ORDER BY expires_at, id LIMIT ${limit}`);
  if (rows.length === 0) return { deleted: 0, more: false };
  const ids = sql.join(
    rows.map((r) => sql`${r.id}`),
    sql`, `,
  );
  // แจ้งเตือนของผู้ถูกเชิญ (มีชื่อผู้เชิญ) → ประทับ id ผู้เชิญ ให้ purgeDeletedUserFootprint ล้างชื่อได้แม้คำเชิญหายแล้ว
  await db.run(sql`
    UPDATE notification SET params = json_set(params, '$.inviterId', gi.created_by)
      FROM group_invite gi
     WHERE notification.kind = 'group.invite.received'
       AND json_valid(notification.params)
       AND gi.id = json_extract(notification.params, '$.inviteId')
       AND gi.id IN (${ids})`);
  // แจ้งเตือนของผู้เชิญ (มีชื่อผู้ถูกเชิญ) → ประทับ id ผู้ถูกเชิญ
  await db.run(sql`
    UPDATE notification SET params = json_set(params, '$.inviteeId', gi.invitee_user_id)
      FROM group_invite gi
     WHERE notification.kind IN ('group.invite.accepted', 'group.invite.declined')
       AND json_valid(notification.params)
       AND gi.id = json_extract(notification.params, '$.inviteId')
       AND gi.invitee_user_id IS NOT NULL
       AND gi.id IN (${ids})`);
  const res = await db.run(sql`DELETE FROM group_invite WHERE id IN (${ids}) AND ${due(cutoff)}`);
  return { deleted: res.rowsAffected, more: rows.length >= limit };
}
