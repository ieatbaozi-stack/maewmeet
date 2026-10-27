// R5-7 — ค้นหา/แบ่งหน้าของ /api/admin/users และ /api/admin/groups
// q ที่มี % _ \ → ค้นตามตัวอักษร (ไม่ทำให้ LIKE กว้าง) · ยาวเกิน/ตัวควบคุม → VALIDATION · cursor เสีย → VALIDATION · หน้าละ 30 ไม่ซ้ำ/ไม่ตกหล่น ·
// นับด้วย query รวม (ไม่มี N+1)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listUsersForAdmin } from '@/lib/data/repos/admin-users';
import { listGroupsForAdmin } from '@/lib/data/repos/admin-groups';
import type { DbOrTx } from '@/db/client';
import { newId } from '@/lib/shared/id';
import { GOOD_PIN, OTHER_PIN } from '../auth/harness';
import { Client, call, get, join, makeGroup, person, setupHarness, type Harness, type Person } from '../groups/harness';

type U = { id: string; username: string; displayName: string; status: string; isAdmin: boolean; createdAt: number; groupCount: number; locked: boolean; lockedUntil: number | null; hasOpenReset: boolean };
type G = { id: string; name: string; adminUsername: string | null; memberCount: number; createdAt: number; deletedAt: number | null };

let h: Harness;
let boss: Person;

const users = (q = '') => get<{ users: U[]; nextCursor: string | null }>(boss.c, `/api/admin/users${q ? `?${q}` : ''}`);
const groups = (q = '') => get<{ groups: G[]; nextCursor: string | null }>(boss.c, `/api/admin/groups${q ? `?${q}` : ''}`);
const enc = encodeURIComponent;

beforeEach(async () => {
  h = await setupHarness();
  boss = await person(h, 'boss', { admin: true });
});
afterEach(async () => {
  await h.cleanup();
});

