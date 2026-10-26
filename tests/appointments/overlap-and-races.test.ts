// R4B-2 เตือนนัดทับ (U10.1 · ADR 0005 §4 · ADR 0006 canary) + แข่งกัน (cap 99→100 · RSVP)
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAY, SLOT, createAppt, get, mustCreate, patch, post, put, seedAppointments, setupHarness, world, type Created, type Harness, type Overlap, type Person, type World } from './util';

let h: Harness;
let w: World;
const rand = () => randomBytes(6).toString('hex');
const CT = `CANARY-T-${rand()}`;
const CH = `CANARY-H-${rand()}`;
const CN = `CANARY-N-${rand()}`;

beforeEach(async () => {
  h = await setupHarness();
  w = await world(h);
});
afterEach(async () => {
  await h.cleanup();
});

const busy = (p: Person, body: Record<string, unknown>) => post<{ busy: { id: string } }>(p.c, '/api/me/busy', body);
const check = (p: Person, over: Record<string, unknown> = {}) => post<{ overlap: Overlap }>(p.c, `/api/groups/${w.gid}/appointments/check`, { ...SLOT, ...over });

// A (bob): 24 ต.ค. 10:00–12:00 (title เห็นได้ + note) · B (carol): ทั้งวัน 24 ต.ค. ซ่อนรายละเอียด
async function seedBusy() {
  expect((await busy(w.b, { kind: 'timed', startDate: '2026-10-24', startTime: '10:00', endDate: '2026-10-24', endTime: '12:00', title: CT, note: CN, hideDetail: false })).status).toBe(201);
  expect((await busy(w.c, { kind: 'all_day', startDate: '2026-10-25', endDate: '2026-10-25', title: CH, note: CN, hideDetail: true })).status).toBe(201);
}

describe('เตือนนัดทับ — ADR 0005 §4', () => {
  it('11:00–13:00 ทับ A (10–12) · 12:00–14:00 ชน A แค่ขอบ (ไม่ทับ) · ทั้งวันของ B ทับนัดใดก็ได้ในวันนั้น', async () => {
    await seedBusy();
    const hit = await check(w.a, { startTime: '11:00', endTime: '13:00' });
    expect(hit.status).toBe(200);
    expect(hit.data.overlap.status).toBe('ok');
    expect(hit.data.overlap.blocked.map((b) => b.userId)).toEqual([w.b.id]);
    expect(hit.data.overlap.blocked[0]).toMatchObject({ displayName: w.b.displayName });
    expect(hit.data.overlap.blocked[0]!.items).toHaveLength(1);

    const edge = await check(w.a, { startTime: '12:00', endTime: '14:00' });
    expect(edge.data.overlap).toEqual({ status: 'ok', blocked: [] });

    const allDay = await check(w.a, { startDate: '2026-10-25', startTime: '15:00', endDate: '2026-10-25', endTime: '16:00' });
    expect(allDay.data.overlap.blocked.map((b) => b.userId)).toEqual([w.c.id]);
  });

  it('สร้าง/แก้ได้เสมอ (ไม่บล็อก) และคืน overlap ชุดเดียวกับ check · ผู้สร้างเองก็นับถ้า busy ทับ', async () => {
    await seedBusy();
    const created = await createAppt(w.a, w.gid, { startTime: '11:00', endTime: '13:00' });
    expect(created.status).toBe(201);
    expect(created.data.overlap).toEqual((await check(w.a, { startTime: '11:00', endTime: '13:00' })).data.overlap);
    const ap = created.data.appointment;
    const moved = await patch<Created>(w.a.c, `/api/appointments/${ap.id}`, { startDate: '2026-10-25', startTime: '09:00', endDate: '2026-10-25', endTime: '10:00' });
    expect(moved.status).toBe(200);
    expect(moved.data.overlap.blocked.map((b) => b.userId)).toEqual([w.c.id]);
    const own = await createAppt(w.b, w.gid, { startTime: '10:00', endTime: '11:00' });
    expect(own.data.overlap.blocked.map((b) => b.userId)).toEqual([w.b.id]);
  });

  it('คนที่ออกจากกลุ่มแล้วไม่ถูกนับ · check ไม่เขียนอะไร (ยกเว้น audit อ่าน)', async () => {
    await seedBusy();
    const before = await h.count('appointment');
    await post(w.b.c, `/api/groups/${w.gid}/leave`);
    expect((await check(w.a, { startTime: '11:00', endTime: '13:00' })).data.overlap.blocked).toEqual([]);
    expect(await h.count('appointment')).toBe(before);
    expect(await h.count('notification WHERE kind = ?', ['appointment.created'])).toBe(0);
  });

  it('canary: note และ title ที่ซ่อนไม่ปรากฏใน check/สร้าง/แก้/รายละเอียด · title ที่ไม่ซ่อนเห็นได้เฉพาะรูปแบบที่ปฏิทินให้เห็น', async () => {
    await seedBusy();
    const bodies: string[] = [];
    bodies.push((await check(w.a, { startTime: '11:00', endTime: '13:00' })).text);
    bodies.push((await check(w.a, { startDate: '2026-10-25', startTime: '09:00', endDate: '2026-10-25', endTime: '10:00' })).text);
    const c1 = await createAppt(w.a, w.gid, { startTime: '11:00', endTime: '13:00' });
    bodies.push(c1.text);
    const c2 = await createAppt(w.a, w.gid, { startDate: '2026-10-25', startTime: '09:00', endDate: '2026-10-25', endTime: '10:00' });
    bodies.push(c2.text);
    bodies.push((await patch(w.a.c, `/api/appointments/${c1.data.appointment.id}`, { startTime: '10:30', endTime: '11:30' })).text);
    bodies.push((await get(w.c.c, `/api/appointments/${c1.data.appointment.id}`)).text, (await get(w.c.c, `/api/groups/${w.gid}/appointments`)).text, (await get(w.c.c, '/api/me/appointments')).text);
    bodies.push((await get(w.c.c, '/api/me/notifications')).text);
    for (const t of bodies) {
      expect(t).not.toContain(CN);
      expect(t).not.toContain(CH);
    }
    // B ซ่อน: รายการในคำเตือนไม่มี title
    const hidden = JSON.parse(c2.text).data.overlap.blocked[0].items[0] as Record<string, unknown>;
    expect(JSON.stringify(hidden)).not.toContain('title');
    expect(JSON.stringify(hidden)).not.toContain('note');
    // ฐานข้อมูลของแจ้งเตือนก็ไม่มี
    expect(JSON.stringify(await h.rows('SELECT params FROM notification'))).not.toMatch(/CANARY/);
  });

  it('check: สิทธิ์เหมือนสร้าง — คนนอก 404 · anonymous 401 · เวลาผิด 400 · key เกิน 400', async () => {
    expect((await check(w.o)).status).toBe(404);
    expect((await post(new (await import('./util')).Client(), `/api/groups/${w.gid}/appointments/check`, SLOT)).status).toBe(401);
    expect((await check(w.a, { startTime: '10:10' })).code).toBe('TIME_NOT_ON_STEP');
    expect((await check(w.a, { title: 'x' })).status).toBe(400);
  });
});

