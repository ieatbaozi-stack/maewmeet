// repo: หน้า super admin — กลุ่ม (R5 — U12) · query ล้วน ไม่รู้จัก actor
//  - รายการ: ชื่อ contains (ESCAPE '\') · สถานะ active/deleted/all · keyset (created_at, id) ใหม่→เก่า
//  - admin username + จำนวนสมาชิก ด้วย subquery ในคำสั่งเดียว (ไม่มี N+1)
//  - รายละเอียด: เฉพาะชื่อ/tz/สมาชิก (username, ชื่อที่แสดง, role, เวลาเข้า) + จำนวนนัดที่ยังเปิด — ไม่อ่าน busy/รายละเอียดนัดเลย
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import type { GroupRole } from './group';
import type { KeysetCursor } from './admin-users';

export type AdminGroupStatusFilter = 'active' | 'deleted' | 'all';

export type AdminGroupRow = {
  id: string;
  name: string;
  adminUsername: string | null;
  memberCount: number;
  createdAt: number;
  deletedAt: number | null;
  /** R17: มี admin ของกลุ่มที่บัญชี active (เงื่อนไขหนึ่งของการกู้คืน) */
  hasActiveAdmin: boolean;
};

type RawGroupRow = {
  id: string;
  name: string;
  admin_username: string | null;
  member_count: number;
  created_at: number;
  deleted_at: number | null;
  has_active_admin: number;
};

/** R17: EXISTS admin ของกลุ่ม g ที่บัญชียัง active — ชิ้นเดียวกันใช้ทั้งอ่าน (หน้า admin) และใน WHERE ของการกู้คืน */
const activeAdminExists = (groupIdExpr: SQL) =>
  sql`EXISTS (SELECT 1 FROM group_member gm INNER JOIN "user" u ON u.id = gm.user_id
               WHERE gm.group_id = ${groupIdExpr} AND gm.role = 'admin' AND u.status = 'active')`;

export async function listGroupsForAdmin(
  db: DbOrTx,
  input: { nameContains: string | null; status: AdminGroupStatusFilter; cursor: KeysetCursor | null; limit: number },
): Promise<AdminGroupRow[]> {
  const conds: SQL[] = [sql`1 = 1`];
  if (input.status === 'active') conds.push(sql`g.deleted_at IS NULL`);
  if (input.status === 'deleted') conds.push(sql`g.deleted_at IS NOT NULL`);
  if (input.nameContains !== null) conds.push(sql`g.name LIKE ${`%${input.nameContains}%`} ESCAPE '\\'`);
  if (input.cursor) conds.push(sql`(g.created_at, g.id) < (${input.cursor.createdAt}, ${input.cursor.id})`);
  const rows = await db.all<RawGroupRow>(sql`
    SELECT g.id, g.name, g.created_at, g.deleted_at, ${activeAdminExists(sql`g.id`)} AS has_active_admin,
      (SELECT u.username FROM group_member gm INNER JOIN "user" u ON u.id = gm.user_id
        WHERE gm.group_id = g.id AND gm.role = 'admin') AS admin_username,
      (SELECT count(*) FROM group_member gm WHERE gm.group_id = g.id) AS member_count
    FROM groups g
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY g.created_at DESC, g.id DESC
    LIMIT ${input.limit}`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    adminUsername: r.admin_username,
    memberCount: Number(r.member_count),
    createdAt: Number(r.created_at),
    deletedAt: r.deleted_at === null ? null : Number(r.deleted_at),
    hasActiveAdmin: Number(r.has_active_admin) === 1,
  }));
}

export type AdminGroupDetailRow = {
  id: string;
  name: string;
  tz: string;
  createdAt: number;
  deletedAt: number | null;
  openAppointmentCount: number;
  /** R17: มี admin ของกลุ่มที่บัญชี active */
  hasActiveAdmin: boolean;
};

