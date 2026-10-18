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
  listMembers,
  setMemberRoleGuarded,
  transferAdminSteps,
} from '@/lib/data/repos/group-member';
import { revokeActiveInvitesCreatedBy } from '@/lib/data/repos/group-invite';
import { constraintKind } from '@/lib/data/repos/errors';
import { authorize } from '@/lib/rbac/can';
import type { Actor, GroupCtx } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { GROUP_LIMITS } from '@/lib/shared/limits';
import type { DataCtx } from '../context';
import { parseGroupName } from '../group-name';
import { loadGroupCtx } from '../policy-context';
import { toGroupDetail, toGroupSummary, type GroupDetailDto, type GroupSummaryDto } from '../serializers/groups';
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

// ───────── U4 ─────────
export async function createGroup(actor: Actor, input: CreateGroupInput, ctx: DataCtx): Promise<GroupSummaryDto> {
  const allow = authorize(actor, 'group.create', { type: 'none' });
  const me = asUser(actor);
  const name = parseGroupName(input.name);
  const id = newId();
  const { now } = ctx;
  await inTx(ctx.db, async (tx) => {
    const created = await insertGroupIfUnderCap(tx, { id, name, createdBy: me.id, cap: GROUP_LIMITS.groupsCreatedPerUser }, now);
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
  const row = await findGroupById(ctx.db, groupId);
  if (!row || row.deletedAt !== null) throw new AppError('NOT_FOUND');
  const members = await listMembers(ctx.db, groupId);
  await auditRead(ctx.db, me, allow, { action: 'group.view', targetType: 'group', targetId: groupId, groupId }, ctx.now);
  return { group: toGroupDetail(row, group.actorRole, members) };
}

// ───────── U6 · D9 ─────────
export async function updateGroupSettings(actor: Actor, groupId: string, input: UpdateGroupInput, ctx: DataCtx): Promise<{ group: GroupDetailDto }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'group.update', groupRes(group));
  const me = asUser(actor);
  const current = await findGroupById(ctx.db, groupId);
  if (!current || current.deletedAt !== null) throw new AppError('NOT_FOUND');

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
    const updated = await updateGroup(tx, groupId, patch, now).catch((e: unknown) => {
      if (constraintKind(e) === 'check') throw new AppError('INVALID_WINDOW');
      throw e;
    });
    if (!updated) throw new AppError('NOT_FOUND');
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
    if (!(await softDeleteGroup(tx, groupId, now))) throw new AppError('NOT_FOUND');
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
    await audit(tx, me, allow, { action: 'group.leave', targetType: 'member', targetId: me.id, groupId }, now);
  });
  return { left: true };
}
