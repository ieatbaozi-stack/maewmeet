// Security R5 L3 — super admin ยกเลิกระงับ / ปลดล็อก super admin คนอื่นไม่ได้ (403 FORBIDDEN เหมือน suspend) · ปลดล็อกตัวเองได้
// (การระงับ SA ทำได้ทาง SQL เท่านั้น — การคืนสถานะก็ต้องเป็นการตัดสินของ boss/ops เช่นกัน)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOOD_PIN, OTHER_PIN } from '../auth/harness';
import { Client, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

let h: Harness;
let boss: Person;
let boss2: Person;
let user: Person;

beforeEach(async () => {
  h = await setupHarness();
  boss = await person(h, 'boss', { admin: true });
  boss2 = await person(h, 'boss2', { admin: true });
  user = await person(h, 'nina');
});
afterEach(async () => {
  await h.cleanup();
});

const status = async (id: string) => (await h.rows<{ status: string }>('SELECT status FROM user WHERE id = ?', [id]))[0]!.status;
const auditRows = (action: string, target: string) => h.count('audit_log WHERE action = ? AND target_id = ?', [action, target]);
const lock = async (username: string) => {
  const c = new Client();
  for (let i = 0; i < 5; i++) await c.login(username, OTHER_PIN);
  expect((await c.login(username, OTHER_PIN)).code).toBe('LOGIN_LOCKED');
};

describe('L3: unsuspend / unlock super admin คนอื่น', () => {
  it('SA ที่ถูกระงับด้วย SQL → SA อีกคน unsuspend = 403 FORBIDDEN · สถานะไม่เปลี่ยน · ไม่มี audit', async () => {
    await h.t.db.$client.execute({ sql: "UPDATE user SET status = 'suspended' WHERE id = ?", args: [boss2.id] });
    const r = await post(boss.c, `/api/admin/users/${boss2.id}/unsuspend`);
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
    expect(await status(boss2.id)).toBe('suspended');
    expect(await auditRows('admin.user.suspend', boss2.id)).toBe(0);
  });

  it('unlock SA คนอื่น = 403 · ยังล็อกอยู่ · ปลดล็อกตัวเองได้ · ผู้ใช้ทั่วไปปลดล็อกได้ตามเดิม', async () => {
    await lock('boss2');
    const r = await post(boss.c, `/api/admin/users/${boss2.id}/unlock`);
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
    expect((await new Client().login('boss2', GOOD_PIN)).code).toBe('LOGIN_LOCKED');
    expect(await auditRows('admin.user.unlock', boss2.id)).toBe(0);

    // ตัวเอง: ตัวนับผิดของตัวเองล้างได้ (session ยังอยู่ — ล็อกกันแค่ login ใหม่)
    await lock('boss');
    expect((await post(boss.c, `/api/admin/users/${boss.id}/unlock`)).status).toBe(200);
    expect((await new Client().login('boss', GOOD_PIN)).status).toBe(200);

    await lock('nina');
    expect((await post(boss.c, `/api/admin/users/${user.id}/unlock`)).status).toBe(200);
    expect((await post(boss.c, `/api/admin/users/${user.id}/suspend`)).status).toBe(200);
    expect((await post(boss.c, `/api/admin/users/${user.id}/unsuspend`)).status).toBe(200);
  });
});
