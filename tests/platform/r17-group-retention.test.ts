// R17 G1/G2/G5 — กู้คืนกลุ่มที่ลบ (super admin) · ลบถาวรอัตโนมัติใน cron รายวันเมื่อครบ 30 วัน (B2: นับจากวันเริ่มใช้กติกา) · แจ้งสมาชิกตอนกู้คืน
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as dailyGET } from '@/app/api/cron/daily/route';
import { GROUP_PURGE_BATCH, GROUP_RETENTION_MS, GROUP_RETENTION_START_MS, groupPurgeAt, purgeDeletedAtCutoff, withinRestoreWindow } from '@/lib/data/group-retention';
import { getDb } from '@/db/client';
import { purgeExpiredGroups } from '@/lib/data/services/maintenance';
import { newId } from '@/lib/shared/id';
import { DAY, call, get, join, makeGroup, person, post, setupHarness, type Harness, type Person } from '../appointments/util';
import { GOOD_PIN, makeCode } from '../groups/harness';

const ORIGIN = 'https://maewmeet.test';
/** เวลาเริ่มของเทสต์ส่วนใหญ่: หลังวันเริ่มใช้กติกา 60 วัน (B2 ไม่มีผล) */
const T0 = GROUP_RETENTION_START_MS + 60 * DAY;

let h: Harness;
let a: Person; // admin กลุ่ม
let m: Person; // moderator
let b: Person; // member
let o: Person; // คนนอก
let boss: Person; // super admin (ไม่ใช่สมาชิก)
let gid: string;

const restore = (p: Person, g = gid, opts?: Parameters<typeof post>[3]) =>
  post<{ group: { id: string; restored: true; changed: boolean } }>(p.c, `/api/admin/groups/${g}/restore`, {}, opts);
