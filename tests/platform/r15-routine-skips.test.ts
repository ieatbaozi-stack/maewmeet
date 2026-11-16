// R15a Platform — POST /api/me/busy-routines/:id/skips (ADR 0012 §13) + GET skippedDates · R15-2
// เว้นหลายวันครั้งเดียว · คืนได้ (ตามกฎปัจจุบัน) · ไม่ฟื้นเมื่อแก้ทั้งชุด · เจ้าของเท่านั้น · ทั้งหมดหรือไม่มีเลย · rate limit busy:routine นับคำขอที่ล้ม
// route handler จริงผ่าน Request/Response บน libSQL จริง + migration จริง + นาฬิกา inject · now = 2026-11-11 (พุธ) 10:00 Asia/Bangkok
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTINE_OWN_FIELDS } from '@/lib/data/serializers/busy-routine';
import { newId } from '@/lib/shared/id';
import { BUSY_ROUTINE_RATE_LIMIT } from '@/lib/shared/limits';
import { Client, del, get, join, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

const NOW = Date.UTC(2026, 10, 11, 3);

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

type RoutineView = { id: string; remaining: number; skippedDates: string[]; startTime: string | null; endDate: string } & Record<string, unknown>;
type SkipRes = { routine: RoutineView; skipped: number; restored: number };
type Row = { id: string; local_start_date: string; local_end_date: string; start_at: number; end_at: number; routine_id: string | null; title: string | null };
type Err = { error?: { code: string; params?: Record<string, unknown> } };

/** จ.–ศ. 09:00–18:00 · สัปดาห์ 16 พ.ย. ถึงสัปดาห์ 23 พ.ย. (16–29 พ.ย.) = 10 วัน */
const body = (over: Record<string, unknown> = {}) => ({
  rangeKind: 'weeks',
  fromWeek: '2026-11-16',
  toWeek: '2026-11-23',
  weekdays: [1, 2, 3, 4, 5],
  allDay: false,
  startTime: '09:00',
  endTime: '18:00',
  title: 'ทำงาน',
  ...over,
});
async function mustCreate(p: Person, over: Record<string, unknown> = {}): Promise<RoutineView> {
  const r = await post<{ routine: RoutineView }>(p.c, '/api/me/busy-routines', body(over));
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.data.routine;
}
const skips = (p: Person, id: string, b2: unknown) => post<SkipRes>(p.c, `/api/me/busy-routines/${id}/skips`, b2);
async function mustSkip(p: Person, id: string, b2: unknown): Promise<SkipRes> {
  const r = await skips(p, id, b2);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.data;
}
const rowsOf = (routineId: string) => h.rows<Row>('SELECT * FROM busy_block WHERE routine_id = ? ORDER BY start_at, id', [routineId]);
const datesOf = async (routineId: string) => (await rowsOf(routineId)).map((r) => r.local_start_date);
const skipsOf = async (routineId: string) =>
  (await h.rows<{ local_date: string }>('SELECT local_date FROM busy_routine_skip WHERE routine_id = ? ORDER BY local_date', [routineId])).map((r) => r.local_date);
const bkk = (y: number, m: number, d: number, hh: number, mm = 0) => Date.UTC(y, m - 1, d, hh - 7, mm);
const resetRate = () => h.rows('DELETE FROM rate_limit_bucket');
const errOf = (r: { json: unknown }) => (r.json as Err).error;
const ALL10 = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'];
const without = (...xs: string[]) => ALL10.filter((d) => !xs.includes(d));

/** สถานะทั้งหมดที่ต้องไม่เปลี่ยนเมื่อคำขอถูกปฏิเสธ */
const stateOf = async (id: string) => ({ rows: await rowsOf(id), skips: await skipsOf(id), rule: await h.rows('SELECT * FROM busy_routine WHERE id = ?', [id]) });

describe('R15-2 — เว้นหลายวันในครั้งเดียว (T1)', () => {
  it('เว้น 18 และ 27 → 200 {skipped 2} · แถวสองวันนั้นหาย · GET skippedDates · ปฏิทิน/วันว่างของเพื่อนไม่เห็นสองวันนั้น · เพื่อนไม่เห็น skippedDates/routine เลย (canary)', async () => {
    const gid = await makeGroup(a);
    await join(a, b, gid);
    const r = await mustCreate(a);
    const notifBefore = await h.count('notification');
    const auditBefore = await h.count('audit_log');
    const res = await skips(a, r.id, { add: ['2026-11-27', '2026-11-18', '2026-11-18'] }); // ซ้ำในคำขอ = ตัดซ้ำ
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(Object.keys(res.data).sort()).toEqual(['restored', 'routine', 'skipped']);
    expect(Object.keys(res.data.routine).sort()).toEqual([...ROUTINE_OWN_FIELDS].sort());
    expect([res.data.skipped, res.data.restored, res.data.routine.remaining, res.data.routine.skippedDates]).toEqual([2, 0, 8, ['2026-11-18', '2026-11-27']]);
    expect(await datesOf(r.id)).toEqual(without('2026-11-18', '2026-11-27'));
    expect(await skipsOf(r.id)).toEqual(['2026-11-18', '2026-11-27']);

    const list = await get<{ routines: RoutineView[] }>(a.c, '/api/me/busy-routines');
    expect(list.data.routines.map((x) => [x.id, x.skippedDates, x.remaining])).toEqual([[r.id, ['2026-11-18', '2026-11-27'], 8]]);

    type Cal = { busy: { userId: string; localStartDate: string }[] };
    const cal = await get<Cal>(b.c, `/api/groups/${gid}/calendar?from=2026-11-16&to=2026-11-29`);
    expect(cal.status).toBe(200);
    expect(cal.data.busy.filter((x) => x.userId === a.id).map((x) => x.localStartDate)).toEqual(without('2026-11-18', '2026-11-27'));
    type Av = { days: { date: string; blockers: { userId: string }[] }[] };
    const av = await get<Av>(b.c, `/api/groups/${gid}/availability?from=2026-11-17&to=2026-11-18`);
    expect(av.data.days.map((d) => [d.date, d.blockers.some((x) => x.userId === a.id)])).toEqual([
      ['2026-11-17', true],
      ['2026-11-18', false],
    ]);
    // canary: ทุกทางที่เพื่อนเห็นไม่มีคำว่า skippedDates / routine id / วันที่เว้น
    const bRoutines = await get<{ routines: unknown[] }>(b.c, '/api/me/busy-routines');
    expect(bRoutines.data.routines).toEqual([]);
    for (const text of [JSON.stringify(cal.json), JSON.stringify(av.json), JSON.stringify(bRoutines.json)]) {
      expect(text).not.toContain('skippedDates');
      expect(text).not.toContain(r.id);
      expect(text).not.toContain('2026-11-27');
    }
    // ไม่ลง audit ไม่แจ้งเตือน (ADR 0012 §13.1)
    expect([await h.count('notification'), await h.count('audit_log')]).toEqual([notifBefore, auditBefore]);
  });

  it('เว้นซ้ำวันที่เว้นอยู่แล้ว = idempotent (skipped 0 ไม่เปลี่ยนอะไร) · เว้นวันนี้ได้ (วันนี้ยังไม่ผ่าน)', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-09' }); // 9–29 พ.ย. · วันนี้ = พุธ 11
    expect((await mustSkip(a, r.id, { add: ['2026-11-18'] })).skipped).toBe(1);
    const before = await stateOf(r.id);
    const again = await mustSkip(a, r.id, { add: ['2026-11-18'] });
    expect([again.skipped, again.restored]).toEqual([0, 0]);
    expect(await stateOf(r.id)).toEqual(before);
    const today = await mustSkip(a, r.id, { add: ['2026-11-11'] });
    expect([today.skipped, today.routine.skippedDates]).toEqual([1, ['2026-11-11', '2026-11-18']]);
    expect(await datesOf(r.id)).not.toContain('2026-11-11');
  });

  it('ข้ามเที่ยงคืน: เว้นวันเริ่ม = แถวที่ล้ำไปเช้าวันถัดไปหายด้วย · คืนแล้วได้ช่วงข้ามคืนเหมือนเดิม', async () => {
    const r = await mustCreate(a, { startTime: '22:00', endTime: '06:00' });
    const mon = (await rowsOf(r.id))[0]!;
    expect([mon.local_start_date, mon.local_end_date, mon.start_at, mon.end_at]).toEqual(['2026-11-16', '2026-11-17', bkk(2026, 11, 16, 22), bkk(2026, 11, 17, 6)]);
    await mustSkip(a, r.id, { add: ['2026-11-16'] });
    expect(await h.count('busy_block WHERE user_id = ? AND start_at < ? AND end_at > ?', [a.id, bkk(2026, 11, 17, 6), bkk(2026, 11, 17, 0)])).toBe(0);
    await mustSkip(a, r.id, { remove: ['2026-11-16'] });
    const back = (await rowsOf(r.id))[0]!;
    expect([back.local_start_date, back.local_end_date, back.start_at, back.end_at]).toEqual(['2026-11-16', '2026-11-17', bkk(2026, 11, 16, 22), bkk(2026, 11, 17, 6)]);
  });
});

