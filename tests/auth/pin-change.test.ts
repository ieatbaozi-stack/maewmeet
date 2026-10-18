// ADR 0002 Test requirement 11 (U13) + ส่วนตั้ง PIN ใหม่ของข้อ 10 (U3):
// เปลี่ยน PIN ต้องใส่ PIN เดิมถูก · ผิดนับ throttle · ตั้งสำเร็จ → session อื่นถูกลบ, must_change_pin=0, คำขอ pending ที่ค้างถูกยกเลิก
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FORBIDDEN_PINS, RESET_PIN } from '@/lib/auth/pin-rules';
import { Client, GOOD_PIN, loggedIn, OTHER_PIN, setupHarness, SESSION_COOKIE, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const NEW_PIN = '864209';
const change = (c: Client, body: Record<string, unknown>) => c.post('/api/auth/pin', body);
const failures = async (u = 'alice') =>
  (await h.rows<{ failures: number }>('SELECT failures FROM login_throttle WHERE key = ?', [`u:${u}`]))[0]?.failures ?? 0;

describe('U13 เปลี่ยน PIN (ปกติ)', () => {
  it('ต้องใส่ PIN เดิม: ไม่ใส่ → VALIDATION · ผิด → INVALID_CREDENTIALS + นับ throttle · ถูก → สำเร็จ', async () => {
    const { c } = await loggedIn(h, 'alice');
    const missing = await change(c, { newPin: NEW_PIN, newPinConfirm: NEW_PIN });
    expect(missing.status).toBe(400);
    expect(missing.code).toBe('VALIDATION');
    expect(await failures()).toBe(0);

    const wrong = await change(c, { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: OTHER_PIN });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error).toEqual({ code: 'INVALID_CREDENTIALS', params: { attemptsRemaining: 4 } });
    expect(await failures()).toBe(1);

    const ok = await change(c, { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: GOOD_PIN });
    expect(ok.status).toBe(200);
    expect(await failures()).toBe(0); // สำเร็จรีเซ็ต
    // PIN เก่าใช้ไม่ได้ ใหม่ใช้ได้
    expect((await new Client().login('alice', GOOD_PIN)).status).toBe(401);
    expect((await new Client().login('alice', NEW_PIN)).status).toBe(200);
  });

  it('ผิดซ้ำ → ล็อก username เดียวกับ login (5 ครั้ง) และระหว่างล็อกแม้ PIN ถูกก็เปลี่ยนไม่ได้', async () => {
    const { c } = await loggedIn(h, 'alice');
    for (let i = 0; i < 4; i++) {
      expect((await change(c, { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: OTHER_PIN })).code).toBe('INVALID_CREDENTIALS');
    }
    const fifth = await change(c, { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: OTHER_PIN });
    expect(fifth.status).toBe(429);
    expect(fifth.json.error).toEqual({ code: 'LOGIN_LOCKED', params: { retryAfterSec: 60 } });
    expect(Number(fifth.headers.get('retry-after'))).toBe(60);
    const right = await change(c, { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: GOOD_PIN });
    expect(right.code).toBe('LOGIN_LOCKED');
    // และ login ปกติก็ติดล็อกเดียวกัน
    expect((await new Client().login('alice', GOOD_PIN)).code).toBe('LOGIN_LOCKED');
  });

  it('PIN ใหม่ต้องผ่านกติกา: รูปแบบ → PIN_FORMAT · 20 ตัวต้องห้ามรวม 123456 → PIN_TOO_WEAK · ไม่ตรงยืนยัน → PIN_MISMATCH · ไม่เปลี่ยนอะไร', async () => {
    const { c } = await loggedIn(h, 'alice');
    expect((await change(c, { newPin: '12345', newPinConfirm: '12345', currentPin: GOOD_PIN })).code).toBe('PIN_FORMAT');
    for (const pin of FORBIDDEN_PINS) {
      expect((await change(c, { newPin: pin, newPinConfirm: pin, currentPin: GOOD_PIN })).code, pin).toBe('PIN_TOO_WEAK');
    }
    expect((await change(c, { newPin: NEW_PIN, newPinConfirm: OTHER_PIN, currentPin: GOOD_PIN })).code).toBe('PIN_MISMATCH');
    expect((await new Client().login('alice', GOOD_PIN)).status).toBe(200); // PIN เดิมยังใช้ได้
  });

  it('สำเร็จ → session อื่นทั้งหมดถูกลบ เหลือเครื่องปัจจุบัน · เครื่องอื่นได้ 401', async () => {
    const { c: phone } = await loggedIn(h, 'alice');
    const laptop = new Client();
    const tablet = new Client();
    await laptop.login('alice', GOOD_PIN);
    await tablet.login('alice', GOOD_PIN);
    const bob = await loggedIn(h, 'bob');
    expect(await h.rows('SELECT * FROM session')).toHaveLength(4);
    const r = await change(phone, { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: GOOD_PIN });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ mustChangePin: false, otherSessionsRevoked: 2 });
    expect(await h.rows('SELECT * FROM session')).toHaveLength(2); // phone + bob
    expect((await phone.getJson('/api/auth/session')).status).toBe(200);
    expect((await laptop.getJson('/api/auth/session')).status).toBe(401);
    expect((await tablet.getJson('/api/auth/session')).status).toBe(401);
    expect((await bob.c.getJson('/api/auth/session')).status).toBe(200);
  });

  it('สำเร็จ → ยกเลิกคำขอ reset ที่ค้าง (pending)', async () => {
    const { c } = await loggedIn(h, 'alice');
    await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    await change(c, { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: GOOD_PIN });
    expect((await h.rows<{ status: string }>('SELECT status FROM pin_reset_request'))[0]!.status).toBe('cancelled');
  });

  it('ไม่ได้ล็อกอิน → 401', async () => {
    const r = await change(new Client(), { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: GOOD_PIN });
    expect(r.status).toBe(401);
  });

  it('ไม่รับฟิลด์แปลก (strict)', async () => {
    const { c } = await loggedIn(h, 'alice');
    expect((await change(c, { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: GOOD_PIN, mustChangePin: false })).code).toBe('VALIDATION');
  });
});

