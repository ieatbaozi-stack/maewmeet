// R10-10: migration 0004 ขึ้นได้บน DB ว่างและ DB ที่มีข้อมูล · backfill scheduled_at = created_at · เข้ากันได้ย้อนหลัง (INSERT แบบโค้ดเก่าไม่พัง)
// วิธีแบบ migration-0003: apply เฉพาะ migration ก่อน 0004 → ใส่ข้อมูล → apply ทั้งโฟลเดอร์จริง
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createTestDb, MIGRATIONS_FOLDER, type TestDb } from '../helpers/db';

type Journal = { entries: { idx: number; tag: string }[] } & Record<string, unknown>;

const NOW = 1_780_000_000_000;
let t: TestDb;
let partialDir: string;
let colsBefore: string[] = [];
const exec = (sql: string, args: (string | number | null)[] = []) => t.db.$client.execute({ sql, args });
const journal = () => JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
const OLD_INSERT = "insert into appointment(id, group_id, title, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at) values (?,'g1','t',?,?,'Asia/Bangkok','2026-11-20','active','u1',?,?)";

beforeAll(async () => {
  const j = journal();
  const i0004 = j.entries.findIndex((e) => e.tag.startsWith('0004_'));
  expect(i0004).toBeGreaterThan(0);
  const before = j.entries.slice(0, i0004);
  partialDir = mkdtempSync(path.join(tmpdir(), 'maewmeet-mig4-'));
  mkdirSync(path.join(partialDir, 'meta'));
  for (const e of before) copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(partialDir, `${e.tag}.sql`));
  writeFileSync(path.join(partialDir, 'meta/_journal.json'), JSON.stringify({ ...j, entries: before }));

  t = await createTestDb({ migrate: false });
  await migrate(t.db, { migrationsFolder: partialDir });
  colsBefore = (await exec("select name from pragma_table_info('appointment') order by cid")).rows.map((r) => String(r.name));
  await exec('insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)', ['u1', 'u1', 'u1', 'u1', NOW, NOW]);
  await exec('insert into groups(id, name, created_by, created_at, updated_at) values (?,?,?,?,?)', ['g1', 'g', 'u1', NOW, NOW]);
  await exec(OLD_INSERT, ['a1', NOW + 1000, NOW + 2000, NOW - 5000, NOW + 77]);
  await exec(OLD_INSERT, ['a2', NOW + 3000, NOW + 4000, NOW - 9000, NOW - 9000]);
  await migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER });
});
afterAll(async () => {
  await t?.cleanup();
  if (partialDir) rmSync(partialDir, { recursive: true, force: true });
});

describe('migration 0004', () => {
  it('SQL เป็นการเพิ่มอย่างเดียว (ไม่ rebuild/ลบตาราง) และมี backfill', () => {
    const tag = journal().entries.find((e) => e.tag.startsWith('0004_'))!.tag;
    const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
    expect(sql).toMatch(/ALTER TABLE `appointment` ADD `scheduled_at` integer DEFAULT 0 NOT NULL;/);
    expect(sql).toMatch(/UPDATE `appointment` SET `scheduled_at` = `created_at`;/);
    expect(sql).not.toMatch(/DROP TABLE|__new_|PRAGMA/i);
  });

  it('ก่อน 0004 ไม่มีคอลัมน์ · หลัง apply เพิ่มท้ายตาราง · journal ครบ', async () => {
    expect(colsBefore).not.toContain('scheduled_at');
    const after = (await exec("select name from pragma_table_info('appointment') order by cid")).rows.map((r) => String(r.name));
    expect(after).toEqual([...colsBefore, 'scheduled_at']);
    expect(Number((await exec('select count(*) as n from __drizzle_migrations')).rows[0]?.n)).toBe(journal().entries.length);
  });

  it('backfill = created_at (ไม่ใช่ updated_at) · ข้อมูลเดิมไม่เปลี่ยน', async () => {
    const rows = (await exec('select id, scheduled_at, created_at, updated_at from appointment order by id')).rows;
    expect(rows.map((r) => [r.id, r.scheduled_at])).toEqual([
      ['a1', NOW - 5000],
      ['a2', NOW - 9000],
    ]);
    expect(rows[0]?.updated_at).toBe(NOW + 77);
  });

  it('เข้ากันได้ย้อนหลัง: INSERT แบบโค้ดเก่าไม่พัง ได้ scheduled_at = 0', async () => {
    await exec(OLD_INSERT, ['old-code', NOW + 5000, NOW + 6000, NOW, NOW]);
    expect((await exec("select scheduled_at as s from appointment where id = 'old-code'")).rows[0]?.s).toBe(0);
    const col = await exec("select \"notnull\" as nn, dflt_value as d from pragma_table_info('appointment') where name = 'scheduled_at'");
    expect(col.rows.map((r) => [Number(r.nn), String(r.d)])).toEqual([[1, '0']]);
  });

  it('appointment_reminder: PK กันซ้ำ · kind ต้องอยู่ในชุด · start_at ต่าง = แถวใหม่ · FK cascade', async () => {
    const ins = (k: string, s: number) => exec('insert into appointment_reminder(appointment_id, kind, start_at, created_at) values (?,?,?,?)', ['a2', k, s, NOW]);
    await ins('appointment.reminder_1d', 100);
    await expect(ins('appointment.reminder_1d', 100)).rejects.toThrow(/constraint/i);
    await ins('appointment.reminder_1d', 200);
    await expect(ins('appointment.created', 100)).rejects.toThrow(/constraint/i);
    await exec("delete from appointment where id = 'a2'");
    expect(Number((await exec("select count(*) as n from appointment_reminder where appointment_id = 'a2'")).rows[0]?.n)).toBe(0);
  });

  it('line_link_code: code_hash unique · FK cascade', async () => {
    const ins = (id: string, hash: string) => exec('insert into line_link_code(id, user_id, code_hash, created_at, expires_at) values (?,?,?,?,?)', [id, 'u1', hash, NOW, NOW + 1]);
    await ins('c1', 'h1');
    await expect(ins('c2', 'h1')).rejects.toThrow(/constraint/i);
    const fk = await exec("select \"table\" as t, on_delete from pragma_foreign_key_list('line_link_code')");
    expect(fk.rows.map((r) => [r.t, r.on_delete])).toEqual([['user', 'CASCADE']]);
  });

  it('apply ซ้ำไม่พัง', async () => {
    await expect(migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER })).resolves.toBeUndefined();
  });
});
