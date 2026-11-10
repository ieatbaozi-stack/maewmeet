/**
 * R4B-2 — เมทริกซ์ RBAC ของนัด / RSVP / รายการนัดของฉัน / แจ้งเตือน (ค้นหาสถานที่ลบใน R13)
 * (PRD §3 แถว "สร้างนัด (D4)", "แก้/ยกเลิกนัด (D4)", "RSVP"; ADR 0003 ตารางแถว 9–11 + ตาราง action ผูกผู้ใช้; R4B_CONTRACT §5 R4B-2)
 *
 * สเปกเขียนมือตรงนี้ (ไม่คัดจาก can.ts): persona × action × ความเป็นผู้สร้าง × สถานะบัญชี/กลุ่ม
 *
 * หมายเหตุขอบเขตของ can(): `AppointmentResource` ไม่มีฟิลด์ status/เวลา — การห้าม update/cancel/rsvp นัดที่ "ยกเลิกแล้ว"
 * และ rsvp นัดที่ "ผ่านแล้ว" เป็นกฎธุรกิจของ service (หลังผ่าน authorize) ไม่ใช่ของ can(). เทสต์ที่นี่ยืนยันว่า can() "ไม่แยก"
 * สถานะนัด (ผู้มีสิทธิ์ยังได้ allow เพื่อให้ service ตอบรหัสธุรกิจเอง) และไม่ให้ผู้ไม่มีสิทธิ์ได้ข้อมูลสถานะนัด
 * (คนนอกยัง 404 ไม่ว่านัดจะยกเลิก/ผ่านแล้วหรือไม่)
 */
import { describe, expect, it } from 'vitest';

import { ACTIONS, ACTION_RESOURCE, SUPER_ADMIN_ONLY, PIN_CHANGE_ALLOWED, PUBLIC_ACTIONS, isAction } from '@/lib/rbac/actions';
import { authorize, authorizeInGroup, can, canInGroup } from '@/lib/rbac/can';
import { PolicyError, POLICY_STATUS, RbacMisuseError } from '@/lib/rbac/errors';
import type { AccountStatus, Actor, GroupCtx, GroupRole, PolicyErrorCode, Resource } from '@/lib/rbac/types';

type Who = 'SA_nonmember' | 'SA_member' | 'GA' | 'MOD' | 'MEM' | 'REMOVED' | 'OUTSIDER' | 'ANON';
const WHO: readonly Who[] = ['SA_nonmember', 'SA_member', 'GA', 'MOD', 'MEM', 'REMOVED', 'OUTSIDER', 'ANON'];
// REMOVED = เคยเป็นสมาชิกแต่ถูกลบออก/ออกเอง → policy-context ให้ actorRole = null เหมือนคนนอก (U6)
const ROLE: Record<Who, GroupRole | null> = {
  SA_nonmember: null,
  SA_member: 'member',
  GA: 'admin',
  MOD: 'moderator',
  MEM: 'member',
  REMOVED: null,
  OUTSIDER: null,
  ANON: null,
};
const IS_SA = (w: Who) => w === 'SA_nonmember' || w === 'SA_member';
const ID = (w: Who) => `u-${w}`;

const actor = (w: Who, o: { status?: AccountStatus; mustChangePin?: boolean } = {}): Actor =>
  w === 'ANON'
    ? { kind: 'anonymous' }
    : {
        kind: 'user',
        id: ID(w),
        isSuperAdmin: IS_SA(w),
        status: o.status ?? 'active',
        mustChangePin: o.mustChangePin ?? false,
      };
const grp = (w: Who, o: { deleted?: boolean; id?: string } = {}): GroupCtx => ({
  id: o.id ?? 'g1',
  deleted: o.deleted ?? false,
  actorRole: ROLE[w],
});

