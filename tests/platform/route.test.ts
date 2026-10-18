// R0-7: route wrapper — CSRF Origin ผิด → CSRF_REJECTED · input ผิด → VALIDATION · Cache-Control ทุก response
// เรียก handler ตรง (import POST จาก route.ts แล้วส่ง Request) ไม่ต้องรัน server
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { POST as prefsPOST } from '@/app/api/prefs/route';
import { GET as dailyGET } from '@/app/api/cron/daily/route';
import { setActorResolver } from '@/app/api/_lib/actor';
import { CACHE_CONTROL, route, validationParams } from '@/app/api/_lib/route';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const ORIGIN = 'https://maewmeet.test';

let t: InstalledTestDb;
beforeEach(async () => {
  t = await installTestDb({ APP_ORIGIN: ORIGIN });
});
afterEach(async () => {
  await t.cleanup();
});

function prefsRequest(init: { origin?: string | null; contentType?: string | null; body?: string; url?: string; host?: string }) {
  const headers = new Headers();
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  if (init.contentType !== null) headers.set('content-type', init.contentType ?? 'application/json');
  if (init.host) headers.set('host', init.host);
  return new Request(init.url ?? `${ORIGIN}/api/prefs`, {
    method: 'POST',
    headers,
    body: init.body ?? JSON.stringify({ theme: 'dark' }),
  });
}

async function bodyOf(res: Response) {
  return (await res.json()) as { data?: unknown; error?: { code: string; params?: Record<string, unknown> } };
}

describe('CSRF (non-GET ต้อง Origin == APP_ORIGIN และ JSON content-type)', () => {
  it('Origin ถูก + JSON → 200', async () => {
    const res = await prefsPOST(prefsRequest({}));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
  });

  it.each([
    ['Origin ผิด host', { origin: 'https://evil.example' }],
    ['Origin ต่าง scheme', { origin: 'http://maewmeet.test' }],
    ['ไม่มี Origin', { origin: null }],
    ['Origin = null', { origin: 'null' }],
    ['content-type text/plain', { contentType: 'text/plain' }],
    ['content-type form', { contentType: 'application/x-www-form-urlencoded' }],
    ['ไม่มี content-type', { contentType: null }],
  ] as const)('%s → 403 CSRF_REJECTED', async (_label, init) => {
    const res = await prefsPOST(prefsRequest(init));
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    expect(res.headers.get('set-cookie')).toBeNull();
    const body = await bodyOf(res);
    expect(body).toEqual({ error: { code: 'CSRF_REJECTED' } });
  });

  it('dev (ไม่ตั้ง APP_ORIGIN/VERCEL_URL) → เทียบกับ host ของ request เอง', async () => {
    await t.cleanup();
    t = await installTestDb({ APP_ORIGIN: '' });
    const ok = await prefsPOST(
      prefsRequest({ origin: 'http://localhost:3000', url: 'http://localhost:3000/api/prefs', host: 'localhost:3000' }),
    );
    expect(ok.status).toBe(200);
    const bad = await prefsPOST(
      prefsRequest({ origin: 'http://evil.localhost:3000', url: 'http://localhost:3000/api/prefs', host: 'localhost:3000' }),
    );
    expect(bad.status).toBe(403);
  });
});

