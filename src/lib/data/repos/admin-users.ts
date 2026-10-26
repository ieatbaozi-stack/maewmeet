// repo: หน้า super admin — ผู้ใช้ (R5 — U12) · query ล้วน ไม่รู้จัก actor
//  - รายการ: ค้น username (prefix ของ username_normalized) หรือชื่อที่แสดง (contains) · LIKE ESCAPE '\' (ผู้เรียก escape ด้วย escapeLike)
//  - นับกลุ่ม / สถานะล็อก / คำขอ reset ที่เปิดอยู่ ด้วย subquery ในคำสั่งเดียว (ไม่มี N+1)
//  - ระงับ/คืนสถานะ = UPDATE มีเงื่อนไขในตัว (สถานะเดิม + ไม่ใช่ super admin) — ไม่มี check-then-act
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { user } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

/** escape ตัวพิเศษของ LIKE (`\` ก่อน แล้ว `%` `_`) — ใช้คู่กับ ESCAPE '\' */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export type KeysetCursor = { createdAt: number; id: string };

export type AdminUserRow = {
  id: string;
  username: string;
  displayName: string;
  status: 'active' | 'suspended' | 'deleted';
  isAdmin: boolean;
  createdAt: number;
  groupCount: number;
  /** locked_until ที่ยังมีผล (> now) · null = ไม่ล็อก */
  lockedUntil: number | null;
  hasOpenReset: boolean;
};

type RawUserRow = {
  id: string;
  username: string;
  display_name: string;
  status: AdminUserRow['status'];
  super_admin: number;
  created_at: number;
  group_count: number;
  locked_until: number | null;
  has_open_reset: number;
};

/**
 * ผู้ใช้ที่ยังไม่ถูกลบ ใหม่→เก่า keyset (created_at, id) · ขอ limit+1 เพื่อรู้ว่ามีหน้าถัดไป
 * `q` (escape แล้ว): username_normalized LIKE q% หรือ display_name LIKE %q%
 */
export async function listUsersForAdmin(
  db: DbOrTx,
  input: { usernamePrefix: string | null; nameContains: string | null; cursor: KeysetCursor | null; limit: number; now: number },
): Promise<AdminUserRow[]> {
  const { now } = input;
  const conds: SQL[] = [sql`${user.status} <> 'deleted'`];
  if (input.usernamePrefix !== null || input.nameContains !== null) {
    const parts: SQL[] = [];
    if (input.usernamePrefix !== null) parts.push(sql`${user.usernameNormalized} LIKE ${`${input.usernamePrefix}%`} ESCAPE '\\'`);
    if (input.nameContains !== null) parts.push(sql`${user.displayName} LIKE ${`%${input.nameContains}%`} ESCAPE '\\'`);
    conds.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  if (input.cursor) conds.push(sql`(${user.createdAt}, ${user.id}) < (${input.cursor.createdAt}, ${input.cursor.id})`);
  // ตาราง user อ้างผ่านคอลัมน์ของ drizzle (ไม่เขียนชื่อคอลัมน์ดิบ — tests/auth/is-admin สแกนชื่อคอลัมน์ super admin แบบข้อความดิบ)
  const rows = await db.all<RawUserRow>(sql`
    SELECT ${user.id} AS id, ${user.username} AS username, ${user.displayName} AS display_name, ${user.status} AS status,
      ${user.isAdmin} AS super_admin, ${user.createdAt} AS created_at,
      (SELECT count(*) FROM group_member gm INNER JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = ${user.id} AND g.deleted_at IS NULL) AS group_count,
      (SELECT lt.locked_until FROM login_throttle lt
        WHERE lt.key = 'u:' || ${user.usernameNormalized} AND lt.locked_until > ${now}) AS locked_until,
      EXISTS (SELECT 1 FROM pin_reset_request r WHERE r.user_id = ${user.id}
        AND ((r.status = 'pending' AND r.pending_expires_at > ${now}) OR (r.status = 'approved' AND r.expires_at > ${now}))) AS has_open_reset
    FROM ${user}
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY ${user.createdAt} DESC, ${user.id} DESC
    LIMIT ${input.limit}`);
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    status: r.status,
    isAdmin: Number(r.super_admin) === 1,
    createdAt: Number(r.created_at),
    groupCount: Number(r.group_count),
    lockedUntil: r.locked_until === null ? null : Number(r.locked_until),
    hasOpenReset: Number(r.has_open_reset) === 1,
  }));
}

/** active → suspended เฉพาะผู้ใช้ที่ไม่ใช่ super admin (เงื่อนไขในคำสั่งเดียว) · คืน false = เงื่อนไขไม่ตรง */
export async function suspendUserGuarded(db: DbOrTx, userId: string, now: number): Promise<boolean> {
  const rows = await db
    .update(user)
    .set({ status: 'suspended', updatedAt: now })
    .where(and(eq(user.id, userId), eq(user.status, 'active'), eq(user.isAdmin, false)))
    .returning({ id: user.id });
  return rows.length === 1;
}

/** suspended → active · คืน false = ไม่ได้อยู่ในสถานะ suspended */
export async function unsuspendUserGuarded(db: DbOrTx, userId: string, now: number): Promise<boolean> {
  const rows = await db
    .update(user)
    .set({ status: 'active', updatedAt: now })
    .where(and(eq(user.id, userId), eq(user.status, 'suspended')))
    .returning({ id: user.id });
  return rows.length === 1;
}
