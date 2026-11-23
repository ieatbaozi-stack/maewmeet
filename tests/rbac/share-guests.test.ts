/**
 * R18 §S — เมทริกซ์ RBAC ของลิงก์ชวนคนนอก + แขกของนัด (ADR 0016 §5)
 *
 * สเปกเขียนมือจาก ADR 0016 §5.2 (ไม่คัดจาก can.ts) · persona ครบตามใบสั่งงาน:
 *   SA (นอกกลุ่ม/เป็นสมาชิก) · admin · moderator · member · ผู้สร้างลิงก์ · ผู้สร้างนัด · ผู้ชวน (invitedBy)
 *   · แขก · แขกที่ถูกนำออก · คนนอก · ไม่ได้ล็อกอิน
 * + ชั้นบัญชี (suspended / must_change_pin / deleted) · กลุ่มถูกลบ · IDOR ข้ามกลุ่ม · การกรองรายการลิงก์ · พฤติกรรมเดิมของ appointment.*
 *
 * ขอบเขตของ can(): "ลิงก์ใช้ได้/หมดอายุ/เต็ม", "แขกเป้าหมายไม่มี/ถูกนำออกแล้ว", "นัดยกเลิก/จบ" เป็นงานของ service
 * (404/410/409 ตาม ADR 0016 §5.4, §6) — ที่นี่ตรวจเฉพาะการตัดสินสิทธิ์จาก actor + resource
 */
import { describe, expect, it } from 'vitest';

import { ACTION_RESOURCE, PIN_CHANGE_ALLOWED, PUBLIC_ACTIONS, SUPER_ADMIN_AUDITED, SUPER_ADMIN_ONLY, type Action } from '@/lib/rbac/actions';
import { authorize, can, canInGroup } from '@/lib/rbac/can';
import { PolicyError, RbacMisuseError } from '@/lib/rbac/errors';
import type { AccountStatus, Actor, GroupCtx, GroupRole, PolicyErrorCode, Resource } from '@/lib/rbac/types';

// ─────────────────────────── persona ───────────────────────────

type Who =
  | 'SA_nonmember'
  | 'SA_member'
  | 'GA'
  | 'MOD'
  | 'MEM'
  | 'LINK_CREATOR'
  | 'APPT_CREATOR'
  | 'INVITER'
  | 'GUEST'
  | 'REMOVED_GUEST'
  | 'NONMEMBER'
  | 'ANON';

const WHO: readonly Who[] = [
  'SA_nonmember',
  'SA_member',
  'GA',
  'MOD',
  'MEM',
  'LINK_CREATOR',
  'APPT_CREATOR',
  'INVITER',
  'GUEST',
  'REMOVED_GUEST',
  'NONMEMBER',
  'ANON',
];

type Spec = { readonly role: GroupRole | null; readonly sa: boolean; readonly isGuest: boolean };
const SPEC: Record<Who, Spec> = {
  SA_nonmember: { role: null, sa: true, isGuest: false },
  SA_member: { role: 'member', sa: true, isGuest: false },
  GA: { role: 'admin', sa: false, isGuest: false },
  MOD: { role: 'moderator', sa: false, isGuest: false },
  MEM: { role: 'member', sa: false, isGuest: false },
  LINK_CREATOR: { role: 'member', sa: false, isGuest: false },
  APPT_CREATOR: { role: 'member', sa: false, isGuest: false },
  INVITER: { role: 'member', sa: false, isGuest: false },
  // แขก = ไม่มีแถว group_member (actorRole null) + แถว appointment_guest ที่ removed_at IS NULL
  GUEST: { role: null, sa: false, isGuest: true },
  // แขกที่ถูกนำออก = แถวยังอยู่แต่ removed_at ไม่ NULL → policy-context ให้ isGuest = false
  REMOVED_GUEST: { role: null, sa: false, isGuest: false },
  NONMEMBER: { role: null, sa: false, isGuest: false },
  ANON: { role: null, sa: false, isGuest: false },
};

const ID = (w: Who) => `u-${w}`;
const APPT_CREATOR_ID = ID('APPT_CREATOR');
const LINK_CREATOR_ID = ID('LINK_CREATOR');
const INVITER_ID = ID('INVITER');
/** แขกเป้าหมายของ guest.remove — คนละคนกับ persona GUEST (แขกด้วยกันลบกันไม่ได้) */
const TARGET_GUEST_ID = 'u-target-guest';

