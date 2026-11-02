// ADR 0002 Test requirement 5 (U1): session — cookie มี HttpOnly/Secure/SameSite=Lax · DB ไม่มี token ดิบ (ค้นทุกตาราง) ·
// หมดอายุ 60 วัน · sliding ต่ออายุเมื่อเหลือ < 30 วัน · logout-all ลบทุกแถว
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCookieName, resetCookieName } from '@/lib/auth/session';
import { sha256Hex, newSessionToken, base32 } from '@/lib/auth/tokens';
import { Client, DAY, GOOD_PIN, HOUR, SESSION_COOKIE, setupHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
  await h.seedUser('alice');
  await h.seedUser('bob');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await h.cleanup();
});

type SessionRow = { id: string; user_id: string; created_at: number; expires_at: number; last_seen_at: number; user_agent: string | null };
const sessions = () => h.rows<SessionRow>('SELECT * FROM session ORDER BY created_at, id');

async function dumpAllTables(): Promise<string> {
  const tables = await h.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  let out = '';
  for (const { name } of tables) out += JSON.stringify(await h.rows(`SELECT * FROM "${name}"`));
  return out;
}

describe('cookie + token', () => {
  it('login ตั้ง cookie: HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=60 วัน · ไม่มี Domain', async () => {
    const c = new Client();
    const r = await c.login('alice', GOOD_PIN);
    const sc = r.setCookies.find((s) => s.startsWith(`${SESSION_COOKIE}=`))!;
    expect(sc).toBeTruthy();
    const attrs = sc.split(';').map((s) => s.trim());
    expect(attrs).toEqual(expect.arrayContaining(['Path=/', 'Max-Age=5184000', 'SameSite=Lax', 'Secure', 'HttpOnly']));
    expect(attrs.some((a) => /^domain=/i.test(a))).toBe(false);
  });

  it('production ใช้ชื่อ __Host-mm_session / __Host-mm_reset (ต้อง Secure + Path=/ + ไม่มี Domain)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookieName()).toBe('__Host-mm_session');
    expect(resetCookieName()).toBe('__Host-mm_reset');
    const c = new Client();
    const r = await c.login('alice', GOOD_PIN);
    expect(r.status).toBe(200);
    expect(r.setCookies.some((s) => s.startsWith('__Host-mm_session='))).toBe(true);
    expect((await c.getJson('/api/auth/session')).status).toBe(200); // อ่านกลับด้วยชื่อ __Host- ได้
    vi.unstubAllEnvs();
    expect(sessionCookieName()).toBe('mm_session');
  });

  it('DB ไม่มี token ดิบ: ค้นหา token ในทุกตาราง (ทุกแถว) ไม่เจอ · session.id = SHA-256(token) · token 160 บิต', async () => {
    const c = new Client();
    await c.login('alice', GOOD_PIN);
    const token = c.get(SESSION_COOKIE)!;
    expect(token).toMatch(/^[a-z2-7]{32}$/); // 20 ไบต์ → base32 32 ตัว
    const [row] = await sessions();
    expect(row!.id).toBe(sha256Hex(token));
    expect(row!.id).toMatch(/^[0-9a-f]{64}$/);
    expect(await dumpAllTables()).not.toContain(token);
    // และในที่ที่ผู้ใช้อาจเห็น: body ของ login ก็ไม่มี token
    const r = await new Client().login('bob', GOOD_PIN);
    expect(r.text).not.toContain(r.setCookies[0]!.split(';')[0]!.split('=')[1]!);
  });

  it('token สุ่มไม่ซ้ำ และ base32 ถูกต้อง', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newSessionToken()));
    expect(seen.size).toBe(500);
    expect(base32(Buffer.from('foobar'))).toBe('mzxw6ytboi'); // RFC 4648 test vector (ตัวพิมพ์เล็ก ไม่มี padding)
  });

  it('cookie ที่รูปผิด/เดา/ของเก่า → anonymous (401) ไม่ใช่ error', async () => {
    for (const v of ['garbage', 'a'.repeat(32), '', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', "x'; DROP TABLE session;--"]) {
      const c = new Client();
      c.set(SESSION_COOKIE, v);
      const r = await c.getJson('/api/auth/session');
      expect(r.status, v).toBe(401);
      expect(r.code).toBe('AUTH_REQUIRED');
    }
  });

  it('บันทึก user-agent ตัดที่ 200 ตัวอักษร', async () => {
    const c = new Client('10.9.9.9', 'U'.repeat(500));
    await c.login('alice', GOOD_PIN);
    const [row] = await sessions();
    expect(row!.user_agent).toHaveLength(200);
  });
});

