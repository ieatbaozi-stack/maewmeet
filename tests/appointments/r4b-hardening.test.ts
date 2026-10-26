// R4B hardening (SEC M1 · QA M1/M2/L1/L2 · SEC L5) — limiter เขียน · เพดานสร้างต่อกลุ่มต่อวัน · coalesce แจ้งเตือน · สมาชิกภาพรอบใหม่ · แก้เวลานัดที่กำลังเกิดอยู่ · นัดที่จบแล้ว
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/lib/shared/id';
import {
  APPOINTMENT_MAX_CREATED_PER_GROUP_PER_DAY,
  APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX,
  APPOINTMENT_WRITE_RATE_LIMITS,
} from '@/lib/shared/limits';
import { DAY, HOUR, MIN, createAppt, get, join, mustCreate, patch, post, put, seedAppointments, setupHarness, world, type ApptDto, type Harness, type Person, type World } from './util';

let h: Harness;
let w: World;

beforeEach(async () => {
  h = await setupHarness();
  w = await world(h);
});
afterEach(async () => {
  await h.cleanup();
});

const detail = (p: Person, id: string) => get<{ appointment: ApptDto }>(p.c, `/api/appointments/${id}`);
const notifs = (p: Person) => get<{ notifications: { kind: string; params: Record<string, unknown> }[]; unreadCount: number }>(p.c, '/api/me/notifications?limit=50');
const rsvp = (p: Person, id: string, response = 'going') => put(p.c, `/api/appointments/${id}/rsvp`, { response });
const cancel = (p: Person, id: string) => post(p.c, `/api/appointments/${id}/cancel`);

/** แทรกนัดที่ยกเลิกแล้วตรง ๆ ผ่าน SQL โดยให้ created_at = ตอนนี้ (นับเพดานสร้างต่อวัน) */
async function seedCancelledRecent(gid: string, by: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await h.rows(
      `INSERT INTO appointment (id, group_id, title, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at, cancelled_at, cancelled_by)
       VALUES (?, ?, 'old', ?, ?, 'Asia/Bangkok', '2026-11-01', 'cancelled', ?, ?, ?, ?, ?)`,
      [newId(), gid, h.clock.now() + DAY, h.clock.now() + DAY + HOUR, by, h.clock.now(), h.clock.now(), h.clock.now(), by],
    );
  }
}

