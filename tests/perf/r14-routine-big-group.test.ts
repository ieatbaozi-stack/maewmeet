// R14_CONTRACT §5 · R14-6 · ADR 0012 §8 "ปริมาณในกลุ่มใหญ่": วัดจริงว่าแถวของ routine ในกลุ่ม 50 คน ชน CALENDAR_MAX_ITEMS (5,000) หรือไม่
// เส้นทางที่วัด (route handler จริงบน libSQL ไฟล์ + migration จริง): ปฏิทินกลุ่ม 42 วัน · ว่างตรงกัน 42 / 62 วัน · เตือนนัดทับ (check 1 ชม.)
// ฉาก (สร้าง routine ผ่าน service จริง createRoutine — กฎ + แถว ใน tx เดียว · busy เดี่ยวแทรกตรง):
//   A  ตามสัญญา: 50 คน × (ทำงาน จ.–ศ. 09–18 + เรียน จ.–ศ. 19–21) 26 สัปดาห์ + busy เดี่ยว 3 รายการ/คน
//   B  หนักขึ้น: A + ยิม จ. พ. ศ. 06–07 + เสาร์–อาทิตย์ทั้งวัน (4 ชุด/คน)
//   C  เต็มเพดาน (R14_PERF_HEAVY=1 เท่านั้น — ช้า): 50 คน × 10 ชุด ทุกวัน ช่วง 9 สัปดาห์ (ไม่เกิน 1,500 แถว/คน)
// ผล: console (ตาราง) · R14_PERF_OUT=<ไฟล์> → JSON · เวลา = มัธยฐาน 5 รอบหลัง warm-up 1 รอบ (เครื่อง dev + libSQL ไฟล์ — ไม่ใช่ Turso)
// เกณฑ์ที่ assert: A ต้องไม่ truncated ทุกเส้นทาง (R14-6 "ไม่ถูกตัดในกรณีที่ตกลง") · B/C บันทึกตัวเลขเท่านั้น
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRoutine, type CreateRoutineInput } from '@/lib/data/services/busy-routines';
import type { DataCtx } from '@/lib/data/context';
import { CALENDAR_MAX_ITEMS } from '@/lib/shared/limits';
import { addDays, startOfDay } from '@/lib/calendar';
import { AVAILABILITY_FETCH_MARGIN_MS } from '@/lib/data/services/availability';
import { newId } from '@/lib/shared/id';
import type { UserActor } from '@/lib/rbac/types';
import { get, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

const NOW = Date.UTC(2026, 10, 11, 3); // 2026-11-11 10:00 BKK
const MEMBERS = 50; // GROUP_LIMITS.membersPerGroup
const RUNS = 5;
const HEAVY = process.env.R14_PERF_HEAVY === '1';
const RANGES = {
  cal42: { from: '2026-11-30', to: '2027-01-10' },
  av42: { from: '2026-11-30', to: '2027-01-10' },
  av62: { from: '2026-11-30', to: '2027-01-30' },
} as const;

type Result = {
  scenario: string;
  route: string;
  days: number;
  busyRowsInDb: number;
  itemsReturned: number;
  truncated: boolean;
  pctOfCap: number;
  queries: number;
  dbMsMedian: number;
  totalMsMedian: number;
  wallMsMedian: number;
  bytes: number;
};
const results: Result[] = [];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
function timing(v: string | null): { queries: number; dbMs: number; totalMs: number } {
  const m = v && /^db;dur=([\d.]+);desc="(\d+) quer(?:y|ies)", total;dur=([\d.]+)$/.exec(v);
  if (!m) throw new Error(`no Server-Timing (${v})`);
  return { dbMs: Number(m[1]), queries: Number(m[2]), totalMs: Number(m[3]) };
}

const work = (over: Partial<CreateRoutineInput> = {}): CreateRoutineInput => ({
  rangeKind: 'weeks',
  fromWeek: '2026-11-09',
  toWeek: '2027-05-03', // 26 สัปดาห์
  weekdays: [1, 2, 3, 4, 5],
  allDay: false,
  startTime: '09:00',
  endTime: '18:00',
  title: 'ทำงาน',
  ...over,
});

async function seedGroup(h: Harness, viewer: Person): Promise<{ gid: string; userIds: string[] }> {
  const gid = await makeGroup(viewer, 'ก๊วนใหญ่');
  const userIds = [viewer.id];
  for (let i = 1; i < MEMBERS; i++) {
    const id = newId();
    await h.rows('INSERT INTO user (id, username, username_normalized, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, `m${i}`, `m${i}`, `สมาชิก ${i}`, NOW, NOW]);
    await h.rows("INSERT INTO group_member (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", [gid, id, NOW]);
    userIds.push(id);
  }
  return { gid, userIds };
}

async function seedRoutines(h: Harness, userIds: string[], specs: CreateRoutineInput[]): Promise<void> {
  const ctx: DataCtx = { db: h.db, req: new Request('https://maewmeet.test/'), now: NOW, appSecret: h.t.env.APP_SECRET! };
  for (const id of userIds) {
    const actor: UserActor = { kind: 'user', id, isSuperAdmin: false, status: 'active', mustChangePin: false };
    for (const s of specs) await createRoutine(actor, s, ctx);
  }
}

/** busy เดี่ยว 3 รายการ/คน ในช่วงที่วัด (ตรงด้วย SQL — เร็ว) */
async function seedOneOffs(h: Harness, userIds: string[]): Promise<void> {
  const days = ['2026-12-02', '2026-12-16', '2027-01-06'];
  for (const id of userIds) {
    for (const d of days) {
      const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
      const start = Date.UTC(y, m - 1, dd, 5); // 12:00 BKK
      await h.rows(
        "INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES (?, ?, 'นัดหมอ', NULL, 0, ?, ?, ?, ?, 'Asia/Bangkok', 0, ?, ?)",
        [newId(), id, start, start + 2 * 3_600_000, d, d, NOW, NOW],
      );
    }
  }
}

async function measure(h: Harness, viewer: Person, gid: string, scenario: string): Promise<void> {
  const routes: { route: string; days: number; url?: string; check?: boolean; fromDate: string; toDate: string }[] = [
    { route: 'GET calendar', days: 42, url: `/api/groups/${gid}/calendar?from=${RANGES.cal42.from}&to=${RANGES.cal42.to}`, fromDate: RANGES.cal42.from, toDate: RANGES.cal42.to },
    { route: 'GET availability', days: 42, url: `/api/groups/${gid}/availability?from=${RANGES.av42.from}&to=${RANGES.av42.to}`, fromDate: RANGES.av42.from, toDate: RANGES.av42.to },
    { route: 'GET availability', days: 62, url: `/api/groups/${gid}/availability?from=${RANGES.av62.from}&to=${RANGES.av62.to}`, fromDate: RANGES.av62.from, toDate: RANGES.av62.to },
    { route: 'POST appointments/check', days: 1, check: true, fromDate: '2026-12-02', toDate: '2026-12-02' },
  ];
  for (const r of routes) {
    // แถว busy_block ของสมาชิกที่ทับช่วงที่เส้นทางนั้นดึงจริง (= สิ่งที่นับเทียบ CALENDAR_MAX_ITEMS):
    //   ปฏิทิน = [เที่ยงคืน from, เที่ยงคืนหลัง to) · ว่างตรงกัน = หน้าต่างกลุ่ม ± 26 ชม. (AVAILABILITY_FETCH_MARGIN_MS) · check = นัด ± 26 ชม.
    const margin = r.route === 'GET calendar' ? 0 : AVAILABILITY_FETCH_MARGIN_MS;
    const fromMs = startOfDay(r.fromDate, 'Asia/Bangkok') - margin;
    const toMs = startOfDay(addDays(r.toDate, 1), 'Asia/Bangkok') + margin;
    const [cnt] = await h.rows<{ n: number }>(
      'SELECT count(*) AS n FROM busy_block b JOIN group_member gm ON gm.user_id = b.user_id WHERE gm.group_id = ? AND b.start_at < ? AND b.end_at > ?',
      [gid, toMs, fromMs],
    );
    const call = () =>
      r.check
        ? post<{ overlap: { status: string; blocked: unknown[] } }>(viewer.c, `/api/groups/${gid}/appointments/check`, { startDate: '2026-12-02', startTime: '10:00', endDate: '2026-12-02', endTime: '11:00' })
        : get<{ busy: unknown[]; truncated: boolean }>(viewer.c, r.url!);
    await call(); // warm-up
    const walls: number[] = [];
    const dbs: number[] = [];
    const totals: number[] = [];
    let last: Awaited<ReturnType<typeof call>> | undefined;
    let queries = 0;
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      last = await call();
      walls.push(performance.now() - t0);
      expect(last.status, JSON.stringify(last.json).slice(0, 300)).toBe(200);
      const tm = timing(last.headers.get('server-timing'));
      dbs.push(tm.dbMs);
      totals.push(tm.totalMs);
      queries = tm.queries;
    }
    const data = last!.data as { busy?: unknown[]; truncated?: boolean; overlap?: { status: string; blocked: unknown[] } };
    const truncated = r.check ? data.overlap!.status === 'unknown' : data.truncated!;
    results.push({
      scenario,
      route: r.route,
      days: r.days,
      busyRowsInDb: Number(cnt!.n),
      itemsReturned: r.check ? data.overlap!.blocked.length : data.busy!.length,
      truncated,
      pctOfCap: r1((Number(cnt!.n) / CALENDAR_MAX_ITEMS) * 100),
      queries,
      dbMsMedian: r1(median(dbs)),
      totalMsMedian: r1(median(totals)),
      wallMsMedian: r1(median(walls)),
      bytes: JSON.stringify(last!.json).length,
    });
  }
}

afterAll(() => {
  console.table(results);
  if (process.env.R14_PERF_OUT) writeFileSync(process.env.R14_PERF_OUT, JSON.stringify(results, null, 2));
});

describe('R14 perf — กลุ่ม 50 คน กับ routine', () => {
  describe('A ตามสัญญา: 2 ชุด จ.–ศ./คน + busy เดี่ยว 3/คน', () => {
    let h: Harness;
    let viewer: Person;
    let gid: string;
    beforeAll(async () => {
      h = await setupHarness({ startAt: NOW });
      viewer = await person(h, 'viewer');
      const g = await seedGroup(h, viewer);
      gid = g.gid;
      await seedRoutines(h, g.userIds, [work(), work({ startTime: '19:00', endTime: '21:00', title: 'เรียน' })]);
      await seedOneOffs(h, g.userIds);
    }, 600_000);
    afterAll(async () => {
      await h?.cleanup();
    });

    it('ไม่มีเส้นทางใดถูกตัด (truncated = false) · แถวในฐานต่ำกว่า CALENDAR_MAX_ITEMS', async () => {
      expect(await h.count('busy_routine')).toBe(MEMBERS * 2);
      await measure(h, viewer, gid, 'A');
      const mine = results.filter((r) => r.scenario === 'A');
      expect(mine).toHaveLength(4);
      for (const r of mine) expect(r.truncated, `${r.route} ${r.days}d`).toBe(false);
      for (const r of mine) expect(r.busyRowsInDb).toBeLessThan(CALENDAR_MAX_ITEMS);
    }, 600_000);
  });

  describe('B หนักขึ้น: 4 ชุด/คน (ทำงาน + เรียน + ยิม 3 วัน + เสาร์–อาทิตย์ทั้งวัน) + busy เดี่ยว 3/คน', () => {
    let h: Harness;
    let viewer: Person;
    let gid: string;
    beforeAll(async () => {
      h = await setupHarness({ startAt: NOW });
      viewer = await person(h, 'viewer');
      const g = await seedGroup(h, viewer);
      gid = g.gid;
      await seedRoutines(h, g.userIds, [
        work(),
        work({ startTime: '19:00', endTime: '21:00', title: 'เรียน' }),
        work({ weekdays: [1, 3, 5], startTime: '06:00', endTime: '07:00', title: 'ยิม' }),
        work({ weekdays: [6, 7], allDay: true, startTime: undefined, endTime: undefined, title: 'เสาร์อาทิตย์' }),
      ]);
      await seedOneOffs(h, g.userIds);
    }, 600_000);
    afterAll(async () => {
      await h?.cleanup();
    });

    it('บันทึกตัวเลข (ไม่ assert truncated)', async () => {
      await measure(h, viewer, gid, 'B');
      expect(results.filter((r) => r.scenario === 'B')).toHaveLength(4);
    }, 600_000);
  });

  describe.runIf(HEAVY)('C เต็มเพดาน: 10 ชุดทุกวัน/คน (R14_PERF_HEAVY=1)', () => {
    let h: Harness;
    let viewer: Person;
    let gid: string;
    beforeAll(async () => {
      h = await setupHarness({ startAt: NOW });
      viewer = await person(h, 'viewer');
      const g = await seedGroup(h, viewer);
      gid = g.gid;
      const specs = Array.from({ length: 10 }, (_, i) =>
        work({ fromWeek: '2026-11-30', toWeek: '2027-01-25', weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: `${String(6 + i).padStart(2, '0')}:00`, endTime: `${String(7 + i).padStart(2, '0')}:00`, title: `ชุด ${i}` }),
      );
      await seedRoutines(h, g.userIds, specs);
    }, 1_800_000);
    afterAll(async () => {
      await h?.cleanup();
    });

    it('บันทึกตัวเลข (คาดว่า truncated)', async () => {
      await measure(h, viewer, gid, 'C');
      expect(results.filter((r) => r.scenario === 'C')).toHaveLength(4);
    }, 1_800_000);
  });
});
