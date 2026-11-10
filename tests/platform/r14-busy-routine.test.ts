// R14a Platform — busy routine (ADR 0012): POST/GET/PATCH/DELETE /api/me/busy-routines · แก้/ลบวันเดียวผ่าน /api/me/busy/:id ·
// เพดาน 10 ชุด / 1,500 แถว / 300 ของ busy เดี่ยว · ขอบเขตแก้/ลบ 3 แบบ · เจ้าของเท่านั้น · ไม่รั่ว routineId/weekdays/rangeKind/note · ลบบัญชี/cron
// R14-2, R14-3, R14-4, R14-5, R14-6, R14-7 · route handler จริงผ่าน Request/Response บน libSQL จริง + migration จริง + นาฬิกา inject
// now = 2026-11-11 (พุธ) 10:00 Asia/Bangkok
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sharedBusyInGroupQuery } from '@/lib/data/repos/busy';
import { ROUTINE_OWN_FIELDS } from '@/lib/data/serializers/busy-routine';
import { BUSY_SHARED_FIELDS } from '@/lib/data/serializers/busy';
import { newId } from '@/lib/shared/id';
import { Client, GOOD_PIN, call, del, get, join, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.UTC(2026, 10, 11, 3);
const rand = () => randomBytes(6).toString('hex');

let h: Harness;
let a: Person;
let b: Person;
beforeEach(async () => {
  h = await setupHarness({ startAt: NOW });
  a = await person(h, 'alice');
  b = await person(h, 'bob');
});
afterEach(async () => {
  await h.cleanup();
});

type RoutineView = {
  id: string;
  title: string | null;
  note: string | null;
  hidden: boolean;
  allDay: boolean;
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  overnight: boolean;
  rangeKind: 'weeks' | 'months';
  startDate: string;
  endDate: string;
  tz: string;
  remaining: number;
};
type Created = { routine: RoutineView; count: number };
type Updated = { routine: RoutineView; previous: RoutineView | null; count: number };
type OwnBusy = { id: string; localStartDate: string; startAt: number; endAt: number; routineId: string | null; seriesId: string | null; title: string | null; note: string | null };
type Row = { id: string; local_start_date: string; local_end_date: string; start_at: number; end_at: number; routine_id: string | null; series_id: string | null; title: string | null; note: string | null; hide_detail: number; all_day: number };

/** จ.–ศ. 09:00–18:00 · สัปดาห์ 16 พ.ย. ถึงสัปดาห์ 23 พ.ย. (16–29 พ.ย.) = 10 วัน */
const body = (over: Record<string, unknown> = {}) => ({
  rangeKind: 'weeks',
  fromWeek: '2026-11-16',
  toWeek: '2026-11-23',
  weekdays: [1, 2, 3, 4, 5],
  allDay: false,
  startTime: '09:00',
  endTime: '18:00',
  ...over,
});
const create = (p: Person, over: Record<string, unknown> = {}) => post<Created>(p.c, '/api/me/busy-routines', body(over));
async function mustCreate(p: Person, over: Record<string, unknown> = {}): Promise<Created> {
  const r = await create(p, over);
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.data;
}
const rowsOf = (routineId: string) =>
  h.rows<Row>('SELECT * FROM busy_block WHERE routine_id = ? ORDER BY start_at, id', [routineId]);
const datesOf = async (routineId: string) => (await rowsOf(routineId)).map((r) => r.local_start_date);
const skipsOf = async (routineId: string) =>
  (await h.rows<{ local_date: string }>('SELECT local_date FROM busy_routine_skip WHERE routine_id = ? ORDER BY local_date', [routineId])).map((r) => r.local_date);
const bkk = (y: number, m: number, d: number, hh: number, mm = 0) => Date.UTC(y, m - 1, d, hh - 7, mm);

/** แทรก busy เดี่ยวที่ยังไม่สิ้นสุด n แถว (เร็ว) */
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

/** แทรกแถวของ routine (ในอนาคต) n แถวให้ routine ปลอมหนึ่งชุด (เร็ว) */
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

describe('R14-2 — สร้าง routine (POST)', () => {
  it('จ.–ศ. 09–18 สองสัปดาห์ → 201 · 10 แถว busy_block ผูก routine_id · เวลาไทยถูก · title/note/ซ่อน คัดลอกทุกแถว · series_id NULL', async () => {
    const r = await create(a, { title: 'ทำงาน', note: 'ออฟฟิศ', hideDetail: true });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(Object.keys(r.data).sort()).toEqual(['count', 'routine']);
    expect(Object.keys(r.data.routine).sort()).toEqual([...ROUTINE_OWN_FIELDS].sort());
    expect(r.data.routine).toMatchObject({
      title: 'ทำงาน',
      note: 'ออฟฟิศ',
      hidden: true,
      allDay: false,
      weekdays: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '18:00',
      overnight: false,
      rangeKind: 'weeks',
      startDate: '2026-11-16',
      endDate: '2026-11-29',
      tz: 'Asia/Bangkok',
      remaining: 10,
    });
    expect(r.data.count).toBe(10);
    const rows = await rowsOf(r.data.routine.id);
    expect(rows.map((x) => x.local_start_date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    expect(rows[0]).toMatchObject({ start_at: bkk(2026, 11, 16, 9), end_at: bkk(2026, 11, 16, 18), local_end_date: '2026-11-16', title: 'ทำงาน', note: 'ออฟฟิศ', hide_detail: 1, all_day: 0, series_id: null });
    expect(new Set(rows.map((x) => x.title))).toEqual(new Set(['ทำงาน']));
    const rule = await h.rows('SELECT weekdays, start_min, end_min, range_kind, start_date, end_date, user_id FROM busy_routine WHERE id = ?', [r.data.routine.id]);
    expect(rule).toEqual([{ weekdays: 31, start_min: 540, end_min: 1080, range_kind: 'weeks', start_date: '2026-11-16', end_date: '2026-11-29', user_id: a.id }]);
  });

  it('"ทั้งเดือนนี้" (months พ.ย.–พ.ย.) กลางเดือน → start_date 1 พ.ย. แต่แถวตั้งแต่วันนี้ (11) = 14 วัน', async () => {
    const r = await mustCreate(a, { rangeKind: 'months', fromWeek: undefined, toWeek: undefined, fromMonth: '2026-11', toMonth: '2026-11' });
    expect([r.routine.startDate, r.routine.endDate, r.count]).toEqual(['2026-11-01', '2026-11-30', 14]);
    expect((await datesOf(r.routine.id))[0]).toBe('2026-11-11');
  });

  it('ข้ามเที่ยงคืน 22:00–06:00 จ. = จ. 22:00 → อ. 06:00 · จบ "24:00" ได้ · ทั้งวัน ส. อา.', async () => {
    const night = await mustCreate(a, { weekdays: [1], startTime: '22:00', endTime: '06:00', toWeek: '2026-11-16' });
    expect(night.routine).toMatchObject({ startTime: '22:00', endTime: '06:00', overnight: true });
    expect(await rowsOf(night.routine.id)).toMatchObject([{ local_start_date: '2026-11-16', local_end_date: '2026-11-17', start_at: bkk(2026, 11, 16, 22), end_at: bkk(2026, 11, 17, 6) }]);
    const mid = await mustCreate(a, { weekdays: [2], startTime: '18:00', endTime: '24:00', toWeek: '2026-11-16' });
    expect(mid.routine).toMatchObject({ endTime: '24:00', overnight: false });
    expect(await rowsOf(mid.routine.id)).toMatchObject([{ local_start_date: '2026-11-17', local_end_date: '2026-11-17', end_at: bkk(2026, 11, 18, 0) }]);
    const we = await mustCreate(a, { weekdays: [6, 7], allDay: true, startTime: undefined, endTime: undefined, toWeek: '2026-11-16' });
    expect(we.routine).toMatchObject({ allDay: true, startTime: null, endTime: null, weekdays: [6, 7] });
    expect(await rowsOf(we.routine.id)).toMatchObject([
      { local_start_date: '2026-11-21', all_day: 1, start_at: bkk(2026, 11, 21, 0), end_at: bkk(2026, 11, 22, 0) },
      { local_start_date: '2026-11-22', all_day: 1 },
    ]);
  });

  it('VALIDATION รูปร่าง: weekdays ขาด/ว่าง = REQUIRED · ซ้ำ/นอกช่วง = INVALID · ช่วงไม่ครบ/ปนชนิด · ทั้งวันมีเวลา · คีย์แปลก (userId/routineId) — ไม่มีอะไรถูกเขียน', async () => {
    const cases: [Record<string, unknown>, Record<string, string>][] = [
      [{ weekdays: undefined }, { weekdays: 'REQUIRED' }],
      [{ weekdays: [] }, { weekdays: 'REQUIRED' }],
      [{ weekdays: [1, 1] }, { weekdays: 'INVALID' }],
      [{ weekdays: [0] }, { weekdays: 'INVALID' }],
      [{ weekdays: [1, 2, 3, 4, 5, 6, 7, 1] }, { weekdays: 'TOO_LARGE' }],
      [{ toWeek: undefined }, { toWeek: 'REQUIRED' }],
      [{ fromMonth: '2026-11' }, { fromMonth: 'INVALID' }],
      [{ allDay: true }, { startTime: 'INVALID', endTime: 'INVALID' }],
      [{ endTime: undefined }, { endTime: 'REQUIRED' }],
      [{ userId: b.id }, { userId: 'UNKNOWN_FIELD' }],
      [{ routineId: newId() }, { routineId: 'UNKNOWN_FIELD' }],
      [{ rangeKind: 'days' }, { rangeKind: 'INVALID' }],
    ];
    for (const [over, fields] of cases) {
      const r = await create(a, over);
      expect([r.status, r.code], JSON.stringify(over)).toEqual([400, 'VALIDATION']);
      expect(r.json.error!.params, JSON.stringify(over)).toEqual({ fields });
    }
    expect(await h.count('busy_routine')).toBe(0);
    expect(await h.count('busy_block')).toBe(0);
  });

  it('error ตาม ADR 0012 §6 (รูปที่ ux ใช้) · ไม่มีอะไรถูกเขียน', async () => {
    const cases: [Record<string, unknown>, number, string, Record<string, unknown>][] = [
      [{ toWeek: '2027-05-17' }, 400, 'LIMIT_REACHED', { field: 'toWeek', limit: 'routineSpan', max: 26, rangeKind: 'weeks' }],
      [{ rangeKind: 'months', fromWeek: undefined, toWeek: undefined, fromMonth: '2026-11', toMonth: '2027-05' }, 400, 'LIMIT_REACHED', { field: 'toMonth', limit: 'routineSpan', max: 6, rangeKind: 'months' }],
      [{ rangeKind: 'months', fromWeek: undefined, toWeek: undefined, fromMonth: '2027-11', toMonth: '2027-11' }, 400, 'LIMIT_REACHED', { field: 'toMonth', limit: 'routineAhead', max: 12 }],
      [{ fromWeek: '2026-11-02', toWeek: '2026-11-02' }, 400, 'INVALID_RANGE', { field: 'toWeek', kind: 'dates', reason: 'ENDED' }],
      [{ fromWeek: '2026-11-23', toWeek: '2026-11-16' }, 400, 'INVALID_RANGE', { field: 'toWeek', kind: 'dates' }],
      [{ startTime: '09:00', endTime: '09:00' }, 400, 'INVALID_RANGE', { field: 'endTime', kind: 'time' }],
      [{ startTime: '09:15' }, 400, 'TIME_NOT_ON_STEP', { field: 'startTime' }],
      [{ startTime: '9am' }, 400, 'VALIDATION', { fields: { startTime: 'INVALID' } }],
      [{ fromWeek: '2026-02-30' }, 400, 'INVALID_DATE', { field: 'fromWeek' }],
      [{ fromWeek: '2569-11-16', toWeek: '2569-11-16' }, 400, 'DATE_OUT_OF_RANGE', { field: 'fromWeek' }],
      [{ tz: 'Mars/Base' }, 400, 'INVALID_TIMEZONE', { field: 'tz' }],
      [{ fromWeek: '2026-11-09', toWeek: '2026-11-09', weekdays: [1] }, 400, 'VALIDATION', { fields: { weekdays: 'NO_OCCURRENCE' } }],
      // DST gap (America/New_York 2027-03-14 02:30 ไม่มีจริง) → ทั้งคำขอ
      [{ tz: 'America/New_York', fromWeek: '2027-03-08', toWeek: '2027-03-15', weekdays: [7], startTime: '02:30', endTime: '03:30' }, 400, 'INVALID_LOCAL_TIME', { field: 'startTime' }],
    ];
    for (const [over, status, code, params] of cases) {
      const r = await create(a, over);
      expect([r.status, r.code], JSON.stringify(over)).toEqual([status, code]);
      expect(r.json.error!.params, JSON.stringify(over)).toEqual(params);
    }
    expect(await h.count('busy_routine')).toBe(0);
    expect(await h.count('busy_block')).toBe(0);
    // ผิดอินพุตไม่กินโควตา rate limit
    expect(await h.count("rate_limit_bucket WHERE key LIKE 'busy:routine%'")).toBe(0);
  });

  it('tz อื่น (New York) ขยายเวลาผนังทีละวันข้าม DST (2026-11-01) ได้ · เก็บ tz ของ routine', async () => {
    h.clock.set(Date.UTC(2026, 9, 20, 16));
    const r = await mustCreate(a, { tz: 'America/New_York', fromWeek: '2026-10-26', toWeek: '2026-11-02', weekdays: [5, 1], startTime: '09:00', endTime: '10:00' });
    expect(r.routine.tz).toBe('America/New_York');
    expect((await rowsOf(r.routine.id)).map((x) => [x.local_start_date, x.start_at])).toEqual([
      ['2026-10-26', Date.UTC(2026, 9, 26, 13)],
      ['2026-10-30', Date.UTC(2026, 9, 30, 13)],
      ['2026-11-02', Date.UTC(2026, 10, 2, 14)],
      ['2026-11-06', Date.UTC(2026, 10, 6, 14)],
    ]);
  });
});

describe('R14-3 — เพดาน', () => {
  it('routine ที่ยังไม่จบ ≤ 10: ชุดที่ 11 → 409 LIMIT_REACHED routines · rollback (ไม่มีกฎ/แถวเพิ่ม) · ชุดที่จบแล้วไม่นับ', async () => {
    for (let i = 0; i < 10; i++) await mustCreate(a, { weekdays: [1], toWeek: '2026-11-16' });
    const r = await create(a, { weekdays: [2], toWeek: '2026-11-16' });
    expect([r.status, r.code, r.json.error!.params]).toEqual([409, 'LIMIT_REACHED', { limit: 'routines', max: 10 }]);
    expect(await h.count('busy_routine WHERE user_id = ?', [a.id])).toBe(10);
    expect(await h.count('busy_block WHERE user_id = ? AND local_start_date = ?', [a.id, '2026-11-17'])).toBe(0);
    // ชุดหนึ่งจบไปแล้ว (end_date < วันนี้) → มีที่ว่าง 1
    await h.rows("UPDATE busy_routine SET start_date = '2026-11-02', end_date = '2026-11-08' WHERE id = (SELECT id FROM busy_routine WHERE user_id = ? LIMIT 1)", [a.id]);
    expect((await create(a, { weekdays: [2], toWeek: '2026-11-16' })).status).toBe(201);
    // คนอื่นไม่กินเพดานของเรา
    expect((await create(b, { weekdays: [2], toWeek: '2026-11-16' })).status).toBe(201);
  });

  it('แถว routine ในอนาคต ≤ 1,500: 1,495 + 10 → 409 LIMIT_REACHED routineRows · rollback ทั้งกฎและแถว · 1,490 + 10 ผ่าน', async () => {
    await seedRoutineRows(a.id, 1495);
    const r = await create(a);
    expect([r.status, r.code, r.json.error!.params]).toEqual([409, 'LIMIT_REACHED', { limit: 'routineRows', max: 1500 }]);
    expect(await h.count('busy_routine WHERE user_id = ?', [a.id])).toBe(1); // ชุดปลอมเท่านั้น
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(1495);
    await h.rows('DELETE FROM busy_block WHERE id IN (SELECT id FROM busy_block WHERE user_id = ? LIMIT 5)', [a.id]);
    expect((await create(a)).status).toBe(201);
    expect(await h.count('busy_block WHERE user_id = ? AND routine_id IS NOT NULL', [a.id])).toBe(1500);
  });

  it('แถว routine ไม่กินที่ 300 ของ busy เดี่ยว: มี 299 → สร้าง routine 10 วัน → ยังลง busy เดี่ยวได้อีก 1 · ครบ 300 แล้วยังสร้าง routine ได้', async () => {
    await seedOneOff(a.id, 299);
    await mustCreate(a);
    const one = await post(a.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-12-01', endDate: '2026-12-01' });
    expect(one.status).toBe(201);
    const full = await post(a.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-12-02', endDate: '2026-12-02' });
    expect([full.status, full.json.error?.params]).toEqual([409, { limit: 'busyCount', max: 300 }]);
    expect((await create(a, { weekdays: [6] })).status).toBe(201);
  });

  it('วันที่แยกออก (PATCH วันเดียว) เริ่มนับ 300: เต็ม 300 → 409 busyCount และไม่เปลี่ยนอะไร (ไม่มี skip) · 299 → แยกได้ แล้วเต็ม', async () => {
    const r = await mustCreate(a);
    const [day] = await rowsOf(r.routine.id);
    await seedOneOff(a.id, 300);
    const p = await patch(a.c, `/api/me/busy/${day!.id}`, { title: 'ย้ายไปบ่าย' });
    expect([p.status, p.json.error?.params]).toEqual([409, { limit: 'busyCount', max: 300 }]);
    expect((await rowsOf(r.routine.id)).map((x) => x.id)).toContain(day!.id);
    expect(await skipsOf(r.routine.id)).toEqual([]);
    await h.rows("DELETE FROM busy_block WHERE id IN (SELECT id FROM busy_block WHERE user_id = ? AND title = 'seed' LIMIT 1)", [a.id]);
    const ok = await patch<{ busy: OwnBusy }>(a.c, `/api/me/busy/${day!.id}`, { title: 'ย้ายไปบ่าย' });
    expect(ok.status).toBe(200);
    expect(ok.data.busy).toMatchObject({ id: day!.id, routineId: null, seriesId: null, title: 'ย้ายไปบ่าย' });
    expect(await skipsOf(r.routine.id)).toEqual(['2026-11-16']);
    const more = await post(a.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-12-01', endDate: '2026-12-01' });
    expect(more.status).toBe(409);
  });

  it('ยิงพร้อมกัน 12 คำขอเมื่อมีอยู่ 8 ชุด → สำเร็จพอดี 2 · ที่เหลือ LIMIT_REACHED routines · แถวตรงกับกฎที่สำเร็จ', async () => {
    for (let i = 0; i < 8; i++) await mustCreate(a, { weekdays: [1], toWeek: '2026-11-16' });
    const res = await Promise.all(Array.from({ length: 12 }, () => create(a, { weekdays: [3], toWeek: '2026-11-16' })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(2);
    expect(res.filter((r) => r.status === 409 && r.code === 'LIMIT_REACHED').length + res.filter((r) => r.status === 429).length).toBe(10);
    expect(await h.count('busy_routine WHERE user_id = ?', [a.id])).toBe(10);
    expect(await h.count("busy_block WHERE user_id = ? AND local_start_date = '2026-11-18'", [a.id])).toBe(2);
  });

  it('B12: มีครบ 10 ชุด → แก้ "ตั้งแต่สัปดาห์หน้า" (แยกเป็นสองชุด) สำเร็จ ไม่นับเพดาน · สร้างชุดใหม่ยัง 409 routines · แก้ทั้งชุดในที่ยังได้', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await mustCreate(a, { weekdays: [1], fromWeek: '2026-11-16', toWeek: '2026-11-30' })).routine.id);
    const split = await patch<Updated>(a.c, `/api/me/busy-routines/${ids[0]}`, body({ weekdays: [2], fromWeek: '2026-11-16', toWeek: '2026-11-30', from: '2026-11-23' }));
    expect(split.status, JSON.stringify(split.json)).toBe(200);
    expect(split.data.previous).toMatchObject({ id: ids[0], endDate: '2026-11-22' });
    expect(split.data.routine).toMatchObject({ startDate: '2026-11-23', endDate: '2026-12-06', weekdays: [2] });
    expect(await h.count("busy_routine WHERE user_id = ? AND end_date >= '2026-11-11'", [a.id])).toBe(11);
    const more = await create(a, { weekdays: [3], toWeek: '2026-11-16' });
    expect([more.status, more.code, more.json.error!.params]).toEqual([409, 'LIMIT_REACHED', { limit: 'routines', max: 10 }]);
    const inPlace = await patch(a.c, `/api/me/busy-routines/${ids[1]}`, body({ weekdays: [4], fromWeek: '2026-11-16', toWeek: '2026-11-30' }));
    expect(inPlace.status).toBe(200);
  });

  it('B12: การแยกยังติดเพดาน 1,500 แถว → 409 routineRows และไม่เปลี่ยนอะไร (ชุดเดิมไม่ถูกตัด)', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-16', toWeek: '2026-11-30' });
    await seedRoutineRows(a.id, 1490);
    const before = await h.rows('SELECT * FROM busy_routine ORDER BY id');
    const res = await patch(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ weekdays: [1, 2, 3, 4, 5, 6, 7], fromWeek: '2026-11-16', toWeek: '2026-11-30', from: '2026-11-23' }));
    expect([res.status, res.json.error?.params]).toEqual([409, { limit: 'routineRows', max: 1500 }]);
    expect(await h.rows('SELECT * FROM busy_routine ORDER BY id')).toEqual(before);
    expect(await rowsOf(r.routine.id)).toHaveLength(15);
  });

  it('rate limit ต่อคำขอ: 20 คำขอ/10 นาที (รวม POST/PATCH/DELETE) → ครั้งที่ 21 = 429 + Retry-After', async () => {
    h.clock.set(NOW + 10 * 60_000 - (NOW % (10 * 60_000)));
    for (let i = 0; i < 20; i++) expect((await del(a.c, `/api/me/busy-routines/${newId()}`)).status).toBe(404);
    const r = await del(a.c, `/api/me/busy-routines/${newId()}`);
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await create(a)).status).toBe(429);
    expect((await create(b)).status).toBe(201); // ต่อผู้ใช้
  });
});

