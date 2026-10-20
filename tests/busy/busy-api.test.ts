// R3 Platform — busy ของฉัน: U7 (3 แบบ), ขอบเขตเวลา/DST, เพดาน 300 (แข่งกัน), IDOR, strict schema, สถานะบัญชี · R3-2, R3-3, R3-6
// เรียก route handler จริงผ่าน Request/Response บน libSQL จริง + migration จริง + นาฬิกา inject (tests/groups/harness)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { Client, del, get, patch, person, post, setupHarness, DAY, type Harness, type Person } from '../groups/harness';

let h: Harness;
let a: Person;
let b: Person;
beforeEach(async () => {
  h = await setupHarness(); // now = 2026-10-18 10:00 Asia/Bangkok
  a = await person(h, 'alice');
  b = await person(h, 'bob');
});
afterEach(async () => {
  await h.cleanup();
});

type Busy = {
  id: string;
  userId: string;
  allDay: boolean;
  startAt: number;
  endAt: number;
  localStartDate: string;
  localEndDate: string;
  tz: string;
  title: string | null;
  note: string | null;
  hidden: boolean;
};

const timed = (over: Record<string, unknown> = {}) => ({
  kind: 'timed',
  startDate: '2026-10-23',
  startTime: '18:00',
  endDate: '2026-10-23',
  endTime: '20:30',
  ...over,
});
const allDay = (over: Record<string, unknown> = {}) => ({ kind: 'all_day', startDate: '2026-10-24', endDate: '2026-10-24', ...over });

async function create(p: Person, body: unknown) {
  return post<{ busy: Busy }>(p.c, '/api/me/busy', body);
}

/** แทรก busy ตรง ๆ (เร็ว) — ช่วงที่ยังไม่สิ้นสุด (วันเดียว ตั้งแต่ 2027-01-01) */
async function seedActive(userId: string, n: number): Promise<void> {
  const base = Date.UTC(2027, 0, 1);
  for (let i = 0; i < n; i += 50) {
    const vals: string[] = [];
    const args: (string | number)[] = [];
    for (let j = i; j < Math.min(n, i + 50); j++) {
      vals.push("(?, ?, 'seed', NULL, 0, ?, ?, '2027-01-01', '2027-01-01', 'Asia/Bangkok', 0, 1, 1)");
      args.push(`seed-${userId}-${j}`, userId, base + j * 1800_000, base + j * 1800_000 + 1800_000);
    }
    await h.rows(
      `INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${vals.join(',')}`,
      args,
    );
  }
}

