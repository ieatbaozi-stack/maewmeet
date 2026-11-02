// R6F Platform — ชุดรายวัน (ADR 0010): POST kind 'daily' · เพดาน 300 แบบ N แถวคำสั่งเดียว · ลบ scope=series · PATCH หลุดจากชุด ·
// seriesId เห็นเฉพาะเจ้าของ · rate limit busy ใหม่ · R6F-1, 2, 3, 4, 5, 6, 7
// เรียก route handler จริงผ่าน Request/Response บน libSQL จริง + migration จริง + นาฬิกา inject (now = 2026-10-18 10:00 Asia/Bangkok)
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertBusySeriesIfUnderCap, sharedBusyInGroupQuery } from '@/lib/data/repos/busy';
import { inTx } from '@/lib/data/tx';
import { newId } from '@/lib/shared/id';
import { BUSY_WRITE_RATE_LIMITS } from '@/lib/shared/limits';
import { call, del, get, join, makeGroup, MIN, patch, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

let h: Harness;
let a: Person;
let b: Person;
beforeEach(async () => {
  h = await setupHarness();
  a = await person(h, 'alice');
  b = await person(h, 'bob');
});
afterEach(async () => {
  await h.cleanup();
});

type Own = {
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
  seriesId: string | null;
};
type Series = { seriesId: string | null; count: number; items: Own[] };

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 18, 3, 0);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const daily = (over: Record<string, unknown> = {}) => ({ kind: 'daily', startDate: '2026-11-03', endDate: '2026-11-30', startTime: '17:00', endTime: '20:00', ...over });
const createSeries = (p: Person, body: unknown) => post<Series>(p.c, '/api/me/busy', body);
const seriesRows = (seriesId: string) => h.count('busy_block WHERE series_id = ?', [seriesId]);

/** แทรก busy ตรง ๆ (เร็ว) — ยังไม่สิ้นสุด (ตั้งแต่ 2027-01-01) · id เป็น UUID ให้ลบผ่าน API ได้ */
async function seedActive(userId: string, n: number): Promise<string[]> {
  const base = Date.UTC(2027, 0, 1);
  const ids: string[] = [];
  for (let i = 0; i < n; i += 50) {
    const vals: string[] = [];
    const args: (string | number)[] = [];
    for (let j = i; j < Math.min(n, i + 50); j++) {
      const id = newId();
      ids.push(id);
      vals.push("(?, ?, 'seed', NULL, 0, ?, ?, '2027-01-01', '2027-01-01', 'Asia/Bangkok', 0, 1, 1)");
      args.push(id, userId, base + j * 1800_000, base + j * 1800_000 + 1800_000);
    }
    await h.rows(
      `INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${vals.join(',')}`,
      args,
    );
  }
  return ids;
}