describe('GET /api/admin/users', () => {
  it('ฟิลด์ครบตามสัญญา · ไม่มี pin_hash/pepper/locale/theme · groupCount / locked / hasOpenReset ถูก · ไม่รวมบัญชีที่ลบแล้ว', async () => {
    const a = await person(h, 'alice');
    const b = await person(h, 'bob');
    const gone = await person(h, 'gone');
    const g1 = await makeGroup(a, 'หนึ่ง');
    const g2 = await makeGroup(a, 'สอง');
    await join(a, b, g1);
    await join(a, b, g2);
    expect((await call(a.c, 'DELETE', `/api/groups/${g2}`)).status).toBe(200); // กลุ่มที่ลบแล้วไม่นับ
    for (let i = 0; i < 5; i++) await new Client().login('bob', OTHER_PIN);
    await h.rows(
      "INSERT INTO pin_reset_request (id, user_id, status, device_token_hash, requested_at, pending_expires_at) VALUES (?, ?, 'pending', 'x', ?, ?)",
      [newId(), a.id, h.clock.now(), h.clock.now() + 86_400_000],
    );
    expect((await call(gone.c, 'POST', '/api/me/delete', { pin: GOOD_PIN })).status).toBe(200);

    const r = await users();
    expect(r.status).toBe(200);
    const by = (id: string) => r.data.users.find((u) => u.id === id);
    expect(Object.keys(by(a.id)!).sort()).toEqual(['createdAt', 'displayName', 'groupCount', 'hasOpenReset', 'id', 'isAdmin', 'locked', 'lockedUntil', 'status', 'username'].sort());
    expect(by(a.id)).toMatchObject({ username: 'alice', displayName: 'ชื่อ alice', status: 'active', isAdmin: false, groupCount: 1, locked: false, lockedUntil: null, hasOpenReset: true });
    expect(by(b.id)).toMatchObject({ groupCount: 1, locked: true, hasOpenReset: false });
    expect(by(b.id)!.lockedUntil).toBeGreaterThan(h.clock.now());
    expect(by(boss.id)).toMatchObject({ isAdmin: true });
    expect(by(gone.id)).toBeUndefined();
    expect(r.text).not.toMatch(/pin_?hash|pepper|argon|locale|theme|deleted-/i);
  });

  it('q: username แบบ prefix (ไม่สนตัวพิมพ์) หรือชื่อที่แสดงแบบ contains', async () => {
    await h.seedUser('catlover', GOOD_PIN, { displayName: 'Somchai' });
    await h.seedUser('dog', GOOD_PIN, { displayName: 'ทาสแมวตัวยง' });
    await h.seedUser('mycat', GOOD_PIN, { displayName: 'Mali' });
    const names = async (q: string) => (await users(`q=${enc(q)}`)).data.users.map((u) => u.username).sort();
    expect(await names('CAT')).toEqual(['catlover']); // prefix ของ username ไม่ใช่ contains (mycat ไม่ติด)
    expect(await names('แมว')).toEqual(['dog']);
    expect(await names('mal')).toEqual(['mycat']); // ชื่อที่แสดง contains (ASCII ไม่สนตัวพิมพ์)
    expect(await names('  ')).toEqual(['boss', 'catlover', 'dog', 'mycat']); // ว่าง = ไม่กรอง
  });

  it('q ที่มี % _ \\ → ค้นตามตัวอักษร (ไม่กลายเป็น wildcard)', async () => {
    await h.seedUser('a_b', GOOD_PIN, { displayName: '100% แมว' });
    await h.seedUser('axb', GOOD_PIN, { displayName: 'ไม่มีเปอร์เซ็นต์' });
    await h.seedUser('slash', GOOD_PIN, { displayName: 'back\\slash' });
    const names = async (q: string) => (await users(`q=${enc(q)}`)).data.users.map((u) => u.username).sort();
    expect(await names('%')).toEqual(['a_b']);
    expect(await names('a_')).toEqual(['a_b']); // ไม่ติด axb
    expect(await names('_')).toEqual([]); // ไม่มี username ขึ้นต้นด้วย _ และไม่มีชื่อที่มี _
    expect(await names('\\')).toEqual(['slash']);
    expect(await names('%%%')).toEqual([]);
  });

  it('q ยาวเกิน 40 ตัว → VALIDATION TOO_LONG · ตัวควบคุม/bidi → VALIDATION INVALID · คีย์แปลก → VALIDATION', async () => {
    const long = await users(`q=${enc('ก'.repeat(41))}`);
    expect(long.status).toBe(400);
    expect(long.json.error?.params).toEqual({ fields: { q: 'TOO_LONG' } });
    expect((await users(`q=${enc('ก'.repeat(40))}`)).status).toBe(200);
    expect((await users(`q=${enc('x'.repeat(201))}`)).code).toBe('VALIDATION');
    expect((await users(`q=${enc('a‮b')}`)).json.error?.params).toEqual({ fields: { q: 'INVALID' } });
    expect((await users('limit=5')).code).toBe('VALIDATION');
  });

  it('หน้าละ 30 · cursor (createdAt, id) เดินครบไม่ซ้ำไม่ตกหล่น แม้ createdAt ซ้ำ · cursor เสีย → VALIDATION', async () => {
    for (let i = 0; i < 64; i++) await h.seedUser(`user${String(i).padStart(2, '0')}`); // นาฬิกาคงที่ → created_at ซ้ำกันทั้งหมด
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: { status: number; data: { users: U[]; nextCursor: string | null } } = await users(cursor ? `cursor=${cursor}` : '');
      expect(r.status).toBe(200);
      expect(r.data.users.length).toBeLessThanOrEqual(30);
      seen.push(...r.data.users.map((u) => u.id));
      cursor = r.data.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(65);
    expect(new Set(seen).size).toBe(65);
    for (const bad of ['abc', Buffer.from('{"c":1}').toString('base64url'), Buffer.from('{"c":-1,"i":"00000000-0000-4000-8000-000000000000"}').toString('base64url')]) {
      const r = await users(`cursor=${bad}`);
      expect(r.status, bad).toBe(400);
      expect(r.json.error?.params).toEqual({ fields: { cursor: 'INVALID' } });
    }
  });
});