describe('R14-4 — แก้/ลบ 3 ขอบเขต', () => {
  it('ลบวันเดียว (DELETE /api/me/busy/:id) → แถวหาย + skip · แก้ทั้งชุดทีหลังไม่ฟื้นวันนั้น', async () => {
    const r = await mustCreate(a);
    const rows = await rowsOf(r.routine.id);
    const d = await del<{ deleted: true; count: number }>(a.c, `/api/me/busy/${rows[2]!.id}`);
    expect([d.status, d.data.count]).toEqual([200, 1]);
    expect(await skipsOf(r.routine.id)).toEqual(['2026-11-18']);
    const u = await patch<Updated>(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ startTime: '10:00', endTime: '19:00' }));
    expect(u.status).toBe(200);
    expect(u.data).toMatchObject({ previous: null, count: 9 });
    expect(await datesOf(r.routine.id)).not.toContain('2026-11-18');
    expect((await rowsOf(r.routine.id)).every((x) => x.start_at % DAY === bkk(2026, 11, 16, 10) % DAY)).toBe(true);
  });

  it('DELETE ?scope=series บนแถว routine = ลบแค่วันนั้น (ไม่ลบทั้ง routine) + skip', async () => {
    const r = await mustCreate(a);
    const rows = await rowsOf(r.routine.id);
    const d = await del<{ count: number }>(a.c, `/api/me/busy/${rows[0]!.id}?scope=series`);
    expect([d.status, d.data.count]).toEqual([200, 1]);
    expect(await rowsOf(r.routine.id)).toHaveLength(9);
    expect(await skipsOf(r.routine.id)).toEqual(['2026-11-16']);
  });

  it('แก้วันเดียว (PATCH /api/me/busy/:id) → หลุดเป็น busy เดี่ยว + skip · แก้ทั้งชุดทีหลังไม่แตะวันนั้นและไม่สร้างซ้ำ', async () => {
    const r = await mustCreate(a);
    const rows = await rowsOf(r.routine.id);
    const p = await patch<{ busy: OwnBusy }>(a.c, `/api/me/busy/${rows[1]!.id}`, { kind: 'timed', startDate: '2026-11-17', startTime: '13:00', endDate: '2026-11-17', endTime: '15:00' });
    expect(p.status).toBe(200);
    expect(p.data.busy).toMatchObject({ routineId: null, startAt: bkk(2026, 11, 17, 13) });
    await patch(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ title: 'ใหม่' }));
    expect(await datesOf(r.routine.id)).not.toContain('2026-11-17');
    const detached = await h.rows<Row>('SELECT * FROM busy_block WHERE id = ?', [rows[1]!.id]);
    expect(detached[0]).toMatchObject({ routine_id: null, start_at: bkk(2026, 11, 17, 13), title: null });
  });

  it('แก้ "ทั้งหมด" (ไม่ส่ง from) หลังผ่านไปหนึ่งสัปดาห์: วันในอดีตไม่ถูกแตะ · วันนี้เป็นต้นไปเป็นเวลาใหม่', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-09', toWeek: '2026-11-23' });
    const before = await rowsOf(r.routine.id);
    expect(before.map((x) => x.local_start_date)[0]).toBe('2026-11-11');
    h.clock.set(bkk(2026, 11, 18, 12)); // พุธถัดไป
    const u = await patch<Updated>(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ fromWeek: '2026-11-09', toWeek: '2026-11-23', startTime: '08:00', endTime: '12:00' }));
    expect(u.status).toBe(200);
    expect(u.data.previous).toBeNull();
    expect(u.data.routine).toMatchObject({ id: r.routine.id, startTime: '08:00', endTime: '12:00', startDate: '2026-11-09', endDate: '2026-11-29' });
    const after = await rowsOf(r.routine.id);
    const past = after.filter((x) => x.local_start_date < '2026-11-18');
    expect(past).toEqual(before.filter((x) => x.local_start_date < '2026-11-18')); // ไบต์เดิม
    const fut = after.filter((x) => x.local_start_date >= '2026-11-18');
    expect(fut.map((x) => x.local_start_date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    expect(fut[0]).toMatchObject({ start_at: bkk(2026, 11, 18, 8), end_at: bkk(2026, 11, 18, 12) });
    expect(u.data.count).toBe(8);
  });

  it('แก้ "ตั้งแต่สัปดาห์ที่ 3" (from ในอนาคต) → แยกสองชุด · ชุดเดิมจบ from−1 · ชุดใหม่เริ่ม from · skip ≥ from ย้ายไปชุดใหม่ · ก่อน from ไม่ถูกแตะ', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-16', toWeek: '2026-12-07' }); // 16 พ.ย. – 13 ธ.ค. = 20 วัน
    const rows = await rowsOf(r.routine.id);
    await del(a.c, `/api/me/busy/${rows.find((x) => x.local_start_date === '2026-12-02')!.id}`); // skip สัปดาห์ที่ 3
    await del(a.c, `/api/me/busy/${rows.find((x) => x.local_start_date === '2026-11-17')!.id}`); // skip สัปดาห์ที่ 1
    const beforeFrom = (await rowsOf(r.routine.id)).filter((x) => x.local_start_date < '2026-11-30');
    const u = await patch<Updated>(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ fromWeek: '2026-11-16', toWeek: '2026-12-07', weekdays: [1, 3, 5], startTime: '17:00', endTime: '19:00', from: '2026-12-02' }));
    expect(u.status, JSON.stringify(u.json)).toBe(200);
    const { routine: r2, previous } = u.data;
    expect(previous).toMatchObject({ id: r.routine.id, startDate: '2026-11-16', endDate: '2026-11-29', startTime: '09:00', weekdays: [1, 2, 3, 4, 5], remaining: 9 });
    expect(r2.id).not.toBe(r.routine.id);
    expect(r2).toMatchObject({ startDate: '2026-11-30', endDate: '2026-12-13', weekdays: [1, 3, 5], startTime: '17:00', endTime: '19:00' });
    expect(await rowsOf(r.routine.id)).toEqual(beforeFrom);
    expect(await datesOf(r2.id)).toEqual(['2026-11-30', '2026-12-04', '2026-12-07', '2026-12-09', '2026-12-11']); // 2 ธ.ค. ถูก skip
    expect(await skipsOf(r.routine.id)).toEqual(['2026-11-17']);
    expect(await skipsOf(r2.id)).toEqual(['2026-12-02']);
    const list = await get<{ routines: RoutineView[] }>(a.c, '/api/me/busy-routines');
    expect(list.data.routines.map((x) => [x.id, x.startDate, x.endDate])).toEqual([
      [r.routine.id, '2026-11-16', '2026-11-29'],
      [r2.id, '2026-11-30', '2026-12-13'],
    ]);
  });

  it('from ≤ วันนี้ (สัปดาห์นี้) = แก้ในที่ (ไม่แยก) · from หลังวันจบ = INVALID_RANGE from', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-09', toWeek: '2026-11-16' });
    const u = await patch<Updated>(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ fromWeek: '2026-11-09', toWeek: '2026-11-16', from: '2026-11-12', weekdays: [4] }));
    expect([u.status, u.data.previous, u.data.routine.id]).toEqual([200, null, r.routine.id]);
    expect(await datesOf(r.routine.id)).toEqual(['2026-11-12', '2026-11-19']);
    const bad = await patch(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ fromWeek: '2026-11-09', toWeek: '2026-11-16', from: '2026-12-07' }));
    expect([bad.status, bad.code, bad.json.error!.params]).toEqual([400, 'INVALID_RANGE', { field: 'from', kind: 'dates' }]);
    const badFmt = await patch(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ from: 'next week' }));
    expect([badFmt.status, badFmt.json.error!.params]).toEqual([400, { fields: { from: 'INVALID' } }]);
  });

  it('ต่ออายุ: แก้ toWeek ให้ยาวขึ้น → ขยายเพิ่ม · เกิน 26 สัปดาห์จากช่วงที่จะเก็บ = routineSpan', async () => {
    const r = await mustCreate(a, { toWeek: '2026-11-16' });
    const u = await patch<Updated>(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ toWeek: '2026-11-30' }));
    expect([u.status, u.data.count, u.data.routine.endDate]).toEqual([200, 15, '2026-12-06']);
    const long = await patch(a.c, `/api/me/busy-routines/${r.routine.id}`, body({ toWeek: '2027-05-17' }));
    expect([long.status, long.json.error!.params]).toEqual([400, { field: 'toWeek', limit: 'routineSpan', max: 26, rangeKind: 'weeks' }]);
  });

  it('หยุดตั้งแต่ (DELETE ?from=สัปดาห์หน้า) → end_date = from−1 · แถว ≥ from หาย · ก่อนหน้าคงเดิม', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-09', toWeek: '2026-11-23' });
    const d = await del<{ deleted: true; scope: string; count: number }>(a.c, `/api/me/busy-routines/${r.routine.id}?from=2026-11-25`);
    expect(d.status).toBe(200);
    expect(d.data).toEqual({ deleted: true, scope: 'from', count: 5 });
    expect(await datesOf(r.routine.id)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
    expect((await h.rows('SELECT end_date FROM busy_routine WHERE id = ?', [r.routine.id]))[0]).toEqual({ end_date: '2026-11-22' });
  });

  it('หยุดตั้งแต่สัปดาห์นี้ (from ≤ วันนี้) → ตัดที่วันนี้ · วันที่ผ่านมาแล้วของสัปดาห์นี้คงเดิม · ชุดจบแล้วไม่นับเพดาน 10', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-09', toWeek: '2026-11-23' });
    h.clock.set(bkk(2026, 11, 18, 12));
    const d = await del<{ scope: string; count: number }>(a.c, `/api/me/busy-routines/${r.routine.id}?from=2026-11-16`);
    expect(d.data).toMatchObject({ scope: 'from', count: 8 });
    expect(await datesOf(r.routine.id)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17']);
    expect((await h.rows('SELECT end_date FROM busy_routine WHERE id = ?', [r.routine.id]))[0]).toEqual({ end_date: '2026-11-17' });
    const list = await get<{ routines: RoutineView[] }>(a.c, '/api/me/busy-routines');
    expect(list.data.routines[0]).toMatchObject({ id: r.routine.id, remaining: 0 });
  });

  it('ลบทั้งหมด (ไม่ส่ง from) → กฎ + ทุกวันรวมอดีต + skip หาย · ซ้ำ = 404', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-09' });
    await del(a.c, `/api/me/busy/${(await rowsOf(r.routine.id))[0]!.id}`);
    h.clock.set(bkk(2026, 11, 18, 12));
    const d = await del<{ scope: string; count: number }>(a.c, `/api/me/busy-routines/${r.routine.id}`);
    expect([d.status, d.data.scope, d.data.count]).toEqual([200, 'all', 12]);
    expect(await h.count('busy_routine WHERE id = ?', [r.routine.id])).toBe(0);
    expect(await h.count('busy_block WHERE routine_id = ?', [r.routine.id])).toBe(0);
    expect(await h.count('busy_routine_skip WHERE routine_id = ?', [r.routine.id])).toBe(0);
    expect((await del(a.c, `/api/me/busy-routines/${r.routine.id}`)).status).toBe(404);
    const q = await del(a.c, `/api/me/busy-routines/${r.routine.id}?bogus=1`);
    expect([q.status, q.json.error!.params]).toEqual([400, { fields: { from: 'INVALID' } }]);
  });

  it('หยุดตั้งแต่วันแรกของชุด (ยังไม่เริ่ม) = ลบทั้งหมด', async () => {
    const r = await mustCreate(a);
    const d = await del<{ scope: string; count: number }>(a.c, `/api/me/busy-routines/${r.routine.id}?from=2026-11-18`);
    expect(d.data).toEqual({ deleted: true, scope: 'all', count: 10 });
    expect(await h.count('busy_routine')).toBe(0);
  });
});

