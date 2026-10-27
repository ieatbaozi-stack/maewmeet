/**
 * R0-6 — เทสต์เมทริกซ์ RBAC สร้างอัตโนมัติจาก matrix.fixture.ts (ADR 0003 §4 ข้อ 1–4)
 * + กรณีขอบ (must_change_pin, suspended, กลุ่มถูกลบ, SA นอกกลุ่ม, D7, D8, Q2, audit)
 *
 * Mutation checks (R2-1, ทำมือและคืนค่าแล้ว — ผลจริงอยู่ใน Handoff R2 Auth):
 *  M1  ใน can.ts `memberRemove` ตัดเงื่อนไข `resource.targetRole === 'member'` ของ moderator
 *      → ล้ม: "member.remove [target:moderator] MOD", "[target:admin] MOD", D7 ×2
 *  M2  ใน `adminModOrCreator` เปลี่ยน `(role === 'member' && createdBy === actor.id)` เป็น `role === 'member'`
 *      → ล้ม: "invite.revoke [other] MEM", appointment.update/cancel [other] MEM, invite.list กรองแถว, §3 แถว 8, D4
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ACTION_RESOURCE,
  ACTIONS,
  PIN_CHANGE_ALLOWED,
  PUBLIC_ACTIONS,
  SUPER_ADMIN_AUDITED,
  SUPER_ADMIN_ONLY,
  isAction,
  type Action,
} from '@/lib/rbac/actions';
import { authorize, can } from '@/lib/rbac/can';
import { AppError, ERROR_HTTP_STATUS } from '@/lib/shared/errors';
import { POLICY_STATUS, PolicyError, RbacMisuseError, isPolicyError } from '@/lib/rbac/errors';
import type { Actor, GroupCtx, GroupRole, Resource, UserActor } from '@/lib/rbac/types';

import {
  ADMIN_TARGET_NEVER_ALLOWED,
  COLUMNS,
  INVITE_LIST_VISIBLE,
  MOD_REMOVABLE_TARGET_ROLES,
  EXPECT_PIN_CHANGE_ALLOWED,
  EXPECT_SA_AUDITED_SA_ONLY,
  MATRIX,
  type Column,
  type Expect,
  type MatrixEntry,
  type Scenario,
} from './matrix.fixture';

// ─────────────────────────── ตัวสร้าง actor / resource ───────────────────────────

const COLUMN_SPEC: Record<Column, { id: string | null; superAdmin: boolean; role: GroupRole | null }> = {
  SA_nonmember: { id: 'u-sa-nm', superAdmin: true, role: null },
  SA_member: { id: 'u-sa-m', superAdmin: true, role: 'member' },
  GA: { id: 'u-ga', superAdmin: false, role: 'admin' },
  MOD: { id: 'u-mod', superAdmin: false, role: 'moderator' },
  MEM: { id: 'u-mem', superAdmin: false, role: 'member' },
  NM: { id: 'u-nm', superAdmin: false, role: null },
  AN: { id: null, superAdmin: false, role: null },
};

type ActorOverrides = Partial<Pick<UserActor, 'status' | 'mustChangePin'>>;

function actorFor(col: Column, o: ActorOverrides = {}): Actor {
  const s = COLUMN_SPEC[col];
  if (s.id === null) return { kind: 'anonymous' };
  return {
    kind: 'user',
    id: s.id,
    isSuperAdmin: s.superAdmin,
    status: o.status ?? 'active',
    mustChangePin: o.mustChangePin ?? false,
  };
}

const OTHER_USER = 'u-other';
const OTHER_ADMIN = 'u-other-admin';
const ANON_PLACEHOLDER = 'u-anon-placeholder';

function groupFor(col: Column, deleted = false): GroupCtx {
  return { id: 'g-1', deleted, actorRole: COLUMN_SPEC[col].role };
}

/** คืน null เมื่อ scenario ใช้กับ resource นี้ไม่ได้ (fixture ผิดรูป → เทสต์ล้ม) */
function resourceFor(entry: MatrixEntry, scenario: Scenario, col: Column, deletedGroup = false): Resource | null {
  const me = COLUMN_SPEC[col].id ?? ANON_PLACEHOLDER;
  const ownerOf = (): string | null => (scenario === 'own' ? me : scenario === 'other' ? OTHER_USER : null);
  const group = groupFor(col, deletedGroup);
  switch (entry.resource) {
    case 'none':
      return scenario === 'any' ? { type: 'none' } : null;
    case 'self':
      if (scenario === 'holdsGroupAdmin') return { type: 'self', holdsGroupAdmin: true };
      if (scenario === 'noGroupAdmin') return { type: 'self', holdsGroupAdmin: false };
      return null;
    case 'group':
      return scenario === 'any' ? { type: 'group', group } : null;
    case 'member': {
      if (scenario === 'target:member') return { type: 'member', group, targetUserId: OTHER_USER, targetRole: 'member' };
      if (scenario === 'target:moderator')
        return { type: 'member', group, targetUserId: OTHER_USER, targetRole: 'moderator' };
      if (scenario === 'target:admin') return { type: 'member', group, targetUserId: OTHER_ADMIN, targetRole: 'admin' };
      if (scenario === 'target:self') {
        const role = COLUMN_SPEC[col].role;
        return role === null ? null : { type: 'member', group, targetUserId: me, targetRole: role };
      }
      return null;
    }
    case 'invite': {
      const createdBy = ownerOf();
      return createdBy === null ? null : { type: 'invite', group, createdBy };
    }
    case 'appointment': {
      const createdBy = scenario === 'any' ? OTHER_USER : ownerOf();
      return createdBy === null ? null : { type: 'appointment', group, createdBy };
    }
    case 'directInvite': {
      const invitee = ownerOf();
      return invitee === null ? null : { type: 'directInvite', inviteeUserId: invitee };
    }
    case 'busy': {
      const ownerId = ownerOf();
      return ownerId === null ? null : { type: 'busy', ownerId };
    }
    case 'ownedByUser': {
      const ownerId = ownerOf();
      return ownerId === null ? null : { type: 'ownedByUser', ownerId };
    }
  }
}