const actor = (w: Who, o: { status?: AccountStatus; mustChangePin?: boolean } = {}): Actor =>
  w === 'ANON'
    ? { kind: 'anonymous' }
    : { kind: 'user', id: ID(w), isSuperAdmin: SPEC[w].sa, status: o.status ?? 'active', mustChangePin: o.mustChangePin ?? false };

const grp = (w: Who, o: { deleted?: boolean; id?: string } = {}): GroupCtx => ({
  id: o.id ?? 'g1',
  deleted: o.deleted ?? false,
  actorRole: SPEC[w].role,
});

type Opt = { deleted?: boolean; gid?: string };
const apptRes = (w: Who, o: Opt = {}): Resource => ({ type: 'appointment', group: grp(w, { deleted: o.deleted, id: o.gid }), createdBy: APPT_CREATOR_ID });
const linkRes = (w: Who, o: Opt = {}): Resource => ({
  type: 'shareLink',
  group: grp(w, { deleted: o.deleted, id: o.gid }),
  appointmentCreatedBy: APPT_CREATOR_ID,
  linkCreatedBy: LINK_CREATOR_ID,
});
const guestRes = (w: Who, o: Opt = {}): Resource => ({ type: 'appointmentGuest', group: grp(w, { deleted: o.deleted, id: o.gid }), isGuest: SPEC[w].isGuest });
const targetRes = (w: Who, o: Opt & { invitedBy?: string | null } = {}): Resource => ({
  type: 'guestTarget',
  group: grp(w, { deleted: o.deleted, id: o.gid }),
  appointmentCreatedBy: APPT_CREATOR_ID,
  invitedBy: o.invitedBy === undefined ? INVITER_ID : o.invitedBy,
  guestUserId: TARGET_GUEST_ID,
});
const NONE: Resource = { type: 'none' };

const canA = (a: Actor, action: Action, r: Resource) => (can as (a: Actor, x: Action, r: Resource) => ReturnType<typeof can>)(a, action, r);

// ─────────────────────────── ค่าคาดหวัง (status เขียนตรง ๆ — จับการเปลี่ยนตาราง) ───────────────────────────

const OK = { allow: true, auditAsSuperAdmin: false } as const;
const OKA = { allow: true, auditAsSuperAdmin: true } as const;
const dn = (code: PolicyErrorCode, status: 401 | 403 | 404 | 409) => ({ allow: false, code, status }) as const;
const AUTH = dn('AUTH_REQUIRED', 401);
const SUSP = dn('ACCOUNT_SUSPENDED', 401);
const PIN = dn('PIN_CHANGE_REQUIRED', 403);
const FB = dn('FORBIDDEN', 403);
const NF = dn('NOT_FOUND', 404);
type Exp = typeof OK | typeof OKA | ReturnType<typeof dn>;

const NEW_ACTIONS = [
  'appointment.share.preview',
  'appointment.share.create',
  'appointment.share.revoke',
  'appointment.guest.join',
  'appointment.guest.view',
  'appointment.guest.rsvp',
  'appointment.guest.leave',
  'appointment.guest.remove',
] as const satisfies readonly Action[];
type NewAction = (typeof NEW_ACTIONS)[number];

const RES: Record<NewAction, (w: Who, o?: Opt) => Resource> = {
  'appointment.share.preview': () => NONE,
  'appointment.share.create': apptRes,
  'appointment.share.revoke': linkRes,
  'appointment.guest.join': () => NONE,
  'appointment.guest.view': guestRes,
  'appointment.guest.rsvp': guestRes,
  'appointment.guest.leave': guestRes,
  'appointment.guest.remove': targetRes,
};

const GUEST_SELF_ROW: Record<Who, Exp> = {
  SA_nonmember: NF, // ไม่มีข้อยกเว้น SA
  SA_member: NF,
  GA: NF, // สมาชิกใช้ทางสมาชิก
  MOD: NF,
  MEM: NF,
  LINK_CREATOR: NF,
  APPT_CREATOR: NF,
  INVITER: NF,
  GUEST: OK,
  REMOVED_GUEST: NF,
  NONMEMBER: NF,
  ANON: AUTH,
};

