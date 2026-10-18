// Security (#13) R0-20 — หา privilege escalation ใน can() ด้วย invariant ที่ต้องจริง "ทุก action × ทุก resource ที่สุ่ม"
// (เสริม tests/rbac/matrix.test.ts ที่ตรวจตาม fixture — ที่นี่ตรวจคุณสมบัติความปลอดภัยโดยไม่พึ่ง fixture)
import { describe, expect, it } from 'vitest';
import {
  ACTION_RESOURCE,
  ACTIONS,
  PIN_CHANGE_ALLOWED,
  PUBLIC_ACTIONS,
  SUPER_ADMIN_ONLY,
  type Action,
} from '@/lib/rbac/actions';
import { can } from '@/lib/rbac/can';
import type { AccountStatus, Actor, GroupCtx, GroupRole, Resource, UserActor } from '@/lib/rbac/types';

// PRNG แบบกำหนด seed — ผลซ้ำได้
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(0x5ec);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const ROLES: readonly (GroupRole | null)[] = ['admin', 'moderator', 'member', null];
const IDS = ['u1', 'u2', 'u3'];

function user(o: Partial<UserActor> = {}): UserActor {
  return { kind: 'user', id: pick(IDS), isSuperAdmin: rand() < 0.5, status: 'active', mustChangePin: false, ...o };
}
function groupCtx(o: Partial<GroupCtx> = {}): GroupCtx {
  return { id: 'g1', deleted: rand() < 0.2, actorRole: pick(ROLES), ...o };
}
function resourceOf(type: string, g?: Partial<GroupCtx>): Resource {
  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'self':
      return { type: 'self', holdsGroupAdmin: rand() < 0.5 };
    case 'group':
      return { type: 'group', group: groupCtx(g) };
    case 'member':
      return { type: 'member', group: groupCtx(g), targetUserId: pick(IDS), targetRole: pick(['admin', 'moderator', 'member'] as const) };
    case 'invite':
      return { type: 'invite', group: groupCtx(g), createdBy: pick(IDS) };
    case 'directInvite':
      return { type: 'directInvite', inviteeUserId: pick(IDS) };
    case 'appointment':
      return { type: 'appointment', group: groupCtx(g), createdBy: pick(IDS) };
    case 'busy':
      return { type: 'busy', ownerId: pick(IDS) };
    case 'ownedByUser':
      return { type: 'ownedByUser', ownerId: pick(IDS) };
    default:
      throw new Error(type);
  }
}
const GROUP_TYPES = new Set(['group', 'member', 'invite', 'appointment']);
const decide = (actor: Actor, action: Action, r: Resource) => can(actor, action, r as never);

const N = 300; // ต่อ action ต่อ invariant
const forEachSample = (fn: (action: Action, type: string) => void) => {
  for (const action of ACTIONS) for (const type of ACTION_RESOURCE[action]) for (let i = 0; i < N; i++) fn(action, type);
};

describe('invariant: สถานะบัญชี / ไม่ได้ล็อกอิน', () => {
  it('anonymous ได้เฉพาะ PUBLIC_ACTIONS', () => {
    const pub = new Set<Action>(PUBLIC_ACTIONS);
    forEachSample((action, type) => {
      const d = decide({ kind: 'anonymous' }, action, resourceOf(type));
      expect(d.allow, action).toBe(pub.has(action));
    });
  });

  it.each<AccountStatus>(['suspended', 'deleted'])('status=%s → ไม่มี action ไหนผ่าน (รวม SA, รวม public)', (status) => {
    forEachSample((action, type) => {
      expect(decide(user({ status, isSuperAdmin: true }), action, resourceOf(type)).allow, action).toBe(false);
      expect(decide(user({ status }), action, resourceOf(type)).allow, action).toBe(false);
    });
  });

  it('status ค่าแปลก (นอก union) → fail closed', () => {
    forEachSample((action, type) => {
      const a = user({ status: 'Active' as AccountStatus, isSuperAdmin: true });
      expect(decide(a, action, resourceOf(type)).allow).toBe(false);
    });
  });

  it('must_change_pin → ผ่านได้เฉพาะ 3 action แม้เป็น SA', () => {
    const ok = new Set<Action>(PIN_CHANGE_ALLOWED);
    expect([...ok].sort()).toEqual(['auth.logout', 'prefs.cookie.set', 'self.pin.change']);
    forEachSample((action, type) => {
      const d = decide(user({ mustChangePin: true, isSuperAdmin: true }), action, resourceOf(type));
      if (!ok.has(action)) expect(d.allow, action).toBe(false);
      if (!ok.has(action) && !d.allow) expect(d.code).toBe('PIN_CHANGE_REQUIRED');
    });
  });
});

describe('invariant: ขอบเขตกลุ่ม', () => {
  it('ไม่ใช่สมาชิก + ไม่ใช่ SA → ไม่มี action ผูกกลุ่มใดผ่าน และได้ 404 (ไม่บอกว่ามีกลุ่ม)', () => {
    forEachSample((action, type) => {
      if (!GROUP_TYPES.has(type)) return;
      const d = decide(user({ isSuperAdmin: false }), action, resourceOf(type, { actorRole: null }));
      expect(d.allow, action).toBe(false);
      if (!d.allow) expect(d.code, action).toBe('NOT_FOUND');
    });
  });

  it('กลุ่มถูกลบ → ไม่มี action ผูกกลุ่มใดผ่าน แม้ SA/admin', () => {
    forEachSample((action, type) => {
      if (!GROUP_TYPES.has(type)) return;
      const d = decide(user({ isSuperAdmin: rand() < 0.5 }), action, resourceOf(type, { deleted: true, actorRole: pick(ROLES) }));
      expect(d.allow, action).toBe(false);
    });
  });

  it('SA ที่ไม่ใช่สมาชิก: ทุกครั้งที่ผ่าน action ผูกกลุ่ม ต้องติดธง audit', () => {
    forEachSample((action, type) => {
      if (!GROUP_TYPES.has(type)) return;
      const d = decide(user({ isSuperAdmin: true }), action, resourceOf(type, { actorRole: null, deleted: false }));
      if (d.allow) expect(d.auditAsSuperAdmin, action).toBe(true);
    });
  });
});