describe('U7 — สามแบบ', () => {
  it('ช่วงเวลา: เก็บ UTC + วันท้องถิ่น + tz ดีฟอลต์ Asia/Bangkok · 201 · เจ้าของเห็นครบ', async () => {
    const r = await create(a, timed({ title: 'ซ้อมวง', note: 'จดไว้คนเดียว', hideDetail: true }));
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.data.busy).toMatchObject({
      userId: a.id,
      allDay: false,
      startAt: Date.UTC(2026, 9, 23, 11, 0), // 18:00 BKK
      endAt: Date.UTC(2026, 9, 23, 13, 30),
      localStartDate: '2026-10-23',
      localEndDate: '2026-10-23',
      tz: 'Asia/Bangkok',
      title: 'ซ้อมวง',
      note: 'จดไว้คนเดียว',
      hidden: true,
    });
  });

  it('ทั้งวัน = วันเดียว · หลายวัน = รายการเดียว (end ≥ start) · ข้ามเดือน/ปี/ปีอธิกสุรทิน', async () => {
    const one = await create(a, allDay());
    expect(one.data.busy).toMatchObject({ allDay: true, localStartDate: '2026-10-24', localEndDate: '2026-10-24', startAt: Date.UTC(2026, 9, 23, 17, 0), endAt: Date.UTC(2026, 9, 24, 17, 0) });
    const multi = await create(a, allDay({ startDate: '2026-12-30', endDate: '2027-01-02' }));
    expect(multi.data.busy).toMatchObject({ localStartDate: '2026-12-30', localEndDate: '2027-01-02' });
    const leap = await create(a, allDay({ startDate: '2028-02-28', endDate: '2028-03-01' }));
    expect(leap.status).toBe(201);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(3);
  });

  it('ข้ามเที่ยงคืน: จบ 00:00 พอดีนับเป็นวันก่อนหน้า · จบ 00:30 ข้ามไปวันถัดไป', async () => {
    const exact = await create(a, timed({ startTime: '22:00', endDate: '2026-10-24', endTime: '00:00' }));
    expect(exact.data.busy).toMatchObject({ localStartDate: '2026-10-23', localEndDate: '2026-10-23' });
    const over = await create(a, timed({ startTime: '22:00', endDate: '2026-10-24', endTime: '00:30' }));
    expect(over.data.busy).toMatchObject({ localStartDate: '2026-10-23', localEndDate: '2026-10-24' });
  });

  it('tz อื่น: Asia/Tokyo 10:00–12:00 = 01:00Z', async () => {
    const r = await create(a, timed({ tz: 'Asia/Tokyo', startDate: '2026-11-10', endDate: '2026-11-10', startTime: '10:00', endTime: '12:00' }));
    expect(r.data.busy).toMatchObject({ tz: 'Asia/Tokyo', startAt: Date.UTC(2026, 10, 10, 1, 0), endAt: Date.UTC(2026, 10, 10, 3, 0) });
  });

  it('title/note: ว่าง → null · ตัดหัวท้าย · note ขึ้นบรรทัดได้ · title ห้ามตัวควบคุม/bidi', async () => {
    const r = await create(a, allDay({ title: '   ', note: '  บรรทัด1\r\nบรรทัด2  ' }));
    expect(r.data.busy).toMatchObject({ title: null, note: 'บรรทัด1\nบรรทัด2', hidden: false });
    for (const title of ['a‮b', 'a\nb', 'x'.repeat(81), '​']) {
      const bad = await create(a, allDay({ title }));
      expect([bad.status, bad.code], title).toEqual([400, 'VALIDATION']);
      expect(Object.keys((bad.json.error!.params as { fields: object }).fields)).toEqual(['title']);
    }
    const longNote = await create(a, allDay({ note: 'ก'.repeat(501) }));
    expect(longNote.json.error?.params).toEqual({ fields: { note: 'TOO_LONG' } });
    const ctl = await create(a, allDay({ note: 'a\u0000b' }));
    expect(ctl.json.error?.params).toEqual({ fields: { note: 'INVALID' } });
    expect((await create(a, allDay({ note: 'ก'.repeat(500) }))).status).toBe(201);
  });
});

