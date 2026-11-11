// R14-1: migration 0005 (busy_routine + busy_routine_skip + busy_block.routine_id + partial index) ขึ้นได้บนฐานที่มีข้อมูลรูป R13 · ข้อมูลเดิมไม่เปลี่ยน · ไม่ backfill
// วิธี (แบบ migration-0003): apply เฉพาะ migration ก่อน 0005 (สำเนา journal ที่ตัดท้าย) → ใส่ข้อมูลเดิม → apply ทั้งโฟลเดอร์จริง
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createTestDb, MIGRATIONS_FOLDER, type TestDb } from '../helpers/db';

type Journal = { entries: { idx: number; tag: string }[] } & Record<string, unknown>;

const NOW = 1_794_000_000_000;
let t: TestDb;
let partialDir: string;
let colsBefore: string[] = [];
let tablesBefore: string[] = [];
const snapshots: Record<string, Record<string, unknown>[]> = {};
const exec = (sql: string, args: (string | number | null)[] = []) => t.db.$client.execute({ sql, args });
const BUSY_COLS = 'id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at, series_id';
/** ตารางที่มีข้อมูลรูป R13 ซึ่งต้องไม่เปลี่ยนแม้แต่ไบต์เดียว (key ใช้เรียงให้เทียบได้) */
const KEEP: [string, string][] = [
  ['user', 'id'],
  ['groups', 'id'],
  ['group_member', 'group_id, user_id'],
  ['busy_block', 'id'],
  ['appointment', 'id'],
  ['appointment_rsvp', 'appointment_id, user_id'],
  ['appointment_reminder', 'appointment_id, kind'],
];

const journalOf = () => JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
const tableNames = async () =>
  (await exec("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_drizzle%' escape '\\' order by name")).rows.map((r) =>
    String(r.name),
  );

beforeAll(async () => {
  const journal = journalOf();
  const i0005 = journal.entries.findIndex((e) => e.tag.startsWith('0005_'));
  expect(i0005).toBeGreaterThan(0);
  const before = journal.entries.slice(0, i0005);
  partialDir = mkdtempSync(path.join(tmpdir(), 'maewmeet-mig5-'));
  mkdirSync(path.join(partialDir, 'meta'));
  for (const e of before) copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(partialDir, `${e.tag}.sql`));
  writeFileSync(path.join(partialDir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: before }));

  t = await createTestDb({ migrate: false });
  await migrate(t.db, { migrationsFolder: partialDir });
  colsBefore = (await exec("select name from pragma_table_info('busy_block') order by cid")).rows.map((r) => String(r.name));
  tablesBefore = await tableNames();

  // ข้อมูลรูป R13: ผู้ใช้ 2 คน · กลุ่ม 1 · busy เดี่ยว/ทั้งวัน/ซ่อน+note/ชุดรายวัน · นัด + RSVP + reminder
  for (const id of ['u1', 'u2']) {
    await exec('insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)', [id, id, id, id, NOW, NOW]);
  }
  await exec("insert into groups(id, name, created_by, created_at, updated_at, min_free_minutes) values ('g1','ก๊วน','u1',?,?,240)", [NOW, NOW]);
  await exec("insert into group_member(group_id, user_id, role, joined_at) values ('g1','u1','admin',?), ('g1','u2','member',?)", [NOW, NOW]);
  await exec(
    `insert into busy_block(${BUSY_COLS}) values
      ('b1','u1','เรียน',NULL,0,?,?,'2026-11-03','2026-11-03','Asia/Bangkok',0,?,?,NULL),
      ('b2','u1',NULL,NULL,1,?,?,'2026-11-04','2026-11-05','Asia/Bangkok',0,?,?,NULL),
      ('b3','u2','ลับ','โน้ต',0,?,?,'2026-11-03','2026-11-03','Asia/Tokyo',1,?,?,NULL),
      ('b4','u2','คลาส',NULL,0,?,?,'2026-11-06','2026-11-06','Asia/Bangkok',0,?,?,'s1'),
      ('b5','u2','คลาส',NULL,0,?,?,'2026-11-07','2026-11-07','Asia/Bangkok',0,?,?,'s1')`,
    [
      NOW, NOW + 3_600_000, NOW, NOW,
      NOW + 86_400_000, NOW + 3 * 86_400_000, NOW, NOW,
      NOW + 1, NOW + 2, NOW, NOW,
      NOW + 4 * 86_400_000, NOW + 4 * 86_400_000 + 3_600_000, NOW, NOW,
      NOW + 5 * 86_400_000, NOW + 5 * 86_400_000 + 3_600_000, NOW, NOW,
    ],
  );
  await exec(
    "insert into appointment(id, group_id, title, start_at, end_at, tz, local_date, created_by, created_at, updated_at, scheduled_at) values ('a1','g1','กินข้าว',?,?,'Asia/Bangkok','2026-11-10','u1',?,?,?)",
    [NOW + 9 * 86_400_000, NOW + 9 * 86_400_000 + 7_200_000, NOW, NOW, NOW],
  );
  await exec("insert into appointment_rsvp(appointment_id, user_id, response, updated_at) values ('a1','u2','going',?)", [NOW]);
  await exec("insert into appointment_reminder(appointment_id, kind, start_at, created_at) values ('a1','appointment.reminder_1d',?,?)", [NOW + 9 * 86_400_000, NOW]);
  for (const [table, key] of KEEP) snapshots[table] = (await exec(`select * from ${table} order by ${key}`)).rows.map((r) => ({ ...r }));

  await migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER });
});
afterAll(async () => {
  await t?.cleanup();
  if (partialDir) rmSync(partialDir, { recursive: true, force: true });
});

