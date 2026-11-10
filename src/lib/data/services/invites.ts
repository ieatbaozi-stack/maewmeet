// services: คำเชิญ + โค้ดเชิญ — U5 · R2_CONTRACT §2/§3 · LEAD_DECISIONS Q4, Q5
//  - โค้ด: สุ่ม 8 ตัว (invite-code.ts) เก็บเฉพาะ HMAC · โค้ดเต็มอยู่ในผลของ createCodeInvite ครั้งเดียว — ไม่มีที่อื่น (log/audit/notification/รายการ)
//  - ใช้โค้ด: จองช่อง rate limit (IP แล้วผู้ใช้) "ก่อน" ตรวจโค้ด ด้วย UPSERT เดียวมีเพดาน (reserveBucket) — ไม่มี check-then-act ·
//    ผิดทุกสาเหตุ (ไม่มี/หมดอายุ/เพิกถอน/กลุ่มถูกลบ/รูปผิด) ตอบ INVITE_INVALID ตัวเดียวกันทุกไบต์ · สำเร็จหรือเป็นสมาชิกอยู่แล้ว → คืนช่องที่จอง (นับเฉพาะที่ผิด)
//  - ชวนตรง: USER_NOT_FOUND (Q4) + 30/ชม./ผู้ใช้ นับทุกครั้งที่ลอง
//  - เข้ากลุ่ม (ใช้โค้ด/รับคำเชิญ): INSERT … SELECT เดียวที่ตรวจโค้ด/คำเชิญ + สมาชิก < 50 ในคำสั่งเดียวกัน
import { z } from 'zod';
import { findGroupById } from '@/lib/data/repos/group';
import { constraintKind } from '@/lib/data/repos/errors';
import {
  bumpCodeUses,
  closeDirectInvite,
  expireDueDirectInvites,
  findInviteById,
  findInviteInGroup,
  findUsableCodeInvite,
  hasDeclinedSince,
  insertCodeInviteIfRoom,
  insertDirectInvite,
  joinGroupWithCode,
  listActiveInvitesOfGroup,
  listPendingDirectInvitesFor,
  revokeInvite as revokeInviteRow,
} from '@/lib/data/repos/group-invite';
import { findMember, insertMemberIfRoom, listActiveMemberIds } from '@/lib/data/repos/group-member';
import { insertNotification } from '@/lib/data/repos/notification';
import { refundBucket, reserveBucket } from '@/lib/data/repos/rate-limit-bucket';
import { findUserById, findUserByUsernameNormalized } from '@/lib/data/repos/user';
import { normalizeUsername, USERNAME_MAX_INPUT } from '@/lib/auth/pin-rules';
import { ipHashOf, ipRateSpec, rateKey, type RateSpec } from '@/lib/auth/throttle';
import { authorize, can } from '@/lib/rbac/can';
import { isPolicyError } from '@/lib/rbac/errors';
import type { Actor, GroupCtx } from '@/lib/rbac/types';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/lib/shared/clock';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { GROUP_LIMITS } from '@/lib/shared/limits';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { DataCtx } from '../context';
import { formatInviteCode, generateInviteCode, hashInviteCode, inviteCodeHint, normalizeInviteCode } from '../invite-code';
import { notify } from '../notifications/notify';
import { loadGroupCtx } from '../policy-context';
import { toInviteDto, toPendingInviteDto, type CreatedCodeInviteDto, type InviteDto, type PendingInviteDto } from '../serializers/groups';
import { inTx, serialized } from '../tx';
import { asUser, audit, auditRead, NOTIFY_KIND } from './group-common';

// ───────── rate limit (ADR 0002 §3 — fixed window + reserve) ─────────
export const INVITE_RATE_LIMITS = {
  /** ใช้โค้ด: ต่อผู้ใช้ — นับเฉพาะที่ผิด (คืนช่องเมื่อสำเร็จ) */
  redeemUser: { prefix: 'redeem:u', limit: 10, windowMs: 15 * MINUTE_MS },
  /** ใช้โค้ด: ต่อ IP (HMAC) */
  redeemIp: { prefix: 'redeem:ip', limit: 30, windowMs: 15 * MINUTE_MS },
  /** ชวนตรง: 30 ครั้ง/ชม./ผู้ใช้ (Q4) — นับทุกครั้งที่ลอง */
  directUser: { prefix: 'invite:direct:u', limit: 30, windowMs: HOUR_MS },
} as const satisfies Record<string, RateSpec>;