describe('การแมปรหัสผิดพลาดของ lib เวลา → AppError (UX §7.5)', () => {
  const cases: [string, unknown, number, string, Record<string, unknown>][] = [
    ['end ≤ start (timed)', timed({ endTime: '18:00' }), 400, 'INVALID_RANGE', { field: 'endTime', kind: 'time' }],
    ['end < start (วัน)', allDay({ startDate: '2026-10-25', endDate: '2026-10-24' }), 400, 'INVALID_RANGE', { field: 'endDate', kind: 'dates' }],
    ['ไม่ลงตัว 30 นาที', timed({ startTime: '18:15' }), 400, 'TIME_NOT_ON_STEP', { field: 'startTime' }],
    ['วันที่ไม่มีจริง', allDay({ startDate: '2027-02-29', endDate: '2027-02-29' }), 400, 'INVALID_DATE', { field: 'startDate' }],
    ['รูปแบบวันที่ผิด', allDay({ startDate: '24/10/2026' }), 400, 'INVALID_DATE', { field: 'startDate' }],
    ['ส่ง พ.ศ. มา (ปีเกิน 2100)', allDay({ startDate: '2569-10-24', endDate: '2569-10-24' }), 400, 'DATE_OUT_OF_RANGE', { field: 'startDate' }],
    ['เวลาไม่มีจริง (DST gap)', timed({ tz: 'America/New_York', startDate: '2027-03-14', endDate: '2027-03-14', startTime: '02:30', endTime: '03:30' }), 400, 'INVALID_LOCAL_TIME', { field: 'startTime' }],
    ['รูปแบบเวลาผิด', timed({ startTime: '6pm' }), 400, 'VALIDATION', {}],
    ['tz ผิด', timed({ tz: 'Mars/Olympus' }), 400, 'INVALID_TIMEZONE', { field: 'tz' }],
    ['ช่วงทั้งวันเกิน 366 วัน', allDay({ startDate: '2026-10-24', endDate: '2027-10-25' }), 400, 'LIMIT_REACHED', { field: 'endDate', limit: 'busySpan', max: 366 }],
    ['ช่วงมีเวลาเกิน 62 วัน', timed({ endDate: '2026-12-26', endTime: '20:30' }), 400, 'LIMIT_REACHED', { field: 'endDate', limit: 'busySpan', max: 62 }],
    ['ย้อนหลังเกิน 7 วัน', allDay({ startDate: '2026-10-01', endDate: '2026-10-10' }), 400, 'LIMIT_REACHED', { field: 'startDate', limit: 'busyBackdate', max: 7 }],
  ];
  for (const [name, body, status, code, params] of cases) {
    it(name, async () => {
      const r = await create(a, body);
      expect([r.status, r.code]).toEqual([status, code]);
      if (code === 'VALIDATION') expect(r.json.error?.params).toEqual({ fields: { startTime: 'INVALID' } });
      else expect(r.json.error?.params).toEqual(params);
      expect(await h.count('busy_block')).toBe(0);
    });
  }

  it('ขอบเพดาน: 366 วันพอดีผ่าน · 62 วันพอดีผ่าน · ย้อน 7 วัน (จบ 2026-10-11) ผ่าน แต่จบ 2026-10-10 ไม่ผ่าน', async () => {
    expect((await create(a, allDay({ startDate: '2026-10-24', endDate: '2027-10-24' }))).status).toBe(201); // 366 วัน (24 ต.ค. 2026 → 24 ต.ค. 2027 นับรวมปลายทั้งสอง = 366 วัน)
    expect((await create(a, timed({ startDate: '2026-10-23', endDate: '2026-12-24', startTime: '18:00', endTime: '18:00' }))).status).toBe(201);
    expect((await create(a, allDay({ startDate: '2026-10-09', endDate: '2026-10-11' }))).status).toBe(201);
    expect((await create(a, allDay({ startDate: '2026-10-09', endDate: '2026-10-10' }))).code).toBe('LIMIT_REACHED');
  });

  it('DST: วันที่นาฬิกาถอยหลังรับได้ (ยาวกว่า 24 ชม.จริง) · spring-forward 03:00 มีจริง · tz ที่ไม่มี DST ไม่กระทบ', async () => {
    // America/New_York: 2026-11-01 01:30 เกิดสองครั้ง → lib เลือกแบบเดียวกันเสมอ (เก็บ epoch) และวันท้องถิ่นยังเป็น 2026-11-01
    const fall = await create(a, timed({ tz: 'America/New_York', startDate: '2026-11-01', endDate: '2026-11-01', startTime: '00:30', endTime: '03:30' }));
    expect(fall.status).toBe(201);
    expect(fall.data.busy.endAt - fall.data.busy.startAt).toBe(4 * 3600_000); // 00:30 EDT → 03:30 EST = 4 ชม.จริง
    const spring = await create(a, timed({ tz: 'America/New_York', startDate: '2027-03-14', endDate: '2027-03-14', startTime: '01:00', endTime: '03:30' }));
    expect(spring.status).toBe(201);
    expect(spring.data.busy.endAt - spring.data.busy.startAt).toBe(1.5 * 3600_000); // 01:00 EST → 03:30 EDT = 1.5 ชม.จริง
    const wholeDay = await create(a, allDay({ tz: 'America/New_York', startDate: '2027-03-14', endDate: '2027-03-14' }));
    expect(wholeDay.data.busy.endAt - wholeDay.data.busy.startAt).toBe(23 * 3600_000); // วัน spring-forward ยาว 23 ชม.
    expect(wholeDay.data.busy).toMatchObject({ localStartDate: '2027-03-14', localEndDate: '2027-03-14' });
  });
});

