/**
 * R3-6 — เมทริกซ์ RBAC เฉพาะแถว busy / ปฏิทินกลุ่ม (R3_CONTRACT §3, §5; ADR 0006 §1)
 * สเปกเขียนตรงนี้ด้วยมือ (ไม่คัดจาก can.ts) แล้ววนครบ: บทบาท × action × เจ้าของ × สถานะบัญชี/กลุ่ม
 *
 * ชื่อ action ตามระบบจริง (ACTIONS): busy.create · busy.list.own (= อ่านของตัวเอง) · busy.update · busy.delete ·
 * group.calendar.view (= calendar:read) — ADR 0006 ข้อ 1 อ้าง group.calendar.view ตรง ๆ
 */
import { describe, expect, it } from 'vitest';

import { ACTIONS, ACTION_RESOURCE, SUPER_ADMIN_ONLY, isAction } from '@/lib/rbac/actions';
import { can } from '@/lib/rbac/can';
import { POLICY_STATUS } from '@/lib/rbac/errors';
import type { Actor, AccountStatus, GroupCtx, GroupRole, PolicyErrorCode, Resource } from '@/lib/rbac/types';

const SPEC_ACTIONS = ['busy.create', 'busy.list.own', 'busy.update', 'busy.delete', 'group.calendar.view'] as const;

type Who = 'SA_nonmember' | 'SA_member' | 'GA' | 'MOD' | 'MEM' | 'REMOVED' | 'OUTSIDER' | 'ANON';
const WHO: readonly Who[] = ['SA_nonmember', 'SA_member', 'GA', 'MOD', 'MEM', 'REMOVED', 'OUTSIDER', 'ANON'];
// REMOVED = เคยเป็นสมาชิกแต่ถูกลบออก/ออกเอง → data layer ให้ actorRole = null เหมือนคนนอก (U6, ADR 0006 ข้อ 4)

const ROLE: Record<Who, GroupRole | null> = {
  SA_nonmember: null, SA_member: 'member', GA: 'admin', MOD: 'moderator', MEM: 'member', REMOVED: null, OUTSIDER: null, ANON: null,
};
const IS_SA = (w: Who) => w === 'SA_nonmember' || w === 'SA_member';
const ID = (w: Who) => `u-${w}`;

const actor = (w: Who, o: { status?: AccountStatus; mustChangePin?: boolean } = {}): Actor =>
  w === 'ANON'
    ? { kind: 'anonymous' }
    : { kind: 'user', id: ID(w), isSuperAdmin: IS_SA(w), status: o.status ?? 'active', mustChangePin: o.mustChangePin ?? false };

const grp = (w: Who, deleted = false): GroupCtx => ({ id: 'g1', deleted, actorRole: ROLE[w] });
/** เรียก can() แบบไม่ผูกชนิด action↔resource (เทสต์วนข้าม action) */
const canA = (a: Actor, action: (typeof SPEC_ACTIONS)[number], r: Resource) =>
  (can as (a: Actor, x: string, r: Resource) => ReturnType<typeof can>)(a, action, r);
const dn = (code: PolicyErrorCode) => ({ allow: false, code, status: POLICY_STATUS[code] });


describe('ชื่อ action ของ R3 อยู่ในระบบและชนิด resource ตรงสเปก', () => {
  it.each(SPEC_ACTIONS)('%s มีอยู่ใน ACTIONS และไม่ใช่ SA-only', (a) => {
    expect(isAction(a)).toBe(true);
    expect(ACTIONS).toContain(a);
    expect((SUPER_ADMIN_ONLY as readonly string[]).includes(a)).toBe(false);
  });
  it('ชนิด resource', () => {
    expect(ACTION_RESOURCE['busy.create']).toEqual(['none']);
    expect(ACTION_RESOURCE['busy.list.own']).toEqual(['none']);
    expect(ACTION_RESOURCE['busy.update']).toEqual(['busy']);
    expect(ACTION_RESOURCE['busy.delete']).toEqual(['busy']);
    expect(ACTION_RESOURCE['group.calendar.view']).toEqual(['group']);
  });
  it('ไม่มี action ที่รับ user id คนอื่นแล้วคืน busy (ADR 0006 ข้อ 1): ไม่มีชื่อ busy.* อื่นนอก 4 ตัว', () => {
    expect(ACTIONS.filter((a) => a.startsWith('busy.')).sort()).toEqual(['busy.create', 'busy.delete', 'busy.list.own', 'busy.update']);
  });
});

describe('busy.create / busy.list.own — ผู้ใช้ที่ล็อกอินทุกคน (ไม่ผูกกลุ่ม)', () => {
  const cells = (['busy.create', 'busy.list.own'] as const).flatMap((a) => WHO.map((w) => [a, w] as const));
  it.each(cells)('%s × %s', (a, w) => {
    const d = can(actor(w), a, { type: 'none' });
    if (w === 'ANON') expect(d).toEqual(dn('AUTH_REQUIRED'));
    else expect(d).toEqual({ allow: true, auditAsSuperAdmin: false }); // SA ก็ไม่ติด audit: เป็นของตัวเอง
  });
});