/** ผู้รับปฏิเสธแล้ว ผู้ชวนคนเดิมชวนซ้ำในกลุ่มเดิมไม่ได้ 24 ชม. (กันสแปมผู้รับ) */
export const DIRECT_INVITE_COOLDOWN_MS = DAY_MS;

const limited = (windowEnd: number, now: number): AppError =>
  new AppError('RATE_LIMITED', undefined, { retryAfterSec: Math.max(1, Math.ceil((windowEnd - now) / 1000)) });

// ───────── input schemas ─────────
const idField = z.uuid();
export const groupInviteParamsSchema = z.object({ gid: idField, iid: idField });
export const myInviteParamsSchema = z.object({ iid: idField });

export const directInviteInputSchema = z.object({ username: z.string().min(1).max(USERNAME_MAX_INPUT) }).strict();
export type DirectInviteInput = z.output<typeof directInviteInputSchema>;

/** เพดาน 64 ตัวก่อน normalize (โค้ดจริง 9 ตัวรวมขีด) — ยาวกว่านี้ไม่ใช่โค้ดแน่ ๆ ตอบ VALIDATION ได้โดยไม่รั่วอะไร */
export const redeemInputSchema = z.object({ code: z.string().min(1).max(64) }).strict();
export type RedeemInput = z.output<typeof redeemInputSchema>;

const groupRes = (group: GroupCtx) => ({ type: 'group', group }) as const;

// ───────── สร้างโค้ด ─────────
export async function createCodeInvite(actor: Actor, groupId: string, ctx: DataCtx): Promise<{ invite: CreatedCodeInviteDto }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'invite.code.create', groupRes(group));
  const me = asUser(actor);
  const { now } = ctx;
  const expiresAt = now + GROUP_LIMITS.inviteTtlMs;
  const id = newId();

  const made = await inTx(ctx.db, async (tx) => {
    // ชน unique ของ code_hash (โอกาส ~10^-12 ต่อโค้ด) → สุ่มใหม่ · คำสั่งที่ล้มไม่ทำให้ transaction เสีย
    for (let attempt = 0; attempt < 3; attempt++) {
      const normalized = generateInviteCode();
      let outcome: 'ok' | 'full' | 'gone' | 'stale';
      try {
        outcome = await insertCodeInviteIfRoom(
          tx,
          { id, groupId, codeHash: hashInviteCode(normalized, ctx.appSecret), codeHint: inviteCodeHint(normalized), createdBy: me.id, expiresAt, cap: GROUP_LIMITS.activeCodesPerGroup },
          now,
          { actorId: me.id, actorRole: group.actorRole }, // ผู้สร้างต้องยังเป็นสมาชิก/ถือ role เดิมในคำสั่งเดียวกัน (ถูกลบกลางทาง → 'stale')
        );
      } catch (e) {
        if (constraintKind(e) === 'unique') continue;
        throw e;
      }
      if (outcome === 'full') throw new AppError('LIMIT_REACHED', { limit: 'codes', max: GROUP_LIMITS.activeCodesPerGroup });
      if (outcome === 'gone') throw new AppError('NOT_FOUND');
      if (outcome === 'stale') throw new AppError('CONFLICT');
      // audit ไม่มีโค้ด/hint (repo ปฏิเสธคีย์ที่มีคำว่า code อยู่แล้ว) — เก็บแค่ id ของคำเชิญ
      await audit(tx, me, allow, { action: 'invite.code.create', targetType: 'invite', targetId: id, groupId, meta: { inviteId: id } }, now);
      return normalized;
    }
    throw new AppError('UNKNOWN');
  });

  return { invite: { id, code: formatInviteCode(made), codeHint: inviteCodeHint(made), createdAt: now, expiresAt } };
}

