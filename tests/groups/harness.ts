// เครื่องมือเทสต์ของกลุ่ม/คำเชิญ (R2) — ต่อจาก tests/auth/harness (DB libSQL ไฟล์จริง + migration จริง + นาฬิกา inject + handler จริงผ่าน Request/Response)
import { expect } from 'vitest';
import { Client, DAY, GOOD_PIN, HOUR, MIN, setupHarness, type Harness, type Res } from '../auth/harness';

export { Client, DAY, GOOD_PIN, HOUR, MIN, setupHarness };
export type { Harness, Res };

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Opts = Parameters<Client['call']>[3];

/** เรียก route ทุก method (Client.call รองรับที่ runtime — แค่ชนิดของ harness ระบุ GET|POST) */
export function call<T = Record<string, unknown>>(c: Client, method: Method, path: string, body?: unknown, opts?: Opts): Promise<Res<T>> {
  return c.call<T>(method as 'POST', path, method === 'GET' ? undefined : (body ?? {}), opts);
}
export const get = <T = Record<string, unknown>>(c: Client, p: string) => call<T>(c, 'GET', p);
export const post = <T = Record<string, unknown>>(c: Client, p: string, b?: unknown, opts?: Opts) => call<T>(c, 'POST', p, b, opts);
export const patch = <T = Record<string, unknown>>(c: Client, p: string, b?: unknown) => call<T>(c, 'PATCH', p, b);
export const del = <T = Record<string, unknown>>(c: Client, p: string) => call<T>(c, 'DELETE', p);

export type Person = { id: string; username: string; c: Client; displayName: string };

/** ผู้ใช้ + เครื่องที่ล็อกอินแล้ว */
export async function person(h: Harness, username: string, opts: { admin?: boolean } = {}): Promise<Person> {
  const user = await h.seedUser(username, GOOD_PIN, { isAdmin: opts.admin, displayName: `ชื่อ ${username}` });
  const c = new Client();
  const r = await c.login(username, GOOD_PIN);
  expect(r.status, `login ${username}`).toBe(200);
  return { id: user.id, username, c, displayName: `ชื่อ ${username}` };
}

export type GroupDto = { id: string; name: string; role: string; memberCount: number };

export async function makeGroup(p: Person, name = 'ก๊วนแมว'): Promise<string> {
  const r = await post<{ group: GroupDto }>(p.c, '/api/groups', { name });
  expect(r.status, `create group ${JSON.stringify(r.json)}`).toBe(201);
  return r.data.group.id;
}

export async function makeCode(p: Person, gid: string): Promise<string> {
  const r = await post<{ invite: { code: string } }>(p.c, `/api/groups/${gid}/invites/code`);
  expect(r.status, `create code ${JSON.stringify(r.json)}`).toBe(201);
  return r.data.invite.code;
}

/** ให้ b เข้ากลุ่มของ a ผ่านโค้ด (เส้นทางจริงของระบบ) */
export async function join(a: Person, b: Person, gid: string): Promise<void> {
  const code = await makeCode(a, gid);
  const r = await post(b.c, '/api/invites/redeem', { code });
  expect(r.status, `redeem ${JSON.stringify(r.json)}`).toBe(200);
}

export async function roleOf(h: Harness, gid: string, userId: string): Promise<string | null> {
  const r = await h.rows<{ role: string }>('SELECT role FROM group_member WHERE group_id = ? AND user_id = ?', [gid, userId]);
  return r[0]?.role ?? null;
}

export const adminCount = (h: Harness, gid: string) => h.count("group_member WHERE group_id = ? AND role = 'admin'", [gid]);

/** ทุกตารางทุกคอลัมน์ → สตริงเดียว (ค้นหาข้อความที่ต้องไม่อยู่ในฐาน) */
export async function dumpAllTables(h: Harness): Promise<string> {
  const tables = await h.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_drizzle%' ESCAPE '\\'");
  const parts: string[] = [];
  for (const t of tables) {
    const rows = await h.rows(`SELECT * FROM "${t.name}"`);
    parts.push(JSON.stringify(rows));
  }
  return parts.join('\n');
}
