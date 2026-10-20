/**
 * R2-6 — IDOR ข้ามกลุ่ม: actor เป็นสมาชิกของกลุ่ม A แต่ของ (สมาชิก/โค้ดเชิญ/นัด) อยู่กลุ่ม B → 404 (ไม่ใช่ 403)
 * ครอบคลุม 2 ชั้น:
 *  1) can(): ctx ของกลุ่ม B ที่ actor ไม่ได้อยู่ → NOT_FOUND กับทุก action ผูกกลุ่ม
 *  2) canInGroup()/authorizeInGroup(): `:gid` ใน URL (กลุ่ม A ที่ actor เป็นสมาชิก) ไม่ตรงกับกลุ่มของของที่โหลดมา → NOT_FOUND
 *     แม้ ctx ที่ผู้เรียกประกอบให้ผิด (ใส่ role ของกลุ่ม A ในของกลุ่ม B) — กันบั๊กประกอบ ctx จาก URL แทนจากแถว
 */
import { describe, expect, it } from 'vitest';

import { ACTIONS, ACTION_RESOURCE, type Action } from '@/lib/rbac/actions';
import { authorizeInGroup, can, canInGroup } from '@/lib/rbac/can';
import { PolicyError } from '@/lib/rbac/errors';
import type { Actor, GroupCtx, GroupRole, Resource, UserActor } from '@/lib/rbac/types';

const GROUP_BOUND = ACTIONS.filter((a) => (ACTION_RESOURCE[a] as readonly string[]).some((t) => ['group', 'member', 'invite', 'appointment'].includes(t)));

const user = (id: string, isSuperAdmin = false): UserActor => ({ kind: 'user', id, isSuperAdmin, status: 'active', mustChangePin: false });
const ctx = (id: string, actorRole: GroupRole | null, deleted = false): GroupCtx => ({ id, deleted, actorRole });

/** resource ทุกชนิดที่ action นั้นรับ ในกลุ่มที่กำหนด — เลือกชนิดแรกที่ผูกกลุ่ม */
function resourceIn(action: Action, group: GroupCtx, createdBy = 'someone'): Resource {
  const type = (ACTION_RESOURCE[action] as readonly string[]).find((t) => ['group', 'member', 'invite', 'appointment'].includes(t));
  switch (type) {
    case 'group':
      return { type: 'group', group };
    case 'member':
      return { type: 'member', group, targetUserId: 'victim', targetRole: 'member' };
    case 'invite':
      return { type: 'invite', group, createdBy };
    case 'appointment':
      return { type: 'appointment', group, createdBy };
    default:
      throw new Error(`not group bound: ${action}`);
  }
}

const canAny = (a: Actor, x: Action, r: Resource) => (can as (a: Actor, x: Action, r: Resource) => ReturnType<typeof can>)(a, x, r);
const canInGroupAny = (a: Actor, x: Action, r: Resource, gid: string) =>
  (canInGroup as (a: Actor, x: Action, r: Resource, g: string) => ReturnType<typeof canInGroup>)(a, x, r, gid);

const ROLES_IN_A = ['admin', 'moderator', 'member'] as const;
const NOT_FOUND = { allow: false, code: 'NOT_FOUND', status: 404 };

describe('IDOR ข้ามกลุ่ม ชั้น 1: ของอยู่กลุ่ม B ที่ actor ไม่ได้เป็นสมาชิก (ctx โหลดถูกต้อง)', () => {
  it.each(ROLES_IN_A.flatMap((role) => GROUP_BOUND.map((a) => [`${a} (สมาชิก A เป็น ${role})`, a] as const)))(
    '%s → 404',
    (_n, action) => {
      const d = canAny(user('u-a'), action, resourceIn(action, ctx('g-B', null), 'u-a'));
      expect(d).toEqual(NOT_FOUND);
    },
  );

  it('ไม่ใช่ 403 ทุกกรณี (ไม่ยืนยันว่ากลุ่ม B มีอยู่)', () => {
    for (const a of GROUP_BOUND) {
      const d = canAny(user('u-a'), a, resourceIn(a, ctx('g-B', null)));
      expect(d.allow ? 'allow' : d.status, a).toBe(404);
    }
  });
});