describe('แข่งกัน', () => {
  it('cap: มี 99 นัด แล้วยิงสร้างพร้อมกัน 6 คำขอ → สำเร็จ 1 ที่เหลือ 409 LIMIT_REACHED · รวมไม่เกิน 100', async () => {
    await seedAppointments(h, w.gid, w.a.id, 99, h.clock.now() + DAY);
    const actors = [w.a, w.m, w.b, w.c, w.a, w.b];
    const rs = await Promise.all(actors.map((p, i) => createAppt(p, w.gid, { title: `race ${i}` })));
    const ok = rs.filter((r) => r.status === 201);
    const full = rs.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(full).toHaveLength(5);
    for (const r of full) expect(r.code).toBe('LIMIT_REACHED');
    expect(full[0]!.json.error?.params).toMatchObject({ limit: 'appointments', max: 100 });
    expect(await h.count("appointment WHERE group_id = ? AND status = 'active'", [w.gid])).toBe(100);
    // ผู้แพ้ไม่ทิ้งแจ้งเตือน (atomic): แจ้งเตือนเท่ากับของผู้ชนะเท่านั้น (สมาชิก 3 คนที่ไม่ใช่ผู้สร้าง)
    expect(await h.count("notification WHERE kind = 'appointment.created'")).toBe(3);
  });

  it('cap: แก้นัดที่จบแล้ว/ยกเลิกไม่กินที่ · ย้ายนัดในกลุ่มเต็มได้ถ้าไม่เพิ่มจำนวนที่นับ', async () => {
    const ids = await seedAppointments(h, w.gid, w.a.id, 100, h.clock.now() + DAY);
    expect((await patch(w.a.c, `/api/appointments/${ids[3]}`, { title: 'ย้ายได้' })).status).toBe(200);
    expect((await createAppt(w.b, w.gid)).code).toBe('LIMIT_REACHED');
  });

  it('RSVP: หลายคนตอบพร้อมกัน + คนเดียวตอบรัว ๆ → แถวต่อคนเดียว คำตอบสุดท้ายเป็นค่าที่ถูกเขียนจริง', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const answers = ['going', 'maybe', 'not_going'] as const;
    const rs = await Promise.all([
      ...[w.a, w.m, w.b, w.c].map((p, i) => put(p.c, `/api/appointments/${ap.id}/rsvp`, { response: answers[i % 3] })),
      ...answers.map((a) => put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: a })),
    ]);
    for (const r of rs) expect(r.status, r.text).toBe(200);
    expect(await h.count('appointment_rsvp WHERE appointment_id = ?', [ap.id])).toBe(4);
    expect(await h.count('appointment_rsvp WHERE appointment_id = ? AND user_id = ?', [ap.id, w.b.id])).toBe(1);
    const d = (await get<{ appointment: Created['appointment'] }>(w.a.c, `/api/appointments/${ap.id}`)).data.appointment;
    const c = d.rsvp.counts;
    expect(c.going + c.maybe + c.not_going).toBe(4);
    expect(c.noResponse).toBe(0);
  });

  it('RSVP กับการออกจากกลุ่ม/ยกเลิกพร้อมกัน: ไม่มีแถวของคนนอกกลุ่มโผล่ในผลนับ', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const [r1] = await Promise.all([put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' }), post(w.b.c, `/api/groups/${w.gid}/leave`)]);
    expect([200, 404]).toContain(r1.status);
    const d = (await get<{ appointment: Created['appointment'] }>(w.a.c, `/api/appointments/${ap.id}`)).data.appointment;
    expect(JSON.stringify(d)).not.toContain(w.b.id);
    expect(d.rsvp.counts.going).toBe(0);
  });
});
