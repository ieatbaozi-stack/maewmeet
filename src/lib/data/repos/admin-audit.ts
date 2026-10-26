// repo: หน้า super admin — audit log (R5 — U12) · query ล้วน
//  - อ่าน: ใหม่→เก่า keyset (created_at, id) · กรอง actor/action/targetType/targetId ด้วยค่าเท่ากัน (ไม่มี LIKE) · join username ของผู้กระทำ
//  - `admin.audit.view`: INSERT … SELECT … WHERE NOT EXISTS (แถวของผู้ใช้นี้ในช่วง interval) — คำสั่งเดียว ไม่เกิน 1 แถว/ช่วง/ผู้ใช้
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import type { KeysetCursor } from './admin-users';

export type AuditFilter = { actorId?: string; action?: string; targetType?: string; targetId?: string };

export type AuditListRow = {
  id: string;
  createdAt: number;
  action: string;
  actorId: string | null;
  actorUsername: string | null;
  targetType: string;
  targetId: string;
  groupId: string | null;
  meta: unknown;
};

type RawAudit = {
  id: string;
  created_at: number;
  action: string;
  actor_id: string | null;
  actor_username: string | null;
  target_type: string;
  target_id: string;
  group_id: string | null;
  meta: string | null;
};

function parseMeta(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function listAuditForAdmin(db: DbOrTx, input: { filter: AuditFilter; cursor: KeysetCursor | null; limit: number }): Promise<AuditListRow[]> {
  const f = input.filter;
  const conds: SQL[] = [sql`1 = 1`];
  if (f.actorId !== undefined) conds.push(sql`a.actor_id = ${f.actorId}`);
  if (f.action !== undefined) conds.push(sql`a.action = ${f.action}`);
  if (f.targetType !== undefined) conds.push(sql`a.target_type = ${f.targetType}`);
  if (f.targetId !== undefined) conds.push(sql`a.target_id = ${f.targetId}`);
  if (input.cursor) conds.push(sql`(a.created_at, a.id) < (${input.cursor.createdAt}, ${input.cursor.id})`);
  const rows = await db.all<RawAudit>(sql`
    SELECT a.id, a.created_at, a.action, a.actor_id, u.username AS actor_username,
           a.target_type, a.target_id, a.group_id, a.meta
      FROM audit_log a LEFT JOIN "user" u ON u.id = a.actor_id
     WHERE ${sql.join(conds, sql` AND `)}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ${input.limit}`);
  return rows.map((r) => ({
    id: r.id,
    createdAt: Number(r.created_at),
    action: r.action,
    actorId: r.actor_id,
    actorUsername: r.actor_username,
    targetType: r.target_type,
    targetId: r.target_id,
    groupId: r.group_id,
    meta: parseMeta(r.meta),
  }));
}

export const AUDIT_VIEW_ACTION = 'admin.audit.view';

/**
 * เขียน `admin.audit.view` ถ้าผู้ใช้นี้ยังไม่มีแถวนี้ภายใน `intervalMs` ที่ผ่านมา — คำสั่งเดียว (ไม่มี check-then-act)
 * meta = { filtered } เท่านั้น (ไม่เก็บค่าที่ค้น) · คืน true = เขียนแถวใหม่
 */
export async function insertAuditViewThrottled(
  db: DbOrTx,
  input: { id: string; actorId: string; filtered: boolean; intervalMs: number },
  now: number,
): Promise<boolean> {
  const meta = JSON.stringify({ filtered: input.filtered, asSuperAdmin: true });
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO audit_log (id, actor_id, action, target_type, target_id, group_id, meta, created_at)
    SELECT ${input.id}, ${input.actorId}, ${AUDIT_VIEW_ACTION}, 'audit_log', 'audit_log', NULL, ${meta}, ${now}
     WHERE NOT EXISTS (SELECT 1 FROM audit_log
                        WHERE actor_id = ${input.actorId} AND action = ${AUDIT_VIEW_ACTION} AND created_at > ${now - input.intervalMs})
    RETURNING id`);
  return rows.length === 1;
}

export const GROUP_VIEW_ACTION = 'admin.group.view';

/**
 * เขียน `admin.group.view` ถ้า (ผู้ใช้, กลุ่ม) นี้ยังไม่มีแถวภายใน `intervalMs` — คำสั่งเดียว INSERT … WHERE NOT EXISTS (Security R5 L4)
 * กัน audit บวมจากการรีเฟรช/ยิงวน และลดผลของการนำทางข้ามไซต์ที่ปลอมแถว · meta = { asSuperAdmin: true } เหมือนเดิม · คืน true = เขียนแถวใหม่
 */
export async function insertGroupViewThrottled(
  db: DbOrTx,
  input: { id: string; actorId: string; groupId: string; intervalMs: number },
  now: number,
): Promise<boolean> {
  const meta = JSON.stringify({ asSuperAdmin: true });
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO audit_log (id, actor_id, action, target_type, target_id, group_id, meta, created_at)
    SELECT ${input.id}, ${input.actorId}, ${GROUP_VIEW_ACTION}, 'group', ${input.groupId}, ${input.groupId}, ${meta}, ${now}
     WHERE NOT EXISTS (SELECT 1 FROM audit_log
                        WHERE actor_id = ${input.actorId} AND action = ${GROUP_VIEW_ACTION} AND target_id = ${input.groupId}
                          AND created_at > ${now - input.intervalMs})
    RETURNING id`);
  return rows.length === 1;
}