describe('R14a review fixes (security M1, M2, L1, Info 2 · R14_CONTRACT §10)', () => {
  const ten = async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await mustCreate(a, { weekdays: [1], fromWeek: '2026-11-16', toWeek: '2026-12-21' })).routine.id);
    h.clock.advance(10 * 60_000); // ข้าม rate limit 20/10 นาที
    return ids;
  };

  it('M1 วงของ security: แยก → แก้ในที่ให้เหลือ 0 วัน = 400 NO_OCCURRENCE (วงหยุดที่ขั้นนี้) · ชุดเดิมไม่เปลี่ยน', async () => {
    const [r0] = await ten();
    const split = await patch<Updated>(a.c, '/api/me/busy-routines/' + r0, body({ weekdays: [1], fromWeek: '2026-11-16', toWeek: '2026-12-21', from: '2026-11-23' }));
    expect(split.status).toBe(200);
    const n = split.data.routine.id;
    const before = await h.rows('SELECT * FROM busy_routine WHERE id = ?', [n]);
    // ขั้น 3 ของ probe: แก้ชุด N ในที่เป็นสัปดาห์ 9 พ.ย. (จันทร์ผ่านแล้ว) → 0 วันในอนาคต แต่ end_date 15 พ.ย. ≥ วันนี้
    const shrink = await patch(a.c, '/api/me/busy-routines/' + n, body({ weekdays: [1], fromWeek: '2026-11-09', toWeek: '2026-11-09' }));
    expect([shrink.status, shrink.code, shrink.json.error!.params]).toEqual([400, 'VALIDATION', { fields: { weekdays: 'NO_OCCURRENCE' } }]);
    expect(await h.rows('SELECT * FROM busy_routine WHERE id = ?', [n])).toEqual(before);
    expect(await datesOf(n)).toEqual(['2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
  });

  it('M1 เพดานแข็ง 20: ครบ 10 → แยกได้อีก 10 ครั้ง (B12) → ครั้งที่ 11 = 409 {routines, max 20} ไม่เปลี่ยนอะไร · สร้างใหม่ = 409 {routines, max 10} · GET คืนครบ 20 ชุด', async () => {
    const ids = await ten();
    for (let i = 0; i < 10; i++) {
      const s = await patch(a.c, '/api/me/busy-routines/' + ids[i], body({ weekdays: [1], fromWeek: '2026-11-16', toWeek: '2026-12-21', from: '2026-11-30' }));
      expect(s.status, 'split ' + i + ' ' + JSON.stringify(s.json)).toBe(200);
    }
    h.clock.advance(10 * 60_000);
    expect(await h.count("busy_routine WHERE user_id = ? AND end_date >= '2026-11-11'", [a.id])).toBe(20);
    const snap = async () => [await h.rows('SELECT * FROM busy_routine ORDER BY id'), await h.rows('SELECT id, routine_id FROM busy_block ORDER BY id')];
    const before = await snap();
    const over = await patch(a.c, '/api/me/busy-routines/' + ids[0], body({ weekdays: [1], fromWeek: '2026-11-16', toWeek: '2026-11-29', from: '2026-11-23' }));
    expect([over.status, over.code, over.json.error!.params]).toEqual([409, 'LIMIT_REACHED', { limit: 'routines', max: 20 }]);
    expect(await snap()).toEqual(before);
    const create11 = await create(a, { weekdays: [2], toWeek: '2026-11-16' });
    expect([create11.status, create11.json.error!.params]).toEqual([409, { limit: 'routines', max: 10 }]);
    const list = await get<{ routines: RoutineView[]; truncated: boolean }>(a.c, '/api/me/busy-routines');
    expect([list.data.routines.length, list.data.truncated]).toEqual([20, false]);
  });

  it('GET: ชุดที่จบแล้วคืนสูงสุด 50 (ใหม่สุดก่อน) + truncated · ชุดที่ยังไม่จบคืนครบเสมอ', async () => {
    await mustCreate(a);
    const vals: string[] = [];
    const args: (string | number)[] = [];
    for (let i = 0; i < 55; i++) {
      vals.push("(?, ?, 0, 1, 540, 600, 'weeks', '2026-08-03', ?, 1, 1)");
      args.push(newId(), a.id, '2026-08-' + String(10 + (i % 19)).padStart(2, '0'));
    }
    await h.rows('INSERT INTO busy_routine (id, user_id, all_day, weekdays, start_min, end_min, range_kind, start_date, end_date, created_at, updated_at) VALUES ' + vals.join(','), args);
    const list = await get<{ routines: RoutineView[]; truncated: boolean }>(a.c, '/api/me/busy-routines');
    expect([list.data.routines.length, list.data.truncated]).toEqual([51, true]);
    expect(list.data.routines[0]!.endDate).toBe('2026-11-29'); // ที่ยังไม่จบมาก่อน
    expect(list.data.routines[1]!.endDate).toBe('2026-08-28'); // จบแล้ว ใหม่สุดก่อน
  });

  it('Info 2: PATCH ส่ง tz ใหม่ (Etc/GMT+12 = ยังเป็น 10 พ.ย.) ไม่ลบแถวเมื่อวานของ tz เดิม และไม่สร้างซ้ำ', async () => {
    h.clock.set(bkk(2026, 11, 10, 10));
    const r = await mustCreate(a, { weekdays: [1, 2, 3, 4, 5, 6, 7], fromWeek: '2026-11-09', toWeek: '2026-11-09' });
    const yesterday = (await rowsOf(r.routine.id)).find((x) => x.local_start_date === '2026-11-10')!;
    h.clock.set(NOW); // 11 พ.ย. 10:00 เวลาไทย = 10 พ.ย. 15:00 ที่ UTC−12
    const u = await patch(a.c, '/api/me/busy-routines/' + r.routine.id, body({ weekdays: [1, 2, 3, 4, 5, 6, 7], fromWeek: '2026-11-09', toWeek: '2026-11-09', tz: 'Etc/GMT+12' }));
    expect(u.status, JSON.stringify(u.json)).toBe(200);
    const rows = await rowsOf(r.routine.id);
    expect(rows.filter((x) => x.local_start_date === '2026-11-10')).toEqual([yesterday]);
    expect(rows.map((x) => x.local_start_date)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  });

  it('L1: หยุดตั้งแต่ / ลบทั้งหมด ตรวจบัญชี active ในคำสั่งเดียวกับการเขียน (เรียก repo ตรงหลังระงับบัญชี → ไม่มีอะไรเปลี่ยน)', async () => {
    const { deleteOwnRoutine, setOwnRoutineEndGuarded } = await import('@/lib/data/repos/busy-routine');
    const r = await mustCreate(a);
    const [rule] = await h.rows<{ updated_at: number }>('SELECT updated_at FROM busy_routine WHERE id = ?', [r.routine.id]);
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [a.id]);
    const res = await h.db.transaction(async (tx) => [
      await setOwnRoutineEndGuarded(tx, { id: r.routine.id, userId: a.id, expectedUpdatedAt: rule!.updated_at, endDate: '2026-11-22' }, NOW),
      await deleteOwnRoutine(tx, r.routine.id, a.id),
    ]);
    expect(res).toEqual([null, null]);
    expect(await h.count('busy_routine WHERE id = ? AND end_date = ?', [r.routine.id, '2026-11-29'])).toBe(1);
    expect(await rowsOf(r.routine.id)).toHaveLength(10);
  });

  it('M2: availability ที่มีชิ้นถูกอ้าง > 5,000 → busy[] ส่ง 5,000 + detailTruncated true · วันว่างยังถูก (truncated false, คนนั้นไม่ว่าง) · ปกติ detailTruncated false', async () => {
    const gid = await makeGroup(a);
    await join(a, b, gid);
    const t0 = bkk(2026, 11, 20, 9);
    for (let i = 0; i < 5001; i += 500) {
      const vals: string[] = [];
      const args: (string | number)[] = [];
      for (let j = i; j < Math.min(5001, i + 500); j++) {
        vals.push("(?, ?, NULL, NULL, 0, ?, ?, '2026-11-20', '2026-11-20', 'Asia/Bangkok', 0, 1, 1)");
        args.push(newId(), a.id, t0 + j * 5_000, t0 + j * 5_000 + 2_500); // 5001 × 5 วินาที ≈ 7 ชม. อยู่ในหน้าต่าง 08–22
      }
      await h.rows('INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ' + vals.join(','), args);
    }
    type Av = { busy: unknown[]; truncated: boolean; detailTruncated: boolean; days: { date: string; segments: unknown[]; blockers: { userId: string; itemIdx: number[] }[] }[] };
    const r = await get<Av>(b.c, '/api/groups/' + gid + '/availability?from=2026-11-20&to=2026-11-20');
    expect(r.status).toBe(200);
    expect([r.data.truncated, r.data.detailTruncated, r.data.busy.length]).toEqual([false, true, 5000]);
    const day = r.data.days[0]!;
    // แถวที่ 5,001 (ไม่ถูกส่ง) ยังถูกนับ: ช่วงว่างเริ่มตรงปลายของแถวนั้นพอดี
    expect((day.segments as { startAt: number; end: string }[]).map((x) => [x.startAt, x.end])).toEqual([[t0 + 5000 * 5_000 + 2_500, '22:00']]);
    expect(day.blockers).toHaveLength(1);
    expect(day.blockers[0]!.itemIdx).toHaveLength(5000);
    expect(Math.max(...day.blockers[0]!.itemIdx)).toBe(4999);
    const ok = await get<Av>(b.c, '/api/groups/' + gid + '/availability?from=2026-11-21&to=2026-11-21');
    expect([ok.data.truncated, ok.data.detailTruncated]).toEqual([false, false]);
  });
});