describe('GET /api/admin/groups', () => {
  it('ฟิลด์ครบ · adminUsername / memberCount · status active (ดีฟอลต์) / deleted / all · q contains (escape)', async () => {
    const a = await person(h, 'alice');
    const b = await person(h, 'bob');
    const g1 = await makeGroup(a, 'แมว_ส้ม');
    const g2 = await makeGroup(b, 'แมวดำ 100%');
    const g3 = await makeGroup(a, 'หมา');
    await join(a, b, g1);
    expect((await call(a.c, 'DELETE', `/api/groups/${g3}`)).status).toBe(200);
    const r = await groups();
    expect(r.status).toBe(200);
    expect(r.data.groups.map((g) => g.id).sort()).toEqual([g1, g2].sort());
    const one = r.data.groups.find((g) => g.id === g1)!;
    expect(Object.keys(one).sort()).toEqual(['adminUsername', 'createdAt', 'deletedAt', 'id', 'memberCount', 'name'].sort());
    expect(one).toMatchObject({ name: 'แมว_ส้ม', adminUsername: 'alice', memberCount: 2, deletedAt: null });
    expect((await groups('status=deleted')).data.groups.map((g) => g.id)).toEqual([g3]);
    expect((await groups('status=deleted')).data.groups[0]!.deletedAt).toBe(h.clock.now());
    expect((await groups('status=all')).data.groups).toHaveLength(3);
    expect((await groups('status=bogus')).code).toBe('VALIDATION');
    const names = async (q: string) => (await groups(`status=all&q=${enc(q)}`)).data.groups.map((g) => g.name).sort();
    expect(await names('แมว')).toEqual(['แมวดำ 100%', 'แมว_ส้ม'].sort());
    expect(await names('_')).toEqual(['แมว_ส้ม']);
    expect(await names('%')).toEqual(['แมวดำ 100%']);
    expect((await groups(`q=${enc('x'.repeat(41))}`)).json.error?.params).toEqual({ fields: { q: 'TOO_LONG' } });
    expect((await groups('cursor=%%')).code).toBe('VALIDATION');
  });

  it('หน้าละ 30 · cursor เดินครบ', async () => {
    const a = await person(h, 'alice');
    const now = h.clock.now();
    for (let i = 0; i < 45; i++) {
      await h.rows('INSERT INTO groups (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [newId(), `g${i}`, a.id, now - (i % 3), now]);
    }
    const p1 = await groups();
    expect(p1.data.groups).toHaveLength(30);
    const p2 = await groups(`cursor=${p1.data.nextCursor}`);
    expect(p2.data.groups).toHaveLength(15);
    expect(p2.data.nextCursor).toBeNull();
    expect(new Set([...p1.data.groups, ...p2.data.groups].map((g) => g.id)).size).toBe(45);
  });
});

describe('ไม่มี N+1: นับด้วย query รวมคำสั่งเดียวต่อหน้า', () => {
  const counting = (db: DbOrTx) => {
    let n = 0;
    const proxy = new Proxy(db, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv) as unknown;
        if (typeof v === 'function' && ['all', 'run', 'get', 'values', 'select', 'execute'].includes(String(prop))) {
          return (...args: unknown[]) => {
            n++;
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return v;
      },
    });
    return { proxy: proxy as DbOrTx, calls: () => n };
  };

  it('listUsersForAdmin / listGroupsForAdmin = 1 คำสั่ง ไม่ว่าจำนวนแถว', async () => {
    const a = await person(h, 'alice');
    for (let i = 0; i < 10; i++) await makeGroup(a, `g${i}`).catch(() => undefined);
    for (let i = 0; i < 20; i++) await h.seedUser(`u${i}`);
    const u = counting(h.db);
    const rows = await listUsersForAdmin(u.proxy, { usernamePrefix: null, nameContains: null, cursor: null, limit: 31, now: h.clock.now() });
    expect(rows.length).toBeGreaterThan(20);
    expect(u.calls()).toBe(1);
    const g = counting(h.db);
    const gs = await listGroupsForAdmin(g.proxy, { nameContains: null, status: 'all', cursor: null, limit: 31 });
    expect(gs.length).toBeGreaterThan(5);
    expect(g.calls()).toBe(1);
  });
});
