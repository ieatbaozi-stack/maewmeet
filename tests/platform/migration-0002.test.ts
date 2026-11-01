// R6C-4: migration 0002 (group_member.color_slot / shape_slot) ขึ้นได้บนฐานที่มีข้อมูลเดิม · ไม่ backfill · CHECK กันค่านอก 1–10/ไม่ใช่จำนวนเต็ม
// วิธี: apply เฉพาะ migration ก่อน 0002 (สำเนา journal ที่ตัดท้าย) → ใส่ข้อมูล → apply ทั้งโฟลเดอร์จริง
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createTestDb, MIGRATIONS_FOLDER, type TestDb } from '../helpers/db';

type Journal = { entries: { idx: number; tag: string }[] } & Record<string, unknown>;

const NOW = 1_760_000_000_000;
let t: TestDb;
let partialDir: string;
let colsBefore: string[] = [];
const exec = (sql: string, args: (string | number | null)[] = []) => t.db.$client.execute({ sql, args });

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
  const i0002 = journal.entries.findIndex((e) => e.tag.startsWith('0002_'));
  expect(i0002).toBeGreaterThan(0);
  const before = journal.entries.slice(0, i0002);
  partialDir = mkdtempSync(path.join(tmpdir(), 'maewmeet-mig-'));
  mkdirSync(path.join(partialDir, 'meta'));
  for (const e of before) copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(partialDir, `${e.tag}.sql`));
  writeFileSync(path.join(partialDir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: before }));

  t = await createTestDb({ migrate: false });
  await migrate(t.db, { migrationsFolder: partialDir });
  colsBefore = (await exec("select name from pragma_table_info('group_member') order by cid")).rows.map((r) => String(r.name));
  // ข้อมูลเดิมก่อน 0002: ผู้ใช้ 3 คน · 2 กลุ่ม · สมาชิก 4 แถว (admin + member)
  for (const id of ['u1', 'u2', 'u3']) {
    await exec('insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)', [id, id, id, id, NOW, NOW]);
  }
  for (const g of ['g1', 'g2']) await exec('insert into groups(id, name, created_by, created_at, updated_at) values (?,?,?,?,?)', [g, g, 'u1', NOW, NOW]);
  await exec("insert into group_member(group_id, user_id, role, joined_at) values ('g1','u1','admin',?), ('g1','u2','member',?), ('g2','u1','admin',?), ('g2','u3','member',?)", [NOW, NOW + 1, NOW + 2, NOW + 3]);
  await migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER });
});
afterAll(async () => {
  await t?.cleanup();
  if (partialDir) rmSync(partialDir, { recursive: true, force: true });
});

describe('migration 0002 บนฐานที่มีข้อมูลเดิม', () => {
  it('ก่อน 0002 ยังไม่มีคอลัมน์ (จำลองฐานเก่าจริง) · หลัง apply ทั้งโฟลเดอร์ journal ครบทุก migration', async () => {
    expect(colsBefore).toEqual(['group_id', 'user_id', 'role', 'joined_at']);
    const rs = await exec('select count(*) as n from __drizzle_migrations');
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
    expect(Number(rs.rows[0]?.n)).toBe(journal.entries.length);
  });

  it('แถวเดิมอยู่ครบ (role/joined_at ไม่เปลี่ยน) และ slot เป็น NULL ทั้งหมด (ไม่ backfill)', async () => {
    const rs = await exec('select group_id, user_id, role, joined_at, color_slot, shape_slot from group_member order by group_id, user_id');
    expect(rs.rows.map((r) => ({ ...r }))).toEqual([
      { group_id: 'g1', user_id: 'u1', role: 'admin', joined_at: NOW, color_slot: null, shape_slot: null },
      { group_id: 'g1', user_id: 'u2', role: 'member', joined_at: NOW + 1, color_slot: null, shape_slot: null },
      { group_id: 'g2', user_id: 'u1', role: 'admin', joined_at: NOW + 2, color_slot: null, shape_slot: null },
      { group_id: 'g2', user_id: 'u3', role: 'member', joined_at: NOW + 3, color_slot: null, shape_slot: null },
    ]);
  });

  it('คอลัมน์เป็น INTEGER nullable · index/constraint เดิมยังอยู่ (admin กลุ่มละ 1 · role CHECK · FK cascade)', async () => {
    const cols = await exec("select name, type, \"notnull\" as nn from pragma_table_info('group_member') where name in ('color_slot','shape_slot') order by name");
    expect(cols.rows.map((r) => [r.name, String(r.type).toLowerCase(), Number(r.nn)])).toEqual([
      ['color_slot', 'integer', 0],
      ['shape_slot', 'integer', 0],
    ]);
    const idx = await exec("select name from sqlite_master where type = 'index' and tbl_name = 'group_member' and name not like 'sqlite_%' order by name");
    expect(idx.rows.map((r) => r.name)).toEqual(['group_member_user_idx', 'group_one_admin_uq']);
    await expect(exec("update group_member set role = 'admin' where group_id = 'g1' and user_id = 'u2'")).rejects.toThrow(/constraint/i);
    await expect(exec("update group_member set role = 'owner' where group_id = 'g1' and user_id = 'u2'")).rejects.toThrow(/constraint/i);
    const fk = await exec("select \"table\" as t, on_delete from pragma_foreign_key_list('group_member') order by t");
    expect(fk.rows.map((r) => [r.t, r.on_delete])).toEqual([
      ['groups', 'CASCADE'],
      ['user', 'CASCADE'],
    ]);
  });

  it('CHECK: 1–10 และ NULL ผ่าน · 0 / 11 / -1 / 1.5 / ข้อความ ถูกปฏิเสธ (ทั้งสองคอลัมน์)', async () => {
    for (const col of ['color_slot', 'shape_slot']) {
      for (const ok of [1, 10, 5, null]) {
        await exec(`update group_member set ${col} = ? where group_id = 'g1' and user_id = 'u2'`, [ok]);
        const rs = await exec(`select ${col} as v from group_member where group_id = 'g1' and user_id = 'u2'`);
        expect(rs.rows[0]?.v ?? null, `${col}=${ok}`).toBe(ok);
      }
      for (const bad of [0, 11, -1, 1.5, 'red']) {
        await expect(exec(`update group_member set ${col} = ? where group_id = 'g1' and user_id = 'u2'`, [bad]), `${col}=${bad}`).rejects.toThrow(/CHECK constraint/i);
      }
      await expect(
        exec(`insert into group_member(group_id, user_id, role, joined_at, ${col}) values ('g2','u2','member',?, 11)`, [NOW]),
        `insert ${col}=11`,
      ).rejects.toThrow(/CHECK constraint/i);
    }
  });

  it('apply ซ้ำไม่พัง (journal กันซ้ำ)', async () => {
    await expect(migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER })).resolves.toBeUndefined();
  });
});