describe('VALIDATION', () => {
  it.each([
    ['JSON พัง', '{theme:', { _body: 'INVALID_JSON' }],
    ['body ว่าง', '', { _: 'REQUIRED' }],
    ['ค่านอก enum', JSON.stringify({ theme: 'blue' }), { theme: 'INVALID' }],
    ['ชนิดผิด', JSON.stringify({ locale: 1 }), { locale: 'INVALID' }],
    ['ฟิลด์แปลก', JSON.stringify({ theme: 'dark', admin: true }), { admin: 'UNKNOWN_FIELD' }],
  ] as const)('%s → 400 {code:VALIDATION, params:{fields}}', async (_label, body, fields) => {
    const res = await prefsPOST(prefsRequest({ body }));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    const json = await bodyOf(res);
    expect(json.error?.code).toBe('VALIDATION');
    expect(json.error?.params).toEqual({ fields });
    expect(json).not.toHaveProperty('error.message');
  });

  it('body ใหญ่เกิน 64 KiB → VALIDATION TOO_LARGE', async () => {
    const res = await prefsPOST(prefsRequest({ body: JSON.stringify({ theme: 'x'.repeat(70 * 1024) }) }));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error?.params).toEqual({ fields: { _body: 'TOO_LARGE' } });
  });

  // SEC#3: อ่าน body แบบ stream นับไบต์ — ต้องหยุดอ่าน+ยกเลิก stream เมื่อเกิน 64 KiB (ไม่ buffer ทั้งก้อน) แม้ไม่มี content-length (chunked)
  function chunkedRequest(totalBytes: number, chunkBytes = 64 * 1024, declaredLength?: number) {
    const state = { pulled: 0, cancelled: false };
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= totalBytes) return controller.close();
        const n = Math.min(chunkBytes, totalBytes - sent);
        sent += n;
        state.pulled += n;
        controller.enqueue(new Uint8Array(n).fill(0x20));
      },
      cancel() {
        state.cancelled = true;
      },
    }, { highWaterMark: 0 });
    const headers = new Headers({ origin: ORIGIN, 'content-type': 'application/json' });
    if (declaredLength !== undefined) headers.set('content-length', String(declaredLength));
    const req = new Request(`${ORIGIN}/api/prefs`, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
    return { req, state };
  }

  it('chunked 5 MB ไม่มี content-length → 400 TOO_LARGE, อ่านจริงไม่เกิน ~128 KiB แล้ว cancel stream (ไม่ buffer ทั้งก้อน)', async () => {
    const { req, state } = chunkedRequest(5 * 1024 * 1024);
    expect(req.headers.get('content-length')).toBeNull();
    const res = await prefsPOST(req);
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error?.params).toEqual({ fields: { _body: 'TOO_LARGE' } });
    expect(state.pulled).toBeLessThanOrEqual(128 * 1024);
    expect(state.cancelled).toBe(true);
  });

  it('content-length โกหก (ประกาศ 10 ไบต์ ส่งจริง 5 MB) → ยังหยุดที่ 64 KiB · ประกาศเกินเพดานตรง ๆ → ปฏิเสธโดยไม่อ่านเลย', async () => {
    const lying = chunkedRequest(5 * 1024 * 1024, 16 * 1024, 10);
    const res = await prefsPOST(lying.req);
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error?.params).toEqual({ fields: { _body: 'TOO_LARGE' } });
    expect(lying.state.pulled).toBeLessThanOrEqual(64 * 1024 + 16 * 1024);
    const declared = chunkedRequest(5 * 1024 * 1024, 64 * 1024, 5 * 1024 * 1024);
    expect((await prefsPOST(declared.req)).status).toBe(400);
    expect(declared.state.pulled).toBe(0);
  });

  it('ขอบเขตพอดี: body = 64 KiB ผ่านด่านขนาด (ไปติด zod) · 64 KiB + 1 ไบต์ → TOO_LARGE · ตัวอักษร multi-byte นับเป็นไบต์', async () => {
    const pad = (n: number) => JSON.stringify({ theme: 'dark' }).padEnd(n, ' ');
    const exact = await prefsPOST(prefsRequest({ body: pad(64 * 1024) }));
    expect(exact.status).toBe(200);
    const over = await prefsPOST(prefsRequest({ body: pad(64 * 1024 + 1) }));
    expect((await bodyOf(over)).error?.params).toEqual({ fields: { _body: 'TOO_LARGE' } });
    const thai = await prefsPOST(prefsRequest({ body: JSON.stringify({ theme: 'ก'.repeat(30 * 1024) }) })); // 30k ตัว = 90 KB
    expect((await bodyOf(thai)).error?.params).toEqual({ fields: { _body: 'TOO_LARGE' } });
  });

  it('validationParams: แปลง zod issue เป็นรหัส ไม่สะท้อนค่าที่ส่งมา', () => {
    const schema = z.object({ name: z.string().max(3), age: z.number().min(1), nested: z.object({ x: z.string() }) });
    const raw = { name: 'secret-value', age: 0 };
    const r = schema.safeParse(raw);
    expect(r.success).toBe(false);
    if (!r.success) {
      const p = validationParams(r.error, raw);
      expect(p).toEqual({ fields: { name: 'TOO_LONG', age: 'TOO_SMALL', nested: 'REQUIRED' } });
      expect(JSON.stringify(p)).not.toContain('secret-value');
    }
  });
});

