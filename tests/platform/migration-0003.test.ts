// R6F-6: migration 0003 (busy_block.series_id + partial index busy_user_series_idx) ขึ้นได้บนฐานที่มีข้อมูลเดิม · ไม่ backfill
// วิธี (แบบ migration-0002): apply เฉพาะ migration ก่อน 0003 (สำเนา journal ที่ตัดท้าย) → ใส่ busy เดิม → apply ทั้งโฟลเดอร์จริง
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
let rowsBefore: Record<string, unknown>[] = [];
const exec = (sql: string, args: (string | number | null)[] = []) => t.db.$client.execute({ sql, args });
const BUSY_COLS = 'id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at';

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
  const i0003 = journal.entries.findIndex((e) => e.tag.startsWith('0003_'));
  expect(i0003).toBeGreaterThan(0);
  const before = journal.entries.slice(0, i0003);
  partialDir = mkdtempSync(path.join(tmpdir(), 'maewmeet-mig3-'));
  mkdirSync(path.join(partialDir, 'meta'));
  for (const e of before) copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(partialDir, `${e.tag}.sql`));
  writeFileSync(path.join(partialDir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: before }));

  t = await createTestDb({ migrate: false });
  await migrate(t.db, { migrationsFolder: partialDir });
  colsBefore = (await exec("select name from pragma_table_info('busy_block') order by cid")).rows.map((r) => String(r.name));
  // ข้อมูลเดิมก่อน 0003: ผู้ใช้ 2 คน · busy 3 แถว (timed / all-day / ซ่อน + note)
  for (const id of ['u1', 'u2']) {
    await exec('insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)', [id, id, id, id, NOW, NOW]);
  }
  await exec(
    `insert into busy_block(${BUSY_COLS}) values
      ('b1','u1','เรียน',NULL,0,?,?,'2026-11-03','2026-11-03','Asia/Bangkok',0,?,?),
      ('b2','u1',NULL,NULL,1,?,?,'2026-11-04','2026-11-05','Asia/Bangkok',0,?,?),
      ('b3','u2','ลับ','โน้ต',0,?,?,'2026-11-03','2026-11-03','Asia/Tokyo',1,?,?)`,
    [NOW, NOW + 3_600_000, NOW, NOW, NOW + 86_400_000, NOW + 3 * 86_400_000, NOW, NOW, NOW + 1, NOW + 2, NOW, NOW],
  );
  rowsBefore = (await exec(`select ${BUSY_COLS} from busy_block order by id`)).rows.map((r) => ({ ...r }));
  await migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER });
});
afterAll(async () => {
  await t?.cleanup();
  if (partialDir) rmSync(partialDir, { recursive: true, force: true });
});