// ───────── ชวนตรง ─────────
export async function createDirectInvite(actor: Actor, groupId: string, input: DirectInviteInput, ctx: DataCtx): Promise<{ invite: InviteDto }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'invite.direct.create', groupRes(group));
  const me = asUser(actor);
  const { now, db } = ctx;

  // จองช่อง 30/ชม. ก่อนค้นหา (รวมที่ค้นไม่เจอ) — UPSERT เดียวมีเพดาน
  const spec = INVITE_RATE_LIMITS.directUser;
  const slot = await serialized(db, () => reserveBucket(db, rateKey(spec, me.id), spec.windowMs, spec.limit, now));
  if (!slot.admitted) throw limited(slot.windowEnd, now);

  const invitee = await findUserByUsernameNormalized(db, normalizeUsername(input.username));
  if (!invitee || invitee.status !== 'active') throw new AppError('USER_NOT_FOUND');
  if (await findMember(db, groupId, invitee.id)) throw new AppError('ALREADY_MEMBER');
  // คูลดาวน์: ผู้รับเพิ่งปฏิเสธคำเชิญของกลุ่มนี้ (จากผู้ชวนคนใดก็ได้) ภายใน 24 ชม. → ใครก็ชวนซ้ำไม่ได้ (409 CONFLICT — UI map เป็น alreadyInvited)
  if (await hasDeclinedSince(db, { groupId, inviteeUserId: invitee.id }, now - DIRECT_INVITE_COOLDOWN_MS)) throw new AppError('CONFLICT');

  const groupRow = await findGroupById(db, groupId);
  const inviter = await findUserById(db, me.id);
  if (!groupRow || groupRow.deletedAt !== null || !inviter) throw new AppError('NOT_FOUND');

  const id = newId();
  const expiresAt = now + GROUP_LIMITS.inviteTtlMs;
  const row = await inTx(db, async (tx) => {
    await expireDueDirectInvites(tx, groupId, invitee.id, now);
    const created = await insertDirectInvite(tx, { id, groupId, inviteeUserId: invitee.id, createdBy: me.id, expiresAt, inviteeCap: GROUP_LIMITS.pendingDirectInvitesPerInvitee }, now, { actorId: me.id, actorRole: group.actorRole }).catch((e: unknown) => {
      // มีคำเชิญ active ถึงคนเดียวกันในกลุ่มนี้อยู่แล้ว (group_invite_direct_active_uq)
      throw constraintKind(e) === 'unique' ? new AppError('CONFLICT') : e;
    });
    if (created === 'invitee_full') throw new AppError('LIMIT_REACHED', { limit: 'pendingInvites', max: GROUP_LIMITS.pendingDirectInvitesPerInvitee });
    if (!created) {
      // ผู้ชวนไม่ถือ role เดิมแล้ว (ถูกลบ/เปลี่ยน role กลางทาง) หรือกลุ่มถูกลบ
      const again = await findGroupById(tx, groupId);
      throw new AppError(again && again.deletedAt === null ? 'CONFLICT' : 'NOT_FOUND');
    }
    await insertNotification(
      tx,
      { id: newId(), userId: invitee.id, kind: NOTIFY_KIND.inviteReceived, params: { groupId, groupName: sanitizeDisplayText(groupRow.name), inviterName: sanitizeDisplayText(inviter.displayName), inviteId: id } },
      now,
    );
    await audit(tx, me, allow, { action: 'invite.direct.create', targetType: 'invite', targetId: id, groupId, meta: { inviteId: id, inviteeUserId: invitee.id } }, now);
    return created;
  });

  return {
    invite: toInviteDto({ ...row, codeHash: null, creatorName: inviter.displayName, inviteeName: invitee.displayName }),
  };
}

// ───────── รายการ + เพิกถอน ─────────
/**
 * invite.list: admin/mod/SA เห็นทุกแถว · MEM เห็นเฉพาะที่ตัวเองสร้าง — กรองที่ SQL (created_by) และตรวจซ้ำรายแถวด้วย can(…,'invite.revoke')
 * ตัดสินว่า "เห็นของคนอื่นได้ไหม" จาก policy (ถามว่าเพิกถอนของคนอื่นได้ไหม) ไม่เทียบ role เองในนี้
 */
