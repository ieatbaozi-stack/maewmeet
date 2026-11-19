// R16 H7 (security-r5 Info 1): คำเชิญตรงแข่งกับการลบ/ระงับบัญชีผู้รับ
//  - service ตรวจ invitee.status นอกธุรกรรม → ผู้รับถูกลบ/ระงับ "หลังตรวจ ก่อน INSERT" ต้องไม่ได้คำเชิญ
//  - จำลองแข่ง: เปลี่ยนสถานะผู้รับ (commit จริง นอกธุรกรรม) หลัง service ตรวจผู้รับแล้ว ก่อนเปิดธุรกรรม INSERT
//    — hook ที่ findGroupById ซึ่ง service เรียกหลังตรวจผู้รับ/คูลดาวน์ และก่อน inTx
//  - ผล: 404 USER_NOT_FOUND ไบต์เดียวกับ username ที่ไม่มี · ไม่มีแถวคำเชิญ / แจ้งเตือน / audit / outbox
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbOrTx } from '@/db/client';
import { getDb } from '@/db/client';
import { insertDirectInvite } from '@/lib/data/repos/group-invite';
import { GROUP_LIMITS } from '@/lib/shared/limits';
import { makeGroup, person, post, setupHarness, type Harness, type Person } from './harness';

const hook = vi.hoisted(() => ({ status: null as null | 'deleted' | 'suspended', userId: '' }));
vi.mock('@/lib/data/repos/group', async (orig) => {
  const mod = await orig<typeof import('@/lib/data/repos/group')>();
  return {
    ...mod,
    findGroupById: async (db: DbOrTx, groupId: string) => {
      if (hook.status) {
        await db.run(sql`UPDATE user SET status = ${hook.status} WHERE id = ${hook.userId}`);
        hook.status = null; // ครั้งเดียว
      }
      return mod.findGroupById(db, groupId);
    },
  };
});

let h: Harness;
let a: Person;
let gid: string;
beforeEach(async () => {
  hook.status = null;
  h = await setupHarness();
  a = await person(h, 'alice');
  gid = await makeGroup(a, 'ก๊วนแมว');
});
afterEach(async () => {
  hook.status = null;
  await h.cleanup();
});

const traces = async (inviteeId: string) => ({
  invites: await h.count('group_invite WHERE invitee_user_id = ?', [inviteeId]),
  notifications: await h.count('notification WHERE user_id = ?', [inviteeId]),
  audit: await h.count("audit_log WHERE action = 'invite.direct.create'"),
  outbox: await h.count('notification_outbox WHERE user_id = ?', [inviteeId]),
});

describe('H7 คำเชิญตรงแข่งกับการลบ/ระงับบัญชีผู้รับ', () => {
  it.each(['deleted', 'suspended'] as const)('ผู้รับถูก %s หลังตรวจ ก่อน INSERT → 404 USER_NOT_FOUND เหมือนไม่มีผู้ใช้ · ไม่มีร่องรอย', async (status) => {
    const b = await person(h, 'bob');
    const none = await post(a.c, `/api/groups/${gid}/invites/direct`, { username: 'nobody_here' });
    hook.userId = b.id;
    hook.status = status;
    const r = await post(a.c, `/api/groups/${gid}/invites/direct`, { username: 'bob' });
    expect(hook.status, 'hook ต้องถูกเรียก (แข่งเกิดจริง)').toBeNull();
    expect([r.status, r.code]).toEqual([404, 'USER_NOT_FOUND']);
    expect(r.text).toBe(none.text);
    expect((await h.rows<{ status: string }>('SELECT status FROM user WHERE id = ?', [b.id]))[0]!.status).toBe(status);
    expect(await traces(b.id)).toEqual({ invites: 0, notifications: 0, audit: 0, outbox: 0 });
  });

  it('ผู้รับยัง active → สร้างได้ตามปกติ (เงื่อนไขใหม่ไม่ตัดกรณีปกติ)', async () => {
    const b = await person(h, 'bob');
    const r = await post(a.c, `/api/groups/${gid}/invites/direct`, { username: 'bob' });
    expect(r.status, r.text).toBe(201);
    expect(await traces(b.id)).toMatchObject({ invites: 1, notifications: 1, audit: 1 });
  });

  it('repo: INSERT มีเงื่อนไขผู้รับในคำสั่งเดียว — ผู้รับไม่ active → invitee_gone ไม่มีแถว · ผู้รับไม่มีอยู่จริง → invitee_gone', async () => {
    const b = await person(h, 'bob');
    await h.rows("UPDATE user SET status = 'deleted' WHERE id = ?", [b.id]);
    const base = { groupId: gid, createdBy: a.id, expiresAt: h.clock.now() + GROUP_LIMITS.inviteTtlMs, inviteeCap: GROUP_LIMITS.pendingDirectInvitesPerInvitee };
    const guard = { actorId: a.id, actorRole: 'admin' as const };
    expect(await insertDirectInvite(getDb(), { ...base, id: crypto.randomUUID(), inviteeUserId: b.id }, h.clock.now(), guard)).toBe('invitee_gone');
    expect(await insertDirectInvite(getDb(), { ...base, id: crypto.randomUUID(), inviteeUserId: crypto.randomUUID() }, h.clock.now(), guard)).toBe('invitee_gone');
    expect(await h.count("group_invite WHERE kind = 'direct'")).toBe(0);
  });
});
