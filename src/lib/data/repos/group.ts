// repo: groups — U4, U6, D9 · query ล้วน ไม่รู้จัก actor · เวลา = now ที่ผู้เรียก inject
// การเปลี่ยนสถานะที่แข่งกันได้ (เพดานกลุ่ม) เป็นคำสั่งเดียวที่มีเงื่อนไขในตัว — ไม่มี check-then-act
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { groupMember, groups } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export type GroupRow = typeof groups.$inferSelect;
export type GroupRole = (typeof groupMember.$inferSelect)['role'];

export type GroupPatch = {
  name?: string;
  freeWindowStartMin?: number;
  freeWindowEndMin?: number;
  minFreeMinutes?: number;
};

/** สร้างกลุ่มถ้าผู้สร้างยังมีกลุ่มที่สร้าง (และยังไม่ลบ) น้อยกว่า `cap` — คำสั่งเดียวอะตอมมิก · คืน false = เต็มเพดาน */
export async function insertGroupIfUnderCap(
  db: DbOrTx,
  input: { id: string; name: string; createdBy: string; cap: number },
  now: number,
): Promise<boolean> {
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO groups (id, name, created_by, created_at, updated_at)
    SELECT ${input.id}, ${input.name}, ${input.createdBy}, ${now}, ${now}
    WHERE (SELECT count(*) FROM groups WHERE created_by = ${input.createdBy} AND deleted_at IS NULL) < ${input.cap}
    RETURNING id`);
  return rows.length === 1;
}

export async function findGroupById(db: DbOrTx, id: string): Promise<GroupRow | null> {
  const rows = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  return rows[0] ?? null;
}

/** แก้เฉพาะกลุ่มที่ยังไม่ลบ · ละเมิด CHECK ของหน้าต่างวันว่าง → โยน (ผู้เรียกแปลงด้วย constraintKind) · คืน null = ไม่มี/ลบแล้ว */
export async function updateGroup(db: DbOrTx, id: string, patch: GroupPatch, now: number): Promise<GroupRow | null> {
  const rows = await db
    .update(groups)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
    .returning();
  return rows[0] ?? null;
}

/** soft delete (U6) · คืน false = ไม่มี/ลบไปแล้ว */
export async function softDeleteGroup(db: DbOrTx, id: string, now: number): Promise<boolean> {
  const rows = await db
    .update(groups)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
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