export async function listInvites(actor: Actor, groupId: string, ctx: DataCtx): Promise<{ invites: InviteDto[] }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const allow = authorize(actor, 'invite.list', groupRes(group));
  const me = asUser(actor);
  const seesOthers = can(actor, 'invite.revoke', { type: 'invite', group, createdBy: OTHER_USER }).allow;
  const rows = await listActiveInvitesOfGroup(ctx.db, groupId, ctx.now, seesOthers ? {} : { createdBy: me.id });
  const visible = rows.filter((r) => can(actor, 'invite.revoke', { type: 'invite', group, createdBy: r.createdBy }).allow);
  await auditRead(ctx.db, me, allow, { action: 'invite.list', targetType: 'group', targetId: groupId, groupId }, ctx.now);
  return { invites: visible.map(toInviteDto) };
}
/** ค่าที่ไม่ตรงกับ user id ใด ๆ — ใช้ถาม policy ว่า "ของคนอื่น" เพิกถอนได้ไหม */
const OTHER_USER = '\u0000other';

export async function revokeInvite(actor: Actor, groupId: string, inviteId: string, ctx: DataCtx): Promise<{ revoked: true }> {
  const group = await loadGroupCtx(ctx.db, actor, groupId);
  const invite = group.deleted ? null : await findInviteInGroup(ctx.db, groupId, inviteId);
  if (!invite) {
    authorize(actor, 'group.view', groupRes(group)); // คนนอกกลุ่ม/กลุ่มไม่มี → NOT_FOUND เหมือนกัน
    throw new AppError('NOT_FOUND');
  }
  const allow = authorize(actor, 'invite.revoke', { type: 'invite', group, createdBy: invite.createdBy });
  const me = asUser(actor);
  const { now } = ctx;
  await inTx(ctx.db, async (tx) => {
    const done = await revokeInviteRow(tx, groupId, inviteId, me.id, now, { actorId: me.id, actorRole: group.actorRole });
    if (!done) {
      // เพิกถอนไปแล้ว = สำเร็จ (idempotent) · ถูกใช้/ตอบ/หมดอายุไปแล้ว = CONFLICT
      const again = await findInviteInGroup(tx, groupId, inviteId);
      if (again?.status === 'revoked') return;
      throw new AppError('CONFLICT'); // ถูกใช้/ตอบ/หมดอายุไปแล้ว หรือผู้เพิกถอนไม่ถือ role เดิมแล้ว
    }
    await audit(tx, me, allow, { action: 'invite.revoke', targetType: 'invite', targetId: inviteId, groupId, meta: { inviteId, kind: invite.kind } }, now);
  });
  return { revoked: true };
}

// ───────── ใช้โค้ด ─────────
export type RedeemResult = { groupId: string; groupName: string; alreadyMember: boolean };

