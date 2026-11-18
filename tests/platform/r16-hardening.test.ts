// R16 §1 (H1–H4) — hardening ฝั่งเซิร์ฟเวอร์ (ไม่มี migration)
//  - H1: PATCH /api/groups/:gid → ถัง group:settings 30/10 นาที/ผู้ใช้ · นับหลังด่านบัญชี ก่อนด่านกลุ่ม (404/403 ก็นับ)
//  - H2: POST /api/prefs ตอนล็อกอิน → ถัง prefs:update 60/10 นาที/ผู้ใช้ · ไม่ได้ล็อกอินไม่นับ (คุกกี้ภาษา/ธีมก่อนล็อกอินใช้ได้เสมอ)
//  - H3: GET API ที่ต้องล็อกอิน → ถัง api:read 600/10 นาที/ผู้ใช้ (boss B1) · cron/health/action สาธารณะ/anonymous/non-GET ไม่นับ · 429 + Retry-After
//  - H4: คำเชิญตรงจาก super admin ที่ไม่ใช่สมาชิก → group.invite.received ไม่มีชื่อ + actorSystemAdmin: true (แบบ R15b B7)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { rateKey, type RateSpec } from '@/lib/auth/throttle';
import { readLimited, resetReadBlockMemoForTests } from '@/lib/data/read-limit';
import { windowStartOf } from '@/lib/data/repos/rate-limit-bucket';
import { isPublicAction } from '@/lib/rbac/actions';
import { API_READ_RATE_LIMIT, GROUP_SETTINGS_RATE_LIMIT, PREFS_RATE_LIMIT } from '@/lib/shared/limits';
import { Client, get, join, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

const NOW = Date.UTC(2026, 10, 18, 3); // 2026-11-18 10:00 BKK

let h: Harness;
afterEach(async () => {
  resetReadBlockMemoForTests();
  await h?.cleanup();
});

const bucketCount = async (prefix: string, userId: string): Promise<number> =>
  Number((await h.rows<{ count: number }>('SELECT count FROM rate_limit_bucket WHERE key = ?', [`${prefix}:${userId}`]))[0]?.count ?? 0);

/** ตั้งถังให้ใช้ไปแล้ว n ครั้งในหน้าต่างปัจจุบัน (ข้ามการยิงจริงหลายร้อยครั้ง — การยิงจริงมีเทสต์แยกด้านล่าง) */
async function seedBucket(spec: RateSpec, userId: string, n: number): Promise<void> {
  await h.rows('INSERT INTO rate_limit_bucket (key, window_start, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count', [
    rateKey(spec, userId),
    windowStartOf(h.clock.now(), spec.windowMs),
    n,
  ]);
}

// ───────────────────────────── H1 ─────────────────────────────
describe('H1 rate limit PATCH /api/groups/:gid (group:settings)', () => {
  let a: Person;
  let b: Person;
  let m: Person;
  let gid: string;
  beforeEach(async () => {
    h = await setupHarness({ startAt: NOW });
    [a, b, m] = [await person(h, 'alice'), await person(h, 'bob'), await person(h, 'mew')];
    gid = await makeGroup(a, 'ก๊วนแมว');
    await join(a, m, gid);
  });

  it('admin: ครบ 30 แล้ว 429 + Retry-After · ไม่เขียนชื่อ · หมดหน้าต่างแก้ได้อีก', async () => {
    const limit = GROUP_SETTINGS_RATE_LIMIT.limit;
    expect(limit).toBe(30);
    for (let i = 0; i < limit; i++) expect((await patch(a.c, `/api/groups/${gid}`, { name: `ก๊วน ${i}` })).status).toBe(200);
    const over = await patch(a.c, `/api/groups/${gid}`, { name: 'เกิน' });
    expect(over.status).toBe(429);
    expect(over.text).toBe('{"error":{"code":"RATE_LIMITED"}}');
    const ra = Number(over.headers.get('retry-after'));
    expect(ra).toBeGreaterThan(0);
    expect(ra).toBeLessThanOrEqual(GROUP_SETTINGS_RATE_LIMIT.windowMs / 1000);
    expect((await h.rows<{ name: string }>('SELECT name FROM groups WHERE id = ?', [gid]))[0]!.name).toBe(`ก๊วน ${limit - 1}`);
    h.clock.advance(GROUP_SETTINGS_RATE_LIMIT.windowMs);
    expect((await patch(a.c, `/api/groups/${gid}`, { name: 'หลังหน้าต่าง' })).status).toBe(200);
  });

  it('นับก่อน NOT_FOUND: คนนอกยิงกลุ่มคนอื่น/กลุ่มสุ่ม (404) กินโควตาจนได้ 429 · 403 ของ member ก็นับ · ถังแยกต่อผู้ใช้', async () => {
    const limit = GROUP_SETTINGS_RATE_LIMIT.limit;
    for (let i = 0; i < limit; i++) {
      const target = i % 2 ? gid : crypto.randomUUID();
      expect((await patch(b.c, `/api/groups/${target}`, { name: 'x' })).status).toBe(404);
    }
    const over = await patch(b.c, `/api/groups/${crypto.randomUUID()}`, { name: 'x' });
    expect([over.status, over.code]).toEqual([429, 'RATE_LIMITED']);
    expect(await bucketCount(GROUP_SETTINGS_RATE_LIMIT.prefix, b.id)).toBe(limit);

    for (let i = 0; i < limit; i++) expect((await patch(m.c, `/api/groups/${gid}`, { name: 'x' })).status).toBe(403);
    expect((await patch(m.c, `/api/groups/${gid}`, { name: 'x' })).status).toBe(429);

    // คนอื่นไม่โดน · ชื่อกลุ่มไม่เปลี่ยน
    expect((await patch(a.c, `/api/groups/${gid}`, { minFreeMinutes: 120 })).status).toBe(200);
    expect((await h.rows<{ name: string }>('SELECT name FROM groups WHERE id = ?', [gid]))[0]!.name).toBe('ก๊วนแมว');
  });

  it('ไม่นับ: VALIDATION ที่ route (zod) · anonymous · ด่านบัญชี must_change_pin · ถังอื่น (ไอคอน) ไม่กระทบ', async () => {
    for (let i = 0; i < 5; i++) expect((await patch(a.c, `/api/groups/${gid}`, { name: 5 })).status).toBe(400);
    expect(await bucketCount(GROUP_SETTINGS_RATE_LIMIT.prefix, a.id)).toBe(0);

    expect((await patch(new Client(), `/api/groups/${gid}`, { name: 'x' })).status).toBe(401);
    expect(await h.count("rate_limit_bucket WHERE key LIKE 'group:settings:%'")).toBe(0);

    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [b.id]);
    const pin = await patch(b.c, `/api/groups/${gid}`, { name: 'x' });
    expect([pin.status, pin.code]).toEqual([403, 'PIN_CHANGE_REQUIRED']);
    expect(await bucketCount(GROUP_SETTINGS_RATE_LIMIT.prefix, b.id)).toBe(0);

    expect((await patch(a.c, `/api/groups/${gid}`, { name: 'นับ 1' })).status).toBe(200);
    expect(await bucketCount(GROUP_SETTINGS_RATE_LIMIT.prefix, a.id)).toBe(1);
  });
});

