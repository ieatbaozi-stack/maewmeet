// ADR 0002 Test requirement 4 (U1): IP — ผิด 20 ครั้ง/15 นาที (ต่าง username) → ครั้งที่ 21 RATE_LIMITED · สมัครครั้งที่ 6 ใน 1 ชม. → RATE_LIMITED
// + IP ถูก HMAC ด้วย subkey ของ APP_SECRET (ไม่เก็บ IP ดิบ) · IPv6 ใช้ /64
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callerId } from '@/lib/auth/request';
import { ipHashOf, RATE_LIMITS } from '@/lib/auth/throttle';
import { Client, GOOD_PIN, HOUR, MIN, OTHER_PIN, setupHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
  await h.seedUser('alice');
});
afterEach(async () => {
  await h.cleanup();
});

const signupBody = (i: number) => ({ username: `new_user_${i}`, displayName: `U${i}`, pin: GOOD_PIN, pinConfirm: GOOD_PIN });

describe('login: ต่อ IP', () => {
  it('ผิด 20 ครั้งจาก IP เดียว (ต่าง username) ใน 15 นาที → ครั้งที่ 21 = 429 RATE_LIMITED + Retry-After · แม้ PIN ถูก', async () => {
    const c = new Client('203.0.113.7');
    for (let i = 1; i <= 20; i++) {
      const r = await c.login(`ghost_${i}`, OTHER_PIN);
      expect(r.code, `ครั้งที่ ${i}`).toBe('INVALID_CREDENTIALS');
    }
    const r21 = await c.login('ghost_21', OTHER_PIN);
    expect(r21.status).toBe(429);
    expect(r21.code).toBe('RATE_LIMITED');
    expect(Number(r21.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(r21.headers.get('retry-after'))).toBeLessThanOrEqual(15 * 60);
    // PIN ถูกของบัญชีจริงก็ผ่านไม่ได้ในหน้าต่างเดียวกัน
    const ok = await c.login('alice', GOOD_PIN);
    expect(ok.code).toBe('RATE_LIMITED');
    // IP อื่นไม่กระทบ
    expect((await new Client('203.0.113.8').login('alice', GOOD_PIN)).status).toBe(200);
  });

  it('จบหน้าต่าง 15 นาทีแล้วเข้าได้อีก (fixed window)', async () => {
    const c = new Client('203.0.113.7');
    for (let i = 1; i <= 21; i++) await c.login(`ghost_${i}`, OTHER_PIN);
    expect((await c.login('alice', GOOD_PIN)).code).toBe('RATE_LIMITED');
    h.clock.advance(15 * MIN);
    expect((await c.login('alice', GOOD_PIN)).status).toBe(200);
  });

  it('นับเฉพาะครั้งที่ผิด: login สำเร็จ 25 ครั้งจาก IP เดียวไม่ติดเพดาน', async () => {
    const c = new Client('203.0.113.9');
    for (let i = 0; i < 25; i++) expect((await c.login('alice', GOOD_PIN)).status).toBe(200);
  });

  it('ระหว่าง username ล็อก ไม่นับเข้า IP bucket (ไม่ verify ไม่นับ)', async () => {
    const c = new Client('203.0.113.10');
    for (let i = 0; i < 5; i++) await c.login('alice', OTHER_PIN); // นับ 5
    for (let i = 0; i < 30; i++) expect((await c.login('alice', OTHER_PIN)).code).toBe('LOGIN_LOCKED');
    const [row] = await h.rows<{ count: number }>("SELECT count FROM rate_limit_bucket WHERE key LIKE 'login:ip:%'");
    expect(Number(row!.count)).toBe(5);
  });
});

describe('signup: ต่อ IP', () => {
  it('สมัครครั้งที่ 6 ใน 1 ชม. จาก IP เดียว → 429 RATE_LIMITED · ครบชั่วโมงสมัครได้อีก', async () => {
    const ip = '198.51.100.20';
    for (let i = 1; i <= 5; i++) {
      const r = await new Client(ip).post('/api/auth/signup', signupBody(i));
      expect(r.status, `ครั้งที่ ${i}`).toBe(201);
    }
    const sixth = await new Client(ip).post('/api/auth/signup', signupBody(6));
    expect(sixth.status).toBe(429);
    expect(sixth.code).toBe('RATE_LIMITED');
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await h.count("user WHERE username LIKE 'new_user_%'")).toBe(5);

    expect((await new Client('198.51.100.21').post('/api/auth/signup', signupBody(7))).status).toBe(201); // IP อื่น
    h.clock.advance(HOUR);
    expect((await new Client(ip).post('/api/auth/signup', signupBody(8))).status).toBe(201);
  });

  it('ข้อมูลผิดรูปแบบ (ไม่ใช่การสมัครจริง) ไม่กินโควตา', async () => {
    const ip = '198.51.100.30';
    for (let i = 0; i < 10; i++) {
      const r = await new Client(ip).post('/api/auth/signup', { ...signupBody(i), pin: '000000', pinConfirm: '000000' });
      expect(r.code).toBe('PIN_TOO_WEAK');
    }
    expect((await new Client(ip).post('/api/auth/signup', signupBody(1))).status).toBe(201);
  });
});

