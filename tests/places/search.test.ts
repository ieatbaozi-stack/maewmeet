// R4B-6 GET /api/places/search — แคช · ช่องห่าง 1 req/s · kill switch · rate limit · sanitize · ไม่ยิงเครือข่ายจริง
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPlaceFetch, setPlaceFetch } from '@/lib/data/place-fetch';
import { resetEnvCache } from '@/lib/shared/env';
import { Client, HOUR, MIN, get, person, setupHarness, type Harness, type Person } from '../appointments/util';

let h: Harness;
let a: Person;
let b: Person;
let calls: { url: URL; init: RequestInit }[];
let reply: () => Response;
let realFetch: typeof fetch;
const saved: Record<string, string | undefined> = {};
const KEYS = ['PLACE_SEARCH_ENABLED', 'NOMINATIM_CONTACT', 'NOMINATIM_BASE_URL'];

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const SIAM = [{ lat: '13.7461', lon: '100.5347', display_name: 'สยามพารากอน, ปทุมวัน, กรุงเทพมหานคร', osm_type: 'way', osm_id: 12345 }];

const search = (p: Person, q: string | undefined) => get<{ results: { name: string; lat: number; lng: number; osmUrl: string }[] }>(p.c, `/api/places/search${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`);
const setEnv = (k: string, v: string | undefined) => {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  resetEnvCache();
};

beforeEach(async () => {
  h = await setupHarness();
  a = await person(h, 'alice');
  b = await person(h, 'bob');
  for (const k of KEYS) saved[k] = process.env[k];
  setEnv('NOMINATIM_CONTACT', 'ops@maewmeet.test');
  setEnv('PLACE_SEARCH_ENABLED', 'true'); // CI ตั้ง false (ci-env.sh) — เทสต์นี้ต้องเปิดเองเสมอ
  calls = [];
  reply = () => json(SIAM);
  setPlaceFetch(async (url, init) => {
    calls.push({ url: new URL(url), init });
    return reply();
  });
  // ยามกันเครือข่ายจริง: fetch ของ global ต้องไม่ถูกเรียกเลยในไฟล์นี้
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() => {
    throw new Error('REAL NETWORK ACCESS IN TEST');
  }) as unknown as typeof fetch;
});
afterEach(async () => {
  expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  globalThis.fetch = realFetch;
  resetPlaceFetch();
  for (const k of KEYS) setEnv(k, saved[k]);
  await h.cleanup();
});

describe('ผลลัพธ์', () => {
  it('ค้นหาได้ · รูปร่างผลลัพธ์ · ลิงก์ OSM สร้างเองจาก osm_type/osm_id · User-Agent ระบุผู้ติดต่อ · ส่ง accept-language ตามผู้ใช้', async () => {
    const r = await search(a, '  สยาม  พารากอน ');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.data).toEqual({ results: [{ name: 'สยามพารากอน, ปทุมวัน, กรุงเทพมหานคร', lat: 13.7461, lng: 100.5347, osmUrl: 'https://www.openstreetmap.org/way/12345' }] });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url.origin).toBe('https://nominatim.openstreetmap.org');
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('สยาม พารากอน');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('email')).toBe('ops@maewmeet.test');
    expect((init.headers as Record<string, string>)['user-agent']).toContain('ops@maewmeet.test');
    expect(init.redirect).toBe('error');
  });

  it('ข้อมูลจากต้นทางไม่น่าเชื่อถือ: sanitize ชื่อ · ตัดพิกัดเสีย/นอกช่วง · ตัดเหลือ 5 · ไม่เชื่อ URL ที่ส่งมา', async () => {
    reply = () =>
      json([
        { lat: '1', lon: '2', display_name: 'ดี‮\u0000<img src=x onerror=alert(1)>', osm_type: 'node', osm_id: '77', url: 'javascript:alert(1)', link: 'https://evil.example' },
        { lat: '999', lon: '2', display_name: 'พิกัดนอกช่วง' },
        { lat: 'abc', lon: '2', display_name: 'พิกัดเสีย' },
        { lat: '1e3', lon: '2', display_name: 'วิทยาศาสตร์' },
        null,
        'string',
        { lat: '3', lon: '4', display_name: '   ' },
        { lat: '5', lon: '6', display_name: 'ไม่มี osm id' },
        ...Array.from({ length: 10 }, (_, i) => ({ lat: String(10 + i), lon: '20', display_name: `ที่ ${i}` })),
      ]);
    const r = await search(a, 'ทดสอบ xss');
    expect(r.status).toBe(200);
    expect(r.data.results).toHaveLength(5);
    expect(r.data.results[0]!.osmUrl).toBe('https://www.openstreetmap.org/node/77');
    expect(r.data.results[1]!.osmUrl).toBe('https://www.openstreetmap.org/?mlat=5&mlon=6#map=17/5/6');
    expect(r.text).not.toMatch(/javascript:|evil\.example|\\u202e|\\u0000/);
    for (const x of r.data.results) {
      expect(x.osmUrl.startsWith('https://www.openstreetmap.org/')).toBe(true);
      expect(Math.abs(x.lat)).toBeLessThanOrEqual(90);
    }
  });

  it('ต้นทางล้ม (5xx / timeout / ไม่ใช่ JSON / ใหญ่เกิน) → 503 FEATURE_DISABLED reason upstream · ไม่แคชผลล้มเหลว', async () => {
    for (const bad of [() => new Response('x', { status: 500 }), () => new Response('<html>', { status: 200 }), () => new Response('x'.repeat(300 * 1024), { status: 200 })]) {
      h.clock.advance(2000);
      reply = bad;
      const r = await search(a, 'ล้มเหลว');
      expect([r.status, r.code]).toEqual([503, 'FEATURE_DISABLED']);
      expect(r.json.error?.params).toMatchObject({ feature: 'placeSearch', reason: 'upstream' });
    }
    setPlaceFetch(async () => {
      throw new Error('boom');
    });
    h.clock.advance(2000);
    expect((await search(a, 'ล้มเหลว')).json.error?.params).toMatchObject({ reason: 'upstream' });
    expect(await h.count('place_search_cache')).toBe(0);
    h.clock.advance(2000);
    reply = () => json(SIAM);
    setPlaceFetch(async (u, i) => (calls.push({ url: new URL(u), init: i }), reply()));
    expect((await search(a, 'ล้มเหลว')).status).toBe(200);
  });
});