describe('migration 0005 บนฐานที่มีข้อมูลรูป R13', () => {
  it('SQL ของ 0005 = CREATE TABLE ใหม่ 2 + CREATE INDEX + ALTER TABLE … ADD เท่านั้น (ไม่ rebuild / ไม่แตะข้อมูลเดิม)', () => {
    const tag = journalOf().entries.find((e) => e.tag.startsWith('0005_'))!.tag;
    const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements.map((s) => s.split('(')[0]!.replace(/\s+/g, ' ').trim())).toEqual([
      'CREATE TABLE `busy_routine`',
      'CREATE INDEX `busy_routine_user_idx` ON `busy_routine`',
      'CREATE TABLE `busy_routine_skip`',
      'ALTER TABLE `busy_block` ADD `routine_id` text;',
      'CREATE INDEX `busy_user_routine_idx` ON `busy_block`',
    ]);
    expect(sql).toMatch(/ALTER TABLE `busy_block` ADD `routine_id` text;/);
    expect(sql).toMatch(/CREATE INDEX `busy_user_routine_idx` ON `busy_block` \(`user_id`,`routine_id`\) WHERE "busy_block"\."routine_id" is not null;/);
    expect(sql).not.toMatch(/DROP TABLE|INSERT INTO|^\s*UPDATE\s|DELETE FROM|PRAGMA|__new_|RENAME/im);
    // busy_block.routine_id ไม่มี REFERENCES (ตัดสินใจใน schema.ts — drizzle-kit ตก ON DELETE CASCADE)
    expect(sql).not.toMatch(/ADD `routine_id` text REFERENCES/i);
  });

  it('ก่อน 0005 ไม่มีคอลัมน์/ตารางใหม่ · หลัง apply ครบทุก migration · routine_id อยู่ท้ายตาราง · ตารางใหม่ 2 ตาราง', async () => {
    expect(colsBefore).not.toContain('routine_id');
    expect(tablesBefore).not.toContain('busy_routine');
    const after = (await exec("select name from pragma_table_info('busy_block') order by cid")).rows.map((r) => String(r.name));
    expect(after).toEqual([...colsBefore, 'routine_id']);
    expect(await tableNames()).toEqual([...tablesBefore, 'busy_routine', 'busy_routine_skip'].sort());
    const rs = await exec('select count(*) as n from __drizzle_migrations');
    expect(Number(rs.rows[0]?.n)).toBe(journalOf().entries.length);
  });

  it('แถวเดิมทุกตารางอยู่ครบทุกไบต์ · routine_id เป็น NULL ทั้งหมด (ไม่ backfill)', async () => {
    for (const [table, key] of KEEP) {
      const rows = (await exec(`select * from ${table} order by ${key}`)).rows.map((r) => {
        const rest = { ...r } as Record<string, unknown>;
        delete rest.routine_id;
        return rest;
      });
      expect(rows, table).toEqual(snapshots[table]);
    }
    const r = await exec('select id, routine_id from busy_block order by id');
    expect(r.rows.map((x) => [x.id, x.routine_id])).toEqual([
      ['b1', null],
      ['b2', null],
      ['b3', null],
      ['b4', null],
      ['b5', null],
    ]);
  });

  it('routine_id เป็น TEXT nullable ไม่มี FK · index ใหม่เป็น partial (user_id, routine_id) · index/FK เดิมยังอยู่', async () => {
    const col = await exec("select type, \"notnull\" as nn, dflt_value as d from pragma_table_info('busy_block') where name = 'routine_id'");
    expect(col.rows.map((r) => [String(r.type).toLowerCase(), Number(r.nn), r.d])).toEqual([['text', 0, null]]);
    const list = await exec("select name, \"unique\" as u, partial as p from pragma_index_list('busy_block') where name not like 'sqlite_%' order by name");
    expect(list.rows.map((r) => [r.name, Number(r.u), Number(r.p)])).toEqual([
      ['busy_user_end_idx', 0, 0],
      ['busy_user_routine_idx', 0, 1],
      ['busy_user_series_idx', 0, 1],
      ['busy_user_start_idx', 0, 0],
    ]);
    const info = await exec("select name from pragma_index_info('busy_user_routine_idx') order by seqno");
    expect(info.rows.map((r) => r.name)).toEqual(['user_id', 'routine_id']);
    const fk = await exec("select \"table\" as t, \"from\" as f, on_delete from pragma_foreign_key_list('busy_block')");
    expect(fk.rows.map((r) => [r.t, r.f, r.on_delete])).toEqual([['user', 'user_id', 'CASCADE']]);
  });

  it('busy_routine: คอลัมน์ · FK user CASCADE · index (user_id, end_date) · busy_routine_skip: PK (routine_id, local_date) + FK CASCADE', async () => {
    const cols = await exec("select name, type, \"notnull\" as nn, dflt_value as d, pk from pragma_table_info('busy_routine') order by cid");
    expect(cols.rows.map((r) => [r.name, String(r.type).toLowerCase(), Number(r.nn), r.d, Number(r.pk)])).toEqual([
      ['id', 'text', 1, null, 1],
      ['user_id', 'text', 1, null, 0],
      ['title', 'text', 0, null, 0],
      ['note', 'text', 0, null, 0],
      ['hide_detail', 'integer', 1, 'false', 0],
      ['all_day', 'integer', 1, null, 0],
      ['weekdays', 'integer', 1, null, 0],
      ['start_min', 'integer', 0, null, 0],
      ['end_min', 'integer', 0, null, 0],
      ['range_kind', 'text', 1, null, 0],
      ['start_date', 'text', 1, null, 0],
      ['end_date', 'text', 1, null, 0],
      ['tz', 'text', 1, "'Asia/Bangkok'", 0],
      ['created_at', 'integer', 1, null, 0],
      ['updated_at', 'integer', 1, null, 0],
    ]);
    const fk = await exec("select \"table\" as t, on_delete from pragma_foreign_key_list('busy_routine')");
    expect(fk.rows.map((r) => [r.t, r.on_delete])).toEqual([['user', 'CASCADE']]);
    const idx = await exec("select name from pragma_index_info('busy_routine_user_idx') order by seqno");
    expect(idx.rows.map((r) => r.name)).toEqual(['user_id', 'end_date']);
    const skipCols = await exec("select name, pk from pragma_table_info('busy_routine_skip') order by cid");
    expect(skipCols.rows.map((r) => [r.name, Number(r.pk)])).toEqual([
      ['routine_id', 1],
      ['local_date', 2],
    ]);
    const skipFk = await exec("select \"table\" as t, on_delete from pragma_foreign_key_list('busy_routine_skip')");
    expect(skipFk.rows.map((r) => [r.t, r.on_delete])).toEqual([['busy_routine', 'CASCADE']]);
  });

  it('CHECK ของ busy_routine: weekdays 1–127 · range_kind · end ≥ start · เวลา (ทั้งวัน = NULL, มีเวลา = 0–1410/30–1440 ลงตัว 30 ไม่เท่ากัน)', async () => {
    const ins = (id: string, over: Partial<Record<string, string | number | null>> = {}) => {
      const v = { all_day: 0, weekdays: 31, start_min: 540, end_min: 1080, range_kind: 'weeks', start_date: '2026-11-16', end_date: '2026-11-22', ...over };
      return exec(
        'insert into busy_routine(id, user_id, all_day, weekdays, start_min, end_min, range_kind, start_date, end_date, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?)',
        [id, 'u1', v.all_day, v.weekdays, v.start_min, v.end_min, v.range_kind, v.start_date, v.end_date, NOW, NOW],
      );
    };
    await ins('ok1');
    await ins('ok2', { all_day: 1, start_min: null, end_min: null, weekdays: 96 });
    await ins('ok3', { start_min: 1320, end_min: 360 }); // ข้ามเที่ยงคืน
    await ins('ok4', { start_min: 1080, end_min: 1440, range_kind: 'months' }); // จบ 24:00
    for (const [id, over] of [
      ['w0', { weekdays: 0 }],
      ['w128', { weekdays: 128 }],
      ['wtxt', { weekdays: 'abc' }], // '31' ผ่านเพราะ INTEGER affinity แปลงเป็น 31 — ข้อความที่ไม่ใช่ตัวเลขยังเป็น text
      ['rk', { range_kind: 'days' }],
      ['dt', { end_date: '2026-11-15' }],
      ['ad1', { all_day: 1 }],
      ['ad0', { start_min: null }],
      ['eq', { start_min: 600, end_min: 600 }],
      ['st', { start_min: 545 }],
      ['s24', { start_min: 1440, end_min: 60 }],
      ['e0', { end_min: 0 }],
      ['e1470', { end_min: 1470 }],
    ] as const) {
      await expect(ins(id, over as Record<string, string | number | null>), id).rejects.toThrow(/CHECK constraint/i);
    }
  });

  it('ใส่ routine_id ได้ · ลบกฎ = skip ตาม cascade · ลบ user = กฎตาม cascade · แถว busy_block ไม่ถูก cascade (ไม่มี FK — ลบด้วยคำสั่งชัดเจน)', async () => {
    await exec(`insert into busy_block(${BUSY_COLS}, routine_id) values ('r1d','u1',NULL,NULL,0,?,?,'2026-11-16','2026-11-16','Asia/Bangkok',0,?,?,NULL,'ok1')`, [NOW, NOW + 1, NOW, NOW]);
    await exec("insert into busy_routine_skip(routine_id, local_date) values ('ok1','2026-11-17'), ('ok1','2026-11-18')");
    await expect(exec("insert into busy_routine_skip(routine_id, local_date) values ('ok1','2026-11-17')")).rejects.toThrow(/UNIQUE|PRIMARY/i);
    await expect(exec("insert into busy_routine_skip(routine_id, local_date) values ('nope','2026-11-17')")).rejects.toThrow(/FOREIGN KEY/i);
    await exec("delete from busy_routine where id = 'ok1'");
    expect(Number((await exec("select count(*) as n from busy_routine_skip where routine_id = 'ok1'")).rows[0]?.n)).toBe(0);
    expect(Number((await exec("select count(*) as n from busy_block where id = 'r1d'")).rows[0]?.n)).toBe(1);
  });

  it('คิวรีแถวของ routine ของเจ้าของใช้ index ใหม่ได้ (EXPLAIN QUERY PLAN)', async () => {
    const plan = await exec("explain query plan select id from busy_block where user_id = 'u1' and routine_id = 'r1' and local_start_date >= '2026-11-11'");
    expect(plan.rows.map((r) => String(r.detail)).join(' | ')).toMatch(/busy_user_routine_idx/);
  });

  it('apply ซ้ำไม่พัง (journal กันซ้ำ)', async () => {
    await expect(migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER })).resolves.toBeUndefined();
  });
});
