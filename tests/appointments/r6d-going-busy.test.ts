// R6D G2 — กด "ไป" = ไม่ว่างจริงทุกกลุ่ม (ADR 0009) · ระดับ API จริง (handler + DB + migration จริง)
//  R6D-3 Scenario A · R6D-4 canary ข้ามกลุ่ม (JSON ดิบ) · R6D-5b myConflicts/myConflict · R6D-6 วันว่าง/เตือนนัดทับนับ going · ADR 0009 §4 exclude
//  Scenario A: A อยู่ "ลั้ลลา" (A+B) และ "แอ่ว" (A+C+D) · นัดกินข้าว 7 ต.ค. 12:00–15:00 (เวลากรุงเทพฯ) ในลั้ลลา
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BUSY_VIEW_FIELDS } from '@/lib/data/serializers/busy';
import { call, get, join, makeGroup, patch, person, post, put, setupHarness, type Harness, type Person } from './util';

const BKK = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 7, m); // ต.ค. 2026 เวลากรุงเทพฯ → epoch
const rnd = () => randomBytes(6).toString('hex');
const CANARY_TITLE = `CANARY-AT-${rnd()}`;
const CANARY_PLACE = `CANARY-AP-${rnd()}`;
const CANARY_GROUP = `CANARY-G-${rnd()}`;

type View = Record<string, unknown> & { kind: string; userId: string; startAt: number; endAt: number };
type Cal = { busy: View[]; truncated: boolean };
type Av = { busy: View[]; days: { date: string; segments: { start: string; end: string }[]; blockers: { userId: string; itemIdx: number[] }[]; notFreeUserIds: string[] }[] };
type Overlap = { status: string; blocked: { userId: string; items: View[] }[] };
type Conflict = Record<string, unknown> & { kind: string; title: string | null };
type Detail = { id: string; title: string; groupName: string; rsvp: { mine: string | null }; myConflicts: Conflict[]; myConflictsTruncated: boolean };
type ListItem = { id: string; title: string; groupName: string; myConflict?: boolean };

let h: Harness;
let A: Person, B: Person, C: Person, D: Person;
let lalla: string; // ลั้ลลา (B admin, A)
let aew: string; // แอ่ว (C admin, A, D)
let lunch: string; // นัดกินข้าวในลั้ลลา

const LUNCH = { startDate: '2026-10-07', startTime: '12:00', endDate: '2026-10-07', endTime: '15:00' };
const OCT = 'from=2026-10-01&to=2026-10-31';

const calendar = async (p: Person, gid: string) => {
  const r = await get<Cal>(p.c, `/api/groups/${gid}/calendar?${OCT}`);
  expect(r.status, r.text).toBe(200);
  return r;
};
const availability = async (p: Person, gid: string) => {
  const r = await get<Av>(p.c, `/api/groups/${gid}/availability?from=2026-10-07&to=2026-10-07`);
  expect(r.status, r.text).toBe(200);
  return r;
};
const rsvp = async (p: Person, id: string, response: string) => {
  const r = await put<{ appointment: Detail }>(p.c, `/api/appointments/${id}/rsvp`, { response });
  expect(r.status, r.text).toBe(200);
  return r;
};
const goingOf = (busy: View[]) => busy.filter((b) => b.kind !== 'busy');
const create = async (p: Person, gid: string, title: string, slot: Record<string, string>, extra: Record<string, unknown> = {}) => {
  const r = await post<{ appointment: Detail; overlap: Overlap }>(p.c, `/api/groups/${gid}/appointments`, { title, ...slot, ...extra });
  expect(r.status, r.text).toBe(201);
  return r;
};

beforeAll(async () => {
  h = await setupHarness({ startAt: Date.UTC(2026, 9, 1, 3) }); // 2026-10-01 10:00 BKK — นัด 7 ต.ค. ยังไม่ผ่าน
  [A, B, C, D] = [await person(h, 'aa'), await person(h, 'bb'), await person(h, 'cc'), await person(h, 'dd')];
  lalla = await makeGroup(B, CANARY_GROUP);
  await join(B, A, lalla);
  aew = await makeGroup(C, 'แอ่ว');
  await join(C, A, aew);
  await join(C, D, aew);
  lunch = (await create(B, lalla, CANARY_TITLE, LUNCH, { placeName: CANARY_PLACE })).data.appointment.id;
  h.clock.advance(60_000);
});
afterAll(async () => {
  await h.cleanup();
});

