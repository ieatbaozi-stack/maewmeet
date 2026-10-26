// repo: group_invite — U5, U6 · โค้ดเชิญเก็บเฉพาะ hash (ไม่มีฟังก์ชันใดในไฟล์นี้รับ/คืนโค้ดดิบ)
// "หมดอายุ" ตรวจแบบ lazy ด้วย expires_at > now ทุก query (ARCHITECTURE §3) · คำเชิญของกลุ่มที่ถูกลบใช้ไม่ได้ทันที (join groups.deleted_at IS NULL)
// เปลี่ยนสถานะ/เพดาน/เข้ากลุ่มด้วยคำสั่งเดียวที่มีเงื่อนไขในตัว — ไม่มี check-then-act
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { groupInvite, groups, user } from '@/db/schema';
import type { DbOrTx } from '@/db/client';
import { actorGuardClause, actorHolds, type ActorGuard } from './group-member';

export type InviteRow = typeof groupInvite.$inferSelect;
export type InviteStatus = InviteRow['status'];

// ───────── สร้าง ─────────

/**
 * สร้างโค้ดถ้ากลุ่มยังไม่ถูกลบ + ผู้สร้างยังถือ role ที่ตัดสินสิทธิ์ไว้ (ActorGuard — สมาชิกที่ถูกลบกลางทางสร้างไม่ได้) + โค้ดที่ยังใช้ได้ < cap — คำสั่งเดียวอะตอมมิก
 * คืน 'ok' | 'full' (เต็มเพดาน) | 'gone' (กลุ่มไม่มี/ถูกลบ) | 'stale' (ผู้สร้างไม่ถือ role เดิมแล้ว) · ชน unique ของ code_hash → โยน (ผู้เรียกสุ่มใหม่)
 */
export async function insertCodeInviteIfRoom(
  db: DbOrTx,
  input: { id: string; groupId: string; codeHash: string; codeHint: string; createdBy: string; expiresAt: number; cap: number },
  now: number,
  guard: ActorGuard,
): Promise<'ok' | 'full' | 'gone' | 'stale'> {
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO group_invite (id, group_id, kind, code_hash, code_hint, status, uses_count, created_by, created_at, expires_at)
    SELECT ${input.id}, ${input.groupId}, 'code', ${input.codeHash}, ${input.codeHint}, 'active', 0, ${input.createdBy}, ${now}, ${input.expiresAt}
    WHERE EXISTS (SELECT 1 FROM groups WHERE id = ${input.groupId} AND deleted_at IS NULL)
      AND ${actorGuardClause(input.groupId, guard)}
      AND (SELECT count(*) FROM group_invite
            WHERE group_id = ${input.groupId} AND kind = 'code' AND status = 'active' AND expires_at > ${now}) < ${input.cap}
    RETURNING id`);
  if (rows.length === 1) return 'ok';
  const g = await db.select({ d: groups.deletedAt }).from(groups).where(eq(groups.id, input.groupId)).limit(1);
  if (!g[0] || g[0].d !== null) return 'gone';
  return (await actorHolds(db, input.groupId, guard)) ? 'full' : 'stale';
}

/** ปิดคำเชิญตรงที่ค้างแต่หมดอายุของคู่ (กลุ่ม, ผู้รับ) เพื่อให้สร้างใหม่ได้ (unique index ตรวจ status = active) */
export async function expireDueDirectInvites(db: DbOrTx, groupId: string, inviteeUserId: string, now: number): Promise<void> {
  await db
    .update(groupInvite)
    .set({ status: 'expired' })
    .where(
      and(
        eq(groupInvite.groupId, groupId),
        eq(groupInvite.inviteeUserId, inviteeUserId),
        eq(groupInvite.kind, 'direct'),
        eq(groupInvite.status, 'active'),
        sql`${groupInvite.expiresAt} <= ${now}`,
      ),
    );
}

/**
 * สร้างคำเชิญตรง ถ้ากลุ่มยังไม่ถูกลบ + ผู้ชวนยังถือ role ที่ตัดสินสิทธิ์ไว้ (ActorGuard) — คำสั่งเดียวอะตอมมิก
 * มีคำเชิญ active คู่เดียวกันอยู่ (unique index) → โยน unique violation ให้ผู้เรียกแปลง · คืน null = ไม่เข้าเงื่อนไข (ผู้เรียกวินิจฉัยด้วย findGroupById)
 */
export async function insertDirectInvite(
  db: DbOrTx,
  input: { id: string; groupId: string; inviteeUserId: string; createdBy: string; expiresAt: number; inviteeCap: number },
  now: number,
  guard: ActorGuard,
): Promise<InviteRow | 'invitee_full' | null> {
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO group_invite (id, group_id, kind, invitee_user_id, status, uses_count, created_by, created_at, expires_at)
    SELECT ${input.id}, ${input.groupId}, 'direct', ${input.inviteeUserId}, 'active', 0, ${input.createdBy}, ${now}, ${input.expiresAt}
    WHERE EXISTS (SELECT 1 FROM groups WHERE id = ${input.groupId} AND deleted_at IS NULL)
      AND ${actorGuardClause(input.groupId, guard)}
      AND (SELECT count(*) FROM group_invite i JOIN groups g ON g.id = i.group_id AND g.deleted_at IS NULL
            WHERE i.invitee_user_id = ${input.inviteeUserId} AND i.kind = 'direct' AND i.status = 'active' AND i.expires_at > ${now}) < ${input.inviteeCap}
    RETURNING id`);
  if (rows.length !== 1) return (await countPendingDirectFor(db, input.inviteeUserId, now)) >= input.inviteeCap && (await actorHolds(db, input.groupId, guard)) ? 'invitee_full' : null;
  return (await findInviteById(db, input.id)) ?? null;
}