/** กลุ่ม (รวมที่ลบแล้ว) + จำนวนนัด active ที่ยังไม่จบ · ไม่มี = null */
export async function findGroupForAdmin(db: DbOrTx, groupId: string, now: number): Promise<AdminGroupDetailRow | null> {
  const rows = await db.all<{ id: string; name: string; tz: string; created_at: number; deleted_at: number | null; open_count: number; has_active_admin: number }>(sql`
    SELECT g.id, g.name, g.tz, g.created_at, g.deleted_at, ${activeAdminExists(sql`g.id`)} AS has_active_admin,
      (SELECT count(*) FROM appointment a WHERE a.group_id = g.id AND a.status = 'active' AND a.end_at > ${now}) AS open_count
    FROM groups g WHERE g.id = ${groupId} LIMIT 1`);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    tz: r.tz,
    createdAt: Number(r.created_at),
    deletedAt: r.deleted_at === null ? null : Number(r.deleted_at),
    openAppointmentCount: Number(r.open_count),
    hasActiveAdmin: Number(r.has_active_admin) === 1,
  };
}

/**
 * R17 G1: กู้คืนกลุ่ม — คำสั่งเดียวที่มีเงื่อนไขในตัว: ยังลบอยู่ + ยังไม่ถึงเวลาลบถาวร (max(deleted_at, START) + 30 วัน > now)
 * + มี admin ที่บัญชี active · แข่งกับ cron ลบถาวร: SQLite เขียนทีละธุรกรรม — ฝั่งไหนเขียนก่อนชนะ อีกฝั่งไม่เจอแถวตามเงื่อนไข
 * คืน { id, name } ของกลุ่มที่กู้ หรือ null (ผู้เรียกวินิจฉัยเหตุผลต่อ)
 */
export async function restoreGroupGuarded(
  db: DbOrTx,
  input: { groupId: string; retentionStartMs: number; retentionMs: number },
  now: number,
): Promise<{ id: string; name: string } | null> {
  const rows = await db.all<{ id: string; name: string }>(sql`
    UPDATE groups SET deleted_at = NULL, updated_at = ${now}
     WHERE id = ${input.groupId}
       AND deleted_at IS NOT NULL
       AND max(deleted_at, ${input.retentionStartMs}) + ${input.retentionMs} > ${now}
       AND ${activeAdminExists(sql`groups.id`)}
    RETURNING id, name`);
  const r = rows[0];
  return r ? { id: r.id, name: r.name } : null;
}

/** R17 G5: สมาชิกที่บัญชี active ของกลุ่ม (ผู้รับแจ้งเตือน "กลุ่มถูกกู้คืน") */
export async function listActiveMemberIds(db: DbOrTx, groupId: string): Promise<string[]> {
  const rows = await db.all<{ user_id: string }>(sql`
    SELECT gm.user_id FROM group_member gm INNER JOIN "user" u ON u.id = gm.user_id
     WHERE gm.group_id = ${groupId} AND u.status = 'active'
     ORDER BY gm.user_id`);
  return rows.map((r) => r.user_id);
}

export type AdminMemberRow = { userId: string; username: string; displayName: string; role: GroupRole; joinedAt: number };

/** สมาชิกปัจจุบัน: admin → moderator → member แล้วตามเวลาเข้า (ลำดับเดียวกับ listMembers) */
export async function listMembersForAdmin(db: DbOrTx, groupId: string): Promise<AdminMemberRow[]> {
  const rows = await db.all<{ user_id: string; username: string; display_name: string; role: GroupRole; joined_at: number }>(sql`
    SELECT gm.user_id, u.username, u.display_name, gm.role, gm.joined_at
      FROM group_member gm INNER JOIN "user" u ON u.id = gm.user_id
     WHERE gm.group_id = ${groupId}
     ORDER BY CASE gm.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, gm.joined_at, gm.user_id`);
  return rows.map((r) => ({ userId: r.user_id, username: r.username, displayName: r.display_name, role: r.role, joinedAt: Number(r.joined_at) }));
}