describe('R15-2 — คืน (remove)', () => {
  it('คืนวันที่เว้น → แถวกลับมาตามกฎ (restored 1) · คืนวันที่ไม่ได้เว้น = restored 0 ไม่มีแถวซ้ำ · เว้นและคืนในคำขอเดียวต่างวันกันได้', async () => {
    const r = await mustCreate(a);
    await mustSkip(a, r.id, { add: ['2026-11-18', '2026-11-27'] });
    const back = await mustSkip(a, r.id, { remove: ['2026-11-18'] });
    expect([back.skipped, back.restored, back.routine.remaining, back.routine.skippedDates]).toEqual([0, 1, 9, ['2026-11-27']]);
    const row = (await rowsOf(r.id)).find((x) => x.local_start_date === '2026-11-18')!;
    expect([row.start_at, row.end_at, row.title]).toEqual([bkk(2026, 11, 18, 9), bkk(2026, 11, 18, 18), 'ทำงาน']);
    const noop = await mustSkip(a, r.id, { remove: ['2026-11-19'] });
    expect(noop.restored).toBe(0);
    expect((await datesOf(r.id)).filter((d) => d === '2026-11-19')).toHaveLength(1);
    const mixed = await mustSkip(a, r.id, { add: ['2026-11-20'], remove: ['2026-11-27'] });
    expect([mixed.skipped, mixed.restored, mixed.routine.skippedDates]).toEqual([1, 1, ['2026-11-20']]);
    expect(await datesOf(r.id)).toEqual(without('2026-11-20'));
  });

  it('แก้ทั้งชุดหลังเว้น = วันที่เว้นไม่ฟื้น · คืนทีหลังได้แถวตามกฎใหม่ (เวลาใหม่/ชื่อใหม่)', async () => {
    const r = await mustCreate(a);
    await mustSkip(a, r.id, { add: ['2026-11-27'] });
    const p = await patch(a.c, `/api/me/busy-routines/${r.id}`, body({ startTime: '10:00', endTime: '19:00', title: 'งานใหม่' }));
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    expect(await datesOf(r.id)).toEqual(without('2026-11-27'));
    const back = await mustSkip(a, r.id, { remove: ['2026-11-27'] });
    expect(back.restored).toBe(1);
    const row = (await rowsOf(r.id)).find((x) => x.local_start_date === '2026-11-27')!;
    expect([row.start_at, row.end_at, row.title]).toEqual([bkk(2026, 11, 27, 10), bkk(2026, 11, 27, 19), 'งานใหม่']);
  });

  it('กฎเอาวันในสัปดาห์นั้นออกแล้ว → คืน = ลบ skip อย่างเดียว ไม่มีแถว (ไม่ใช่ error)', async () => {
    const r = await mustCreate(a);
    await mustSkip(a, r.id, { add: ['2026-11-18'] }); // พุธ
    expect((await patch(a.c, `/api/me/busy-routines/${r.id}`, body({ weekdays: [1, 2, 4, 5] }))).status).toBe(200);
    const back = await mustSkip(a, r.id, { remove: ['2026-11-18'] });
    expect([back.restored, back.routine.skippedDates]).toEqual([1, []]);
    expect(await datesOf(r.id)).not.toContain('2026-11-18');
    expect(await skipsOf(r.id)).toEqual([]);
  });

  it('วันที่แยกแก้เป็น busy เดี่ยว: add ไม่ลบแถวเดี่ยว · remove = คืน occurrence + แถวเดี่ยวคงอยู่ (สองแถว)', async () => {
    const r = await mustCreate(a);
    const day = (await rowsOf(r.id)).find((x) => x.local_start_date === '2026-11-17')!;
    expect((await patch(a.c, `/api/me/busy/${day.id}`, { title: 'แยก' })).status).toBe(200);
    expect(await skipsOf(r.id)).toEqual(['2026-11-17']);
    const single = await h.rows<Row>('SELECT * FROM busy_block WHERE id = ?', [day.id]);
    expect(single[0]!.routine_id).toBeNull();
    const add = await mustSkip(a, r.id, { add: ['2026-11-17'] });
    expect(add.skipped).toBe(0);
    expect(await h.count('busy_block WHERE id = ?', [day.id])).toBe(1);
    const rm = await mustSkip(a, r.id, { remove: ['2026-11-17'] });
    expect(rm.restored).toBe(1);
    expect(await h.count("busy_block WHERE user_id = ? AND local_start_date = '2026-11-17'", [a.id])).toBe(2);
    expect(await h.count('busy_block WHERE id = ? AND title = ?', [day.id, 'แยก'])).toBe(1);
  });

  it('แยกชุด (PATCH from > วันนี้): skip ย้ายไปชุดใหม่ · GET แสดงต่อชุด · สั่งผ่านชุดเดิม = OUT_OF_RANGE', async () => {
    const r = await mustCreate(a);
    await mustSkip(a, r.id, { add: ['2026-11-17', '2026-11-27'] });
    const p = await patch<{ routine: RoutineView; previous: RoutineView }>(a.c, `/api/me/busy-routines/${r.id}`, body({ from: '2026-11-23', startTime: '13:00' }));
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    expect(p.data.previous.skippedDates).toEqual(['2026-11-17']);
    expect(p.data.routine.skippedDates).toEqual(['2026-11-27']);
    const list = await get<{ routines: RoutineView[] }>(a.c, '/api/me/busy-routines');
    expect(Object.fromEntries(list.data.routines.map((x) => [x.id, x.skippedDates]))).toEqual({ [r.id]: ['2026-11-17'], [p.data.routine.id]: ['2026-11-27'] });
    const viaOld = await skips(a, r.id, { remove: ['2026-11-27'] });
    expect([viaOld.status, errOf(viaOld)]).toEqual([400, { code: 'VALIDATION', params: { fields: { dates: { '2026-11-27': 'OUT_OF_RANGE' } } } }]);
    const viaNew = await mustSkip(a, p.data.routine.id, { remove: ['2026-11-27'] });
    expect(viaNew.restored).toBe(1);
    const row = (await rowsOf(p.data.routine.id)).find((x) => x.local_start_date === '2026-11-27')!;
    expect(row.start_at).toBe(bkk(2026, 11, 27, 13));
  });
});

