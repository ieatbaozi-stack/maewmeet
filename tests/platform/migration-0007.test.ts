// R18 §S8: migration 0007 (ตารางลิงก์ชวน + แขกของนัด — ADR 0016 §2) เพิ่มอย่างเดียว · ขึ้นได้บนฐานที่มีข้อมูลรูป R15–R17 · ข้อมูลเดิมไม่เปลี่ยนทุกไบต์
// วิธี (แบบ migration-0006): apply เฉพาะ migration ก่อน 0007 → ใส่ข้อมูลเดิม → apply ทั้งโฟลเดอร์จริง
// + ON DELETE ทุก FK ตรง ADR (drizzle-kit 0.31.11 เคยทำ ON DELETE หายในกรณี ALTER TABLE ADD — ที่นี่ CREATE TABLE แต่ตรวจซ้ำ) · constraint ปฏิเสธจริง
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { removeTempDir } from '../helpers/fs';
import { createTestDb, MIGRATIONS_FOLDER, type TestDb } from '../helpers/db';

type Journal = { entries: { idx: number; tag: string }[] } & Record<string, unknown>;

const NOW = 1_795_000_000_000;
let t: TestDb;
let partialDir: string;
let tablesBefore: string[] = [];
let indexesBefore: string[] = [];
const snapshots: Record<string, Record<string, unknown>[]> = {};
const exec = (sql: string, args: (string | number | null)[] = []) => t.db.$client.execute({ sql, args });
const KEEP: [string, string][] = [
  ['user', 'id'],
  ['groups', 'id'],
  ['group_member', 'group_id, user_id'],
  ['group_invite', 'id'],
  ['appointment', 'id'],
  ['appointment_rsvp', 'appointment_id, user_id'],
  ['notification', 'id'],
];
const NEW_TABLES = ['appointment_guest', 'appointment_share_link'];

const journalOf = () => JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
const tableNames = async () =>
  (await exec("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_drizzle%' escape '\\' order by name")).rows.map((r) => String(r.name));
const indexNames = async () =>
  (await exec("select tbl_name || '.' || name as n from sqlite_master where type = 'index' and name not like 'sqlite_%' order by n")).rows.map((r) => String(r.n));

beforeAll(async () => {
  const journal = journalOf();
  const i0007 = journal.entries.findIndex((e) => e.tag.startsWith('0007_'));
  expect(i0007).toBeGreaterThan(0);
  const before = journal.entries.slice(0, i0007);
  partialDir = mkdtempSync(path.join(tmpdir(), 'maewmeet-mig7-'));
  mkdirSync(path.join(partialDir, 'meta'));
  for (const e of before) copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(partialDir, `${e.tag}.sql`));
  writeFileSync(path.join(partialDir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: before }));

  t = await createTestDb({ migrate: false });
  await migrate(t.db, { migrationsFolder: partialDir });
  tablesBefore = await tableNames();
  indexesBefore = await indexNames();
  for (const id of ['u1', 'u2', 'u3']) {
    await exec('insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)', [id, id, id, id, NOW, NOW]);
  }
  await exec("insert into groups(id, name, created_by, created_at, updated_at, min_free_minutes, icon) values ('g1','ก๊วน','u1',?,?,240,'soccer')", [NOW, NOW]);
  await exec("insert into group_member(group_id, user_id, role, joined_at) values ('g1','u1','admin',?), ('g1','u2','member',?)", [NOW, NOW]);
  await exec("insert into group_invite(id, group_id, kind, code_hash, code_hint, created_by, created_at, expires_at) values ('i1','g1','code','h1','ABCD','u1',?,?)", [NOW, NOW + 1]);
  await exec(
    "insert into appointment(id, group_id, title, start_at, end_at, tz, local_date, created_by, created_at, updated_at, scheduled_at) values ('a1','g1','กินข้าว',?,?,'Asia/Bangkok','2026-11-30','u1',?,?,?)",
    [NOW + 86_400_000, NOW + 90_000_000, NOW, NOW, NOW],
  );
  await exec("insert into appointment_rsvp(appointment_id, user_id, response, updated_at) values ('a1','u2','going',?)", [NOW]);
  await exec("insert into notification(id, user_id, kind, params, created_at) values ('n1','u2','appointment.created','{\"groupId\":\"g1\"}',?)", [NOW]);
  for (const [table, key] of KEEP) snapshots[table] = (await exec(`select * from ${table} order by ${key}`)).rows.map((r) => ({ ...r }));
  await migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER });
});
afterAll(async () => {
  await t?.cleanup();
  if (partialDir) removeTempDir(partialDir);
});