describe('การเก็บ IP', () => {
  it('rate_limit_bucket ไม่มี IP ดิบ (เป็น HMAC) — ตรวจจากฐานจริงหลังใช้งานทั้ง login/signup/reset', async () => {
    const v4 = '203.0.113.77';
    const v6 = '2001:db8:abcd:12::77';
    await new Client(v4).login('ghost', OTHER_PIN);
    await new Client(v6).login('ghost', OTHER_PIN);
    await new Client(v4).post('/api/auth/signup', signupBody(1));
    await new Client(v6).post('/api/auth/pin-reset', { username: 'alice' });
    const keys = (await h.rows<{ key: string }>('SELECT key FROM rate_limit_bucket')).map((r) => r.key);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const k of keys) {
      expect(k).not.toContain(v4);
      expect(k).not.toContain('2001');
      expect(k).not.toContain('db8');
      expect(k).toMatch(/^(login:ip|signup:ip|reset:ip|reset:u):[0-9a-f]{32}$/);
    }
  });

  it('HMAC ผูกกับ APP_SECRET: ความลับต่างกัน → คีย์ต่างกัน · IP เดียวกัน → คีย์เดียวกัน', () => {
    const req = (ip: string) => new Request('https://x.test/', { headers: { 'x-real-ip': ip } });
    const s1 = Buffer.alloc(32, 1).toString('base64');
    const s2 = Buffer.alloc(32, 2).toString('base64');
    expect(ipHashOf(req('1.2.3.4'), s1)).toBe(ipHashOf(req('1.2.3.4'), s1));
    expect(ipHashOf(req('1.2.3.4'), s1)).not.toBe(ipHashOf(req('1.2.3.4'), s2));
    expect(ipHashOf(req('1.2.3.4'), s1)).not.toBe(ipHashOf(req('1.2.3.5'), s1));
  });

  it('IPv6 ใช้ prefix /64: อยู่ /64 เดียวกันใช้ถังร่วม · ต่าง /64 แยกถัง · IPv4-mapped นับเป็น IPv4', () => {
    expect(callerId('2001:db8:abcd:12::1')).toBe(callerId('2001:db8:abcd:12:ffff:ffff:ffff:ffff'));
    expect(callerId('2001:db8:abcd:12::1')).toBe(callerId('2001:0DB8:ABCD:0012:0:0:0:9'));
    expect(callerId('2001:db8:abcd:12::1')).not.toBe(callerId('2001:db8:abcd:13::1'));
    expect(callerId('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(callerId('::ffff:cb00:7105')).toBe('203.0.113.5');
    expect(callerId('[2001:db8::1]')).toBe(callerId('2001:db8::2'));
    expect(callerId('fe80::1%eth0')).toBe(callerId('fe80::2'));
    expect(callerId(null)).toBe('unknown');
    expect(callerId('not-an-ip')).toBe('unknown');
    expect(callerId('999.1.1.1')).toBe('unknown');
  });

  it('IPv6 /64 เดียวกันแชร์เพดาน login 20 ครั้ง (ผู้โจมตีเปลี่ยน host bits ไม่ได้)', async () => {
    for (let i = 1; i <= 20; i++) {
      const c = new Client(`2001:db8:1:2:${i.toString(16)}::${i.toString(16)}`);
      expect((await c.login(`ghost_${i}`, OTHER_PIN)).code).toBe('INVALID_CREDENTIALS');
    }
    const c21 = new Client('2001:db8:1:2:aaaa::1');
    expect((await c21.login('ghost_21', OTHER_PIN)).code).toBe('RATE_LIMITED');
    expect((await new Client('2001:db8:1:3::1').login('ghost_22', OTHER_PIN)).code).toBe('INVALID_CREDENTIALS');
  });

  it('ไม่มีหัวข้อมูล IP เลย → ใช้ถัง unknown ร่วมกัน (ไม่ crash)', async () => {
    const r = await new Client('').login('ghost', OTHER_PIN); // x-real-ip ว่าง
    expect(r.code).toBe('INVALID_CREDENTIALS');
  });

  it('ค่าเพดานตรงตาราง ADR', () => {
    expect(RATE_LIMITS.loginIp).toMatchObject({ limit: 20, windowMs: 15 * MIN });
    expect(RATE_LIMITS.signupIp).toMatchObject({ limit: 5, windowMs: HOUR });
    expect(RATE_LIMITS.resetIp).toMatchObject({ limit: 3, windowMs: HOUR });
    expect(RATE_LIMITS.resetUser).toMatchObject({ limit: 3, windowMs: 24 * HOUR });
  });
});