describe('SEC M1(a) limiter เขียนต่อผู้ใช้', () => {
  const L = APPOINTMENT_WRITE_RATE_LIMITS;

  it('สร้างได้ 10 ครั้งใน 10 นาที ครั้งที่ 11 → 429 RATE_LIMITED + Retry-After · ผู้ใช้อื่นไม่กระทบ · หน้าต่างถัดไปใช้ได้', async () => {
    for (let i = 0; i < L.createShort.limit; i++) {
      h.clock.advance(1000);
      expect((await createAppt(w.b, w.gid, { title: `n${i}` })).status).toBe(201);
    }
    const r = await createAppt(w.b, w.gid);
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(Number(r.headers.get('retry-after'))).toBeLessThanOrEqual(600);
    expect((await createAppt(w.c, w.gid)).status).toBe(201);
    h.clock.advance(10 * MIN);
    expect((await createAppt(w.b, w.gid)).status).toBe(201);
  });

  it('วนสร้าง+ยกเลิก (ยกเลิกคืนโควตา active) ไม่หลุด limiter และไม่ท่วมกระดิ่ง', async () => {
    let created = 0;
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const r = await createAppt(w.b, w.gid);
      if (r.status === 201) {
        created++;
        expect((await cancel(w.b, r.data.appointment.id)).status).toBe(200);
      } else {
        expect(r.code).toBe('RATE_LIMITED');
        limited++;
      }
    }
    expect(created).toBe(L.createShort.limit);
    expect(limited).toBe(30);
    // 3 ผู้รับ × ≤ 10 แถว (ไม่ใช่ 120)
    expect(await h.count("notification WHERE kind = 'appointment.created'")).toBeLessThanOrEqual(3 * L.createShort.limit);
  });

  it('เพดานรายวันต่อผู้ใช้ 30/วัน (ข้ามกลุ่มรวมกัน) · ครบแล้ว 429 จนข้ามหน้าต่างวัน', async () => {
    // สร้างต่อเนื่อง 3 หน้าต่าง 10 นาที = 30 ครั้ง (ผู้สร้างคนเดียว, หลายกลุ่มเพื่อไม่ชนเพดานกลุ่ม/วัน)
    const gids = [w.gid];
    for (let i = 0; i < 2; i++) {
      const g = (await post<{ group: { id: string } }>(w.b.c, '/api/groups', { name: `กลุ่ม ${i}` })).data.group.id;
      gids.push(g);
    }
    let ok = 0;
    for (let win = 0; win < 3; win++) {
      for (let i = 0; i < L.createShort.limit; i++) if ((await createAppt(w.b, gids[win]!)).status === 201) ok++;
      h.clock.advance(10 * MIN);
    }
    expect(ok).toBe(L.createDay.limit);
    const r = await createAppt(w.b, gids[0]!);
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(600);
    h.clock.advance(DAY);
    expect((await createAppt(w.b, gids[0]!)).status).toBe(201);
  });

  it('ยิงสร้างพร้อมกัน 25 คำขอจากคนเดียว → สำเร็จ 10 ที่เหลือ 429 · แถวนัดไม่เกิน 10 · notification ไม่เกิน 3×10', async () => {
    const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => createAppt(w.b, w.gid, { title: `burst ${i}` })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(L.createShort.limit);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(25 - L.createShort.limit);
    expect(await h.count('appointment WHERE group_id = ?', [w.gid])).toBe(L.createShort.limit);
    expect(await h.count("notification WHERE kind = 'appointment.created'")).toBe(3 * L.createShort.limit);
  });

  it('update 60 ครั้ง/10 นาที · ครั้งที่ 61 → 429 · ไม่กระทบ create/rsvp ของคนเดียวกัน', async () => {
    const ap = await mustCreate(w.a, w.gid);
    for (let i = 0; i < L.update.limit; i++) expect((await patch(w.a.c, `/api/appointments/${ap.id}`, { title: `t${i}` })).status).toBe(200);
    const r = await patch(w.a.c, `/api/appointments/${ap.id}`, { title: 'เกิน' });
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect((await rsvp(w.a, ap.id)).status).toBe(200);
    h.clock.advance(10 * MIN);
    expect((await patch(w.a.c, `/api/appointments/${ap.id}`, { title: 'หลังหน้าต่าง' })).status).toBe(200);
  });

  it('cancel 60 ครั้ง/10 นาที · ครั้งที่ 61 → 429', async () => {
    const ids = await seedAppointments(h, w.gid, w.a.id, L.cancel.limit + 1, h.clock.now() + DAY);
    for (let i = 0; i < L.cancel.limit; i++) expect((await cancel(w.a, ids[i]!)).status).toBe(200);
    const r = await cancel(w.a, ids[L.cancel.limit]!);
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });

  it('rsvp 120 ครั้ง/10 นาที · ครั้งที่ 121 → 429', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const flip = ['going', 'maybe', 'not_going'];
    for (let i = 0; i < L.rsvp.limit; i++) expect((await rsvp(w.b, ap.id, flip[i % 3])).status).toBe(200);
    const r = await rsvp(w.b, ap.id);
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
  });

  it('คำขอที่ไม่มีสิทธิ์/ไม่พบ/ตรวจ input ไม่ผ่าน ไม่กินโควตา และ NOT_FOUND ไม่เปลี่ยน', async () => {
    for (let i = 0; i < 15; i++) {
      expect((await createAppt(w.o, w.gid)).status).toBe(404);
      expect((await createAppt(w.b, w.gid, { title: '' })).status).toBe(400);
    }
    expect(await h.count("rate_limit_bucket WHERE key LIKE 'appt:%'")).toBe(0);
    expect((await createAppt(w.b, w.gid)).status).toBe(201);
  });

  it('ใช้งานปกติไม่ถูกบล็อก: สร้าง 3 · แก้ · ตอบ RSVP หลายครั้ง · ยกเลิก', async () => {
    const aps: ApptDto[] = [];
    for (let i = 0; i < 3; i++) aps.push(await mustCreate(w.a, w.gid, { title: `ปกติ ${i}` }));
    for (const ap of aps) {
      expect((await patch(w.a.c, `/api/appointments/${ap.id}`, { description: 'x' })).status).toBe(200);
      for (const p of [w.b, w.c, w.m]) expect((await rsvp(p, ap.id)).status).toBe(200);
    }
    expect((await cancel(w.a, aps[0]!.id)).status).toBe(200);
  });
});

