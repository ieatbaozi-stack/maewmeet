// Security (#13) R0-20 — ลองหาทางเลี่ยง CSRF ของ route wrapper + error ไม่รั่ว + Cache-Control ทุก response
// เรียก handler ตรง (ไม่รัน server) · ใช้ POST /api/prefs ซึ่งเป็น non-GET auth=actor ตัวเดียวใน R0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as prefsModule from '@/app/api/prefs/route';
import { POST as prefsPOST } from '@/app/api/prefs/route';
import { POST as heartbeatPOST } from '@/app/api/cron/heartbeat/route';
import { CACHE_CONTROL, route } from '@/app/api/_lib/route';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const ORIGIN = 'https://maewmeet.test';
let t: InstalledTestDb;

beforeEach(async () => {
  t = await installTestDb({ APP_ORIGIN: ORIGIN });
});
afterEach(async () => {
  await t.cleanup();
});

function req(headers: Headers, body: BodyInit = JSON.stringify({ theme: 'dark' }), url = `${ORIGIN}/api/prefs`) {
  return new Request(url, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
}
function h(origin: string | null, ct: string | null = 'application/json'): Headers {
  const x = new Headers();
  if (origin !== null) x.set('origin', origin);
  if (ct !== null) x.set('content-type', ct);
  return x;
}

describe('CSRF: Origin bypass attempts → 403 CSRF_REJECTED (ไม่ตั้ง cookie)', () => {
  it.each([
    ['subdomain', 'https://evil.maewmeet.test'],
    ['suffix domain', 'https://maewmeet.test.evil.example'],
    ['ต่าง port', 'https://maewmeet.test:8443'],
    ['port 443 แบบระบุ (browser ไม่ส่งรูปนี้)', 'https://maewmeet.test:443'],
    ['http แทน https', 'http://maewmeet.test'],
    ['trailing slash', 'https://maewmeet.test/'],
    ['ตัวพิมพ์ใหญ่', 'HTTPS://MAEWMEET.TEST'],
    ['มี path', 'https://maewmeet.test/api'],
    ['userinfo', 'https://maewmeet.test@evil.example'],
    ['null', 'null'],
    ['ค่าว่าง', ''],
    ['scheme อื่น', 'file://maewmeet.test'],
  ])('%s (%s)', async (_l, origin) => {
    const res = await prefsPOST(req(h(origin)));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'CSRF_REJECTED' } });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
  });

  it('Origin ซ้ำสองค่า (ถูก + ผิด) → Headers รวมเป็น "a, b" → ปฏิเสธ', async () => {
    const x = h(ORIGIN);
    x.append('origin', 'https://evil.example');
    expect((await prefsPOST(req(x))).status).toBe(403);
    const y = h('https://evil.example');
    y.append('origin', ORIGIN);
    expect((await prefsPOST(req(y))).status).toBe(403);
  });

  it('ปลอม Host/X-Forwarded-Host ให้ตรงกับ Origin ของผู้โจมตี ไม่ช่วยเมื่อมี APP_ORIGIN', async () => {
    const x = h('https://evil.example');
    x.set('host', 'evil.example');
    x.set('x-forwarded-host', 'evil.example');
    const res = await prefsPOST(req(x, undefined, 'https://evil.example/api/prefs'));
    expect(res.status).toBe(403);
  });

  it('Referer ที่ถูก แต่ไม่มี Origin → ยังปฏิเสธ (ไม่ fallback ไป Referer)', async () => {
    const x = h(null);
    x.set('referer', `${ORIGIN}/`);
    expect((await prefsPOST(req(x))).status).toBe(403);
  });
});

describe('CSRF: content-type ที่เป็น simple request หรือคลุมเครือ → 403', () => {
  it.each([
    'text/plain',
    'text/plain; charset=utf-8',
    'text/plain;application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'application/json, text/plain',
    'application/jsonx',
    'application/json-patch+json',
    'application/x-json',
    '',
  ])('%j', async (ct) => {
    const res = await prefsPOST(req(h(ORIGIN, ct)));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON'])('%j ผ่าน (ไม่ใช่ simple request)', async (ct) => {
    expect((await prefsPOST(req(h(ORIGIN, ct)))).status).toBe(200);
  });

  it('JSON ในรูป text/plain (body ถูกต้อง) ยังถูกปฏิเสธ', async () => {
    const res = await prefsPOST(req(h(ORIGIN, 'text/plain'), '{"theme":"dark"}'));
    expect(res.status).toBe(403);
  });
});

describe('CSRF ตรวจก่อนอ่าน body', () => {
  it('Origin ผิด → ไม่แตะ body stream เลย', async () => {
    let pulled = false;
    const stream = new ReadableStream({
      pull(c) {
        pulled = true;
        c.enqueue(new TextEncoder().encode('{"theme":"dark"}'));
        c.close();
      },
    }, { highWaterMark: 0 });
    const res = await prefsPOST(req(h('https://evil.example'), stream));
    expect(res.status).toBe(403);
    expect(pulled).toBe(false);
  });
});