describe('R6F-1 — all_day / timed เหมือนเดิม (ไม่ถอยหลัง)', () => {
  it('ตอบ { busy } คีย์เดียว · ค่าเดิมทุกฟิลด์ · seriesId = null · series_id ในฐาน NULL', async () => {
    const t = await post<{ busy: Own }>(a.c, '/api/me/busy', { kind: 'timed', startDate: '2026-11-03', startTime: '17:00', endDate: '2026-11-05', endTime: '20:00' });
    expect(t.status).toBe(201);
    expect(Object.keys(t.data)).toEqual(['busy']);
    expect(t.data.busy).toMatchObject({ allDay: false, startAt: Date.UTC(2026, 10, 3, 10), endAt: Date.UTC(2026, 10, 5, 13), localStartDate: '2026-11-03', localEndDate: '2026-11-05', seriesId: null });
    const d = await post<{ busy: Own }>(a.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-11-03', endDate: '2026-11-30' });
    expect(Object.keys(d.data)).toEqual(['busy']);
    expect(d.data.busy).toMatchObject({ allDay: true, startAt: Date.UTC(2026, 10, 2, 17), endAt: Date.UTC(2026, 10, 30, 17), localStartDate: '2026-11-03', localEndDate: '2026-11-30', seriesId: null });
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(2); // หลายวันแบบทั้งวัน = รายการเดียวเหมือนเดิม
    expect(await h.count('busy_block WHERE series_id IS NOT NULL')).toBe(0);
  });

  it('timed หลายวันยังเป็นช่วงต่อเนื่องเดียว (ไม่ถูกขยายเป็นรายวัน)', async () => {
    const t = await post<{ busy: Own }>(a.c, '/api/me/busy', { kind: 'timed', startDate: '2026-11-03', startTime: '17:00', endDate: '2026-11-30', endTime: '20:00' });
    expect(t.data.busy.endAt - t.data.busy.startAt).toBe(27 * 24 * H + 3 * H);
  });
});

describe('R6F-2 — หลายวัน + เฉพาะช่วงเวลา', () => {
  it('3–30 พ.ย. 17:00–20:00 → 201 · 28 รายการ วันละ 17:00–20:00 เวลาไทย · seriesId เดียวกัน · ชื่อ/โน้ต/ซ่อน เหมือนกันทุกวัน', async () => {
    const r = await createSeries(a, daily({ title: 'คลาสเรียน', note: 'ห้อง 301', hideDetail: true }));
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(Object.keys(r.data).sort()).toEqual(['count', 'items', 'seriesId']);
    expect(r.data.seriesId).toMatch(UUID_RE);
    expect(r.data.count).toBe(28);
    expect(r.data.items).toHaveLength(28);
    r.data.items.forEach((it, i) => {
      const date = `2026-11-${String(3 + i).padStart(2, '0')}`;
      expect(it).toMatchObject({
        userId: a.id,
        allDay: false,
        startAt: Date.UTC(2026, 10, 3 + i, 10),
        endAt: Date.UTC(2026, 10, 3 + i, 13),
        localStartDate: date,
        localEndDate: date,
        tz: 'Asia/Bangkok',
        title: 'คลาสเรียน',
        note: 'ห้อง 301',
        hidden: true,
        seriesId: r.data.seriesId,
      });
      expect(it.id).toMatch(UUID_RE);
    });
    expect(new Set(r.data.items.map((x) => x.id)).size).toBe(28);
    expect(await seriesRows(r.data.seriesId!)).toBe(28);
    // เก็บ UTC + วันท้องถิ่นแยก
    const db = await h.rows<{ start_at: number; local_start_date: string; all_day: number }>('SELECT start_at, local_start_date, all_day FROM busy_block WHERE series_id = ? ORDER BY start_at LIMIT 1', [r.data.seriesId!]);
    expect(db[0]).toEqual({ start_at: Date.UTC(2026, 10, 3, 10), local_start_date: '2026-11-03', all_day: 0 });
  });

  it('GET /api/me/busy (เจ้าของ) เห็น seriesId ทุกแถวของชุด', async () => {
    const r = await createSeries(a, daily());
    const mine = await get<{ busy: Own[] }>(a.c, '/api/me/busy?from=2026-11-01&to=2026-11-30');
    expect(mine.data.busy).toHaveLength(28);
    expect(new Set(mine.data.busy.map((x) => x.seriesId))).toEqual(new Set([r.data.seriesId]));
  });

  it('วันเดียว (start = end) → 1 รายการ seriesId = null (ไม่มีชุด)', async () => {
    const r = await createSeries(a, daily({ startDate: '2026-11-10', endDate: '2026-11-10' }));
    expect([r.status, r.data.seriesId, r.data.count, r.data.items.length]).toEqual([201, null, 1, 1]);
    expect(r.data.items[0]!.seriesId).toBeNull();
    expect(await h.count('busy_block WHERE user_id = ? AND series_id IS NULL', [a.id])).toBe(1);
  });

  it('62 วันพอดี → 62 แถว', async () => {
    const r = await createSeries(a, daily({ startDate: '2026-10-20', endDate: '2026-12-20' }));
    expect([r.status, r.data.count]).toEqual([201, 62]);
  });
});

describe('R6F-3 — ว่างตรงกัน: ช่วงก่อน 17:00 / หลัง 20:00 ของวันในชุดยังว่าง', () => {
  it('หน้าต่างกลุ่ม 08:00–22:00 → ว่างร่วม 08:00–17:00 และ 20:00–22:00 ทุกวันในชุด', async () => {
    const gid = await makeGroup(a, 'กลุ่ม');
    // R7 G1: กลุ่มใหม่ได้ขั้นต่ำ 240 นาที — ผลที่คาดของ R6F-3 (20:00–22:00 = 120 นาที) คำนวณที่ขั้นต่ำ 120 จึงตั้งกลับตรง ๆ
    await h.rows('UPDATE groups SET min_free_minutes = 120 WHERE id = ?', [gid]);
    await join(a, b, gid);
    expect((await createSeries(a, daily())).status).toBe(201);
    type Day = { date: string; segments: { start: string; end: string }[]; allFree: boolean };
    const r = await get<{ days: Day[] }>(b.c, `/api/groups/${gid}/availability?from=2026-11-03&to=2026-11-30`);
    expect(r.status).toBe(200);
    expect(r.data.days).toHaveLength(28);
    for (const d of r.data.days) {
      expect(d.segments.map((s) => `${s.start}-${s.end}`), d.date).toEqual(['08:00-17:00', '20:00-22:00']);
      expect(d.allFree).toBe(true);
    }
  });
});

describe('R6F-4 — เกินเพดาน/อินพุตผิด → 4xx รหัสเดิม และไม่มีแถวถูกสร้าง', () => {
  const cases: [string, Record<string, unknown>, number, string, Record<string, unknown>][] = [
    ['63 วัน', daily({ startDate: '2026-10-20', endDate: '2026-12-21' }), 400, 'LIMIT_REACHED', { field: 'endDate', limit: 'busySpan', max: 62 }],
    ['ย้อนหลังเกิน 7 วัน (วันแรก = วันนี้ − 8)', daily({ startDate: '2026-10-10', endDate: '2026-10-20' }), 400, 'LIMIT_REACHED', { field: 'startDate', limit: 'busyBackdate', max: 7 }],
    ['เวลาจบ = เริ่ม', daily({ endTime: '17:00' }), 400, 'INVALID_RANGE', { field: 'endTime', kind: 'time' }],
    ['เวลาจบ < เริ่ม (ข้ามเที่ยงคืน ไม่รองรับ)', daily({ startTime: '22:00', endTime: '02:00' }), 400, 'INVALID_RANGE', { field: 'endTime', kind: 'time' }],
    ['วันจบ < วันเริ่ม', daily({ startDate: '2026-11-10', endDate: '2026-11-09' }), 400, 'INVALID_RANGE', { field: 'endDate', kind: 'dates' }],
    ['ไม่ลงตัว 30 นาที', daily({ startTime: '17:15' }), 400, 'TIME_NOT_ON_STEP', { field: 'startTime' }],
    ['วันที่ไม่มีจริง', daily({ endDate: '2027-02-29' }), 400, 'INVALID_DATE', { field: 'endDate' }],
    ['tz ผิด', daily({ tz: 'Mars/Olympus' }), 400, 'INVALID_TIMEZONE', { field: 'tz' }],
    ['DST gap วันใดวันหนึ่ง → ทั้งคำขอ', daily({ tz: 'America/New_York', startDate: '2027-03-12', endDate: '2027-03-16', startTime: '02:30', endTime: '03:30' }), 400, 'INVALID_LOCAL_TIME', { field: 'startTime' }],
  ];
  for (const [name, body, status, code, params] of cases) {
    it(name, async () => {
      const r = await createSeries(a, body);
      expect([r.status, r.code]).toEqual([status, code]);
      expect(r.json.error?.params).toEqual(params);
      expect(await h.count('busy_block')).toBe(0);
    });
  }

  it('ย้อนหลัง: วันแรก = วันนี้ − 7 ผ่าน', async () => {
    expect((await createSeries(a, daily({ startDate: '2026-10-11', endDate: '2026-10-12' }))).status).toBe(201);
  });

  it('24:00 ไม่รับ → VALIDATION endTime INVALID · daily ขาดเวลา → REQUIRED', async () => {
    expect((await createSeries(a, daily({ endTime: '24:00' }))).json.error?.params).toEqual({ fields: { endTime: 'INVALID' } });
    expect((await createSeries(a, { kind: 'daily', startDate: '2026-11-03', endDate: '2026-11-04' })).json.error?.params).toEqual({ fields: { startTime: 'REQUIRED', endTime: 'REQUIRED' } });
    expect(await h.count('busy_block')).toBe(0);
  });

  it('strict: ส่ง seriesId / userId / items มาเอง → VALIDATION UNKNOWN_FIELD ไม่เขียนอะไร', async () => {
    for (const extra of [{ seriesId: newId() }, { userId: b.id }, { items: [] }, { days: 3 }]) {
      const r = await createSeries(a, daily(extra));
      expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
      expect(Object.values((r.json.error!.params as { fields: Record<string, string> }).fields)).toEqual(['UNKNOWN_FIELD']);
    }
    expect(await h.count('busy_block')).toBe(0);
  });

  it("PATCH ส่ง kind 'daily' → VALIDATION (daily สร้างเท่านั้น) · แถวไม่เปลี่ยน", async () => {
    const id = (await createSeries(a, daily())).data.items[0]!.id;
    const r = await patch(a.c, `/api/me/busy/${id}`, daily());
    expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(28);
  });

  it('เพดาน 300: มี 290 + ชุด 28 วัน → 409 LIMIT_REACHED busyCount · 0 แถว (ไม่ใช่ 10) · ชุด 10 วันพอดี 300 ผ่าน · ชุดถัดไปเต็ม', async () => {
    await seedActive(a.id, 290);
    const r = await createSeries(a, daily());
    expect([r.status, r.code, r.json.error?.params]).toEqual([409, 'LIMIT_REACHED', { limit: 'busyCount', max: 300 }]);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(290);
    expect((await createSeries(a, daily({ startDate: '2026-11-03', endDate: '2026-11-12' }))).data.count).toBe(10);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(300);
    const full = await createSeries(a, daily({ startDate: '2026-12-01', endDate: '2026-12-02' }));
    expect([full.status, full.code]).toEqual([409, 'LIMIT_REACHED']);
    expect((await createSeries(b, daily())).status).toBe(201); // คนอื่นไม่โดนผลกระทบ
  });
});

describe('R6F-5 — ทั้งหมดหรือไม่มีเลย · ยิงพร้อมกันไม่ทะลุ 300', () => {
  it('มี 250 แล้วยิงชุด 28 วันพร้อมกัน 2 คำขอ → สำเร็จ 1 ล้ม 1 (busyCount) · รวม 278', async () => {
    await seedActive(a.id, 250);
    const rs = await Promise.all([createSeries(a, daily({ title: 'r1' })), createSeries(a, daily({ title: 'r2' }))]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    const failed = rs.find((r) => r.status !== 201)!;
    expect(['LIMIT_REACHED', 'CONFLICT']).toContain(failed.code);
    if (failed.code === 'LIMIT_REACHED') expect(failed.json.error?.params).toEqual({ limit: 'busyCount', max: 300 });
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(278);
  });

  it('แข่งกัน 6 คำขอ ตอนเหลือที่ 50 → ได้ไม่เกิน 1 ชุด (28) · ไม่มีชุดครึ่ง ๆ', async () => {
    await seedActive(a.id, 250);
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => createSeries(a, daily({ title: `race${i}` }))));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    const n = await h.count('busy_block WHERE user_id = ?', [a.id]);
    expect(n).toBe(278);
    const perSeries = await h.rows<{ n: number }>('SELECT count(*) AS n FROM busy_block WHERE series_id IS NOT NULL GROUP BY series_id');
    expect(perSeries.map((r) => Number(r.n))).toEqual([28]);
  });

  it('repo: 290 + 28 → คำสั่งเดียวไม่เขียนสักแถว (null) แม้ไม่ throw', async () => {
    await seedActive(a.id, 290);
    const rows = Array.from({ length: 28 }, (_, i) => ({ id: newId(), startAt: Date.UTC(2026, 10, 3 + i, 10), endAt: Date.UTC(2026, 10, 3 + i, 13), localStartDate: '2026-11-03', localEndDate: '2026-11-03' }));
    const seriesId = newId();
    const out = await inTx(h.db, (tx) => insertBusySeriesIfUnderCap(tx, { userId: a.id, seriesId, cap: 300, shared: { title: null, note: null, hideDetail: false, tz: 'Asia/Bangkok' }, rows }, NOW));
    expect(out).toBeNull();
    expect(await seriesRows(seriesId)).toBe(0);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(290);
  });

  it('ล้มกลางทาง (id ชน PK แถวที่มีอยู่) → คำสั่งล้มทั้งก้อน ไม่มีแถวของชุดค้าง', async () => {
    const [existing] = await seedActive(a.id, 1);
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i === 3 ? existing! : newId(), startAt: Date.UTC(2026, 10, 3 + i, 10), endAt: Date.UTC(2026, 10, 3 + i, 13), localStartDate: '2026-11-03', localEndDate: '2026-11-03' }));
    const seriesId = newId();
    await expect(
      inTx(h.db, (tx) => insertBusySeriesIfUnderCap(tx, { userId: a.id, seriesId, cap: 300, shared: { title: 'x', note: null, hideDetail: false, tz: 'Asia/Bangkok' }, rows }, NOW)),
    ).rejects.toThrow();
    expect(await seriesRows(seriesId)).toBe(0);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(1);
  });

  it('ล้มหลัง INSERT สำเร็จใน inTx (จำลอง throw) → rollback ไม่มีแถวค้าง', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: newId(), startAt: Date.UTC(2026, 10, 3 + i, 10), endAt: Date.UTC(2026, 10, 3 + i, 13), localStartDate: '2026-11-03', localEndDate: '2026-11-03' }));
    const seriesId = newId();
    await expect(
      inTx(h.db, async (tx) => {
        const out = await insertBusySeriesIfUnderCap(tx, { userId: a.id, seriesId, cap: 300, shared: { title: null, note: null, hideDetail: false, tz: 'Asia/Bangkok' }, rows }, NOW);
        expect(out).toHaveLength(4);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await seriesRows(seriesId)).toBe(0);
  });

  it('บัญชีถูกระงับ → ไม่สร้างสักแถว', async () => {
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [a.id]);
    const r = await createSeries(a, daily());
    expect(r.status).toBe(401);
    expect(await h.count('busy_block')).toBe(0);
  });
});

