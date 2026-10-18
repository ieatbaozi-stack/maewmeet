// ADR 0002 §4 + R1_CONTRACT §2/R1-8: `is_admin` อ่านสดจาก DB ทุก request (ไม่ cache ใน cookie/session/instance) และไม่มี endpoint ใดตั้งได้
// ขั้นตอนของ boss: สมัครบนเว็บ แล้วรัน SQL `UPDATE user SET is_admin = 1 WHERE username = '…'` → บัญชีนั้นเห็น /admin/pin-resets ทันที
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { listSuperAdminUsernames } from '@/lib/data/repos/user';
import { Client, GOOD_PIN, loggedIn, setupHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const LIST = '/api/auth/admin/pin-resets';
const sessionIsAdmin = async (c: Client) =>
  (await c.getJson<{ user: { isAdmin: boolean } }>('/api/auth/session')).data.user.isAdmin;

describe('is_admin อ่านสดทุก request', () => {
  it('ตั้งด้วย SQL หลังล็อกอินแล้ว → request ถัดไปเห็นสิทธิ์ทันที (ไม่ต้องล็อกอินใหม่) · ถอนด้วย SQL → หายทันที', async () => {
    const { c } = await loggedIn(h, 'boss');
    expect((await c.getJson(LIST)).code).toBe('FORBIDDEN');
    expect(await sessionIsAdmin(c)).toBe(false);

    await h.rows("UPDATE user SET is_admin = 1 WHERE username = 'boss'"); // SQL ของ boss บน Turso
    expect((await c.getJson(LIST)).status).toBe(200);
    expect(await sessionIsAdmin(c)).toBe(true);
    expect(await listSuperAdminUsernames(h.db)).toEqual(['boss']);

    await h.rows("UPDATE user SET is_admin = 0 WHERE username = 'boss'");
    const after = await c.getJson(LIST);
    expect(after.status).toBe(403);
    expect(await sessionIsAdmin(c)).toBe(false);
  });

  it('สลับหลายรอบใน session เดียว ไม่มีค่าค้าง (cache)', async () => {
    const { c } = await loggedIn(h, 'boss');
    for (let i = 0; i < 4; i++) {
      await h.setAdminBySql('boss', true);
      expect((await c.getJson(LIST)).status).toBe(200);
      await h.setAdminBySql('boss', false);
      expect((await c.getJson(LIST)).status).toBe(403);
    }
  });

  it('สมัครใหม่ → login ใหม่หลังตั้ง SQL: DTO ของ login/session สะท้อน isAdmin จริง', async () => {
    const c = new Client();
    await c.post('/api/auth/signup', { username: 'newboss', displayName: 'B', pin: GOOD_PIN, pinConfirm: GOOD_PIN });
    expect((await c.getJson(LIST)).status).toBe(403);
    await h.setAdminBySql('newboss');
    const again = new Client();
    const r = await again.login('newboss', GOOD_PIN);
    expect((r.data.user as { isAdmin: boolean }).isAdmin).toBe(true);
    expect((await again.getJson(LIST)).status).toBe(200);
  });

  it('super admin ที่ถูกระงับ → ACCOUNT_SUSPENDED (สถานะมาก่อนสิทธิ์) · ติด must_change_pin → PIN_CHANGE_REQUIRED', async () => {
    const { c } = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    await h.rows("UPDATE user SET status = 'suspended' WHERE username = 'boss'");
    expect((await c.getJson(LIST)).code).toBe('ACCOUNT_SUSPENDED');
  });

  it('คนทั่วไปที่รู้ endpoint ก็เข้าไม่ได้: anonymous 401 · ผู้ใช้ 403 — และไม่มีข้อมูลรั่วใน body', async () => {
    await h.seedUser('victim');
    await new Client().post('/api/auth/pin-reset', { username: 'victim' });
    const anon = await new Client().getJson(LIST);
    expect(anon.status).toBe(401);
    const { c } = await loggedIn(h, 'plain');
    const r = await c.getJson(LIST);
    expect(r.status).toBe(403);
    expect(r.text).not.toContain('victim');
  });
});

describe('ไม่มี endpoint ใดตั้ง is_admin ได้', () => {
  it('ยิงทุก route ใน manifest ด้วย body ที่แนบ isAdmin/is_admin/role → DB ไม่เปลี่ยน (strict → VALIDATION) และคนทั่วไปไม่กลายเป็น admin', async () => {
    const { c, user } = await loggedIn(h, 'plain');
    const UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const evil = { isAdmin: true, is_admin: 1, role: 'admin', superAdmin: true, status: 'active' };
    const base: Record<string, Record<string, unknown>> = {
      'POST /api/auth/signup': { username: 'evil_user', displayName: 'E', pin: '482915', pinConfirm: '482915' },
      'POST /api/auth/login': { username: 'plain', pin: GOOD_PIN },
      'POST /api/auth/pin-reset': { username: 'plain' },
      'POST /api/auth/pin': { newPin: '482915', newPinConfirm: '482915', currentPin: GOOD_PIN },
      'POST /api/prefs': { theme: 'dark' },
    };
    const touched: string[] = [];
    for (const e of ROUTE_MANIFEST.filter((x) => x.auth === 'actor')) {
      const k = `${e.method} ${e.path}`;
      const url = e.path.replace(/:\w+/g, UUID);
      const body = { ...(base[k] ?? {}), ...evil };
      const r = await new Client(c.ip).call(e.method as 'GET' | 'POST', url, e.method === 'GET' ? undefined : body, {
        headers: { cookie: c.cookieHeader() },
      });
      // ไม่มี route ไหนยอมรับฟิลด์พวกนี้: อย่างเดียวที่ยอมได้คือ route ที่ไม่มี input เลย (ไม่อ่าน body) — และมันก็ไม่ได้ทำอะไรกับ body
      if (r.status < 400) touched.push(k);
      expect(r.status, k).not.toBe(500);
    }
    // route ที่ไม่ปฏิเสธ body แปลก ๆ ต้องเป็นพวกไม่มี input เท่านั้น (logout, logout-all, approve/reject, GET)
    for (const k of touched) {
      expect(k).toMatch(/^(GET|POST) \/api\/auth\/(logout|logout-all|session|pin-reset\/status|admin\/pin-resets.*)$/);
    }
    const admins = await h.rows<{ username: string }>('SELECT username FROM user WHERE is_admin = 1');
    expect(admins).toEqual([]);
    expect((await h.rows<{ is_admin: number }>('SELECT is_admin FROM user WHERE id = ?', [user.id]))[0]!.is_admin).toBe(0);
  });

  it('สมัคร/login/ตั้ง PIN ที่มี isAdmin ใน body → 400 VALIDATION ทุกตัว', async () => {
    const c = new Client();
    expect((await c.post('/api/auth/signup', { username: 'abc', displayName: 'x', pin: GOOD_PIN, pinConfirm: GOOD_PIN, isAdmin: true })).code).toBe('VALIDATION');
    expect((await c.post('/api/auth/login', { username: 'abc', pin: GOOD_PIN, isAdmin: true })).code).toBe('VALIDATION');
    expect((await c.post('/api/auth/pin-reset', { username: 'abc', isAdmin: true })).code).toBe('VALIDATION');
    expect(await h.count('user')).toBe(0);
  });

  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  /** รูปแบบการเขียน is_admin ที่ห้ามมีในแอป (นอก schema) */
  const adminWrites = (code: string): string[] => {
    const out: string[] = [];
    if (/\bis_admin\b/.test(code)) out.push('raw is_admin');
    if (/\.(set|values)\(\s*\{[^}]*\bisAdmin\b/s.test(code)) out.push('set/values isAdmin');
    return out;
  };

  it('ตัวตรวจสแกนจับของจริงได้ (ด้านลบ): .set({isAdmin}), .values({isAdmin}), SQL ดิบ — แต่ไม่จับการอ่าน/คอมเมนต์', () => {
    expect(adminWrites(stripComments('await db.update(user).set({ isAdmin: true }).where(x)'))).toHaveLength(1);
    expect(adminWrites(stripComments('db.insert(user).values({\n id,\n isAdmin: true,\n})'))).toHaveLength(1);
    expect(adminWrites(stripComments("db.run(sql`UPDATE user SET is_admin = 1`)"))).toHaveLength(1);
    expect(adminWrites(stripComments('select({ isAdmin: user.isAdmin }).from(user) // is_admin /* is_admin */'))).toEqual([]);
    expect(adminWrites(stripComments('/* ตั้ง is_admin ใน DB */ const a = u.isAdmin;'))).toEqual([]);
  });

  it('สแกนซอร์สจริง: ไม่มีโค้ดเขียน is_admin/isAdmin (set/values/SQL ดิบ) ในแอป — เหลือแค่ schema และการอ่าน', () => {
    const ROOT = path.resolve(import.meta.dirname, '../../src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs)$/.test(n)) files.push(p);
      }
    };
    walk(ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f);
      if (rel === path.join('db', 'schema.ts')) continue;
      for (const o of adminWrites(stripComments(readFileSync(f, 'utf8')))) offenders.push(`${rel}: ${o}`);
    }
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(30); // สแกนจริง ไม่ใช่ว่าง
  });
});