/** ADR 0016 §5.2 — ถอดทีละแถว */
const EXPECT: Record<NewAction, Record<Who, Exp>> = {
  'appointment.share.preview': {
    SA_nonmember: OK, SA_member: OK, GA: OK, MOD: OK, MEM: OK, LINK_CREATOR: OK, APPT_CREATOR: OK,
    INVITER: OK, GUEST: OK, REMOVED_GUEST: OK, NONMEMBER: OK, ANON: OK, // PUBLIC
  },
  'appointment.share.create': {
    SA_nonmember: FB, // ไม่มี "มากับ X" ที่เป็นสมาชิก (แบบ RSVP)
    SA_member: OK, GA: OK, MOD: OK, MEM: OK, LINK_CREATOR: OK, APPT_CREATOR: OK, INVITER: OK,
    GUEST: NF, REMOVED_GUEST: NF, NONMEMBER: NF, ANON: AUTH,
  },
  'appointment.share.revoke': {
    SA_nonmember: OKA,
    SA_member: OKA, // role member ไม่ใช่ผู้สร้างลิงก์/นัด → ใช้สิทธิ์ SA
    GA: OK, MOD: OK,
    MEM: FB,
    LINK_CREATOR: OK, APPT_CREATOR: OK,
    INVITER: FB, // ผู้ชวนแขกไม่ได้มีสิทธิ์กับลิงก์ของคนอื่น
    GUEST: NF, REMOVED_GUEST: NF, NONMEMBER: NF, ANON: AUTH,
  },
  'appointment.guest.join': {
    SA_nonmember: OK, // SA เข้าเป็นแขกได้เหมือนผู้ใช้ทั่วไป ไม่ audit
    SA_member: OK, GA: OK, MOD: OK, MEM: OK, LINK_CREATOR: OK, APPT_CREATOR: OK, INVITER: OK,
    GUEST: OK, REMOVED_GUEST: OK, // ถูกนำออก → service ตอบ 404 SHARE_LINK_INVALID (ไม่ใช่ can)
    NONMEMBER: OK, ANON: AUTH,
  },
  'appointment.guest.view': GUEST_SELF_ROW,
  'appointment.guest.rsvp': GUEST_SELF_ROW,
  'appointment.guest.leave': GUEST_SELF_ROW,
  'appointment.guest.remove': {
    SA_nonmember: OKA, SA_member: OKA,
    GA: OK, MOD: OK,
    MEM: FB,
    LINK_CREATOR: FB, // ผู้สร้างลิงก์อื่น (ไม่ใช่ผู้ชวนแขกคนนี้) ไม่มีสิทธิ์
    APPT_CREATOR: OK,
    INVITER: OK,
    GUEST: NF, // แขกด้วยกัน = คนนอกกลุ่ม
    REMOVED_GUEST: NF, NONMEMBER: NF, ANON: AUTH,
  },
};

// ─────────────────────────── 1. รายชื่อ / ชุดพิเศษ ───────────────────────────