const daily = async () => {
  const res = await dailyGET(new Request(`${ORIGIN}/api/cron/daily`, { method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { purgedGroups: { groups: number; remaining: boolean }; cleaned: Record<string, number> } }).data;
};
const deletedAt = async (g = gid): Promise<number | null | 'gone'> => {
  const r = (await h.rows<{ deleted_at: number | null }>('SELECT deleted_at FROM groups WHERE id = ?', [g]))[0];
  return r === undefined ? 'gone' : r.deleted_at === null ? null : Number(r.deleted_at);
};
/** ลบกลุ่มผ่าน API จริง แล้วย้อน deleted_at ตามต้องการ (เลี่ยงเลื่อนนาฬิกาจน session หมดอายุ) */
async function softDelete(g: string, at: number, by: Person = a): Promise<void> {
  expect((await call(by.c, 'DELETE', `/api/groups/${g}`)).status).toBe(200);
  await h.rows('UPDATE groups SET deleted_at = ? WHERE id = ?', [at, g]);
}

/** ข้อมูลลูกครบทุกชนิดของกลุ่ม: สมาชิก, โค้ดเชิญ, นัด + RSVP + กันเตือนซ้ำ, แจ้งเตือน (มี groupId) + คิว LINE */
async function seedChildren(g: string, admin: Person, member: Person): Promise<void> {
  await makeCode(admin, g);
  const apptId = newId();
  const now = h.clock.now();
  await h.rows(
    `INSERT INTO appointment (id, group_id, title, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at)
     VALUES (?, ?, 'นัดลับ', ?, ?, 'Asia/Bangkok', '2027-01-01', 'active', ?, ?, ?)`,
    [apptId, g, now + DAY, now + DAY + 3_600_000, admin.id, now, now],
  );
  await h.rows("INSERT INTO appointment_rsvp (appointment_id, user_id, response, updated_at) VALUES (?, ?, 'going', ?)", [apptId, member.id, now]);
  await h.rows("INSERT INTO appointment_reminder (appointment_id, kind, start_at, created_at) VALUES (?, 'appointment.reminder_1d', ?, ?)", [apptId, now + DAY, now]);
  const nid = newId();
  await h.rows("INSERT INTO notification (id, user_id, kind, params, created_at) VALUES (?, ?, 'appointment.created', ?, ?)", [
    nid,
    member.id,
    JSON.stringify({ groupId: g, groupName: 'x', appointmentId: apptId, title: 'นัดลับ', startAt: now + DAY, tz: 'Asia/Bangkok' }),
    now,
  ]);
  await h.rows("INSERT INTO notification_outbox (id, notification_id, user_id, channel, payload, status, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, 'line', ?, 'pending', 0, ?, ?)", [
    newId(),
    nid,
    member.id,
    JSON.stringify({ kind: 'appointment.reminder_1d', params: { groupId: g, appointmentId: apptId } }),
    now,
    now,
  ]);
}

/** แถวที่อ้างกลุ่ม g ในทุกตาราง (FK + JSON) */
type Refs = { groups: number; members: number; invites: number; appointments: number; rsvps: number; reminders: number; notifications: number; outbox: number };
async function refsTo(g: string): Promise<Refs> {
  return {
    groups: await h.count('groups WHERE id = ?', [g]),
    members: await h.count('group_member WHERE group_id = ?', [g]),
    invites: await h.count('group_invite WHERE group_id = ?', [g]),
    appointments: await h.count('appointment WHERE group_id = ?', [g]),
    rsvps: await h.count('appointment_rsvp WHERE appointment_id NOT IN (SELECT id FROM appointment)'),
    reminders: await h.count('appointment_reminder WHERE appointment_id NOT IN (SELECT id FROM appointment)'),
    notifications: await h.count("notification WHERE json_extract(params, '$.groupId') = ?", [g]),
    outbox: await h.count("notification_outbox WHERE json_extract(payload, '$.params.groupId') = ?", [g]),
  };
}

async function setup(startAt = T0): Promise<void> {
  h = await setupHarness({ startAt });
  a = await person(h, 'alice');
  m = await person(h, 'mod');
  b = await person(h, 'bob');
  o = await person(h, 'oscar');
  boss = await person(h, 'boss', { admin: true });
  gid = await makeGroup(a, 'ก๊วนแมว');
  for (const x of [m, b]) await join(a, x, gid);
  expect((await call(a.c, 'PATCH', `/api/groups/${gid}/members/${m.id}`, { role: 'moderator' })).status).toBe(200);
}

afterEach(async () => {
  if (h) await h.cleanup();
  h = undefined as unknown as Harness;
});

describe('group-retention (unit)', () => {
  it('B2: max(deleted_at, START) + 30 วัน · เส้นกู้ได้/ลบถาวรเป็นเส้นเดียวกัน', () => {
    const before = GROUP_RETENTION_START_MS - 100 * DAY;
    expect(groupPurgeAt(before)).toBe(GROUP_RETENTION_START_MS + GROUP_RETENTION_MS);
    const after = GROUP_RETENTION_START_MS + 5 * DAY;
    expect(groupPurgeAt(after)).toBe(after + 30 * DAY);
    for (const d of [before, after]) {
      const p = groupPurgeAt(d);
      expect(withinRestoreWindow(d, p - 1)).toBe(true);
      expect(withinRestoreWindow(d, p)).toBe(false);
      // cron: ถึงกำหนดเมื่อ deleted_at <= cutoff(now)
      const due = (now: number) => {
        const c = purgeDeletedAtCutoff(now);
        return c !== null && d <= c;
      };
      expect(due(p - 1)).toBe(false);
      expect(due(p)).toBe(true);
    }
    expect(purgeDeletedAtCutoff(GROUP_RETENTION_START_MS + GROUP_RETENTION_MS - 1)).toBeNull();
    // วันเริ่มใช้ = 00:00 Asia/Bangkok (17:00Z วันก่อนหน้า)
    expect(new Date(GROUP_RETENTION_START_MS).toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });
});

describe('G1 — POST /api/admin/groups/:gid/restore: role × action', () => {
  beforeEach(() => setup());

  it('ไม่ใช่ SA (admin/moderator/member ของกลุ่ม, คนนอก) → 403 FORBIDDEN แบบเดียวกับ route /api/admin/* อื่นทุกไบต์ · ไม่มีอะไรเปลี่ยน ไม่ audit ไม่แจ้ง', async () => {
    await softDelete(gid, T0 - DAY);
    const auditBefore = await h.count('audit_log');
    const notifBefore = await h.count('notification');
    for (const p of [a, m, b, o]) {
      const r = await restore(p);
      const other = await get(p.c, `/api/admin/groups/${gid}`);
      expect(r.status, p.username).toBe(403);
      expect(r.code).toBe('FORBIDDEN');
      expect(r.text).toBe(other.text);
      expect(r.status).toBe(other.status);
    }
    expect(await deletedAt()).toBe(T0 - DAY);
    expect(await h.count('audit_log')).toBe(auditBefore);
    expect(await h.count('notification')).toBe(notifBefore);
  });

  it('anonymous → 401 · CSRF ผิด origin → 403 CSRF_REJECTED · SA ที่ต้องเปลี่ยน PIN → 403 PIN_CHANGE_REQUIRED · SA ถูกระงับ → 401 · gid ผิดรูป → 400 · ไม่มีกลุ่ม → 404', async () => {
    await softDelete(gid, T0 - DAY);
    const { Client } = await import('../appointments/util');
    expect((await post(new Client(), `/api/admin/groups/${gid}/restore`, {})).status).toBe(401);
    expect((await restore(boss, gid, { headers: { origin: 'https://evil.test' } })).code).toBe('CSRF_REJECTED');
    expect((await restore(boss, 'not-a-uuid')).status).toBe(400);
    expect((await restore(boss, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [boss.id]);
    expect((await restore(boss)).code).toBe('PIN_CHANGE_REQUIRED');
    await h.rows("UPDATE user SET must_change_pin = 0, status = 'suspended' WHERE id = ?", [boss.id]);
    expect((await restore(boss)).code).toBe('ACCOUNT_SUSPENDED');
    expect(await deletedAt()).toBe(T0 - DAY);
    expect(await h.count("audit_log WHERE action = 'group.restore'")).toBe(0);
  });
});

describe('G1 + G5 — กู้คืนสำเร็จ', () => {
  beforeEach(() => setup());

  it('ลบมา 29 วัน → 200 changed:true · สมาชิก/นัด/คำเชิญเดิมกลับมา · audit group.restore (asSuperAdmin) · แจ้งสมาชิก active ทุกคน (ไม่มีชื่อ SA, ไม่เข้า LINE)', async () => {
    await seedChildren(gid, a, b);
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [m.id]); // สมาชิกที่ถูกระงับไม่ได้รับแจ้ง
    await softDelete(gid, T0 - 29 * DAY);
    const refsBefore = await refsTo(gid);
    expect((await get(b.c, `/api/groups/${gid}`)).status).toBe(404);
    await h.rows('DELETE FROM notification WHERE kind = ?', ['group.restored']);

    const r = await restore(boss);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ group: { id: gid, restored: true, changed: true } });
    expect(await deletedAt()).toBeNull();
    const refsAfter = await refsTo(gid);
    expect({ ...refsAfter, notifications: refsAfter.notifications - 2 }).toEqual(refsBefore); // + group.restored 2 แถว (a, b)
    expect((await get(b.c, `/api/groups/${gid}`)).status).toBe(200);

    const audits = await h.rows<{ actor_id: string; target_type: string; target_id: string; group_id: string; meta: string }>(
      "SELECT actor_id, target_type, target_id, group_id, meta FROM audit_log WHERE action = 'group.restore'",
    );
    expect(audits).toEqual([{ actor_id: boss.id, target_type: 'group', target_id: gid, group_id: gid, meta: JSON.stringify({ asSuperAdmin: true }) }]);

    const notes = await h.rows<{ user_id: string; params: string }>("SELECT user_id, params FROM notification WHERE kind = 'group.restored' ORDER BY user_id");
    expect(notes.map((n) => n.user_id).sort()).toEqual([a.id, b.id].sort());
    for (const n of notes) expect(JSON.parse(n.params)).toEqual({ groupId: gid, groupName: 'ก๊วนแมว', actorSystemAdmin: true });
    expect(JSON.stringify(notes)).not.toContain('boss');
    expect(await h.count("notification_outbox WHERE json_extract(payload, '$.kind') = 'group.restored'")).toBe(0);

    // ผู้รับเห็นในกระดิ่งผ่าน API (params สาธารณะ)
    const list = await get<{ notifications: { kind: string; params: Record<string, unknown> }[] }>(b.c, '/api/me/notifications');
    expect(list.data.notifications.find((n) => n.kind === 'group.restored')?.params).toEqual({ groupId: gid, groupName: 'ก๊วนแมว', actorSystemAdmin: true });

    // กดซ้ำ → 200 changed:false · ไม่ audit/แจ้งซ้ำ
    const again = await restore(boss);
    expect(again.data).toEqual({ group: { id: gid, restored: true, changed: false } });
    expect(await h.count("audit_log WHERE action = 'group.restore'")).toBe(1);
    expect(await h.count("notification WHERE kind = 'group.restored'")).toBe(2);
  });

  it('SA ที่เป็นสมาชิกกลุ่มเองกู้คืน → ตัวเองไม่ได้รับแจ้ง · สมาชิกคนอื่นได้ (ไม่มีชื่อ SA)', async () => {
    await join(a, boss, gid);
    await softDelete(gid, T0 - DAY);
    await h.rows('DELETE FROM notification');
    expect((await restore(boss)).status).toBe(200);
    const to = (await h.rows<{ user_id: string }>("SELECT user_id FROM notification WHERE kind = 'group.restored'")).map((r) => r.user_id).sort();
    expect(to).toEqual([a.id, m.id, b.id].sort());
  });

  it('กลุ่มที่ยังไม่ลบ → 200 changed:false (ไม่ audit ไม่แจ้ง)', async () => {
    const r = await restore(boss);
    expect(r.data).toEqual({ group: { id: gid, restored: true, changed: false } });
    expect(await h.count("audit_log WHERE action = 'group.restore'")).toBe(0);
  });
});

describe('G1 — กู้คืนไม่ได้ + เหตุผล', () => {
  beforeEach(() => setup());

  it('ครบ 30 วันพอดี (cron ยังไม่รัน) → 409 CONFLICT reason RETENTION_EXPIRED · 30 วัน − 1ms ยังกู้ได้', async () => {
    await softDelete(gid, T0 - 30 * DAY);
    const r = await restore(boss);
    expect(r.status).toBe(409);
    expect(r.json.error).toEqual({ code: 'CONFLICT', params: { reason: 'RETENTION_EXPIRED' } });
    expect(await deletedAt()).toBe(T0 - 30 * DAY);
    await h.rows('UPDATE groups SET deleted_at = ? WHERE id = ?', [T0 - 30 * DAY + 1, gid]);
    expect((await restore(boss)).status).toBe(200);
  });

  it('admin ของกลุ่มถูกระงับ → 409 NO_ACTIVE_ADMIN · คืนสถานะแล้วกู้ได้', async () => {
    await softDelete(gid, T0 - DAY);
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [a.id]);
    const r = await restore(boss);
    expect(r.json.error).toEqual({ code: 'CONFLICT', params: { reason: 'NO_ACTIVE_ADMIN' } });
    expect(await deletedAt()).toBe(T0 - DAY);
    await h.rows("UPDATE user SET status = 'active' WHERE id = ?", [a.id]);
    expect((await restore(boss)).status).toBe(200);
  });

  it('admin ลบบัญชีหลังลบกลุ่ม (สมาชิกภาพถูกล้าง) → 409 NO_ACTIVE_ADMIN', async () => {
    await softDelete(gid, T0 - DAY);
    expect((await post(a.c, '/api/me/delete', { pin: GOOD_PIN, confirmUsername: 'alice' })).status).toBe(200);
    expect((await restore(boss)).json.error).toEqual({ code: 'CONFLICT', params: { reason: 'NO_ACTIVE_ADMIN' } });
  });

  it('ลบถาวรแล้ว → 404 NOT_FOUND', async () => {
    await softDelete(gid, T0 - 30 * DAY);
    expect((await daily()).purgedGroups.groups).toBe(1);
    expect((await restore(boss)).status).toBe(404);
  });

  it('limiter เขียนของ admin (60 ครั้ง/10 นาที/ผู้ใช้) ใช้ร่วมกับ suspend/unlock → ครั้งที่ 61 = 429', async () => {
    for (let i = 0; i < 60; i++) expect((await restore(boss)).status).toBe(200);
    const r = await restore(boss);
    expect(r.status).toBe(429);
    expect(r.code).toBe('RATE_LIMITED');
  });
});