type Creator = 'self' | 'other';
const apptRes = (w: Who, creator: Creator, o: { deleted?: boolean; gid?: string } = {}): Resource => ({
  type: 'appointment',
  group: grp(w, { deleted: o.deleted, id: o.gid }),
  createdBy: creator === 'self' ? ID(w) : 'u-someone-else',
});
const groupRes = (w: Who, o: { deleted?: boolean } = {}): Resource => ({
  type: 'group',
  group: grp(w, o),
});
const NONE: Resource = { type: 'none' };

/** เรียก can() ข้ามชนิด action↔resource (เทสต์วนข้าม action) */
const canA = (a: Actor, action: string, r: Resource) => (can as (a: Actor, x: string, r: Resource) => ReturnType<typeof can>)(a, action, r);

const OK = { allow: true, auditAsSuperAdmin: false } as const;
const OK_AUDITED = { allow: true, auditAsSuperAdmin: true } as const;
const dn = (code: PolicyErrorCode, status: 401 | 403 | 404 | 409) => ({
  allow: false,
  code,
  status,
});
// เขียนค่า status เป็นตัวเลขตรง ๆ (ARCHITECTURE §2) ไม่อ้าง POLICY_STATUS เพื่อให้เทสต์จับการเปลี่ยนแปลงตาราง
const D401_AUTH = dn('AUTH_REQUIRED', 401);
const D401_SUSP = dn('ACCOUNT_SUSPENDED', 401);
const D403_PIN = dn('PIN_CHANGE_REQUIRED', 403);
const D403 = dn('FORBIDDEN', 403);
const D404 = dn('NOT_FOUND', 404);

const APPT_ACTIONS = ['appointment.create', 'appointment.view', 'appointment.update', 'appointment.cancel', 'appointment.rsvp'] as const;
const OTHER_ACTIONS = ['appointment.list.mine', 'notification.list.own', 'notification.markRead.own'] as const;

describe('ชื่อ action / ชนิด resource / ชุดพิเศษ ของ R4B', () => {
  it('ทุก action อยู่ใน ACTIONS', () => {
    for (const a of [...APPT_ACTIONS, ...OTHER_ACTIONS]) expect(ACTIONS).toContain(a);
  });
  it('ชนิด resource ที่แต่ละ action รับ (เขียนมือ)', () => {
    expect(ACTION_RESOURCE['appointment.create']).toEqual(['group']);
    expect(ACTION_RESOURCE['appointment.view']).toEqual(['group', 'appointment']);
    expect(ACTION_RESOURCE['appointment.update']).toEqual(['appointment']);
    expect(ACTION_RESOURCE['appointment.cancel']).toEqual(['appointment']);
    expect(ACTION_RESOURCE['appointment.rsvp']).toEqual(['appointment']);
    expect(ACTION_RESOURCE['appointment.list.mine']).toEqual(['none']);
    expect(ACTION_RESOURCE['notification.list.own']).toEqual(['ownedByUser']);
    expect(ACTION_RESOURCE['notification.markRead.own']).toEqual(['ownedByUser']);
  });
  it('ไม่ใช่ public / SA-only / อนุญาตระหว่าง must_change_pin', () => {
    for (const a of [...APPT_ACTIONS, ...OTHER_ACTIONS]) {
      expect((PUBLIC_ACTIONS as readonly string[]).includes(a)).toBe(false);
      expect((SUPER_ADMIN_ONLY as readonly string[]).includes(a)).toBe(false);
      expect((PIN_CHANGE_ALLOWED as readonly string[]).includes(a)).toBe(false);
    }
  });
  it('ไม่มี action นัด/แจ้งเตือนอื่นแอบเพิ่ม (กัน action ที่ไม่มีเมทริกซ์)', () => {
    const family = ACTIONS.filter((a) => /^(appointment|notification|place)\./.test(a)).sort();
    expect(family).toEqual(
      [...APPT_ACTIONS, 'appointment.list.mine', 'notification.list.own', 'notification.markRead.own'].sort(),
    );
  });
  it('R13: ไม่มี action ตระกูล place.* เหลือ (route ค้นหาสถานที่ถูกลบ) · isAction ปฏิเสธชื่อเดิม', () => {
    expect(ACTIONS.filter((a) => a.startsWith('place.'))).toEqual([]);
    expect(isAction('place' + '.search')).toBe(false);
  });
});