describe('SEC M1(b) เพดานสร้างต่อกลุ่มต่อ 24 ชม. (นับรวมที่ยกเลิก)', () => {
  const MAX = APPOINTMENT_MAX_CREATED_PER_GROUP_PER_DAY;

  it('มี 30 นัดที่ยกเลิกแล้วสร้างใน 24 ชม. → สร้างต่อ 409 LIMIT_REACHED { limit: appointmentsPerDay, max: 30 } · ครบ 24 ชม. สร้างได้', async () => {
    await seedCancelledRecent(w.gid, w.a.id, MAX);
    const r = await createAppt(w.b, w.gid);
    expect([r.status, r.code]).toEqual([409, 'LIMIT_REACHED']);
    expect(r.json.error?.params).toMatchObject({ limit: 'appointmentsPerDay', max: MAX });
    expect(await h.count('appointment WHERE group_id = ?', [w.gid])).toBe(MAX);
    h.clock.advance(DAY - 1);
    expect((await createAppt(w.b, w.gid)).status).toBe(409);
    h.clock.advance(2);
    expect((await createAppt(w.b, w.gid)).status).toBe(201);
  });

  it('สร้าง+ยกเลิกวนด้วยหลายคนจนครบ 30 แล้วถูกกัน (limiter ต่อคนยังไม่เต็ม)', async () => {
    const people = [w.a, w.m, w.b, w.c];
    let created = 0;
    let capped = 0;
    for (let i = 0; i < 36; i++) {
      const r = await createAppt(people[i % 4]!, w.gid);
      if (r.status === 201) {
        created++;
        await cancel(people[i % 4]!, r.data.appointment.id);
      } else {
        expect(r.code).toBe('LIMIT_REACHED');
        expect(r.json.error?.params).toMatchObject({ limit: 'appointmentsPerDay' });
        capped++;
      }
    }
    expect([created, capped]).toEqual([MAX, 6]);
  });

  it('พร้อมกัน: เหลือที่ว่าง 2 แล้ว 4 คนยิงพร้อมกัน → สำเร็จ 2 ที่เหลือ 409', async () => {
    await seedCancelledRecent(w.gid, w.a.id, MAX - 2);
    const rs = await Promise.all([w.a, w.m, w.b, w.c].map((p) => createAppt(p, w.gid)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await h.count('appointment WHERE group_id = ?', [w.gid])).toBe(MAX);
  });

  it('กลุ่มอื่นไม่ถูกนับร่วม', async () => {
    await seedCancelledRecent(w.gid, w.a.id, MAX);
    const g2 = (await post<{ group: { id: string } }>(w.a.c, '/api/groups', { name: 'อีกกลุ่ม' })).data.group.id;
    expect((await createAppt(w.a, g2)).status).toBe(201);
  });
});

describe('SEC M1(c) coalesce แจ้งเตือน appointment.created ที่ยังไม่อ่าน', () => {
  const MAX = APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX;

  async function seedUnread(userId: string, gid: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await h.rows(
        'INSERT INTO notification (id, user_id, kind, params, created_at) VALUES (?, ?, ?, ?, ?)',
        [newId(), userId, 'appointment.created', JSON.stringify({ groupId: gid, groupName: 'ก๊วนแมว', appointmentId: newId(), title: 'เก่า', startAt: 1, tz: 'Asia/Bangkok' }), h.clock.now()],
      );
    }
  }

  it('ผู้รับที่มี unread ของกลุ่มนี้ครบ 20 ไม่ได้แถวเพิ่ม · คนอื่นได้ตามปกติ · นัดยังสร้างสำเร็จ', async () => {
    h.clock.advance(1000);
    await seedUnread(w.c.id, w.gid, MAX);
    const r = await createAppt(w.a, w.gid);
    expect(r.status).toBe(201);
    expect((await notifs(w.c)).data.unreadCount).toBe(MAX);
    expect((await notifs(w.b)).data.unreadCount).toBe(1);
    expect((await notifs(w.m)).data.unreadCount).toBe(1);
  });

  it('เพดานแยกต่อกลุ่ม · อ่านแล้วไม่นับ → กลับมารับได้', async () => {
    h.clock.advance(1000);
    await seedUnread(w.c.id, w.gid, MAX - 1);
    await createAppt(w.a, w.gid); // ครบ 20
    h.clock.advance(1000);
    await createAppt(w.a, w.gid); // ข้าม
    expect((await notifs(w.c)).data.unreadCount).toBe(MAX);
    const g2 = (await post<{ group: { id: string } }>(w.a.c, '/api/groups', { name: 'กลุ่มสอง' })).data.group.id;
    await join(w.a, w.c, g2);
    expect((await createAppt(w.a, g2)).status).toBe(201);
    expect((await notifs(w.c)).data.unreadCount).toBe(MAX + 1);
    expect((await post(w.c.c, '/api/me/notifications/read', { all: true })).status).toBeLessThan(500);
    await h.rows('UPDATE notification SET read_at = ? WHERE user_id = ?', [h.clock.now(), w.c.id]);
    h.clock.advance(1000);
    await createAppt(w.a, w.gid);
    expect((await notifs(w.c)).data.unreadCount).toBe(1);
  });

  it('วนสร้าง+ยกเลิกยาว ๆ: กระดิ่งของผู้รับแต่ละคนไม่เกิน 20 ต่อกลุ่ม', async () => {
    for (let win = 0; win < 3; win++) {
      for (let i = 0; i < 10; i++) {
        const who = [w.a, w.m, w.b][win]!;
        const r = await createAppt(who, w.gid);
        if (r.status === 201) await cancel(who, r.data.appointment.id);
      }
      h.clock.advance(10 * MIN);
    }
    for (const p of [w.a, w.m, w.b, w.c]) expect((await notifs(p)).data.unreadCount).toBeLessThanOrEqual(MAX);
  });
});

