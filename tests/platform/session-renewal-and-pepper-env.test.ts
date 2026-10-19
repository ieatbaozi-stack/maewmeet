// Platform R1: (1) route wrapper แนบ Set-Cookie ของ sliding session ให้ "ทุก" route ที่มี actor (ไม่ใช่แค่ /api/auth/session)
//              (2) pepper env ผิด/ขาด ≠ EnvError → route อื่นยังทำงาน · auth → 503 AUTH_MAINTENANCE · health → 503 (ADR 0002 §7.1, test 14)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as healthGET } from '@/app/api/health/route';
import { getEnv, loadEnv } from '@/lib/shared/env';
import { Client, DAY, GOOD_PIN, SESSION_COOKIE, setPepperEnv, setupHarness, type Harness } from '../auth/harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
  await h.seedUser('alice');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

const sessionCookies = (setCookies: string[]) => setCookies.filter((s) => s.startsWith(`${SESSION_COOKIE}=`));

describe('wrapper แนบคุกกี้ session ที่ต่ออายุ', () => {
  it('route ทั่วไป (POST /api/prefs): เหลือ ≥ 30 วัน ไม่มี Set-Cookie · เหลือ < 30 วัน มี 1 ตัว Max-Age 60 วัน token เดิม', async () => {
    const c = new Client();
    expect((await c.login('alice', GOOD_PIN)).status).toBe(200);
    const t0 = h.clock.now();
    const token = c.get(SESSION_COOKIE)!;

    h.clock.set(t0 + 20 * DAY);
    const early = await c.post('/api/prefs', { theme: 'dark' });
    expect(early.status).toBe(200);
    expect(sessionCookies(early.setCookies)).toEqual([]);

    h.clock.set(t0 + 31 * DAY);
    const late = await c.post('/api/prefs', { theme: 'dark' });
    expect(late.status).toBe(200);
    const sc = sessionCookies(late.setCookies);
    expect(sc).toHaveLength(1);
    expect(sc[0]).toContain(`${SESSION_COOKIE}=${token}`);
    expect(sc[0]).toMatch(/Max-Age=5184000/);
    expect(sc[0]).toMatch(/HttpOnly/);
    expect(sc[0]).toMatch(/Secure/);
  });

  it('/api/auth/session (handler แนบเองอยู่แล้ว) ไม่ซ้ำ — มี Set-Cookie session เพียง 1 ตัว', async () => {
    const c = new Client();
    await c.login('alice', GOOD_PIN);
    h.clock.set(h.clock.now() + 31 * DAY);
    const r = await c.getJson('/api/auth/session');
    expect(r.status).toBe(200);
    expect(sessionCookies(r.setCookies)).toHaveLength(1);
  });

  it('logout ตอน session อยู่ในช่วงต่ออายุ: เหลือเฉพาะคุกกี้ลบ (ไม่ถูกคุกกี้ต่ออายุทับ)', async () => {
    const c = new Client();
    await c.login('alice', GOOD_PIN);
    h.clock.set(h.clock.now() + 31 * DAY);
    const r = await c.post('/api/auth/logout');
    expect(r.status).toBe(200);
    const sc = sessionCookies(r.setCookies);
    expect(sc).toHaveLength(1);
    expect(sc[0]).toMatch(/Max-Age=0/);
  });

  it('ไม่มี session → ไม่มี Set-Cookie', async () => {
    const r = await new Client().post('/api/prefs', { theme: 'dark' });
    expect(sessionCookies(r.setCookies)).toEqual([]);
  });
});

describe('pepper env ผิด/ขาด ไม่ทำให้ทุก route 500', () => {
  const BAD: [string, () => void][] = [
    ['CURRENT_VERSION=abc', () => process.env.PIN_PEPPER_CURRENT_VERSION = 'abc'],
    ['CURRENT_VERSION=0', () => process.env.PIN_PEPPER_CURRENT_VERSION = '0'],
    ['CURRENT_VERSION=1.5', () => process.env.PIN_PEPPER_CURRENT_VERSION = '1.5'],
    ['ไม่มี CURRENT_VERSION', () => void delete process.env.PIN_PEPPER_CURRENT_VERSION],
    ['ไม่มี pepper เลย', () => setPepperEnv({}, null)],
    ['V1 สั้นเกินไป', () => setPepperEnv({ 1: Buffer.alloc(8).toString('base64') }, 1)],
  ];

  it.each(BAD)('%s → getEnv ไม่โยน · route มี session ใช้ได้ · login/signup 503 AUTH_MAINTENANCE · health 503', async (_n, breakIt) => {
    const alice = new Client();
    expect((await alice.login('alice', GOOD_PIN)).status).toBe(200);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    breakIt();

    expect(() => getEnv()).not.toThrow();
    expect((await alice.post('/api/prefs', { theme: 'dark' })).status).toBe(200);
    expect((await alice.getJson('/api/auth/session')).status).toBe(200);

    const login = await new Client().login('alice', GOOD_PIN);
    expect([login.status, login.code]).toEqual([503, 'AUTH_MAINTENANCE']);
    const signup = await new Client().post('/api/auth/signup', { username: 'new_one', displayName: 'N', pin: '482915', pinConfirm: '482915' });
    expect([signup.status, signup.code]).toEqual([503, 'AUTH_MAINTENANCE']);

    const health = await healthGET(new Request('https://maewmeet.test/api/health'));
    expect(health.status).toBe(503);
    expect(((await health.json()) as { ok: boolean }).ok).toBe(false);
  });

  it('pepper ปกติ → health 200', async () => {
    const health = await healthGET(new Request('https://maewmeet.test/api/health'));
    expect(health.status).toBe(200);
  });

  it('ตัวแปรต้องมีที่ไม่ใช่ pepper ยัง fail-fast: ขาด APP_SECRET → getEnv โยน', () => {
    const src = { TURSO_DATABASE_URL: 'file:./x.db', CRON_SECRET: 'x'.repeat(20), PIN_PEPPER_CURRENT_VERSION: 'abc' };
    expect(() => loadEnv(src)).toThrow(/APP_SECRET/);
    expect(() => loadEnv(src)).not.toThrow(/PIN_PEPPER/);
  });
});