describe('แคช 30 วัน', () => {
  it('คำค้นเดียวกัน (ต่างตัวพิมพ์/ช่องว่าง/ต่างผู้ใช้) → ยิง Nominatim ครั้งเดียว · หมดอายุหลัง 30 วัน', async () => {
    await search(a, 'Central World');
    expect(calls).toHaveLength(1);
    const again = await search(b, '  central   WORLD ');
    expect(again.data.results).toHaveLength(1);
    expect(calls).toHaveLength(1);
    h.clock.advance(30 * 24 * HOUR - 1);
    await search(a, 'central world');
    expect(calls).toHaveLength(1);
    h.clock.advance(2);
    await search(a, 'central world');
    expect(calls).toHaveLength(2);
  });

  it('แคชแยกตามภาษาของผู้ใช้ (ผลแปลตามภาษา)', async () => {
    await h.rows("UPDATE user SET locale = 'en' WHERE id = ?", [b.id]);
    await search(a, 'bangkok');
    h.clock.advance(1500);
    await search(b, 'bangkok');
    expect(calls.map((c) => c.url.searchParams.get('accept-language'))).toEqual(['th', 'en']);
  });

  it('แถวแคชที่ถูกแก้ใน DB (url อันตราย/พิกัดเสีย) ไม่ไหลออก', async () => {
    await search(a, 'poisoned');
    await h.rows("UPDATE place_search_cache SET results = ?", [JSON.stringify([{ name: 'x', lat: 1, lng: 2, osmUrl: 'javascript:alert(1)' }, { name: 'y', lat: 500, lng: 2, osmUrl: 'https://www.openstreetmap.org/' }, { name: 'ok', lat: 1, lng: 2, osmUrl: 'https://www.openstreetmap.org/node/1' }])]);
    const r = await search(b, 'poisoned');
    expect(r.data.results.map((x) => x.name)).toEqual(['ok']);
  });
});

