// services: กลุ่ม + สมาชิก — U4, U6, D7–D9 · ARCHITECTURE §2: authorize() ก่อนทุกอย่างที่แตะข้อมูล
//  - group.create / group.list.mine: authorize ก่อนแตะ DB
//  - action ผูกกลุ่ม: โหลด GroupCtx (1 query) → authorize → จึงอ่าน/เขียนต่อ · ไม่ใช่สมาชิก/กลุ่มไม่มี/ลบแล้ว → NOT_FOUND (404) เหมือนกันหมด
//  - ทุกการเปลี่ยนสถานะ = คำสั่งเดียวมีเงื่อนไขในตัว (repo) ใน transaction เดียวกับ audit/notify — ไม่มี check-then-act
//  - super admin ที่ใช้สิทธิ์นอกกลุ่ม → audit (meta.asSuperAdmin) ทั้งเขียนและอ่าน
import { z } from 'zod';
import { findGroupById, insertGroupIfUnderCap, listGroupsOfUser, softDeleteGroup, updateGroup, type GroupPatch } from '@/lib/data/repos/group';
import {
  deleteMemberGuarded,
  deleteSelfMember,
  findMember,
  insertAdminMember,
  listActiveMemberIds,
  listMembersWithUpcomingBusy,
  setMemberRoleGuarded,
  transferAdminSteps,
  updateOwnAppearance,
} from '@/lib/data/repos/group-member';
import { revokeActiveInvitesCreatedBy } from '@/lib/data/repos/group-invite';
import { findUserById } from '@/lib/data/repos/user';
import { constraintKind } from '@/lib/data/repos/errors';
import { addDaysAt } from '@/lib/calendar';
import { authorize } from '@/lib/rbac/can';
import type { Actor, GroupCtx } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { GROUP_DEFAULT_MIN_FREE_MINUTES, GROUP_LIMITS, MEMBER_APPEARANCE_RATE_LIMIT, UPCOMING_BUSY_LOOKAHEAD_DAYS } from '@/lib/shared/limits';
import { APPEARANCE_SLOT_MAX, APPEARANCE_SLOT_MIN } from '@/lib/shared/member-color';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import { takeUserSlot } from '../admin-input';
import type { DbOrTx } from '@/db/client';
import type { DataCtx } from '../context';
import { parseGroupName } from '../group-name';
import { notify } from '../notifications/notify';
import { groupRowOf, loadGroupCtx } from '../policy-context';
import { toGroupDetail, toGroupSummary, toMyAppearance, type GroupDetailDto, type GroupSummaryDto, type MyAppearanceDto } from '../serializers/groups';
import { inTx } from '../tx';
import { asUser, audit, auditRead } from './group-common';

// ───────── input schemas (zod ที่ route · กติกาละเอียดอยู่ที่ service) ─────────
const gidField = z.uuid();
export const groupParamsSchema = z.object({ gid: gidField });
export const memberParamsSchema = z.object({ gid: gidField, uid: z.uuid() });

export const createGroupInputSchema = z.object({ name: z.string().min(1).max(200) }).strict();
export type CreateGroupInput = z.output<typeof createGroupInputSchema>;

export const updateGroupInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    freeWindowStartMin: z.number().int().optional(),
    freeWindowEndMin: z.number().int().optional(),
    minFreeMinutes: z.number().int().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { path: ['_'], message: 'EMPTY' });
export type UpdateGroupInput = z.output<typeof updateGroupInputSchema>;

export const setRoleInputSchema = z.object({ role: z.enum(['moderator', 'member']) }).strict();
export type SetRoleInput = z.output<typeof setRoleInputSchema>;

export const transferAdminInputSchema = z.object({ toUserId: z.uuid() }).strict();
export type TransferAdminInput = z.output<typeof transferAdminInputSchema>;

/** R6C: slot 1–10 หรือ null (= ใช้แบบอัตโนมัติ) · ทั้งสองคีย์บังคับ · คีย์เกิน → UNKNOWN_FIELD */
const appearanceSlot = z.number().int().min(APPEARANCE_SLOT_MIN).max(APPEARANCE_SLOT_MAX).nullable();
export const setAppearanceInputSchema = z.object({ color: appearanceSlot, shape: appearanceSlot }).strict();
export type SetAppearanceInput = z.output<typeof setAppearanceInputSchema>;

