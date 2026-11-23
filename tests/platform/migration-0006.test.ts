// R15-1: migration 0006 (groups.icon + DROP place_search_cache — ADR 0013) ขึ้นได้บนฐานที่มีข้อมูลรูป R14 · ข้อมูลเดิมไม่เปลี่ยน
// (ยกเว้นตาราง cache ที่ลบ) · ไม่ backfill icon
// วิธี (แบบ migration-0005): apply เฉพาะ migration ก่อน 0006 (สำเนา journal ที่ตัดท้าย) → ใส่ข้อมูลเดิม → apply ทั้งโฟลเดอร์จริง
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { removeTempDir } from '../helpers/fs';
import { createTestDb, MIGRATIONS_FOLDER, type TestDb } from '../helpers/db';

type Journal = { entries: { idx: number; tag: string }[] } & Record<string, unknown>;

const NOW = 1_794_500_000_000;
let t: TestDb;
let partialDir: string;
let groupColsBefore: string[] = [];
let tablesBefore: string[] = [];
let indexesBefore: string[] = [];
const snapshots: Record<string, Record<string, unknown>[]> = {};
const exec = (sql: string, args: (string | number | null)[] = []) => t.db.$client.execute({ sql, args });
const BUSY_COLS =
  'id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at, series_id, routine_id';
/** ตารางที่มีข้อมูลรูป R14 ซึ่งต้องไม่เปลี่ยนแม้แต่ไบต์เดียว (key ใช้เรียงให้เทียบได้) */
const KEEP: [string, string][] = [
  ['user', 'id'],
  ['groups', 'id'],
  ['group_member', 'group_id, user_id'],
  ['busy_block', 'id'],
  ['busy_routine', 'id'],
  ['busy_routine_skip', 'routine_id, local_date'],
  ['appointment', 'id'],
  ['appointment_rsvp', 'appointment_id, user_id'],
  ['appointment_reminder', 'appointment_id, kind'],
];

const journalOf = () => JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
const tableNames = async () =>
  (await exec("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_drizzle%' escape '\\' order by name")).rows.map((r) =>
    String(r.name),
  );
const indexNames = async () =>
  (await exec("select tbl_name || '.' || name as n from sqlite_master where type = 'index' and name not like 'sqlite_%' order by n")).rows.map((r) => String(r.n));

beforeAll(async () => {
  const journal = journalOf();
  const i0006 = journal.entries.findIndex((e) => e.tag.startsWith('0006_'));
  expect(i0006).toBeGreaterThan(0);
  const before = journal.entries.slice(0, i0006);
  partialDir = mkdtempSync(path.join(tmpdir(), 'maewmeet-mig6-'));
  mkdirSync(path.join(partialDir, 'meta'));
  for (const e of before) copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(partialDir, `${e.tag}.sql`));
  writeFileSync(path.join(partialDir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: before }));

  t = await createTestDb({ migrate: false });
  await migrate(t.db, { migrationsFolder: partialDir });
  groupColsBefore = (await exec("select name from pragma_table_info('groups') order by cid")).rows.map((r) => String(r.name));
  tablesBefore = await tableNames();
  indexesBefore = await indexNames();

  // ข้อมูลรูป R14: ผู้ใช้ 2 คน · กลุ่ม 2 (หนึ่งถูกลบ) · busy เดี่ยว/ชุดรายวัน/แถว routine · routine + skip · นัด + RSVP + reminder · cache ค้าง
  for (const id of ['u1', 'u2']) {
    await exec('insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)', [id, id, id, id, NOW, NOW]);
  }
  await exec("insert into groups(id, name, created_by, created_at, updated_at, min_free_minutes) values ('g1','ก๊วนแบด 🏸','u1',?,?,240)", [NOW, NOW]);
  await exec("insert into groups(id, name, created_by, created_at, updated_at, deleted_at) values ('g2','เก่า','u2',?,?,?)", [NOW, NOW, NOW + 1]);
  await exec("insert into group_member(group_id, user_id, role, joined_at) values ('g1','u1','admin',?), ('g1','u2','member',?), ('g2','u2','admin',?)", [NOW, NOW, NOW]);
  await exec(
    "insert into busy_routine(id, user_id, title, all_day, weekdays, start_min, end_min, range_kind, start_date, end_date, created_at, updated_at) values ('r1','u1','ทำงาน',0,31,540,1080,'weeks','2026-11-16','2026-12-13',?,?)",
    [NOW, NOW],
  );
  await exec("insert into busy_routine_skip(routine_id, local_date) values ('r1','2026-11-18')");
  await exec(
    `insert into busy_block(${BUSY_COLS}) values
      ('b1','u1','เรียน',NULL,0,?,?,'2026-11-03','2026-11-03','Asia/Bangkok',0,?,?,NULL,NULL),
      ('b2','u2','คลาส',NULL,0,?,?,'2026-11-06','2026-11-06','Asia/Bangkok',0,?,?,'s1',NULL),
      ('b3','u1','ทำงาน',NULL,0,?,?,'2026-11-16','2026-11-16','Asia/Bangkok',0,?,?,NULL,'r1')`,
    [NOW, NOW + 3_600_000, NOW, NOW, NOW + 1, NOW + 2, NOW, NOW, NOW + 3, NOW + 4, NOW, NOW],
  );
  await exec(
    "insert into appointment(id, group_id, title, start_at, end_at, tz, local_date, created_by, created_at, updated_at, scheduled_at, place_name) values ('a1','g1','กินข้าว',?,?,'Asia/Bangkok','2026-11-20','u1',?,?,?,'ร้านป้า')",
    [NOW + 9 * 86_400_000, NOW + 9 * 86_400_000 + 7_200_000, NOW, NOW, NOW],
  );
  await exec("insert into appointment_rsvp(appointment_id, user_id, response, updated_at) values ('a1','u2','going',?)", [NOW]);
  await exec("insert into appointment_reminder(appointment_id, kind, start_at, created_at) values ('a1','appointment.reminder_1d',?,?)", [NOW + 9 * 86_400_000, NOW]);
  await exec("insert into place_search_cache(query_normalized, results, fetched_at) values ('siam|th','[]',?)", [NOW]);
  for (const [table, key] of KEEP) snapshots[table] = (await exec(`select * from ${table} order by ${key}`)).rows.map((r) => ({ ...r }));

  await migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER });
});
afterAll(async () => {
  await t?.cleanup();
  if (partialDir) removeTempDir(partialDir);
});