describe('R18 §S: action / resource / ชุดพิเศษ', () => {
  it('ชนิด resource ที่แต่ละ action รับ (เขียนมือจาก ADR 0016 §5.1–5.2)', () => {
    expect(ACTION_RESOURCE['appointment.share.preview']).toEqual(['none']);
    expect(ACTION_RESOURCE['appointment.share.create']).toEqual(['appointment']);
    expect(ACTION_RESOURCE['appointment.share.revoke']).toEqual(['shareLink']);
    expect(ACTION_RESOURCE['appointment.guest.join']).toEqual(['none']);
    expect(ACTION_RESOURCE['appointment.guest.view']).toEqual(['appointmentGuest']);
    expect(ACTION_RESOURCE['appointment.guest.rsvp']).toEqual(['appointmentGuest']);
    expect(ACTION_RESOURCE['appointment.guest.leave']).toEqual(['appointmentGuest']);
    expect(ACTION_RESOURCE['appointment.guest.remove']).toEqual(['guestTarget']);
  });

  it('appointment.* เดิมไม่ขยาย (แขกได้ NOT_FOUND ที่ทางสมาชิก)', () => {
    expect(ACTION_RESOURCE['appointment.view']).toEqual(['group', 'appointment']);
    expect(ACTION_RESOURCE['appointment.rsvp']).toEqual(['appointment']);
    expect(ACTION_RESOURCE['appointment.update']).toEqual(['appointment']);
    expect(ACTION_RESOURCE['appointment.cancel']).toEqual(['appointment']);
  });

  it('PUBLIC เฉพาะ share.preview · ไม่มีตัวไหนอยู่ใน PIN_CHANGE_ALLOWED / SUPER_ADMIN_ONLY / SUPER_ADMIN_AUDITED', () => {
    for (const a of NEW_ACTIONS) {
      expect((PUBLIC_ACTIONS as readonly string[]).includes(a), a).toBe(a === 'appointment.share.preview');
      expect((PIN_CHANGE_ALLOWED as readonly string[]).includes(a), a).toBe(false);
      expect((SUPER_ADMIN_ONLY as readonly string[]).includes(a), a).toBe(false);
      expect((SUPER_ADMIN_AUDITED as readonly string[]).includes(a), a).toBe(false);
    }
  });
});

// ─────────────────────────── 2. เมทริกซ์ persona × action ───────────────────────────

describe('เมทริกซ์ ADR 0016 §5.2 — 12 persona × 8 action', () => {
  const cells = NEW_ACTIONS.flatMap((a) => WHO.map((w) => [`${a} · ${w}`, a, w] as const));
  it.each(cells)('%s', (_n, action, w) => {
    expect(canA(actor(w), action, RES[action](w))).toEqual(EXPECT[action][w]);
  });
});

// ─────────────────────────── 3. ชั้นบัญชี / กลุ่มลบ ───────────────────────────

const USERS = WHO.filter((w) => w !== 'ANON');

describe('ชั้นบัญชีมาก่อนกฎของ action', () => {
  it.each(NEW_ACTIONS)('%s: suspended → 401 ACCOUNT_SUSPENDED · deleted → 401 AUTH_REQUIRED (ทุก persona)', (action) => {
    for (const w of USERS) {
      expect(canA(actor(w, { status: 'suspended' }), action, RES[action](w)), w).toEqual(SUSP);
      expect(canA(actor(w, { status: 'deleted' }), action, RES[action](w)), w).toEqual(AUTH);
    }
  });

  it.each(NEW_ACTIONS)('%s: must_change_pin → 403 PIN_CHANGE_REQUIRED (รวม preview — ไม่ใช่ทางเลี่ยง /set-pin)', (action) => {
    for (const w of USERS) expect(canA(actor(w, { mustChangePin: true }), action, RES[action](w)), w).toEqual(PIN);
  });
});

describe('กลุ่มของนัดถูกลบ → 404 ทุก action ที่ผูกกลุ่ม ทุก persona รวม SA และแขก', () => {
  const GROUP_BOUND = NEW_ACTIONS.filter((a) => !(ACTION_RESOURCE[a] as readonly string[]).includes('none'));
  it('มี 6 action ที่ผูกกลุ่ม', () => expect(GROUP_BOUND).toHaveLength(6));
  it.each(GROUP_BOUND)('%s', (action) => {
    for (const w of WHO) expect(canA(actor(w), action, RES[action](w, { deleted: true })), w).toEqual(w === 'ANON' ? AUTH : NF);
  });
});

// ─────────────────────────── 4. กรณีขอบที่ระบุชื่อ ───────────────────────────