/** ผลที่คาดของ appointment.create / appointment.view (ผูกกลุ่ม ไม่ดูผู้สร้าง) */
const GROUP_SCOPED_EXPECT: Record<Who, unknown> = {
  SA_nonmember: OK_AUDITED, // SA ใช้สิทธิ์ที่ role ไม่มี → ต้องลง audit
  SA_member: OK,
  GA: OK,
  MOD: OK,
  MEM: OK,
  REMOVED: D404, // ถูกลบออก = คนนอก (ไม่ยืนยันว่ากลุ่ม/นัดมีอยู่)
  OUTSIDER: D404,
  ANON: D401_AUTH,
};

describe('appointment.create / appointment.view (resource = group)', () => {
  const cells = (['appointment.create', 'appointment.view'] as const).flatMap((a) => WHO.map((w) => [a, w] as const));
  it.each(cells)('%s × %s', (a, w) => {
    expect(can(actor(w), a, groupRes(w) as never)).toEqual(GROUP_SCOPED_EXPECT[w]);
  });
  it.each(WHO.map((w) => [w] as const))('appointment.view บน resource นัด × %s (ผู้สร้างคนอื่น/ตัวเอง ไม่มีผล)', (w) => {
    for (const c of ['self', 'other'] as const)
      expect(can(actor(w), 'appointment.view', apptRes(w, c) as never)).toEqual(GROUP_SCOPED_EXPECT[w]);
  });
  it('super admin ที่ไม่ใช่สมาชิก: view ติดธง audit (PRD §3 กติกาเสริม) แต่สมาชิกจริงไม่ติด', () => {
    expect(can(actor('SA_nonmember'), 'appointment.view', apptRes('SA_nonmember', 'other') as never)).toEqual({
      allow: true,
      auditAsSuperAdmin: true,
    });
    for (const w of ['GA', 'MOD', 'MEM', 'SA_member'] as const)
      expect(can(actor(w), 'appointment.view', apptRes(w, 'other') as never)).toEqual({ allow: true, auditAsSuperAdmin: false });
  });
});

describe('appointment.update / appointment.cancel (D4: ผู้สร้าง + GA/MOD + SA)', () => {
  const expectFor = (w: Who, c: Creator): unknown => {
    switch (w) {
      case 'SA_nonmember':
        return OK_AUDITED;
      case 'SA_member':
        return c === 'self' ? OK : OK_AUDITED; // นัดคนอื่น = ใช้สิทธิ์ SA (member ธรรมดาไม่มี) → audit
      case 'GA':
        return OK;
      case 'MOD':
        return OK; // รวมนัดที่ GA สร้าง
      case 'MEM':
        return c === 'self' ? OK : D403; // sentinel: เห็นนัดได้ จึง 403 ไม่ใช่ 404
      case 'REMOVED':
        return D404; // แม้เคยเป็นผู้สร้างนัดนี้เอง
      case 'OUTSIDER':
        return D404;
      case 'ANON':
        return D401_AUTH;
    }
  };
  const cells = (['appointment.update', 'appointment.cancel'] as const).flatMap((a) =>
    WHO.flatMap((w) => (['self', 'other'] as const).map((c) => [a, w, c] as const)),
  );
  it.each(cells)('%s × %s × ผู้สร้าง=%s', (a, w, c) => {
    expect(can(actor(w), a, apptRes(w, c) as never)).toEqual(expectFor(w, c));
  });

  it('SENTINEL: member แก้/ยกเลิกนัดของคนอื่น → FORBIDDEN/403 ส่วนคนนอก → NOT_FOUND/404 (สองกรณีต้องต่างกัน)', () => {
    for (const a of ['appointment.update', 'appointment.cancel'] as const) {
      const memOther = can(actor('MEM'), a, apptRes('MEM', 'other') as never);
      const outsider = can(actor('OUTSIDER'), a, apptRes('OUTSIDER', 'other') as never);
      expect(memOther).toEqual({
        allow: false,
        code: 'FORBIDDEN',
        status: 403,
      });
      expect(outsider).toEqual({
        allow: false,
        code: 'NOT_FOUND',
        status: 404,
      });
      expect(memOther).not.toEqual(outsider);
    }
  });
  it('MOD แก้นัดของ GA และ GA แก้นัดของ MOD ได้ (D4 ไม่มีลำดับชั้นระหว่างกัน)', () => {
    expect(
      can(actor('MOD'), 'appointment.update', {
        type: 'appointment',
        group: grp('MOD'),
        createdBy: ID('GA'),
      }),
    ).toEqual(OK);
    expect(
      can(actor('GA'), 'appointment.cancel', {
        type: 'appointment',
        group: grp('GA'),
        createdBy: ID('MOD'),
      }),
    ).toEqual(OK);
  });
  it('ผู้สร้างที่ถูกลดจาก MOD เป็น member ยังแก้นัดของตัวเองได้ แต่ของ MOD คนอื่นไม่ได้', () => {
    expect(
      can(actor('MEM'), 'appointment.update', {
        type: 'appointment',
        group: grp('MEM'),
        createdBy: ID('MEM'),
      }),
    ).toEqual(OK);
    expect(
      can(actor('MEM'), 'appointment.update', {
        type: 'appointment',
        group: grp('MEM'),
        createdBy: ID('MOD'),
      }),
    ).toEqual(D403);
  });
});