describe('strict schema / mass assignment (R3-3)', () => {
  it('คีย์แปลก (userId, id, createdAt, note ของคนอื่น) → 400 UNKNOWN_FIELD และไม่เขียนอะไร', async () => {
    for (const extra of [{ userId: b.id }, { id: '00000000-0000-4000-8000-000000000001' }, { createdAt: 1 }, { hidden: true }, { __proto__x: 1 }]) {
      const r = await create(a, allDay(extra));
      expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
      expect(Object.values((r.json.error!.params as { fields: Record<string, string> }).fields)).toEqual(['UNKNOWN_FIELD']);
    }
    expect(await h.count('busy_block')).toBe(0);
  });

  it('ฟิลด์ขาด/เกิน: kind ขาด → REQUIRED · all_day ที่ส่งเวลามา → ปฏิเสธ · timed ที่ขาดเวลา → REQUIRED', async () => {
    expect((await create(a, { startDate: '2026-10-24', endDate: '2026-10-24' })).json.error?.params).toEqual({ fields: { kind: 'REQUIRED' } });
    expect((await create(a, allDay({ startTime: '10:00' }))).json.error?.params).toEqual({ fields: { startTime: 'INVALID' } });
    expect((await create(a, { kind: 'timed', startDate: '2026-10-24', endDate: '2026-10-24' })).json.error?.params).toEqual({ fields: { startTime: 'REQUIRED', endTime: 'REQUIRED' } });
    expect((await create(a, allDay({ hideDetail: 'yes' }))).code).toBe('VALIDATION');
    expect((await post(a.c, '/api/me/busy', undefined)).code).toBe('VALIDATION');
  });

  it('PATCH: userId/id ถูกปฏิเสธ · ส่งตารางเวลาไม่ครบ → REQUIRED · ไม่ส่งอะไรเลย → ปฏิเสธ · PATCH ซ่อน/title/note ทีละฟิลด์ได้', async () => {
    const id = (await create(a, timed({ title: 'เดิม', note: 'ลับ' }))).data.busy.id;
    const url = `/api/me/busy/${id}`;
    expect((await patch(a.c, url, { userId: b.id })).code).toBe('VALIDATION');
    expect((await patch(a.c, url, {})).code).toBe('VALIDATION');
    expect((await patch(a.c, url, { startDate: '2026-10-25' })).json.error?.params).toEqual({ fields: { kind: 'REQUIRED', endDate: 'REQUIRED' } });
    const r = await patch<{ busy: Busy }>(a.c, url, { hideDetail: true });
    expect(r.data.busy).toMatchObject({ title: 'เดิม', note: 'ลับ', hidden: true, startAt: Date.UTC(2026, 9, 23, 11, 0) });
    const cleared = await patch<{ busy: Busy }>(a.c, url, { title: null, note: null });
    expect(cleared.data.busy).toMatchObject({ title: null, note: null, hidden: true });
  });
});