describe('QA M1 / L2 / SEC L5: ออกแล้วกลับเข้ากลุ่ม ไม่ฟื้น RSVP/แจ้งเตือนเก่า', () => {
  it('RSVP เก่าไม่นับ/ไม่แสดง/ไม่เป็น mine ทั้งรายละเอียด รายการกลุ่ม และ me/appointments · ตอบใหม่แล้วนับ', async () => {
    const ap = await mustCreate(w.a, w.gid);
    h.clock.advance(1000);
    await rsvp(w.b, ap.id, 'going');
    await rsvp(w.c, ap.id, 'maybe');
    expect((await detail(w.a, ap.id)).data.appointment.rsvp.counts).toMatchObject({ going: 1, maybe: 1 });

    h.clock.advance(1000);
    expect((await post(w.b.c, `/api/groups/${w.gid}/leave`)).status).toBe(200);
    h.clock.advance(1000);
    await join(w.a, w.b, w.gid);

    const d = (await detail(w.b, ap.id)).data.appointment;
    expect(d.rsvp.mine).toBeNull();
    expect(d.rsvp.counts).toMatchObject({ going: 0, maybe: 1, noResponse: 3 });
    expect(JSON.stringify(d.rsvp.members ?? {})).not.toContain(w.b.id);
    const list = (await get<{ appointments: ApptDto[] }>(w.a.c, `/api/groups/${w.gid}/appointments`)).data.appointments;
    expect(list[0]!.rsvp.counts.going).toBe(0);
    const mine = (await get<{ appointments: ApptDto[] }>(w.b.c, '/api/me/appointments')).data.appointments;
    expect(mine.find((x) => x.id === ap.id)!.rsvp).toMatchObject({ mine: null, counts: { going: 0 } });

    h.clock.advance(1000);
    expect((await rsvp(w.b, ap.id, 'not_going')).status).toBe(200);
    const d2 = (await detail(w.b, ap.id)).data.appointment;
    expect(d2.rsvp.mine).toBe('not_going');
    expect(d2.rsvp.counts.not_going).toBe(1);
  });

  it('แจ้งเตือน appointment.* ก่อน joined_at ปัจจุบันถูกซ่อนและไม่นับ unread · อันใหม่หลังกลับเข้ามาเห็น · ชนิดอื่นไม่ถูกซ่อน', async () => {
    h.clock.advance(1000);
    await mustCreate(w.a, w.gid, { title: 'ก่อนออก' });
    await post(w.b.c, '/api/me/notifications/read', { ids: [] }).catch(() => undefined);
    await h.rows("INSERT INTO notification (id, user_id, kind, params, created_at) VALUES (?, ?, 'pin_reset.approved', '{\"expiresAt\":1}', ?)", [newId(), w.b.id, h.clock.now()]);
    expect((await notifs(w.b)).data.unreadCount).toBe(2);

    h.clock.advance(1000);
    await post(w.b.c, `/api/groups/${w.gid}/leave`);
    h.clock.advance(1000);
    await join(w.a, w.b, w.gid);

    const after = (await notifs(w.b)).data;
    expect(after.notifications.map((n) => n.kind)).toEqual(['pin_reset.approved']);
    expect(after.unreadCount).toBe(1);

    h.clock.advance(1000);
    await mustCreate(w.a, w.gid, { title: 'หลังกลับ' });
    const again = (await notifs(w.b)).data;
    expect(again.unreadCount).toBe(2);
    expect(again.notifications.filter((n) => n.kind === 'appointment.created').map((n) => n.params.title)).toEqual(['หลังกลับ']);
    // ผู้ที่ไม่เคยออกยังเห็นทั้งสอง
    expect((await notifs(w.c)).data.notifications.filter((n) => n.kind === 'appointment.created')).toHaveLength(2);
  });
});