describe('appointment.rsvp (สมาชิกปัจจุบันเท่านั้น · SA ที่ไม่ใช่สมาชิก ❌ FORBIDDEN)', () => {
  const EXPECT: Record<Who, unknown> = {
    SA_nonmember: D403, // PRD §3: ไม่ RSVP · เห็นกลุ่มได้ จึง 403 ไม่ใช่ 404
    SA_member: OK, // เป็นสมาชิกจริง → ไม่ใช่การใช้สิทธิ์ SA → ไม่ audit
    GA: OK,
    MOD: OK,
    MEM: OK,
    REMOVED: D404,
    OUTSIDER: D404,
    ANON: D401_AUTH,
  };
  it.each(WHO.flatMap((w) => (['self', 'other'] as const).map((c) => [w, c] as const)))('%s × ผู้สร้าง=%s', (w, c) => {
    expect(can(actor(w), 'appointment.rsvp', apptRes(w, c) as never)).toEqual(EXPECT[w]);
  });
  it('ผู้สร้างนัด RSVP ของตัวเองได้ (สัญญา R4B: รวมผู้สร้าง)', () => {
    expect(can(actor('MEM'), 'appointment.rsvp', apptRes('MEM', 'self') as never)).toEqual(OK);
  });
});

describe('กลุ่มถูกลบ → NOT_FOUND ทุกคน รวม SA (ADR 0003 §2 ข้อ 5)', () => {
  const live: Who[] = ['SA_nonmember', 'SA_member', 'GA', 'MOD', 'MEM', 'OUTSIDER', 'REMOVED'];
  const cells = APPT_ACTIONS.flatMap((a) => live.map((w) => [a, w] as const));
  it.each(cells)('%s × %s (กลุ่มถูกลบ)', (a, w) => {
    const r = a === 'appointment.create' ? groupRes(w, { deleted: true }) : apptRes(w, 'self', { deleted: true });
    expect(canA(actor(w), a, r)).toEqual(D404);
  });
  it('anonymous ได้ 401 ก่อนเสมอ แม้กลุ่มถูกลบ (ไม่รั่วว่ากลุ่มถูกลบ)', () => {
    for (const a of APPT_ACTIONS)
      expect(
        canA(
          actor('ANON'),
          a,
          a === 'appointment.create' ? groupRes('ANON', { deleted: true }) : apptRes('ANON', 'other', { deleted: true }),
        ),
      ).toEqual(D401_AUTH);
  });
});

