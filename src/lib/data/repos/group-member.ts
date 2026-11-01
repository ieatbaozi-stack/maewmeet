// repo: group_member — U4–U6, D7–D8 · unique index group_one_admin_uq + PK (group_id, user_id) เป็นด่านสุดท้ายระดับ DB
// ทุกคำสั่งเปลี่ยนสถานะเป็นคำสั่งเดียวที่มีเงื่อนไขในตัว (เพดานสมาชิก, role ที่คาดไว้, role ของผู้กระทำ) — ไม่มี check-then-act
// "role ของผู้กระทำ" (ActorGuard): ผู้เรียกตัดสินสิทธิ์จาก role ที่อ่านมา ตอนเขียนต้องยังเป็น role นั้น ไม่งั้น 0 แถว (→ CONFLICT)
import { and, asc, eq, sql } from 'drizzle-orm';
import { groupMember, groups, user } from '@/db/schema';
import type { DbOrTx } from '@/db/client';
import type { GroupRole } from './group';

export type MemberRow = typeof groupMember.$inferSelect;

/** role ที่ผู้กระทำถืออยู่ ณ ตอนตัดสินสิทธิ์ · null = ไม่ใช่สมาชิก (super admin นอกกลุ่ม) */
export type ActorGuard = { actorId: string; actorRole: GroupRole | null };

export const actorStillHolds = (groupId: string, g: ActorGuard) =>
  sql`(SELECT role FROM group_member WHERE group_id = ${groupId} AND user_id = ${g.actorId}) IS ${g.actorRole}`;

/**
 * ด่าน "ผู้กระทำยังถือ role เดิม" สำหรับการเขียนที่ผู้เรียกตัดสินสิทธิ์จาก role ที่อ่านมา (ADR 0003 กฎ membership-guard)
 * ผู้กระทำที่เป็นสมาชิก → ต้องยังถือ role เดิมในคำสั่งเดียวกับการเขียน · super admin ที่กระทำจากนอกกลุ่ม (actorRole = null) → ไม่มีอะไรให้ตรวจ
 */
export const actorGuardClause = (groupId: string, g: ActorGuard) => (g.actorRole === null ? sql`1` : actorStillHolds(groupId, g));

/** ผู้กระทำยังถือ role เดิมไหม (ใช้วินิจฉัยหลังการเขียนถูกปฏิเสธ — การอ่านนี้ไม่มีผลต่อความปลอดภัย) */
export async function actorHolds(db: DbOrTx, groupId: string, g: ActorGuard): Promise<boolean> {
  const rows = await db.all<{ ok: number }>(sql`SELECT ${actorGuardClause(groupId, g)} AS ok`);
  return Number(rows[0]?.ok ?? 0) === 1;
}

export type GroupAccessRow = { id: string; deletedAt: number | null; role: GroupRole | null };