describe('G3 data — รายการ/รายละเอียดหน้า admin มี purgeAt / restorable / restoreBlockedReason', () => {
  beforeEach(() => setup());

  type G = { id: string; deletedAt: number | null; purgeAt: number | null; restorable: boolean; restoreBlockedReason: string | null };
  const listed = async (status = 'all') => (await get<{ groups: G[] }>(boss.c, `/api/admin/groups?status=${status}`)).data.groups;
  const detail = async (g = gid) => (await get<{ group: G }>(boss.c, `/api/admin/groups/${g}`)).data.group;

  it('ยังไม่ลบ: null/false/null · ลบ 29 วัน: purgeAt = deleted+30d, restorable · ครบ 30 วัน: RETENTION_EXPIRED · admin ระงับ: NO_ACTIVE_ADMIN', async () => {
    const g2 = await makeGroup(a, 'กลุ่มสอง');
    expect((await listed()).find((x) => x.id === g2)).toMatchObject({ deletedAt: null, purgeAt: null, restorable: false, restoreBlockedReason: null });
    await softDelete(gid, T0 - 29 * DAY);
    const want = { deletedAt: T0 - 29 * DAY, purgeAt: T0 + DAY, restorable: true, restoreBlockedReason: null };
    expect((await listed('deleted')).find((x) => x.id === gid)).toMatchObject(want);
    expect(await detail()).toMatchObject(want);
    await h.rows('UPDATE groups SET deleted_at = ? WHERE id = ?', [T0 - 30 * DAY, gid]);
    expect(await detail()).toMatchObject({ purgeAt: T0, restorable: false, restoreBlockedReason: 'RETENTION_EXPIRED' });
    await h.rows('UPDATE groups SET deleted_at = ? WHERE id = ?', [T0 - DAY, gid]);
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [a.id]);
    expect((await listed('deleted')).find((x) => x.id === gid)).toMatchObject({ restorable: false, restoreBlockedReason: 'NO_ACTIVE_ADMIN' });
  });
});

