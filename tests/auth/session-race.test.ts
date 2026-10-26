// Security R5 L1/L2 — login แข่งกับการลบบัญชี / การระงับ: session ต้องถูกสร้างเฉพาะเมื่อบัญชียัง active
// (เงื่อนไขสถานะอยู่ในคำสั่ง INSERT เดียวกับการสร้าง session) · session ของบัญชีที่ลบแล้วถือว่าไม่มี (เครื่องนั้น login/สมัคร/ออกจากระบบได้ตามปกติ)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertSession } from '@/lib/data/repos/session';
import { GOOD_PIN } from './harness';
import { Client, person, post, setupHarness, type Harness, type Person } from '../appointments/util';

let h: Harness;
let boss: Person;

beforeEach(async () => {
  h = await setupHarness();
  boss = await person(h, 'boss', { admin: true });
});
afterEach(async () => {
  await h.cleanup();
});

const sessionsOf = (id: string) => h.count('session WHERE user_id = ?', [id]);

describe('login แข่งกับการลบบัญชี (L1)', () => {
  it('ยิงพร้อมกันหลายรอบ: ลบสำเร็จ ⇒ ไม่เหลือ session ของบัญชีที่ลบ · login ที่แพ้ได้ความล้มเหลวปกติ', async () => {
    for (let i = 0; i < 6; i++) {
      const v = await person(h, `del${i}`);
      const other = new Client();
      const [login, del] = await Promise.all([other.login(v.username, GOOD_PIN), post(v.c, '/api/me/delete', { pin: GOOD_PIN })]);
      expect(del.status, `round ${i}`).toBe(200);
      expect(await sessionsOf(v.id), `round ${i}: session ค้างของบัญชีที่ลบ`).toBe(0);
      if (login.status !== 200) expect(login.code).toBe('INVALID_CREDENTIALS');
      // เครื่องที่ login ใช้งานต่อได้ตามปกติ (ไม่ติดล็อก)
      const fresh = await person(h, `next${i}`);
      expect((await other.login(fresh.username, GOOD_PIN)).status, `round ${i}: เครื่องเดิม login บัญชีอื่นได้`).toBe(200);
    }
  });

  it('session ค้างของบัญชีที่ลบ (แถวเก่า) ถือว่าไม่มี: login/สมัครจากเครื่องนั้นได้', async () => {
    const v = await person(h, 'ghost');
    const stale = new Client();
    v.c.cloneJarTo(stale);
    expect((await post(v.c, '/api/me/delete', { pin: GOOD_PIN })).status).toBe(200);
    // จำลองแถวที่หลุดรอดมาก่อนแก้: session id เดียวกับคุกกี้ของ stale
    const { readSessionId } = await import('@/lib/auth/session');
    const sid = readSessionId(new Request('https://x/', { headers: { cookie: stale.cookieHeader() } }))!;
    await insertSession(h.db, { id: sid, userId: v.id }, h.clock.now());
    // เดิม: actor = user ที่ status=deleted → ทุก action (รวม login/สมัคร) ได้ 401 จนกว่าจะล้างคุกกี้เอง
    expect((await stale.getJson('/api/auth/session')).code).toBe('AUTH_REQUIRED');
    const other = await person(h, 'alive');
    expect((await stale.login(other.username, GOOD_PIN)).status, 'login บัญชีอื่นจากเครื่องเดิม').toBe(200);
    const stale2 = new Client();
    v.c.cloneJarTo(stale2);
    expect(
      (await stale2.post('/api/auth/signup', { username: 'newbie', displayName: 'มือใหม่', pin: GOOD_PIN, pinConfirm: GOOD_PIN })).status,
      'สมัครจากเครื่องเดิม',
    ).toBe(201);
  });
});

describe('login แข่งกับการระงับ (L2)', () => {
  it('ยิงพร้อมกันหลายรอบ: ระงับสำเร็จ ⇒ ไม่เหลือ session · หลังยกเลิกระงับ session เก่าใช้ไม่ได้', async () => {
    for (let i = 0; i < 8; i++) {
      const v = await person(h, `sus${i}`);
      const other = new Client();
      const [login, sus] = await Promise.all([other.login(v.username, GOOD_PIN), post(boss.c, `/api/admin/users/${v.id}/suspend`)]);
      expect(sus.status, `round ${i}`).toBe(200);
      expect(await sessionsOf(v.id), `round ${i}: session รอดการระงับ`).toBe(0);
      if (login.status !== 200) expect(['ACCOUNT_SUSPENDED', 'INVALID_CREDENTIALS']).toContain(login.code);
      expect((await post(boss.c, `/api/admin/users/${v.id}/unsuspend`)).status).toBe(200);
      expect((await other.getJson('/api/groups')).status, `round ${i}: session เก่ากลับมาใช้ได้`).toBe(401);
    }
  });
});