/**
 * ผู้รับเคย "ปฏิเสธ" คำเชิญตรงของกลุ่มนี้ (จากผู้ชวนคนใดก็ได้) ตั้งแต่ `since` ไหม (คูลดาวน์กันชวนซ้ำ — คีย์ (กลุ่ม, ผู้รับ)) · เวลาที่ปฏิเสธอ่านจาก audit_log
 * (invite.direct.respond decision=declined — เขียนใน transaction เดียวกับการปฏิเสธ จึงไม่ต้องเพิ่มคอลัมน์)
 */
export async function hasDeclinedSince(
  db: DbOrTx,
  input: { groupId: string; inviteeUserId: string },
  since: number,
): Promise<boolean> {
  const rows = await db.all<{ n: number }>(sql`
    SELECT count(*) AS n
      FROM audit_log a JOIN group_invite i ON i.id = a.target_id
     WHERE a.action = 'invite.direct.respond' AND a.target_type = 'invite' AND a.created_at > ${since}
       AND json_extract(a.meta, '$.decision') = 'declined'
       AND i.group_id = ${input.groupId} AND i.invitee_user_id = ${input.inviteeUserId}
       AND i.kind = 'direct' AND i.status = 'declined'`);
  return Number(rows[0]?.n ?? 0) > 0;
}

// ───────── อ่าน ─────────