describe('R6D-3 Scenario A — กติกานับ going', () => {
  it('ยังไม่ตอบ / อาจจะไป / ไม่ไป → ทั้งสองกลุ่มเห็น A ว่าง (ไม่มีรายการ going)', async () => {
    expect(goingOf((await calendar(C, aew)).data.busy)).toEqual([]);
    for (const resp of ['maybe', 'not_going']) {
      await rsvp(A, lunch, resp);
      expect(goingOf((await calendar(C, aew)).data.busy)).toEqual([]);
      expect(goingOf((await calendar(B, lalla)).data.busy)).toEqual([]);
      const d = (await availability(D, aew)).data.days[0]!;
      expect(d.segments.map((s) => `${s.start}-${s.end}`)).toEqual(['08:00-22:00']);
    }
  });

  it('A ตอบ "ไป" → แอ่วเห็น other_group_appointment 12:00–15:00 ของ A (key ครบตาม allowlist เท่านั้น) · ลั้ลลาเห็น appointment + title', async () => {
    await rsvp(A, lunch, 'going');
    const aewBusy = goingOf((await calendar(C, aew)).data.busy);
    expect(aewBusy).toEqual([{ kind: 'other_group_appointment', userId: A.id, startAt: BKK(7, 12), endAt: BKK(7, 15) }]);
    expect(Object.keys(aewBusy[0]!).sort()).toEqual([...BUSY_VIEW_FIELDS.other_group_appointment].sort());
    z.object({ kind: z.literal('other_group_appointment'), userId: z.uuid(), startAt: z.number(), endAt: z.number() }).strict().parse(aewBusy[0]);

    const lallaBusy = goingOf((await calendar(B, lalla)).data.busy);
    expect(lallaBusy).toEqual([{ kind: 'appointment', appointmentId: lunch, userId: A.id, title: CANARY_TITLE, startAt: BKK(7, 12), endAt: BKK(7, 15) }]);
    expect(Object.keys(lallaBusy[0]!).sort()).toEqual([...BUSY_VIEW_FIELDS.appointment].sort());
  });

  it('วันว่างตรงกัน (แอ่ว 7 ต.ค. หน้าต่าง 08–22 ขั้นต่ำ 120) = ค่าที่คำนวณมือ: 08:00–12:00 + 15:00–22:00 · blockers ของ A ชี้รายการ other_group', async () => {
    const av = (await availability(D, aew)).data;
    const d = av.days[0]!;
    expect(d.segments.map((s) => `${s.start}-${s.end}`)).toEqual(['08:00-12:00', '15:00-22:00']);
    expect(d.notFreeUserIds).toEqual([]); // A ยังว่าง 4 ชม. ≥ 120 นาที
    const blk = d.blockers.find((b) => b.userId === A.id)!;
    expect(blk.itemIdx.map((i) => av.busy[i]!.kind)).toEqual(['other_group_appointment']);
  });

  it('ตัวเตือนนัดทับ (check) ในแอ่วนับนัดที่ A ตอบไป · ชนขอบพอดีไม่นับ', async () => {
    const hit = await post<{ overlap: Overlap }>(C.c, `/api/groups/${aew}/appointments/check`, { startDate: '2026-10-07', startTime: '14:00', endDate: '2026-10-07', endTime: '16:00' });
    expect(hit.status, hit.text).toBe(200);
    expect(hit.data.overlap.blocked.map((b) => [b.userId, b.items.map((i) => i.kind)])).toEqual([[A.id, ['other_group_appointment']]]);
    const edge = await post<{ overlap: Overlap }>(C.c, `/api/groups/${aew}/appointments/check`, { startDate: '2026-10-07', startTime: '15:00', endDate: '2026-10-07', endTime: '16:00' });
    expect(edge.data.overlap.blocked).toEqual([]);
  });

  it('เปลี่ยนใจเป็น "ไม่ไป" → กลับมาว่างทั้งสองกลุ่มทันที · ตอบ "ไป" ใหม่ → กลับมา', async () => {
    await rsvp(A, lunch, 'not_going');
    expect(goingOf((await calendar(C, aew)).data.busy)).toEqual([]);
    expect(goingOf((await calendar(B, lalla)).data.busy)).toEqual([]);
    await rsvp(A, lunch, 'going');
    expect(goingOf((await calendar(C, aew)).data.busy)).toHaveLength(1);
  });

  it('A ออกจากลั้ลลา → ไม่นับ (main ตัดสิน (ก)) · กลับเข้าใหม่ → คำตอบเก่าไม่ฟื้น · ตอบใหม่ → นับ', async () => {
    expect((await post(A.c, `/api/groups/${lalla}/leave`)).status).toBe(200);
    expect(goingOf((await calendar(C, aew)).data.busy)).toEqual([]);
    h.clock.advance(60_000);
    await join(B, A, lalla);
    expect(goingOf((await calendar(C, aew)).data.busy)).toEqual([]);
    expect(goingOf((await calendar(B, lalla)).data.busy)).toEqual([]);
    h.clock.advance(60_000);
    await rsvp(A, lunch, 'going');
    expect(goingOf((await calendar(C, aew)).data.busy)).toHaveLength(1);
  });
});

