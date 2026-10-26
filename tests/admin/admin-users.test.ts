// R5-3 / R5-4 — /api/admin/* เมทริกซ์สิทธิ์ (HTTP จริง) + ระงับ/คืนสถานะ/ปลดล็อก (R5_CONTRACT §2 ข้อ 3, §5)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { isSuperAdminOnly } from '@/lib/rbac/actions';
import { GOOD_PIN, OTHER_PIN } from '../auth/harness';
import { Client, MIN, call, join, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

let h: Harness;
let boss: Person; // super admin (ไม่ใช่สมาชิกกลุ่มใด)
let ga: Person; // admin กลุ่ม
let mem: Person; // สมาชิก
let nm: Person; // ผู้ใช้ทั่วไป
let gid: string;

const ADMIN_ROUTES = ROUTE_MANIFEST.filter((e) => e.path.startsWith('/api/admin/'));
const pathOf = (p: string) => p.replace(':id', nm.id).replace(':gid', gid);
const hit = (c: Client, e: (typeof ADMIN_ROUTES)[number]) => call(c, e.method as 'GET', pathOf(e.path), e.method === 'GET' ? undefined : {});

beforeEach(async () => {
  h = await setupHarness();
  boss = await person(h, 'boss', { admin: true });
  ga = await person(h, 'alice');
  mem = await person(h, 'bob');
  nm = await person(h, 'nina');
  gid = await makeGroup(ga, 'ก๊วน');
  await join(ga, mem, gid);
});
afterEach(async () => {
  await h.cleanup();
});

describe('R5-3 เมทริกซ์ HTTP ของทุก /api/admin/*', () => {
  it('manifest: มี route admin ครบตามสัญญา และทุกตัวผูก action ที่เป็น SUPER_ADMIN_ONLY', () => {
    expect(ADMIN_ROUTES.map((e) => `${e.method} ${e.path}`).sort()).toEqual(
      [
        'GET /api/admin/audit',
        'GET /api/admin/groups',
        'GET /api/admin/groups/:gid',
        'GET /api/admin/users',
        'POST /api/admin/users/:id/suspend',
        'POST /api/admin/users/:id/unlock',
        'POST /api/admin/users/:id/unsuspend',
      ].sort(),
    );
    for (const e of ADMIN_ROUTES) {
      expect(e.auth, e.path).toBe('actor');
      expect(e.action !== null && isSuperAdminOnly(e.action), `${e.method} ${e.path} → ${e.action}`).toBe(true);
    }
  });

  it('anonymous → 401 AUTH_REQUIRED ทุก route', async () => {
    for (const e of ADMIN_ROUTES) {
      const r = await hit(new Client(), e);
      expect(r.status, `${e.method} ${e.path}`).toBe(401);
      expect(r.code).toBe('AUTH_REQUIRED');
      expect(r.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('ผู้ใช้ทั่วไป / สมาชิก / admin กลุ่ม → 403 FORBIDDEN ทุก route (ไม่มีอะไรเปลี่ยน ไม่มี audit)', async () => {
    const before = await h.count('audit_log');
    for (const p of [nm, mem, ga]) {
      for (const e of ADMIN_ROUTES) {
        const r = await hit(p.c, e);
        expect(r.status, `${p.username} ${e.method} ${e.path}`).toBe(403);
        expect(r.code).toBe('FORBIDDEN');
      }
    }
    expect(await h.count("user WHERE status = 'suspended'")).toBe(0);
    expect(await h.count('audit_log')).toBe(before);
  });

  it('super admin → 2xx ทุก route + Cache-Control: private, no-store', async () => {
    for (const e of ADMIN_ROUTES) {
      const r = await hit(boss.c, e);
      expect(r.status, `${e.method} ${e.path} ${r.text}`).toBe(200);
      expect(r.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('super admin ที่ถูกระงับ (ตั้งด้วย SQL, session ยังอยู่) → ACCOUNT_SUSPENDED ทุก route · must_change_pin → 403 PIN_CHANGE_REQUIRED', async () => {
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [boss.id]);
    for (const e of ADMIN_ROUTES) {
      const r = await hit(boss.c, e);
      expect(r.code, `${e.method} ${e.path}`).toBe('ACCOUNT_SUSPENDED');
      expect(r.status).toBe(401); // ERROR_HTTP_STATUS.ACCOUNT_SUSPENDED = 401 (ARCHITECTURE §2) — ดู Handoff R5 (สัญญาเขียน 403)
    }
    await h.rows("UPDATE user SET status = 'active', must_change_pin = 1 WHERE id = ?", [boss.id]);
    for (const e of ADMIN_ROUTES) expect((await hit(boss.c, e)).code, `${e.method} ${e.path}`).toBe('PIN_CHANGE_REQUIRED');
  });

  it('CSRF: POST admin ที่ Origin ผิด → 403 CSRF_REJECTED (ไม่ถึง service)', async () => {
    const r = await post(boss.c, `/api/admin/users/${nm.id}/suspend`, {}, { headers: { origin: 'https://evil.test' } });
    expect(r.code).toBe('CSRF_REJECTED');
    expect(await h.count("user WHERE status = 'suspended'")).toBe(0);
  });
});

describe('R5-4 ระงับ / คืนสถานะ', () => {
  it('suspend: ลบ session ทันที (request ถัดไป 401) · login → ACCOUNT_SUSPENDED · ยังเป็นสมาชิกกลุ่ม · audit actor/target ถูก', async () => {
    const second = new Client();
    expect((await second.login('bob', GOOD_PIN)).status).toBe(200);
    const r = await post<{ user: { id: string; status: string; changed: boolean } }>(boss.c, `/api/admin/users/${mem.id}/suspend`);
    expect(r.status, r.text).toBe(200);
    expect(r.data.user).toEqual({ id: mem.id, status: 'suspended', changed: true });
    expect(await h.count('session WHERE user_id = ?', [mem.id])).toBe(0);
    for (const c of [mem.c, second]) expect((await call(c, 'GET', '/api/groups')).status).toBe(401);
    const login = await new Client().login('bob', GOOD_PIN);
    expect(login.code).toBe('ACCOUNT_SUSPENDED');
    expect(await h.count('group_member WHERE user_id = ? AND group_id = ?', [mem.id, gid])).toBe(1);
    const audit = await h.rows<{ actor_id: string; action: string; target_type: string; target_id: string; meta: string }>(
      "SELECT actor_id, action, target_type, target_id, meta FROM audit_log WHERE action = 'admin.user.suspend'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: boss.id, target_type: 'user', target_id: mem.id });
    expect(JSON.parse(audit[0]!.meta)).toEqual({ state: 'suspended', asSuperAdmin: true });
  });

  it('suspend ซ้ำ = idempotent (changed:false, ไม่ audit เพิ่ม) · unsuspend → login ได้ · unsuspend ซ้ำ idempotent · ทั้งหมดมี audit', async () => {
    await post(boss.c, `/api/admin/users/${mem.id}/suspend`);
    const again = await post<{ user: { changed: boolean } }>(boss.c, `/api/admin/users/${mem.id}/suspend`);
    expect(again.status).toBe(200);
    expect(again.data.user.changed).toBe(false);
    const un = await post<{ user: { status: string; changed: boolean } }>(boss.c, `/api/admin/users/${mem.id}/unsuspend`);
    expect(un.data.user).toMatchObject({ status: 'active', changed: true });
    expect((await new Client().login('bob', GOOD_PIN)).status).toBe(200);
    expect((await post<{ user: { changed: boolean } }>(boss.c, `/api/admin/users/${mem.id}/unsuspend`)).data.user.changed).toBe(false);
    const rows = await h.rows<{ meta: string }>("SELECT meta FROM audit_log WHERE action = 'admin.user.suspend' AND target_id = ? ORDER BY created_at, rowid", [mem.id]);
    expect(rows.map((r) => JSON.parse(r.meta).state)).toEqual(['suspended', 'active']);
  });

  it('ระงับตัวเอง / super admin คนอื่น → 403 FORBIDDEN (ไม่มีอะไรเปลี่ยน ไม่ audit)', async () => {
    const boss2 = await person(h, 'boss2', { admin: true });
    expect((await post(boss.c, `/api/admin/users/${boss.id}/suspend`)).code).toBe('FORBIDDEN');
    expect((await post(boss.c, `/api/admin/users/${boss2.id}/suspend`)).code).toBe('FORBIDDEN');
    expect(await h.count("user WHERE status = 'suspended'")).toBe(0);
    expect(await h.count("audit_log WHERE action = 'admin.user.suspend'")).toBe(0);
    expect(await h.count('session WHERE user_id IN (?, ?)', [boss.id, boss2.id])).toBe(2);
  });

  it('ผู้ใช้ที่ลบแล้ว / ไม่มีอยู่ → 404 ทั้ง suspend/unsuspend/unlock · id ผิดรูป → 400', async () => {
    expect((await post(nm.c, '/api/me/delete', { pin: GOOD_PIN })).status).toBe(200);
    for (const a of ['suspend', 'unsuspend', 'unlock']) {
      expect((await post(boss.c, `/api/admin/users/${nm.id}/${a}`)).status, a).toBe(404);
      expect((await post(boss.c, `/api/admin/users/00000000-0000-4000-8000-000000000000/${a}`)).status, a).toBe(404);
      expect((await post(boss.c, `/api/admin/users/not-a-uuid/${a}`)).code, a).toBe('VALIDATION');
    }
    expect(await h.count("audit_log WHERE action LIKE 'admin.user.%'")).toBe(0);
  });

  it('audit อยู่ในธุรกรรมเดียวกับการเปลี่ยน — audit เขียนไม่ได้ = ไม่ระงับ ไม่ลบ session (rollback ทั้งก้อน)', async () => {
    await h.rows("CREATE TRIGGER audit_boom BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const r = await post(boss.c, `/api/admin/users/${mem.id}/suspend`);
    expect(r.status).toBe(500);
    expect((await h.rows<{ status: string }>('SELECT status FROM user WHERE id = ?', [mem.id]))[0]!.status).toBe('active');
    expect(await h.count('session WHERE user_id = ?', [mem.id])).toBe(1);
    // unlock ก็เช่นกัน: ตัวนับยังอยู่
    for (let i = 0; i < 2; i++) await new Client().login('nina', OTHER_PIN);
    expect((await post(boss.c, `/api/admin/users/${nm.id}/unlock`)).status).toBe(500);
    expect(await h.count("login_throttle WHERE key = 'u:nina' AND failures = 2")).toBe(1);
    await h.rows('DROP TRIGGER audit_boom');
  });
});

describe('R5-4 ปลดล็อก', () => {
  it('ล็อกจาก PIN ผิด 5 ครั้ง → unlock ล้างตัวนับ → login ได้ทันที · ไม่แตะ PIN/สถานะ · audit wasLocked', async () => {
    for (let i = 0; i < 5; i++) await new Client().login('nina', OTHER_PIN);
    expect((await new Client().login('nina', GOOD_PIN)).code).toBe('LOGIN_LOCKED');
    const pinBefore = await h.rows('SELECT pin_hash, status, must_change_pin FROM user WHERE id = ?', [nm.id]);
    const r = await post<{ user: { id: string; wasLocked: boolean } }>(boss.c, `/api/admin/users/${nm.id}/unlock`);
    expect(r.status, r.text).toBe(200);
    expect(r.data.user).toEqual({ id: nm.id, wasLocked: true });
    expect(await h.rows('SELECT pin_hash, status, must_change_pin FROM user WHERE id = ?', [nm.id])).toEqual(pinBefore);
    expect((await new Client().login('nina', GOOD_PIN)).status).toBe(200);
    const [a] = await h.rows<{ actor_id: string; target_id: string; meta: string }>("SELECT actor_id, target_id, meta FROM audit_log WHERE action = 'admin.user.unlock'");
    expect(a).toMatchObject({ actor_id: boss.id, target_id: nm.id });
    expect(JSON.parse(a!.meta)).toEqual({ wasLocked: true, asSuperAdmin: true });
  });

  it('ไม่ได้ล็อก → สำเร็จ wasLocked:false (ยัง audit) · username ตัวพิมพ์ใหญ่ใช้คีย์ normalized เดียวกับ login', async () => {
    const mixed = await person(h, 'MiXeD');
    for (let i = 0; i < 5; i++) await new Client().login('mixed', OTHER_PIN);
    expect((await new Client().login('MIXED', GOOD_PIN)).code).toBe('LOGIN_LOCKED');
    expect((await post<{ user: { wasLocked: boolean } }>(boss.c, `/api/admin/users/${mixed.id}/unlock`)).data.user.wasLocked).toBe(true);
    expect((await new Client().login('Mixed', GOOD_PIN)).status).toBe(200);
    expect((await post<{ user: { wasLocked: boolean } }>(boss.c, `/api/admin/users/${ga.id}/unlock`)).data.user.wasLocked).toBe(false);
    expect(await h.count("audit_log WHERE action = 'admin.user.unlock'")).toBe(2);
  });
});

describe('ตัวจำกัดอัตราของ endpoint admin ที่เขียน: 60 ครั้ง/10 นาที/ผู้ใช้', () => {
  it('ครั้งที่ 61 → 429 RATE_LIMITED + Retry-After (รวมทุก endpoint เขียน) · SA อื่นไม่โดน · ครบหน้าต่างแล้วได้ใหม่ · GET ไม่นับ', async () => {
    for (let i = 0; i < 10; i++) expect((await call(boss.c, 'GET', '/api/admin/users')).status).toBe(200);
    for (let i = 0; i < 60; i++) {
      const path = i % 2 ? `/api/admin/users/${nm.id}/unlock` : `/api/admin/users/${mem.id}/unsuspend`;
      expect((await post(boss.c, path)).status, `ครั้งที่ ${i + 1}`).toBe(200);
    }
    const over = await post(boss.c, `/api/admin/users/${mem.id}/suspend`);
    expect(over.status).toBe(429);
    expect(over.code).toBe('RATE_LIMITED');
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await h.count("user WHERE status = 'suspended'")).toBe(0);
    const boss2 = await person(h, 'boss2', { admin: true });
    expect((await post(boss2.c, `/api/admin/users/${nm.id}/unlock`)).status).toBe(200);
    h.clock.advance(10 * MIN);
    expect((await post(boss.c, `/api/admin/users/${mem.id}/suspend`)).status).toBe(200);
  });
});

describe('SA ใช้ endpoint กลุ่มเดิม (ไม่สร้างซ้ำ): โอน admin / ลบกลุ่ม จากนอกกลุ่ม + audit actor = SA', () => {
  it('transfer-admin แล้ว DELETE กลุ่ม', async () => {
    const t = await post(boss.c, `/api/groups/${gid}/transfer-admin`, { toUserId: mem.id });
    expect(t.status, t.text).toBe(200);
    const d = await call(boss.c, 'DELETE', `/api/groups/${gid}`);
    expect(d.status).toBe(200);
    const rows = await h.rows<{ action: string; actor_id: string; meta: string }>(
      "SELECT action, actor_id, meta FROM audit_log WHERE group_id = ? AND action IN ('group.transferAdmin','group.delete') ORDER BY created_at, rowid",
      [gid],
    );
    expect(rows.map((r) => [r.action, r.actor_id, JSON.parse(r.meta).asSuperAdmin])).toEqual([
      ['group.transferAdmin', boss.id, true],
      ['group.delete', boss.id, true],
    ]);
  });
});
