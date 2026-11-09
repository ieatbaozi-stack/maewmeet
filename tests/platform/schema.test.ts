// R0-4: migration จริงจาก drizzle/ บน DB ว่าง · 19 ตาราง · constraint สำคัญปฏิเสธจริง (ARCHITECTURE §3)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '@/db/schema';
import { createTestDb, MIGRATIONS_FOLDER, type TestDb } from '../helpers/db';

const EXPECTED_TABLES = [
  'appointment',
  'appointment_reminder',
  'appointment_rsvp',
  'audit_log',
  'busy_block',
  'group_invite',
  'group_member',
  'groups',
  'line_link_code',
  'login_throttle',
  'notification',
  'notification_outbox',
  'pepper_fingerprint',
  'pin_reset_request',
  'place_search_cache',
  'rate_limit_bucket',
  'session',
  'system_heartbeat',
  'user',
].sort();

const NOW = 1_760_000_000_000;

let t: TestDb;
const exec = (sql: string, args: (string | number | null)[] = []) => t.db.$client.execute({ sql, args });
const expectReject = (sql: string, args: (string | number | null)[] = []) =>
  expect(exec(sql, args)).rejects.toThrow(/constraint/i);

async function insertUser(id: string, username: string, normalized = username.toLowerCase()) {
  await exec(
    'insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)',
    [id, username, normalized, id, NOW, NOW],
  );
}
async function insertGroup(id: string, createdBy: string) {
  await exec('insert into groups(id, name, created_by, created_at, updated_at) values (?,?,?,?,?)', [id, id, createdBy, NOW, NOW]);
}

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.cleanup();
});

