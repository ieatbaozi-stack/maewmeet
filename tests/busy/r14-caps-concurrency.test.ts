// R14a test — เพดานต้องไม่ทะลุเมื่อยิงพร้อมกัน (CONTRACT R14-3 "รวมยิงพร้อมกัน") · เสริม tests/platform/r14-busy-routine.test.ts
// ที่ครอบเพดาน 10 ชุดแบบพร้อมกันแล้ว — ไฟล์นี้ครอบ 2 เพดานที่เหลือ: แถว routine 1,500 และ busy เดี่ยว 300 (ตอนแยกวันออกจาก routine)
// now = 2026-11-11 (พุธ) 10:00 Asia/Bangkok
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/lib/shared/id';
import { patch, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

const NOW = Date.UTC(2026, 10, 11, 3);

let h: Harness;
let a: Person;
beforeEach(async () => {
  h = await setupHarness({ startAt: NOW });
  a = await person(h, 'alice');
});
afterEach(async () => {
  await h.cleanup();
});

/** จ. อย่างเดียว 2 สัปดาห์ = 2 แถวต่อคำขอ */
const body = (over: Record<string, unknown> = {}) => ({
  rangeKind: 'weeks',
  fromWeek: '2026-11-16',
  toWeek: '2026-11-23',
  weekdays: [1],
  allDay: false,
  startTime: '09:00',
  endTime: '18:00',
  ...over,
});

async function seedOneOff(userId: string, n: number): Promise<void> {
  const base = Date.UTC(2027, 0, 1);
  for (let i = 0; i < n; i += 50) {
    const vals: string[] = [];
    const args: (string | number)[] = [];
    for (let j = i; j < Math.min(n, i + 50); j++) {
      vals.push("(?, ?, 'seed', NULL, 0, ?, ?, '2027-01-01', '2027-01-01', 'Asia/Bangkok', 0, 1, 1)");
      args.push(newId(), userId, base + j * 1_800_000, base + j * 1_800_000 + 1_800_000);
    }
    await h.rows(
      `INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${vals.join(',')}`,
      args,
    );
  }
}

async function seedRoutineRows(userId: string, n: number): Promise<void> {
  const rid = newId();
  await h.rows(
    "INSERT INTO busy_routine (id, user_id, all_day, weekdays, start_min, end_min, range_kind, start_date, end_date, created_at, updated_at) VALUES (?, ?, 0, 127, 0, 30, 'weeks', '2026-11-09', '2026-11-15', 1, 1)",
    [rid, userId],
  );
  const base = Date.UTC(2027, 0, 1);
  for (let i = 0; i < n; i += 50) {
    const vals: string[] = [];
    const args: (string | number)[] = [];
    for (let j = i; j < Math.min(n, i + 50); j++) {
      vals.push("(?, ?, ?, NULL, NULL, 0, ?, ?, '2027-01-01', '2027-01-01', 'Asia/Bangkok', 0, 1, 1)");
      args.push(newId(), userId, rid, base + j * 60_000, base + j * 60_000 + 30_000);
    }
    await h.rows(
      `INSERT INTO busy_block (id, user_id, routine_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${vals.join(',')}`,
      args,
    );
  }
}

describe('R14-3 — เพดานแถว routine 1,500 ยิงพร้อมกัน', () => {
  it('มี 1,496 แถว ยิง POST พร้อมกัน 6 คำขอ (คำขอละ 2 แถว) → สำเร็จพอดี 2 · ที่เหลือ LIMIT_REACHED routineRows · รวมไม่เกิน 1,500 · ไม่มีกฎกำพร้า', async () => {
    await seedRoutineRows(a.id, 1496);
    const res = await Promise.all(Array.from({ length: 6 }, () => post(a.c, '/api/me/busy-routines', body())));
    expect(res.filter((r) => r.status === 201)).toHaveLength(2);
    const failed = res.filter((r) => r.status !== 201);
    expect(failed).toHaveLength(4);
    for (const r of failed) expect([r.status, r.code, r.json.error?.params]).toEqual([409, 'LIMIT_REACHED', { limit: 'routineRows', max: 1500 }]);
    expect(await h.count('busy_block WHERE user_id = ? AND routine_id IS NOT NULL', [a.id])).toBe(1500);
    // กฎที่ล้มเหลวต้อง rollback: ชุดปลอม 1 + ที่สำเร็จ 2
    expect(await h.count('busy_routine WHERE user_id = ?', [a.id])).toBe(3);
    expect(await h.count('busy_block WHERE user_id = ? AND routine_id IS NOT NULL AND routine_id NOT IN (SELECT id FROM busy_routine)', [a.id])).toBe(0);
  });
});

describe('R14-3 — เพดาน busy เดี่ยว 300 ตอนแยกวันออกจาก routine ยิงพร้อมกัน', () => {
  it('มี busy เดี่ยว 299 + routine 2 วัน ยิง PATCH แยกวันพร้อมกัน → แยกได้พอดี 1 · อีกวัน busyCount · skip ตรงกับวันที่แยกสำเร็จเท่านั้น', async () => {
    const created = await post<{ routine: { id: string }; count: number }>(a.c, '/api/me/busy-routines', body());
    expect(created.status).toBe(201);
    const rid = created.data.routine.id;
    const days = await h.rows<{ id: string; local_start_date: string }>('SELECT id, local_start_date FROM busy_block WHERE routine_id = ? ORDER BY start_at', [rid]);
    expect(days).toHaveLength(2);
    await seedOneOff(a.id, 299);

    const res = await Promise.all(days.map((d) => patch(a.c, `/api/me/busy/${d.id}`, { title: 'ย้าย' })));
    const ok = res.filter((r) => r.status === 200);
    const full = res.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(full).toHaveLength(1);
    expect(full[0]!.json.error?.params).toEqual({ limit: 'busyCount', max: 300 });
    // busy เดี่ยว (routine_id IS NULL) = 300 พอดี ไม่เกิน
    expect(await h.count('busy_block WHERE user_id = ? AND routine_id IS NULL', [a.id])).toBe(300);
    // skip มีเฉพาะวันที่แยกสำเร็จ และแถว routine เหลือ 1
    expect(await h.count('busy_routine_skip WHERE routine_id = ?', [rid])).toBe(1);
    expect(await h.count('busy_block WHERE routine_id = ?', [rid])).toBe(1);
  });
});
