// R4B hardening: SEC L1 (โควตาส่วนตัวไม่ไหม้เมื่อถูกช่องกลางกัน) · SEC L2/QA L4 (ไม่แคชผลรูปร่างผิด) · SEC L3 (ชื่อสถานที่) · แคชผลว่างสั้น
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPlaceFetch, setPlaceFetch } from '@/lib/data/place-fetch';
import { resetEnvCache } from '@/lib/shared/env';
import { HOUR, MIN, get, person, setupHarness, type Harness, type Person } from '../appointments/util';

let h: Harness;
let a: Person;
let b: Person;
let calls: string[];
let reply: () => Response;
let realFetch: typeof fetch;
const saved = process.env.NOMINATIM_CONTACT;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const SIAM = [{ lat: '13.7461', lon: '100.5347', display_name: 'สยามพารากอน', osm_type: 'way', osm_id: 1 }];
const search = (p: Person, q: string) => get<{ results: { name: string }[] }>(p.c, `/api/places/search?q=${encodeURIComponent(q)}`);
const bucket = async (prefix: string, userId: string) => (await h.rows<{ count: number }>('SELECT count FROM rate_limit_bucket WHERE key = ?', [`${prefix}:${userId}`]))[0]?.count ?? 0;

beforeEach(async () => {
  h = await setupHarness();
  a = await person(h, 'alice');
  b = await person(h, 'bob');
  process.env.NOMINATIM_CONTACT = 'ops@maewmeet.test';
  resetEnvCache();
  calls = [];
  reply = () => json(SIAM);
  setPlaceFetch(async (url) => (calls.push(url), reply()));
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() => {
    throw new Error('REAL NETWORK ACCESS IN TEST');
  }) as unknown as typeof fetch;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  resetPlaceFetch();
  if (saved === undefined) delete process.env.NOMINATIM_CONTACT;
  else process.env.NOMINATIM_CONTACT = saved;
  resetEnvCache();
  await h.cleanup();
});