// ───────── helpers ─────────
const groupRes = (group: GroupCtx) => ({ type: 'group', group }) as const;

/** D9: หน้าต่างวันว่าง (ตรงกับ CHECK groups_window_ck / groups_min_free_ck) */
export function assertFreeWindow(start: number, end: number, minFree: number): void {
  const step = (n: number) => n % 30 === 0;
  const ok =
    start >= 0 && start < end && end <= 1440 && step(start) && step(end) && minFree >= 30 && step(minFree) && minFree <= end - start;
  if (!ok) throw new AppError('INVALID_WINDOW');
}

/**
 * เป้าหมายของ member.* ต้องเป็นสมาชิกปัจจุบัน (ADR 0003 types.ts) — ไม่ใช่ → NOT_FOUND
 * ก่อนตอบ NOT_FOUND ต้องผ่านด่านกลุ่มด้วย `group.view` (คนนอกกลุ่มได้ NOT_FOUND เท่ากัน · นอกจากนี้ PIN/suspended ถูกตัดสินก่อนตามลำดับของ can())
 */
async function requireTargetMember(actor: Actor, group: GroupCtx, ctx: DataCtx, targetUserId: string) {
  const target = group.deleted ? null : await findMember(ctx.db, group.id, targetUserId);
  if (!target) {
    authorize(actor, 'group.view', groupRes(group));
    throw new AppError('NOT_FOUND');
  }
  return target;
}

/** การเขียนที่มี ActorGuard ไม่ได้แถว: กลุ่มยังอยู่ = สิทธิ์ของผู้กระทำเปลี่ยนไประหว่างทาง (CONFLICT) · ไม่อยู่แล้ว = NOT_FOUND */
async function staleOrGone(db: DbOrTx, groupId: string): Promise<AppError> {
  const row = await findGroupById(db, groupId);
  return new AppError(row && row.deletedAt === null ? 'CONFLICT' : 'NOT_FOUND');
}

// ───────── U4 ─────────
export async function createGroup(actor: Actor, input: CreateGroupInput, ctx: DataCtx): Promise<GroupSummaryDto> {
  const allow = authorize(actor, 'group.create', { type: 'none' });
  const me = asUser(actor);
  const name = parseGroupName(input.name);
  const id = newId();
  const { now } = ctx;
  await inTx(ctx.db, async (tx) => {
    const created = await insertGroupIfUnderCap(
      tx,
      { id, name, createdBy: me.id, cap: GROUP_LIMITS.groupsCreatedPerUser, minFreeMinutes: GROUP_DEFAULT_MIN_FREE_MINUTES }, // R7 G1
      now,
    );
    if (!created) throw new AppError('LIMIT_REACHED', { limit: 'groups', max: GROUP_LIMITS.groupsCreatedPerUser });
    await insertAdminMember(tx, id, me.id, now); // กลุ่มละ 1 admin — group_one_admin_uq กันซ้ำระดับ DB
    await audit(tx, me, allow, { action: 'group.create', targetType: 'group', targetId: id, groupId: id }, now);
  });
  return { id, name, role: 'admin', memberCount: 1, createdAt: now };
}

export async function listMyGroups(actor: Actor, ctx: DataCtx): Promise<{ groups: GroupSummaryDto[] }> {
  authorize(actor, 'group.list.mine', { type: 'none' });
  const rows = await listGroupsOfUser(ctx.db, asUser(actor).id);
  return { groups: rows.map(toGroupSummary) };
}

export async function getGroup(actor: Actor, groupId: string, ctx: DataCtx): Promise<{ group: GroupDetailDto }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.view', groupRes(group));
  const me = asUser(actor);
  const row = groupRowOf(group); // R7 B-3: แถวกลุ่มมากับด่านกลุ่มแล้ว
  // R8 F1 §2.2: ธง "ลง busy แล้ว" มากับ query สมาชิกเดิม (EXISTS) — ไม่เพิ่ม query · ช่วง 30 วันปฏิทินตาม tz ของกลุ่ม (lib กลาง)
  const members = await listMembersWithUpcomingBusy(ctx.db, groupId, { from: ctx.now, to: addDaysAt(ctx.now, UPCOMING_BUSY_LOOKAHEAD_DAYS, row.tz) });
  await auditRead(ctx.db, me, allow, { action: 'group.view', targetType: 'group', targetId: groupId, groupId }, ctx.now);
  return { group: toGroupDetail(row, group.actorRole, members, me.id) };
}