describe('ช่องห่าง 1 req/s ทั้งระบบ', () => {
  it('คำค้นต่างกันภายใน 1 วินาที → 429 RATE_LIMITED + Retry-After · ผ่านหลังครบ 1 วินาที · ไม่ยิงต้นทางตอนถูกกัน', async () => {
    expect((await search(a, 'แรก')).status).toBe(200);
    const blocked = await search(b, 'ที่สอง');
    expect([blocked.status, blocked.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(calls).toHaveLength(1);
    h.clock.advance(999);
    expect((await search(b, 'ที่สอง')).status).toBe(429);
    h.clock.advance(1);
    expect((await search(b, 'ที่สอง')).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('คำค้นที่ตอบจากแคชไม่กินช่องห่าง', async () => {
    await search(a, 'แคชนี้');
    for (let i = 0; i < 3; i++) expect((await search(b, 'แคชนี้')).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('ยิงพร้อมกัน 6 คำค้นต่างกัน → ผ่านได้ไม่เกิน 1 ในหนึ่งวินาที', async () => {
    const people = [a, b, await person(h, 'cat'), await person(h, 'dan'), await person(h, 'eve'), await person(h, 'fay')];
    const rs = await Promise.all(people.map((p, i) => search(p, `พร้อมกัน ${i}`)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(5);
    expect(calls).toHaveLength(1);
  });
});

describe('rate limit ต่อผู้ใช้', () => {
  it('11 ครั้งใน 1 นาที (แม้จากแคช) → ครั้งที่ 11 ถูกกัน · ผู้ใช้อื่นไม่กระทบ · นาทีถัดไปใช้ได้', async () => {
    await search(a, 'วนซ้ำ');
    for (let i = 0; i < 9; i++) expect((await search(a, 'วนซ้ำ')).status).toBe(200);
    const r = await search(a, 'วนซ้ำ');
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect((await search(b, 'วนซ้ำ')).status).toBe(200);
    h.clock.advance(MIN + 1);
    expect((await search(a, 'วนซ้ำ')).status).toBe(200);
  });

  it('60 ครั้งต่อชั่วโมง', async () => {
    await search(a, 'ชั่วโมง');
    let blocked = 0;
    for (let i = 0; i < 80; i++) {
      if (i % 9 === 8) h.clock.advance(MIN + 1);
      const r = await search(a, 'ชั่วโมง');
      if (r.status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});

describe('kill switch และการตั้งค่า', () => {
  it('PLACE_SEARCH_ENABLED=false → 503 FEATURE_DISABLED reason disabled · ไม่ยิงต้นทาง · ไม่กิน rate limit', async () => {
    setEnv('PLACE_SEARCH_ENABLED', 'false');
    const r = await search(a, 'ปิดอยู่');
    expect([r.status, r.code]).toEqual([503, 'FEATURE_DISABLED']);
    expect(r.json.error?.params).toMatchObject({ feature: 'placeSearch', reason: 'disabled' });
    expect(calls).toHaveLength(0);
    expect(await h.count('rate_limit_bucket WHERE key LIKE ?', ['place:%'])).toBe(0);
    setEnv('PLACE_SEARCH_ENABLED', 'true');
    expect((await search(a, 'ปิดอยู่')).status).toBe(200);
  });

  it('ใช้ nominatim สาธารณะโดยไม่มี NOMINATIM_CONTACT → ปิดบริการ (reason not_configured) · host ของตัวเองไม่ต้องมี', async () => {
    setEnv('NOMINATIM_CONTACT', undefined);
    const r = await search(a, 'ไม่มีผู้ติดต่อ');
    expect(r.json.error?.params).toMatchObject({ reason: 'not_configured' });
    expect(calls).toHaveLength(0);
    setEnv('NOMINATIM_BASE_URL', 'https://nominatim.internal.example');
    expect((await search(a, 'ไม่มีผู้ติดต่อ')).status).toBe(200);
    expect(calls[0]!.url.origin).toBe('https://nominatim.internal.example');
  });
});

describe('สิทธิ์และ validation', () => {
  it('anonymous → 401 (ก่อน 400) · must_change_pin → 403', async () => {
    expect((await get(new Client(), '/api/places/search?q=abc')).status).toBe(401);
    expect((await get(new Client(), '/api/places/search')).status).toBe(401);
    const x = await person(h, 'pinny');
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [x.id]);
    expect((await search(x, 'abc')).code).toBe('PIN_CHANGE_REQUIRED');
  });

  it.each([
    [undefined, 'REQUIRED'],
    ['', 'TOO_SHORT'],
    ['a', 'TOO_SHORT'],
    ['  a  ', 'TOO_SHORT'],
    ['ก'.repeat(101), 'TOO_LONG'],
    ['มี\u0000null', 'INVALID'],
    ['มี‮bidi', 'INVALID'],
  ])('q=%j → 400 VALIDATION (%s) และไม่ยิงต้นทาง/ไม่กิน rate limit', async (q, why) => {
    const r = await search(a, q as string | undefined);
    expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
    expect(r.json.error?.params).toMatchObject({ fields: { q: why } });
    expect(calls).toHaveLength(0);
    expect(await h.count('rate_limit_bucket WHERE key LIKE ?', ['place:%'])).toBe(0);
  });

  it('query พารามิเตอร์เกิน (strict) → 400 · ข้อความค้นหาไม่ถูกเขียนลง log ของ audit', async () => {
    expect((await get(a.c, '/api/places/search?q=abcd&extra=1')).status).toBe(400);
    await search(a, 'ความลับส่วนตัวของฉัน');
    const audit = JSON.stringify(await h.rows('SELECT * FROM audit_log'));
    expect(audit).not.toContain('ความลับส่วนตัวของฉัน');
  });

  it('คำค้นอยู่เฉพาะใน URL ของคำขอต้นทาง ไม่มีข้อมูลผู้ใช้ (ชื่อ/id/คุกกี้) ถูกส่งออกไป', async () => {
    await search(a, 'ร้านกาแฟ');
    const { url, init } = calls[0]!;
    const blob = url.toString() + JSON.stringify(init.headers);
    expect(blob).not.toContain(a.id);
    expect(blob).not.toContain(a.username);
    expect(blob.toLowerCase()).not.toContain('cookie');
    expect(Object.keys(init.headers as object).map((k) => k.toLowerCase())).not.toContain('cookie');
  });
});
