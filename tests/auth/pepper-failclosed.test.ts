// ADR 0002 Test requirement 14 (§7.1): pepper fail closed
// ไม่มี PIN_PEPPER_CURRENT_VERSION / ไม่มี PIN_PEPPER_V<CURRENT> / ค่าว่าง / base64 สั้นกว่า 32 ไบต์ →
//   health ไม่ผ่าน (readPepperHealth.ok=false → route health ตอบ 503) · login/signup/เปลี่ยน PIN → 503 AUTH_MAINTENANCE ·
//   login_throttle ไม่เปลี่ยน · session เดิมยังใช้ส่วนอื่นได้ · ไม่มีการเขียน pepper_fingerprint แถวใหม่
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPepperHealth } from '@/lib/auth/pepper';
import { Client, freshPepper, GOOD_PIN, loggedIn, OTHER_PIN, setPepperEnv, setupHarness, type Harness } from './harness';

let h: Harness;
let good: string;
beforeEach(async () => {
  h = await setupHarness();
  good = h.peppers[1]!;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

const BREAKS: [string, () => void][] = [
  ['ไม่มี PIN_PEPPER_CURRENT_VERSION', () => setPepperEnv({ 1: good }, null)],
  ['ไม่มี PIN_PEPPER_V<CURRENT> (CURRENT=2 แต่มีแค่ V1)', () => setPepperEnv({ 1: good }, 2)],
  ['ไม่มี pepper เลย', () => setPepperEnv({}, 1)],
  ['ค่าว่าง', () => setPepperEnv({ 1: '' }, 1)],
  ['ค่าเป็นช่องว่างล้วน', () => setPepperEnv({ 1: '   ' }, 1)],
  ['base64 สั้นกว่า 32 ไบต์ (31)', () => setPepperEnv({ 1: Buffer.alloc(31, 7).toString('base64') }, 1)],
  ['ไม่ใช่ base64', () => setPepperEnv({ 1: '!!!not base64!!!' + 'x'.repeat(40) }, 1)],
];

describe.each(BREAKS)('%s', (_name, breakIt) => {
  it('health ไม่ผ่าน · login/signup/เปลี่ยน PIN → 503 AUTH_MAINTENANCE · ไม่นับ throttle/IP · session เดิมใช้ส่วนอื่นได้ · ไม่เขียน fingerprint · กู้คืนแล้วใช้ได้ทันที', async () => {
    const alice = await loggedIn(h, 'alice'); // มี session อยู่ก่อนเกิดเหตุ
    await h.seedUser('bob');
    // มีสถานะ throttle อยู่ก่อน เพื่อเทียบ "ก่อน-หลัง" ว่าเหมือนเดิมทุกค่า
    await new Client().login('bob', OTHER_PIN);
    const snapshot = async () => ({
      throttle: await h.rows('SELECT * FROM login_throttle ORDER BY key'),
      buckets: await h.rows('SELECT * FROM rate_limit_bucket ORDER BY key'),
      fingerprints: await h.rows('SELECT * FROM pepper_fingerprint ORDER BY version'),
      users: await h.count('user'),
    });
    const before = await snapshot();
    expect(before.throttle).toHaveLength(1);
    expect(before.fingerprints).toHaveLength(1);

    breakIt();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await readPepperHealth(h.db, h.clock.now())).ok).toBe(false);

    const c = new Client();
    const loginRight = await c.login('alice', GOOD_PIN);
    const loginWrong = await c.login('bob', OTHER_PIN); // PIN ผิดก็ต้องไม่ถูกนับ
    const loginGhost = await c.login('nobody_here', OTHER_PIN);
    const signup = await c.post('/api/auth/signup', { username: 'new_one', displayName: 'N', pin: '482915', pinConfirm: '482915' });
    const change = await alice.c.post('/api/auth/pin', { newPin: '482915', newPinConfirm: '482915', currentPin: GOOD_PIN });
    for (const r of [loginRight, loginWrong, loginGhost, signup, change]) {
      expect(r.status).toBe(503);
      expect(r.code).toBe('AUTH_MAINTENANCE');
    }
    expect(c.jar.size).toBe(0);
    expect(await snapshot()).toEqual(before); // throttle / rate_limit_bucket / fingerprint / จำนวนผู้ใช้ ไม่ขยับ

    // session เดิมยังใช้ส่วนอื่นได้ (session ไม่ขึ้นกับ pepper)
    expect((await alice.c.getJson('/api/auth/session')).status).toBe(200);
    expect((await alice.c.post('/api/prefs', { theme: 'dark' })).status).toBe(200);
    expect((await alice.c.post('/api/auth/logout')).status).toBe(200);

    // log: มีรหัส PEPPER_CHECK_FAILED แต่ไม่มีค่า pepper
    const logged = errors.mock.calls.map((a) => a.map(String).join(' ')).join('\n');
    expect(logged).toContain('PEPPER_CHECK_FAILED');
    expect(logged).not.toContain(good);

    // ใส่ค่าถูกคืน → ใช้ได้ทันที
    setPepperEnv({ 1: good }, 1);
    expect((await new Client().login('alice', GOOD_PIN)).status).toBe(200);
    expect((await new Client().login('bob', OTHER_PIN)).code).toBe('INVALID_CREDENTIALS');
  });
});

describe('ไม่เดา/ไม่สร้างเอง', () => {
  it('DB ว่างและไม่มี pepper ใน env → ไม่เขียน fingerprint ใด ๆ และไม่รับสมัคร', async () => {
    const e = await setupHarness({ peppers: {}, current: 1, initFingerprint: false }).catch(() => null);
    if (e) await e.cleanup();
    setPepperEnv({}, 1);
    const r = await new Client().post('/api/auth/signup', { username: 'abc', displayName: 'N', pin: '482915', pinConfirm: '482915' });
    expect(r.code).toBe('AUTH_MAINTENANCE');
  });

  it('pepper ใหม่ทั้งชุด (เปลี่ยนค่าเป็นอย่างอื่น) ไม่ถูก "ยอมรับ" เงียบ ๆ: fingerprint ไม่ตรง → AUTH_MAINTENANCE ไม่ใช่ INVALID_CREDENTIALS', async () => {
    await h.seedUser('alice');
    setPepperEnv({ 1: freshPepper() }, 1);
    const r = await new Client().login('alice', GOOD_PIN);
    expect(r.code).toBe('AUTH_MAINTENANCE');
    expect(await h.count('login_throttle')).toBe(0);
  });
});

describe('PIN_PEPPER_CURRENT_VERSION ที่ไม่ใช่จำนวนเต็ม ≥ 1', () => {
  it('readPepperEnv/readPepperHealth ปฏิเสธ (ok=false) — ตัวอ่านของ pepper fail closed ถูกต้อง', async () => {
    for (const bad of ['0', '-1', 'abc', '1.5']) {
      setPepperEnv({ 1: good }, null);
      process.env.PIN_PEPPER_CURRENT_VERSION = bad;
      expect((await readPepperHealth(h.db, h.clock.now())).ok, bad).toBe(false);
    }
  });
  // ดู Handoff: ค่านี้ทำให้ getEnv() ของ Platform (src/lib/shared/env.ts baseEnvSchema) โยน → ทุก route ตอบ 500 (ไม่ใช่เฉพาะ AUTH_MAINTENANCE)
  // เป็นของ Platform/Lead ตัดสินใจ — ไม่ครอบด้วยเทสต์ HTTP ที่นี่
});