// ───────────────────────────── H2 ─────────────────────────────
describe('H2 rate limit POST /api/prefs (prefs:update)', () => {
  const localeOf = async (id: string) => (await h.rows<{ locale: string }>('SELECT locale FROM user WHERE id = ?', [id]))[0]!.locale;

  it('ล็อกอิน: ครบ 60 แล้ว 429 + Retry-After · ไม่ตั้งคุกกี้/ไม่เขียน locale · หมดหน้าต่างใช้ได้อีก', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const limit = PREFS_RATE_LIMIT.limit;
    expect(limit).toBe(60);
    for (let i = 0; i < limit; i++) expect((await post(a.c, '/api/prefs', { theme: i % 2 ? 'dark' : 'light' })).status).toBe(200);
    expect(await localeOf(a.id)).toBe('th');
    const over = await post(a.c, '/api/prefs', { locale: 'en', theme: 'dark' });
    expect(over.status).toBe(429);
    expect(over.text).toBe('{"error":{"code":"RATE_LIMITED"}}');
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(over.setCookies.filter((c) => /^mm_(locale|theme)=/.test(c))).toEqual([]);
    expect(await localeOf(a.id)).toBe('th');
    expect(a.c.get('mm_theme')).toBe('dark'); // คุกกี้เดิม (ค่าล่าสุดที่ผ่าน) ยังอยู่ — ไม่ถูกล้าง

    h.clock.advance(PREFS_RATE_LIMIT.windowMs);
    const again = await post(a.c, '/api/prefs', { locale: 'en' });
    expect(again.status).toBe(200);
    expect(await localeOf(a.id)).toBe('en');
  });

  it('ไม่ได้ล็อกอิน: ไม่นับ (คุกกี้ภาษา/ธีมหน้า login ใช้ได้เสมอ) · ไม่มีแถวถัง · ถังของผู้ใช้อื่นไม่กระทบกัน', async () => {
    h = await setupHarness({ startAt: NOW });
    const anon = new Client();
    for (let i = 0; i < PREFS_RATE_LIMIT.limit + 10; i++) {
      const r = await post(anon, '/api/prefs', { locale: i % 2 ? 'en' : 'th' });
      expect(r.status).toBe(200);
      expect(r.setCookies.some((c) => c.startsWith('mm_locale='))).toBe(true);
    }
    expect(await h.count("rate_limit_bucket WHERE key LIKE 'prefs:update:%'")).toBe(0);

    const a = await person(h, 'alice');
    const b = await person(h, 'bob');
    await seedBucket(PREFS_RATE_LIMIT, a.id, PREFS_RATE_LIMIT.limit);
    expect((await post(a.c, '/api/prefs', { theme: 'dark' })).status).toBe(429);
    expect((await post(b.c, '/api/prefs', { theme: 'dark' })).status).toBe(200);
  });
});

