// R6D G1 — PUT /api/me/current-group (คุกกี้ mm_group) · ADR 0009 §5 + Security ข้อ 7 · role × action ครบ
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOOD_PIN } from '../auth/harness';
import { Client, call, join, makeGroup, person, post, setupHarness, type Harness, type Person } from './harness';

const put = (c: Client, body: unknown, opts?: Parameters<Client['call']>[3]) => c.call<{ ok: boolean }>('PUT' as 'POST', '/api/me/current-group', body, opts);
const groupCookie = (setCookies: string[]) => setCookies.filter((s) => s.startsWith('mm_group='));

let h: Harness;
let admin: Person, mod: Person, member: Person, outsider: Person, boss: Person;
let gid: string;
let gone: string;

beforeAll(async () => {
  h = await setupHarness();
  [admin, mod, member, outsider, boss] = [await person(h, 'adm'), await person(h, 'mod'), await person(h, 'mem'), await person(h, 'out'), await person(h, 'boss', { admin: true })];
  gid = await makeGroup(admin, 'กลุ่มจำ');
  await join(admin, mod, gid);
  await join(admin, member, gid);
  expect((await call(admin.c, 'PATCH', `/api/groups/${gid}/members/${mod.id}`, { role: 'moderator' })).status).toBe(200);
  gone = await makeGroup(admin, 'กลุ่มจะลบ');
  await join(admin, member, gone);
  expect([200, 204]).toContain((await call(admin.c, 'DELETE', `/api/groups/${gone}`)).status);
});
afterAll(async () => {
  await h.cleanup();
});

describe('role × action — สมาชิกจริงเท่านั้นที่ตั้งคุกกี้ได้', () => {
  it.each([
    ['admin', () => admin],
    ['moderator', () => mod],
    ['member', () => member],
  ])('%s → 200 {ok:true} + Set-Cookie mm_group=<gid>; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly', async (_n, who) => {
    const r = await put(who().c, { gid });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toEqual({ data: { ok: true } });
    expect(groupCookie(r.setCookies)).toEqual([`mm_group=${gid}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`]);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });

  it('คนนอก / กลุ่มที่ถูกลบ (แม้เคยเป็นสมาชิก) / uuid สุ่ม → 404 NOT_FOUND ไบต์เดียวกัน · ไม่มี Set-Cookie mm_group', async () => {
    const a = await put(outsider.c, { gid });
    const b = await put(member.c, { gid: gone });
    const c = await put(member.c, { gid: '9b2b6d0e-5c55-4c0f-9d61-0f3d2a1c7e11' });
    for (const r of [a, b, c]) {
      expect(r.status).toBe(404);
      expect(r.code).toBe('NOT_FOUND');
      expect(groupCookie(r.setCookies)).toEqual([]);
    }
    expect(a.text).toBe(b.text);
    expect(b.text).toBe(c.text);
  });

  it('super admin ที่ไม่ใช่สมาชิก → ปฏิเสธ (403 FORBIDDEN ตามกฎ member.setCurrentGroup) · ไม่มี Set-Cookie', async () => {
    const r = await put(boss.c, { gid });
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
    expect(groupCookie(r.setCookies)).toEqual([]);
  });

  it('ไม่ได้ล็อกอิน → 401 · ไม่มี Set-Cookie', async () => {
    const r = await put(new Client(), { gid });
    expect(r.status).toBe(401);
    expect(groupCookie(r.setCookies)).toEqual([]);
  });
});

describe('input / CSRF', () => {
  it('Origin null / Origin ต่างโดเมน → 403 CSRF_REJECTED · ไม่มี Set-Cookie (content-type ตรวจโดย wrapper เดิม — tests/security/csrf-route)', async () => {
    const r = await put(member.c, { gid }, { headers: { origin: 'null' } });
    expect(r.status).toBe(403);
    expect(r.code).toBe('CSRF_REJECTED');
    const t = await put(member.c, { gid }, { headers: { origin: 'https://evil.example' } });
    expect(t.status).toBe(403);
    expect(t.code).toBe('CSRF_REJECTED');
    expect(groupCookie([...r.setCookies, ...t.setCookies])).toEqual([]);
  });

  it('gid ไม่ใช่ uuid / ไม่ส่ง / ฟิลด์เกิน (strict) → 400 VALIDATION ไม่สะท้อนค่า', async () => {
    const bad = await put(member.c, { gid: '<script>' });
    expect(bad.status).toBe(400);
    expect(bad.text).not.toContain('<script>');
    expect((await put(member.c, {})).status).toBe(400);
    const extra = await put(member.c, { gid, userId: outsider.id });
    expect(extra.status).toBe(400);
    expect(extra.json.error?.params).toEqual({ fields: { userId: 'UNKNOWN_FIELD' } });
  });
});

describe('rate limit + ลบบัญชีลบคุกกี้', () => {
  it('เกิน 120 ครั้ง/10 นาที/ผู้ใช้ → 429 RATE_LIMITED + Retry-After · ไม่ตั้งคุกกี้', async () => {
    const p = await person(h, 'spam');
    await join(admin, p, gid);
    for (let i = 0; i < 120; i++) expect((await put(p.c, { gid })).status).toBe(200);
    const r = await put(p.c, { gid });
    expect(r.status).toBe(429);
    expect(r.code).toBe('RATE_LIMITED');
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(groupCookie(r.setCookies)).toEqual([]);
  });

  it('POST /api/me/delete สำเร็จ → Set-Cookie mm_group=; Max-Age=0 (HttpOnly; Secure; SameSite=Lax)', async () => {
    const p = await person(h, 'leaver');
    await join(admin, p, gid);
    expect((await put(p.c, { gid })).status).toBe(200);
    expect(p.c.get('mm_group')).toBe(gid);
    const r = await post(p.c, '/api/me/delete', { pin: GOOD_PIN });
    expect(r.status, r.text).toBe(200);
    expect(groupCookie(r.setCookies)).toEqual(['mm_group=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly']);
    expect(p.c.get('mm_group')).toBeUndefined();
  });
});