describe('QA M2: แก้เวลานัดที่กำลังเกิดอยู่', () => {
  const ongoing = { startDate: '2026-10-18', startTime: '09:30', endDate: '2026-10-18', endTime: '14:00' };

  it('ขยายเวลาจบโดยไม่เปลี่ยนเวลาเริ่ม (เริ่มมาแล้ว > 1 ชม.) → 200 · เปลี่ยนเวลาเริ่มไปย้อนหลัง > 1 ชม. → ยัง 400 IN_PAST', async () => {
    const ap = await mustCreate(w.a, w.gid, ongoing); // now 10:00 → เริ่มย้อน 30 นาที ผ่านด่านสร้าง
    h.clock.advance(90 * MIN); // now 11:30 → เริ่มมาแล้ว 2 ชม.
    const ext = await patch<{ appointment: ApptDto }>(w.a.c, `/api/appointments/${ap.id}`, { ...ongoing, endTime: '18:00' });
    expect(ext.status, JSON.stringify(ext.json)).toBe(200);
    expect(ext.data.appointment.endAt - ext.data.appointment.startAt).toBe(8.5 * HOUR);
    expect(ext.data.appointment.startAt).toBe(ap.startAt);
    const moved = await patch(w.a.c, `/api/appointments/${ap.id}`, { ...ongoing, startTime: '09:00' });
    expect([moved.status, moved.code]).toEqual([400, 'VALIDATION']);
    expect(moved.json.error?.params).toMatchObject({ fields: { startTime: 'IN_PAST' } });
    // end ต้อง > start เสมอ
    const bad = await patch(w.a.c, `/api/appointments/${ap.id}`, { ...ongoing, endTime: '09:30' });
    expect(bad.status).toBe(400);
  });

  it('ย่อเวลาจบเข้ามาที่ยังหลังเวลาเริ่ม (แม้ผ่านไปแล้ว) ทำได้ — ต้องการแค่ end > start', async () => {
    const ap = await mustCreate(w.a, w.gid, ongoing);
    h.clock.advance(90 * MIN);
    const r = await patch(w.a.c, `/api/appointments/${ap.id}`, { ...ongoing, endTime: '10:30' });
    expect(r.status).toBe(200);
  });

  it('ตอนสร้างยังตรวจย้อนหลัง ≤ 1 ชม. ตามเดิม', async () => {
    expect((await createAppt(w.a, w.gid, { ...ongoing, startTime: '08:30' })).status).toBe(400);
  });
});