/** เรียก can() แบบไม่ผูกชนิด action↔resource (เทสต์วนทุก action) */
const canAny = (actor: Actor, action: Action, resource: Resource) =>
  (can as (a: Actor, x: Action, r: Resource) => ReturnType<typeof can>)(actor, action, resource);

type Cell = {
  action: Action;
  scenario: Scenario;
  col: Column;
  expected: Expect;
  entry: MatrixEntry;
};

const ENTRIES = Object.entries(MATRIX) as [Action, MatrixEntry][];

const ALL_CELLS: Cell[] = ENTRIES.flatMap(([action, entry]) =>
  (Object.entries(entry.cases) as [Scenario, Record<Column, Expect>][]).flatMap(([scenario, row]) =>
    COLUMNS.map((col) => ({ action, scenario, col, expected: row[col], entry })),
  ),
);
const CELLS = ALL_CELLS.filter((c) => c.expected !== 'na');

function check(cell: Cell, actor: Actor, expected: Exclude<Expect, 'na'>, deletedGroup = false) {
  const resource = resourceFor(cell.entry, cell.scenario, cell.col, deletedGroup);
  expect(resource, `fixture: scenario ${cell.scenario} ใช้กับ resource ${cell.entry.resource} ไม่ได้`).not.toBeNull();
  const d = canAny(actor, cell.action, resource as Resource);
  if (expected === 'allow') {
    expect(d).toMatchObject({ allow: true });
  } else {
    expect(d).toEqual({ allow: false, code: expected, status: POLICY_STATUS[expected] });
  }
}

// ─────────────────────────── 1. ความครบของ fixture ───────────────────────────

describe('fixture ครบทุก action (ADR 0003 §4.2)', () => {
  it('ชุดคีย์ fixture = ACTIONS พอดี (ไม่ขาด ไม่เกิน)', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...ACTIONS].sort());
  });
  it('ACTIONS ไม่มีชื่อซ้ำ', () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
  });
  it.each(ENTRIES)('%s: ชนิด resource ใน fixture ตรงกับ ACTION_RESOURCE และมีอย่างน้อย 1 scenario', (action, entry) => {
    expect(ACTION_RESOURCE[action] as readonly string[]).toContain(entry.resource);
    expect(Object.keys(entry.cases).length).toBeGreaterThan(0);
  });
  it('ทุกแถวมีค่าครบ 7 คอลัมน์ และ scenario สร้าง resource ได้จริง', () => {
    for (const c of ALL_CELLS) {
      expect(c.expected, `${c.action}/${c.scenario}/${c.col}`).toBeDefined();
      if (c.expected !== 'na') expect(resourceFor(c.entry, c.scenario, c.col), `${c.action}/${c.scenario}/${c.col}`).not.toBeNull();
    }
  });
});

// ─────────────────────────── 2. เมทริกซ์หลัก (ผลคูณ action × scenario × คอลัมน์) ───────────────────────────

describe('เมทริกซ์ PRD §3 × 6 บทบาท (SA แยกสมาชิก/ไม่ใช่สมาชิก)', () => {
  it.each(CELLS.map((c) => [`${c.action} [${c.scenario}] ${c.col} → ${c.expected}`, c] as const))('%s', (_n, cell) => {
    check(cell, actorFor(cell.col), cell.expected as Exclude<Expect, 'na'>);
  });
});

// ─────────────────────────── 3. ชั้นสถานะพิเศษ (คูณซ้ำทุก action) ───────────────────────────