// ───────── U6 · D9 ─────────
export async function updateGroupSettings(actor: Actor, groupId: string, input: UpdateGroupInput, ctx: DataCtx): Promise<{ group: GroupDetailDto }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.update', groupRes(group));
  const me = asUser(actor);
  const current = groupRowOf(group); // R7 B-3 · การเขียนยังมี ActorGuard + เงื่อนไขในคำสั่ง UPDATE เอง

  const patch: GroupPatch = {};
  if (input.name !== undefined) patch.name = parseGroupName(input.name);
  if (input.freeWindowStartMin !== undefined) patch.freeWindowStartMin = input.freeWindowStartMin;
  if (input.freeWindowEndMin !== undefined) patch.freeWindowEndMin = input.freeWindowEndMin;
  if (input.minFreeMinutes !== undefined) patch.minFreeMinutes = input.minFreeMinutes;
  assertFreeWindow(
    patch.freeWindowStartMin ?? current.freeWindowStartMin,
    patch.freeWindowEndMin ?? current.freeWindowEndMin,
    patch.minFreeMinutes ?? current.minFreeMinutes,
  );

  const { now } = ctx;
  await inTx(ctx.db, async (tx) => {
    // ค่าที่ไม่ได้ส่งมาอ้างจากแถวที่อ่านไว้ — ถ้ามีคนแก้พร้อมกันจนหน้าต่างไม่สอดคล้อง CHECK ของ DB เป็นด่านสุดท้าย (→ INVALID_WINDOW)
    const updated = await updateGroup(tx, groupId, patch, now, { actorId: me.id, actorRole: group.actorRole }).catch((e: unknown) => {
      if (constraintKind(e) === 'check') throw new AppError('INVALID_WINDOW');
      throw e;
    });
    if (!updated) throw await staleOrGone(tx, groupId);
    await audit(tx, me, allow, { action: 'group.update', targetType: 'group', targetId: groupId, groupId, meta: { fields: Object.keys(patch) } }, now);
  });
  return getGroup(actor, groupId, ctx);
}

export async function deleteGroup(actor: Actor, groupId: string, ctx: DataCtx): Promise<{ deleted: true }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.delete', groupRes(group));
  const me = asUser(actor);
  const { now } = ctx;
  await inTx(ctx.db, async (tx) => {
    // soft delete: คำสั่งเดียว · สมาชิก/คำเชิญ/โค้ดของกลุ่มนี้ใช้ไม่ได้ทันที เพราะทุก query ผูก groups.deleted_at IS NULL
    // ผู้กระทำต้องยังถือ role เดิมในคำสั่งเดียวกัน (แข่งกับโอน admin/ลดสิทธิ์/ลบสมาชิก — ADR 0003 membership-guard)
    if (!(await softDeleteGroup(tx, groupId, now, { actorId: me.id, actorRole: group.actorRole }))) throw await staleOrGone(tx, groupId);
    await audit(tx, me, allow, { action: 'group.delete', targetType: 'group', targetId: groupId, groupId }, now);
  });
  return { deleted: true };
}