// ───────────────────────────── H3 ─────────────────────────────
describe('H3 rate limit อ่านแบบ global ต่อผู้ใช้ (api:read)', () => {
  it('readLimited: GET + actor + action ไม่สาธารณะ + ผู้ใช้เท่านั้น · cron/health/public/non-GET/anonymous ไม่นับ', () => {
    expect(API_READ_RATE_LIMIT).toMatchObject({ limit: 600, windowMs: 10 * 60_000 });
    for (const e of ROUTE_MANIFEST) {
      const want = e.method === 'GET' && e.auth === 'actor' && e.action !== null && !isPublicAction(e.action);
      expect(readLimited(e.method, e.auth, e.action, true), `${e.method} ${e.path}`).toBe(want);
      expect(readLimited(e.method, e.auth, e.action, false), `${e.method} ${e.path} anonymous`).toBe(false);
    }
    const f = (m: string, p: string) => ROUTE_MANIFEST.find((e) => e.method === m && e.path === p)!;
    const no = [f('GET', '/api/cron/daily'), f('GET', '/api/cron/reminders'), f('GET', '/api/health'), f('GET', '/api/auth/pin-reset/status'), f('POST', '/api/line/webhook')];
    for (const e of no) expect(readLimited(e.method, e.auth, e.action, true), `${e.method} ${e.path}`).toBe(false);
    for (const e of [f('GET', '/api/groups'), f('GET', '/api/me/notifications'), f('GET', '/api/auth/session'), f('GET', '/api/groups/:gid/calendar')]) {
      expect(readLimited(e.method, e.auth, e.action, true), e.path).toBe(true);
    }
  });

  it('ยิงจริงพร้อมกัน 620 ครั้ง → 200 พอดี 600 · ที่เหลือ 429 RATE_LIMITED + Retry-After · ไม่มี Server-Timing ใน 429 · ผู้ใช้อื่นไม่กระทบ', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const b = await person(h, 'bob');
    const N = API_READ_RATE_LIMIT.limit + 20;
    const res = await Promise.all(Array.from({ length: N }, () => get(a.c, '/api/me/invites')));
    const ok = res.filter((r) => r.status === 200);
    const limited = res.filter((r) => r.status === 429);
    expect(ok.length).toBe(API_READ_RATE_LIMIT.limit);
    expect(limited.length).toBe(20);
    for (const r of limited) {
      expect(r.text).toBe('{"error":{"code":"RATE_LIMITED"}}');
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(r.headers.get('server-timing')).toBeNull();
    }
    expect(await bucketCount(API_READ_RATE_LIMIT.prefix, a.id)).toBe(API_READ_RATE_LIMIT.limit); // ถังมีเพดาน ไม่โตเกิน limit
    expect((await get(b.c, '/api/me/invites')).status).toBe(200);
  }, 120_000);

  it('ถังเต็ม: GET ทุก route ที่ต้องล็อกอินได้ 429 · การเขียน (POST/PATCH) และ action สาธารณะยังทำงาน · หมดหน้าต่างอ่านได้อีก', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const gid = await makeGroup(a, 'ก๊วนแมว');
    await seedBucket(API_READ_RATE_LIMIT, a.id, API_READ_RATE_LIMIT.limit - 1);
    expect((await get(a.c, `/api/groups/${gid}`)).status).toBe(200); // ช่องสุดท้าย
    for (const p of ['/api/groups', `/api/groups/${gid}`, '/api/me/notifications', '/api/auth/session', '/api/me/busy']) {
      const r = await get(a.c, p);
      expect([r.status, r.code], p).toEqual([429, 'RATE_LIMITED']);
    }
    expect((await patch(a.c, `/api/groups/${gid}`, { name: 'ยังแก้ได้' })).status).toBe(200);
    expect((await post(a.c, '/api/groups', { name: 'ยังสร้างได้' })).status).toBe(201);
    expect((await get(a.c, '/api/auth/pin-reset/status')).status).toBe(200); // action สาธารณะ ไม่นับ

    h.clock.advance(API_READ_RATE_LIMIT.windowMs);
    expect((await get(a.c, '/api/groups')).status).toBe(200);
    expect(await bucketCount(API_READ_RATE_LIMIT.prefix, a.id)).toBe(1);
  });

  it('ผู้ที่เพิ่งถูกปฏิเสธ → 429 ทันทีจนหมดหน้าต่าง (ทางลัดใน process ไม่ถาม DB)', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    await seedBucket(API_READ_RATE_LIMIT, a.id, API_READ_RATE_LIMIT.limit);
    expect((await get(a.c, '/api/groups')).status).toBe(429);
    await h.rows('DELETE FROM rate_limit_bucket WHERE key = ?', [rateKey(API_READ_RATE_LIMIT, a.id)]);
    const memo = await get(a.c, '/api/groups');
    expect(memo.status).toBe(429); // DB ว่างแล้ว แต่ยังอยู่ในหน้าต่างที่ถูกปฏิเสธ
    expect(await bucketCount(API_READ_RATE_LIMIT.prefix, a.id)).toBe(0); // ไม่แตะ DB
    h.clock.advance(API_READ_RATE_LIMIT.windowMs);
    expect((await get(a.c, '/api/groups')).status).toBe(200);
  });

  it('anonymous / cron ไม่สร้างแถวถัง', async () => {
    h = await setupHarness({ startAt: NOW });
    const anon = new Client();
    expect((await get(anon, '/api/groups')).status).toBe(401);
    expect((await get(anon, '/api/auth/pin-reset/status')).status).toBe(200);
    expect(await h.count("rate_limit_bucket WHERE key LIKE 'api:read:%'")).toBe(0);
  });
});