describe('อายุ 60 วัน + sliding', () => {
  it('expires_at = now + 60 วัน · หมดอายุแล้ว (60 วัน + 1 ms) → 401 ทั้งที่ cookie ยังอยู่', async () => {
    const c = new Client();
    await c.login('alice', GOOD_PIN);
    const [row] = await sessions();
    const t0 = h.clock.now();
    expect(row!.expires_at).toBe(t0 + 60 * DAY);
    h.clock.set(t0 + 60 * DAY - 1);
    expect((await c.getJson('/api/auth/session')).status).toBe(200);
    // (ครั้งนั้นต่ออายุแล้ว — เทสต์หมดอายุใช้ session ใหม่ที่ไม่ถูกแตะ)
    const c2 = new Client();
    await c2.login('bob', GOOD_PIN);
    const t1 = h.clock.now();
    h.clock.set(t1 + 60 * DAY);
    const r = await c2.getJson('/api/auth/session');
    expect(r.status).toBe(401);
    expect(r.code).toBe('AUTH_REQUIRED');
  });

  it('sliding: เหลือ ≥ 30 วัน ไม่ต่ออายุ · เหลือ < 30 วัน ต่อเป็น now + 60 วัน และส่ง Set-Cookie ใหม่', async () => {
    const c = new Client();
    await c.login('alice', GOOD_PIN);
    const t0 = h.clock.now();
    const expiresAt0 = (await sessions())[0]!.expires_at;

    h.clock.set(t0 + 20 * DAY); // เหลือ 40 วัน
    const early = await c.getJson('/api/auth/session');
    expect(early.status).toBe(200);
    expect(early.setCookies).toHaveLength(0);
    expect((await sessions())[0]!.expires_at).toBe(expiresAt0);

    h.clock.set(t0 + 31 * DAY); // เหลือ 29 วัน (< 30)
    const renewed = await c.getJson('/api/auth/session');
    expect(renewed.status).toBe(200);
    expect((await sessions())[0]!.expires_at).toBe(t0 + 31 * DAY + 60 * DAY);
    const sc = renewed.setCookies.find((s) => s.startsWith(`${SESSION_COOKIE}=`))!;
    expect(sc).toMatch(/Max-Age=5184000/);
    expect(sc).toContain(c.get(SESSION_COOKIE)!); // token เดิม ไม่เปลี่ยน
  });

  it('last_seen_at อัปเดตไม่เกินวันละครั้ง (ประหยัด row writes)', async () => {
    const c = new Client();
    await c.login('alice', GOOD_PIN);
    const t0 = h.clock.now();
    const seen = async () => (await sessions())[0]!.last_seen_at;
    h.clock.set(t0 + 5 * HOUR);
    await c.getJson('/api/auth/session');
    expect(await seen()).toBe(t0);
    h.clock.set(t0 + 23 * HOUR);
    await c.getJson('/api/auth/session');
    expect(await seen()).toBe(t0);
    h.clock.set(t0 + 25 * HOUR);
    await c.getJson('/api/auth/session');
    expect(await seen()).toBe(t0 + 25 * HOUR);
  });
});

describe('logout / logout-all', () => {
  it('logout ลบเฉพาะ session ของเครื่องนี้ · cookie ถูกล้าง · ใช้ cookie เดิมต่อไม่ได้', async () => {
    const phone = new Client();
    const laptop = new Client();
    await phone.login('alice', GOOD_PIN);
    await laptop.login('alice', GOOD_PIN);
    const stolen = new Client();
    phone.cloneJarTo(stolen);
    const r = await phone.post('/api/auth/logout');
    expect(r.status).toBe(200);
    expect(r.setCookies.find((s) => s.startsWith(`${SESSION_COOKIE}=`))).toMatch(/Max-Age=0/);
    expect(r.setCookies.find((s) => s.startsWith('mm_group='))).toMatch(/^mm_group=;.*Max-Age=0/); // R6D G1
    expect(phone.get(SESSION_COOKIE)).toBeUndefined();
    expect(await sessions()).toHaveLength(1);
    expect((await stolen.getJson('/api/auth/session')).status).toBe(401);
    expect((await laptop.getJson('/api/auth/session')).status).toBe(200);
  });

  it('logout ตอนไม่ได้ล็อกอิน → 401 (เมทริกซ์ AN ❌)', async () => {
    expect((await new Client().post('/api/auth/logout')).status).toBe(401);
  });

  it('logout-all ลบทุกแถวของผู้ใช้ (ทุกเครื่อง) แต่ไม่แตะของคนอื่น', async () => {
    const a1 = new Client();
    const a2 = new Client();
    const a3 = new Client();
    const b1 = new Client();
    for (const c of [a1, a2, a3]) await c.login('alice', GOOD_PIN);
    await b1.login('bob', GOOD_PIN);
    expect(await sessions()).toHaveLength(4);
    const r = await a2.post<{ revoked: number }>('/api/auth/logout-all');
    expect(r.status).toBe(200);
    expect(r.data.revoked).toBe(3);
    expect(r.setCookies.find((s) => s.startsWith('mm_group='))).toMatch(/^mm_group=;.*Max-Age=0/); // R6D G1
    const left = await sessions();
    expect(left).toHaveLength(1);
    const [bob] = await h.rows<{ id: string }>("SELECT id FROM user WHERE username = 'bob'");
    expect(left[0]!.user_id).toBe(bob!.id);
    for (const c of [a1, a2, a3]) expect((await c.getJson('/api/auth/session')).status).toBe(401);
    expect((await b1.getJson('/api/auth/session')).status).toBe(200);
  });
});

describe('สิทธิ์อ่านสดทุก request', () => {
  it('ระงับบัญชีหลังมี session → request ถัดไปได้ ACCOUNT_SUSPENDED ทันที (status อ่านสดจาก DB)', async () => {
    const c = new Client();
    await c.login('alice', GOOD_PIN);
    await h.rows("UPDATE user SET status = 'suspended' WHERE username = 'alice'");
    const r = await c.getJson('/api/auth/session');
    expect(r.status).toBe(401);
    expect(r.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('ลบผู้ใช้ → session cascade ลบตาม', async () => {
    const c = new Client();
    await c.login('alice', GOOD_PIN);
    await h.rows("DELETE FROM user WHERE username = 'alice'");
    expect(await sessions()).toHaveLength(0);
    expect((await c.getJson('/api/auth/session')).status).toBe(401);
  });
});