describe('method override ไม่มีผล', () => {
  it('route module ของ prefs export เฉพาะ POST (Next ตอบ 405 ให้ method อื่นเอง)', () => {
    const methods = Object.keys(prefsModule).filter((k) => /^[A-Z]+$/.test(k));
    expect(methods).toEqual(['POST']);
  });

  it('X-HTTP-Method-Override / _method ไม่ทำให้ข้าม CSRF', async () => {
    const x = h('https://evil.example');
    x.set('x-http-method-override', 'GET');
    x.set('x-method-override', 'GET');
    expect((await prefsPOST(req(x, undefined, `${ORIGIN}/api/prefs?_method=GET`))).status).toBe(403);
  });
});

describe('ไม่มี CORS: response ไม่ส่ง Access-Control-*', () => {
  it('ทั้งกรณีสำเร็จและถูกปฏิเสธ', async () => {
    for (const res of [await prefsPOST(req(h(ORIGIN))), await prefsPOST(req(h('https://evil.example')))]) {
      for (const [k] of res.headers) expect(k.toLowerCase().startsWith('access-control-')).toBe(false);
    }
  });
});

describe('error ไม่รั่วข้อมูลภายใน', () => {
  it('handler โยน Error ที่มีค่าลับ/stack → body = UNKNOWN, log ไม่มีข้อความ error', async () => {
    const secret = t.env.APP_SECRET!;
    const POST = route({
      method: 'POST',
      path: '/api/prefs',
      handler: () => {
        throw new Error(`boom ${secret} at /home/claude/maewmeet/src/x.ts:1`);
      },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(req(h(ORIGIN)));
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: { code: 'UNKNOWN' } });
      expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
      const logged = spy.mock.calls.flat().map(String).join(' ');
      expect(logged).not.toContain(secret);
      expect(logged).not.toContain('/home/claude');
    } finally {
      spy.mockRestore();
    }
  });

  it('error ที่ไม่ใช่ Error (string/object) ก็ไม่รั่ว', async () => {
    for (const thrown of ['raw-string-leak', { message: 'obj-leak', code: 'SQLITE_ERROR' }]) {
      const POST = route({
        method: 'POST',
        path: '/api/prefs',
        handler: () => {
          throw thrown;
        },
      });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await POST(req(h(ORIGIN)));
        const text = await res.text();
        expect(res.status).toBe(500);
        expect(text).not.toMatch(/leak|SQLITE/);
        expect(spy.mock.calls.flat().map(String).join(' ')).not.toMatch(/leak/);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it('VALIDATION ไม่สะท้อนค่าหรือชื่อคีย์แปลกที่ส่งมา (เช่น payload XSS)', async () => {
    const payload = '<script>alert(1)</script>';
    const res = await prefsPOST(req(h(ORIGIN), JSON.stringify({ theme: payload, [payload]: 1 })));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('alert');
    expect(JSON.parse(text)).toEqual({ error: { code: 'VALIDATION', params: { fields: { theme: 'INVALID', _: 'UNKNOWN_FIELD' } } } });
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  });

  it('คีย์แปลกจำนวนมาก → response ไม่ขยายตาม input (จำกัดจำนวน fields)', async () => {
    const body: Record<string, number> = { theme: 1 };
    for (let i = 0; i < 2000; i++) body[`k${i}`] = 1;
    const res = await prefsPOST(req(h(ORIGIN), JSON.stringify(body)));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { params: { fields: Record<string, string> } } };
    expect(Object.keys(json.error.params.fields).length).toBeLessThanOrEqual(32);
  });

  it('คีย์ที่เป็นชื่อปกติยังรายงานชื่อเดิม (สัญญาเดิมของ Platform)', async () => {
    const res = await prefsPOST(req(h(ORIGIN), JSON.stringify({ theme: 'dark', admin: true })));
    expect(await res.json()).toEqual({ error: { code: 'VALIDATION', params: { fields: { admin: 'UNKNOWN_FIELD' } } } });
  });
});

describe('Cache-Control: private, no-store ทุก response ของ wrapper', () => {
  it('200 / 400 / 403 / 413-ish / cron 401', async () => {
    const responses = [
      await prefsPOST(req(h(ORIGIN))),
      await prefsPOST(req(h(ORIGIN), '{bad')),
      await prefsPOST(req(h('https://evil.example'))),
      await prefsPOST(req(h(ORIGIN), JSON.stringify({ theme: 'x'.repeat(70 * 1024) }))),
      await heartbeatPOST(new Request(`${ORIGIN}/api/cron/heartbeat`, { method: 'POST' })),
    ];
    for (const r of responses) expect(r.headers.get('cache-control')).toBe(CACHE_CONTROL);
  });
});