describe('สถานะบัญชีตัดสินก่อนเรื่องกลุ่ม (ADR 0003 §2 ข้อ 2–3) — ทุก action ของ R4B', () => {
  const resFor = (a: string, w: Who): Resource => {
    if (a === 'appointment.create') return groupRes(w);
    if (a === 'appointment.view') return groupRes(w);
    if (a.startsWith('appointment.') && a !== 'appointment.list.mine') return apptRes(w, 'self');
    if (a.startsWith('notification.')) return { type: 'ownedByUser', ownerId: ID(w) };
    return NONE;
  };
  const ALL = [...APPT_ACTIONS, ...OTHER_ACTIONS];
  // ใช้ persona ที่ "ควร" ได้ allow/ต่างกันมากที่สุด: GA, SA_nonmember, และ OUTSIDER (เพื่อดูว่าไม่ถูก 404 ก่อน)
  const personas: Who[] = ['GA', 'MEM', 'SA_nonmember', 'OUTSIDER'];
  const cells = ALL.flatMap((a) => personas.map((w) => [a, w] as const));

  it.each(cells)('suspended: %s × %s → ACCOUNT_SUSPENDED 401', (a, w) => {
    expect(canA(actor(w, { status: 'suspended' }), a, resFor(a, w))).toEqual(D401_SUSP);
  });
  it.each(cells)('deleted account: %s × %s → AUTH_REQUIRED 401', (a, w) => {
    expect(canA(actor(w, { status: 'deleted' }), a, resFor(a, w))).toEqual(D401_AUTH);
  });
  it.each(cells)('must_change_pin: %s × %s → PIN_CHANGE_REQUIRED 403', (a, w) => {
    expect(canA(actor(w, { mustChangePin: true }), a, resFor(a, w))).toEqual(D403_PIN);
  });
  it.each(ALL.map((a) => [a] as const))('anonymous: %s → AUTH_REQUIRED 401', (a) => {
    expect(canA(actor('ANON'), a, resFor(a, 'ANON'))).toEqual(D401_AUTH);
  });
  it('suspended + กลุ่มถูกลบ → ยังเป็น ACCOUNT_SUSPENDED (ด่านบัญชีมาก่อน)', () => {
    expect(canA(actor('GA', { status: 'suspended' }), 'appointment.update', apptRes('GA', 'self', { deleted: true }))).toEqual(D401_SUSP);
  });
  it('actor ผิดรูป (null/undefined/kind แปลก) → fail closed เท่ากับ anonymous', () => {
    for (const bad of [null, undefined, { kind: 'admin' }, {}] as unknown as Actor[])
      for (const a of ALL) expect(canA(bad, a, resFor(a, 'GA'))).toEqual(D401_AUTH);
  });
  it('status แปลก (ไม่ใช่ active/suspended) → AUTH_REQUIRED (fail closed)', () => {
    const weird = {
      kind: 'user',
      id: 'u',
      isSuperAdmin: true,
      status: 'banned',
      mustChangePin: false,
    } as unknown as Actor;
    expect(canA(weird, 'appointment.update', apptRes('GA', 'self'))).toEqual(D401_AUTH);
  });
});