describe('migration', () => {
  it('apply บน DB ว่างได้ และได้ 19 ตารางตรงชื่อ ARCHITECTURE §3', async () => {
    const rs = await exec(
      "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
    );
    const names = rs.rows.map((r) => String(r.name));
    expect(names).toEqual(EXPECTED_TABLES);
    expect(names).toHaveLength(19);
  });

  it('schema.ts ประกาศ 19 ตารางชุดเดียวกับที่อยู่ใน DB', () => {
    // is(v, SQLiteTable) = type guard ของ drizzle (ตรวจ entityKind) — ไม่ต้องเดาโครงสร้างภายในของตาราง
    const tables = Object.values(schema)
      .flatMap((v) => (is(v, SQLiteTable) ? [getTableConfig(v).name] : []))
      .sort();
    expect(tables).toEqual(EXPECTED_TABLES);
  });

  it('apply ซ้ำบน DB เดิมไม่พัง (journal กันซ้ำ)', async () => {
    await expect(migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER })).resolves.toBeUndefined();
  });

  it('foreign_keys เปิดอยู่ (libSQL) — FK ปฏิเสธ user ที่ไม่มีจริง', async () => {
    const rs = await exec('PRAGMA foreign_keys');
    expect(Number(rs.rows[0]?.foreign_keys)).toBe(1);
    await expect(
      exec('insert into session(id, user_id, created_at, expires_at, last_seen_at) values (?,?,?,?,?)', ['s', 'ghost', NOW, NOW, NOW]),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe('constraint', () => {
  beforeEach(async () => {
    for (const tb of ['appointment_rsvp', 'appointment', 'busy_block', 'group_invite', 'group_member', 'groups', 'pin_reset_request', 'system_heartbeat', 'user']) {
      await exec(`delete from ${tb}`);
    }
  });

  it('username unique ไม่สนตัวพิมพ์ (unique บน username_normalized)', async () => {
    await insertUser('u1', 'Alice', 'alice');
    await expectReject(
      'insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)',
      ['u2', 'ALICE', 'alice', 'x', NOW, NOW],
    );
    await insertUser('u3', 'alice2');
    const rs = await exec('select count(*) as n from user');
    expect(Number(rs.rows[0]?.n)).toBe(2);
  });

  it('line_user_id: NULL ซ้ำได้ แต่ค่าเดียวกันซ้ำไม่ได้', async () => {
    await insertUser('u1', 'a1');
    await insertUser('u2', 'a2');
    await exec("update user set line_user_id = 'L1' where id = 'u1'");
    await expectReject("update user set line_user_id = 'L1' where id = 'u2'");
  });

  it('user: status/locale/theme นอกชุด ถูกปฏิเสธ', async () => {
    await insertUser('u1', 'a1');
    await expectReject("update user set status = 'banned' where id = 'u1'");
    await expectReject("update user set locale = 'jp' where id = 'u1'");
    await expectReject("update user set theme = 'blue' where id = 'u1'");
  });

  it('group admin ได้กลุ่มละ 1 (moderator/member หลายคนได้ · admin คนละกลุ่มได้)', async () => {
    await insertUser('u1', 'a1');
    await insertUser('u2', 'a2');
    await insertUser('u3', 'a3');
    await insertGroup('g1', 'u1');
    await insertGroup('g2', 'u2');
    await exec("insert into group_member(group_id, user_id, role, joined_at) values ('g1','u1','admin',?)", [NOW]);
    await expectReject("insert into group_member(group_id, user_id, role, joined_at) values ('g1','u2','admin',?)", [NOW]);
    await exec("insert into group_member(group_id, user_id, role, joined_at) values ('g1','u2','moderator',?)", [NOW]);
    await exec("insert into group_member(group_id, user_id, role, joined_at) values ('g1','u3','moderator',?)", [NOW]);
    await expectReject("update group_member set role = 'admin' where group_id = 'g1' and user_id = 'u2'");
    await exec("insert into group_member(group_id, user_id, role, joined_at) values ('g2','u2','admin',?)", [NOW]);
    await expectReject("insert into group_member(group_id, user_id, role, joined_at) values ('g2','u3','owner',?)", [NOW]);
    // เข้าซ้ำไม่สร้างแถวซ้ำ (PK group_id+user_id)
    await expectReject("insert into group_member(group_id, user_id, role, joined_at) values ('g1','u3','member',?)", [NOW]);
  });

  it('pin reset ค้างได้ 1 ต่อผู้ใช้ (pending/approved) — ที่ปิดแล้วไม่นับ', async () => {
    await insertUser('u1', 'a1');
    await insertUser('u2', 'a2');
    const ins = (id: string, user: string, status: string) =>
      exec(
        'insert into pin_reset_request(id, user_id, status, device_token_hash, requested_at, pending_expires_at) values (?,?,?,?,?,?)',
        [id, user, status, 'h', NOW, NOW],
      );
    await ins('r1', 'u1', 'pending');
    await expect(ins('r2', 'u1', 'pending')).rejects.toThrow(/constraint/i);
    await expect(ins('r3', 'u1', 'approved')).rejects.toThrow(/constraint/i);
    await ins('r4', 'u1', 'rejected');
    await ins('r5', 'u1', 'expired');
    await ins('r6', 'u2', 'pending'); // คนละผู้ใช้ได้
    await exec("update pin_reset_request set status = 'used' where id = 'r1'");
    await ins('r7', 'u1', 'approved'); // ปิดอันเดิมแล้วเปิดใหม่ได้
    await expect(ins('r8', 'u1', 'nonsense')).rejects.toThrow(/constraint/i);
  });

  it('groups: หน้าต่างวันว่าง/ขั้นต่ำ ต้องถูกรูป', async () => {
    await insertUser('u1', 'a1');
    const ins = (id: string, start: number, end: number, min: number) =>
      exec(
        'insert into groups(id, name, created_by, created_at, updated_at, free_window_start_min, free_window_end_min, min_free_minutes) values (?,?,?,?,?,?,?,?)',
        [id, 'g', 'u1', NOW, NOW, start, end, min],
      );
    await ins('ok', 480, 1320, 120);
    await expect(ins('rev', 600, 540, 30)).rejects.toThrow(/constraint/i); // เริ่ม >= จบ
    await expect(ins('step', 485, 1320, 120)).rejects.toThrow(/constraint/i); // ไม่ลง 30 นาที
    await expect(ins('over', 480, 1470, 120)).rejects.toThrow(/constraint/i); // เกิน 24:00
    await expect(ins('min', 1080, 1200, 150)).rejects.toThrow(/constraint/i); // ขั้นต่ำยาวกว่าหน้าต่าง
    await expect(ins('min2', 480, 1320, 20)).rejects.toThrow(/constraint/i); // < 30
  });

  it('group_invite: direct ต้องมี invitee ไม่มี code · code ต้องมี hash · direct active ซ้ำไม่ได้', async () => {
    await insertUser('u1', 'a1');
    await insertUser('u2', 'a2');
    await insertGroup('g1', 'u1');
    const ins = (id: string, kind: string, invitee: string | null, hash: string | null, status = 'active') =>
      exec(
        'insert into group_invite(id, group_id, kind, invitee_user_id, code_hash, status, created_by, created_at, expires_at) values (?,?,?,?,?,?,?,?,?)',
        [id, 'g1', kind, invitee, hash, status, 'u1', NOW, NOW],
      );
    await expect(ins('i1', 'direct', null, null)).rejects.toThrow(/constraint/i);
    await expect(ins('i2', 'direct', 'u2', 'h')).rejects.toThrow(/constraint/i);
    await expect(ins('i3', 'code', null, null)).rejects.toThrow(/constraint/i);
    await ins('i4', 'direct', 'u2', null);
    await expect(ins('i5', 'direct', 'u2', null)).rejects.toThrow(/constraint/i);
    await ins('i6', 'direct', 'u2', null, 'declined');
    await ins('i7', 'code', null, 'hash-a');
    await expect(ins('i8', 'code', null, 'hash-a')).rejects.toThrow(/constraint/i);
  });

  it('busy_block / appointment: ช่วงเวลาต้องจบหลังเริ่ม · พิกัดต้องครบคู่และอยู่ในช่วง', async () => {
    await insertUser('u1', 'a1');
    await insertGroup('g1', 'u1');
    const busy = (id: string, s: number, e: number, ds: string, de: string) =>
      exec(
        'insert into busy_block(id, user_id, all_day, start_at, end_at, local_start_date, local_end_date, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)',
        [id, 'u1', 0, s, e, ds, de, NOW, NOW],
      );
    await busy('b1', 10, 20, '2026-01-01', '2026-01-01');
    await expect(busy('b2', 10, 10, '2026-01-01', '2026-01-01')).rejects.toThrow(/constraint/i);
    await expect(busy('b3', 10, 20, '2026-01-02', '2026-01-01')).rejects.toThrow(/constraint/i);

    const appt = (id: string, s: number, e: number, lat: number | null, lng: number | null) =>
      exec(
        'insert into appointment(id, group_id, title, start_at, end_at, tz, local_date, created_by, created_at, updated_at, lat, lng) values (?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, 'g1', 't', s, e, 'Asia/Bangkok', '2026-01-01', 'u1', NOW, NOW, lat, lng],
      );
    await appt('a1', 1, 2, null, null);
    await appt('a2', 1, 2, 13.75, 100.5);
    await expect(appt('a3', 2, 2, null, null)).rejects.toThrow(/constraint/i);
    await expect(appt('a4', 1, 2, 13.75, null)).rejects.toThrow(/constraint/i);
    await expect(appt('a5', 1, 2, 91, 100)).rejects.toThrow(/constraint/i);
    await expect(appt('a6', 1, 2, 10, 181)).rejects.toThrow(/constraint/i);
    await expectReject("update appointment set status = 'deleted' where id = 'a1'");
    await expectReject("insert into appointment_rsvp values ('a1','u1','yes',?)", [NOW]);
    await exec("insert into appointment_rsvp values ('a1','u1','going',?)", [NOW]);
  });

  it('system_heartbeat: source ได้แค่ vercel-cron / github-actions และแถวเดียวต่อ source', async () => {
    await exec("insert into system_heartbeat values ('vercel-cron', ?)", [NOW]);
    await exec("insert into system_heartbeat values ('github-actions', ?)", [NOW]);
    await expectReject("insert into system_heartbeat values ('cronjob', ?)", [NOW]);
    await expectReject("insert into system_heartbeat values ('vercel-cron', ?)", [NOW]);
  });
});