describe('G2 — ลบถาวรใน cron รายวัน', () => {
  beforeEach(() => setup());

  it('29 วันยังอยู่ · 30 วันหาย · ไม่มีแถวลูก/แจ้งเตือน/คิว LINE ค้าง · กลุ่มอื่นไม่ถูกแตะ · audit group.purge มีแค่ id + จำนวน', async () => {
    const keep = await makeGroup(a, 'กลุ่มที่ยังอยู่');
    await join(a, b, keep);
    await seedChildren(gid, a, b);
    await seedChildren(keep, a, b);
    const keepBefore = await refsTo(keep);

    await softDelete(gid, T0 - 29 * DAY);
    expect((await daily()).purgedGroups).toEqual({ groups: 0, remaining: false });
    expect(await deletedAt()).toBe(T0 - 29 * DAY);

    await h.rows('UPDATE groups SET deleted_at = ? WHERE id = ?', [T0 - 30 * DAY, gid]);
    const before = await refsTo(gid);
    expect(before.groups).toBe(1);
    const out = await daily();
    expect(out.purgedGroups).toEqual({ groups: 1, remaining: false });
    expect(await refsTo(gid)).toEqual({ groups: 0, members: 0, invites: 0, appointments: 0, rsvps: 0, reminders: 0, notifications: 0, outbox: 0 });
    expect(await refsTo(keep)).toEqual(keepBefore);

    const audits = await h.rows<{ actor_id: string | null; target_id: string; group_id: string; meta: string }>(
      "SELECT actor_id, target_id, group_id, meta FROM audit_log WHERE action = 'group.purge'",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: null, target_id: gid, group_id: gid });
    expect(JSON.parse(audits[0]!.meta)).toEqual({
      members: 3,
      invites: before.invites, // โค้ดเชิญตอน join 2 + seed 1
      appointments: 1,
      rsvps: 1,
      reminders: 1,
      notifications: before.notifications,
      outbox: 1,
    });
    expect(before.invites).toBe(3);
    expect(audits[0]!.meta).not.toContain('ก๊วนแมว');

    // หน้า admin: audit แสดง meta ผ่าน whitelist · ผู้กระทำ = ระบบ (null)
    const view = await get<{ entries: { action: string; actor: unknown; targetId: string; meta: Record<string, unknown> }[] }>(boss.c, '/api/admin/audit?action=group.purge');
    expect(view.status).toBe(200);
    expect(view.data.entries).toEqual([expect.objectContaining({ action: 'group.purge', actor: null, targetId: gid, meta: JSON.parse(audits[0]!.meta) })]);
    expect(JSON.stringify(view.json)).not.toContain('ก๊วนแมว');
  });

  it('idempotent: รันซ้ำ → ครั้งที่ 2 ไม่มีอะไรให้ลบ · ข้อมูลเท่าเดิม', async () => {
    await seedChildren(gid, a, b);
    await softDelete(gid, T0 - 31 * DAY);
    expect((await daily()).purgedGroups.groups).toBe(1);
    const snap = { audit: await h.count('audit_log'), groups: await h.count('groups'), notif: await h.count('notification') };
    expect((await daily()).purgedGroups).toEqual({ groups: 0, remaining: false });
    expect({ audit: await h.count('audit_log'), groups: await h.count('groups'), notif: await h.count('notification') }).toEqual(snap);
  });

  it(`ทำเป็นชุด: ${GROUP_PURGE_BATCH + 3} กลุ่มถึงกำหนด → รอบแรก ${GROUP_PURGE_BATCH} (remaining) · รอบสอง 3`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < GROUP_PURGE_BATCH + 3; i++) {
      const id = newId();
      ids.push(id);
      await h.rows("INSERT INTO groups (id, name, tz, created_by, created_at, updated_at, deleted_at, min_free_minutes) VALUES (?, ?, 'Asia/Bangkok', ?, ?, ?, ?, 240)", [
        id,
        `g${i}`,
        a.id,
        T0 - 90 * DAY,
        T0 - 90 * DAY,
        T0 - 40 * DAY + i,
      ]);
      await h.rows("INSERT INTO group_member (group_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)", [id, a.id, T0 - 90 * DAY]);
    }
    expect((await daily()).purgedGroups).toEqual({ groups: GROUP_PURGE_BATCH, remaining: true });
    expect((await daily()).purgedGroups).toEqual({ groups: 3, remaining: false });
    for (const id of ids) expect(await h.count('group_member WHERE group_id = ?', [id])).toBe(0);
    expect(await h.count("audit_log WHERE action = 'group.purge'")).toBe(GROUP_PURGE_BATCH + 3);
  });

  it('cron เก็บกวาดเดิม (cleaned) ยังทำงาน และ purgedGroups แยกออกมา', async () => {
    const out = await daily();
    expect(out.cleaned).toHaveProperty('expiredSessions');
    expect(out.purgedGroups).toEqual({ groups: 0, remaining: false });
  });
});