describe('นัดที่ยกเลิก / นัดที่ผ่านแล้ว — can() ไม่แยกสถานะนัด (service ตอบรหัสธุรกิจ)', () => {
  it('resource นัดไม่มีฟิลด์ status/เวลา: ใส่ฟิลด์เกินไม่เปลี่ยนผลการตัดสิน (ผู้มีสิทธิ์ยัง allow, คนนอกยัง 404, member-other ยัง 403)', () => {
    for (const extra of [{ status: 'cancelled' }, { cancelledAt: 1 }, { endAt: 0 }, { status: 'active' }]) {
      const mk = (w: Who, c: Creator) => ({ ...(apptRes(w, c) as object), ...extra }) as unknown as Resource;
      for (const a of ['appointment.update', 'appointment.cancel', 'appointment.rsvp'] as const) {
        expect(canA(actor('GA'), a, mk('GA', 'other'))).toEqual(OK);
        expect(canA(actor('OUTSIDER'), a, mk('OUTSIDER', 'other'))).toEqual(D404);
      }
      expect(canA(actor('MEM'), 'appointment.update', mk('MEM', 'other'))).toEqual(D403);
      expect(canA(actor('SA_nonmember'), 'appointment.rsvp', mk('SA_nonmember', 'other'))).toEqual(D403);
    }
  });
  it('คนที่ถูกลบออกจากกลุ่ม ยังเห็นนัด (แม้ยกเลิกแล้ว) ไม่ได้: 404 ทุก action', () => {
    for (const a of APPT_ACTIONS)
      expect(
        canA(
          actor('REMOVED'),
          a,
          a === 'appointment.create' || a === 'appointment.view' ? groupRes('REMOVED') : apptRes('REMOVED', 'self'),
        ),
      ).toEqual(D404);
  });
});

describe('appointment.list.mine — ผู้ใช้ active ทุกคน (ผลกรองตาม membership ที่ data layer)', () => {
  it.each(WHO.map((w) => [w] as const))('%s', (w) => {
    expect(can(actor(w), 'appointment.list.mine', NONE)).toEqual(w === 'ANON' ? D401_AUTH : OK); // SA ไม่ติด audit: เป็นรายการของตัวเอง
  });
});

describe('notification.list.own / notification.markRead.own — เจ้าของเท่านั้น', () => {
  const cells = (['notification.list.own', 'notification.markRead.own'] as const).flatMap((a) =>
    WHO.flatMap((w) => (['own', 'other'] as const).map((o) => [a, w, o] as const)),
  );
  it.each(cells)('%s × %s × เจ้าของ=%s', (a, w, o) => {
    const r = {
      type: 'ownedByUser',
      ownerId: o === 'own' ? ID(w) : 'u-someone-else',
    } as const;
    const d = can(actor(w), a, r);
    if (w === 'ANON') expect(d).toEqual(D401_AUTH);
    else if (o === 'own') expect(d).toEqual(OK);
    else expect(d).toEqual(D403); // ไม่มีข้อยกเว้นให้ SA/GA — service แปลงเป็น 404 เพื่อไม่ยืนยันว่า id มีอยู่
  });
  it('SA/GA/MOD อ่านหรือ mark แจ้งเตือนของสมาชิกไม่ได้', () => {
    for (const w of ['SA_nonmember', 'SA_member', 'GA', 'MOD'] as const)
      for (const a of ['notification.list.own', 'notification.markRead.own'] as const)
        expect(can(actor(w), a, { type: 'ownedByUser', ownerId: 'u-member' })).toEqual(D403);
  });
});

describe('ชนิด resource ผิด → RbacMisuseError (fail closed ไม่ใช่ allow)', () => {
  it.each([
    ['appointment.update', groupRes('GA')],
    ['appointment.cancel', groupRes('GA')],
    ['appointment.rsvp', groupRes('GA')],
    ['appointment.create', apptRes('GA', 'self')],
    ['appointment.list.mine', groupRes('GA')],
    ['notification.list.own', NONE],
    ['notification.markRead.own', apptRes('GA', 'self')],
  ] as const)('%s ← %s', (a, r) => {
    expect(() => canA(actor('SA_member'), a, r as Resource)).toThrow(RbacMisuseError);
  });
});