describe('invariant: บทบาท', () => {
  it('SUPER_ADMIN_ONLY ไม่ผ่านสำหรับผู้ใช้ที่ไม่ใช่ SA ไม่ว่าจะถือ role อะไร', () => {
    for (const action of SUPER_ADMIN_ONLY)
      for (let i = 0; i < N; i++) expect(decide(user({ isSuperAdmin: false }), action, { type: 'none' }).allow).toBe(false);
  });

  it('busy / notification ของคนอื่น ❌ ทุกคนรวม SA (§3 แถว 3)', () => {
    for (const action of ['busy.update', 'busy.delete', 'notification.list.own', 'notification.markRead.own'] as const) {
      const type = ACTION_RESOURCE[action][0];
      expect(decide(user({ id: 'u1', isSuperAdmin: true }), action, { type, ownerId: 'u2' } as Resource).allow).toBe(false);
    }
  });

  it('member/moderator ไม่มีทางแตะ admin: ลบ/ตั้ง role/โอน ใส่เป้าหมาย admin → ไม่ผ่าน', () => {
    for (const actorRole of ['moderator', 'member'] as const)
      for (const action of ['member.remove', 'member.setRole', 'group.transferAdmin'] as const) {
        const r: Resource = { type: 'member', group: { id: 'g', deleted: false, actorRole }, targetUserId: 'u2', targetRole: 'admin' };
        expect(decide(user({ id: 'u1', isSuperAdmin: false }), action, r).allow, `${actorRole} ${action}`).toBe(false);
      }
  });

  it('moderator ทำ action ระดับ admin ไม่ได้ (setRole/transferAdmin/delete กลุ่ม)', () => {
    const g = { id: 'g', deleted: false, actorRole: 'moderator' as const };
    const mod = user({ id: 'u1', isSuperAdmin: false });
    for (const targetRole of ['member', 'moderator'] as const) {
      expect(decide(mod, 'member.setRole', { type: 'member', group: g, targetUserId: 'u2', targetRole }).allow).toBe(false);
      expect(decide(mod, 'group.transferAdmin', { type: 'member', group: g, targetUserId: 'u2', targetRole }).allow).toBe(false);
    }
    expect(decide(mod, 'group.delete', { type: 'group', group: g }).allow).toBe(false);
    // D7: moderator ลบ moderator คนอื่น ❌
    expect(decide(mod, 'member.remove', { type: 'member', group: g, targetUserId: 'u2', targetRole: 'moderator' }).allow).toBe(false);
  });

  it('Q2: SA (ทั้งเป็น/ไม่เป็นสมาชิก) ลบผู้ถือ role admin → 409 เสมอ', () => {
    for (const actorRole of ROLES) {
      const d = decide(user({ id: 'u1', isSuperAdmin: true }), 'member.remove', {
        type: 'member',
        group: { id: 'g', deleted: false, actorRole },
        targetUserId: 'u2',
        targetRole: 'admin',
      });
      expect(d).toMatchObject({ allow: false, code: 'ADMIN_TRANSFER_REQUIRED', status: 409 });
    }
  });

  it('คำเชิญตรงของคนอื่นตอบแทนไม่ได้ (รวม SA)', () => {
    expect(decide(user({ id: 'u1', isSuperAdmin: true }), 'invite.direct.respond', { type: 'directInvite', inviteeUserId: 'u2' }).allow).toBe(false);
  });
});

describe('default-deny: action ที่ไม่รู้จัก / resource ผิดชนิด', () => {
  it.each(['admin.everything', 'constructor', 'toString', '__proto__', 'hasOwnProperty', ''])(
    'action %j → ไม่คืน allow (โยน = fail closed → 500 ที่ wrapper)',
    (bad) => {
      const sa = user({ isSuperAdmin: true });
      let allowed = false;
      try {
        allowed = can(sa, bad as Action, { type: 'none' } as never).allow;
      } catch {
        allowed = false;
      }
      expect(allowed).toBe(false);
      let anonAllowed = false;
      try {
        anonAllowed = can({ kind: 'anonymous' }, bad as Action, { type: 'none' } as never).allow;
      } catch {
        anonAllowed = false;
      }
      expect(anonAllowed).toBe(false);
    },
  );

  it('resource ผิดชนิด → โยน (ไม่ allow)', () => {
    expect(() => can(user({ isSuperAdmin: true }), 'group.delete', { type: 'none' } as never)).toThrow();
  });

  it.each(['system', 'User', undefined, null])('actor.kind แปลก (%j) → ปฏิบัติเหมือน anonymous (fail closed)', (kind) => {
    const weird = { kind, id: 'x', isSuperAdmin: true, status: 'active', mustChangePin: false } as unknown as Actor;
    expect(can(weird, 'admin.user.suspend', { type: 'none' })).toMatchObject({ allow: false, code: 'AUTH_REQUIRED' });
    expect(can(weird, 'group.create', { type: 'none' }).allow).toBe(false);
    expect(can(weird, 'prefs.cookie.set', { type: 'none' }).allow).toBe(true);
  });
});