describe('กรณีขอบ', () => {
  it('แขกยังได้ 404 จากทางสมาชิกเดิม (appointment.view/rsvp/update/cancel) — S4, ADR 0016 §5.3', () => {
    for (const w of ['GUEST', 'REMOVED_GUEST'] as const) {
      for (const a of ['appointment.view', 'appointment.rsvp', 'appointment.update', 'appointment.cancel', 'appointment.share.create'] as const) {
        expect(canA(actor(w), a, apptRes(w)), `${a}/${w}`).toEqual(NF);
      }
      expect(canA(actor(w), 'group.view', { type: 'group', group: grp(w) }), w).toEqual(NF);
      expect(canA(actor(w), 'group.calendar.view', { type: 'group', group: grp(w) }), w).toEqual(NF);
      expect(canA(actor(w), 'group.availability.view', { type: 'group', group: grp(w) }), w).toEqual(NF);
    }
  });

  it('SA ที่เป็นแขก = แขกธรรมดา: view/rsvp/leave ผ่านแบบไม่ติดธง audit', () => {
    const saGuest: Actor = { kind: 'user', id: 'u-sa-guest', isSuperAdmin: true, status: 'active', mustChangePin: false };
    const r: Resource = { type: 'appointmentGuest', group: { id: 'g1', deleted: false, actorRole: null }, isGuest: true };
    for (const a of ['appointment.guest.view', 'appointment.guest.rsvp', 'appointment.guest.leave'] as const) expect(canA(saGuest, a, r), a).toEqual(OK);
  });

  it('สมาชิกที่ (ผิดปกติ) มีแถวแขกค้าง → ทางแขกยัง 404 (ADR 0016 §2.4 ปฏิเสธซ้ำอีกชั้น)', () => {
    for (const role of ['admin', 'moderator', 'member'] as const) {
      const r: Resource = { type: 'appointmentGuest', group: { id: 'g1', deleted: false, actorRole: role }, isGuest: true };
      expect(canA(actor('MEM'), 'appointment.guest.view', r), role).toEqual(NF);
    }
  });

  it('isGuest ค่าแปลก (ไม่ใช่ true ชัด ๆ) → 404 (fail closed)', () => {
    for (const v of [1, 'true', undefined, null]) {
      const r = { type: 'appointmentGuest', group: { id: 'g1', deleted: false, actorRole: null }, isGuest: v } as unknown as Resource;
      expect(canA(actor('GUEST'), 'appointment.guest.view', r), String(v)).toEqual(NF);
    }
  });

  it('guest.remove: ผู้ชวนถูกลบ (invitedBy = null) → member ที่ไม่ใช่ผู้สร้างนัดลบไม่ได้ · ผู้สร้างนัด/admin/mod ยังได้', () => {
    expect(canA(actor('INVITER'), 'appointment.guest.remove', targetRes('INVITER', { invitedBy: null }))).toEqual(FB);
    expect(canA(actor('MEM'), 'appointment.guest.remove', targetRes('MEM', { invitedBy: null }))).toEqual(FB);
    expect(canA(actor('APPT_CREATOR'), 'appointment.guest.remove', targetRes('APPT_CREATOR', { invitedBy: null }))).toEqual(OK);
    expect(canA(actor('GA'), 'appointment.guest.remove', targetRes('GA', { invitedBy: null }))).toEqual(OK);
    expect(canA(actor('MOD'), 'appointment.guest.remove', targetRes('MOD', { invitedBy: null }))).toEqual(OK);
  });

  it('guest.remove: เป้าหมายคือตัวเอง → 403 ทุกคนรวม SA (แขกออกเองใช้ guest.leave) · คนนอก/แขกยัง 404 ก่อน', () => {
    const self = (w: Who): Resource => ({
      type: 'guestTarget',
      group: grp(w),
      appointmentCreatedBy: APPT_CREATOR_ID,
      invitedBy: INVITER_ID,
      guestUserId: ID(w),
    });
    for (const w of ['SA_nonmember', 'SA_member', 'GA', 'MOD', 'APPT_CREATOR', 'INVITER'] as const) {
      expect(canA(actor(w), 'appointment.guest.remove', self(w)), w).toEqual(FB);
    }
    expect(canA(actor('GUEST'), 'appointment.guest.remove', self('GUEST'))).toEqual(NF);
  });

  it('share.revoke: ผู้สร้างลิงก์ที่ออกจากกลุ่มแล้ว (actorRole null) ยกเลิกลิงก์ตัวเองไม่ได้ → 404', () => {
    const r: Resource = {
      type: 'shareLink',
      group: { id: 'g1', deleted: false, actorRole: null },
      appointmentCreatedBy: APPT_CREATOR_ID,
      linkCreatedBy: LINK_CREATOR_ID,
    };
    expect(canA(actor('LINK_CREATOR'), 'appointment.share.revoke', r)).toEqual(NF);
  });

  it('ส่ง resource ผิดชนิด → RbacMisuseError (กัน service ใช้ resource ของสมาชิกกับทางแขก และกลับกัน)', () => {
    expect(() => canA(actor('GUEST'), 'appointment.guest.view', apptRes('GUEST'))).toThrow(RbacMisuseError);
    expect(() => canA(actor('MEM'), 'appointment.view', guestRes('MEM'))).toThrow(RbacMisuseError);
    expect(() => canA(actor('MEM'), 'appointment.share.revoke', apptRes('MEM'))).toThrow(RbacMisuseError);
    expect(() => canA(actor('MEM'), 'appointment.guest.remove', linkRes('MEM'))).toThrow(RbacMisuseError);
    expect(() => canA(actor('MEM'), 'appointment.share.create', NONE)).toThrow(RbacMisuseError);
  });

  it('authorize โยน PolicyError ตามรหัส (แขกที่ถูกนำออก view → 404 · member ลบแขกของคนอื่น → 403)', () => {
    expect(() => authorize(actor('REMOVED_GUEST'), 'appointment.guest.view', guestRes('REMOVED_GUEST') as never)).toThrow(PolicyError);
    expect(() => authorize(actor('REMOVED_GUEST'), 'appointment.guest.view', guestRes('REMOVED_GUEST') as never)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND', status: 404 }),
    );
    expect(() => authorize(actor('MEM'), 'appointment.guest.remove', targetRes('MEM') as never)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', status: 403 }),
    );
  });
});

