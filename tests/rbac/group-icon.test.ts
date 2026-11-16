/**
 * R15 B2 — action `group.icon.update` (ตั้งไอคอนกลุ่ม)
 * กติกา = `group.update` (เปลี่ยนชื่อกลุ่ม) ทุกช่อง: ผู้ดูแล/ผู้ช่วยดูแล ✅ · สมาชิก 403 · ไม่ใช่สมาชิก 404 · SA เหมือน rename
 */
import { describe, expect, it } from 'vitest';

import { ACTION_RESOURCE, ACTIONS, isSuperAdminAudited } from '@/lib/rbac/actions';
import { can } from '@/lib/rbac/can';
import type { Actor, GroupResource, GroupRole, UserActor } from '@/lib/rbac/types';

const ICON = 'group.icon.update' as const;
const RENAME = 'group.update' as const;

const groupRes = (actorRole: GroupRole | null, deleted = false): GroupResource => ({
  type: 'group',
  group: { id: 'g-1', deleted, actorRole },
});
const user = (o: Partial<Omit<UserActor, 'kind' | 'id'>> = {}): UserActor => ({
  kind: 'user',
  id: 'u-1',
  isSuperAdmin: o.isSuperAdmin ?? false,
  status: o.status ?? 'active',
  mustChangePin: o.mustChangePin ?? false,
});
const anon: Actor = { kind: 'anonymous' };

const ROLES = ['admin', 'moderator', 'member', null] as const;

describe('group.icon.update', () => {
  it('ลงทะเบียนแล้ว · resource = group เหมือน group.update · ไม่ใช่ action audit ของ SA', () => {
    expect(ACTIONS).toContain(ICON);
    expect(ACTION_RESOURCE[ICON]).toEqual(['group']);
    expect(ACTION_RESOURCE[ICON]).toEqual(ACTION_RESOURCE[RENAME]);
    expect(isSuperAdminAudited(ICON)).toBe(isSuperAdminAudited(RENAME));
  });

  it('admin/moderator ✅ · member 403 · ไม่ใช่สมาชิก 404 · ไม่ได้ล็อกอิน 401', () => {
    expect(can(user(), ICON, groupRes('admin')).allow).toBe(true);
    expect(can(user(), ICON, groupRes('moderator')).allow).toBe(true);
    expect(can(user(), ICON, groupRes('member'))).toEqual({ allow: false, code: 'FORBIDDEN', status: 403 });
    expect(can(user(), ICON, groupRes(null))).toEqual({ allow: false, code: 'NOT_FOUND', status: 404 });
    expect(can(anon, ICON, groupRes('admin'))).toMatchObject({ allow: false, code: 'AUTH_REQUIRED', status: 401 });
  });

  it('suspended / deleted / must_change_pin ปฏิเสธแม้เป็น admin', () => {
    expect(can(user({ status: 'suspended' }), ICON, groupRes('admin'))).toMatchObject({ allow: false, code: 'ACCOUNT_SUSPENDED' });
    expect(can(user({ status: 'deleted' }), ICON, groupRes('admin'))).toMatchObject({ allow: false, code: 'AUTH_REQUIRED' });
    expect(can(user({ mustChangePin: true }), ICON, groupRes('admin'))).toMatchObject({ allow: false, code: 'PIN_CHANGE_REQUIRED' });
  });

  it('กลุ่มถูกลบ → NOT_FOUND แม้เป็น admin หรือ SA', () => {
    expect(can(user(), ICON, groupRes('admin', true))).toMatchObject({ allow: false, code: 'NOT_FOUND' });
    expect(can(user({ isSuperAdmin: true }), ICON, groupRes(null, true))).toMatchObject({ allow: false, code: 'NOT_FOUND' });
  });

  it('ผลตรงกับ group.update ทุกช่อง (role × SA × สถานะบัญชี × กลุ่มถูกลบ)', () => {
    const actors: Actor[] = [anon];
    for (const isSuperAdmin of [false, true])
      for (const status of ['active', 'suspended', 'deleted'] as const)
        for (const mustChangePin of [false, true]) actors.push(user({ isSuperAdmin, status, mustChangePin }));
    let n = 0;
    for (const a of actors)
      for (const role of ROLES)
        for (const deleted of [false, true]) {
          const res = groupRes(role, deleted);
          expect(can(a, ICON, res), JSON.stringify({ a, role, deleted })).toEqual(can(a, RENAME, res));
          n++;
        }
    expect(n).toBe(13 * 4 * 2);
  });

  it('SA ไม่ใช่สมาชิก ✅ เหมือน rename', () => {
    const sa = user({ isSuperAdmin: true });
    expect(can(sa, ICON, groupRes(null))).toEqual(can(sa, RENAME, groupRes(null)));
    expect(can(sa, ICON, groupRes(null)).allow).toBe(true);
  });
});
