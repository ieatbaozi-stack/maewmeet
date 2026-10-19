// ADR 0002 Test requirement 3 (U1): lockout ต่อ username
// ผิด 4 ครั้ง attemptsRemaining 4,3,2,1 · ครั้งที่ 5 ล็อก 60 วินาที · PIN ถูกระหว่างล็อกยัง LOGIN_LOCKED ·
// ครบเวลาแล้วผิดอีก → 120 · ตาราง 2^(f−5) ถึงเพดาน 24 ชม. · สำเร็จแล้วรีเซ็ต · super admin unlock แล้วเข้าได้ทันที
// + ข้อตัดสินของ Lead: ระหว่างล็อกไม่เรียก recordLoginFailure (ไม่นับเพิ่มไม่ว่า PIN ถูกหรือผิด)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockMsFor, LOCK_MAX_MS } from '@/lib/auth/throttle';
import { resetLoginThrottle } from '@/lib/data/repos/login-throttle';
import { Client, DAY, GOOD_PIN, HOUR, MIN, OTHER_PIN, setupHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
  await h.seedUser('alice');
});
afterEach(async () => {
  await h.cleanup();
});

const throttle = async () =>
  (await h.rows<{ failures: number; locked_until: number | null }>("SELECT failures, locked_until FROM login_throttle WHERE key = 'u:alice'"))[0];

describe('lockMsFor (ตาราง ADR §3)', () => {
  it('f<5 ไม่ล็อก · f=5.. = 1,2,4,…,1024 นาที แล้วคงที่ 24 ชม.', () => {
    expect([0, 1, 2, 3, 4].map(lockMsFor)).toEqual([0, 0, 0, 0, 0]);
    const minutes = Array.from({ length: 11 }, (_, i) => lockMsFor(5 + i) / MIN);
    expect(minutes).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]);
    expect(lockMsFor(16)).toBe(LOCK_MAX_MS); // 2048 นาที ถูกตัดที่ 24 ชม. (1440)
    expect(lockMsFor(1000)).toBe(24 * HOUR);
    expect(lockMsFor(Number.NaN)).toBe(0);
  });
});