describe('U3 ตั้ง PIN ใหม่หลัง reset (must_change_pin=1)', () => {
  async function resetFlow() {
    await h.seedUser('alice');
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    const phone = new Client();
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await h.rows<{ id: string }>('SELECT id FROM pin_reset_request')) as [{ id: string }];
    await boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`);
    expect((await phone.login('alice', RESET_PIN)).status).toBe(200);
    return phone;
  }

  it('ไม่ต้องใส่ currentPin · ตั้ง 123456 → PIN_TOO_WEAK · ตั้งสำเร็จ → must_change_pin=0 และใช้งานปกติ', async () => {
    const phone = await resetFlow();
    const weak = await change(phone, { newPin: RESET_PIN, newPinConfirm: RESET_PIN });
    expect(weak.status).toBe(400);
    expect(weak.code).toBe('PIN_TOO_WEAK');
    expect((await h.rows<{ must_change_pin: number }>("SELECT must_change_pin FROM user WHERE username = 'alice'"))[0]!.must_change_pin).toBe(1);
    const ok = await change(phone, { newPin: NEW_PIN, newPinConfirm: NEW_PIN });
    expect(ok.status).toBe(200);
    expect((await h.rows<{ must_change_pin: number }>("SELECT must_change_pin FROM user WHERE username = 'alice'"))[0]!.must_change_pin).toBe(0);
    expect((await phone.getJson<{ user: { mustChangePin: boolean } }>('/api/auth/session')).data.user.mustChangePin).toBe(false);
    // 123456 ใช้ไม่ได้อีก ส่วน PIN ใหม่เข้าได้ และ hash ใหม่ = argon2id
    expect((await new Client().login('alice', RESET_PIN)).status).toBe(401);
    expect((await new Client().login('alice', NEW_PIN)).status).toBe(200);
    const [u] = await h.rows<{ pin_hash: string }>("SELECT pin_hash FROM user WHERE username = 'alice'");
    expect(u!.pin_hash).toMatch(/^\$argon2id\$/);
  });

  it('ตั้งสำเร็จ → session อื่นของบัญชีนี้ถูกลบ (เช่น เครื่องที่ขโมย session ไว้)', async () => {
    const phone = await resetFlow();
    const other = new Client();
    phone.cloneJarTo(other); // จำลอง session ที่ถูกคัดลอก (ใช้ token เดียวกัน = แถวเดียว) → ทดสอบแถวอื่นด้วย login แยก
    await h.seedUser('dummy');
    // แถว session อื่นของ alice: สร้างตรง ๆ (ผู้ใช้ที่ must_change ล็อกอินเพิ่มไม่ได้ผ่าน API ตามข้อ 10)
    const { issueSession } = await import('@/lib/auth/session');
    const [{ id: userId }] = (await h.rows<{ id: string }>("SELECT id FROM user WHERE username = 'alice'")) as [{ id: string }];
    const stolen = await issueSession(h.db, userId, 'ua', h.clock.now());
    const thief = new Client();
    thief.set(SESSION_COOKIE, stolen.token);
    expect((await thief.post('/api/auth/logout-all')).status).toBe(403); // ยังติด PIN_CHANGE_REQUIRED
    const ok = await change(phone, { newPin: NEW_PIN, newPinConfirm: NEW_PIN });
    expect(ok.json.data).toMatchObject({ otherSessionsRevoked: 1 });
    expect((await thief.getJson('/api/auth/session')).status).toBe(401);
    expect((await phone.getJson('/api/auth/session')).status).toBe(200);
  });
});
