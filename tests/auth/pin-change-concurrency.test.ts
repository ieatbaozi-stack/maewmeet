// R5 follow-up (Platform/Architect): เปลี่ยน PIN เขียนตัวนับ login_throttle ผ่านคิว serialized() เหมือน services/account.ts
// เดิม reserve/failed/succeeded เขียนตรงนอกคิว → ชนล็อกกับธุรกรรมกลุ่มที่กำลังเขียนใน process เดียวกัน (DB file: driver sync)
// แล้วได้ SQLITE_BUSY → 500 · เทสต์นี้ยิงเปลี่ยน PIN (ผิด/ถูก) พร้อมกับการเขียนของกลุ่มหลายรอบ แล้วยืนยันว่าไม่มี 500 และตัวนับถูกต้อง
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOOD_PIN, OTHER_PIN } from './harness';
import { join, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from '../appointments/util';

let h: Harness;
let a: Person;
let b: Person;

beforeEach(async () => {
  h = await setupHarness();
  a = await person(h, 'alice');
  b = await person(h, 'bob');
});
afterEach(async () => {
  await h.cleanup();
});

const NEW_PIN = '864209';
const failures = async () =>
  (await h.rows<{ failures: number }>("SELECT failures FROM login_throttle WHERE key = 'u:bob'"))[0]?.failures ?? 0;

describe('เปลี่ยน PIN พร้อมกับธุรกรรมอื่น (serialized)', () => {
  it('PIN ผิดพร้อมการเขียนของกลุ่มหลายรอบ → ไม่มี 500 · ตัวนับเพิ่มตามจำนวนครั้งพอดี', async () => {
    const gid = await makeGroup(a, 'ก๊วน');
    await join(a, b, gid);
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [pin, ...writes] = await Promise.all([
        post(b.c, '/api/auth/pin', { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: OTHER_PIN }),
        patch(a.c, `/api/groups/${gid}`, { name: `ก๊วน ${i}` }),
        post(a.c, `/api/groups/${gid}/invites/code`),
      ]);
      results.push(pin.status, ...writes.map((w) => w.status));
      expect(pin.code).toBe('INVALID_CREDENTIALS');
    }
    expect(results.filter((s) => s >= 500)).toEqual([]);
    expect(await failures()).toBe(4);
  });

  it('PIN ถูกพร้อมโอน admin → ทั้งคู่สำเร็จ (ไม่มี 500) · ตัวนับถูกล้าง · PIN ใหม่ใช้ได้', async () => {
    const gid = await makeGroup(a, 'ก๊วนโอน');
    await join(a, b, gid);
    await post(b.c, '/api/auth/pin', { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: OTHER_PIN });
    expect(await failures()).toBe(1);
    const [pin, transfer] = await Promise.all([
      post(b.c, '/api/auth/pin', { newPin: NEW_PIN, newPinConfirm: NEW_PIN, currentPin: GOOD_PIN }),
      post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id }),
    ]);
    expect(pin.status).toBe(200);
    expect(transfer.status).toBe(200);
    expect(await failures()).toBe(0);
    expect(await h.count("group_member WHERE group_id = ? AND role = 'admin' AND user_id = ?", [gid, b.id])).toBe(1);
  });
});
