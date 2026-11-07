// R7 เฟส B (R7_CONTRACT §3.1 B-2/B-3/B-4) — ฝั่ง platform: ผลเท่าเดิมทุกไบต์ + ยังตรวจสิทธิ์ที่เซิร์ฟเวอร์ (R7-5)
//  B-2: openGroupCalendar / openGroupAvailability — ด่านกลุ่มครั้งเดียว คืน tz/role แล้ว load(range) = getGroupCalendar/getGroupAvailability ทุกไบต์
//  B-3: loadGroupCtx คืนแถวกลุ่ม (ตัด findGroupById) · สมาชิก ∥ busy หลังผ่านด่าน
//  B-4: groupNamesAndMemberCounts · คำมั่นไม่รอ rsvps · RSVP ไม่อ่าน access ซ้ำ · POST busy RETURNING · getHomeFeed
// API ทั้งหมดเรียกผ่าน handler จริง (harness) — เทียบกับ service ด้วย JSON.stringify (ลำดับคีย์ด้วย)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dataCtx } from '@/lib/data/context';
import { findOwnBusy, insertBusyIfUnderCap } from '@/lib/data/repos/busy';
import { groupNamesAndMemberCounts } from '@/lib/data/repos/appointment';
import { getGroupAvailability, openGroupAvailability } from '@/lib/data/services/availability';
import { getGroupCalendar, openGroupCalendar } from '@/lib/data/services/calendar';
import { listMyAppointments } from '@/lib/data/services/appointments';
import { getHomeFeed } from '@/lib/data/services/home';
import { loadGroupCtx } from '@/lib/data/policy-context';
import { newId } from '@/lib/shared/id';
import { AppError } from '@/lib/shared/errors';
import type { Actor, UserActor } from '@/lib/rbac/types';
import { get, join, makeGroup, patch, person, post, put, setupHarness, SLOT, type Harness, type Person } from '../appointments/util';
import { del } from '../groups/harness';

let h: Harness;
let A: Person; // admin ของ G
let B: Person; // member ของ G
let O: Person; // คนนอก
let S: Person; // super admin (ไม่ใช่สมาชิก)
let L: Person; // ไม่มีกลุ่ม
let G: string;
let appt: string;

const actorOf = (p: Person, isSuperAdmin = false): UserActor => ({ kind: 'user', id: p.id, isSuperAdmin, status: 'active', mustChangePin: false });
const ctx = () => dataCtx(new Request('https://maewmeet.test/x'), h.clock.now());
const RANGE = { from: '2026-10-01', to: '2026-10-31' };
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppError ? e.code : `THROW ${String(e)}`;
  }
};

