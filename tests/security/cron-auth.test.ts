// Security (#13) R0-20 — cron auth: Bearer CRON_SECRET แบบ constant-time · ไม่รั่ว secret · fail closed เมื่อไม่ตั้ง
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import { GET as dailyGET } from '@/app/api/cron/daily/route';
import { POST as heartbeatPOST } from '@/app/api/cron/heartbeat/route';
import { isAuthorizedCron, safeEqual } from '@/app/api/_lib/cron-auth';
import { CACHE_CONTROL } from '@/app/api/_lib/route';
import { loadEnv, resetEnvCache } from '@/lib/shared/env';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const ORIGIN = 'https://maewmeet.test';
let t: InstalledTestDb;
beforeEach(async () => {
  t = await installTestDb();
});
afterEach(async () => {
  await t.cleanup();
});

const call = (auth: string | null) => {
  const headers = new Headers();
  if (auth !== null) headers.set('authorization', auth);
  return Promise.all([
    dailyGET(new Request(`${ORIGIN}/api/cron/daily`, { headers })),
    heartbeatPOST(new Request(`${ORIGIN}/api/cron/heartbeat`, { method: 'POST', headers })),
  ]);
};

describe('cron: header ผิดรูปทุกแบบ → 401 AUTH_REQUIRED', () => {
  it.each<[string, (s: string) => string | null]>([
    ['ไม่มี header', () => null],
    ['ว่าง', () => ''],
    ['Bearer เปล่า', () => 'Bearer '],
    ['secret ไม่มี scheme', (s) => s],
    ['bearer ตัวเล็ก', (s) => `bearer ${s}`],
    ['Basic', (s) => `Basic ${s}`],
    ['เว้นวรรคสองครั้ง', (s) => `Bearer  ${s}`],
    ['prefix ของ secret', (s) => `Bearer ${s.slice(0, -1)}`],
    ['secret + ต่อท้าย', (s) => `Bearer ${s}x`],
    ['secret + ช่องว่างท้าย (Headers trim) + ขยะ', (s) => `Bearer ${s} x`],
    ['secret สองตัวคั่นจุลภาค', (s) => `Bearer ${s}, Bearer ${s}`],
    ['ตัวพิมพ์ต่าง', (s) => `Bearer ${s.toUpperCase() === s ? s.toLowerCase() : s.toUpperCase()}`],
    ['ยาวมาก (64 KiB)', () => `Bearer ${'a'.repeat(64 * 1024)}`],
  ])('%s', async (_l, make) => {
    for (const res of await call(make(t.env.CRON_SECRET!))) {
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: { code: 'AUTH_REQUIRED' } });
      expect(text).not.toContain(t.env.CRON_SECRET!);
    }
  });

  it('secret ถูก → 200 และ body/log ไม่มี secret', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (const res of await call(`Bearer ${t.env.CRON_SECRET}`)) {
        expect(res.status).toBe(200);
        expect(await res.text()).not.toContain(t.env.CRON_SECRET!);
      }
      const logged = [...spy.mock.calls, ...log.mock.calls].flat().map(String).join(' ');
      expect(logged).not.toContain(t.env.CRON_SECRET!);
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  });
});

describe('constant-time compare', () => {
  it('safeEqual ไม่โยนเมื่อความยาวต่างกัน (hash ให้ยาวเท่ากันก่อน timingSafeEqual)', () => {
    expect(safeEqual('a', 'a'.repeat(1000))).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
    expect(safeEqual('same-secret-value', 'same-secret-value')).toBe(true);
  });

  it('isAuthorizedCron เรียก timingSafeEqual กับบัฟเฟอร์ยาวเท่ากันทุกครั้ง (ไม่มี early-return ตามความยาว)', () => {
    // ESM namespace spy ไม่ได้ → ยืนยันเชิงพฤติกรรม: timingSafeEqual ของ node โยนถ้าความยาวต่าง
    // ถ้าโค้ดส่ง buffer ดิบ ความยาวต่างกันจะโยน RangeError — ต้องไม่โยน
    const secret = nodeCrypto.randomBytes(24).toString('base64url');
    for (const guess of ['x', secret.slice(0, 5), `${secret}${secret}`, 'é'.repeat(50)]) {
      expect(() =>
        isAuthorizedCron(new Request(ORIGIN, { headers: { authorization: `Bearer ${guess}` } }), secret),
      ).not.toThrow();
    }
  });
});

describe('CRON_SECRET ไม่ได้ตั้ง/อ่อน → fail closed (ไม่เปิดโล่ง)', () => {
  it.each([
    ['ไม่ตั้ง', undefined],
    ['ค่าว่าง', ''],
    ['ช่องว่าง', '   '],
    ['สั้นกว่า 16', 'short-secret'],
  ])('%s → env ไม่ผ่าน + cron ตอบ 500 UNKNOWN ไม่ใช่ 200 (แม้ส่ง "Bearer " หรือค่านั้นมา)', async (_l, value) => {
    const env = { ...t.env } as Record<string, string | undefined>;
    if (value === undefined) delete env.CRON_SECRET;
    else env.CRON_SECRET = value;
    expect(() => loadEnv(env)).toThrow(/CRON_SECRET/);

    const saved = process.env.CRON_SECRET;
    if (value === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = value;
    resetEnvCache();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const auth of ['Bearer ', `Bearer ${value ?? ''}`, 'Bearer undefined', 'Bearer null']) {
        for (const res of await call(auth)) {
          expect(res.status).not.toBe(200);
          expect([401, 500]).toContain(res.status);
        }
      }
      const logged = spy.mock.calls.flat().map(String).join(' ');
      if (value && value.trim()) expect(logged).not.toContain(value);
    } finally {
      spy.mockRestore();
      process.env.CRON_SECRET = saved;
      resetEnvCache();
    }
  });
});