describe('R15-2 — ตรวจค่า: ทั้งหมดหรือไม่มีเลย (VALIDATION / LIMIT_REACHED ไม่เปลี่ยนอะไร)', () => {
  it('อดีต / นอกช่วง / ไม่ตรงวันในสัปดาห์ / ปนกับวันที่ถูก → VALIDATION {dates: {<d>: CODE}} ทุกวันที่ผิด · ไม่เปลี่ยนอะไร', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-09' }); // 9–29 พ.ย. · วันนี้ 11
    await mustSkip(a, r.id, { add: ['2026-11-12'] });
    await resetRate();
    const before = await stateOf(r.id);
    const cases: [unknown, Record<string, string>][] = [
      [{ add: ['2026-11-10'] }, { '2026-11-10': 'PAST' }],
      [{ add: ['2026-12-01'] }, { '2026-12-01': 'OUT_OF_RANGE' }],
      [{ add: ['2026-11-08'] }, { '2026-11-08': 'PAST' }],
      [{ add: ['2026-11-21'] }, { '2026-11-21': 'NOT_IN_RULE' }],
      [{ add: ['2026-11-18', '2026-11-22'] }, { '2026-11-22': 'NOT_IN_RULE' }],
      [{ remove: ['2026-11-10'] }, { '2026-11-10': 'PAST' }],
      [{ remove: ['2026-11-30'] }, { '2026-11-30': 'OUT_OF_RANGE' }],
      [{ add: ['2026-11-19'], remove: ['2026-11-12', '2026-11-09'] }, { '2026-11-09': 'PAST' }],
    ];
    for (const [b2, dates] of cases) {
      const res = await skips(a, r.id, b2);
      expect([res.status, errOf(res)], JSON.stringify(b2)).toEqual([400, { code: 'VALIDATION', params: { fields: { dates } } }]);
    }
    expect(await stateOf(r.id)).toEqual(before);
  });

  it('รูปแบบ: ว่าง → dates REQUIRED · วันที่ผิด → add/remove INVALID (ไม่สะท้อนค่า) · วันเดียวกันทั้ง add และ remove → IN_BOTH · คีย์แปลก → UNKNOWN_FIELD · ไม่ใช่อาร์เรย์ → INVALID_TYPE', async () => {
    const r = await mustCreate(a);
    const before = await stateOf(r.id);
    const cases: [unknown, Record<string, unknown>][] = [
      [{}, { dates: 'REQUIRED' }],
      [{ add: [], remove: [] }, { dates: 'REQUIRED' }],
      [{ add: ['2026-02-30'] }, { add: 'INVALID' }],
      [{ add: ['2026-11-18'], remove: ['18/11/2026'] }, { remove: 'INVALID' }],
      [{ add: ['1999-11-18'] }, { add: 'INVALID' }],
      [{ add: ['2026-11-18', '2026-11-19'], remove: ['2026-11-19'] }, { dates: { '2026-11-19': 'IN_BOTH' } }],
      [{ add: ['2026-11-18'], userId: b.id }, { userId: 'UNKNOWN_FIELD' }],
      [{ add: '2026-11-18' }, { add: 'INVALID_TYPE' }],
    ];
    for (const [b2, fields] of cases) {
      const res = await skips(a, r.id, b2);
      expect([res.status, errOf(res)], JSON.stringify(b2)).toEqual([400, { code: 'VALIDATION', params: { fields } }]);
      expect(JSON.stringify(res.json)).not.toContain('18/11/2026');
    }
    expect(await stateOf(r.id)).toEqual(before);
  });

  it('เกิน 31 วัน (add ∪ remove หลังตัดซ้ำ) → 400 LIMIT_REACHED {limit: skipDays, max: 31} · 31 วันพอดีผ่าน · อาร์เรย์ > 64 → VALIDATION TOO_LARGE', async () => {
    const r = await mustCreate(a, { rangeKind: 'months', fromWeek: undefined, toWeek: undefined, fromMonth: '2026-12', toMonth: '2027-02', weekdays: [1, 2, 3, 4, 5, 6, 7] });
    const dec = Array.from({ length: 31 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
    const before = await stateOf(r.id);
    const over = await skips(a, r.id, { add: dec.slice(0, 20), remove: [...dec.slice(20), '2027-01-01'] });
    expect([over.status, errOf(over)]).toEqual([400, { code: 'LIMIT_REACHED', params: { limit: 'skipDays', max: 31 } }]);
    const over2 = await skips(a, r.id, { add: [...dec, '2027-01-01'] });
    expect([over2.status, errOf(over2)?.params]).toEqual([400, { limit: 'skipDays', max: 31 }]);
    expect(await stateOf(r.id)).toEqual(before);
    const dupes = await mustSkip(a, r.id, { add: [...dec, ...dec] }); // 62 รายการ ตัดซ้ำเหลือ 31
    expect([dupes.skipped, dupes.routine.skippedDates]).toEqual([31, dec]);
    const huge = await skips(a, r.id, { add: Array.from({ length: 65 }, () => '2027-01-04') });
    expect([huge.status, errOf(huge)]).toEqual([400, { code: 'VALIDATION', params: { fields: { add: 'TOO_LARGE' } } }]);
  });

  it('ชุดที่จบแล้ว → ทุกวันเป็น PAST/OUT_OF_RANGE → VALIDATION', async () => {
    const r = await mustCreate(a, { fromWeek: '2026-11-09', toWeek: '2026-11-09' }); // 9–15 พ.ย.
    h.clock.set(bkk(2026, 11, 17, 10));
    const res = await skips(a, r.id, { add: ['2026-11-13'], remove: ['2026-11-18'] });
    expect([res.status, errOf(res)]).toEqual([400, { code: 'VALIDATION', params: { fields: { dates: { '2026-11-13': 'PAST', '2026-11-18': 'OUT_OF_RANGE' } } } }]);
  });

  it('คืนจนแถว routine ในอนาคตเกิน 1,500 → LIMIT_REACHED routineRows · rollback ทั้งคำขอ (skip ที่ลบกลับคืน รวมส่วน add) · พอดี 1,500 ผ่าน', async () => {
    const r = await mustCreate(a);
    await mustSkip(a, r.id, { add: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'] }); // เหลือ 5 แถว
    // เติมแถว routine ปลอมในอนาคตให้รวม 1,498
    const rid = newId();
    await h.rows(
      "INSERT INTO busy_routine (id, user_id, all_day, weekdays, start_min, end_min, range_kind, start_date, end_date, created_at, updated_at) VALUES (?, ?, 0, 127, 0, 30, 'weeks', '2026-11-09', '2026-11-15', 1, 1)",
      [rid, a.id],
    );
    const base = Date.UTC(2027, 0, 1);
    for (let i = 0; i < 1493; i += 50) {
      const vals: string[] = [];
      const args: (string | number)[] = [];
      for (let j = i; j < Math.min(1493, i + 50); j++) {
        vals.push("(?, ?, ?, NULL, NULL, 0, ?, ?, '2027-01-01', '2027-01-01', 'Asia/Bangkok', 0, 1, 1)");
        args.push(newId(), a.id, rid, base + j * 60_000, base + j * 60_000 + 30_000);
      }
      await h.rows(
        `INSERT INTO busy_block (id, user_id, routine_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${vals.join(',')}`,
        args,
      );
    }
    expect(await h.count('busy_block WHERE user_id = ? AND routine_id IS NOT NULL AND end_at > ?', [a.id, NOW])).toBe(1498);
    const before = await stateOf(r.id);
    const res = await skips(a, r.id, { add: ['2026-11-27'], remove: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'] }); // −1 +4 = 1,501
    expect([res.status, errOf(res)]).toEqual([409, { code: 'LIMIT_REACHED', params: { limit: 'routineRows', max: 1500 } }]);
    expect(await stateOf(r.id)).toEqual(before);
    const ok = await mustSkip(a, r.id, { add: ['2026-11-27'], remove: ['2026-11-16', '2026-11-17', '2026-11-18'] }); // −1 +3 = 1,500
    expect([ok.skipped, ok.restored, ok.routine.skippedDates]).toEqual([1, 3, ['2026-11-19', '2026-11-20', '2026-11-27']]);
    expect(await h.count('busy_block WHERE user_id = ? AND routine_id IS NOT NULL AND end_at > ?', [a.id, NOW])).toBe(1500);
  });
});

describe('R15-2 — เจ้าของเท่านั้น · rate limit', () => {
  it('id ของคนอื่น / ไม่มี / super admin → 404 NOT_FOUND เหมือนกันทุกไบต์ · ไม่เปลี่ยนอะไร · anonymous 401', async () => {
    const root = await person(h, 'root', { admin: true });
    const r = await mustCreate(a);
    const before = await stateOf(r.id);
    const other = await skips(b, r.id, { add: ['2026-11-18'] });
    const none = await skips(a, newId(), { add: ['2026-11-18'] });
    const sa = await skips(root, r.id, { add: ['2026-11-18'] });
    for (const x of [other, none, sa]) expect([x.status, x.json]).toEqual([404, other.json]);
    expect(errOf(other)?.code).toBe('NOT_FOUND');
    // ค่าผิดบน id ของคนอื่นก็ยัง 404 ไม่บอกว่ากฎมีอยู่ (ตรวจวันกับกฎหลังผ่านด่านเจ้าของ)
    const otherBad = await skips(b, r.id, { add: ['2026-11-21'] });
    expect([otherBad.status, otherBad.json]).toEqual([404, other.json]);
    expect(await stateOf(r.id)).toEqual(before);
    const anon = await post(new Client(), `/api/me/busy-routines/${r.id}/skips`, { add: ['2026-11-18'] });
    expect(anon.status).toBe(401);
  });

  it('บัญชีถูกระงับระหว่างทาง → ไม่เปลี่ยนอะไร', async () => {
    const r = await mustCreate(a);
    const before = await stateOf(r.id);
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [a.id]);
    const res = await skips(a, r.id, { add: ['2026-11-18'] });
    expect(res.status).toBe(401);
    expect(await stateOf(r.id)).toEqual(before);
  });

  it(`rate limit busy:routine (${BUSY_ROUTINE_RATE_LIMIT.limit}/10 นาที) ใช้ร่วมกับ POST/PATCH/DELETE · คำขอที่ได้ 400/404 ก็นับ`, async () => {
    const r = await mustCreate(a);
    await resetRate();
    for (let i = 0; i < BUSY_ROUTINE_RATE_LIMIT.limit; i++) {
      const res = i % 3 === 0 ? await skips(a, newId(), { add: ['2026-11-18'] }) : i % 3 === 1 ? await skips(a, r.id, { add: ['2026-11-21'] }) : await skips(a, r.id, { add: ['2026-02-30'] });
      expect(res.status, String(i)).toBe(i % 3 === 0 ? 404 : 400);
    }
    const limited = await skips(a, r.id, { add: ['2026-11-18'] });
    expect([limited.status, errOf(limited)?.code]).toEqual([429, 'RATE_LIMITED']);
    const patchToo = await patch(a.c, `/api/me/busy-routines/${r.id}`, body());
    expect(patchToo.status).toBe(429);
    expect(await skipsOf(r.id)).toEqual([]);
    h.clock.advance(BUSY_ROUTINE_RATE_LIMIT.windowMs + 1);
    expect((await skips(a, r.id, { add: ['2026-11-18'] })).status).toBe(200);
  });
});

describe('R15-2 — พร้อมกัน', () => {
  it('เว้นต่างวันพร้อมกัน → ทั้งสองสำเร็จ · เว้นวันเดียวกันพร้อมกัน → skipped รวม 1 · คืนพร้อมกัน → แถวกลับมาแถวเดียว (ไม่ซ้ำ)', async () => {
    const r = await mustCreate(a);
    const [x, y] = await Promise.all([skips(a, r.id, { add: ['2026-11-18'] }), skips(a, r.id, { add: ['2026-11-19'] })]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(await skipsOf(r.id)).toEqual(['2026-11-18', '2026-11-19']);
    expect(await datesOf(r.id)).toEqual(without('2026-11-18', '2026-11-19'));

    const same = await Promise.all([skips(a, r.id, { add: ['2026-11-20'] }), skips(a, r.id, { add: ['2026-11-20'] }), skips(a, r.id, { add: ['2026-11-20'] })]);
    expect(same.map((s) => s.status)).toEqual([200, 200, 200]);
    expect(same.reduce((n, s) => n + s.data.skipped, 0)).toBe(1);

    const back = await Promise.all([skips(a, r.id, { remove: ['2026-11-18'] }), skips(a, r.id, { remove: ['2026-11-18'] }), skips(a, r.id, { add: ['2026-11-23'], remove: ['2026-11-18'] })]);
    expect(back.map((s) => s.status)).toEqual([200, 200, 200]);
    expect(back.reduce((n, s) => n + s.data.restored, 0)).toBe(1);
    expect((await datesOf(r.id)).filter((d) => d === '2026-11-18')).toHaveLength(1);
    expect(await skipsOf(r.id)).toEqual(['2026-11-19', '2026-11-20', '2026-11-23']);
  });

  it('เว้นพร้อมกับ PATCH แก้ทั้งชุด → ไม่มีวันที่เว้นฟื้น ไม่ว่าลำดับใด', async () => {
    const r = await mustCreate(a);
    const [s, p] = await Promise.all([skips(a, r.id, { add: ['2026-11-25'] }), patch(a.c, `/api/me/busy-routines/${r.id}`, body({ startTime: '08:00' }))]);
    expect([s.status, p.status]).toEqual([200, 200]);
    expect(await datesOf(r.id)).toEqual(without('2026-11-25'));
    expect(await skipsOf(r.id)).toEqual(['2026-11-25']);
  });
});

describe('GET /api/me/busy-routines — skippedDates', () => {
  it('เฉพาะวันที่ยังไม่ผ่าน (≥ วันนี้) · ชุดใหม่ = [] · ลบวันเดียว (DELETE /api/me/busy/:id) ก็นับเป็นวันเว้น · คืนได้', async () => {
    const r = await mustCreate(a);
    const fresh = await get<{ routines: RoutineView[] }>(a.c, '/api/me/busy-routines');
    expect(fresh.data.routines[0]!.skippedDates).toEqual([]);
    await mustSkip(a, r.id, { add: ['2026-11-16', '2026-11-24'] });
    const day = (await rowsOf(r.id)).find((x) => x.local_start_date === '2026-11-26')!;
    const d = await del(a.c, `/api/me/busy/${day.id}`);
    expect(d.status).toBe(200);
    h.clock.set(bkk(2026, 11, 20, 9));
    const later = await get<{ routines: RoutineView[] }>(a.c, '/api/me/busy-routines');
    expect(later.data.routines[0]!.skippedDates).toEqual(['2026-11-24', '2026-11-26']);
    expect(await skipsOf(r.id)).toEqual(['2026-11-16', '2026-11-24', '2026-11-26']); // แถวในฐานไม่ถูกลบ แค่ไม่ส่ง
    const back = await mustSkip(a, r.id, { remove: ['2026-11-26'] });
    expect([back.restored, back.routine.skippedDates]).toEqual([1, ['2026-11-24']]);
    const past = await skips(a, r.id, { remove: ['2026-11-16'] });
    expect([past.status, errOf(past)?.params]).toEqual([400, { fields: { dates: { '2026-11-16': 'PAST' } } }]);
  });
});