describe('G1 × G2 — กู้คืนแข่งกับลบถาวร', () => {
  beforeEach(() => setup());

  it('ยิงพร้อมกันหลายรอบ: ผลเป็นอย่างใดอย่างหนึ่งเสมอ (กู้ครบ หรือ ลบครบ ไม่มีแถวลูกค้าง) ไม่มีครึ่งทาง', async () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const g = await makeGroup(a, `แข่ง ${i}`);
      await join(a, b, g);
      await seedChildren(g, a, b);
      // restore ใช้เวลา T0 (ยังกู้ได้: เหลือ 1ms) · cron ใช้เวลา T0 + 1 (ถึงกำหนดพอดี)
      await softDelete(g, T0 - 30 * DAY + 1);
      const before = await refsTo(g);
      const [r, purged] = await Promise.all([restore(boss, g), purgeExpiredGroups(getDb(), T0 + 1)]);
      const after = await refsTo(g);
      const restoreAudit = await h.count("audit_log WHERE action = 'group.restore' AND target_id = ?", [g]);
      const purgeAudit = await h.count("audit_log WHERE action = 'group.purge' AND target_id = ?", [g]);
      if (r.status === 200) {
        outcomes.add('restored');
        expect(await deletedAt(g)).toBeNull();
        expect(after).toEqual(before);
        expect([restoreAudit, purgeAudit]).toEqual([1, 0]);
        expect(purged.groups).toBe(0);
      } else {
        outcomes.add('purged');
        expect(r.status).toBe(404);
        expect(after).toEqual({ groups: 0, members: 0, invites: 0, appointments: 0, rsvps: 0, reminders: 0, notifications: 0, outbox: 0 });
        expect([restoreAudit, purgeAudit]).toEqual([0, 1]);
      }
    }
    expect(outcomes.size).toBeGreaterThan(0);
  });

  it('ลำดับกำหนดได้: purge ก่อน → restore 404 · restore ก่อน → purge ไม่แตะ (deleted_at NULL)', async () => {
    await softDelete(gid, T0 - 30 * DAY + 1);
    expect((await restore(boss)).status).toBe(200);
    expect((await purgeExpiredGroups(getDb(), T0 + 1)).groups).toBe(0);
    expect(await deletedAt()).toBeNull();

    const g2 = await makeGroup(a, 'สอง');
    await softDelete(g2, T0 - 30 * DAY + 1);
    expect((await purgeExpiredGroups(getDb(), T0 + 1)).groups).toBe(1);
    expect((await restore(boss, g2)).status).toBe(404);
  });
});