describe('migration 0003 บนฐานที่มี busy เดิม', () => {
  it('SQL ของ 0003 เป็น ALTER TABLE … ADD + CREATE INDEX (ไม่ rebuild ตาราง)', () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
    const tag = journal.entries.find((e) => e.tag.startsWith('0003_'))!.tag;
    const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
    expect(sql).toMatch(/ALTER TABLE `busy_block` ADD `series_id` text;/);
    expect(sql).toMatch(/CREATE INDEX `busy_user_series_idx` ON `busy_block` \(`user_id`,`series_id`\) WHERE "busy_block"\."series_id" is not null;/);
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|INSERT INTO|PRAGMA/i);
  });

  it('ก่อน 0003 ยังไม่มีคอลัมน์ · หลัง apply journal ครบทุก migration · series_id อยู่ท้ายตาราง', async () => {
    expect(colsBefore).not.toContain('series_id');
    const after = (await exec("select name from pragma_table_info('busy_block') order by cid")).rows.map((r) => String(r.name));
    // migration หลัง 0003 (เช่น 0005 เพิ่ม routine_id) ต่อท้ายได้ → ตรวจว่า 0003 ต่อท้ายคอลัมน์เดิมทันที (prefix)
    expect(after.slice(0, colsBefore.length + 1)).toEqual([...colsBefore, 'series_id']);
    const rs = await exec('select count(*) as n from __drizzle_migrations');
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
    expect(Number(rs.rows[0]?.n)).toBe(journal.entries.length);
  });

  it('แถวเดิมอยู่ครบทุกไบต์ และ series_id เป็น NULL ทั้งหมด (ไม่ backfill)', async () => {
    const rows = (await exec(`select ${BUSY_COLS} from busy_block order by id`)).rows.map((r) => ({ ...r }));
    expect(rows).toEqual(rowsBefore);
    const ser = await exec('select id, series_id from busy_block order by id');
    expect(ser.rows.map((r) => [r.id, r.series_id])).toEqual([
      ['b1', null],
      ['b2', null],
      ['b3', null],
    ]);
  });

  it('series_id เป็น TEXT nullable · มี index busy_user_series_idx แบบ partial (user_id, series_id) · index เดิมยังอยู่', async () => {
    const col = await exec("select type, \"notnull\" as nn, dflt_value as d from pragma_table_info('busy_block') where name = 'series_id'");
    expect(col.rows.map((r) => [String(r.type).toLowerCase(), Number(r.nn), r.d])).toEqual([['text', 0, null]]);
    const list = await exec("select name, \"unique\" as u, partial as p from pragma_index_list('busy_block') where name not like 'sqlite_%' order by name");
    // ตรวจเฉพาะ index ของ 0003 + เดิม (migration หลังจากนี้เพิ่ม index ของตัวเองได้ เช่น 0005 busy_routine_idx)
    const mine = new Set(['busy_user_end_idx', 'busy_user_series_idx', 'busy_user_start_idx']);
    expect(list.rows.filter((r) => mine.has(String(r.name))).map((r) => [r.name, Number(r.u), Number(r.p)])).toEqual([
      ['busy_user_end_idx', 0, 0],
      ['busy_user_series_idx', 0, 1],
      ['busy_user_start_idx', 0, 0],
    ]);
    const info = await exec("select name from pragma_index_info('busy_user_series_idx') order by seqno");
    expect(info.rows.map((r) => r.name)).toEqual(['user_id', 'series_id']);
    const ddl = await exec("select sql from sqlite_master where type = 'index' and name = 'busy_user_series_idx'");
    expect(String(ddl.rows[0]?.sql)).toMatch(/WHERE "busy_block"\."series_id" is not null/);
  });

  it('คิวรีชุดของเจ้าของใช้ index ใหม่ได้ (EXPLAIN QUERY PLAN)', async () => {
    const plan = await exec("explain query plan select id from busy_block where user_id = 'u1' and series_id = 's1'");
    expect(plan.rows.map((r) => String(r.detail)).join(' | ')).toMatch(/busy_user_series_idx/);
  });

  it('CHECK busy_range_ck เดิมยังทำงาน · ใส่ series_id ได้ · FK cascade เดิมยังอยู่', async () => {
    await expect(
      exec(`insert into busy_block(${BUSY_COLS}, series_id) values ('bad','u1',NULL,NULL,0,?,?,'2026-11-03','2026-11-03','Asia/Bangkok',0,?,?,'s1')`, [NOW, NOW, NOW, NOW]),
    ).rejects.toThrow(/CHECK constraint/i);
    await exec(`insert into busy_block(${BUSY_COLS}, series_id) values ('s1a','u1',NULL,NULL,0,?,?,'2026-11-06','2026-11-06','Asia/Bangkok',0,?,?,'s1')`, [NOW, NOW + 1, NOW, NOW]);
    expect((await exec("select count(*) as n from busy_block where series_id = 's1'")).rows[0]?.n).toBe(1);
    const fk = await exec("select \"table\" as t, on_delete from pragma_foreign_key_list('busy_block')");
    expect(fk.rows.map((r) => [r.t, r.on_delete])).toEqual([['user', 'CASCADE']]);
  });

  it('apply ซ้ำไม่พัง (journal กันซ้ำ)', async () => {
    await expect(migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER })).resolves.toBeUndefined();
  });
});
// DB ว่าง + migration ครบ (รวม 0003): tests/platform/schema.test.ts และทุกเทสต์ที่ใช้ createTestDb()