describe('QA L1: นัดที่จบแล้วแต่ยัง active', () => {
  const short = { startDate: '2026-10-18', startTime: '10:00', endDate: '2026-10-18', endTime: '11:00' };

  it('แก้ → 409 APPOINTMENT_PAST · ยกเลิก → 409 APPOINTMENT_PAST · permissions.canEdit/canCancel/canRsvp = false · ก่อนจบยังแก้/ยกเลิกได้', async () => {
    const live = await mustCreate(w.a, w.gid, short);
    const ap = await mustCreate(w.a, w.gid, short);
    expect((await detail(w.a, ap.id)).data.appointment.permissions).toEqual({ canEdit: true, canCancel: true, canRsvp: true });
    expect((await patch(w.a.c, `/api/appointments/${live.id}`, { title: 'ก่อนจบ' })).status).toBe(200);
    h.clock.advance(2 * HOUR);
    const e = await patch(w.a.c, `/api/appointments/${ap.id}`, { title: 'หลังจบ' });
    expect([e.status, e.code]).toEqual([409, 'APPOINTMENT_PAST']);
    const c = await cancel(w.a, ap.id);
    expect([c.status, c.code]).toEqual([409, 'APPOINTMENT_PAST']);
    // super admin/moderator ก็ไม่ได้
    expect((await cancel(w.m, ap.id)).code).toBe('APPOINTMENT_PAST');
    expect((await cancel(w.boss, ap.id)).code).toBe('APPOINTMENT_PAST');
    const d = (await detail(w.a, ap.id)).data.appointment;
    expect(d.status).toBe('active');
    expect(d.title).toBe('กินข้าว');
    expect(d.permissions).toEqual({ canEdit: false, canCancel: false, canRsvp: false });
    expect(await h.count("audit_log WHERE action IN ('appointment.update','appointment.cancel') AND target_id = ?", [ap.id])).toBe(0);
  });

  it('นัดที่ยกเลิกแล้วยังตอบ APPOINTMENT_CANCELLED ก่อน (ลำดับรหัสเดิม)', async () => {
    const ap = await mustCreate(w.a, w.gid, short);
    expect((await cancel(w.a, ap.id)).status).toBe(200);
    h.clock.advance(2 * HOUR);
    expect((await cancel(w.a, ap.id)).code).toBe('APPOINTMENT_CANCELLED');
    expect((await patch(w.a.c, `/api/appointments/${ap.id}`, { title: 'x' })).code).toBe('APPOINTMENT_CANCELLED');
  });
});