export async function removeMember(actor: Actor, groupId: string, targetUserId: string, ctx: DataCtx): Promise<{ removed: true }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const target = await requireTargetMember(actor, group, ctx, targetUserId);
  const allow = authorize(actor, 'member.remove', { type: 'member', group, targetUserId, targetRole: target.role });
  const me = asUser(actor);
  const { now } = ctx;
  await inTx(ctx.db, async (tx) => {
    const ok = await deleteMemberGuarded(tx, { groupId, userId: targetUserId, expectedRole: target.role, actorId: me.id, actorRole: group.actorRole });
    if (!ok) throw new AppError((await findMember(tx, groupId, targetUserId)) ? 'CONFLICT' : 'NOT_FOUND');
    // โค้ด/คำเชิญที่คนนี้สร้างไว้และยัง active ใช้ต่อไม่ได้ (กันคนที่ถูกลบแจกทางเข้า)
    await revokeActiveInvitesCreatedBy(tx, groupId, targetUserId, me.id, now);
    // R11 §1: แจ้งคนที่ถูกนำออก (ไม่ใช่สมาชิกแล้ว แต่บัญชีต้อง active) · ไม่บอกชื่อผู้นำออก
    const removed = await findUserById(tx, targetUserId);
    await notify(
      tx,
      { userIds: removed?.status === 'active' && targetUserId !== me.id ? [targetUserId] : [], kind: 'group.member.removed', params: { groupId, groupName: sanitizeDisplayText(groupRowOf(group).name) } },
      now,
    );
    await audit(
      tx,
      me,
      allow,
      { action: 'member.remove', targetType: 'member', targetId: targetUserId, groupId, meta: { targetUserId, targetRole: target.role } },
      now,
    );
  });
  return { removed: true };
}

export async function setMemberRole(actor: Actor, groupId: string, targetUserId: string, input: SetRoleInput, ctx: DataCtx): Promise<{ userId: string; role: 'moderator' | 'member' }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const target = await requireTargetMember(actor, group, ctx, targetUserId);
  const allow = authorize(actor, 'member.setRole', { type: 'member', group, targetUserId, targetRole: target.role });
  const me = asUser(actor);
  const { now } = ctx;
  if (target.role === input.role) return { userId: targetUserId, role: input.role }; // ไม่เปลี่ยนอะไร — ไม่ audit
  await inTx(ctx.db, async (tx) => {
    const ok = await setMemberRoleGuarded(tx, {
      groupId,
      userId: targetUserId,
      fromRole: target.role,
      toRole: input.role,
      actorId: me.id,
      actorRole: group.actorRole,
    });
    if (!ok) throw new AppError((await findMember(tx, groupId, targetUserId)) ? 'CONFLICT' : 'NOT_FOUND');
    // R11 §1: คนที่สิทธิ์เปลี่ยนจริง (เทียบ role เดิมไปแล้วด้านบน) · ไม่แจ้งผู้กระทำ
    await notify(
      tx,
      {
        userIds: (await listActiveMemberIds(tx, groupId, { userIds: [targetUserId] })).filter((uid) => uid !== me.id),
        kind: 'group.member.role_changed',
        params: { groupId, groupName: sanitizeDisplayText(groupRowOf(group).name), role: input.role },
      },
      now,
    );
    await audit(
      tx,
      me,
      allow,
      { action: 'member.setRole', targetType: 'member', targetId: targetUserId, groupId, meta: { targetUserId, from: target.role, to: input.role } },
      now,
    );
  });
  return { userId: targetUserId, role: input.role };
}

/** D8: โอน admin — admin เดิมกลายเป็น moderator · อะตอมมิก: ลด admin เดิม + เลื่อนเป้าหมายใน transaction เดียว (เหลือ admin 1 คนเสมอ) */
export async function transferAdmin(actor: Actor, groupId: string, input: TransferAdminInput, ctx: DataCtx): Promise<{ adminUserId: string; previousAdminId: string }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const target = await requireTargetMember(actor, group, ctx, input.toUserId);
  const allow = authorize(actor, 'group.transferAdmin', { type: 'member', group, targetUserId: input.toUserId, targetRole: target.role });
  const me = asUser(actor);
  const { now } = ctx;
  const result = await inTx(ctx.db, async (tx) => {
    // ผู้กระทำเป็น admin → ต้องยังเป็น admin อยู่จริงตอนเขียน (โอนซ้อน 2 ครั้ง: ตัวหลังไม่ผ่าน) · super admin → ลดใครก็ตามที่ถือ admin
    const steps = await transferAdminSteps(tx, {
      groupId,
      toUserId: input.toUserId,
      fromAdminId: group.actorRole === 'admin' ? me.id : null,
    });
    if (!steps) throw new AppError('CONFLICT'); // rollback ทั้งก้อน — ไม่มีสถานะครึ่งทาง
    // R11 §1: ผู้รับตำแหน่ง (admin) + ผู้ดูแลเดิม (moderator) ถ้าไม่ใช่ผู้กระทำ (super admin โอนแทน = แจ้งทั้งสองคน) — คนละ params จึงเรียกแยก
    const movedRecipients = (await listActiveMemberIds(tx, groupId, { userIds: [input.toUserId, steps.previousAdminId] })).filter((uid) => uid !== me.id);
    const groupName = sanitizeDisplayText(groupRowOf(group).name);
    await notify(tx, { userIds: movedRecipients.filter((uid) => uid === input.toUserId), kind: 'group.member.role_changed', params: { groupId, groupName, role: 'admin' } }, now);
    await notify(tx, { userIds: movedRecipients.filter((uid) => uid === steps.previousAdminId), kind: 'group.member.role_changed', params: { groupId, groupName, role: 'moderator' } }, now);
    await audit(
      tx,
      me,
      allow,
      {
        action: 'group.transferAdmin',
        targetType: 'group',
        targetId: groupId,
        groupId,
        meta: { fromUserId: steps.previousAdminId, toUserId: input.toUserId },
      },
      now,
    );
    return steps;
  });
  return { adminUserId: input.toUserId, previousAdminId: result.previousAdminId };
}