describe('R14-5 — เจ้าของเท่านั้น', () => {
  it('คนอื่น / super admin: PATCH/DELETE routine ของ a = 404 · แก้/ลบวันของ a ผ่าน /api/me/busy/:id = 404 · ไม่มีอะไรเปลี่ยน (ไม่มี skip)', async () => {
    const root = await person(h, 'root', { admin: true });
    const r = await mustCreate(a);
    const [day] = await rowsOf(r.routine.id);
    const snap = async () => [await h.rows('SELECT * FROM busy_routine ORDER BY id'), await h.rows('SELECT * FROM busy_block ORDER BY id'), await h.rows('SELECT * FROM busy_routine_skip')];
    const before = await snap();
    for (const p of [b, root]) {
      expect((await patch(p.c, `/api/me/busy-routines/${r.routine.id}`, body({ title: 'แฮก' }))).status).toBe(404);
      expect((await patch(p.c, `/api/me/busy-routines/${r.routine.id}`, body({ title: 'แฮก', from: '2026-11-23' }))).status).toBe(404);
      expect((await del(p.c, `/api/me/busy-routines/${r.routine.id}`)).status).toBe(404);
      expect((await del(p.c, `/api/me/busy-routines/${r.routine.id}?from=2026-11-23`)).status).toBe(404);
      expect((await del(p.c, `/api/me/busy/${day!.id}`)).status).toBe(404);
      expect((await patch(p.c, `/api/me/busy/${day!.id}`, { title: 'แฮก' })).status).toBe(404);
      const list = await get<{ routines: RoutineView[] }>(p.c, '/api/me/busy-routines');
      expect(list.data.routines).toEqual([]);
    }
    expect(await snap()).toEqual(before);
  });

  it('ไม่ได้ล็อกอิน = 401 · บัญชีถูกระงับ = 401 · id ไม่ใช่ uuid = VALIDATION', async () => {
    const anon = new Client();
    expect((await get(anon, '/api/me/busy-routines')).status).toBe(401);
    expect((await post(anon, '/api/me/busy-routines', body())).status).toBe(401);
    const r = await mustCreate(a);
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [a.id]);
    expect((await get(a.c, '/api/me/busy-routines')).status).toBe(401);
    expect((await del(a.c, `/api/me/busy-routines/${r.routine.id}`)).status).toBe(401);
    await h.rows("UPDATE user SET status = 'active' WHERE id = ?", [a.id]);
    const bad = await del(b.c, '/api/me/busy-routines/not-a-uuid');
    expect([bad.status, bad.code]).toEqual([400, 'VALIDATION']);
    expect((await get(b.c, '/api/me/busy-routines?x=1')).code).toBe('VALIDATION');
  });
});