export async function redeemInviteCode(actor: Actor, input: RedeemInput, ctx: DataCtx): Promise<RedeemResult> {
  const allow = authorize(actor, 'invite.code.redeem', { type: 'none' });
  const me = asUser(actor);
  const { db, now } = ctx;

  // 1) จองช่อง: IP ก่อน แล้วผู้ใช้ (ผู้ใช้เต็ม → คืนช่อง IP) — ก่อนแตะโค้ดใด ๆ
  const ipSpec = ipRateSpec(INVITE_RATE_LIMITS.redeemIp, ctx.req);
  const ipKey = rateKey(ipSpec, ipHashOf(ctx.req, ctx.appSecret));
  const userSpec = INVITE_RATE_LIMITS.redeemUser;
  const userKey = rateKey(userSpec, me.id);
  const ip = await serialized(db, () => reserveBucket(db, ipKey, ipSpec.windowMs, ipSpec.limit, now));
  if (!ip.admitted) throw limited(ip.windowEnd, now);
  const usr = await serialized(db, () => reserveBucket(db, userKey, userSpec.windowMs, userSpec.limit, now));
  if (!usr.admitted) {
    await serialized(db, () => refundBucket(db, ipKey, ipSpec.windowMs, now));
    throw limited(usr.windowEnd, now);
  }
  const refund = () =>
    serialized(db, async () => {
      await refundBucket(db, ipKey, ipSpec.windowMs, now);
      await refundBucket(db, userKey, userSpec.windowMs, now);
    });

  // 2) รูปผิด = ไม่ใช่โค้ด → INVITE_INVALID (ช่องที่จองไว้ไม่คืน)
  const normalized = normalizeInviteCode(input.code);
  if (!normalized) throw new AppError('INVITE_INVALID');
  const codeHash = hashInviteCode(normalized, ctx.appSecret);

  // 3) เข้ากลุ่มด้วยคำสั่งเดียว (โค้ดใช้ได้ + กลุ่มยังอยู่ + ยังไม่เป็นสมาชิก + สมาชิก < 50) — วินิจฉัยเมื่อไม่ได้แถว
  const result = await inTx(db, async (tx): Promise<RedeemResult & { joined: boolean }> => {
    const joinedGroupId = await joinGroupWithCode(tx, { codeHash, userId: me.id, cap: GROUP_LIMITS.membersPerGroup }, now);
    const usable = await findUsableCodeInvite(tx, codeHash, now);
    if (joinedGroupId) {
      if (usable) await bumpCodeUses(tx, usable.id);
      const g = await findGroupById(tx, joinedGroupId);
      // R11 §1: เข้าใหม่จริงเท่านั้น (สาขานี้) → admin + moderator · ผู้เข้าเองไม่ได้รับ
      const joiner = await findUserById(tx, me.id);
      await notify(
        tx,
        {
          userIds: (await listActiveMemberIds(tx, joinedGroupId, { roles: ['admin', 'moderator'] })).filter((uid) => uid !== me.id),
          kind: 'group.member.joined',
          params: { groupId: joinedGroupId, groupName: sanitizeDisplayText(g?.name ?? ''), memberName: sanitizeDisplayText(joiner?.displayName ?? ''), memberId: me.id },
        },
        now,
      );
      await audit(tx, me, allow, { action: 'invite.code.redeem', targetType: 'invite', targetId: usable?.id ?? joinedGroupId, groupId: joinedGroupId, meta: { inviteId: usable?.id ?? null } }, now);
      return { groupId: joinedGroupId, groupName: g?.name ?? '', alreadyMember: false, joined: true };
    }
    if (!usable) throw new AppError('INVITE_INVALID'); // ไม่มี/หมดอายุ/เพิกถอน/กลุ่มถูกลบ — ตอบเหมือนกันหมด
    const g = await findGroupById(tx, usable.groupId);
    if (await findMember(tx, usable.groupId, me.id)) {
      return { groupId: usable.groupId, groupName: g?.name ?? '', alreadyMember: true, joined: false }; // สมาชิกเดิม → 200 ไม่สร้างแถว
    }
    throw new AppError('LIMIT_REACHED', { limit: 'members', max: GROUP_LIMITS.membersPerGroup });
  }).catch(async (e: unknown) => {
    // โค้ดถูกต้องแต่กลุ่มเต็ม = ไม่ใช่การเดา → คืนช่อง · INVITE_INVALID / ข้อผิดพลาดอื่น คงช่องที่จองไว้
    if (e instanceof AppError && e.code === 'LIMIT_REACHED') await refund();
    throw e;
  });
  await refund(); // สำเร็จ/เป็นสมาชิกอยู่แล้ว: นับเฉพาะครั้งที่ผิด
  return { groupId: result.groupId, groupName: result.groupName, alreadyMember: result.alreadyMember };
}

// ───────── คำเชิญตรงของฉัน ─────────
export async function listMyInvites(actor: Actor, ctx: DataCtx): Promise<{ invites: PendingInviteDto[] }> {
  authorize(actor, 'invite.direct.list.mine', { type: 'none' });
  return { invites: (await listPendingDirectInvitesFor(ctx.db, asUser(actor).id, ctx.now, GROUP_LIMITS.myInvitesListMax)).map(toPendingInviteDto) };
}