// ───────────────────────────── H4 ─────────────────────────────
describe('H4 คำเชิญตรงจาก super admin นอกกลุ่ม → กระดิ่งไม่มีชื่อ + actorSystemAdmin', () => {
  type N = { kind: string; params: Record<string, unknown> };
  const bell = async (p: Person) =>
    (await get<{ notifications: N[] }>(p.c, '/api/me/notifications?limit=50')).data.notifications.filter((n) => n.kind === 'group.invite.received').map((n) => n.params);

  it('SA นอกกลุ่ม → inviterName ว่าง + ธง true (ไม่มีชื่อ SA ในแถว) · สมาชิกเชิญ → ชื่อจริง + ธง false · SA ที่เป็นสมาชิก → ชื่อจริง', async () => {
    h = await setupHarness({ startAt: NOW });
    const a = await person(h, 'alice');
    const boss = await person(h, 'boss', { admin: true });
    const c = await person(h, 'carol');
    const d = await person(h, 'dave');
    const e = await person(h, 'erin');
    const gid = await makeGroup(a, 'ก๊วนแมว');

    const bySa = await post(boss.c, `/api/groups/${gid}/invites/direct`, { username: 'carol' });
    expect(bySa.status, bySa.text).toBe(201);
    const [p1] = await bell(c);
    expect(p1).toEqual({ groupId: gid, groupName: 'ก๊วนแมว', inviterName: '', inviteId: (bySa.data as { invite: { id: string } }).invite.id, actorSystemAdmin: true });
    const raw = await h.rows<{ params: string }>("SELECT params FROM notification WHERE user_id = ? AND kind = 'group.invite.received'", [c.id]);
    expect(raw[0]!.params).not.toContain(boss.displayName);

    expect((await post(a.c, `/api/groups/${gid}/invites/direct`, { username: 'dave' })).status).toBe(201);
    const [p2] = await bell(d);
    expect(p2).toMatchObject({ inviterName: a.displayName, actorSystemAdmin: false });

    const gBoss = await makeGroup(boss, 'ก๊วนบอส'); // SA เป็น admin ของกลุ่มนี้เอง → ไม่ใช่ "นอกกลุ่ม"
    expect((await post(boss.c, `/api/groups/${gBoss}/invites/direct`, { username: 'erin' })).status).toBe(201);
    const [p3] = await bell(e);
    expect(p3).toMatchObject({ inviterName: boss.displayName, actorSystemAdmin: false });
  });
});