describe('R14-5 / ADR 0012 §7 — ไม่รั่วถึงคนอื่น (canary แบบ ADR 0006 test 9)', () => {
  it('ปฏิทิน / วันว่าง / เตือนนัดทับ ของ b ไม่มี routineId, weekdays, rangeKind, note · ซ่อน → ไม่มี title · key ของ busy = BUSY_SHARED_FIELDS', async () => {
    const gid = await makeGroup(a);
    await join(a, b, gid);
    const CT = `CANARY-T-${rand()}`;
    const CH = `CANARY-H-${rand()}`;
    const CN = `CANARY-N-${rand()}`;
    const shown = await mustCreate(a, { title: CT, note: CN, hideDetail: false });
    const hidden = await mustCreate(a, { title: CH, note: CN, hideDetail: true, weekdays: [6, 7], allDay: true, startTime: undefined, endTime: undefined });
    const cal = await get<{ busy: Record<string, unknown>[] }>(b.c, `/api/groups/${gid}/calendar?from=2026-11-16&to=2026-11-29`);
    const av = await get<{ busy: Record<string, unknown>[]; days: { date: string; segments: { start: string; end: string }[]; notFreeUserIds: string[] }[] }>(
      b.c,
      `/api/groups/${gid}/availability?from=2026-11-16&to=2026-11-29`,
    );
    const chk = await post(b.c, `/api/groups/${gid}/appointments/check`, { startDate: '2026-11-16', startTime: '10:00', endDate: '2026-11-16', endTime: '11:00' });
    for (const res of [cal, av, chk]) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.json);
      for (const key of ['routineId', 'routine_id', 'weekdays', 'rangeKind', 'range_kind', 'note', 'seriesId', CN, CH, shown.routine.id, hidden.routine.id]) expect(text).not.toContain(key);
    }
    expect(cal.data.busy).toHaveLength(14);
    for (const item of cal.data.busy) {
      expect([...BUSY_SHARED_FIELDS]).toEqual(expect.arrayContaining(Object.keys(item)));
    }
    expect(cal.data.busy.filter((x) => x.title === CT)).toHaveLength(10);
    expect(cal.data.busy.filter((x) => 'title' in x)).toHaveLength(10);
    // R14-6: วันว่างร่วมถูกต้อง — จันทร์ 16: a ติด 09–18 → ช่วงว่างร่วมเหลือ 08–09 / 18–22 (หน้าต่างกลุ่ม 08–22) · เสาร์ 21: a ติดทั้งวัน → ไม่มีช่วง
    const mon = av.data.days.find((d) => d.date === '2026-11-16')!;
    expect(mon.segments.map((s) => [s.start, s.end])).toEqual([['18:00', '22:00']]); // 08–09 สั้นกว่าขั้นต่ำ 4 ชม.
    const sat = av.data.days.find((d) => d.date === '2026-11-21')!;
    expect([sat.segments, sat.notFreeUserIds]).toEqual([[], [a.id]]);
  });

  it('.toSQL() ของคิวรีฝั่งแชร์ไม่มี routine_id · ตารางกฎไม่ถูกอ่านเลย', () => {
    const q = sharedBusyInGroupQuery(h.db, newId(), 0, 1, 10).toSQL();
    expect(q.sql).not.toMatch(/routine/i);
    expect(q.sql).not.toMatch(/series_id/i);
  });

  it('เจ้าของ: GET /api/me/busy?from&to มี routineId · GET /api/me/busy (ไม่มีช่วง) ไม่รวมวันของ routine แต่รวมวันที่แยกออกแล้ว', async () => {
    const r = await mustCreate(a);
    await post(a.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-12-01', endDate: '2026-12-01' });
    const range = await get<{ busy: OwnBusy[] }>(a.c, '/api/me/busy?from=2026-11-16&to=2026-12-01');
    expect(range.data.busy).toHaveLength(11);
    expect(range.data.busy.filter((x) => x.routineId === r.routine.id)).toHaveLength(10);
    const list = await get<{ busy: OwnBusy[] }>(a.c, '/api/me/busy');
    expect(list.data.busy.map((x) => x.localStartDate)).toEqual(['2026-12-01']);
    const [day] = await rowsOf(r.routine.id);
    await patch(a.c, `/api/me/busy/${day!.id}`, { title: 'แยก' });
    const list2 = await get<{ busy: OwnBusy[] }>(a.c, '/api/me/busy');
    expect(list2.data.busy.map((x) => [x.localStartDate, x.routineId])).toEqual([
      ['2026-11-16', null],
      ['2026-12-01', null],
    ]);
  });
});

