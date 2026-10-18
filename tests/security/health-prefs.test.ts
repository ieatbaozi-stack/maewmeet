// Security (#13) R0-20 — /api/health ไม่เปิดเผยข้อมูลภายใน + argon2 probe ไม่ใช่ช่อง DoS · /api/prefs cookie
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// นับจำนวนครั้งที่ crypto.argon2 ถูกเรียกจริง (ห่อของจริง)
const argon2Calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  const wrapped = (...args: unknown[]) => {
    argon2Calls.n++;
    return (real as unknown as { argon2: (...a: unknown[]) => unknown }).argon2(...args);
  };
  return { ...real, default: { ...real, argon2: wrapped }, argon2: wrapped };
});

import { GET as healthGET } from '@/app/api/health/route';
import { resetArgon2Cache } from '@/app/api/health/argon2';
import { POST as prefsPOST } from '@/app/api/prefs/route';
import { serializeCookie } from '@/app/api/_lib/cookies';
import { CACHE_CONTROL } from '@/app/api/_lib/route';
import { resetEnvCache } from '@/lib/shared/env';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const ORIGIN = 'https://maewmeet.test';
let t: InstalledTestDb;
beforeEach(async () => {
  t = await installTestDb();
  resetArgon2Cache();
  argon2Calls.n = 0;
});
afterEach(async () => {
  await t.cleanup();
});

const health = () => healthGET(new Request(`${ORIGIN}/api/health`));

describe('/api/health', () => {
  it('argon2 hash จริงครั้งเดียวต่อ instance แม้ยิง 50 ครั้ง (รวมพร้อมกัน)', async () => {
    await Promise.all(Array.from({ length: 25 }, health));
    for (let i = 0; i < 25; i++) await health();
    expect(argon2Calls.n).toBe(1);
  });

  it('body มีแค่ฟิลด์ตามสัญญา ไม่มีค่า env / URL ฐาน / path / stack', async () => {
    const res = await health();
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    const text = await res.text();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['argon2', 'db', 'heartbeatAgeHours', 'node', 'ok', 'pepper', 'version']);
    for (const v of Object.values(t.env)) if (v.length >= 8) expect(text).not.toContain(v); // เลขเวอร์ชัน pepper '1' สั้นเกินกว่าจะเทียบเป็นความลับ (health แสดง currentVersion ตามสัญญา)
    expect(text).not.toMatch(/file:|libsql:|turso|\/tmp|maewmeet-test|Error|at /i);
  });

  it('env เสีย → 503 โดยไม่บอกชื่อตัวแปร/ค่า และไม่ hash argon2 ซ้ำทุกครั้ง', async () => {
    const saved = process.env.APP_SECRET;
    process.env.APP_SECRET = 'not-base64-but-secretish-value!!';
    resetEnvCache();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const a = await health();
      const b = await health();
      expect(a.status).toBe(503);
      const text = await a.text();
      expect(text).not.toMatch(/APP_SECRET|secretish|CRON|TURSO/);
      expect(b.status).toBe(503);
      expect(argon2Calls.n).toBe(1);
      expect(spy.mock.calls.flat().map(String).join(' ')).not.toContain('secretish');
    } finally {
      spy.mockRestore();
      process.env.APP_SECRET = saved;
      resetEnvCache();
    }
  });
});

const prefs = (body: unknown) =>
  prefsPOST(
    new Request(`${ORIGIN}/api/prefs`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('/api/prefs cookie', () => {
  it('Set-Cookie: HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age 1 ปี · ไม่มี Domain', async () => {
    const res = await prefs({ locale: 'en', theme: 'dark' });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const c of cookies) {
      expect(c).toMatch(/^mm_(locale|theme)=(en|dark); /);
      expect(c).toContain('; HttpOnly');
      expect(c).toContain('; Secure');
      expect(c).toContain('; SameSite=Lax');
      expect(c).toContain('; Path=/');
      expect(c).toContain(`; Max-Age=${365 * 24 * 3600}`);
      expect(c).not.toMatch(/Domain=/i);
    }
  });

  it.each([
    ['ค่า ; Domain', { theme: 'dark; Domain=evil.example' }],
    ['CRLF', { theme: 'dark\r\nSet-Cookie: admin=1' }],
    ['LF', { locale: 'th\nX: y' }],
    ['ช่องว่าง', { theme: 'dark ' }],
    ['ตัวพิมพ์ใหญ่', { theme: 'DARK' }],
    ['array', { theme: ['dark'] }],
    ['object', { theme: { toString: 'dark' } }],
    ['null', { theme: null }],
    ['ฟิลด์ชื่อ cookie อื่น', { theme: 'dark', mm_session: 'x' }],
    ['__proto__', '{"__proto__":{"theme":"dark"}}'],
  ])('ค่าผิด (%s) → 400 VALIDATION และไม่มี Set-Cookie', async (_l, body) => {
    const res = await prefs(body);
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('serializeCookie ปฏิเสธชื่อ/ค่าที่ฉีด attribute หรือ header ได้', () => {
    for (const value of ['a;b', 'a\r\nb', 'a b', 'a,b', 'a"b', 'a\\b', 'ก']) {
      expect(() => serializeCookie({ name: 'x', value })).toThrow();
    }
    for (const name of ['a=b', 'a;b', 'a b', '', 'a\nb']) {
      expect(() => serializeCookie({ name, value: 'v' })).toThrow();
    }
  });
});