describe('migration 0006 บนฐานที่มีข้อมูลรูป R14', () => {
  it('SQL ของ 0006 = DROP TABLE place_search_cache + ALTER TABLE groups ADD icon เท่านั้น (ไม่ rebuild / ไม่แตะข้อมูลเดิม)', () => {
    const tag = journalOf().entries.find((e) => e.tag.startsWith('0006_'))!.tag;
    const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual(['DROP TABLE `place_search_cache`;', 'ALTER TABLE `groups` ADD `icon` text;']);
    expect(sql).not.toMatch(/INSERT INTO|^\s*UPDATE\s|DELETE FROM|PRAGMA|__new_|RENAME|CREATE TABLE/im);
    expect(sql.match(/DROP TABLE/g)).toHaveLength(1);
  });

  it('ก่อน 0006: มี place_search_cache ไม่มี groups.icon · หลัง: ตารางหาย คอลัมน์ icon อยู่ท้ายตาราง · ตารางอื่นครบ', async () => {
    expect(groupColsBefore).not.toContain('icon');
    expect(tablesBefore).toContain('place_search_cache');
    const after = (await exec("select name from pragma_table_info('groups') order by cid")).rows.map((r) => String(r.name));
    expect(after).toEqual([...groupColsBefore, 'icon']);
    // ตาราง/index ของ migration หลังจากนี้ (0007 R18) ไม่นับ — เทสต์นี้ apply ทั้งโฟลเดอร์
    const later = (n: string) => /^appointment_(guest|share_link)(\.|$)/.test(n);
    expect((await tableNames()).filter((n) => !later(n))).toEqual(tablesBefore.filter((n) => n !== 'place_search_cache'));
    // index ของตารางอื่นยังอยู่ครบ (DROP TABLE เอา index ของตัวเองไปด้วยเท่านั้น)
    expect((await indexNames()).filter((n) => !later(n))).toEqual(indexesBefore.filter((n) => !n.startsWith('place_search_cache.')));
    const rs = await exec('select count(*) as n from __drizzle_migrations');
    expect(Number(rs.rows[0]?.n)).toBe(journalOf().entries.length);
  });

  it('แถวเดิมทุกตารางอยู่ครบทุกไบต์ · icon เป็น NULL ทั้งหมด (ไม่ backfill) รวมกลุ่มที่ถูกลบ', async () => {
    for (const [table, key] of KEEP) {
      const rows = (await exec(`select * from ${table} order by ${key}`)).rows.map((r) => {
        const rest = { ...r } as Record<string, unknown>;
        if (table === 'groups') delete rest.icon;
        return rest;
      });
      expect(rows, table).toEqual(snapshots[table]);
    }
    const r = await exec('select id, icon from groups order by id');
    expect(r.rows.map((x) => [x.id, x.icon])).toEqual([
      ['g1', null],
      ['g2', null],
    ]);
  });

  it('groups.icon เป็น TEXT nullable ไม่มี default · FK/CHECK เดิมของ groups ยังบังคับ', async () => {
    const col = await exec("select type, \"notnull\" as nn, dflt_value as d from pragma_table_info('groups') where name = 'icon'");
    expect(col.rows.map((r) => [String(r.type).toLowerCase(), Number(r.nn), r.d])).toEqual([['text', 0, null]]);
    const fk = await exec("select \"table\" as t, \"from\" as f from pragma_foreign_key_list('groups')");
    expect(fk.rows.map((r) => [r.t, r.f])).toEqual([['user', 'created_by']]);
    await expect(
      exec("insert into groups(id, name, created_by, created_at, updated_at, free_window_start_min, free_window_end_min) values ('bad','x','u1',?,?,600,600)", [NOW, NOW]),
    ).rejects.toThrow(/CHECK constraint/i);
    await exec("update groups set icon = 'soccer' where id = 'g1'");
    expect((await exec("select icon from groups where id = 'g1'")).rows[0]?.icon).toBe('soccer');
  });

  it('place_search_cache ใช้ไม่ได้แล้ว (ย้อนไม่ได้ — ADR 0013)', async () => {
    await expect(exec('select count(*) from place_search_cache')).rejects.toThrow(/no such table/i);
  });

  it('apply ซ้ำไม่พัง (journal กันซ้ำ)', async () => {
    await expect(migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER })).resolves.toBeUndefined();
  });
});