describe('B2 — กลุ่มที่ลบก่อนวันเริ่มใช้กติกา นับ 30 วันจากวันเริ่มใช้', () => {
  const EDGE = GROUP_RETENTION_START_MS + GROUP_RETENTION_MS;

  it('ลบไปก่อนหน้า 100 วัน: วันแรก/29 วันหลังเริ่มใช้ยังอยู่และกู้ได้ · ครบ 30 วันหลังเริ่มใช้จึงหาย', async () => {
    await setup(GROUP_RETENTION_START_MS);
    const old = GROUP_RETENTION_START_MS - 100 * DAY;
    await softDelete(gid, old);
    expect((await daily()).purgedGroups.groups).toBe(0); // วันเริ่มใช้ (ไม่ลบของเก่าทันที)
    h.clock.set(GROUP_RETENTION_START_MS + 29 * DAY);
    expect((await daily()).purgedGroups.groups).toBe(0);
    h.clock.set(EDGE - 1);
    expect((await daily()).purgedGroups.groups).toBe(0);
    expect(await deletedAt()).toBe(old);
    h.clock.set(EDGE);
    expect((await daily()).purgedGroups.groups).toBe(1);
    expect(await deletedAt()).toBe('gone');
  });

  it('ปุ่มกู้คืนใช้เกณฑ์เดียวกัน: EDGE − 1ms กู้ได้ · EDGE → RETENTION_EXPIRED', async () => {
    await setup(EDGE - 1);
    const old = GROUP_RETENTION_START_MS - 100 * DAY;
    await softDelete(gid, old);
    const g2 = await makeGroup(a, 'สอง');
    await softDelete(g2, old);
    const d = await get<{ group: { purgeAt: number; restorable: boolean } }>(boss.c, `/api/admin/groups/${gid}`);
    expect(d.data.group).toMatchObject({ purgeAt: EDGE, restorable: true });
    expect((await restore(boss)).status).toBe(200);
    h.clock.set(EDGE);
    expect((await restore(boss, g2)).json.error).toEqual({ code: 'CONFLICT', params: { reason: 'RETENTION_EXPIRED' } });
  });
});