describe('แก้/ลบ + IDOR (R3-3)', () => {
  it('แก้ตารางเวลาทั้งก้อน: เปลี่ยนแบบ timed → all_day คำนวณใหม่ · ย้อนหลังเกิน 7 วัน ถูกปฏิเสธ', async () => {
    const id = (await create(a, timed())).data.busy.id;
    const r = await patch<{ busy: Busy }>(a.c, `/api/me/busy/${id}`, allDay({ startDate: '2026-10-26', endDate: '2026-10-28' }));
    expect(r.data.busy).toMatchObject({ id, allDay: true, localStartDate: '2026-10-26', localEndDate: '2026-10-28' });
    const old = await patch(a.c, `/api/me/busy/${id}`, allDay({ startDate: '2026-09-01', endDate: '2026-09-02' }));
    expect(old.json.error?.params).toMatchObject({ limit: 'busyBackdate', max: 7 });
    expect(await h.count('busy_block WHERE id = ? AND local_start_date = ?', [id, '2026-10-26'])).toBe(1);
  });

  it('แก้เฉพาะ title ของรายการที่จบไปนานแล้วได้ (ไม่ตรวจย้อนหลังเมื่อไม่แตะเวลา)', async () => {
    const uuid = '5b0f6b5e-8f55-4a3e-9c1d-000000000001';
    await h.rows("INSERT INTO busy_block (id, user_id, title, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES (?, ?, 'เก่า', 1, 1, 2, '2026-01-01', '2026-01-01', 'Asia/Bangkok', 0, 1, 1)", [uuid, a.id]);
    const ok = await patch<{ busy: Busy }>(a.c, `/api/me/busy/${uuid}`, { title: 'ใหม่' });
    expect(ok.data.busy.title).toBe('ใหม่');
  });

  it('ลบ: ถาวร (hard delete) · ลบซ้ำ → 404', async () => {
    const id = (await create(a, timed())).data.busy.id;
    expect((await del(a.c, `/api/me/busy/${id}`)).data).toEqual({ deleted: true });
    expect(await h.count('busy_block WHERE id = ?', [id])).toBe(0);
    expect((await del(a.c, `/api/me/busy/${id}`)).status).toBe(404);
  });

  it('IDOR: แก้/ลบ busy ของคนอื่น (แม้เป็น super admin) → 404 NOT_FOUND ตัวเดียวกับ id ที่ไม่มี · ข้อมูลไม่เปลี่ยน', async () => {
    const boss = await person(h, 'boss', { admin: true });
    const id = (await create(a, timed({ title: 'ของอลิซ', note: 'ลับ' }))).data.busy.id;
    const before = JSON.stringify(await h.rows('SELECT * FROM busy_block'));
    const ghost = '00000000-0000-4000-8000-00000000dead';
    for (const who of [b, boss]) {
      const p = await patch(who.c, `/api/me/busy/${id}`, { title: 'แฮ็ก', hideDetail: false });
      const d = await del(who.c, `/api/me/busy/${id}`);
      const pg = await patch(who.c, `/api/me/busy/${ghost}`, { title: 'แฮ็ก', hideDetail: false });
      const dg = await del(who.c, `/api/me/busy/${ghost}`);
      expect([p.status, p.code, d.status, d.code]).toEqual([404, 'NOT_FOUND', 404, 'NOT_FOUND']);
      expect(p.text).toBe(pg.text);
      expect(d.text).toBe(dg.text);
    }
    expect(JSON.stringify(await h.rows('SELECT * FROM busy_block'))).toBe(before);
  });

  it('GET /api/me/busy ไม่คืนของคนอื่น แม้มีรายการ · id ที่ไม่ใช่ UUID → 400', async () => {
    await create(a, timed({ title: 'อลิซ' }));
    await create(b, timed({ title: 'บ๊อบ' }));
    const mine = await get<{ busy: Busy[] }>(b.c, '/api/me/busy');
    expect(mine.data.busy.map((x) => x.title)).toEqual(['บ๊อบ']);
    expect((await del(a.c, '/api/me/busy/not-a-uuid')).status).toBe(400);
  });
});

describe('GET /api/me/busy', () => {
  it('ไม่ส่งช่วง = ที่ยังไม่สิ้นสุด เรียงตามเวลาเริ่ม · รวมรายการซ่อน (title+note ครบ) · ไม่รวมที่จบแล้ว', async () => {
    await create(a, timed({ title: 'หลัง', startDate: '2026-10-25', endDate: '2026-10-25', note: 'n2', hideDetail: true }));
    await create(a, timed({ title: 'ก่อน', note: 'n1' }));
    await create(a, allDay({ startDate: '2026-10-17', endDate: '2026-10-17', title: 'เมื่อวาน' })); // จบแล้ว (ลงย้อนหลังได้ 7 วัน)
    const r = await get<{ busy: Busy[] }>(a.c, '/api/me/busy');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.data.busy.map((x) => [x.title, x.note, x.hidden])).toEqual([['ก่อน', 'n1', false], ['หลัง', 'n2', true]]);
    h.clock.advance(DAY * 3); // 2026-10-21 → ไม่เปลี่ยน
    h.clock.advance(DAY * 3); // 2026-10-24 → "ก่อน" (23 ต.ค.) จบแล้ว
    expect((await get<{ busy: Busy[] }>(a.c, '/api/me/busy')).data.busy.map((x) => x.title)).toEqual(['หลัง']);
  });

  it('from+to: รายการที่ครอบวันใดวันหนึ่งในช่วง (ขอบรวมปลาย) · ข้ามเดือน/ปี', async () => {
    await create(a, allDay({ startDate: '2026-12-30', endDate: '2027-01-02', title: 'ข้ามปี' }));
    const hit = (from: string, to: string) => get<{ busy: Busy[] }>(a.c, `/api/me/busy?from=${from}&to=${to}`).then((r) => r.data.busy.length);
    expect(await hit('2027-01-02', '2027-01-10')).toBe(1);
    expect(await hit('2027-01-03', '2027-01-10')).toBe(0);
    expect(await hit('2026-12-01', '2026-12-30')).toBe(1);
    expect(await hit('2026-12-01', '2026-12-29')).toBe(0);
    expect(await hit('2027-01-01', '2027-01-01')).toBe(1);
  });

  it('ช่วงผิด: ขาดด้านเดียว / สลับ / > 62 วัน / วันที่ไม่มีจริง → 400 VALIDATION', async () => {
    const bad = async (q: string) => (await get(a.c, `/api/me/busy?${q}`)).code;
    expect(await bad('from=2026-10-01')).toBe('VALIDATION');
    expect(await bad('from=2026-10-10&to=2026-10-01')).toBe('VALIDATION');
    expect(await bad('from=2026-10-01&to=2026-12-03')).toBe('VALIDATION'); // 64 วัน
    expect(await bad('from=2026-10-01&to=2026-12-01')).toBeUndefined(); // 62 วันพอดี
    expect(await bad('from=2027-02-30&to=2027-03-01')).toBe('VALIDATION');
    expect(await bad('userId=x')).toBe('VALIDATION');
  });
});

