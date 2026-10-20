// R4A-6 ประสิทธิภาพ: กลุ่ม 50 คน × 62 วัน × busy หนาแน่น — ทั้ง service call (โหลดสมาชิก + busy + commonFreeTime + blockers + serializer) < 200 ms
// libSQL in-memory + migration จริง · เรียก service ตรง (ไม่ผ่าน HTTP/argon2) · วัดค่ากลางของ 5 รอบหลังอุ่นเครื่อง
import { migrate } from 'drizzle-orm/libsql/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db/client';
import { getGroupAvailability } from '@/lib/data/services/availability';
import { CALENDAR_MAX_ITEMS } from '@/lib/shared/limits';
import type { DataCtx } from '@/lib/data/context';
import type { UserActor } from '@/lib/rbac/types';
import { MIGRATIONS_FOLDER } from '../helpers/db';

const MEMBERS = 50;
const DAYS = 62;
const GID = '3f2b7a52-1c0e-4d0a-9b57-5a0c6f1e9a01';
const NOW = Date.UTC(2026, 9, 18, 3);
const uid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
let db: Db;

beforeAll(async () => {
  db = createDb({ url: ':memory:' });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const q = (sql: string, args: (string | number | null)[] = []) => db.$client.execute({ sql, args });
  for (let i = 0; i < MEMBERS; i++) {
    await q(
      "INSERT INTO user (id, username, username_normalized, display_name, pin_hash, pin_pepper_version, is_admin, must_change_pin, status, locale, theme, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', 1, 0, 0, 'active', 'th', 'system', 1, 1)",
      [uid(i), `u${i}`, `u${i}`, `สมาชิก ${i}`],
    );
  }
  await q("INSERT INTO groups (id, name, tz, created_by, created_at, updated_at) VALUES (?, 'perf', 'Asia/Bangkok', ?, 1, 1)", [GID, uid(0)]);
  for (let i = 0; i < MEMBERS; i++) await q('INSERT INTO group_member (group_id, user_id, role, joined_at) VALUES (?, ?, ?, 1)', [GID, uid(i), i === 0 ? 'admin' : 'member']);
  // หนาแน่น: ทุกคนทุกวัน 1 ช่วง (เวลาเริ่มต่างกันตามคน) + ทุกวันที่ 7 มี all-day อีกบางคน → ~3.2k แถว (< เพดาน 5000)
  const day0 = Date.UTC(2026, 10, 1) - 7 * 3600_000; // 2026-11-01 00:00 BKK
  const rows: string[] = [];
  const args: (string | number | null)[] = [];
  let n = 0;
  const flush = async () => {
    if (!rows.length) return;
    await q(`INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${rows.join(',')}`, args);
    rows.length = 0;
    args.length = 0;
  };
  const date = (d: number) => new Date(Date.UTC(2026, 10, 1 + d)).toISOString().slice(0, 10);
  for (let d = 0; d < DAYS; d++) {
    for (let m = 0; m < MEMBERS; m++) {
      const start = day0 + d * 86_400_000 + (8 + (m % 12)) * 3600_000;
      rows.push("(?, ?, ?, 'n', 0, ?, ?, ?, ?, 'Asia/Bangkok', ?, 1, 1)");
      args.push(`10000000-0000-4000-8000-${String(n++).padStart(12, '0')}`, uid(m), `t${m}`, start, start + (1 + (m % 3)) * 3600_000, date(d), date(d), m % 2);
      if (d % 7 === 0 && m % 10 === 0) {
        rows.push("(?, ?, ?, 'n', 1, ?, ?, ?, ?, 'Asia/Bangkok', 0, 1, 1)");
        args.push(`10000000-0000-4000-8000-${String(n++).padStart(12, '0')}`, uid(m), `d${m}`, day0 + d * 86_400_000, day0 + (d + 1) * 86_400_000, date(d), date(d));
      }
      if (rows.length >= 400) await flush();
    }
  }
  await flush();
});
afterAll(() => db.$client.close());

describe('R4A-6 — ประสิทธิภาพ availability', () => {
  it(`${MEMBERS} คน × ${DAYS} วัน busy หนาแน่น: service call ทั้งก้อน < 200 ms`, async () => {
    const actor: UserActor = { kind: 'user', id: uid(0), isSuperAdmin: false, status: 'active', mustChangePin: false };
    const ctx = { db, req: new Request('https://maewmeet.test/'), now: NOW, appSecret: '' } as DataCtx;
    const run = () => getGroupAvailability(actor, GID, { from: '2026-11-01', to: '2027-01-01' }, ctx);
    const first = await run();
    const stored = Number((await db.$client.execute('SELECT count(*) AS n FROM busy_block')).rows[0]!.n);
    expect(first.days).toHaveLength(DAYS);
    expect(first.members).toHaveLength(MEMBERS);
    expect(first.truncated).toBe(false);
    expect(stored).toBeGreaterThan(3000);
    expect(stored).toBeLessThan(CALENDAR_MAX_ITEMS);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await run();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[2]!;
    const bytes = JSON.stringify(first).length;
    console.log(`availability perf: ${MEMBERS} members x ${DAYS} days, ${stored} busy rows, median ${median.toFixed(1)} ms (min ${times[0]!.toFixed(1)}, max ${times[4]!.toFixed(1)}), response ${(bytes / 1024).toFixed(0)} KiB`);
    expect(median).toBeLessThan(200);
    expect(times[4]!).toBeLessThan(400); // กันรอบเดียวช้าผิดปกติ (CI ช้ากว่า) แต่ไม่ flaky
  });
});