describe('R6F-6 — ลบวันนี้ / ลบทั้งชุด / แก้แล้วหลุดจากชุด', () => {
  it('scope=series ลบทุกวันของชุดตัวเอง (count 28) · ชุดของคนอื่นและรายการเดี่ยวไม่กระทบ', async () => {
    const mine = await createSeries(a, daily());
    const other = await createSeries(b, daily());
    const single = (await post<{ busy: Own }>(a.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-11-05', endDate: '2026-11-05' })).data.busy.id;
    const r = await del<{ deleted: true; count: number }>(a.c, `/api/me/busy/${mine.data.items[10]!.id}?scope=series`);
    expect([r.status, r.data]).toEqual([200, { deleted: true, count: 28 }]);
    expect(await seriesRows(mine.data.seriesId!)).toBe(0);
    expect(await seriesRows(other.data.seriesId!)).toBe(28);
    expect(await h.count('busy_block WHERE id = ?', [single])).toBe(1);
  });

  it('ลบวันเดียว (ไม่ส่ง scope / scope=one) → count 1 · วันอื่นของชุดยังอยู่', async () => {
    const s = await createSeries(a, daily());
    const r1 = await del(a.c, `/api/me/busy/${s.data.items[0]!.id}`);
    const r2 = await del(a.c, `/api/me/busy/${s.data.items[1]!.id}?scope=one`);
    expect([r1.data, r2.data]).toEqual([{ deleted: true, count: 1 }, { deleted: true, count: 1 }]);
    expect(await seriesRows(s.data.seriesId!)).toBe(26);
  });

  it('scope=series บนรายการเดี่ยว (series_id NULL) → ลบแถวนั้นแถวเดียว · ไม่ลากรายการเดี่ยวอื่น', async () => {
    const one = (await post<{ busy: Own }>(a.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-11-05', endDate: '2026-11-05' })).data.busy.id;
    await post(a.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-11-06', endDate: '2026-11-06' });
    const r = await del(a.c, `/api/me/busy/${one}?scope=series`);
    expect(r.data).toEqual({ deleted: true, count: 1 });
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(1);
  });

  it('ลบทั้งชุดของคนอื่น (รวม super admin) → 404 NOT_FOUND ตัวเดียวกับ id ที่ไม่มี · ข้อมูลไม่เปลี่ยน', async () => {
    const boss = await person(h, 'boss', { admin: true });
    const s = await createSeries(a, daily());
    const before = JSON.stringify(await h.rows('SELECT * FROM busy_block ORDER BY id'));
    const ghost = '00000000-0000-4000-8000-00000000dead';
    for (const who of [b, boss]) {
      for (const scope of ['series', 'one']) {
        const d = await del(who.c, `/api/me/busy/${s.data.items[0]!.id}?scope=${scope}`);
        const g = await del(who.c, `/api/me/busy/${ghost}?scope=${scope}`);
        expect([d.status, d.code]).toEqual([404, 'NOT_FOUND']);
        expect(d.text).toBe(g.text);
      }
    }
    // ผู้โจมตีมีชุดของตัวเองที่ series_id ต่างกัน — ใช้ id ของตัวเองลบไม่ลามไปชุดของ a
    const bs = await createSeries(b, daily());
    expect((await del(b.c, `/api/me/busy/${bs.data.items[0]!.id}?scope=series`)).data).toEqual({ deleted: true, count: 28 });
    expect(JSON.stringify(await h.rows('SELECT * FROM busy_block ORDER BY id'))).toBe(before);
  });

  it('ชุดที่ series_id ถูกปลอมให้ตรงกันข้ามผู้ใช้ (จำลองข้อมูลแปลก) → ลบทั้งชุดลบเฉพาะแถวของผู้กระทำ', async () => {
    const s = await createSeries(a, daily({ startDate: '2026-11-03', endDate: '2026-11-05' }));
    await seedActive(b.id, 2);
    await h.rows('UPDATE busy_block SET series_id = ? WHERE user_id = ?', [s.data.seriesId!, b.id]);
    const r = await del(a.c, `/api/me/busy/${s.data.items[0]!.id}?scope=series`);
    expect(r.data).toEqual({ deleted: true, count: 3 });
    expect(await h.count('busy_block WHERE user_id = ?', [b.id])).toBe(2);
  });

  it('scope ผิด/คีย์แปลก → 400 VALIDATION { scope: INVALID } ไม่สะท้อนค่า · ไม่ลบอะไร', async () => {
    const s = await createSeries(a, daily());
    const id = s.data.items[0]!.id;
    for (const q of ['scope=all', 'scope=SERIES', 'scope=', 'foo=1', 'scope=series&x=CANARY']) {
      const r = await del(a.c, `/api/me/busy/${id}?${q}`);
      expect([r.status, r.code, r.json.error?.params], q).toEqual([400, 'VALIDATION', { fields: { scope: 'INVALID' } }]);
      expect(r.text).not.toMatch(/CANARY|all|SERIES/);
    }
    expect(await seriesRows(s.data.seriesId!)).toBe(28);
  });

  it('PATCH วันหนึ่ง (แม้แค่ชื่อ) → วันนั้น seriesId = null · ลบทั้งชุดทีหลังไม่ลบวันที่หลุดไปแล้ว', async () => {
    const s = await createSeries(a, daily({ title: 'คลาส' }));
    const target = s.data.items[5]!.id;
    const p = await patch<{ busy: Own }>(a.c, `/api/me/busy/${target}`, { title: 'คลาสพิเศษ' });
    expect(p.status).toBe(200);
    expect(p.data.busy).toMatchObject({ id: target, title: 'คลาสพิเศษ', seriesId: null, startAt: s.data.items[5]!.startAt });
    expect((await h.rows<{ series_id: string | null }>('SELECT series_id FROM busy_block WHERE id = ?', [target]))[0]!.series_id).toBeNull();
    expect(await seriesRows(s.data.seriesId!)).toBe(27);
    const d = await del(a.c, `/api/me/busy/${s.data.items[0]!.id}?scope=series`);
    expect(d.data).toEqual({ deleted: true, count: 27 });
    expect(await h.count('busy_block WHERE id = ?', [target])).toBe(1);
  });

  it('PATCH เวลาของวันหนึ่งในชุด → หลุดจากชุดเช่นกัน · วันอื่นไม่เปลี่ยน', async () => {
    const s = await createSeries(a, daily());
    const target = s.data.items[0]!.id;
    const p = await patch<{ busy: Own }>(a.c, `/api/me/busy/${target}`, { kind: 'timed', startDate: '2026-11-03', startTime: '18:00', endDate: '2026-11-03', endTime: '19:00' });
    expect(p.data.busy).toMatchObject({ seriesId: null, startAt: Date.UTC(2026, 10, 3, 11) });
    const rest = await h.rows<{ start_at: number }>('SELECT start_at FROM busy_block WHERE series_id = ? ORDER BY start_at', [s.data.seriesId!]);
    expect(rest.map((r) => Number(r.start_at))).toEqual(s.data.items.slice(1).map((x) => x.startAt));
  });
});

describe('R6F-7 — คนอื่นในกลุ่มไม่เห็นว่าเป็นชุด (ไม่มี seriesId/series_id ในไบต์ใดของ response)', () => {
  const rand = () => randomBytes(6).toString('hex');

  it('ปฏิทินกลุ่ม · วันว่าง · เช็กนัดทับ: ชุดที่ซ่อนและไม่ซ่อน → ไม่มี key seriesId / ค่า seriesId / note · รายการซ่อนไม่มี title', async () => {
    const gid = await makeGroup(a, 'กลุ่ม');
    await join(a, b, gid);
    const CT = `CANARY-T-${rand()}`;
    const CH = `CANARY-H-${rand()}`;
    const CN = `CANARY-N-${rand()}`;
    const shown = await createSeries(a, daily({ startDate: '2026-11-03', endDate: '2026-11-10', title: CT, note: CN }));
    const hidden = await createSeries(a, daily({ startDate: '2026-11-03', endDate: '2026-11-10', startTime: '08:00', endTime: '09:00', title: CH, note: CN, hideDetail: true }));
    expect([shown.status, hidden.status]).toEqual([201, 201]);
    const secrets = [shown.data.seriesId!, hidden.data.seriesId!, CN, CH];
    const responses = [
      await get(b.c, `/api/groups/${gid}/calendar?from=2026-11-01&to=2026-11-30`),
      await get(b.c, `/api/groups/${gid}/availability?from=2026-11-03&to=2026-11-10`),
      await post(b.c, `/api/groups/${gid}/appointments/check`, { startDate: '2026-11-04', startTime: '08:00', endDate: '2026-11-04', endTime: '20:00' }),
      // เจ้าของเองดูผ่านกลุ่ม = เท่าที่เพื่อนเห็น
      await get(a.c, `/api/groups/${gid}/calendar?from=2026-11-01&to=2026-11-30`),
    ];
    for (const r of responses) {
      expect(r.status, r.text.slice(0, 200)).toBeLessThan(300);
      expect(r.text).not.toMatch(/seriesId|series_id/);
      for (const s of secrets) expect(r.text).not.toContain(s);
    }
    expect(responses[0]!.text).toContain(CT); // ชื่อที่ไม่ซ่อนยังเห็นตามโหมดเดิม
    const cal = responses[0]!.data as { busy: Record<string, unknown>[] };
    expect(cal.busy.filter((x) => x.userId === a.id)).toHaveLength(16);
    for (const x of cal.busy) expect('seriesId' in x).toBe(false);
  });

  it('SQL ฝั่งแชร์ (Drizzle .toSQL()) ไม่ SELECT series_id', () => {
    const q = sharedBusyInGroupQuery(h.db, newId(), 0, 1, 10).toSQL();
    expect(q.sql).not.toMatch(/series_id/i);
    expect(q.sql).not.toMatch(/note/i);
  });
});

describe('rate limit busy (main ตัดสิน R6F) — create 30 / delete 60 ต่อ 10 นาที ต่อผู้ใช้', () => {
  it(`create: ${BUSY_WRITE_RATE_LIMITS.create.limit} คำขอผ่าน (ชุดรายวันนับ 1) · ถัดไป 429 RATE_LIMITED + Retry-After ไม่เขียน · คนอื่นไม่โดน · หน้าต่างใหม่ได้`, async () => {
    expect(BUSY_WRITE_RATE_LIMITS.create).toMatchObject({ limit: 30, windowMs: 10 * MIN });
    // จัดนาฬิกาให้อยู่ต้นหน้าต่าง 10 นาที
    h.clock.advance(10 * MIN - (h.clock.now() % (10 * MIN)));
    for (let i = 0; i < 30; i++) {
      const body = i % 2 === 0 ? daily({ startDate: '2026-11-03', endDate: '2026-11-04' }) : { kind: 'all_day', startDate: '2026-11-05', endDate: '2026-11-05' };
      expect((await post(a.c, '/api/me/busy', body)).status, `#${i}`).toBe(201);
    }
    const before = await h.count('busy_block WHERE user_id = ?', [a.id]);
    expect(before).toBe(15 * 2 + 15);
    const r = await createSeries(a, daily());
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(before);
    expect((await createSeries(b, daily())).status).toBe(201);
    h.clock.advance(10 * MIN);
    expect((await createSeries(a, daily({ startDate: '2026-12-01', endDate: '2026-12-02' }))).status).toBe(201);
  });

  it('create: อินพุตผิด/เพดาน 62 วันไม่กินโควตา (ตรวจก่อนจองช่อง)', async () => {
    h.clock.advance(10 * MIN - (h.clock.now() % (10 * MIN)));
    for (let i = 0; i < 35; i++) expect((await createSeries(a, daily({ endTime: '17:00' }))).status).toBe(400);
    expect((await createSeries(a, daily())).status).toBe(201);
  });

  it(`delete: ${BUSY_WRITE_RATE_LIMITS.delete.limit} คำขอผ่าน (รวม 404) · ถัดไป 429 ไม่ลบ · PATCH ไม่ถูกจำกัด`, async () => {
    expect(BUSY_WRITE_RATE_LIMITS.delete).toMatchObject({ limit: 60, windowMs: 10 * MIN });
    h.clock.advance(10 * MIN - (h.clock.now() % (10 * MIN)));
    const ids = await seedActive(a.id, 61);
    for (let i = 0; i < 59; i++) expect((await del(a.c, `/api/me/busy/${ids[i]}`)).status, `#${i}`).toBe(200);
    expect((await del(a.c, '/api/me/busy/00000000-0000-4000-8000-00000000dead')).status).toBe(404); // ครั้งที่ 60 (404 ก็นับ)
    const r = await call(a.c, 'DELETE', `/api/me/busy/${ids[59]}?scope=series`);
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await h.count('busy_block WHERE user_id = ?', [a.id])).toBe(2);
    expect((await patch(a.c, `/api/me/busy/${ids[59]}`, { title: 'ยังแก้ได้' })).status).toBe(200);
    h.clock.advance(10 * MIN);
    expect((await del(a.c, `/api/me/busy/${ids[59]}`)).status).toBe(200);
  });
});
