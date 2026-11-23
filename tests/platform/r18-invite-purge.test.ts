// R18 D1 — cron รายวันลบคำเชิญที่จบแล้วเกิน 30 วันถาวร (boss B1 = (ก))
//  - จบ = max(expires_at, revoked_at) · ทุกสถานะ (expired/revoked/accepted/declined) · active ที่ยังไม่หมดอายุไม่แตะ
//  - cutoff = now − 30 วันปฏิทินใน Asia/Bangkok ด้วย src/lib/calendar (addDaysAt) · ขอบ: จบตรง cutoff = ลบ · หลัง cutoff 1 ms = อยู่
//  - ชุดละ INVITE_PURGE_BATCH แถว · ไม่เกิน INVITE_PURGE_MAX_BATCHES ชุดต่อรอบ · ผล cron มี purgedInvites
//  - audit_log ที่อ้าง id คำเชิญยังอยู่และหน้า audit อ่านได้ · ลบบัญชีหลังคำเชิญถูกลบยังล้างชื่อในแจ้งเตือนของคนอื่นได้ (inviterId/inviteeId ที่ประทับไว้)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as dailyGET } from '@/app/api/cron/daily/route';
import { getDb } from '@/db/client';
import { addDaysAt, DEFAULT_TZ } from '@/lib/calendar';
import { INVITE_PURGE_BATCH, INVITE_PURGE_MAX_BATCHES, invitePurgeCutoff, purgeOldInvites } from '@/lib/data/services/maintenance';
import { INVITE_RETENTION_DAYS } from '@/lib/shared/limits';
import { DAY, GOOD_PIN, call, get, join, makeCode, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

const ORIGIN = 'https://maewmeet.test';
const NOW = Date.UTC(2026, 10, 20, 3); // 2026-11-20 10:00 BKK

let h: Harness;
let a: Person; // admin กลุ่ม
let e: Person; // สมาชิก (ผู้เชิญอีกคน)
let b: Person;
let c: Person;
let gid: string;

beforeEach(async () => {
  h = await setupHarness({ startAt: NOW });
  a = await person(h, 'alice');
  e = await person(h, 'erin');
  b = await person(h, 'bob');
  c = await person(h, 'cara');
  gid = await makeGroup(a, 'ก๊วนแมว');
  await join(a, e, gid);
});
afterEach(async () => {
  await h?.cleanup();
});

const cutoff = () => invitePurgeCutoff(h.clock.now());
const exists = async (id: string) => (await h.count('group_invite WHERE id = ?', [id])) === 1;
const setTimes = (id: string, t: { expiresAt?: number; revokedAt?: number | null; status?: string }) =>
  h.rows('UPDATE group_invite SET expires_at = COALESCE(?, expires_at), revoked_at = ?, status = COALESCE(?, status) WHERE id = ?', [
    t.expiresAt ?? null,
    t.revokedAt ?? null,
    t.status ?? null,
    id,
  ]);
const codeInviteId = async (p: Person, g = gid): Promise<string> => {
  await makeCode(p, g);
  const r = await h.rows<{ id: string }>("SELECT id FROM group_invite WHERE kind = 'code' AND group_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [g]);
  return r[0]!.id;
};
const directInvite = async (from: Person, to: Person): Promise<string> => {
  const r = await post<{ invite: { id: string } }>(from.c, `/api/groups/${gid}/invites/direct`, { username: to.username });
  expect(r.status, r.text).toBe(201);
  return r.data.invite.id;
};
const daily = async () => {
  const res = await dailyGET(new Request(`${ORIGIN}/api/cron/daily`, { method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { purgedInvites: number; purgedGroups: unknown; cleaned: Record<string, number> } }).data;
};

/** แทรกคำเชิญโค้ดตรง ๆ n แถว (ไม่ผ่าน API — ทดสอบชุด/เพดาน) */
async function bulkInsertCodeInvites(n: number, expiresAt: number, status = 'expired'): Promise<void> {
  await h.rows(
    `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < ?)
     INSERT INTO group_invite (id, group_id, kind, code_hash, code_hint, status, uses_count, created_by, created_at, expires_at)
     SELECT 'bulk-' || x, ?, 'code', 'bulkhash-' || x, 'ABCD', ?, 0, ?, ?, ? FROM cnt`,
    [n, gid, status, a.id, expiresAt - 7 * DAY, expiresAt],
  );
}

describe('D1 cutoff ใช้ lib เวลากลาง', () => {
  it('cutoff = addDaysAt(now, −30, Asia/Bangkok) · 30 วันตาม B1 · ข้ามเดือน/ปี/ปีอธิกสุรทินได้ค่าตรง', () => {
    expect(INVITE_RETENTION_DAYS).toBe(30);
    for (const now of [NOW, Date.UTC(2027, 0, 5, 17, 30), Date.UTC(2028, 2, 1, 0, 0), Date.UTC(2028, 1, 29, 16, 59)]) {
      expect(invitePurgeCutoff(now)).toBe(addDaysAt(now, -30, DEFAULT_TZ));
      expect(invitePurgeCutoff(now)).toBe(now - 30 * DAY); // Asia/Bangkok ไม่มี DST → 30 วันปฏิทิน = 30 × 24 ชม.
    }
  });
});

describe('D1 ลบคำเชิญเก่าถาวร', () => {
  it('expired/revoked/accepted/declined ที่จบเกิน 30 วัน → ลบ · ยังไม่เกิน → อยู่ · active ที่ยังไม่หมดอายุ → อยู่ · ขอบ cutoff', async () => {
    const C = cutoff();
    // หมดอายุ (โค้ด): จบตรง cutoff → ลบ · จบหลัง cutoff 1 ms → อยู่
    const expiredOld = await codeInviteId(a);
    await setTimes(expiredOld, { expiresAt: C, status: 'expired' });
    const expiredNew = await codeInviteId(a);
    await setTimes(expiredNew, { expiresAt: C + 1, status: 'expired' });
    // ยกเลิก: เวลาสิ้นสุด = max(expires_at, revoked_at)
    const revokedOld = await codeInviteId(a);
    expect((await call(a.c, 'DELETE', `/api/groups/${gid}/invites/${revokedOld}`)).status).toBe(200);
    await setTimes(revokedOld, { expiresAt: C - 5 * DAY, revokedAt: C });
    const revokedRecent = await codeInviteId(a);
    expect((await call(a.c, 'DELETE', `/api/groups/${gid}/invites/${revokedRecent}`)).status).toBe(200);
    await setTimes(revokedRecent, { expiresAt: C - 5 * DAY, revokedAt: C + 1 }); // หมดอายุนานแล้วแต่ยกเลิกหลัง cutoff → ยังอยู่
    // รับ / ปฏิเสธ ผ่าน API จริง
    const accepted = await directInvite(a, b);
    expect((await post(b.c, `/api/me/invites/${accepted}/accept`)).status).toBe(200);
    await setTimes(accepted, { expiresAt: C - 1 });
    const declined = await directInvite(a, c);
    expect((await post(c.c, `/api/me/invites/${declined}/decline`)).status).toBe(200);
    await setTimes(declined, { expiresAt: C - 1 });
    // active ยังไม่หมดอายุ (เพิ่งสร้าง — หมดอายุอีก 7 วัน)
    const activeFresh = await codeInviteId(a);
    // active ที่หมดอายุไปนานแล้วแต่ยังไม่ถูกเปลี่ยนสถานะ = จบแล้ว → ลบ
    const activeStale = await codeInviteId(a);
    await setTimes(activeStale, { expiresAt: C - DAY });

    expect(await h.rows('SELECT status FROM group_invite WHERE id IN (?, ?)', [accepted, declined])).toHaveLength(2);
    const n = await purgeOldInvites(getDb(), h.clock.now());
    expect(n).toBe(5);
    for (const id of [expiredOld, revokedOld, accepted, declined, activeStale]) expect(await exists(id), id).toBe(false);
    for (const id of [expiredNew, revokedRecent, activeFresh]) expect(await exists(id), id).toBe(true);
    expect(await h.rows('SELECT status FROM group_invite WHERE id = ?', [activeFresh])).toEqual([{ status: 'active' }]);
    // โค้ดที่ยัง active ใช้ได้ต่อ · สมาชิกที่รับคำเชิญยังเป็นสมาชิก
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [gid, b.id])).toBe(1);
    // รันซ้ำ = ไม่มีอะไรเปลี่ยน
    expect(await purgeOldInvites(getDb(), h.clock.now())).toBe(0);
    expect(await h.count('group_invite')).toBe(4); // 3 ข้างบน + โค้ดของ join() ใน beforeEach (active)
  });

  it('cron รายวัน: ผลมี purgedInvites (จำนวน) · รอบสองเป็น 0', async () => {
    const old = await codeInviteId(a);
    await setTimes(old, { expiresAt: cutoff() - DAY });
    const keep = await codeInviteId(a);
    const r1 = await daily();
    expect(r1.purgedInvites).toBe(1);
    expect(r1).toHaveProperty('purgedGroups');
    expect(await exists(old)).toBe(false);
    expect(await exists(keep)).toBe(true);
    expect((await daily()).purgedInvites).toBe(0);
  });

  it(`ชุดละ ${INVITE_PURGE_BATCH} · เพดาน ${INVITE_PURGE_MAX_BATCHES} ชุดต่อรอบ → ที่เหลือไปรอบถัดไป`, async () => {
    const cap = INVITE_PURGE_BATCH * INVITE_PURGE_MAX_BATCHES;
    await bulkInsertCodeInvites(cap + 7, cutoff() - DAY);
    const keep = await codeInviteId(a);
    expect(await purgeOldInvites(getDb(), h.clock.now())).toBe(cap);
    expect(await h.count("group_invite WHERE id LIKE 'bulk-%'")).toBe(7);
    expect(await purgeOldInvites(getDb(), h.clock.now())).toBe(7);
    expect(await h.count("group_invite WHERE id LIKE 'bulk-%'")).toBe(0);
    expect(await exists(keep)).toBe(true);
  }, 60_000);

  it('ไม่ครบชุดเต็ม → หยุดในชุดเดียว (ไม่วนเปล่า)', async () => {
    await bulkInsertCodeInvites(INVITE_PURGE_BATCH + 1, cutoff() - DAY, 'revoked');
    expect(await purgeOldInvites(getDb(), h.clock.now())).toBe(INVITE_PURGE_BATCH + 1);
  });

  it('audit log ที่อ้าง id คำเชิญยังอยู่ · GET /api/admin/audit ของ SA ตอบ 200 และยังเห็น inviteId เดิม', async () => {
    const boss = await person(h, 'boss', { admin: true });
    const code = await codeInviteId(a);
    const direct = await directInvite(a, b);
    expect((await post(b.c, `/api/me/invites/${direct}/decline`)).status).toBe(200);
    await setTimes(code, { expiresAt: cutoff() - DAY, status: 'expired' });
    await setTimes(direct, { expiresAt: cutoff() - DAY });
    const auditBefore = await h.count('audit_log');
    expect(await purgeOldInvites(getDb(), h.clock.now())).toBe(2);
    expect(await h.count('audit_log')).toBe(auditBefore); // cron ไม่ลบ/ไม่เพิ่ม audit
    const r = await get<{ entries: { action: string; targetId: string; meta: Record<string, unknown> }[] }>(boss.c, '/api/admin/audit?limit=100');
    expect(r.status, r.text).toBe(200);
    const refs = r.data.entries.filter((x) => x.meta?.inviteId === code || x.meta?.inviteId === direct || x.targetId === code || x.targetId === direct);
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('D1 × ลบบัญชี: ชื่อในแจ้งเตือนของคนอื่นยังถูกล้างได้หลังคำเชิญถูกลบถาวร', () => {
  type N = { kind: string; params: Record<string, unknown> };
  const bell = async (p: Person, kind: string) =>
    (await get<{ notifications: N[] }>(p.c, '/api/me/notifications?limit=50')).data.notifications.filter((n) => n.kind === kind).map((n) => n.params);
  const deleteAccount = async (p: Person) => {
    const r = await post(p.c, '/api/me/delete', { pin: GOOD_PIN, confirmUsername: p.username });
    expect(r.status, r.text).toBe(200);
  };

  it('ผู้ถูกเชิญลบบัญชี → inviteeName ในแจ้งเตือน accepted/declined ของผู้เชิญเป็น "" · ไม่มี inviteeId ค้าง', async () => {
    const acc = await directInvite(a, b);
    expect((await post(b.c, `/api/me/invites/${acc}/accept`)).status).toBe(200);
    const dec = await directInvite(e, c);
    expect((await post(c.c, `/api/me/invites/${dec}/decline`)).status).toBe(200);
    await setTimes(acc, { expiresAt: cutoff() - DAY });
    await setTimes(dec, { expiresAt: cutoff() - DAY });
    expect(await purgeOldInvites(getDb(), h.clock.now())).toBe(2);

    // id ที่ประทับไว้เป็นคีย์ภายใน — ไม่ออกทาง API
    const before = await bell(a, 'group.invite.accepted');
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ inviteeName: b.displayName, inviteId: acc });
    expect(before[0]).not.toHaveProperty('inviteeId');
    const raw = await h.rows<{ params: string }>("SELECT params FROM notification WHERE kind = 'group.invite.accepted' AND user_id = ?", [a.id]);
    expect(JSON.parse(raw[0]!.params)).toMatchObject({ inviteeId: b.id });

    await deleteAccount(b);
    await deleteAccount(c);
    const acceptedAfter = await bell(a, 'group.invite.accepted');
    expect(acceptedAfter[0]).toMatchObject({ inviteeName: '' });
    const declinedAfter = await bell(e, 'group.invite.declined');
    expect(declinedAfter).toHaveLength(1);
    expect(declinedAfter[0]).toMatchObject({ inviteeName: '' });
    const rows = await h.rows<{ params: string }>("SELECT params FROM notification WHERE kind IN ('group.invite.accepted', 'group.invite.declined')");
    for (const r of rows) expect(JSON.parse(r.params)).not.toHaveProperty('inviteeId');
  });

  it('ผู้เชิญลบบัญชี → inviterName ในแจ้งเตือน invite.received ของผู้ถูกเชิญเป็น "" · ไม่มี inviterId ค้าง', async () => {
    const inv = await directInvite(e, c);
    expect((await post(c.c, `/api/me/invites/${inv}/decline`)).status).toBe(200);
    await setTimes(inv, { expiresAt: cutoff() - DAY });
    expect(await purgeOldInvites(getDb(), h.clock.now())).toBe(1);
    const before = await bell(c, 'group.invite.received');
    expect(before[0]).toMatchObject({ inviterName: e.displayName });
    expect(before[0]).not.toHaveProperty('inviterId');

    await deleteAccount(e);
    const after = await bell(c, 'group.invite.received');
    expect(after[0]).toMatchObject({ inviterName: '' });
    const raw = await h.rows<{ params: string }>("SELECT params FROM notification WHERE kind = 'group.invite.received' AND user_id = ?", [c.id]);
    expect(JSON.parse(raw[0]!.params)).not.toHaveProperty('inviterId');
  });

  it('คำเชิญที่ยังไม่ถูกลบ: การล้างชื่อแบบเดิม (join group_invite) ยังทำงาน · แจ้งเตือนอื่นไม่ถูกประทับ', async () => {
    const inv = await directInvite(e, c);
    const raw0 = await h.rows<{ params: string }>("SELECT params FROM notification WHERE kind = 'group.invite.received' AND user_id = ?", [c.id]);
    expect(JSON.parse(raw0[0]!.params)).not.toHaveProperty('inviterId');
    expect(await purgeOldInvites(getDb(), h.clock.now())).toBe(0);
    await deleteAccount(e);
    expect((await bell(c, 'group.invite.received'))[0]).toMatchObject({ inviterName: '', inviteId: inv });
  });
});