/** D8: ออกจากกลุ่มเอง — admin ต้องโอนก่อน (409) · คำสั่ง DELETE มี role <> 'admin' กันแข่งกับการโอน */
export async function leaveGroup(actor: Actor, groupId: string, ctx: DataCtx): Promise<{ left: true }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.leave', groupRes(group));
  const me = asUser(actor);
  const { now } = ctx;
  await inTx(ctx.db, async (tx) => {
    if (!(await deleteSelfMember(tx, groupId, me.id))) {
      const still = await findMember(tx, groupId, me.id);
      throw new AppError(still ? 'ADMIN_TRANSFER_REQUIRED' : 'NOT_FOUND');
    }
    await revokeActiveInvitesCreatedBy(tx, groupId, me.id, me.id, now);
    // R11 §1: admin + moderator ที่ยังอยู่ · ผู้ออกเองไม่ได้รับ
    const leaver = await findUserById(tx, me.id);
    await notify(
      tx,
      {
        userIds: (await listActiveMemberIds(tx, groupId, { roles: ['admin', 'moderator'] })).filter((uid) => uid !== me.id),
        kind: 'group.member.left',
        params: { groupId, groupName: sanitizeDisplayText(groupRowOf(group).name), memberName: sanitizeDisplayText(leaver?.displayName ?? ''), memberId: me.id },
      },
      now,
    );
    await audit(tx, me, allow, { action: 'group.leave', targetType: 'member', targetId: me.id, groupId }, now);
  });
  return { left: true };
}

// ───────── R6C F3ก · หน้าตาของฉันในกลุ่มนี้ ─────────
/**
 * ตั้งสี/รูปทรงของ "ตัวเอง" (userId จาก session เสมอ — ไม่มีทางตั้งให้คนอื่น) · null = กลับไปใช้ hash เดิม
 * authorize(member.setOwnAppearance): สมาชิกทุก role · SA นอกกลุ่ม FORBIDDEN · คนนอก/กลุ่มลบ NOT_FOUND (+ PIN/suspended ใน can())
 * ไม่ลง audit (ค่าแสดงผลส่วนตัว — R6C_CONTRACT §2) · limiter ต่อผู้ใช้หลัง authorize (คนนอกไม่กินโควตา)
 */
export async function setMyAppearance(actor: Actor, groupId: string, input: SetAppearanceInput, ctx: DataCtx): Promise<MyAppearanceDto> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  authorize(actor, 'member.setOwnAppearance', groupRes(group));
  const me = asUser(actor);
  const { db, now } = ctx;
  await takeUserSlot(db, MEMBER_APPEARANCE_RATE_LIMIT, me.id, now);
  const saved = await updateOwnAppearance(db, { groupId, userId: me.id, colorSlot: input.color, shapeSlot: input.shape });
  if (!saved) throw new AppError('NOT_FOUND'); // ออกจากกลุ่ม/กลุ่มถูกลบระหว่างทาง
  return toMyAppearance(groupId, me.id, saved);
}