// ─────────────────────────── 5. IDOR / การกรองรายการลิงก์ ───────────────────────────

describe('IDOR ข้ามกลุ่ม (canInGroup) — resource ใหม่ผูกกลุ่มได้', () => {
  it('ลิงก์/แขก/เป้าหมายของกลุ่มอื่น → 404 แม้ผู้มีสิทธิ์', () => {
    expect(canInGroup(actor('GA'), 'appointment.share.revoke', linkRes('GA', { gid: 'g2' }) as never, 'g1')).toEqual(NF);
    expect(canInGroup(actor('SA_nonmember'), 'appointment.guest.remove', targetRes('SA_nonmember', { gid: 'g2' }) as never, 'g1')).toEqual(NF);
    expect(canInGroup(actor('GUEST'), 'appointment.guest.view', guestRes('GUEST', { gid: 'g2' }) as never, 'g1')).toEqual(NF);
    expect(canInGroup(actor('GA'), 'appointment.share.revoke', linkRes('GA') as never, 'g1')).toEqual(OK);
  });
});

describe('รายการลิงก์ในหน้านัด = กรองด้วย can(…, share.revoke, link) (ADR 0016 §5.2 แบบ invite.list)', () => {
  const rows = (w: Who) => [
    { id: 'mine', linkCreatedBy: ID(w) },
    { id: 'theirs', linkCreatedBy: 'u-someone' },
  ];
  const visible = (w: Who, apptCreatedBy: string) =>
    rows(w)
      .filter(
        (row) =>
          canA(actor(w), 'appointment.share.revoke', {
            type: 'shareLink',
            group: grp(w),
            appointmentCreatedBy: apptCreatedBy,
            linkCreatedBy: row.linkCreatedBy,
          }).allow,
      )
      .map((r) => r.id);

  it('สมาชิกธรรมดาเห็นเฉพาะของตัวเอง · admin/mod/SA/ผู้สร้างนัดเห็นทุกลิงก์ · คนนอก/แขกไม่เห็นเลย', () => {
    expect(visible('MEM', 'u-other')).toEqual(['mine']);
    expect(visible('LINK_CREATOR', 'u-other')).toEqual(['mine']);
    expect(visible('APPT_CREATOR', APPT_CREATOR_ID)).toEqual(['mine', 'theirs']);
    for (const w of ['GA', 'MOD', 'SA_member', 'SA_nonmember'] as const) expect(visible(w, 'u-other'), w).toEqual(['mine', 'theirs']);
    for (const w of ['GUEST', 'REMOVED_GUEST', 'NONMEMBER'] as const) expect(visible(w, 'u-other'), w).toEqual([]);
  });
});