describe('เพดาน 300 (R3-2) — คำสั่งเดียวมีเงื่อนไขในตัว', () => {
  it('ครบ 300 → LIMIT_REACHED busyCount max 300 (409) · ลบหนึ่งแล้วลงได้อีก · คนอื่นไม่โดนผลกระทบ', async () => {
    await seedActive(a.id, 300);
    const r = await create(a, timed());
    expect([r.status, r.code, r.json.error?.params]).toEqual([409, 'LIMIT_REACHED', { limit: 'busyCount', max: 300 }]);
    expect((await create(b, timed())).status).toBe(201);
    await h.rows('DELETE FROM busy_block WHERE id = ?', [`seed-${a.id}-0`]);
    expect((await create(a, timed())).status).toBe(201);
  });

  it('รายการที่จบแล้วไม่นับ: 300 รายการที่จบแล้ว + ลงใหม่ได้', async () => {
    await h.rows("INSERT INTO busy_block (id, user_id, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) SELECT 'e' || value, ?, 0, 1, 2, '2026-01-01', '2026-01-01', 'Asia/Bangkok', 0, 1, 1 FROM generate_series(1, 300)", [a.id]).catch(async () => {
      for (let i = 0; i < 300; i++) {
        await h.rows("INSERT INTO busy_block (id, user_id, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES (?, ?, 0, 1, 2, '2026-01-01', '2026-01-01', 'Asia/Bangkok', 0, 1, 1)", [`e${i}`, a.id]);
      }
    });
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(300);
    expect((await create(a, timed())).status).toBe(201);
  });

  it('แข่งกัน: มี 299 แล้วสร้างพร้อมกัน 8 ครั้ง → สำเร็จพอดี 1 · รวมเป็น 300 เสมอ', async () => {
    await seedActive(a.id, 299);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => create(a, timed({ startTime: '18:00', title: `race${i}` }))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) expect(['LIMIT_REACHED', 'CONFLICT']).toContain(r.code);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(300);
  });

  it('แก้รายการที่จบแล้วให้กลับมาเป็น "ยังไม่สิ้นสุด" ตอนเต็ม → LIMIT_REACHED · แก้รายการที่ยังไม่สิ้นสุดตอนเต็ม ได้', async () => {
    await seedActive(a.id, 299);
    const live = (await create(a, timed())).data.busy.id; // 300
    const ended = (await create(b, allDay({ startDate: '2026-10-17', endDate: '2026-10-17' }))).data.busy.id; // ของ b — ไม่นับกับ a
    expect(ended).toBeTruthy();
    // รายการจบแล้วของ a (แทรกตรง) → ย้ายไปอนาคตไม่ได้เมื่อเต็ม
    const endedId = '5b0f6b5e-8f55-4a3e-9c1d-000000000002';
    await h.rows("INSERT INTO busy_block (id, user_id, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES (?, ?, 0, 1, 2, '2026-10-17', '2026-10-17', 'Asia/Bangkok', 0, 1, 1)", [endedId, a.id]);
    const revive = await patch(a.c, `/api/me/busy/${endedId}`, timed());
    expect([revive.status, revive.code, revive.json.error?.params]).toEqual([409, 'LIMIT_REACHED', { limit: 'busyCount', max: 300 }]);
    expect((await patch(a.c, `/api/me/busy/${live}`, timed({ startTime: '19:00' }))).status).toBe(200);
    // ลบหนึ่ง → ฟื้นได้
    await del(a.c, `/api/me/busy/${live}`);
    expect((await patch(a.c, `/api/me/busy/${endedId}`, timed())).status).toBe(200);
  });
});