describe('IDOR ข้ามกลุ่ม ชั้น 2: :gid ใน URL = กลุ่ม A, ของอยู่กลุ่ม B (canInGroup)', () => {
  // ตัวอย่างบั๊กที่ต้องกัน: ผู้เรียกประกอบ ctx ของกลุ่ม B ด้วย role ที่ actor มีในกลุ่ม A
  it.each(ROLES_IN_A.flatMap((role) => GROUP_BOUND.map((a) => [`${a} (ctx role ผิด=${role})`, a, role] as const)))(
    '%s → 404',
    (_n, action, role) => {
      const wrongCtxResource = resourceIn(action, ctx('g-B', role), 'u-a');
      expect(canInGroupAny(user('u-a'), action, wrongCtxResource, 'g-A')).toEqual(NOT_FOUND);
    },
  );

  it('super admin ก็ได้ 404 เมื่อของไม่อยู่ใน :gid ของ URL (ไม่ใช่ช่องโหว่ให้ข้ามกลุ่ม)', () => {
    for (const a of GROUP_BOUND) {
      expect(canInGroupAny(user('sa', true), a, resourceIn(a, ctx('g-B', 'admin')), 'g-A'), a).toEqual(NOT_FOUND);
    }
  });

  it('กลุ่มตรงกัน → ตัดสินเหมือน can() ทุกประการ', () => {
    for (const role of ROLES_IN_A) {
      for (const a of GROUP_BOUND) {
        const r = resourceIn(a, ctx('g-A', role), 'u-a');
        expect(canInGroupAny(user('u-a'), a, r, 'g-A'), `${a}/${role}`).toEqual(canAny(user('u-a'), a, r));
      }
    }
  });

  it('ด่านบัญชีมาก่อน: anonymous → 401, suspended → 401, must_change_pin → 403 (ไม่ถูกแทนด้วย 404)', () => {
    const r = resourceIn('invite.revoke', ctx('g-B', 'admin'));
    expect(canInGroupAny({ kind: 'anonymous' }, 'invite.revoke', r, 'g-A')).toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(canInGroupAny({ ...user('u'), status: 'suspended' }, 'invite.revoke', r, 'g-A')).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    expect(canInGroupAny({ ...user('u'), mustChangePin: true }, 'invite.revoke', r, 'g-A')).toMatchObject({ code: 'PIN_CHANGE_REQUIRED' });
  });

  it('resource ที่ไม่ผูกกลุ่มส่งเข้า canInGroup = บั๊กผู้เรียก → throw', () => {
    expect(() => canInGroupAny(user('u'), 'group.create', { type: 'none' }, 'g-A')).toThrow();
  });
});

describe('IDOR: ตัวอย่างสถานการณ์จริง (โค้ดเชิญ/สมาชิกของกลุ่มอื่น)', () => {
  it('admin ของ A เพิกถอนโค้ดของ B ผ่าน /groups/A/invites/<id ของ B> → 404', () => {
    expect(() =>
      authorizeInGroup(user('ga-a'), 'invite.revoke', { type: 'invite', group: ctx('g-B', 'admin'), createdBy: 'ga-a' }, 'g-A'),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }));
  });

  it('moderator ของ A ลบสมาชิกของ B ผ่าน /groups/A/members/<uid ใน B> → 404 และ error เป็น PolicyError', () => {
    let caught: unknown;
    try {
      authorizeInGroup(user('mod-a'), 'member.remove', { type: 'member', group: ctx('g-B', 'moderator'), targetUserId: 'x', targetRole: 'member' }, 'g-A');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PolicyError);
    expect(caught).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('สมาชิกของ A + ctx ของ B ถูกต้อง (ไม่ใช่สมาชิก) + URL ของ B → 404 (ไม่ใช่ 403)', () => {
    expect(canInGroupAny(user('u-a'), 'group.transferAdmin', resourceIn('group.transferAdmin', ctx('g-B', null)), 'g-B')).toEqual(NOT_FOUND);
  });
});