describe('R14-7 — ลบบัญชี / cron', () => {
  it('ลบบัญชี → กฎ routine + ทุกแถว + skip หาย', async () => {
    const r = await mustCreate(a);
    await del(a.c, `/api/me/busy/${(await rowsOf(r.routine.id))[0]!.id}`);
    const res = await post(a.c, '/api/me/delete', { pin: GOOD_PIN });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(await h.count('busy_routine WHERE user_id = ?', [a.id])).toBe(0);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(0);
    expect(await h.count('busy_routine_skip')).toBe(0);
  });

  it('cron รายวันลบกฎที่จบเกิน 93 วัน (90 + เผื่อ 3) · แถวของกฎนั้นหมดอายุไปก่อนแล้ว ไม่เหลือแถวกำพร้า · กฎที่ยังไม่ถึงคงอยู่', async () => {
    const old = await mustCreate(a, { toWeek: '2026-11-16' }); // จบ 2026-11-22
    const keep = await mustCreate(a, { fromWeek: '2026-11-23', toWeek: '2026-11-23' }); // จบ 2026-11-29
    // 2027-02-24 → cutoff = 2027-02-24 − 93 = 2026-11-23 → กฎที่ end_date < 23 พ.ย. ถูกลบ
    h.clock.set(bkk(2027, 2, 24, 10));
    const res = await call<{ cleaned: Record<string, number> }>(new Client(), 'GET', '/api/cron/daily', undefined, {
      headers: { authorization: `Bearer ${h.t.env.CRON_SECRET}` },
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.data.cleaned.oldBusyRoutines).toBe(1);
    expect(await h.count('busy_routine WHERE id = ?', [old.routine.id])).toBe(0);
    expect(await h.count('busy_block WHERE routine_id = ?', [old.routine.id])).toBe(0);
    expect(await h.count('busy_routine WHERE id = ?', [keep.routine.id])).toBe(1);
    expect(await h.count('busy_block WHERE routine_id IS NOT NULL AND routine_id NOT IN (SELECT id FROM busy_routine)')).toBe(0);
  });
});
