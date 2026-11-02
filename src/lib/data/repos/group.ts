// repo: groups — U4, U6, D9 · query ล้วน ไม่รู้จัก actor · เวลา = now ที่ผู้เรียก inject
// การเปลี่ยนสถานะที่แข่งกันได้ (เพดานกลุ่ม) เป็นคำสั่งเดียวที่มีเงื่อนไขในตัว — ไม่มี check-then-act
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { groupMember, groups } from '@/db/schema';
import type { DbOrTx } from '@/db/client';
import { GROUP_DEFAULT_MIN_FREE_MINUTES } from '@/lib/shared/limits';
import { actorGuardClause, type ActorGuard } from './group-member';

export type GroupRow = typeof groups.$inferSelect;
export type GroupRole = (typeof groupMember.$inferSelect)['role'];

export type GroupPatch = {
  name?: string;
  freeWindowStartMin?: number;
  freeWindowEndMin?: number;
  minFreeMinutes?: number;
};

/**
 * สร้างกลุ่มถ้าผู้สร้างยังมีกลุ่มที่สร้าง (และยังไม่ลบ) น้อยกว่า `cap` — คำสั่งเดียวอะตอมมิก · คืน false = เต็มเพดาน
 * minFreeMinutes: ไม่ส่ง = GROUP_DEFAULT_MIN_FREE_MINUTES (R7 G1 — ไม่พึ่ง DB default 120) · หน้าต่าง 08:00–22:00 ใช้ DB default
 */
export async function insertGroupIfUnderCap(
  db: DbOrTx,
  input: { id: string; name: string; createdBy: string; cap: number; minFreeMinutes?: number },
  now: number,
): Promise<boolean> {
  const minFree = input.minFreeMinutes ?? GROUP_DEFAULT_MIN_FREE_MINUTES;
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO groups (id, name, min_free_minutes, created_by, created_at, updated_at)
    SELECT ${input.id}, ${input.name}, ${minFree}, ${input.createdBy}, ${now}, ${now}
    WHERE (SELECT count(*) FROM groups WHERE created_by = ${input.createdBy} AND deleted_at IS NULL) < ${input.cap}
    RETURNING id`);
  return rows.length === 1;
}

export async function findGroupById(db: DbOrTx, id: string): Promise<GroupRow | null> {
  const rows = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * แก้เฉพาะกลุ่มที่ยังไม่ลบ + ผู้กระทำยังถือ role ที่ตัดสินสิทธิ์ไว้ (ActorGuard) · ละเมิด CHECK ของหน้าต่างวันว่าง → โยน (ผู้เรียกแปลงด้วย constraintKind)
 * คืน null = ไม่มี/ลบแล้ว/ผู้กระทำไม่ถือ role เดิมแล้ว (ผู้เรียกวินิจฉัยต่อ)
 */
export async function updateGroup(db: DbOrTx, id: string, patch: GroupPatch, now: number, guard: ActorGuard): Promise<GroupRow | null> {
  const rows = await db
    .update(groups)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(groups.id, id), isNull(groups.deletedAt), actorGuardClause(id, guard)))
    .returning();
  return rows[0] ?? null;
}

/** soft delete (U6) · ผู้กระทำต้องยังถือ role ที่ตัดสินสิทธิ์ไว้ในคำสั่งเดียวกัน (ActorGuard) · คืน false = ไม่มี/ลบไปแล้ว/ผู้กระทำไม่ถือ role เดิมแล้ว */
export async function softDeleteGroup(db: DbOrTx, id: string, now: number, guard: ActorGuard): Promise<boolean> {
  const rows = await db
    .update(groups)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(groups.id, id), isNull(groups.deletedAt), actorGuardClause(id, guard)))
    .returning({ id: groups.id });
  return rows.length === 1;
}

export type GroupOfUser = { group: GroupRow; role: GroupRole; memberCount: number };

/** กลุ่มที่ user เป็นสมาชิก (ไม่รวมที่ลบแล้ว) เรียงตามชื่อ */
export async function listGroupsOfUser(db: DbOrTx, userId: string): Promise<GroupOfUser[]> {
  const rows = await db
    .select({
      group: groups,
      role: groupMember.role,
      memberCount: sql<number>`(SELECT count(*) FROM group_member m WHERE m.group_id = ${groups.id})`,
    })
    .from(groupMember)
    .innerJoin(groups, eq(groups.id, groupMember.groupId))
    .where(and(eq(groupMember.userId, userId), isNull(groups.deletedAt)))
    .orderBy(asc(sql`lower(${groups.name})`), asc(groups.id));
  return rows.map((r) => ({ group: r.group, role: r.role, memberCount: Number(r.memberCount) }));
}

export async function countGroupsCreatedBy(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM groups WHERE created_by = ${userId} AND deleted_at IS NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}
