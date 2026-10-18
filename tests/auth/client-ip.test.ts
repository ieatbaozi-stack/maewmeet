// S4/S5: IP ของ client เชื่อ header proxy เฉพาะเมื่อ VERCEL ถูกตั้ง หรือ TRUST_PROXY_HEADERS=1 · ไม่งั้นถังร่วม 'unknown' เพดานสูง
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callerId, clientIp } from '@/lib/auth/request';
import { ipRateSpec, RATE_LIMITS, UNKNOWN_CALLER_LIMIT_FACTOR } from '@/lib/auth/throttle';
import { Client, OTHER_PIN, setupHarness, type Harness } from './harness';

const req = (headers: Record<string, string>) => new Request('https://maewmeet.test/api/auth/login', { headers });

describe('clientIp (หน่วย)', () => {
  const hdr = { 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2, 3.3.3.3', 'x-vercel-forwarded-for': '9.9.9.9' };

  it('ไม่เชื่อ header เมื่อไม่ได้ตั้ง VERCEL/TRUST_PROXY_HEADERS (ผู้เรียกปลอมไม่ได้) → null → unknown', () => {
    expect(clientIp(req(hdr), {})).toBeNull();
    expect(callerId(clientIp(req(hdr), {}))).toBe('unknown');
    expect(clientIp(req(hdr), { TRUST_PROXY_HEADERS: '0' })).toBeNull();
  });
  it('เชื่อเมื่อ VERCEL ตั้ง: x-vercel-forwarded-for ก่อน → x-real-ip → x-forwarded-for ตัวแรก', () => {
    expect(clientIp(req(hdr), { VERCEL: '1' })).toBe('9.9.9.9');
    expect(clientIp(req({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }), { VERCEL: '1' })).toBe('1.1.1.1');
    expect(clientIp(req({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }), { VERCEL: '1' })).toBe('2.2.2.2');
    expect(clientIp(req({}), { VERCEL: '1' })).toBeNull();
  });
  it('TRUST_PROXY_HEADERS=1 เชื่อเหมือนกัน', () => {
    expect(clientIp(req(hdr), { TRUST_PROXY_HEADERS: '1' })).toBe('9.9.9.9');
  });
  it('ipRateSpec: ผู้เรียกที่รู้ IP ใช้เพดานปกติ · unknown ใช้เพดาน × UNKNOWN_CALLER_LIMIT_FACTOR (ทุกถัง IP)', () => {
    const saved = { v: process.env.VERCEL, t: process.env.TRUST_PROXY_HEADERS };
    try {
      delete process.env.VERCEL;
      delete process.env.TRUST_PROXY_HEADERS;
      expect(ipRateSpec(RATE_LIMITS.loginIp, req({ 'x-real-ip': '1.1.1.1' })).limit).toBe(20 * UNKNOWN_CALLER_LIMIT_FACTOR);
      expect(ipRateSpec(RATE_LIMITS.signupIp, req({})).limit).toBe(5 * UNKNOWN_CALLER_LIMIT_FACTOR);
      expect(ipRateSpec(RATE_LIMITS.resetIp, req({})).limit).toBe(3 * UNKNOWN_CALLER_LIMIT_FACTOR);
      process.env.TRUST_PROXY_HEADERS = '1';
      expect(ipRateSpec(RATE_LIMITS.loginIp, req({ 'x-real-ip': '1.1.1.1' })).limit).toBe(20);
      expect(ipRateSpec(RATE_LIMITS.loginIp, req({})).limit).toBe(20 * UNKNOWN_CALLER_LIMIT_FACTOR); // เชื่อแต่ไม่มี header → unknown
    } finally {
      if (saved.v === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved.v;
      if (saved.t === undefined) delete process.env.TRUST_PROXY_HEADERS; else process.env.TRUST_PROXY_HEADERS = saved.t;
    }
  });
});

describe('ผ่าน endpoint จริง', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
    await h.seedUser('alice');
  });
  afterEach(async () => {
    delete process.env.VERCEL;
    await h.cleanup();
  });
  const buckets = () => h.rows<{ key: string; count: number }>("SELECT key, count FROM rate_limit_bucket WHERE key LIKE 'login:ip:%'");

  it('ไม่เชื่อ proxy: หมุน x-real-ip ปลอมทุกครั้งก็ได้ถังเดียวกัน (ปลอมเพื่อหนีเพดาน/ไปทับถังคนอื่นไม่ได้) · เพดาน 20 × 50', async () => {
    delete process.env.TRUST_PROXY_HEADERS;
    for (let i = 0; i < 25; i++) await new Client(`203.0.113.${i + 1}`).login(`ghost_${i}`, OTHER_PIN);
    const rows = await buckets();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.count)).toBe(25);
    // เพดานสูงจริง: ไม่ใช่ 20 (ระบบไม่ล็อกทุกคนที่ไม่ได้อยู่หลัง proxy) และมีเพดานจริง
    await h.db.$client.execute("UPDATE rate_limit_bucket SET count = 1000 WHERE key LIKE 'login:ip:%'");
    expect((await new Client('203.0.113.250').login('alice', OTHER_PIN)).code).toBe('RATE_LIMITED');
  });

  it('บน Vercel (VERCEL ตั้ง): ใช้ x-vercel-forwarded-for เป็นถัง · x-real-ip ที่ปลอมมาไม่มีผล · คนละ IP คนละถัง', async () => {
    delete process.env.TRUST_PROXY_HEADERS;
    process.env.VERCEL = '1';
    const a = new Client('9.9.9.9');
    for (let i = 0; i < 3; i++) await a.call('POST', '/api/auth/login', { username: `g${i}`, pin: OTHER_PIN }, { headers: { 'x-vercel-forwarded-for': '198.51.100.1', 'x-real-ip': `10.0.0.${i}` } });
    await a.call('POST', '/api/auth/login', { username: 'g9', pin: OTHER_PIN }, { headers: { 'x-vercel-forwarded-for': '198.51.100.2' } });
    const rows = (await buckets()).map((r) => Number(r.count)).sort();
    expect(rows).toEqual([1, 3]);
  });
});
