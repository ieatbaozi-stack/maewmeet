/**
 * R14a (R14-5) — สิทธิ์ของ busy ประจำ (routine) ระดับ policy (ADR 0012 §6 · R14_CONTRACT §8)
 * สเปกเขียนด้วยมือ: เจ้าของเท่านั้น · SA / admin กลุ่ม / คนอื่น แก้/ลบ routine ของคนอื่นไม่ได้ ·
 * บัญชีที่ปิดแล้ว (suspended/deleted) / must_change_pin / ไม่ได้ล็อกอิน ทำอะไรไม่ได้เลย ·
 * ไม่มี action ดู routine ของคนอื่น (ไม่มี resource ที่รับ user id คนอื่นสำหรับ list)
 * resource ของ update/delete = { type: 'busy', ownerId: <routine.user_id> } (ใช้ชนิดเดิมของ busy)
 * ส่วนระดับ route (IDOR ด้วย id จริง → 404 เหมือน id ที่ไม่มี) อยู่ในเทสต์ integration ของ platform/test
 */
import { describe, expect, it } from 'vitest';

import { ACTIONS, ACTION_RESOURCE, PIN_CHANGE_ALLOWED, PUBLIC_ACTIONS, SUPER_ADMIN_AUDITED, SUPER_ADMIN_ONLY, isAction } from '@/lib/rbac/actions';
import { authorize, can } from '@/lib/rbac/can';
import { POLICY_STATUS, PolicyError, RbacMisuseError } from '@/lib/rbac/errors';
import type { AccountStatus, Actor, BusyResource, PolicyErrorCode, Resource } from '@/lib/rbac/types';

const ROUTINE_ACTIONS = ['busy.routine.list.own', 'busy.routine.create', 'busy.routine.update', 'busy.routine.delete'] as const;
type RoutineAction = (typeof ROUTINE_ACTIONS)[number];
const OWNER_ACTIONS = ['busy.routine.update', 'busy.routine.delete'] as const;
const SELF_ACTIONS = ['busy.routine.list.own', 'busy.routine.create'] as const;

type Who = 'OWNER' | 'OTHER' | 'SA' | 'SA_OWNER' | 'GA_OF_OWNER' | 'ANON';
const WHO: readonly Who[] = ['OWNER', 'OTHER', 'SA', 'SA_OWNER', 'GA_OF_OWNER', 'ANON'];
const OWNER_ID = 'u-owner';
const ID: Record<Exclude<Who, 'ANON'>, string> = {
  OWNER: OWNER_ID,
  OTHER: 'u-other',
  SA: 'u-sa',
  SA_OWNER: OWNER_ID, // SA ที่เป็นเจ้าของ routine เอง
  GA_OF_OWNER: 'u-ga', // admin กลุ่มที่เจ้าของอยู่ — role ไม่มีผลกับ busy (ไม่ผูกกลุ่ม)
};

const actor = (w: Who, o: { status?: AccountStatus; mustChangePin?: boolean } = {}): Actor =>
  w === 'ANON'
    ? { kind: 'anonymous' }
    : {
        kind: 'user',
        id: ID[w],
        isSuperAdmin: w === 'SA' || w === 'SA_OWNER',
        status: o.status ?? 'active',
        mustChangePin: o.mustChangePin ?? false,
      };

const routineOf = (ownerId: string): BusyResource => ({ type: 'busy', ownerId });
const resFor = (a: RoutineAction): Resource => ((OWNER_ACTIONS as readonly string[]).includes(a) ? routineOf(OWNER_ID) : { type: 'none' });
const canA = (a: Actor, action: RoutineAction, r: Resource) =>
  (can as (a: Actor, x: string, r: Resource) => ReturnType<typeof can>)(a, action, r);
const dn = (code: PolicyErrorCode) => ({ allow: false, code, status: POLICY_STATUS[code] });
const OK = { allow: true, auditAsSuperAdmin: false };

describe('ชื่อ action และชนิด resource ตาม R14_CONTRACT §8', () => {
  it.each(ROUTINE_ACTIONS)('%s มีใน ACTIONS · ไม่ใช่ public / SA-only / audited / ทำได้ระหว่าง must_change_pin', (a) => {
    expect(isAction(a)).toBe(true);
    expect(ACTIONS).toContain(a);
    for (const list of [PUBLIC_ACTIONS, SUPER_ADMIN_ONLY, SUPER_ADMIN_AUDITED, PIN_CHANGE_ALLOWED] as readonly (readonly string[])[]) {
      expect(list.includes(a)).toBe(false);
    }
  });
  it('list/create ไม่รับ resource (ของตัวเองจาก session) · update/delete รับเฉพาะ busy (ownerId)', () => {
    expect(ACTION_RESOURCE['busy.routine.list.own']).toEqual(['none']);
    expect(ACTION_RESOURCE['busy.routine.create']).toEqual(['none']);
    expect(ACTION_RESOURCE['busy.routine.update']).toEqual(['busy']);
    expect(ACTION_RESOURCE['busy.routine.delete']).toEqual(['busy']);
  });
  it('ไม่มี action ดู routine ของคนอื่น: busy.routine.* มีแค่ 4 ตัวนี้', () => {
    expect(ACTIONS.filter((a) => a.startsWith('busy.routine.')).sort()).toEqual([...ROUTINE_ACTIONS].sort());
  });
  it('ส่ง resource ผิดชนิด → RbacMisuseError (fail closed)', () => {
    expect(() => canA(actor('OWNER'), 'busy.routine.update', { type: 'none' })).toThrow(RbacMisuseError);
    expect(() => canA(actor('OWNER'), 'busy.routine.delete', { type: 'ownedByUser', ownerId: OWNER_ID })).toThrow(RbacMisuseError);
    expect(() => canA(actor('OWNER'), 'busy.routine.create', routineOf(OWNER_ID))).toThrow(RbacMisuseError);
  });
});