const USER_CELLS = CELLS.filter((c) => c.col !== 'AN');

describe('must_change_pin: ปฏิเสธทุก action ยกเว้นตั้ง PIN / ออกจากระบบ / ตั้ง cookie ภาษา-ธีม (PRD §3 กติกาเสริม, U3)', () => {
  it('รายการที่อนุญาตตรงกับ PRD/ADR', () => {
    expect([...PIN_CHANGE_ALLOWED].sort()).toEqual([...EXPECT_PIN_CHANGE_ALLOWED].sort());
  });
  it.each(USER_CELLS.map((c) => [`${c.action} [${c.scenario}] ${c.col}`, c] as const))('%s', (_n, cell) => {
    const expected = EXPECT_PIN_CHANGE_ALLOWED.includes(cell.action)
      ? (cell.expected as Exclude<Expect, 'na'>)
      : 'PIN_CHANGE_REQUIRED';
    check(cell, actorFor(cell.col, { mustChangePin: true }), expected);
  });
});

describe('suspended: ปฏิเสธทุก action (ADR 0003 §2.2)', () => {
  it.each(USER_CELLS.map((c) => [`${c.action} [${c.scenario}] ${c.col}`, c] as const))('%s', (_n, cell) => {
    check(cell, actorFor(cell.col, { status: 'suspended' }), 'ACCOUNT_SUSPENDED');
  });
  it('suspended มาก่อน must_change_pin', () => {
    const a = actorFor('MEM', { status: 'suspended', mustChangePin: true });
    expect(can(a, 'self.pin.change', { type: 'none' })).toMatchObject({ allow: false, code: 'ACCOUNT_SUSPENDED' });
  });
  it('status deleted (บัญชีถูกลบ) → AUTH_REQUIRED ทุก action', () => {
    for (const c of USER_CELLS) check(c, actorFor(c.col, { status: 'deleted' }), 'AUTH_REQUIRED');
  });
});

const GROUP_RESOURCES = new Set(['group', 'member', 'invite', 'appointment']);
const GROUP_CELLS = CELLS.filter((c) => GROUP_RESOURCES.has(c.entry.resource));

describe('กลุ่มถูกลบ: NOT_FOUND ทุก action ที่ผูกกลุ่ม แม้เป็น SA (ADR 0003 §4.4)', () => {
  it.each(GROUP_CELLS.map((c) => [`${c.action} [${c.scenario}] ${c.col}`, c] as const))('%s', (_n, cell) => {
    check(cell, actorFor(cell.col), cell.col === 'AN' ? 'AUTH_REQUIRED' : 'NOT_FOUND', true);
  });
});

describe('ไม่ใช่สมาชิก: NOT_FOUND ทุก action ที่ผูกกลุ่ม (U8 — ไม่บอกว่ากลุ่มมีอยู่)', () => {
  it('ทุกช่อง NM ของ action ผูกกลุ่มใน fixture = NOT_FOUND', () => {
    const nm = GROUP_CELLS.filter((c) => c.col === 'NM');
    expect(nm.length).toBeGreaterThan(0);
    for (const c of nm) expect(c.expected, c.action).toBe('NOT_FOUND');
  });
});

describe('anonymous', () => {
  it('ทำได้เฉพาะ PUBLIC_ACTIONS', () => {
    const allowed = ACTIONS.filter((a) => {
      const entry: MatrixEntry = MATRIX[a];
      const [scenario] = Object.keys(entry.cases) as Scenario[];
      const res = resourceFor(entry, scenario as Scenario, 'AN');
      return res !== null && canAny({ kind: 'anonymous' }, a, res).allow;
    });
    expect(allowed.sort()).toEqual([...PUBLIC_ACTIONS].sort());
  });
});

// ─────────────────────────── 4. กรณีขอบที่ระบุชื่อ ───────────────────────────

const g = (actorRole: GroupRole | null): GroupCtx => ({ id: 'g-1', deleted: false, actorRole });
const user = (id: string, o: Partial<Omit<UserActor, 'kind' | 'id'>> = {}): UserActor => ({
  kind: 'user',
  id,
  isSuperAdmin: o.isSuperAdmin ?? false,
  status: o.status ?? 'active',
  mustChangePin: o.mustChangePin ?? false,
});
const sa = (id = 'sa') => user(id, { isSuperAdmin: true });