describe('สถานะบัญชี (R3-6)', () => {
  const calls = (gidOrId: string): [string, string, unknown][] => [
    ['GET', '/api/me/busy', undefined],
    ['POST', '/api/me/busy', allDay()],
    ['PATCH', `/api/me/busy/${gidOrId}`, { title: 'x' }],
    ['DELETE', `/api/me/busy/${gidOrId}`, undefined],
  ];
  const UUID = '00000000-0000-4000-8000-000000000009';

  it('anonymous → 401 AUTH_REQUIRED ทุก route ใหม่ (รวมปฏิทินกลุ่ม) และไม่เขียนอะไร', async () => {
    const anon = new Client();
    for (const [m, p, body] of [...calls(UUID), ['GET', `/api/groups/${UUID}/calendar?from=2026-10-01&to=2026-10-31`, undefined] as [string, string, unknown]]) {
      const r = await anon.call(m as 'GET', p, body === undefined ? undefined : body);
      expect([r.status, r.code], `${m} ${p}`).toEqual([401, 'AUTH_REQUIRED']);
    }
    expect(await h.count('busy_block')).toBe(0);
  });

  it('must_change_pin → 403 PIN_CHANGE_REQUIRED ทุก route ใหม่ · suspended → 401 ACCOUNT_SUSPENDED', async () => {
    const id = (await create(a, timed())).data.busy.id;
    await h.rows("UPDATE user SET must_change_pin = 1 WHERE id = ?", [a.id]);
    const gid = (await h.rows<{ id: string }>('SELECT 1 AS id'))[0] && '00000000-0000-4000-8000-0000000000aa';
    for (const [m, p, body] of [...calls(id), ['GET', `/api/groups/${gid}/calendar?from=2026-10-01&to=2026-10-31`, undefined] as [string, string, unknown]]) {
      const r = await a.c.call(m as 'GET', p, body === undefined ? undefined : body);
      expect([r.status, r.code], `${m} ${p}`).toEqual([403, 'PIN_CHANGE_REQUIRED']);
    }
    await h.rows("UPDATE user SET must_change_pin = 0, status = 'suspended' WHERE id = ?", [a.id]);
    const sus = await a.c.call('GET', '/api/me/busy');
    expect([sus.status, sus.code]).toEqual([401, 'ACCOUNT_SUSPENDED']);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(1);
  });

  it('CSRF: POST/PATCH/DELETE ที่ Origin ผิดถูกปฏิเสธก่อนถึง service', async () => {
    const r = await a.c.call('POST', '/api/me/busy', allDay(), { headers: { origin: 'https://evil.test' } });
    expect([r.status, r.code]).toEqual([403, 'CSRF_REJECTED']);
    expect(await h.count('busy_block')).toBe(0);
  });

  it('manifest: 5 route ใหม่ลงทะเบียนด้วย action ที่ตรงกับ RBAC', () => {
    const mine = ROUTE_MANIFEST.filter((e) => e.path.startsWith('/api/me/busy') || e.path.endsWith('/calendar')).map((e) => `${e.method} ${e.path} ${e.action}`);
    expect(mine.sort()).toEqual([
      'DELETE /api/me/busy/:id busy.delete',
      'GET /api/groups/:gid/calendar group.calendar.view',
      'GET /api/me/busy busy.list.own',
      'PATCH /api/me/busy/:id busy.update',
      'POST /api/me/busy busy.create',
    ]);
  });
});