/**
 * รับ/ปฏิเสธคำเชิญตรง — ของคนอื่น/ไม่มี/หมดอายุ/เพิกถอน/กลุ่มถูกลบ → NOT_FOUND · ตอบไปแล้ว → CONFLICT
 * (rbac ตอบ FORBIDDEN เมื่อไม่ใช่ผู้รับ — ที่นี่แปลงเป็น NOT_FOUND ไม่ให้ยืนยันว่า id ของคำเชิญนั้นมีอยู่)
 */
export async function respondToDirectInvite(
  actor: Actor,
  inviteId: string,
  decision: 'accept' | 'decline',
  ctx: DataCtx,
): Promise<{ groupId: string; alreadyMember: boolean } | { declined: true }> {
  const invite = actor.kind === 'user' ? await findInviteById(ctx.db, inviteId) : null;
  const owned = invite?.kind === 'direct' && actor.kind === 'user' && invite.inviteeUserId === actor.id;
  let allow;
  try {
    allow = authorize(actor, 'invite.direct.respond', { type: 'directInvite', inviteeUserId: owned && invite ? invite.inviteeUserId! : (actor.kind === 'user' ? actor.id : '') });
  } catch (e) {
    if (isPolicyError(e) && e.code === 'FORBIDDEN') throw new AppError('NOT_FOUND');
    throw e;
  }
  if (!owned || !invite) throw new AppError('NOT_FOUND');
  const me = asUser(actor);
  const { now } = ctx;
  const to = decision === 'accept' ? 'accepted' : 'declined';

  return inTx(ctx.db, async (tx) => {
    const closed = await closeDirectInvite(tx, { inviteId, inviteeUserId: me.id, to }, now);
    if (!closed) {
      const again = await findInviteById(tx, inviteId);
      throw new AppError(again && (again.status === 'accepted' || again.status === 'declined') ? 'CONFLICT' : 'NOT_FOUND');
    }
    const groupRow = await findGroupById(tx, closed.groupId);
    const me2 = await findUserById(tx, me.id);
    const params = { groupId: closed.groupId, groupName: sanitizeDisplayText(groupRow?.name ?? ''), inviteeName: sanitizeDisplayText(me2?.displayName ?? ''), inviteId };
    let alreadyMember = false;
    if (decision === 'accept') {
      const joined = await insertMemberIfRoom(tx, { groupId: closed.groupId, userId: me.id, cap: GROUP_LIMITS.membersPerGroup }, now);
      if (joined === 'full') throw new AppError('LIMIT_REACHED', { limit: 'members', max: GROUP_LIMITS.membersPerGroup }); // rollback: คำเชิญยังค้างอยู่
      if (joined === 'gone') throw new AppError('NOT_FOUND');
      alreadyMember = joined === 'already';
      // R11 §1: เป็นสมาชิกใหม่จริงเท่านั้น · admin + moderator ยกเว้นผู้เชิญ (ได้ group.invite.accepted แล้ว) และตัวผู้เข้าเอง
      if (joined === 'inserted') {
        await notify(
          tx,
          {
            userIds: (await listActiveMemberIds(tx, closed.groupId, { roles: ['admin', 'moderator'] })).filter((uid) => uid !== me.id && uid !== closed.createdBy),
            kind: 'group.member.joined',
            params: { groupId: closed.groupId, groupName: params.groupName, memberName: params.inviteeName, memberId: me.id },
          },
          now,
        );
      }
    }
    await insertNotification(
      tx,
      { id: newId(), userId: closed.createdBy, kind: decision === 'accept' ? NOTIFY_KIND.inviteAccepted : NOTIFY_KIND.inviteDeclined, params },
      now,
    );
    await audit(
      tx,
      me,
      allow,
      { action: 'invite.direct.respond', targetType: 'invite', targetId: inviteId, groupId: closed.groupId, meta: { inviteId, decision: to } },
      now,
    );
    return decision === 'accept' ? { groupId: closed.groupId, alreadyMember } : { declined: true as const };
  });
}