describe('busy.update / busy.delete — เจ้าของเท่านั้น (ไม่มีข้อยกเว้นให้ SA/admin กลุ่ม)', () => {
  const cells = (['busy.update', 'busy.delete'] as const).flatMap((a) =>
    WHO.flatMap((w) => (['own', 'other'] as const).map((own) => [a, w, own] as const)),
  );
  it.each(cells)('%s × %s × %s', (a, w, own) => {
    const res: Resource = { type: 'busy', ownerId: own === 'own' ? ID(w) : 'u-someone-else' };
    const d = can(actor(w), a, res);
    if (w === 'ANON') expect(d).toEqual(dn('AUTH_REQUIRED'));
    else if (own === 'own') expect(d).toEqual({ allow: true, auditAsSuperAdmin: false });
    else expect(d).toEqual(dn('FORBIDDEN')); // service แปลงเป็น 404 เพื่อไม่ยืนยันว่า id มีอยู่ (R3-3)
  });
  it('เป็นเจ้าของกลุ่ม/admin/SA ก็แก้ busy ของสมาชิกไม่ได้', () => {
    for (const w of ['SA_nonmember', 'SA_member', 'GA', 'MOD'] as const)
      for (const a of ['busy.update', 'busy.delete'] as const)
        expect(can(actor(w), a, { type: 'busy', ownerId: 'u-member' })).toEqual(dn('FORBIDDEN'));
  });
});

describe('group.calendar.view — สมาชิกทุก role · SA ทุกกลุ่ม (audit ถ้าไม่ใช่สมาชิก) · อื่น ๆ 404', () => {
  const cells = WHO.flatMap((w) => ([false, true] as const).map((deleted) => [w, deleted] as const));
  it.each(cells)('%s × กลุ่มถูกลบ=%s', (w, deleted) => {
    const d = can(actor(w), 'group.calendar.view', { type: 'group', group: grp(w, deleted) });
    if (w === 'ANON') return expect(d).toEqual(dn('AUTH_REQUIRED'));
    if (deleted) return expect(d).toEqual(dn('NOT_FOUND')); // แม้ SA/admin — ข้อ 5 ADR 0006
    if (w === 'OUTSIDER' || w === 'REMOVED') return expect(d).toEqual(dn('NOT_FOUND')); // 404 ไม่ใช่ 403
    expect(d).toEqual({ allow: true, auditAsSuperAdmin: w === 'SA_nonmember' });
  });
  it('REMOVED/ออกกลุ่ม: หายทันที — ก่อนถอด ผ่าน หลังถอด 404 (U6)', () => {
    const base = actor('MEM');
    expect(can(base, 'group.calendar.view', { type: 'group', group: { id: 'g1', deleted: false, actorRole: 'member' } }).allow).toBe(true);
    expect(can(base, 'group.calendar.view', { type: 'group', group: { id: 'g1', deleted: false, actorRole: null } })).toEqual(dn('NOT_FOUND'));
  });
});

describe('สถานะบัญชี × ทุก action ของ R3 (ด่านก่อนกฎ action)', () => {
  const resFor = (a: (typeof SPEC_ACTIONS)[number], w: Who): Resource =>
    a === 'group.calendar.view'
      ? { type: 'group', group: grp(w) }
      : a === 'busy.update' || a === 'busy.delete'
        ? { type: 'busy', ownerId: ID(w) }
        : { type: 'none' };
  const USERS = WHO.filter((w) => w !== 'ANON');
  const cells = SPEC_ACTIONS.flatMap((a) => USERS.map((w) => [a, w] as const));

  it.each(cells)('suspended: %s × %s → ACCOUNT_SUSPENDED (401)', (a, w) => {
    expect(canA(actor(w, { status: 'suspended' }), a, resFor(a, w))).toEqual(dn('ACCOUNT_SUSPENDED'));
  });
  it.each(cells)('deleted: %s × %s → AUTH_REQUIRED', (a, w) => {
    expect(canA(actor(w, { status: 'deleted' }), a, resFor(a, w))).toEqual(dn('AUTH_REQUIRED'));
  });
  it.each(cells)('must_change_pin: %s × %s → PIN_CHANGE_REQUIRED (ทุก route ใหม่, แม้ SA)', (a, w) => {
    expect(canA(actor(w, { mustChangePin: true }), a, resFor(a, w))).toEqual(dn('PIN_CHANGE_REQUIRED'));
  });
  it.each(cells)('suspended มาก่อน must_change_pin: %s × %s', (a, w) => {
    expect(canA(actor(w, { status: 'suspended', mustChangePin: true }), a, resFor(a, w))).toEqual(dn('ACCOUNT_SUSPENDED'));
  });
  it('ด่านบัญชีชนะ "กลุ่มถูกลบ/คนนอก" (ไม่เฉลยว่ากลุ่มมีอยู่)', () => {
    expect(can(actor('OUTSIDER', { mustChangePin: true }), 'group.calendar.view', { type: 'group', group: grp('OUTSIDER', true) })).toEqual(dn('PIN_CHANGE_REQUIRED'));
  });
});

describe('ผลลัพธ์ปฏิเสธ → HTTP status ตามสเปก', () => {
  it('คนนอก/ถูกลบออก/กลุ่มลบ = 404 · busy ของคนอื่น = 403 ใน policy (service → 404) · anonymous = 401', () => {
    expect(dn('NOT_FOUND').status).toBe(404);
    expect(dn('FORBIDDEN').status).toBe(403);
    expect(dn('AUTH_REQUIRED').status).toBe(401);
    expect(dn('PIN_CHANGE_REQUIRED').status).toBe(403);
  });
});