export async function findInviteInGroup(db: DbOrTx, groupId: string, inviteId: string): Promise<InviteRow | null> {
  const rows = await db
    .select()
    .from(groupInvite)
    .where(and(eq(groupInvite.id, inviteId), eq(groupInvite.groupId, groupId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findInviteById(db: DbOrTx, inviteId: string): Promise<InviteRow | null> {
  const rows = await db.select().from(groupInvite).where(eq(groupInvite.id, inviteId)).limit(1);
  return rows[0] ?? null;
}

export type InviteListRow = InviteRow & { creatorName: string; inviteeName: string | null };

/**
 * คำเชิญที่ "ยังใช้ได้" ของกลุ่ม (active + ยังไม่หมดอายุ) ใหม่สุดก่อน
 * `createdBy` ระบุ = กรองที่ SQL ให้เห็นเฉพาะของคนนั้น (MEM — R1 §3 ข้อ 6) · ไม่คืน code_hash
 */
export async function listActiveInvitesOfGroup(
  db: DbOrTx,
  groupId: string,
  now: number,
  filter: { createdBy?: string } = {},
): Promise<InviteListRow[]> {
  const rows = await db
    .select({
      invite: {
        id: groupInvite.id,
        groupId: groupInvite.groupId,
        kind: groupInvite.kind,
        inviteeUserId: groupInvite.inviteeUserId,
        codeHint: groupInvite.codeHint,
        status: groupInvite.status,
        usesCount: groupInvite.usesCount,
        createdBy: groupInvite.createdBy,
        createdAt: groupInvite.createdAt,
        expiresAt: groupInvite.expiresAt,
        revokedAt: groupInvite.revokedAt,
        revokedBy: groupInvite.revokedBy,
      },
      creatorName: user.displayName,
      inviteeName: sql<string | null>`(SELECT u.display_name FROM user u WHERE u.id = ${groupInvite.inviteeUserId})`,
    })
    .from(groupInvite)
    .innerJoin(user, eq(user.id, groupInvite.createdBy))
    .where(
      and(
        eq(groupInvite.groupId, groupId),
        eq(groupInvite.status, 'active'),
        gt(groupInvite.expiresAt, now),
        ...(filter.createdBy ? [eq(groupInvite.createdBy, filter.createdBy)] : []),
      ),
    )
    .orderBy(desc(groupInvite.createdAt), asc(groupInvite.id));
  return rows.map((r) => ({ ...r.invite, codeHash: null, creatorName: r.creatorName, inviteeName: r.inviteeName }));
}

export type PendingDirectInvite = {
  id: string;
  groupId: string;
  groupName: string;
  inviterName: string;
  createdAt: number;
  expiresAt: number;
};

/** จำนวนคำเชิญตรงที่ค้างของผู้รับ (นิยามเดียวกับรายการ/เพดาน) */
export async function countPendingDirectFor(db: DbOrTx, userId: string, now: number): Promise<number> {
  const rows = await db.all<{ n: number }>(sql`
    SELECT count(*) AS n FROM group_invite i JOIN groups g ON g.id = i.group_id AND g.deleted_at IS NULL
     WHERE i.invitee_user_id = ${userId} AND i.kind = 'direct' AND i.status = 'active' AND i.expires_at > ${now}`);
  return Number(rows[0]?.n ?? 0);
}

/** คำเชิญตรงที่ค้างของผู้ใช้ (active + ยังไม่หมดอายุ + กลุ่มยังอยู่) */
export async function listPendingDirectInvitesFor(db: DbOrTx, userId: string, now: number, limit: number): Promise<PendingDirectInvite[]> {
  return db
    .select({
      id: groupInvite.id,
      groupId: groupInvite.groupId,
      groupName: groups.name,
      inviterName: user.displayName,
      createdAt: groupInvite.createdAt,
      expiresAt: groupInvite.expiresAt,
    })
    .from(groupInvite)
    .innerJoin(groups, eq(groups.id, groupInvite.groupId))
    .innerJoin(user, eq(user.id, groupInvite.createdBy))
    .where(
      and(
        eq(groupInvite.inviteeUserId, userId),
        eq(groupInvite.kind, 'direct'),
        eq(groupInvite.status, 'active'),
        gt(groupInvite.expiresAt, now),
        isNull(groups.deletedAt),
      ),
    )
    .orderBy(desc(groupInvite.createdAt), asc(groupInvite.id))
    .limit(limit);
}

/** โค้ดที่ยังใช้ได้ตาม hash (active + ไม่หมดอายุ + กลุ่มยังอยู่) — ใช้วินิจฉัยหลัง join ไม่สำเร็จ */
export async function findUsableCodeInvite(db: DbOrTx, codeHash: string, now: number): Promise<{ id: string; groupId: string } | null> {
  const rows = await db
    .select({ id: groupInvite.id, groupId: groupInvite.groupId })
    .from(groupInvite)
    .innerJoin(groups, eq(groups.id, groupInvite.groupId))
    .where(
      and(
        eq(groupInvite.codeHash, codeHash),
        eq(groupInvite.kind, 'code'),
        eq(groupInvite.status, 'active'),
        gt(groupInvite.expiresAt, now),
        isNull(groups.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ───────── เปลี่ยนสถานะ ─────────

/** เพิกถอน (เฉพาะที่ยัง active + ผู้เพิกถอนยังถือ role ที่ตัดสินสิทธิ์ไว้ — ActorGuard) · คืนแถวที่เปลี่ยน หรือ null */
export async function revokeInvite(
  db: DbOrTx,
  groupId: string,
  inviteId: string,
  revokedBy: string,
  now: number,
  guard: ActorGuard,
): Promise<InviteRow | null> {
  const rows = await db
    .update(groupInvite)
    .set({ status: 'revoked', revokedAt: now, revokedBy })
    .where(
      and(
        eq(groupInvite.id, inviteId),
        eq(groupInvite.groupId, groupId),
        eq(groupInvite.status, 'active'),
        actorGuardClause(groupId, guard),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** เพิกถอนคำเชิญ/โค้ดที่ยัง active ที่คนนี้สร้างไว้ในกลุ่ม (ตอนเขาถูกลบ/ออกจากกลุ่ม) · คืนจำนวน */
export async function revokeActiveInvitesCreatedBy(
  db: DbOrTx,
  groupId: string,
  createdBy: string,
  revokedBy: string,
  now: number,
): Promise<number> {
  const rows = await db
    .update(groupInvite)
    .set({ status: 'revoked', revokedAt: now, revokedBy })
    .where(and(eq(groupInvite.groupId, groupId), eq(groupInvite.createdBy, createdBy), eq(groupInvite.status, 'active')))
    .returning({ id: groupInvite.id });
  return rows.length;
}

/**
 * ตอบคำเชิญตรง: active → accepted/declined เฉพาะของผู้รับ · ยังไม่หมดอายุ · กลุ่มยังอยู่ — คำสั่งเดียวอะตอมมิก
 * คืน { groupId, createdBy } หรือ null (ไม่ตรงเงื่อนไข: ผู้เรียกวินิจฉัยต่อ)
 */
export async function closeDirectInvite(
  db: DbOrTx,
  input: { inviteId: string; inviteeUserId: string; to: 'accepted' | 'declined' },
  now: number,
): Promise<{ groupId: string; createdBy: string } | null> {
  const rows = await db.all<{ group_id: string; created_by: string }>(sql`
    UPDATE group_invite
       SET status = ${input.to}, uses_count = CASE WHEN ${input.to} = 'accepted' THEN uses_count + 1 ELSE uses_count END
     WHERE id = ${input.inviteId} AND invitee_user_id = ${input.inviteeUserId} AND kind = 'direct'
       AND status = 'active' AND expires_at > ${now}
       AND EXISTS (SELECT 1 FROM groups g WHERE g.id = group_invite.group_id AND g.deleted_at IS NULL)
    RETURNING group_id, created_by`);
  const r = rows[0];
  return r ? { groupId: r.group_id, createdBy: r.created_by } : null;
}

// ───────── ใช้โค้ด ─────────

/**
 * เข้ากลุ่มด้วยโค้ด — INSERT … SELECT เดียว: โค้ดต้อง active + ไม่หมดอายุ + กลุ่มยังอยู่ + ผู้ใช้ยัง active (R5: แข่งกับการลบบัญชี) + ยังไม่เป็นสมาชิก + สมาชิก < cap
 * (เงื่อนไขของโค้ดอยู่ในคำสั่งเดียวกับการเพิ่มสมาชิก — โค้ดที่เพิกถอน/ลบกลุ่มไปแล้วเข้าไม่ได้แม้แข่งกัน)
 * คืน groupId ที่เข้า หรือ null (ผู้เรียกวินิจฉัย: ไม่ถูกต้อง / เป็นสมาชิกอยู่แล้ว / เต็ม)
 */
export async function joinGroupWithCode(
  db: DbOrTx,
  input: { codeHash: string; userId: string; cap: number },
  now: number,
): Promise<string | null> {
  const rows = await db.all<{ group_id: string }>(sql`
    INSERT INTO group_member (group_id, user_id, role, joined_at)
    SELECT i.group_id, ${input.userId}, 'member', ${now}
      FROM group_invite i JOIN groups g ON g.id = i.group_id
     WHERE i.code_hash = ${input.codeHash} AND i.kind = 'code' AND i.status = 'active' AND i.expires_at > ${now}
       AND g.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM "user" u WHERE u.id = ${input.userId} AND u.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM group_member m WHERE m.group_id = i.group_id AND m.user_id = ${input.userId})
       AND (SELECT count(*) FROM group_member m WHERE m.group_id = i.group_id) < ${input.cap}
    RETURNING group_id`);
  return rows[0]?.group_id ?? null;
}

/** นับการใช้โค้ด (ข้อมูลประกอบการแสดงผล — ไม่ใช่ด่านความถูกต้อง) */
export async function bumpCodeUses(db: DbOrTx, inviteId: string): Promise<void> {
  await db
    .update(groupInvite)
    .set({ usesCount: sql`${groupInvite.usesCount} + 1` })
    .where(eq(groupInvite.id, inviteId));
}
