// repo: ลบกลุ่มถาวร (R17 G2) — เรียกจาก cron รายวันเท่านั้น · query ล้วน ไม่รู้จัก actor
//
// สิ่งที่อ้างกลุ่ม (สำรวจ schema 2026-11-19):
//   มี FK → groups (ON DELETE CASCADE): group_member, group_invite, appointment
//     └ appointment → appointment_rsvp, appointment_reminder (เตือนนัด/LINE กันซ้ำ) (CASCADE)
//   ไม่มี FK (อ้างผ่าน JSON): notification.params.groupId (ทุกชนิดของกลุ่ม/นัด) · notification_outbox.payload.params.groupId (คิว LINE)
//   ไม่ลบ: audit_log.group_id — บันทึกความปลอดภัย (retention เดิม R17 §6) มีแค่ id/enum ไม่มีชื่อกลุ่ม
//          rate_limit_bucket (คีย์อาจมี id กลุ่ม) — cron ลบเองภายใน 2 วัน (RETENTION.rateLimitBucketMs)
// ลบลูกด้วยคำสั่งชัดเจนก่อนลบแถวกลุ่ม (ไม่พึ่ง cascade อย่างเดียว — ได้จำนวนแถวจริงไปลง audit และไม่ค้างแม้ foreign_keys ถูกปิด)
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';

/** จำนวนแถวที่ลบต่อกลุ่ม — เก็บใน audit `group.purge` (ไม่มีชื่อ/ข้อความของผู้ใช้) */
export type GroupPurgeCounts = {
  members: number;
  invites: number;
  appointments: number;
  rsvps: number;
  reminders: number;
  notifications: number;
  outbox: number;
};

/** id กลุ่มที่ถึงกำหนดลบถาวร (deleted_at <= cutoff) เก่าสุดก่อน · ไม่เกิน limit */
export async function listGroupsDueForPurge(db: DbOrTx, deletedAtCutoff: number, limit: number): Promise<string[]> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM groups WHERE deleted_at IS NOT NULL AND deleted_at <= ${deletedAtCutoff}
     ORDER BY deleted_at, id LIMIT ${limit}`);
  return rows.map((r) => r.id);
}

const changes = async (db: DbOrTx, q: SQL): Promise<number> => (await db.run(q)).rowsAffected;

/**
 * ลบกลุ่มหนึ่งกลุ่มถาวร (ต้องเรียกในธุรกรรมเขียน — ผู้เรียกส่ง tx) · ตรวจเงื่อนไขซ้ำเป็นคำสั่งแรก (ถูกกู้คืนไปแล้ว/ไม่มีแล้ว → null ไม่ลบอะไร)
 */
export async function purgeGroupIfDue(db: DbOrTx, groupId: string, deletedAtCutoff: number): Promise<GroupPurgeCounts | null> {
  const due = await db.all<{ id: string }>(sql`
    SELECT id FROM groups WHERE id = ${groupId} AND deleted_at IS NOT NULL AND deleted_at <= ${deletedAtCutoff}`);
  if (due.length === 0) return null;

  const outbox = await changes(db, sql`DELETE FROM notification_outbox WHERE json_extract(payload, '$.params.groupId') = ${groupId}`);
  const notifications = await changes(db, sql`DELETE FROM notification WHERE json_extract(params, '$.groupId') = ${groupId}`);
  const reminders = await changes(db, sql`
    DELETE FROM appointment_reminder WHERE appointment_id IN (SELECT id FROM appointment WHERE group_id = ${groupId})`);
  const rsvps = await changes(db, sql`
    DELETE FROM appointment_rsvp WHERE appointment_id IN (SELECT id FROM appointment WHERE group_id = ${groupId})`);
  const appointments = await changes(db, sql`DELETE FROM appointment WHERE group_id = ${groupId}`);
  const invites = await changes(db, sql`DELETE FROM group_invite WHERE group_id = ${groupId}`);
  const members = await changes(db, sql`DELETE FROM group_member WHERE group_id = ${groupId}`);
  const gone = await changes(db, sql`DELETE FROM groups WHERE id = ${groupId} AND deleted_at IS NOT NULL AND deleted_at <= ${deletedAtCutoff}`);
  // คำสั่งแรกยืนยันแล้วในธุรกรรมเดียวกัน — ไม่ได้ 1 แถว = ผิดคาด → โยนให้ rollback ทั้งก้อน
  if (gone !== 1) throw new Error('group purge: row vanished inside transaction');
  return { members, invites, appointments, rsvps, reminders, notifications, outbox };
}