/** กลุ่ม + role ของ user ในกลุ่ม ใน query เดียว (policy-context) · ไม่มีกลุ่ม = null */
export async function findGroupAccess(db: DbOrTx, groupId: string, userId: string): Promise<GroupAccessRow | null> {
  const rows = await db
    .select({ id: groups.id, deletedAt: groups.deletedAt, role: groupMember.role })
    .from(groups)
    .leftJoin(groupMember, and(eq(groupMember.groupId, groups.id), eq(groupMember.userId, userId)))
    .where(eq(groups.id, groupId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findMember(db: DbOrTx, groupId: string, userId: string): Promise<MemberRow | null> {
  const rows = await db
    .select()
    .from(groupMember)
    .where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function countMembers(db: DbOrTx, groupId: string): Promise<number> {
  const rows = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM group_member WHERE group_id = ${groupId}`);
  return Number(rows[0]?.n ?? 0);
}

export type MemberWithUser = MemberRow & { displayName: string };

/** สมาชิกทั้งกลุ่ม: admin → moderator → member แล้วตามเวลาเข้า */
export async function listMembers(db: DbOrTx, groupId: string): Promise<MemberWithUser[]> {
  const rank = sql`CASE ${groupMember.role} WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END`;
  const rows = await db
    .select({ m: groupMember, displayName: user.displayName })
    .from(groupMember)
    .innerJoin(user, eq(user.id, groupMember.userId))
    .where(eq(groupMember.groupId, groupId))
    .orderBy(asc(rank), asc(groupMember.joinedAt), asc(groupMember.userId));
  return rows.map((r) => ({ ...r.m, displayName: r.displayName }));
}

/** user id ของสมาชิกปัจจุบันทั้งกลุ่ม (เบา — ไม่ join ตาราง user) */
export async function listMemberIds(db: DbOrTx, groupId: string): Promise<string[]> {
  const rows = await db.select({ userId: groupMember.userId }).from(groupMember).where(eq(groupMember.groupId, groupId)).orderBy(asc(groupMember.userId));
  return rows.map((r) => r.userId);
}

export async function insertAdminMember(db: DbOrTx, groupId: string, userId: string, now: number): Promise<void> {
  await db.insert(groupMember).values({ groupId, userId, role: 'admin', joinedAt: now });
}

export type JoinResult = 'inserted' | 'already' | 'full' | 'gone';

/**
 * เพิ่มสมาชิก role member ถ้า: กลุ่มยังไม่ถูกลบ + ผู้ใช้ยัง active (R5: แข่งกับการลบบัญชี) + ยังไม่เป็นสมาชิก + จำนวนสมาชิก < cap — คำสั่งเดียวอะตอมมิก
 * ไม่ได้แถว → วินิจฉัยสาเหตุด้วยการอ่านต่อ (การอ่านนี้ไม่มีผลต่อความปลอดภัย: การเขียนถูกปฏิเสธไปแล้ว)
 */
export async function insertMemberIfRoom(
  db: DbOrTx,
  input: { groupId: string; userId: string; cap: number },
  now: number,
): Promise<JoinResult> {
  const rows = await db.all<{ user_id: string }>(sql`
    INSERT INTO group_member (group_id, user_id, role, joined_at)
    SELECT ${input.groupId}, ${input.userId}, 'member', ${now}
    WHERE EXISTS (SELECT 1 FROM groups WHERE id = ${input.groupId} AND deleted_at IS NULL)
      AND EXISTS (SELECT 1 FROM "user" WHERE id = ${input.userId} AND status = 'active')
      AND NOT EXISTS (SELECT 1 FROM group_member WHERE group_id = ${input.groupId} AND user_id = ${input.userId})
      AND (SELECT count(*) FROM group_member WHERE group_id = ${input.groupId}) < ${input.cap}
    RETURNING user_id`);
  if (rows.length === 1) return 'inserted';
  return diagnoseJoin(db, input);
}

export async function diagnoseJoin(
  db: DbOrTx,
  input: { groupId: string; userId: string },
): Promise<Exclude<JoinResult, 'inserted'>> {
  const access = await findGroupAccess(db, input.groupId, input.userId);
  if (!access || access.deletedAt !== null) return 'gone';
  return access.role !== null ? 'already' : 'full';
}

/** ลบสมาชิก (D7) · ต้องยังเป็น role ที่ตัดสินสิทธิ์ไว้ + ไม่ใช่ admin + ผู้กระทำยังถือ role เดิม · คืน false = เงื่อนไขไม่ตรงแล้ว */
export async function deleteMemberGuarded(
  db: DbOrTx,
  input: { groupId: string; userId: string; expectedRole: GroupRole } & ActorGuard,
): Promise<boolean> {
  if (input.expectedRole === 'admin') return false;
  const rows = await db
    .delete(groupMember)
    .where(
      and(
        eq(groupMember.groupId, input.groupId),
        eq(groupMember.userId, input.userId),
        eq(groupMember.role, input.expectedRole),
        actorStillHolds(input.groupId, input),
      ),
    )
    .returning({ userId: groupMember.userId });
  return rows.length === 1;
}

/** ออกจากกลุ่มเอง (D8) · admin ออกไม่ได้ (role <> 'admin' ในคำสั่งเดียวกัน — กันแข่งกับการโอน admin) */
export async function deleteSelfMember(db: DbOrTx, groupId: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(groupMember)
    .where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId), sql`${groupMember.role} <> 'admin'`))
    .returning({ userId: groupMember.userId });
  return rows.length === 1;
}

/** member ↔ moderator เท่านั้น (เป้าหมายต้องยังเป็น role เดิม ไม่ใช่ admin) · คืน false = เงื่อนไขไม่ตรงแล้ว */
export async function setMemberRoleGuarded(
  db: DbOrTx,
  input: { groupId: string; userId: string; fromRole: GroupRole; toRole: 'moderator' | 'member' } & ActorGuard,
): Promise<boolean> {
  if (input.fromRole === 'admin') return false;
  const rows = await db
    .update(groupMember)
    .set({ role: input.toRole })
    .where(
      and(
        eq(groupMember.groupId, input.groupId),
        eq(groupMember.userId, input.userId),
        eq(groupMember.role, input.fromRole),
        actorStillHolds(input.groupId, input),
      ),
    )
    .returning({ userId: groupMember.userId });
  return rows.length === 1;
}

/**
 * โอน admin (D8) — เรียกภายใน transaction เดียว (ผู้เรียกรับผิดชอบ) ลำดับสำคัญเพราะ group_one_admin_uq ตรวจทีละคำสั่ง:
 *   1) ลด admin ปัจจุบันเป็น moderator — ถ้า `fromAdminId` ระบุ (ผู้กระทำเป็น admin) ต้องเป็นคนนั้นอยู่จริง ไม่งั้น 0 แถว
 *      (โอนซ้อนกันสองครั้ง: ตัวที่สองเห็นว่าตนไม่ใช่ admin แล้ว → ไม่สำเร็จ) · ไม่ระบุ (super admin) = ใครถือ admin อยู่ก็ลดคนนั้น
 *   2) เลื่อนเป้าหมาย (ต้องยังเป็น member/moderator ของกลุ่มนี้) เป็น admin — 0 แถว = เป้าหมายออก/หายไประหว่างทาง → ผู้เรียก rollback
 * คืน admin เดิม หรือ null ถ้าขั้นใดขั้นหนึ่งไม่ได้แถว (ผู้เรียก rollback)
 */
export async function transferAdminSteps(
  tx: DbOrTx,
  input: { groupId: string; toUserId: string; fromAdminId: string | null },
): Promise<{ previousAdminId: string } | null> {
  const demoted = await tx
    .update(groupMember)
    .set({ role: 'moderator' })
    .where(
      and(
        eq(groupMember.groupId, input.groupId),
        eq(groupMember.role, 'admin'),
        ...(input.fromAdminId ? [eq(groupMember.userId, input.fromAdminId)] : []),
      ),
    )
    .returning({ userId: groupMember.userId });
  const previousAdminId = demoted[0]?.userId;
  if (!previousAdminId) return null;
  const promoted = await tx
    .update(groupMember)
    .set({ role: 'admin' })
    .where(
      and(
        eq(groupMember.groupId, input.groupId),
        eq(groupMember.userId, input.toUserId),
        sql`${groupMember.role} IN ('member','moderator')`,
      ),
    )
    .returning({ userId: groupMember.userId });
  return promoted.length === 1 ? { previousAdminId } : null;
}

/** จำนวนผู้ถือ role admin ของกลุ่ม (เทสต์/ตรวจ invariant) */
export async function countAdmins(db: DbOrTx, groupId: string): Promise<number> {
  const rows = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM group_member WHERE group_id = ${groupId} AND role = 'admin'`,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * R6C F3ก: ตั้งหน้าตาของ "ตัวเอง" ในกลุ่ม (slot 1–10 · null = ใช้ hash) — คำสั่งเดียวมีเงื่อนไข: ยังเป็นสมาชิก + กลุ่มยังไม่ถูกลบ
 * คืน slot หลังเขียน · null = ไม่ใช่สมาชิกแล้ว/กลุ่มถูกลบ (ผู้เรียกตอบ NOT_FOUND) · CHECK group_member_*_slot_ck เป็นด่านสุดท้าย
 */
export async function updateOwnAppearance(
  db: DbOrTx,
  input: { groupId: string; userId: string; colorSlot: number | null; shapeSlot: number | null },
): Promise<{ colorSlot: number | null; shapeSlot: number | null } | null> {
  const rows = await db
    .update(groupMember)
    .set({ colorSlot: input.colorSlot, shapeSlot: input.shapeSlot })
    .where(
      and(
        eq(groupMember.groupId, input.groupId),
        eq(groupMember.userId, input.userId),
        sql`EXISTS (SELECT 1 FROM groups WHERE id = ${input.groupId} AND deleted_at IS NULL)`,
      ),
    )
    .returning({ colorSlot: groupMember.colorSlot, shapeSlot: groupMember.shapeSlot });
  return rows[0] ?? null;
}