describe('list.own / create — ผู้ใช้ที่ล็อกอินทุกคน (ของตัวเอง) · ไม่ติดธง audit แม้ SA', () => {
  it.each(SELF_ACTIONS.flatMap((a) => WHO.map((w) => [a, w] as const)))('%s × %s', (a, w) => {
    const d = can(actor(w), a, { type: 'none' });
    expect(d).toEqual(w === 'ANON' ? dn('AUTH_REQUIRED') : OK);
  });
});

describe('update / delete — เจ้าของเท่านั้น (IDOR · SA ไม่มีข้อยกเว้น)', () => {
  const EXPECT: Record<Who, ReturnType<typeof dn> | typeof OK> = {
    OWNER: OK,
    SA_OWNER: OK, // SA แก้ของตัวเองได้ตามปกติ ไม่ติดธง audit
    OTHER: dn('FORBIDDEN'), // service แปลงเป็น 404 เหมือน id ที่ไม่มี (IDOR แบบ busy เดี่ยว)
    SA: dn('FORBIDDEN'), // PRD §3 แถว 3: SA ก็แก้/ลบ routine ของคนอื่นไม่ได้
    GA_OF_OWNER: dn('FORBIDDEN'),
    ANON: dn('AUTH_REQUIRED'),
  };
  it.each(OWNER_ACTIONS.flatMap((a) => WHO.map((w) => [a, w] as const)))('%s × %s (routine ของ u-owner)', (a, w) => {
    expect(can(actor(w), a, routineOf(OWNER_ID))).toEqual(EXPECT[w]);
  });

  it('authorize() กับ routine ของคนอื่น → throw PolicyError FORBIDDEN (รวม SA)', () => {
    for (const w of ['OTHER', 'SA', 'GA_OF_OWNER'] as const) {
      for (const a of OWNER_ACTIONS) {
        expect(() => authorize(actor(w), a, routineOf(OWNER_ID)), `${a}/${w}`).toThrow(PolicyError);
        expect(() => authorize(actor(w), a, routineOf(OWNER_ID)), `${a}/${w}`).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
      }
    }
  });

  it('ownerId ที่ใกล้เคียงแต่ไม่ตรง (ตัวพิมพ์/ช่องว่าง/ว่าง) → FORBIDDEN', () => {
    for (const ownerId of ['U-OWNER', ' u-owner', 'u-owner ', '', 'u-owne']) {
      for (const a of OWNER_ACTIONS) expect(can(actor('OWNER'), a, routineOf(ownerId)), `${a}/${JSON.stringify(ownerId)}`).toEqual(dn('FORBIDDEN'));
    }
  });
});

describe('สถานะบัญชี × ทุก action routine (ด่านบัญชีมาก่อนกฎเจ้าของ — แม้เป็นเจ้าของ/SA)', () => {
  const USERS = WHO.filter((w) => w !== 'ANON');
  const cells = ROUTINE_ACTIONS.flatMap((a) => USERS.map((w) => [a, w] as const));

  it.each(cells)('suspended (บัญชีถูกปิด): %s × %s → ACCOUNT_SUSPENDED', (a, w) => {
    expect(canA(actor(w, { status: 'suspended' }), a, resFor(a))).toEqual(dn('ACCOUNT_SUSPENDED'));
  });
  it.each(cells)('deleted (บัญชีถูกลบ): %s × %s → AUTH_REQUIRED', (a, w) => {
    expect(canA(actor(w, { status: 'deleted' }), a, resFor(a))).toEqual(dn('AUTH_REQUIRED'));
  });
  it.each(cells)('must_change_pin: %s × %s → PIN_CHANGE_REQUIRED', (a, w) => {
    expect(canA(actor(w, { mustChangePin: true }), a, resFor(a))).toEqual(dn('PIN_CHANGE_REQUIRED'));
  });
  it('status ค่าแปลก (นอก union) → fail closed ทุก action', () => {
    for (const a of ROUTINE_ACTIONS) {
      const odd: Actor = { kind: 'user', id: OWNER_ID, isSuperAdmin: true, status: 'Active' as AccountStatus, mustChangePin: false };
      expect(canA(odd, a, resFor(a)).allow, a).toBe(false);
    }
  });
  it('actor ผิดรูป (ไม่ใช่ kind user) → เท่า anonymous', () => {
    for (const a of ROUTINE_ACTIONS) {
      expect(canA({ kind: 'admin' } as unknown as Actor, a, resFor(a)), a).toEqual(dn('AUTH_REQUIRED'));
    }
  });
});