describe('SEC L2 / QA L4: ต้นทางตอบ 200 แต่ไม่ใช่อาร์เรย์', () => {
  it.each([['อ็อบเจ็กต์ error', { error: 'x' }], ['null', null], ['สตริง', 'ok'], ['ตัวเลข', 1], ['results ซ้อน', { results: [] }]])('%s → 503 upstream · ไม่แคช · ค้นซ้ำยิงต้นทางอีก', async (_n, body) => {
    reply = () => json(body);
    const r = await search(a, 'รูปร่างผิด');
    expect([r.status, r.code]).toEqual([503, 'FEATURE_DISABLED']);
    expect(r.json.error?.params).toMatchObject({ feature: 'placeSearch', reason: 'upstream' });
    expect(await h.count('place_search_cache')).toBe(0);
    h.clock.advance(1500);
    reply = () => json(SIAM);
    expect((await search(a, 'รูปร่างผิด')).data.results).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('อาร์เรย์ว่างจริง = "ไม่พบ" แคชได้แต่สั้น (1 ชม.) ไม่ใช่ 30 วัน', async () => {
    reply = () => json([]);
    expect((await search(a, 'ไม่มีจริง')).data.results).toEqual([]);
    expect(await h.count('place_search_cache')).toBe(1);
    h.clock.advance(HOUR - 2000);
    await search(b, 'ไม่มีจริง');
    expect(calls).toHaveLength(1);
    h.clock.advance(3000);
    reply = () => json(SIAM);
    expect((await search(b, 'ไม่มีจริง')).data.results).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});

describe('SEC L1: โควตาส่วนตัว vs ช่องกลาง', () => {
  it('ถูกช่องกลางปฏิเสธ (429) → ไม่กินโควตานาที/ชั่วโมงของผู้ใช้ · ผ่านแล้วนับตามปกติ', async () => {
    expect((await search(a, 'แรก')).status).toBe(200);
    expect(await bucket('place:u:m', a.id)).toBe(1);
    for (let i = 0; i < 5; i++) expect((await search(b, `ชน ${i}`)).status).toBe(429);
    expect(await bucket('place:u:m', b.id)).toBe(0);
    expect(await bucket('place:u:h', b.id)).toBe(0);
    h.clock.advance(1000);
    expect((await search(b, 'ผ่านแล้ว')).status).toBe(200);
    expect(await bucket('place:u:m', b.id)).toBe(1);
  });

  it('ถูกกันซ้ำ 30 ครั้งไม่ทำให้ติดเพดานนาที (10) ของตัวเอง', async () => {
    await search(a, 'ยึดช่อง');
    for (let i = 0; i < 30; i++) expect((await search(b, `ชน ${i}`)).status).toBe(429);
    h.clock.advance(1000);
    expect((await search(b, 'ได้แล้ว')).status).toBe(200);
  });

  it('ตอบจากแคช = ไม่ยุ่งกับช่องกลาง (ไม่ขยับเวลาล่าสุดของช่อง)', async () => {
    await search(a, 'แคชไว้');
    const slotBefore = (await h.rows<{ window_start: number }>('SELECT window_start FROM rate_limit_bucket WHERE key = ?', ['place:nominatim:last']))[0]!.window_start;
    h.clock.advance(500);
    for (let i = 0; i < 3; i++) expect((await search(b, 'แคชไว้')).status).toBe(200);
    const slotAfter = (await h.rows<{ window_start: number }>('SELECT window_start FROM rate_limit_bucket WHERE key = ?', ['place:nominatim:last']))[0]!.window_start;
    expect(slotAfter).toBe(slotBefore);
    h.clock.advance(500);
    expect((await search(b, 'อีกคำ')).status).toBe(200); // ช่องว่างเมื่อครบ 1 วินาทีจากการเรียกจริงครั้งล่าสุด
    expect(calls).toHaveLength(2);
    h.clock.advance(MIN);
  });
});

describe('SEC L3: ชื่อสถานที่จากต้นทาง', () => {
  it('ตัดตัวควบคุม/bidi/zero-width/format · ยุบช่องว่าง (รวม tab/newline/nbsp) · ตัดหัวท้าย · ≤ 120 code point', async () => {
    reply = () =>
      json([
        { lat: '1', lon: '2', display_name: '  คาเฟ่‮​⁦  \t\n ดี  มาก\u0007﻿  ' },
        { lat: '3', lon: '4', display_name: 'ก'.repeat(300) },
        { lat: '5', lon: '6', display_name: '😀'.repeat(200) },
        { lat: '7', lon: '8', display_name: '‮​\u0000' },
      ]);
    const r = await search(a, 'ชื่อสกปรก');
    expect(r.status).toBe(200);
    const names = r.data.results.map((x) => x.name);
    expect(names).toHaveLength(3);
    expect(names[0]).toBe('คาเฟ่ ดี มาก');
    expect([...names[1]!]).toHaveLength(120);
    expect([...names[2]!]).toHaveLength(120);
    for (const n of names) expect(n).not.toMatch(/[\p{Cc}\p{Cf}]|\s{2}|^\s|\s$/u);
  });

  it('แถวแคชเก่าที่ชื่อยาว/สกปรกถูกทำความสะอาดตอนอ่าน', async () => {
    await search(a, 'แคชสกปรก');
    await h.rows('UPDATE place_search_cache SET results = ?', [JSON.stringify([{ name: `  x‮${'ย'.repeat(200)}`, lat: 1, lng: 2, osmUrl: 'https://www.openstreetmap.org/node/1' }])]);
    const r = await search(b, 'แคชสกปรก');
    expect([...r.data.results[0]!.name]).toHaveLength(120);
    expect(r.data.results[0]!.name.startsWith('x')).toBe(true);
  });
});