describe('กรณีขอบ', () => {
  it('Q2: SA (ไม่ใช่สมาชิก) ลบ group admin → 409 · หลังโอน admin (เป้าหมายเป็น moderator) → สำเร็จ', () => {
    const before = can(sa(), 'member.remove', { type: 'member', group: g(null), targetUserId: 'ga', targetRole: 'admin' });
    expect(before).toEqual({ allow: false, code: 'ADMIN_TRANSFER_REQUIRED', status: 409 });
    const transfer = can(sa(), 'group.transferAdmin', {
      type: 'member',
      group: g(null),
      targetUserId: 'm1',
      targetRole: 'member',
    });
    expect(transfer).toEqual({ allow: true, auditAsSuperAdmin: true });
    // ADR/ARCH §5: admin เดิมกลายเป็น moderator
    const after = can(sa(), 'member.remove', { type: 'member', group: g(null), targetUserId: 'ga', targetRole: 'moderator' });
    expect(after).toEqual({ allow: true, auditAsSuperAdmin: true });
  });

  it('D7: moderator ลบ moderator → 403 · ลบ admin → 403 · ลบ member → สำเร็จ', () => {
    const mod = user('mod');
    const res = (targetRole: GroupRole) =>
      ({ type: 'member', group: g('moderator'), targetUserId: 'x', targetRole }) as const;
    expect(can(mod, 'member.remove', res('moderator'))).toMatchObject({ allow: false, code: 'FORBIDDEN', status: 403 });
    expect(can(mod, 'member.remove', res('admin'))).toMatchObject({ allow: false, code: 'FORBIDDEN', status: 403 });
    expect(can(mod, 'member.remove', res('member'))).toEqual({ allow: true, auditAsSuperAdmin: false });
  });

  it('D8: admin ออกจากกลุ่มโดยไม่โอน → 409 · รวม SA ที่ถือ role admin', () => {
    expect(can(user('ga'), 'group.leave', { type: 'group', group: g('admin') })).toEqual({
      allow: false,
      code: 'ADMIN_TRANSFER_REQUIRED',
      status: 409,
    });
    expect(can(sa(), 'group.leave', { type: 'group', group: g('admin') })).toMatchObject({
      code: 'ADMIN_TRANSFER_REQUIRED',
    });
    // หลังโอนแล้ว (กลายเป็น moderator) ออกได้
    expect(can(user('ga'), 'group.leave', { type: 'group', group: g('moderator') })).toMatchObject({ allow: true });
  });

  it('R1 §3 ข้อ 1: SA ลบ/เปลี่ยน role ตัวเองผ่าน member.remove / member.setRole → 403 ทุก role ในกลุ่ม · ใช้ group.leave + D8 แทน', () => {
    for (const actorRole of [null, 'member', 'moderator', 'admin'] as const) {
      const targetRole: GroupRole = actorRole ?? 'member';
      for (const action of ['member.remove', 'member.setRole'] as const) {
        expect(
          can(sa('s'), action, { type: 'member', group: g(actorRole), targetUserId: 's', targetRole }),
          `${action}/${String(actorRole)}`,
        ).toEqual({ allow: false, code: 'FORBIDDEN', status: 403 });
      }
    }
    // เส้นทางที่ถูกต้อง: SA ที่เป็น admin ออกเองต้องโอนก่อน (D8) · เป็น member ออกได้
    expect(can(sa('s'), 'group.leave', { type: 'group', group: g('admin') })).toMatchObject({ code: 'ADMIN_TRANSFER_REQUIRED' });
    expect(can(sa('s'), 'group.leave', { type: 'group', group: g('member') })).toMatchObject({ allow: true });
    // SA ทำกับคนอื่นยังได้ (ไม่กระทบ Q2: เป้าหมาย admin คนอื่น → 409)
    expect(
      can(sa('s'), 'member.remove', { type: 'member', group: g('member'), targetUserId: 'x', targetRole: 'member' }),
    ).toMatchObject({ allow: true });
  });

  it('R1 §3 ข้อ 4: admin.audit.view ติดธง audit (การเปิดดู audit ถูกบันทึก) · list อื่นยังไม่ติด', () => {
    expect(can(sa(), 'admin.audit.view', { type: 'none' })).toEqual({ allow: true, auditAsSuperAdmin: true });
    for (const a of ['pinReset.list', 'admin.console.view', 'admin.user.list', 'admin.group.list'] as const) {
      expect(can(sa(), a, { type: 'none' })).toEqual({ allow: true, auditAsSuperAdmin: false });
    }
  });

  it('D4: member แก้/ยกเลิกนัดของตัวเองได้ ของคนอื่นไม่ได้', () => {
    const m = user('m');
    for (const action of ['appointment.update', 'appointment.cancel'] as const) {
      expect(can(m, action, { type: 'appointment', group: g('member'), createdBy: 'm' })).toMatchObject({ allow: true });
      expect(can(m, action, { type: 'appointment', group: g('member'), createdBy: 'other' })).toMatchObject({
        allow: false,
        code: 'FORBIDDEN',
      });
    }
  });

  it('§3 แถว 8: member เพิกถอนโค้ดของตัวเองได้ ของคนอื่นไม่ได้ · moderator ได้ทุกโค้ดในกลุ่ม', () => {
    expect(can(user('m'), 'invite.revoke', { type: 'invite', group: g('member'), createdBy: 'm' })).toMatchObject({
      allow: true,
    });
    expect(can(user('m'), 'invite.revoke', { type: 'invite', group: g('member'), createdBy: 'x' })).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(can(user('mod'), 'invite.revoke', { type: 'invite', group: g('moderator'), createdBy: 'x' })).toMatchObject({
      allow: true,
    });
  });

  it('SA ที่ไม่ใช่สมาชิก: ดูปฏิทินได้ (Q3) แต่ RSVP ไม่ได้ (FORBIDDEN ไม่ใช่ 404) และออกจากกลุ่ม = 404', () => {
    expect(can(sa(), 'group.calendar.view', { type: 'group', group: g(null) })).toEqual({
      allow: true,
      auditAsSuperAdmin: true,
    });
    expect(can(sa(), 'appointment.rsvp', { type: 'appointment', group: g(null), createdBy: 'x' })).toEqual({
      allow: false,
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(can(sa(), 'group.leave', { type: 'group', group: g(null) })).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('SA แก้/ลบ busy ของคนอื่นไม่ได้ (§3 แถว 3)', () => {
    expect(can(sa(), 'busy.update', { type: 'busy', ownerId: 'x' })).toMatchObject({ code: 'FORBIDDEN' });
    expect(can(sa(), 'busy.delete', { type: 'busy', ownerId: 'x' })).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('must_change_pin ของ SA ก็ถูกบังคับเหมือนกัน', () => {
    const s = user('s', { isSuperAdmin: true, mustChangePin: true });
    expect(can(s, 'pinReset.decide', { type: 'none' })).toMatchObject({ code: 'PIN_CHANGE_REQUIRED', status: 403 });
    expect(can(s, 'self.pin.change', { type: 'none' })).toMatchObject({ allow: true });
  });

  it('must_change_pin มาก่อน SUPER_ADMIN_ONLY และก่อนด่านกลุ่ม', () => {
    const m = user('m', { mustChangePin: true });
    expect(can(m, 'admin.audit.view', { type: 'none' })).toMatchObject({ code: 'PIN_CHANGE_REQUIRED' });
    expect(can(m, 'group.view', { type: 'group', group: g(null) })).toMatchObject({ code: 'PIN_CHANGE_REQUIRED' });
  });

  it('U13: ลบบัญชีขณะยังถือ admin กลุ่ม → 409', () => {
    expect(can(user('u'), 'self.delete', { type: 'self', holdsGroupAdmin: true })).toEqual({
      allow: false,
      code: 'ADMIN_TRANSFER_REQUIRED',
      status: 409,
    });
  });

  it('R5 §2 ข้อ 2: super admin ลบบัญชีตัวเองผ่านแอปไม่ได้ (403) ไม่ว่าจะถือ admin กลุ่มหรือไม่ — FORBIDDEN มาก่อน D8', () => {
    for (const holdsGroupAdmin of [false, true]) {
      expect(can(sa(), 'self.delete', { type: 'self', holdsGroupAdmin })).toEqual({ allow: false, code: 'FORBIDDEN', status: 403 });
    }
    // ด่านบัญชียังมาก่อน: SA ที่ต้องเปลี่ยน PIN → PIN_CHANGE_REQUIRED
    expect(can({ ...sa(), mustChangePin: true }, 'self.delete', { type: 'self', holdsGroupAdmin: false })).toMatchObject({ code: 'PIN_CHANGE_REQUIRED' });
  });

  it('R5: admin.group.view เป็น SA-only และติดธง audit', () => {
    expect(can(sa(), 'admin.group.view', { type: 'none' })).toEqual({ allow: true, auditAsSuperAdmin: true });
    expect(can(user('u'), 'admin.group.view', { type: 'none' })).toEqual({ allow: false, code: 'FORBIDDEN', status: 403 });
  });
});

// ─────────────────────────── 4b. R2-1 กฎข้ามช่องของ group/member/invite ───────────────────────────

describe('R2-1: กฎข้ามช่อง (ตรวจจากสเปก ไม่ใช่จากโค้ด)', () => {
  const MEMBER_COLS = COLUMNS.filter((c) => c !== 'AN');

  it.each(ADMIN_TARGET_NEVER_ALLOWED.map((a) => [a] as const))(
    '%s: เป้าหมายถือ role admin → ไม่ allow ให้ใครเลย (D7/D8: ต้องผ่านการโอนเท่านั้น)',
    (action) => {
      for (const col of MEMBER_COLS) {
        const group = groupFor(col);
        const d = canAny(actorFor(col), action, {
          type: 'member',
          group,
          targetUserId: OTHER_ADMIN,
          targetRole: 'admin',
        });
        expect(d.allow, `${action}/${col}`).toBe(false);
      }
    },
  );

  it('D7: moderator ลบได้เฉพาะ role ใน MOD_REMOVABLE_TARGET_ROLES (ทุก role เป้าหมายครบ)', () => {
    for (const targetRole of ['member', 'moderator', 'admin'] as const) {
      const d = can(user('mod'), 'member.remove', { type: 'member', group: g('moderator'), targetUserId: 'x', targetRole });
      const removable = (MOD_REMOVABLE_TARGET_ROLES as readonly string[]).includes(targetRole);
      expect(d.allow, targetRole).toBe(removable);
    }
  });

  it('GA ลบ moderator/member ได้ · ลบตัวเองไม่ได้ (ใช้ leave) · ไม่มีกรณี GA ลบ admin คนอื่น', () => {
    const ga = user('ga');
    for (const targetRole of ['member', 'moderator'] as const) {
      expect(can(ga, 'member.remove', { type: 'member', group: g('admin'), targetUserId: 'x', targetRole })).toEqual({
        allow: true,
        auditAsSuperAdmin: false,
      });
    }
    expect(can(ga, 'member.remove', { type: 'member', group: g('admin'), targetUserId: 'ga', targetRole: 'admin' })).toEqual({
      allow: false,
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('D8: GA ออกเอง → 409 จนกว่าจะโอน · หลังโอน (กลายเป็น moderator) ออกได้ · moderator/member ออกได้เสมอ', () => {
    expect(can(user('ga'), 'group.leave', { type: 'group', group: g('admin') })).toMatchObject({ code: 'ADMIN_TRANSFER_REQUIRED', status: 409 });
    for (const role of ['moderator', 'member'] as const) {
      expect(can(user('u'), 'group.leave', { type: 'group', group: g(role) })).toEqual({ allow: true, auditAsSuperAdmin: false });
    }
  });

  it('โอน admin: GA โอนให้ member/moderator ได้ · ให้ตัวเอง/admin ไม่ได้ · MOD/MEM โอนไม่ได้ · NM 404', () => {
    const res = (role: GroupRole | null, targetUserId: string, targetRole: GroupRole) =>
      ({ type: 'member', group: g(role), targetUserId, targetRole }) as const;
    expect(can(user('ga'), 'group.transferAdmin', res('admin', 'x', 'member'))).toMatchObject({ allow: true });
    expect(can(user('ga'), 'group.transferAdmin', res('admin', 'x', 'moderator'))).toMatchObject({ allow: true });
    expect(can(user('ga'), 'group.transferAdmin', res('admin', 'ga', 'admin'))).toMatchObject({ code: 'FORBIDDEN' });
    expect(can(user('mod'), 'group.transferAdmin', res('moderator', 'x', 'member'))).toMatchObject({ code: 'FORBIDDEN' });
    expect(can(user('mem'), 'group.transferAdmin', res('member', 'x', 'member'))).toMatchObject({ code: 'FORBIDDEN' });
    expect(can(user('nm'), 'group.transferAdmin', res(null, 'x', 'member'))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('SA: ทำได้ทุกกลุ่มที่ยังอยู่ (ติดธง audit เมื่อไม่ใช่สมาชิก) ยกเว้น RSVP (403) และ leave (404)', () => {
    const exceptions = new Set<Action>(['appointment.rsvp', 'group.leave']);
    const cells = GROUP_CELLS.filter((c) => c.col === 'SA_nonmember');
    for (const c of cells) {
      const d = canAny(actorFor('SA_nonmember'), c.action, resourceFor(c.entry, c.scenario, c.col) as Resource);
      if (exceptions.has(c.action) || c.expected !== 'allow') continue;
      expect(d, `${c.action}/${c.scenario}`).toEqual({ allow: true, auditAsSuperAdmin: true });
    }
    // action จัดการกลุ่มทั้งหมดที่ SA นอกกลุ่มทำได้ต้องมีใน fixture จริง
    const allowed = cells.filter((c) => c.expected === 'allow').map((c) => c.action);
    for (const a of ['group.update', 'group.delete', 'group.transferAdmin', 'member.remove', 'member.setRole', 'invite.revoke', 'invite.list'] as const) {
      expect(allowed, a).toContain(a);
    }
  });

  it('SA ไม่แตะตัวเองผ่าน member.remove/setRole/transferAdmin (403) ทุกสถานะสมาชิก', () => {
    for (const role of [null, 'member', 'moderator', 'admin'] as const) {
      for (const action of ['member.remove', 'member.setRole', 'group.transferAdmin'] as const) {
        const d = can(sa('s'), action, { type: 'member', group: g(role), targetUserId: 's', targetRole: role ?? 'member' });
        expect(d, `${action}/${String(role)}`).toEqual({ allow: false, code: 'FORBIDDEN', status: 403 });
      }
    }
  });

  it('คนนอก (NM) ได้ NOT_FOUND ไม่ใช่ FORBIDDEN กับทุก action ผูกกลุ่ม ทุก scenario (ไม่ยืนยันว่ากลุ่มมีอยู่)', () => {
    const nm = GROUP_CELLS.filter((c) => c.col === 'NM');
    for (const c of nm) {
      const d = canAny(actorFor('NM'), c.action, resourceFor(c.entry, c.scenario, c.col) as Resource);
      expect(d, `${c.action}/${c.scenario}`).toEqual({ allow: false, code: 'NOT_FOUND', status: 404 });
    }
  });

  it('invite.list: allow ให้สมาชิกทุก role + SA · NM 404 · AN 401', () => {
    for (const col of ['SA_nonmember', 'SA_member', 'GA', 'MOD', 'MEM'] as const) {
      expect(can(actorFor(col), 'invite.list', { type: 'group', group: groupFor(col) }), col).toMatchObject({ allow: true });
    }
    expect(can(actorFor('NM'), 'invite.list', { type: 'group', group: groupFor('NM') })).toMatchObject({ code: 'NOT_FOUND' });
    expect(can(actorFor('AN'), 'invite.list', { type: 'group', group: groupFor('AN') })).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('invite.list การกรองระดับแถว (can(…,invite.revoke,row)) ตรงตาราง INVITE_LIST_VISIBLE', () => {
    for (const col of ['SA_nonmember', 'SA_member', 'GA', 'MOD', 'MEM'] as const) {
      const actor = actorFor(col);
      const me = COLUMN_SPEC[col].id as string;
      const rows = [
        { id: 'own', createdBy: me },
        { id: 'other', createdBy: OTHER_USER },
      ];
      const visible = rows.filter((row) => can(actor, 'invite.revoke', { type: 'invite', group: groupFor(col), createdBy: row.createdBy }).allow).map((r) => r.id);
      const expected = [INVITE_LIST_VISIBLE[col].own && 'own', INVITE_LIST_VISIBLE[col].other && 'other'].filter(Boolean);
      expect(visible, col).toEqual(expected);
    }
  });

  it('กลุ่มถูกลบ: invite.revoke/list/leave/transfer ฯลฯ 404 เหมือนกันทุกคอลัมน์ (รวม SA — ดูคำถามถึง Lead ข้อ 1)', () => {
    for (const col of ['SA_nonmember', 'SA_member', 'GA', 'MOD', 'MEM', 'NM'] as const) {
      const group = groupFor(col, true);
      for (const [action, res] of [
        ['invite.list', { type: 'group', group }],
        ['group.leave', { type: 'group', group }],
        ['invite.revoke', { type: 'invite', group, createdBy: COLUMN_SPEC[col].id }],
        ['member.remove', { type: 'member', group, targetUserId: 'x', targetRole: 'member' }],
        ['group.transferAdmin', { type: 'member', group, targetUserId: 'x', targetRole: 'member' }],
      ] as const) {
        expect(canAny(actorFor(col), action, res as Resource), `${action}/${col}`).toEqual({ allow: false, code: 'NOT_FOUND', status: 404 });
      }
    }
  });
});

// ─────────────────────────── 5. ธง audit ของ super admin ───────────────────────────

describe('auditAsSuperAdmin (PRD §3 กติกาเสริม · ADR 0003 audit)', () => {
  it('action SA-only ที่ติดธงตรงกับรายการที่คาดหวัง', () => {
    expect([...SUPER_ADMIN_AUDITED].sort()).toEqual([...EXPECT_SA_AUDITED_SA_ONLY].sort());
    for (const a of SUPER_ADMIN_ONLY) {
      const d = canAny(sa(), a, { type: 'none' });
      expect(d, a).toEqual({ allow: true, auditAsSuperAdmin: EXPECT_SA_AUDITED_SA_ONLY.includes(a) });
    }
  });

  it('SA ที่ไม่ใช่สมาชิก: ทุก action ผูกกลุ่มที่อนุญาต → ติดธงเสมอ', () => {
    const cells = GROUP_CELLS.filter((c) => c.col === 'SA_nonmember' && c.expected === 'allow');
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      const d = canAny(actorFor('SA_nonmember'), c.action, resourceFor(c.entry, c.scenario, c.col) as Resource);
      expect(d, `${c.action}/${c.scenario}`).toEqual({ allow: true, auditAsSuperAdmin: true });
    }
  });

  it('SA ที่เป็นสมาชิก: ติดธงเฉพาะเมื่อใช้สิทธิ์ที่ role ไม่มี', () => {
    // role member ลบสมาชิกไม่ได้ → ใช้สิทธิ์ SA
    expect(
      can(sa(), 'member.remove', { type: 'member', group: g('member'), targetUserId: 'x', targetRole: 'member' }),
    ).toEqual({ allow: true, auditAsSuperAdmin: true });
    // role member ดูปฏิทินได้อยู่แล้ว → ไม่ติดธง
    expect(can(sa(), 'group.calendar.view', { type: 'group', group: g('member') })).toEqual({
      allow: true,
      auditAsSuperAdmin: false,
    });
    // SA ที่เป็น admin กลุ่มลบสมาชิก = ใช้สิทธิ์ admin → ไม่ติดธง
    expect(
      can(sa(), 'member.remove', { type: 'member', group: g('admin'), targetUserId: 'x', targetRole: 'member' }),
    ).toEqual({ allow: true, auditAsSuperAdmin: false });
  });

  it('ผู้ใช้ที่ไม่ใช่ SA ไม่ติดธงเลย', () => {
    for (const c of CELLS.filter((x) => !COLUMN_SPEC[x.col].superAdmin && x.expected === 'allow')) {
      const d = canAny(actorFor(c.col), c.action, resourceFor(c.entry, c.scenario, c.col) as Resource);
      expect(d, `${c.action}/${c.scenario}/${c.col}`).toEqual({ allow: true, auditAsSuperAdmin: false });
    }
  });
});

// ─────────────────────────── 6. authorize / PolicyError / misuse ───────────────────────────

describe('authorize()', () => {
  it('อนุญาต → คืน Allow', () => {
    expect(authorize(user('u'), 'group.create', { type: 'none' })).toEqual({ allow: true, auditAsSuperAdmin: false });
  });

  it.each([
    [{ kind: 'anonymous' } as Actor, 'group.create', 'AUTH_REQUIRED', 401],
    [user('u', { status: 'suspended' }), 'group.create', 'ACCOUNT_SUSPENDED', 401],
    [user('u', { mustChangePin: true }), 'group.create', 'PIN_CHANGE_REQUIRED', 403],
    [user('u'), 'admin.console.view', 'FORBIDDEN', 403],
  ] as const)('ปฏิเสธ → throw PolicyError (%#: %s)', (actor, action, code, status) => {
    let caught: unknown;
    try {
      authorize(actor, action, { type: 'none' });
    } catch (e) {
      caught = e;
    }
    expect(isPolicyError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(PolicyError);
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({ code, status, action, params: undefined, message: code, name: 'PolicyError' });
  });

  it('NOT_FOUND / ADMIN_TRANSFER_REQUIRED ผ่าน authorize', () => {
    expect(() => authorize(user('u'), 'group.view', { type: 'group', group: g(null) })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND', status: 404 }),
    );
    expect(() => authorize(user('u'), 'group.leave', { type: 'group', group: g('admin') })).toThrow(
      expect.objectContaining({ code: 'ADMIN_TRANSFER_REQUIRED', status: 409 }),
    );
  });

  it('ส่ง resource ผิดชนิด → RbacMisuseError (fail closed) แม้เป็น anonymous', () => {
    expect(() => canAny(sa(), 'group.view', { type: 'none' })).toThrow(RbacMisuseError);
    expect(() => canAny({ kind: 'anonymous' }, 'busy.update', { type: 'none' })).toThrow(RbacMisuseError);
  });

  it('POLICY_STATUS ตรงกับ ERROR_HTTP_STATUS ของ Platform', () => {
    for (const [code, status] of Object.entries(POLICY_STATUS)) {
      expect(ERROR_HTTP_STATUS[code as keyof typeof POLICY_STATUS], code).toBe(status);
    }
  });

  it('isAction ใช้ตรวจชื่อ action จาก manifest ได้', () => {
    expect(isAction('group.view')).toBe(true);
    expect(isAction('group.hack')).toBe(false);
  });
});

// ─────────────────────────── 7. ความบริสุทธิ์ของ src/lib/rbac ───────────────────────────

describe('src/lib/rbac/** เป็น pure (ไม่แตะ DB/env/เวลา/สุ่ม/เครือข่าย)', () => {
  const dir = join(process.cwd(), 'src/lib/rbac');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const FORBIDDEN_PATTERNS: [string, RegExp][] = [
    ['process.env', /process\.env/],
    ['Date', /\bDate\b/],
    ['clock', /\bclock\b/],
    ['Math.random', /Math\.random/],
    ['fetch', /\bfetch\s*\(/],
    ['import db/data', /from\s+['"]@\/(db|lib\/data|lib\/auth)/],
    ['drizzle/libsql', /drizzle|@libsql/],
    ['node:*', /from\s+['"]node:/],
  ];
  it.each(files)('%s', (f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const [name, re] of FORBIDDEN_PATTERNS) expect(re.test(src), `${f} มี ${name}`).toBe(false);
    // import ได้เฉพาะไฟล์ใน rbac เอง และ type จาก shared/errors
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const p of imports) expect(['./actions', './errors', './types', '@/lib/shared/errors'], `${f}: ${p}`).toContain(p);
  });
});