describe('lockout ต่อ username', () => {
  it('ผิด 4 ครั้ง: attemptsRemaining = 4,3,2,1 · ครั้งที่ 5 → 429 LOGIN_LOCKED 60 วินาที + Retry-After', async () => {
    const c = new Client();
    for (const remaining of [4, 3, 2, 1]) {
      const r = await c.login('alice', OTHER_PIN);
      expect(r.status).toBe(401);
      expect(r.json.error).toEqual({ code: 'INVALID_CREDENTIALS', params: { attemptsRemaining: remaining } });
    }
    const fifth = await c.login('alice', OTHER_PIN);
    expect(fifth.status).toBe(429);
    expect(fifth.json.error).toEqual({ code: 'LOGIN_LOCKED', params: { retryAfterSec: 60 } });
    expect(fifth.headers.get('retry-after')).toBe('60');
  });

  it('PIN ถูกระหว่างล็อก → ยัง LOGIN_LOCKED (ไม่มี session) · ไม่นับเพิ่มไม่ว่าถูกหรือผิด (ข้อตัดสิน Lead b)', async () => {
    const c = new Client();
    for (let i = 0; i < 5; i++) await c.login('alice', OTHER_PIN);
    const before = await throttle();
    expect(before?.failures).toBe(5);

    h.clock.advance(10_000);
    const right = await c.login('alice', GOOD_PIN);
    expect(right.status).toBe(429);
    expect(right.code).toBe('LOGIN_LOCKED');
    expect((right.json.error!.params as { retryAfterSec: number }).retryAfterSec).toBe(50); // เหลือ 50 วินาที
    expect(c.jar.size).toBe(0);
    const wrong = await c.login('alice', OTHER_PIN);
    expect(wrong.code).toBe('LOGIN_LOCKED');

    expect(await throttle()).toEqual(before); // ทั้ง failures และ locked_until ไม่ขยับ
    expect(await h.rows('SELECT * FROM session')).toHaveLength(0);
  });

  it('ครบเวลาแล้วผิดอีก → 120 วินาที · ตาราง 60,120,240,… ถึงเพดาน 24 ชม. แล้วคงที่', async () => {
    const c = new Client();
    for (let i = 0; i < 4; i++) await c.login('alice', OTHER_PIN);
    const expectedSec = [60, 120, 240, 480, 960, 1920, 3840, 7680, 15360, 30720, 61440, 86400, 86400];
    const seen: number[] = [];
    for (let i = 0; i < expectedSec.length; i++) {
      const r = await c.login('alice', OTHER_PIN);
      expect(r.code).toBe('LOGIN_LOCKED');
      const sec = (r.json.error!.params as { retryAfterSec: number }).retryAfterSec;
      seen.push(sec);
      h.clock.advance(sec * 1000 + 1000); // พ้นช่วงล็อก
    }
    expect(seen).toEqual(expectedSec);
    expect(seen.at(-1)).toBe(DAY / 1000);
  });

  it('สำเร็จ 1 ครั้ง (ครบเวลาล็อกแล้ว) → รีเซ็ต failures แล้วนับ 4,3,… ใหม่', async () => {
    const c = new Client();
    for (let i = 0; i < 6; i++) {
      await c.login('alice', OTHER_PIN);
      h.clock.advance(HOUR);
    }
    expect((await throttle())?.failures).toBe(6);
    const ok = await c.login('alice', GOOD_PIN);
    expect(ok.status).toBe(200);
    expect(await throttle()).toMatchObject({ failures: 0, locked_until: null });
    const c2 = new Client();
    const again = await c2.login('alice', OTHER_PIN);
    expect(again.json.error).toEqual({ code: 'INVALID_CREDENTIALS', params: { attemptsRemaining: 4 } });
  });

  it('ผิด 3 ครั้งแล้วถูก → รีเซ็ต (ไม่สะสมข้ามครั้งที่สำเร็จ)', async () => {
    const c = new Client();
    for (let i = 0; i < 3; i++) await c.login('alice', OTHER_PIN);
    expect((await c.login('alice', GOOD_PIN)).status).toBe(200);
    const r = await new Client().login('alice', OTHER_PIN);
    expect(r.json.error!.params).toEqual({ attemptsRemaining: 4 });
  });

  it('super admin ปลดล็อก (ลบ/รีเซ็ต login_throttle ของ username) → เข้าได้ทันที', async () => {
    const c = new Client();
    for (let i = 0; i < 5; i++) await c.login('alice', OTHER_PIN);
    expect((await c.login('alice', GOOD_PIN)).code).toBe('LOGIN_LOCKED');
    // service จริงอยู่ที่ R5 (`admin.user.unlock`) — มันเรียก repo ตัวนี้
    await resetLoginThrottle(h.db, 'u:alice', h.clock.now());
    const ok = await c.login('alice', GOOD_PIN);
    expect(ok.status).toBe(200);
  });

  it('ล็อกของ alice ไม่กระทบ bob (คีย์ต่อ username)', async () => {
    await h.seedUser('bob');
    const c = new Client();
    for (let i = 0; i < 5; i++) await c.login('alice', OTHER_PIN);
    const ok = await new Client().login('bob', GOOD_PIN);
    expect(ok.status).toBe(200);
  });

  it('คำขอ login ที่ค้างอยู่ในช่วงล็อกไม่ verify argon2 (ไม่เสีย CPU) — ตอบเร็วกว่า verify จริงชัดเจน', async () => {
    const c = new Client();
    for (let i = 0; i < 5; i++) await c.login('alice', OTHER_PIN);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) await c.login('alice', GOOD_PIN);
    const lockedAvg = (performance.now() - t0) / 5;
    const t1 = performance.now();
    await new Client().login('bobby', OTHER_PIN);
    const verifyOnce = performance.now() - t1;
    expect(lockedAvg).toBeLessThan(verifyOnce);
  });
});