describe('actor + policy (ARCHITECTURE §2 ขั้น 3–4)', () => {
  it('PolicyError จาก authorize() → status/รหัสของ policy (suspended → 401 ACCOUNT_SUSPENDED)', async () => {
    const restore = setActorResolver(async () => ({
      kind: 'user',
      id: 'u1',
      isSuperAdmin: false,
      status: 'suspended',
      mustChangePin: false,
    }));
    try {
      const res = await prefsPOST(prefsRequest({}));
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
      expect(await bodyOf(res)).toEqual({ error: { code: 'ACCOUNT_SUSPENDED' } });
    } finally {
      restore();
    }
  });

  it('must_change_pin ยังตั้ง prefs ได้ (PIN_CHANGE_ALLOWED)', async () => {
    const restore = setActorResolver(async () => ({
      kind: 'user',
      id: 'u1',
      isSuperAdmin: false,
      status: 'active',
      mustChangePin: true,
    }));
    try {
      expect((await prefsPOST(prefsRequest({}))).status).toBe(200);
    } finally {
      restore();
    }
  });
});

describe('error ที่ไม่คาดคิด → 500 UNKNOWN โดยไม่รั่วรายละเอียด', () => {
  it('ต่อ DB ไม่ได้ → {error:{code:UNKNOWN}} และ log ไม่มี URL/ข้อความภายใน', async () => {
    await t.cleanup();
    t = await installTestDb({ TURSO_DATABASE_URL: 'file:/nonexistent-dir-maewmeet/x/y.db' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await dailyGET(
        new Request(`${ORIGIN}/api/cron/daily`, { headers: { authorization: `Bearer ${t.env.CRON_SECRET}` } }),
      );
      expect(res.status).toBe(500);
      expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: { code: 'UNKNOWN' } });
      expect(text).not.toContain('nonexistent');
      const logged = spy.mock.calls.flat().join(' ');
      expect(logged).not.toContain('nonexistent-dir-maewmeet');
      expect(logged).not.toContain(t.env.CRON_SECRET!);
    } finally {
      spy.mockRestore();
    }
  });

  it('env ขาดตอน runtime → 500 UNKNOWN (log แค่ชื่อตัวแปร)', async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const { resetEnvCache } = await import('@/lib/shared/env');
    resetEnvCache();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await prefsPOST(prefsRequest({}));
      expect(res.status).toBe(500);
      expect(await bodyOf(res)).toEqual({ error: { code: 'UNKNOWN' } });
      const logged = spy.mock.calls.flat().join(' ');
      expect(logged).toContain('CRON_SECRET');
      expect(logged).not.toContain(t.env.APP_SECRET!);
    } finally {
      spy.mockRestore();
      process.env.CRON_SECRET = saved;
      resetEnvCache();
    }
  });
});

describe('manifest guard', () => {
  it('route() ที่ไม่ได้ลงทะเบียนใน manifest → โยนตอนสร้าง', () => {
    expect(() => route({ method: 'POST', path: '/api/not-registered', handler: () => null })).toThrow(/not registered/);
    expect(() => route({ method: 'GET', path: '/api/prefs', handler: () => null })).toThrow(/not registered/);
  });
});