describe('IDOR ข้ามกลุ่ม: canInGroup / authorizeInGroup (/api/appointments/:id ใช้ gid ของนัดเอง; /api/groups/:gid/... เทียบกับ URL)', () => {
  it('นัดอยู่ g2 แต่ URL g1 → 404 ทุกคนรวม SA และ GA', () => {
    for (const w of ['SA_nonmember', 'SA_member', 'GA', 'MOD', 'MEM'] as const)
      for (const a of ['appointment.view', 'appointment.update', 'appointment.cancel', 'appointment.rsvp'] as const)
        expect(canInGroup(actor(w), a, apptRes(w, 'self', { gid: 'g2' }) as never, 'g1')).toEqual(D404);
  });
  it('gid ตรงกัน → ผลเท่ากับ can()', () => {
    expect(canInGroup(actor('GA'), 'appointment.update', apptRes('GA', 'other') as never, 'g1')).toEqual(OK);
    expect(canInGroup(actor('MEM'), 'appointment.update', apptRes('MEM', 'other') as never, 'g1')).toEqual(D403);
  });
  it('ด่านบัญชีชนะ IDOR: suspended/anonymous/must_change_pin ได้รหัสของตัวเองแม้ gid ไม่ตรง', () => {
    expect(
      canInGroup(actor('GA', { status: 'suspended' }), 'appointment.view', apptRes('GA', 'self', { gid: 'g2' }) as never, 'g1'),
    ).toEqual(D401_SUSP);
    expect(canInGroup(actor('ANON'), 'appointment.view', apptRes('ANON', 'self', { gid: 'g2' }) as never, 'g1')).toEqual(D401_AUTH);
    expect(
      canInGroup(actor('GA', { mustChangePin: true }), 'appointment.view', apptRes('GA', 'self', { gid: 'g2' }) as never, 'g1'),
    ).toEqual(D403_PIN);
  });
  it('resource ที่ไม่ผูกกลุ่มส่งเข้า canInGroup = บั๊กผู้เรียก (throw)', () => {
    expect(() => canInGroup(actor('GA'), 'appointment.list.mine', NONE as never, 'g1')).toThrow(RbacMisuseError);
  });
  it('authorizeInGroup ปฏิเสธ → PolicyError พร้อม status ตรงรหัส', () => {
    try {
      authorizeInGroup(actor('MEM'), 'appointment.cancel', apptRes('MEM', 'other') as never, 'g1');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyError);
      expect((e as PolicyError).code).toBe('FORBIDDEN');
      expect((e as PolicyError).status).toBe(403);
      expect((e as PolicyError).action).toBe('appointment.cancel');
    }
  });
});

describe('authorize() คืนธง audit ให้ service เขียน audit_log (SA ที่ไม่ใช่สมาชิก)', () => {
  it('SA non-member: view/update/cancel/create → auditAsSuperAdmin = true', () => {
    expect(authorize(actor('SA_nonmember'), 'appointment.view', groupRes('SA_nonmember') as never).auditAsSuperAdmin).toBe(true);
    expect(authorize(actor('SA_nonmember'), 'appointment.update', apptRes('SA_nonmember', 'other') as never).auditAsSuperAdmin).toBe(true);
    expect(authorize(actor('SA_nonmember'), 'appointment.cancel', apptRes('SA_nonmember', 'other') as never).auditAsSuperAdmin).toBe(true);
    expect(authorize(actor('SA_nonmember'), 'appointment.create', groupRes('SA_nonmember') as never).auditAsSuperAdmin).toBe(true);
  });
  it('SA non-member RSVP → throw PolicyError FORBIDDEN', () => {
    expect(() => authorize(actor('SA_nonmember'), 'appointment.rsvp', apptRes('SA_nonmember', 'other') as never)).toThrow(PolicyError);
  });
});

describe('ตาราง status ของรหัสที่ policy ใช้ (ตรวจค่าตรง ๆ)', () => {
  it('AUTH_REQUIRED 401 · ACCOUNT_SUSPENDED 401 · PIN_CHANGE_REQUIRED 403 · FORBIDDEN 403 · NOT_FOUND 404', () => {
    expect(POLICY_STATUS.AUTH_REQUIRED).toBe(401);
    expect(POLICY_STATUS.ACCOUNT_SUSPENDED).toBe(401);
    expect(POLICY_STATUS.PIN_CHANGE_REQUIRED).toBe(403);
    expect(POLICY_STATUS.FORBIDDEN).toBe(403);
    expect(POLICY_STATUS.NOT_FOUND).toBe(404);
  });
});