beforeAll(async () => {
  h = await setupHarness();
  [A, B, O, S, L] = [await person(h, 'pa'), await person(h, 'pb'), await person(h, 'po'), await person(h, 'ps', { admin: true }), await person(h, 'pl')];
  G = await makeGroup(A, 'กลุ่ม B');
  await join(A, B, G);
  expect((await patch(A.c, `/api/groups/${G}`, { minFreeMinutes: 60 })).status).toBe(200);
  for (const [p, d, s, e] of [
    [A, '2026-10-20', '09:00', '12:00'],
    [B, '2026-10-20', '11:00', '15:00'],
    [B, '2026-10-24', '10:30', '11:30'],
  ] as const) {
    expect((await post(p.c, '/api/me/busy', { kind: 'timed', startDate: d, startTime: s, endDate: d, endTime: e, title: 'งาน' })).status).toBe(201);
  }
  expect((await post(A.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-10-22', endDate: '2026-10-23', title: 'ลา' })).status).toBe(201);
  const r = await post<{ appointment: { id: string } }>(B.c, `/api/groups/${G}/appointments`, { title: 'นัด', ...SLOT });
  expect(r.status, r.text).toBe(201);
  appt = r.data.appointment.id;
  expect((await put(A.c, `/api/appointments/${appt}/rsvp`, { response: 'going' })).status).toBe(200);
}, 120_000);
afterAll(async () => {
  await h.cleanup();
});

describe('B-3 — loadGroupCtx คืนแถวกลุ่มมาด้วย (query เดียว)', () => {
  it('สมาชิก: role + แถวกลุ่มครบ · คนนอก (และ SA นอกกลุ่ม): role null แต่มีแถว · ไม่มีกลุ่ม/anonymous: gone + row null', async () => {
    const db = ctx().db;
    const mine = await loadGroupCtx(db, actorOf(A), G);
    expect(mine).toMatchObject({ id: G, deleted: false, actorRole: 'admin' });
    expect(mine.row).toMatchObject({ id: G, name: 'กลุ่ม B', tz: 'Asia/Bangkok', minFreeMinutes: 60, deletedAt: null });
    const outsider = await loadGroupCtx(db, actorOf(O), G);
    expect(outsider).toMatchObject({ id: G, deleted: false, actorRole: null });
    expect(outsider.row?.id).toBe(G);
    const missing = newId();
    expect(await loadGroupCtx(db, actorOf(A), missing)).toEqual({ id: missing, deleted: true, actorRole: null, row: null });
    expect(await loadGroupCtx(db, { kind: 'anonymous' }, G)).toEqual({ id: G, deleted: true, actorRole: null, row: null });
  });
});

describe('B-2 — openGroupCalendar / openGroupAvailability', () => {
  it('สมาชิก: group = {id, tz, myRole} · load(range) เท่ากับ getGroup* ทุกไบต์ (และเท่ากับ API)', async () => {
    const c = ctx();
    const cal = await openGroupCalendar(actorOf(B), G, c);
    expect(cal.group).toEqual({ id: G, tz: 'Asia/Bangkok', myRole: 'member' });
    const viaHandle = await cal.load(RANGE);
    expect(JSON.stringify(viaHandle)).toBe(JSON.stringify(await getGroupCalendar(actorOf(B), G, RANGE, c)));
    const api = await get(B.c, `/api/groups/${G}/calendar?from=${RANGE.from}&to=${RANGE.to}`);
    expect(api.status).toBe(200);
    expect(api.json).toEqual({ data: JSON.parse(JSON.stringify(viaHandle)) });
    expect(viaHandle.busy.length).toBeGreaterThan(0);

    const av = await openGroupAvailability(actorOf(A), G, c);
    expect(av.group).toEqual({ id: G, tz: 'Asia/Bangkok', myRole: 'admin' });
    const a1 = await av.load(RANGE);
    expect(JSON.stringify(a1)).toBe(JSON.stringify(await getGroupAvailability(actorOf(A), G, RANGE, c)));
    const apiA = await get(A.c, `/api/groups/${G}/availability?from=${RANGE.from}&to=${RANGE.to}`);
    expect(apiA.json).toEqual({ data: JSON.parse(JSON.stringify(a1)) });
    expect(a1.days.some((d) => d.blockers.length > 0)).toBe(true);
  });

  it('สิทธิ์: คนนอก / กลุ่มไม่มี → NOT_FOUND · anonymous → AUTH_REQUIRED (ตอนเปิด ก่อนแตะข้อมูลอื่น)', async () => {
    const c = ctx();
    for (const open of [openGroupCalendar, openGroupAvailability]) {
      expect(await code(open(actorOf(O), G, c))).toBe('NOT_FOUND');
      expect(await code(open(actorOf(A), newId(), c))).toBe('NOT_FOUND');
      expect(await code(open({ kind: 'anonymous' } as Actor, G, c))).toBe('AUTH_REQUIRED');
    }
  });

  it('ช่วงวันที่ตรวจตอน load เหมือน API (REQUIRED / BEFORE_FROM)', async () => {
    const cal = await openGroupCalendar(actorOf(A), G, ctx());
    expect(await code(cal.load({ from: '2026-10-01' }))).toBe('VALIDATION');
    const av = await openGroupAvailability(actorOf(A), G, ctx());
    expect(await code(av.load({ from: '2026-10-31', to: '2026-10-01' }))).toBe('VALIDATION');
  });

  it('super admin นอกกลุ่ม: เปิดได้ (myRole null) และ audit การอ่านทุกครั้งที่ load', async () => {
    const before = await h.count("audit_log WHERE actor_id = ? AND action = 'group.calendar.view'", [S.id]);
    const cal = await openGroupCalendar(actorOf(S, true), G, ctx());
    expect(cal.group.myRole).toBeNull();
    expect(await h.count("audit_log WHERE actor_id = ? AND action = 'group.calendar.view'", [S.id])).toBe(before); // เปิดเฉย ๆ ยังไม่ได้อ่านข้อมูล
    await cal.load(RANGE);
    expect(await h.count("audit_log WHERE actor_id = ? AND action = 'group.calendar.view'", [S.id])).toBe(before + 1);
    const av = await openGroupAvailability(actorOf(S, true), G, ctx());
    await av.load(RANGE);
    expect(await h.count("audit_log WHERE actor_id = ? AND action = 'group.availability.view'", [S.id])).toBe(1);
  });
});

describe('B-4 — รายการนัด / RSVP / busy / หน้าหลัก', () => {
  it('groupNamesAndMemberCounts: ชื่อ + จำนวนสมาชิก · กลุ่มที่ไม่มี → ไม่อยู่ใน Map · [] → 0 query', async () => {
    const db = ctx().db;
    const missing = newId();
    const m = await groupNamesAndMemberCounts(db, [G, missing]);
    expect([...m.entries()]).toEqual([[G, { name: 'กลุ่ม B', memberCount: 2 }]]);
    expect((await groupNamesAndMemberCounts(db, [])).size).toBe(0);
  });

  it('รายการนัด: myConflict / จำนวนสมาชิก (rsvp.counts.noResponse) / groupName ถูก (A ไปนัดที่ทับ busy ของ B ไม่นับ · ของ A เองไม่ทับ)', async () => {
    const mine = await get<{ appointments: { id: string; myConflict: boolean; rsvp: { counts: { noResponse: number } }; groupName: string }[] }>(A.c, '/api/me/appointments');
    expect(mine.status).toBe(200);
    expect(mine.data.appointments.map((a) => [a.id, a.myConflict, a.rsvp.counts.noResponse, a.groupName])).toEqual([[appt, false, 1, 'กลุ่ม B']]); // สมาชิก 2 − ตอบแล้ว 1
    // A เพิ่ม busy ทับนัด → myConflict = true (คำมั่นที่ดึงพร้อม rsvps ครอบช่วงนัด)
    const b = await post<{ busy: { id: string } }>(A.c, '/api/me/busy', { kind: 'timed', startDate: SLOT.startDate, startTime: '10:30', endDate: SLOT.startDate, endTime: '12:00' });
    expect(b.status).toBe(201);
    const again = await get<{ appointments: { id: string; myConflict: boolean }[] }>(A.c, '/api/me/appointments');
    expect(again.data.appointments.map((a) => [a.id, a.myConflict])).toEqual([[appt, true]]);
    const group = await get<{ appointments: { id: string; myConflict: boolean }[] }>(A.c, `/api/groups/${G}/appointments`);
    expect(group.data.appointments.map((a) => [a.id, a.myConflict])).toEqual([[appt, true]]);
    // B ไม่ได้ตอบ going (ผู้สร้างไม่ถูกตอบให้อัตโนมัติ) → false แม้ busy ของ B ทับ
    const bList = await get<{ appointments: { id: string; myConflict: boolean }[] }>(B.c, '/api/me/appointments');
    expect(bList.data.appointments.map((a) => a.myConflict)).toEqual([false]);
    expect((await del(A.c, `/api/me/busy/${b.data.busy.id}`)).status).toBe(200);
  });

  it('RSVP: คำตอบของ PUT = GET รายละเอียดทันทีหลังจากนั้นทุกไบต์ (ไม่อ่าน access ซ้ำ แต่ผลเท่าเดิม)', async () => {
    for (const response of ['maybe', 'going'] as const) {
      const r = await put(A.c, `/api/appointments/${appt}/rsvp`, { response });
      expect(r.status, r.text).toBe(200);
      const g = await get(A.c, `/api/appointments/${appt}`);
      expect(r.text).toBe(g.text);
    }
  });

  it('RSVP ยังถูกปฏิเสธตามเดิม: คนนอก 404 · ไม่มีนัด 404', async () => {
    expect((await put(O.c, `/api/appointments/${appt}/rsvp`, { response: 'going' })).status).toBe(404);
    expect((await put(A.c, `/api/appointments/${newId()}/rsvp`, { response: 'going' })).status).toBe(404);
  });

  it('insertBusyIfUnderCap (RETURNING): แถวที่คืน = findOwnBusy ทุกคีย์/ชนิด/ลำดับคีย์ · ถูกปฏิเสธ → null', async () => {
    const db = ctx().db;
    const now = h.clock.now();
    const id = newId();
    const write = { title: 'ทดสอบ', note: 'โน้ต', allDay: false, startAt: now + 3_600_000, endAt: now + 7_200_000, localStartDate: '2026-10-18', localEndDate: '2026-10-18', tz: 'Asia/Bangkok', hideDetail: true };
    const row = await insertBusyIfUnderCap(db, { ...write, id, userId: A.id, cap: 300 }, now);
    const read = await findOwnBusy(db, id, A.id);
    expect(row).toStrictEqual(read);
    expect(Object.keys(row!)).toEqual(Object.keys(read!));
    const id2 = newId();
    const nulls = await insertBusyIfUnderCap(db, { ...write, title: null, note: null, allDay: true, hideDetail: false, id: id2, userId: A.id, cap: 300 }, now);
    expect(nulls).toStrictEqual(await findOwnBusy(db, id2, A.id));
    expect(await insertBusyIfUnderCap(db, { ...write, id: newId(), userId: A.id, cap: 0 }, now)).toBeNull();
    // POST /api/me/busy ยังตอบรูปเดิม = GET รายการเดียวกันของเจ้าของ
    const p = await post<{ busy: { id: string } }>(A.c, '/api/me/busy', { kind: 'timed', startDate: '2026-10-27', startTime: '08:00', endDate: '2026-10-27', endTime: '09:00', title: 'x', note: 'y' });
    expect(p.status).toBe(201);
    const list = await get<{ busy: { id: string }[] }>(A.c, '/api/me/busy?from=2026-10-27&to=2026-10-27');
    expect(list.data.busy.find((x) => x.id === p.data.busy.id)).toEqual(p.data.busy);
  });

  it('getHomeFeed: มีกลุ่ม → appointments = listMyAppointments ทุกไบต์ · ไม่มีกลุ่ม → hasGroups false, [] · anonymous → AUTH_REQUIRED', async () => {
    const c = ctx();
    const feed = await getHomeFeed(actorOf(A), { limit: '5' }, c);
    expect(feed.hasGroups).toBe(true);
    expect(JSON.stringify(feed.appointments)).toBe(JSON.stringify((await listMyAppointments(actorOf(A), { limit: '5' }, c)).appointments));
    expect(feed.appointments.length).toBe(1);
    expect(await getHomeFeed(actorOf(L), { limit: '5' }, c)).toEqual({ hasGroups: false, appointments: [] });
    // ไม่มีกลุ่ม: query ผิดของนัดไม่ทำให้ล้ม (เดิมไม่เรียกเลย)
    expect(await getHomeFeed(actorOf(L), { limit: 'x' }, c)).toEqual({ hasGroups: false, appointments: [] });
    expect(await code(getHomeFeed(actorOf(A), { limit: 'x' }, c))).toBe('VALIDATION');
    expect(await code(getHomeFeed({ kind: 'anonymous' }, { limit: '5' }, c))).toBe('AUTH_REQUIRED');
  });

  // ต้องอยู่ท้ายไฟล์: เลื่อนนาฬิกา + B ออก/กลับเข้ากลุ่ม
  it('viewerGoing (มากับแถวรายการ) ใช้กติกาเดียวกับ rsvps: ตอบก่อนเข้ากลุ่มรอบปัจจุบันไม่นับ → myConflict false · mine null', async () => {
    type L = { appointments: { id: string; myConflict: boolean; rsvp: { mine: string | null } }[] };
    expect((await put(B.c, `/api/appointments/${appt}/rsvp`, { response: 'going' })).status).toBe(200);
    const going = await get<L>(B.c, '/api/me/appointments'); // busy ของ B 10:30–11:30 ทับนัด 10:00–11:00
    expect(going.data.appointments.map((a) => [a.id, a.myConflict, a.rsvp.mine])).toEqual([[appt, true, 'going']]);
    const inGroup = await get<L>(B.c, `/api/groups/${G}/appointments`);
    expect(inGroup.data.appointments.map((a) => [a.id, a.myConflict, a.rsvp.mine])).toEqual([[appt, true, 'going']]);
    expect((await post(B.c, `/api/groups/${G}/leave`)).status).toBe(200);
    h.clock.advance(60_000);
    await join(A, B, G);
    const back = await get<L>(B.c, '/api/me/appointments');
    expect(back.data.appointments.map((a) => [a.id, a.myConflict, a.rsvp.mine])).toEqual([[appt, false, null]]);
    const backGroup = await get<L>(B.c, `/api/groups/${G}/appointments`);
    expect(backGroup.data.appointments.map((a) => [a.id, a.myConflict, a.rsvp.mine])).toEqual([[appt, false, null]]);
  });
});
