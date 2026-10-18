// ADR 0002 Test requirement 13 (§7.3): หมุน pepper โดยไม่ต้อง reset ใคร
// ผู้ใช้ hash ด้วย V1 → ตั้ง PIN_PEPPER_V2 + CURRENT=2 → login สำเร็จ, pin_pepper_version=2, verify ด้วย V2 ผ่าน · ผู้ใช้ใหม่ได้ V2 ทันที
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPepperHealth } from '@/lib/auth/pepper';
import { verifyPin } from '@/lib/auth/pin';
import { Client, freshPepper, GOOD_PIN, OTHER_PIN, setPepperEnv, setupHarness, type Harness } from './harness';

let h: Harness;
let p1: string;
let p2: string;
beforeEach(async () => {
  h = await setupHarness();
  p1 = h.peppers[1]!;
  p2 = freshPepper(); // สร้างในเทสต์เท่านั้น
});
afterEach(async () => {
  await h.cleanup();
});

const rowOf = async (u: string) =>
  (await h.rows<{ pin_hash: string; pin_pepper_version: number }>('SELECT pin_hash, pin_pepper_version FROM user WHERE username = ?', [u]))[0]!;

describe('หมุน pepper V1 → V2', () => {
  it('login สำเร็จด้วยเวอร์ชันเก่า → rehash เป็น V2 ใน request เดียวกัน (verify ด้วย V2 ผ่าน, V1 ไม่ผ่านแล้ว) · ไม่มีใครต้อง reset', async () => {
    await h.seedUser('alice', GOOD_PIN, { version: 1 });
    expect((await rowOf('alice')).pin_pepper_version).toBe(1);
    const oldHash = (await rowOf('alice')).pin_hash;

    setPepperEnv({ 1: p1, 2: p2 }, 2); // ตั้ง V2 + CURRENT=2 (ไม่ลบ V1)
    const r = await new Client().login('alice', GOOD_PIN);
    expect(r.status).toBe(200);

    const row = await rowOf('alice');
    expect(row.pin_pepper_version).toBe(2);
    expect(row.pin_hash).not.toBe(oldHash);
    expect(await verifyPin(GOOD_PIN, row.pin_hash, Buffer.from(p2, 'base64'))).toBe(true);
    expect(await verifyPin(GOOD_PIN, row.pin_hash, Buffer.from(p1, 'base64'))).toBe(false);
    // login ครั้งถัดไปใช้ hash ใหม่ได้ และ PIN ผิดยังผิด
    expect((await new Client().login('alice', GOOD_PIN)).status).toBe(200);
    expect((await new Client().login('alice', OTHER_PIN)).code).toBe('INVALID_CREDENTIALS');
    expect(await h.count('pin_reset_request')).toBe(0);
  });

  it('PIN ผิดด้วยเวอร์ชันเก่า → ไม่ rehash (hash เดิมคงที่)', async () => {
    await h.seedUser('alice', GOOD_PIN, { version: 1 });
    const before = await rowOf('alice');
    setPepperEnv({ 1: p1, 2: p2 }, 2);
    expect((await new Client().login('alice', OTHER_PIN)).code).toBe('INVALID_CREDENTIALS');
    expect(await rowOf('alice')).toEqual(before);
  });

  it('ผู้ใช้ใหม่ (สมัคร) ได้ V2 ทันที · ผู้ใช้ที่ยังไม่ได้ login ยังอยู่ V1 และ login ได้ตามปกติ', async () => {
    await h.seedUser('old_timer', GOOD_PIN, { version: 1 });
    setPepperEnv({ 1: p1, 2: p2 }, 2);
    const c = new Client();
    expect((await c.post('/api/auth/signup', { username: 'fresh_one', displayName: 'F', pin: GOOD_PIN, pinConfirm: GOOD_PIN })).status).toBe(201);
    expect((await rowOf('fresh_one')).pin_pepper_version).toBe(2);
    expect((await rowOf('old_timer')).pin_pepper_version).toBe(1);

    const health = await readPepperHealth(h.db, h.clock.now());
    expect(health).toEqual({ ok: true, currentVersion: 2, usersByVersion: { 1: 1, 2: 1 } });

    expect((await new Client().login('old_timer', GOOD_PIN)).status).toBe(200);
    expect((await readPepperHealth(h.db, h.clock.now())).usersByVersion).toEqual({ 2: 2 });
  });

  it('เปลี่ยน PIN ใช้ pepper ปัจจุบัน (V2) เสมอ', async () => {
    await h.seedUser('alice', GOOD_PIN, { version: 1 });
    setPepperEnv({ 1: p1, 2: p2 }, 2);
    const c = new Client();
    // login ปกติจะ rehash ไปแล้ว — ทำให้กลับเป็น V1 เพื่อพิสูจน์ว่า "เปลี่ยน PIN" เองก็เลื่อนเวอร์ชัน
    await c.login('alice', GOOD_PIN);
    const { hashPin } = await import('@/lib/auth/pin');
    const v1 = await hashPin(GOOD_PIN, { version: 1, secret: Buffer.from(p1, 'base64') });
    await h.rows("UPDATE user SET pin_hash = ?, pin_pepper_version = 1 WHERE username = 'alice'", [v1]);
    const r = await c.post('/api/auth/pin', { newPin: '864209', newPinConfirm: '864209', currentPin: GOOD_PIN });
    expect(r.status).toBe(200);
    const row = await rowOf('alice');
    expect(row.pin_pepper_version).toBe(2);
    expect(await verifyPin('864209', row.pin_hash, Buffer.from(p2, 'base64'))).toBe(true);
  });

  it('ลบ V1 ออกจาก env ทั้งที่ยังมีผู้ใช้ V1 → เฉพาะกลุ่มนั้นได้ AUTH_MAINTENANCE (ไม่นับผิด) · ผู้ใช้ V2 เข้าได้ · health แดง', async () => {
    await h.seedUser('on_v1', GOOD_PIN, { version: 1 });
    setPepperEnv({ 1: p1, 2: p2 }, 2);
    await new Client().post('/api/auth/signup', { username: 'on_v2', displayName: 'T', pin: GOOD_PIN, pinConfirm: GOOD_PIN });

    setPepperEnv({ 2: p2 }, 2); // ลบ V1 (ผิดขั้นตอน — ยังมีผู้ใช้อยู่)
    const stuck = await new Client().login('on_v1', GOOD_PIN);
    expect(stuck.status).toBe(503);
    expect(stuck.code).toBe('AUTH_MAINTENANCE');
    const wrong = await new Client().login('on_v1', OTHER_PIN); // แม้ PIN ผิดก็ไม่นับ
    expect(wrong.code).toBe('AUTH_MAINTENANCE');
    expect(await h.count("login_throttle WHERE key = 'u:on_v1'")).toBe(0);
    expect((await new Client().login('on_v2', GOOD_PIN)).status).toBe(200);
    expect((await readPepperHealth(h.db, h.clock.now())).ok).toBe(false);

    // ใส่คืน → กลับมาใช้ได้ทันที ไม่มีความเสียหาย
    setPepperEnv({ 1: p1, 2: p2 }, 2);
    expect((await new Client().login('on_v1', GOOD_PIN)).status).toBe(200);
    expect((await readPepperHealth(h.db, h.clock.now())).ok).toBe(true);
  });
});