describe('R6D-4 — canary: API ของแอ่วไม่มีชื่อนัด/สถานที่/ชื่อกลุ่ม/id ของลั้ลลา (JSON ดิบ)', () => {
  const forbidden = () => [CANARY_TITLE, CANARY_PLACE, CANARY_GROUP, lunch, lalla];
  const clean = (label: string, text: string) => {
    for (const s of forbidden()) expect(text.includes(s), `${label} มี ${s}`).toBe(false);
  };

  it('calendar / availability / check / สร้าง / แก้ นัดในแอ่ว — ไม่พบ canary ทั้งหมด แต่พบช่วงของ A', async () => {
    const cal = await calendar(D, aew);
    clean('calendar', cal.text);
    expect(cal.text).toContain('other_group_appointment');
    clean('availability', (await availability(D, aew)).text);
    const chk = await post(C.c, `/api/groups/${aew}/appointments/check`, { ...LUNCH, appointmentId: lunch });
    expect(chk.status).toBe(200);
    clean('check', chk.text);
    expect(chk.text).toContain('other_group_appointment'); // ใส่ id นัดกลุ่มอื่น → ไม่มีผล (ADR 0009 §4)
    const made = await create(C, aew, 'ทับกินข้าว', { startDate: '2026-10-07', startTime: '13:00', endDate: '2026-10-07', endTime: '14:00' });
    clean('create', made.text);
    expect(made.data.overlap.blocked.map((b) => b.userId)).toEqual([A.id]);
    const upd = await patch(C.c, `/api/appointments/${made.data.appointment.id}`, { title: 'ทับกินข้าว 2' });
    expect(upd.status, upd.text).toBe(200);
    clean('update', upd.text);
    // ลบนัดทดสอบนี้ทิ้ง (ไม่ให้กระทบเทสต์ myConflicts)
    expect((await post(C.c, `/api/appointments/${made.data.appointment.id}/cancel`)).status).toBe(200);
  });

  it('Cache-Control: private, no-store ยังอยู่ (calendar / availability / detail)', async () => {
    expect((await calendar(D, aew)).headers.get('cache-control')).toBe('private, no-store');
    expect((await availability(D, aew)).headers.get('cache-control')).toBe('private, no-store');
    expect((await get(A.c, `/api/appointments/${lunch}`)).headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('ADR 0009 §4 — computeOverlap ตัดนัดตัวเองออก', () => {
  it('แก้นัดกินข้าว: A (ตอบไป) ไม่ถูกเตือนว่าชนนัดตัวเอง · check พร้อม appointmentId เดียวกัน → ไม่ติด · ไม่ส่ง → ติด (kind appointment)', async () => {
    const upd = await patch<{ overlap: Overlap }>(B.c, `/api/appointments/${lunch}`, { description: 'แก้คำอธิบาย' });
    expect(upd.status, upd.text).toBe(200);
    expect(upd.data.overlap.blocked).toEqual([]);
    const withId = await post<{ overlap: Overlap }>(B.c, `/api/groups/${lalla}/appointments/check`, { ...LUNCH, appointmentId: lunch });
    expect(withId.data.overlap.blocked).toEqual([]);
    const without = await post<{ overlap: Overlap }>(B.c, `/api/groups/${lalla}/appointments/check`, LUNCH);
    expect(without.data.overlap.blocked.map((b) => [b.userId, b.items.map((i) => i.kind)])).toEqual([[A.id, ['appointment']]]);
    const bad = await post(B.c, `/api/groups/${lalla}/appointments/check`, { ...LUNCH, appointmentId: 'nope' });
    expect(bad.status).toBe(400);
  });
});

describe('R6D-5b — myConflicts (เฉพาะ session user) + myConflict ในรายการ', () => {
  let movie: string; // แอ่ว 7 ต.ค. 14:00–16:00 (ทับกินข้าว)
  let edge: string; // แอ่ว 7 ต.ค. 10:00–12:00 (ชนขอบกินข้าวพอดี)
  let morning: string; // แอ่ว 8 ต.ค. 09:00–10:00 (ทับ busy ทั้งวันของ A)
  const BUSY_TITLE = `ส่วนตัว-${rnd()}`;

  beforeAll(async () => {
    movie = (await create(C, aew, 'ดูหนัง', { startDate: '2026-10-07', startTime: '14:00', endDate: '2026-10-07', endTime: '16:00' })).data.appointment.id;
    edge = (await create(C, aew, 'ขอบ', { startDate: '2026-10-07', startTime: '10:00', endDate: '2026-10-07', endTime: '12:00' })).data.appointment.id;
    morning = (await create(C, aew, 'เช้าวันแปด', { startDate: '2026-10-08', startTime: '09:00', endDate: '2026-10-08', endTime: '10:00' })).data.appointment.id;
    const b1 = await post(A.c, '/api/me/busy', { kind: 'timed', startDate: '2026-10-07', startTime: '15:30', endDate: '2026-10-07', endTime: '17:00', title: BUSY_TITLE, hideDetail: true });
    expect(b1.status, b1.text).toBe(201);
    const b2 = await post(A.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-10-08', endDate: '2026-10-08' });
    expect(b2.status, b2.text).toBe(201);
  });

  it('รายละเอียดนัดดูหนังของ A: ชนกินข้าว (กลุ่มอื่น — มีชื่อ+กลุ่มของตัวเอง) + busy ซ่อนรายละเอียดของตัวเองพร้อม title · เรียงเวลาเริ่ม', async () => {
    const r = await get<{ appointment: Detail }>(A.c, `/api/appointments/${movie}`);
    expect(r.status).toBe(200);
    const c = r.data.appointment.myConflicts;
    expect(c.map((x) => [x.kind, x.title])).toEqual([
      ['appointment', CANARY_TITLE],
      ['busy', BUSY_TITLE],
    ]);
    expect(c[0]).toMatchObject({ appointmentId: lunch, groupId: lalla, groupName: CANARY_GROUP, startAt: BKK(7, 12), endAt: BKK(7, 15), tz: 'Asia/Bangkok' });
    expect(Object.keys(c[1]!).sort()).toEqual(['allDay', 'busyId', 'endAt', 'kind', 'localEndDate', 'localStartDate', 'startAt', 'title', 'tz']);
    expect(r.data.appointment.myConflictsTruncated).toBe(false);
    expect(r.text).not.toContain('"note"');
  });

  it('ชนขอบพอดีไม่นับ · busy ทั้งวันของตัวเองถูกนับ (title null เมื่อไม่ได้กรอก)', async () => {
    expect((await get<{ appointment: Detail }>(A.c, `/api/appointments/${edge}`)).data.appointment.myConflicts).toEqual([]);
    const m = (await get<{ appointment: Detail }>(A.c, `/api/appointments/${morning}`)).data.appointment.myConflicts;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: 'busy', allDay: true, title: null, localStartDate: '2026-10-08', localEndDate: '2026-10-08' });
  });

  it('สมาชิกคนอื่น (D, C) เปิดนัดเดียวกัน → myConflicts ของเขาเอง (ว่าง) และไม่มีข้อมูลชนของ A หลุด', async () => {
    for (const p of [D, C]) {
      const r = await get<{ appointment: Detail }>(p.c, `/api/appointments/${movie}`);
      expect(r.data.appointment.myConflicts).toEqual([]);
      for (const s of [CANARY_TITLE, CANARY_GROUP, BUSY_TITLE, lunch, lalla]) expect(r.text.includes(s), s).toBe(false);
    }
  });

  it('PUT rsvp "ไป" คืน myConflicts (ไม่รวมนัดตัวเอง) · การ์ดในรายการ: นัดที่ตอบไปและทับ → myConflict true · ที่ไม่ได้ตอบไป → false', async () => {
    const r = await rsvp(A, movie, 'going');
    expect(r.data.appointment.myConflicts.map((x) => x.kind)).toEqual(['appointment', 'busy']);
    expect(r.data.appointment.myConflicts.some((x) => x.appointmentId === movie)).toBe(false);
    const list = await get<{ appointments: ListItem[] }>(A.c, '/api/me/appointments');
    const flag = Object.fromEntries(list.data.appointments.map((a) => [a.id, a.myConflict]));
    expect(flag[lunch]).toBe(true);
    expect(flag[movie]).toBe(true);
    expect(flag[edge]).toBe(false);
    expect(flag[morning]).toBe(false);
    // สมาชิกอื่นดูรายการกลุ่ม → myConflict ของตัวเอง (D ไม่ได้ตอบ → false ทั้งหมด)
    const dl = await get<{ appointments: ListItem[] }>(D.c, `/api/groups/${aew}/appointments`);
    expect(dl.data.appointments.every((a) => a.myConflict === false)).toBe(true);
  });

  it('GET /api/me/appointments?rsvp=going → เฉพาะนัดที่ฉันตอบไป (ทุกกลุ่ม พร้อมชื่อกลุ่มของตัวเอง) · rsvp อื่น → 400', async () => {
    const r = await get<{ appointments: ListItem[] }>(A.c, '/api/me/appointments?rsvp=going');
    expect(r.status, r.text).toBe(200);
    expect(r.data.appointments.map((a) => [a.title, a.groupName])).toEqual([
      [CANARY_TITLE, CANARY_GROUP],
      ['ดูหนัง', 'แอ่ว'],
    ]);
    const d = await get<{ appointments: ListItem[] }>(D.c, '/api/me/appointments?rsvp=going');
    expect(d.data.appointments).toEqual([]);
    const bad = await get(A.c, '/api/me/appointments?rsvp=maybe');
    expect(bad.status).toBe(400);
    expect(bad.json.error?.params).toEqual({ fields: { rsvp: 'INVALID' } });
  });

  it('ปฏิทินแอ่ว: A ตอบไปทั้งนัดลั้ลลาและนัดแอ่ว → นัดแอ่วเป็น appointment (มี title) · นัดลั้ลลาเป็น other_group (ไม่มี title)', async () => {
    const g = goingOf((await calendar(D, aew)).data.busy).filter((b) => b.userId === A.id);
    expect(g.map((b) => b.kind)).toEqual(['other_group_appointment', 'appointment']);
    expect(g[1]).toMatchObject({ appointmentId: movie, title: 'ดูหนัง' });
  });
});

describe('R6D-3 ต่อ — ยกเลิกนัด / ลบกลุ่ม → หายทันที', () => {
  it('B ยกเลิกนัดกินข้าว → แอ่วไม่เห็นช่วงของ A จากลั้ลลาอีก · รายละเอียดนัดที่ยกเลิก → myConflicts []', async () => {
    expect((await post(B.c, `/api/appointments/${lunch}/cancel`)).status).toBe(200);
    const g = goingOf((await calendar(D, aew)).data.busy);
    expect(g.filter((b) => b.kind === 'other_group_appointment')).toEqual([]);
    expect((await get<{ appointment: Detail }>(A.c, `/api/appointments/${lunch}`)).data.appointment.myConflicts).toEqual([]);
  });

  it('นัดใหม่ในลั้ลลาที่ A ตอบไป แล้ว B ลบกลุ่ม → ไม่นับ', async () => {
    const id = (await create(B, lalla, 'นัดสอง', { startDate: '2026-10-09', startTime: '12:00', endDate: '2026-10-09', endTime: '13:00' })).data.appointment.id;
    await rsvp(A, id, 'going');
    expect(goingOf((await calendar(D, aew)).data.busy).filter((b) => b.kind === 'other_group_appointment')).toHaveLength(1);
    const del = await call(B.c, 'DELETE', `/api/groups/${lalla}`);
    expect([200, 204], del.text).toContain(del.status);
    expect(goingOf((await calendar(D, aew)).data.busy).filter((b) => b.kind === 'other_group_appointment')).toEqual([]);
  });
});