describe('migration 0007 (R18 §S) — เพิ่มอย่างเดียว', () => {
  it('SQL มีแต่ CREATE TABLE / CREATE [UNIQUE] INDEX (ไม่ ALTER / DROP / INSERT / UPDATE / DELETE / rebuild)', () => {
    const tag = journalOf().entries.find((e) => e.tag.startsWith('0007_'))!.tag;
    expect(tag).toBe('0007_r18_appointment_share');
    const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
    const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(8);
    for (const s of statements) expect(s, s.slice(0, 60)).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) /);
    expect(sql).not.toMatch(/ALTER TABLE|DROP |INSERT INTO|^\s*UPDATE\s|DELETE FROM|PRAGMA|__new_|RENAME/im);
  });

  it('ตารางใหม่ 2 + index 6 · ตาราง/index เดิมครบ · แถวเดิมไม่เปลี่ยนทุกไบต์', async () => {
    expect(await tableNames()).toEqual([...tablesBefore, ...NEW_TABLES].sort());
    const newIdx = (await indexNames()).filter((n) => !indexesBefore.includes(n));
    expect(newIdx.sort()).toEqual(
      [
        'appointment_guest.appointment_guest_link_idx',
        'appointment_guest.appointment_guest_user_idx',
        'appointment_guest.sqlite_autoindex_appointment_guest_1',
        'appointment_share_link.share_link_appointment_idx',
        'appointment_share_link.share_link_creator_idx',
        'appointment_share_link.share_link_one_active_uq',
        'appointment_share_link.share_link_token_hash_uq',
        'appointment_share_link.sqlite_autoindex_appointment_share_link_1',
      ].filter((n) => !n.includes('sqlite_autoindex')),
    );
    for (const [table, key] of KEEP) expect((await exec(`select * from ${table} order by ${key}`)).rows.map((r) => ({ ...r })), table).toEqual(snapshots[table]);
  });

  it('ON DELETE ทุก FK ตรง ADR 0016 §2', async () => {
    const fks = async (table: string) =>
      (await exec(`select "from" as f, "table" as t, on_delete as d from pragma_foreign_key_list('${table}') order by "from"`)).rows.map((r) => `${r.f}->${r.t}:${String(r.d).toUpperCase()}`);
    expect(await fks('appointment_share_link')).toEqual(['appointment_id->appointment:CASCADE', 'created_by->user:NO ACTION', 'revoked_by->user:SET NULL']);
    expect(await fks('appointment_guest')).toEqual([
      'appointment_id->appointment:CASCADE',
      'invited_by->user:SET NULL',
      'link_id->appointment_share_link:SET NULL',
      'removed_by->user:SET NULL',
      'user_id->user:CASCADE',
    ]);
  });

  it('constraint: 1 ลิงก์ที่ใช้อยู่ต่อคนต่อนัด · token_hash unique · CHECK คำตอบ/responded_at/removed_by · PK แขก', async () => {
    await exec("insert into appointment_share_link(id, appointment_id, created_by, token_hash, created_at) values ('l1','a1','u2','hashA',?)", [NOW]);
    await expect(exec("insert into appointment_share_link(id, appointment_id, created_by, token_hash, created_at) values ('l2','a1','u2','hashB',?)", [NOW])).rejects.toThrow(/constraint/i);
    await expect(exec("insert into appointment_share_link(id, appointment_id, created_by, token_hash, created_at) values ('l3','a1','u1','hashA',?)", [NOW])).rejects.toThrow(/constraint/i);
    await expect(exec("insert into appointment_share_link(id, appointment_id, created_by, token_hash, created_at, revoked_by) values ('l4','a1','u1','hashC',?,'u1')", [NOW])).rejects.toThrow(/constraint/i);
    await exec("update appointment_share_link set revoked_at = ?, revoked_by = 'u2' where id = 'l1'", [NOW]);
    await exec("insert into appointment_share_link(id, appointment_id, created_by, token_hash, created_at) values ('l2','a1','u2','hashB',?)", [NOW]);
    await exec("insert into appointment_guest(appointment_id, user_id, invited_by, link_id, joined_at) values ('a1','u3','u2','l2',?)", [NOW]);
    await expect(exec("insert into appointment_guest(appointment_id, user_id, joined_at) values ('a1','u3',?)", [NOW])).rejects.toThrow(/constraint/i);
    await expect(exec("update appointment_guest set response = 'yes', responded_at = 1 where user_id = 'u3'")).rejects.toThrow(/constraint/i);
    await expect(exec("update appointment_guest set response = 'going' where user_id = 'u3'")).rejects.toThrow(/constraint/i);
    await expect(exec("update appointment_guest set removed_by = 'u1' where user_id = 'u3'")).rejects.toThrow(/constraint/i);
    // ลบลิงก์ → link_id SET NULL · ลบนัด → cascade ทั้งสองตาราง
    await exec("delete from appointment_share_link where id = 'l2'");
    expect((await exec("select link_id from appointment_guest where user_id = 'u3'")).rows[0]?.link_id).toBeNull();
    await exec("delete from appointment where id = 'a1'");
    expect(Number((await exec('select count(*) as n from appointment_guest')).rows[0]?.n)).toBe(0);
    expect(Number((await exec('select count(*) as n from appointment_share_link')).rows[0]?.n)).toBe(0);
  });

  it('apply ซ้ำไม่พัง (journal กันซ้ำ)', async () => {
    await expect(migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER })).resolves.toBeUndefined();
  });
});
