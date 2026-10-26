// R4B-1 — นัด: happy path · validation · D4 · IDOR · mass assignment · ยกเลิก · RSVP · รายการ/วันที่
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { APPOINTMENT_TITLE_MAX } from '@/lib/shared/limits';
import { Client, DAY, HOUR, SLOT, call, createAppt, get, join, makeGroup, mustCreate, patch, person, post, put, setupHarness, world, type ApptDto, type Harness, type World } from './util';

let h: Harness;
let w: World;

beforeEach(async () => {
  h = await setupHarness();
  w = await world(h);
});
afterEach(async () => {
  await h.cleanup();
});

type One = { appointment: ApptDto };
type List = { appointments: ApptDto[]; nextCursor: string | null };

describe('manifest', () => {
  it('11 เส้นทางของ R4B ลงทะเบียนครบ เจ้าของ platform auth=actor', () => {
    const mine = ROUTE_MANIFEST.filter((e) => e.owner === 'platform' && /appointments|notifications|places/.test(e.path));
    expect(mine.map((e) => `${e.method} ${e.path}`).sort()).toEqual(
      [
        'GET /api/appointments/:id',
        'GET /api/groups/:gid/appointments',
        'GET /api/me/appointments',
        'GET /api/me/notifications',
        'GET /api/places/search',
        'PATCH /api/appointments/:id',
        'POST /api/appointments/:id/cancel',
        'POST /api/groups/:gid/appointments',
        'POST /api/groups/:gid/appointments/check',
        'POST /api/me/notifications/read',
        'PUT /api/appointments/:id/rsvp',
      ].sort(),
    );
    for (const e of mine) expect(e.auth, e.path).toBe('actor');
  });
});

describe('สร้างนัด — happy path', () => {
  it('สมาชิกธรรมดาสร้างได้ · 201 · รูปร่างตรง · เวลา UTC + วันท้องถิ่น + tz กลุ่ม · Cache-Control private,no-store', async () => {
    const r = await createAppt(w.b, w.gid, {
      description: 'ไปกินข้าว\nแล้วดูหนัง',
      placeName: 'สยามพารากอน',
      lat: 13.7461,
      lng: 100.5347,
      mapUrl: 'https://www.openstreetmap.org/?mlat=13.7461&mlon=100.5347',
    });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const ap = r.data.appointment;
    expect(ap).toMatchObject({
      groupId: w.gid,
      groupName: 'ก๊วนแมว',
      title: 'กินข้าว',
      description: 'ไปกินข้าว\nแล้วดูหนัง',
      placeName: 'สยามพารากอน',
      lat: 13.7461,
      lng: 100.5347,
      tz: 'Asia/Bangkok',
      localDate: '2026-10-24',
      status: 'active',
      isPast: false,
      daysUntil: 6,
      cancelledAt: null,
      cancelledBy: null,
      createdBy: { userId: w.b.id },
      rsvp: { counts: { going: 0, maybe: 0, not_going: 0, noResponse: 4 }, mine: null },
      permissions: { canEdit: true, canCancel: true, canRsvp: true },
    });
    expect(ap.startAt).toBe(Date.UTC(2026, 9, 24, 3, 0, 0)); // 10:00 BKK
    expect(ap.endAt).toBe(Date.UTC(2026, 9, 24, 4, 0, 0));
    expect(r.data.overlap).toEqual({ status: 'ok', blocked: [] });
    expect(await h.count('appointment WHERE group_id = ?', [w.gid])).toBe(1);
    expect(await h.count("audit_log WHERE action = 'appointment.create'")).toBe(1);
  });

  it('ฟิลด์เสริมเป็น null เมื่อไม่ส่ง · ช่องว่างล้วน = null · ข้อความถูก trim', async () => {
    const ap = await mustCreate(w.a, w.gid, { title: '  ประชุม  ', description: '   ', placeName: ' ', mapUrl: '' });
    expect(ap).toMatchObject({ title: 'ประชุม', description: null, placeName: null, mapUrl: null, lat: null, lng: null });
  });

  it('GET รายละเอียด: สมาชิกทุก role เห็น · permissions ตาม role', async () => {
    const ap = await mustCreate(w.b, w.gid);
    const perms = async (p: typeof w.a) => (await get<One>(p.c, `/api/appointments/${ap.id}`)).data.appointment.permissions;
    expect(await perms(w.b)).toEqual({ canEdit: true, canCancel: true, canRsvp: true });
    expect(await perms(w.a)).toEqual({ canEdit: true, canCancel: true, canRsvp: true });
    expect(await perms(w.m)).toEqual({ canEdit: true, canCancel: true, canRsvp: true });
    expect(await perms(w.c)).toEqual({ canEdit: false, canCancel: false, canRsvp: true });
  });
});

describe('validation matrix (สร้าง)', () => {
  const bad = async (over: Record<string, unknown>, code = 'VALIDATION') => {
    const r = await createAppt(w.a, w.gid, over);
    expect([r.status, r.code], JSON.stringify(over)).toEqual([400, code]);
    expect(await h.count('appointment')).toBe(0);
    return r;
  };

  it('title: ว่าง · ว่างหลัง trim · ยาวเกิน 80 · ตัวควบคุม/bidi', async () => {
    await bad({ title: '' });
    await bad({ title: '   ' });
    await bad({ title: 'ก'.repeat(APPOINTMENT_TITLE_MAX + 1) });
    await bad({ title: 'a\u0000b' });
    await bad({ title: 'a‮b' });
    expect((await createAppt(w.a, w.gid, { title: 'ก'.repeat(APPOINTMENT_TITLE_MAX) })).status).toBe(201);
  });

  it('เวลา: ไม่ลงตัว 30 นาที · end<=start · รูปแบบผิด · ย้อนหลังเกิน 1 ชม. · ยาวเกิน 62 วัน', async () => {
    await bad({ startTime: '10:15', endTime: '11:00' }, 'TIME_NOT_ON_STEP');
    await bad({ endTime: '10:00' }, 'INVALID_RANGE');
    await bad({ endTime: '09:30' }, 'INVALID_RANGE');
    await bad({ startDate: '24/10/2026' }, 'INVALID_DATE');
    await bad({ startTime: '25:00' });
    await bad({ startDate: '2026-02-30', endDate: '2026-02-30' }, 'INVALID_DATE');
    await bad({ startDate: '2026-10-18', startTime: '08:30', endDate: '2026-10-18', endTime: '09:00' }); // 1.5 ชม. ก่อนตอนนี้ (10:00)
    const long = await bad({ endDate: '2026-12-26' }, 'LIMIT_REACHED');
    expect(long.json.error?.params).toMatchObject({ limit: 'appointmentSpan' });
    // เริ่มย้อน 1 ชม. พอดีได้
    expect((await createAppt(w.a, w.gid, { startDate: '2026-10-18', startTime: '09:00', endDate: '2026-10-18', endTime: '09:30' })).status).toBe(201);
  });

  it('lat/lng: มีตัวเดียว · เกินช่วง · ไม่ใช่ตัวเลข', async () => {
    await bad({ lat: 13.7 }, 'INVALID_COORDINATES');
    await bad({ lng: 100.5 }, 'INVALID_COORDINATES');
    await bad({ lat: 91, lng: 100 }, 'INVALID_COORDINATES');
    await bad({ lat: 10, lng: 181 }, 'INVALID_COORDINATES');
    await bad({ lat: '13.7', lng: '100.5' });
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['http', 'http://example.com/map'],
    ['credentials', 'https://user:pw@example.com/'],
    ['protocol-relative', '//example.com/x'],
    ['มีช่องว่างกลาง', 'https://example.com/a b'],
    ['ยาวเกิน 500', `https://example.com/${'a'.repeat(500)}`],
  ])('mapUrl ไม่ปลอดภัย (%s) → 400 INVALID_MAP_URL', async (_n, url) => {
    await bad({ mapUrl: url }, url.length > 2000 ? 'VALIDATION' : 'INVALID_MAP_URL');
  });

  it('description: ยาวเกิน 1000 · ตัวควบคุม · ฟิลด์ผิดชนิด · มี key เกิน (strict)', async () => {
    await bad({ description: 'ก'.repeat(1001) });
    await bad({ description: 'a\u0007b' });
    await bad({ description: 5 });
    await bad({ surprise: 1 });
    expect((await createAppt(w.a, w.gid, { description: 'ก'.repeat(1000) })).status).toBe(201);
  });
});

describe('mass assignment', () => {
  it.each(['groupId', 'createdBy', 'status', 'cancelledBy', 'cancelledAt', 'tz', 'id', 'localDate', 'startAt', 'endAt', 'createdAt'])('สร้าง: key %s ใน body → 400 และไม่เขียนแถว', async (k) => {
    const r = await createAppt(w.a, w.gid, { [k]: k === 'startAt' || k === 'endAt' || k === 'createdAt' ? 1 : 'x' });
    expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
    expect(await h.count('appointment')).toBe(0);
  });

  it.each(['groupId', 'createdBy', 'status', 'tz', 'id'])('แก้: key %s → 400 · แถวไม่เปลี่ยน', async (k) => {
    const ap = await mustCreate(w.a, w.gid);
    const r = await patch(w.a.c, `/api/appointments/${ap.id}`, { title: 'ใหม่', [k]: 'x' });
    expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
    const [row] = await h.rows<{ title: string }>('SELECT title FROM appointment WHERE id = ?', [ap.id]);
    expect(row!.title).toBe('กินข้าว');
  });

  it('RSVP: body ที่มี userId → 400 (ตอบแทนคนอื่นไม่ได้)', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const r = await put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going', userId: w.c.id });
    expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
    expect(await h.count('appointment_rsvp')).toBe(0);
  });
});

describe('D4 matrix — ใครทำอะไรได้ (นัดของ bob = สมาชิกธรรมดา)', () => {
  const gate = async (who: 'creator' | 'admin' | 'moderator' | 'member' | 'super' | 'outsider' | 'removed' | 'anon' | 'suspended' | 'pin') => {
    const ap = await mustCreate(w.b, w.gid);
    let c: Client;
    switch (who) {
      case 'creator': c = w.b.c; break;
      case 'admin': c = w.a.c; break;
      case 'moderator': c = w.m.c; break;
      case 'member': c = w.c.c; break;
      case 'super': c = w.boss.c; break;
      case 'outsider': c = w.o.c; break;
      case 'anon': c = new Client(); break;
      case 'removed': {
        const x = await person(h, 'rex');
        await join(w.a, x, w.gid);
        expect((await call(w.a.c, 'DELETE', `/api/groups/${w.gid}/members/${x.id}`)).status).toBe(200);
        c = x.c;
        break;
      }
      case 'suspended': {
        const x = await person(h, 'sue');
        await join(w.a, x, w.gid);
        await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [x.id]);
        c = x.c;
        break;
      }
      case 'pin': {
        const x = await person(h, 'pin');
        await join(w.a, x, w.gid);
        await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [x.id]);
        c = x.c;
        break;
      }
    }
    return {
      ap,
      view: (await get(c, `/api/appointments/${ap.id}`)).status,
      edit: (await patch(c, `/api/appointments/${ap.id}`, { title: 'แก้โดย ' + who })),
      rsvp: (await put(c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' })),
      create: (await createAppt({ c } as typeof w.a, w.gid, { title: 'x-' + who })).status,
      cancel: (await post(c, `/api/appointments/${ap.id}/cancel`)),
    };
  };

  it('ผู้สร้าง/admin/moderator: แก้และยกเลิกได้', async () => {
    for (const who of ['creator', 'admin', 'moderator'] as const) {
      const r = await gate(who);
      expect([r.view, r.edit.status, r.rsvp.status, r.create, r.cancel.status], who).toEqual([200, 200, 200, 201, 200]);
    }
  });

  it('สมาชิกธรรมดาที่ไม่ใช่ผู้สร้าง: เห็น/ตอบ/สร้างได้ แต่แก้-ยกเลิก = 403 FORBIDDEN (ไม่ใช่ 404) · แถวไม่เปลี่ยน', async () => {
    const r = await gate('member');
    expect([r.view, r.rsvp.status, r.create]).toEqual([200, 200, 201]);
    expect([r.edit.status, r.edit.code]).toEqual([403, 'FORBIDDEN']);
    expect([r.cancel.status, r.cancel.code]).toEqual([403, 'FORBIDDEN']);
    const [row] = await h.rows<{ title: string; status: string }>('SELECT title, status FROM appointment WHERE id = ?', [r.ap.id]);
    expect(row).toEqual({ title: 'กินข้าว', status: 'active' });
  });

  it('super admin ที่ไม่ใช่สมาชิก: เห็น/แก้/ยกเลิกได้ · ตอบ RSVP ไม่ได้ (403) · สร้างไม่ได้', async () => {
    const r = await gate('super');
    expect(r.view).toBe(200);
    expect(r.edit.status).toBe(200);
    expect([r.rsvp.status, r.rsvp.code]).toEqual([403, 'FORBIDDEN']);
    expect(r.cancel.status).toBe(200);
    // RBAC: super admin สร้างนัดในกลุ่มใดก็ได้ (audit ธง super admin) — ไม่ใช่สมาชิกจึงไม่มีชื่อผู้สร้างใน DTO และแจ้งสมาชิกทุกคน
    expect(r.create).toBe(201);
    expect(await h.count("appointment WHERE title = 'x-super' AND created_by = ?", [w.boss.id])).toBe(1);
    expect(await h.count('notification WHERE kind = ? AND user_id = ?', ['appointment.created', w.a.id])).toBeGreaterThan(0);
  });

  it.each(['outsider', 'removed'] as const)('%s: ทุก endpoint 404 NOT_FOUND ตัวเดียวกับ id ที่ไม่มีอยู่', async (who) => {
    const r = await gate(who);
    const ghost = await get(r.edit.status ? (who === 'outsider' ? w.o.c : w.o.c) : w.o.c, `/api/appointments/00000000-0000-4000-8000-000000000000`);
    expect(r.view).toBe(404);
    for (const x of [r.edit, r.rsvp, r.cancel]) {
      expect([x.status, x.code]).toEqual([404, 'NOT_FOUND']);
      expect(x.text).toBe(ghost.text);
    }
    expect(r.create).toBe(404);
  });

  it('anonymous → 401 · suspended → 401 · must_change_pin → 403 PIN_CHANGE_REQUIRED', async () => {
    const an = await gate('anon');
    for (const s of [an.view, an.edit.status, an.rsvp.status, an.create, an.cancel.status]) expect(s).toBe(401);
    const su = await gate('suspended');
    for (const s of [su.view, su.edit.status, su.rsvp.status, su.create, su.cancel.status]) expect(s).toBe(401);
    const pin = await gate('pin');
    for (const x of [pin.edit, pin.rsvp, pin.cancel]) expect([x.status, x.code]).toEqual([403, 'PIN_CHANGE_REQUIRED']);
    expect(pin.view).toBe(403);
    expect(pin.create).toBe(403);
  });

  it('กลุ่มที่ถูกลบ: ทุก endpoint 404 รวมกับ admin ของกลุ่มเดิม', async () => {
    const ap = await mustCreate(w.b, w.gid);
    expect((await call(w.a.c, 'DELETE', `/api/groups/${w.gid}`)).status).toBe(200);
    expect((await get(w.a.c, `/api/appointments/${ap.id}`)).status).toBe(404);
    expect((await patch(w.a.c, `/api/appointments/${ap.id}`, { title: 'x' })).status).toBe(404);
    expect((await put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' })).status).toBe(404);
    expect((await createAppt(w.a, w.gid)).status).toBe(404);
    expect((await get(w.a.c, `/api/groups/${w.gid}/appointments`)).status).toBe(404);
    expect((await get<List>(w.b.c, '/api/me/appointments')).data.appointments).toEqual([]);
  });

  it('ผู้สร้างที่ถูกลดจากสมาชิกแล้วออกจากกลุ่ม: แก้นัดเดิมไม่ได้ (404)', async () => {
    const ap = await mustCreate(w.b, w.gid);
    expect((await post(w.b.c, `/api/groups/${w.gid}/leave`)).status).toBe(200);
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { title: 'x' })).status).toBe(404);
  });
});

describe('IDOR ข้ามกลุ่ม', () => {
  it('นัดของกลุ่ม G2 เข้าผ่าน G1 ไม่ได้ · id นัดของคนอื่นไม่รั่วในรายการ/นัดของฉัน', async () => {
    const g2 = await makeGroup(w.o, 'กลุ่มคนนอก');
    const foreign = await mustCreate(w.o, g2, { title: 'ลับของกลุ่มสอง' });
    // สมาชิก G1 (ไม่อยู่ G2) ลองทุกทาง
    for (const [m, p, b] of [
      ['GET', `/api/appointments/${foreign.id}`, undefined],
      ['PATCH', `/api/appointments/${foreign.id}`, { title: 'hack' }],
      ['POST', `/api/appointments/${foreign.id}/cancel`, undefined],
      ['PUT', `/api/appointments/${foreign.id}/rsvp`, { response: 'going' }],
      ['GET', `/api/groups/${g2}/appointments`, undefined],
      ['POST', `/api/groups/${g2}/appointments`, { title: 'x', ...SLOT }],
      ['POST', `/api/groups/${g2}/appointments/check`, SLOT],
    ] as const) {
      const r = await call(w.b.c, m as 'POST', p, b);
      expect([r.status, r.code], `${m} ${p}`).toEqual([404, 'NOT_FOUND']);
      expect(r.text).not.toContain('ลับของกลุ่มสอง');
    }
    const mine = await get<List>(w.b.c, '/api/me/appointments');
    expect(mine.text).not.toContain('ลับของกลุ่มสอง');
    const [row] = await h.rows<{ title: string; status: string }>('SELECT title, status FROM appointment WHERE id = ?', [foreign.id]);
    expect(row).toEqual({ title: 'ลับของกลุ่มสอง', status: 'active' });
    expect(await h.count('appointment_rsvp')).toBe(0);
  });

  it('id ไม่ใช่ uuid → 400 VALIDATION (ไม่ถึงชั้นข้อมูล)', async () => {
    const r = await get(w.a.c, '/api/appointments/not-a-uuid');
    expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
  });
});

describe('แก้นัด (PATCH)', () => {
  it('แก้ทีละฟิลด์ · null ล้างค่า · แก้เวลาทั้งก้อน → startAt/localDate ใหม่ · updatedAt ขยับ', async () => {
    const ap = await mustCreate(w.b, w.gid, { description: 'เก่า', placeName: 'ร้าน' });
    h.clock.advance(HOUR);
    const r1 = await patch<One>(w.b.c, `/api/appointments/${ap.id}`, { description: null, placeName: 'ร้านใหม่' });
    expect(r1.status).toBe(200);
    expect(r1.data.appointment).toMatchObject({ description: null, placeName: 'ร้านใหม่', title: 'กินข้าว' });
    expect(r1.data.appointment.updatedAt).toBe(ap.createdAt + HOUR);
    const r2 = await patch<One>(w.m.c, `/api/appointments/${ap.id}`, { startDate: '2026-10-25', startTime: '14:30', endDate: '2026-10-25', endTime: '16:00' });
    expect(r2.data.appointment).toMatchObject({ localDate: '2026-10-25', startAt: Date.UTC(2026, 9, 25, 7, 30), createdBy: { userId: w.b.id } });
  });

  it('body ว่าง · เวลาไม่ครบ · lat ตัวเดียว · title ว่าง → 400', async () => {
    const ap = await mustCreate(w.b, w.gid);
    for (const body of [{}, { startDate: '2026-10-25' }, { startTime: '10:00' }, { lat: 13 }, { title: '' }, { title: null }]) {
      const r = await patch(w.b.c, `/api/appointments/${ap.id}`, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('แก้นัดที่ยกเลิกแล้ว → 409 APPOINTMENT_CANCELLED', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await post(w.b.c, `/api/appointments/${ap.id}/cancel`);
    const r = await patch(w.b.c, `/api/appointments/${ap.id}`, { title: 'x' });
    expect([r.status, r.code]).toEqual([409, 'APPOINTMENT_CANCELLED']);
  });
});

describe('ยกเลิก', () => {
  it('เก็บแถว (status cancelled, cancelled_at/by) · ซ้ำ → 409 · หายจากรายการ upcoming/ของฉัน แต่ยังเปิดดูได้ · ตอบ RSVP ไม่ได้', async () => {
    const ap = await mustCreate(w.b, w.gid);
    h.clock.advance(5 * 60_000);
    const r = await post<One>(w.m.c, `/api/appointments/${ap.id}/cancel`);
    expect(r.status).toBe(200);
    expect(r.data.appointment).toMatchObject({ status: 'cancelled', cancelledAt: ap.createdAt + 300_000, cancelledBy: { userId: w.m.id }, permissions: { canEdit: false, canCancel: false, canRsvp: false } });
    const [row] = await h.rows<{ status: string; cancelled_by: string }>('SELECT status, cancelled_by FROM appointment WHERE id = ?', [ap.id]);
    expect(row).toEqual({ status: 'cancelled', cancelled_by: w.m.id });
    const again = await post(w.m.c, `/api/appointments/${ap.id}/cancel`);
    expect([again.status, again.code]).toEqual([409, 'APPOINTMENT_CANCELLED']);
    const rsvp = await put(w.c.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' });
    expect([rsvp.status, rsvp.code]).toEqual([409, 'APPOINTMENT_CANCELLED']);
    // upcoming แสดงนัดที่ยกเลิกพร้อมสถานะ (ให้หน้าจอขีดฆ่าได้) · หน้าหลัก (/me/appointments) ไม่รวม
    expect((await get<List>(w.c.c, `/api/groups/${w.gid}/appointments`)).data.appointments.map((x) => [x.id, x.status])).toEqual([[ap.id, 'cancelled']]);
    expect((await get<List>(w.c.c, `/api/groups/${w.gid}/appointments?scope=all`)).data.appointments.map((x) => x.id)).toContain(ap.id);
    expect((await get<List>(w.c.c, '/api/me/appointments')).data.appointments).toEqual([]);
    expect((await get(w.c.c, `/api/appointments/${ap.id}`)).status).toBe(200);
    expect(await h.count("audit_log WHERE action = 'appointment.cancel'")).toBe(1);
  });

  it('นัดที่ยกเลิกไม่นับเพดาน 100 — ยกเลิกแล้วสร้างใหม่ได้', async () => {
    const { seedAppointments } = await import('./util');
    const ids = await seedAppointments(h, w.gid, w.a.id, 100, h.clock.now() + DAY);
    expect((await createAppt(w.a, w.gid)).code).toBe('LIMIT_REACHED');
    expect((await post(w.a.c, `/api/appointments/${ids[0]}/cancel`)).status).toBe(200);
    expect((await createAppt(w.a, w.gid)).status).toBe(201);
  });
});

describe('RSVP', () => {
  it('ตอบ/เปลี่ยนคำตอบ (upsert แถวเดียว) · นับเฉพาะสมาชิกปัจจุบัน · mine ต่อผู้ดู · ไม่มี PUT ซ้ำเป็น 201', async () => {
    const ap = await mustCreate(w.a, w.gid);
    const r1 = await put<One>(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' });
    expect(r1.status).toBe(200);
    expect(r1.data.appointment.rsvp.mine).toBe('going');
    await put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: 'maybe' });
    await put(w.c.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' });
    await put(w.m.c, `/api/appointments/${ap.id}/rsvp`, { response: 'not_going' });
    expect(await h.count('appointment_rsvp')).toBe(3);
    const d = (await get<One>(w.c.c, `/api/appointments/${ap.id}`)).data.appointment;
    expect(d.rsvp.counts).toEqual({ going: 1, maybe: 1, not_going: 1, noResponse: 1 });
    expect(d.rsvp.mine).toBe('going');
    expect(d.rsvp.members!.maybe!.map((x) => x.userId)).toEqual([w.b.id]);
    // คนออกจากกลุ่มแล้วไม่นับ
    await post(w.b.c, `/api/groups/${w.gid}/leave`);
    const after = (await get<One>(w.c.c, `/api/appointments/${ap.id}`)).data.appointment;
    expect(after.rsvp.counts).toEqual({ going: 1, maybe: 0, not_going: 1, noResponse: 1 }); // alice ยังไม่ตอบ
    expect(JSON.stringify(after)).not.toContain(w.b.id);
    // ในรายการเห็นแค่จำนวน + mine ไม่มีรายชื่อ
    const list = (await get<List>(w.c.c, `/api/groups/${w.gid}/appointments`)).data.appointments[0]!;
    expect(list.rsvp.members).toBeUndefined();
    expect(list.rsvp.mine).toBe('going');
  });

  it('response ผิดค่า → 400 · นัดที่จบแล้ว → 409 APPOINTMENT_PAST', async () => {
    const ap = await mustCreate(w.a, w.gid);
    for (const response of ['yes', '', 'GOING', 1, null]) expect((await put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response })).status).toBe(400);
    h.clock.advance(7 * DAY);
    const r = await put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' });
    expect([r.status, r.code]).toEqual([409, 'APPOINTMENT_PAST']);
    expect(await h.count('appointment_rsvp')).toBe(0);
  });
});

describe('รายการ + หน้าหลัก + วันที่', () => {
  it('scope upcoming/past/all · เรียง startAt, id · cursor ครบไม่ซ้ำ · limit bounded', async () => {
    const mk = (d: string) => mustCreate(w.a, w.gid, { title: d, startDate: d, endDate: d });
    const [d25, d24, d26] = [await mk('2026-10-25'), await mk('2026-10-24'), await mk('2026-10-26')];
    await mk('2026-10-18'); // วันนี้ 10:00–11:00 → กำลังเกิด/เพิ่งผ่าน? now=10:00 → end 11:00 ยัง upcoming
    h.clock.advance(3 * DAY); // now = 21 ต.ค. → 18 ผ่านแล้ว
    const up = await get<List>(w.b.c, `/api/groups/${w.gid}/appointments`);
    expect(up.data.appointments.map((x) => x.id)).toEqual([d24.id, d25.id, d26.id]);
    const past = await get<List>(w.b.c, `/api/groups/${w.gid}/appointments?scope=past`);
    expect(past.data.appointments.map((x) => x.title)).toEqual(['2026-10-18']);
    expect(past.data.appointments[0]!.isPast).toBe(true);
    expect((await get<List>(w.b.c, `/api/groups/${w.gid}/appointments?scope=all`)).data.appointments).toHaveLength(4);
    const p1 = await get<List>(w.b.c, `/api/groups/${w.gid}/appointments?limit=2`);
    expect(p1.data.appointments.map((x) => x.id)).toEqual([d24.id, d25.id]);
    expect(p1.data.nextCursor).not.toBeNull();
    const p2 = await get<List>(w.b.c, `/api/groups/${w.gid}/appointments?limit=2&cursor=${p1.data.nextCursor}`);
    expect(p2.data.appointments.map((x) => x.id)).toEqual([d26.id]);
    expect(p2.data.nextCursor).toBeNull();
  });

  it.each(['scope=bogus', 'limit=0', 'limit=51', 'limit=abc', 'limit=-1', 'cursor=@@@', 'foo=1'])('query ผิด (%s) → 400', async (q) => {
    expect((await get(w.b.c, `/api/groups/${w.gid}/appointments?${q}`)).status).toBe(400);
  });

  it('/api/me/appointments: ข้ามกลุ่ม · เฉพาะ active ที่ยังไม่จบ · เรียงเร็วสุดก่อน · ไม่รวมกลุ่มที่ออกแล้ว', async () => {
    const g2 = await makeGroup(w.c, 'กลุ่มสอง');
    await join(w.c, w.b, g2);
    const late = await mustCreate(w.c, g2, { startDate: '2026-10-30', endDate: '2026-10-30' });
    const early = await mustCreate(w.a, w.gid, { startDate: '2026-10-22', endDate: '2026-10-22' });
    const r = await get<{ appointments: ApptDto[] }>(w.b.c, '/api/me/appointments');
    expect(r.data.appointments.map((x) => x.id)).toEqual([early.id, late.id]);
    expect(r.data.appointments.map((x) => x.groupName)).toEqual(['ก๊วนแมว', 'กลุ่มสอง']);
    await post(w.b.c, `/api/groups/${g2}/leave`);
    expect((await get<{ appointments: ApptDto[] }>(w.b.c, '/api/me/appointments')).data.appointments.map((x) => x.id)).toEqual([early.id]);
    expect((await get<{ appointments: ApptDto[] }>(w.o.c, '/api/me/appointments')).data.appointments).toEqual([]);
  });

  it('วันที่: ข้ามเที่ยงคืน · ข้ามเดือน · ข้ามปี คงเวลา UTC ถูกต้อง', async () => {
    const o = await mustCreate(w.a, w.gid, { startDate: '2026-10-24', startTime: '22:00', endDate: '2026-10-25', endTime: '02:00' });
    expect([o.startAt, o.endAt, o.localDate]).toEqual([Date.UTC(2026, 9, 24, 15), Date.UTC(2026, 9, 24, 19), '2026-10-24']);
    const m = await mustCreate(w.a, w.gid, { startDate: '2026-10-31', startTime: '23:00', endDate: '2026-11-01', endTime: '01:00' });
    expect(m.localDate).toBe('2026-10-31');
    const y = await mustCreate(w.a, w.gid, { startDate: '2026-12-31', startTime: '23:30', endDate: '2027-01-01', endTime: '00:30' });
    expect([y.localDate, y.startAt]).toEqual(['2026-12-31', Date.UTC(2026, 11, 31, 16, 30)]);
    const leap = await mustCreate(w.a, w.gid, { startDate: '2028-02-29', endDate: '2028-02-29' });
    expect(leap.localDate).toBe('2028-02-29');
  });

  it('Europe/London: ข้ามช่วงเปลี่ยนเวลาฤดูร้อน (25 ต.ค. 2026 02:00→01:00) ใช้ offset ตามวัน', async () => {
    await h.rows("UPDATE groups SET tz = 'Europe/London' WHERE id = ?", [w.gid]);
    const before = await mustCreate(w.a, w.gid, { startDate: '2026-10-24', startTime: '12:00', endDate: '2026-10-24', endTime: '13:00' }); // BST = UTC+1
    const after = await mustCreate(w.a, w.gid, { startDate: '2026-10-26', startTime: '12:00', endDate: '2026-10-26', endTime: '13:00' }); // GMT = UTC+0
    expect(before.startAt).toBe(Date.UTC(2026, 9, 24, 11));
    expect(after.startAt).toBe(Date.UTC(2026, 9, 26, 12));
    expect(before.tz).toBe('Europe/London');
    // นัดที่สร้างก่อนกลุ่มเปลี่ยน tz ยังเก็บ tz เดิมของมัน
    expect(await h.count("appointment WHERE tz = 'Europe/London'")).toBe(2);
  });

  it('"วันนี้" ตาม tz กลุ่ม: 23:30 UTC วันที่ 17 = 06:30 BKK วันที่ 18 → daysUntil นับจากวันที่ 18', async () => {
    h.clock.set(Date.UTC(2026, 9, 17, 23, 30));
    const ap = await mustCreate(w.a, w.gid, { startDate: '2026-10-18', startTime: '09:00', endDate: '2026-10-18', endTime: '10:00' });
    expect(ap.daysUntil).toBe(0);
    h.clock.set(Date.UTC(2026, 9, 18, 17, 30)); // 00:30 BKK วันที่ 19
    expect((await get<One>(w.a.c, `/api/appointments/${ap.id}`)).data.appointment).toMatchObject({ daysUntil: -1, isPast: true });
  });
});

describe('EXPLAIN — คิวรีรายการใช้ดัชนีของนัด ไม่สแกนทั้งตาราง', () => {
  const plan = async (q: string, args: (string | number)[]) => (await h.rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${q}`, args)).map((r) => r.detail).join('\n');
  const usesIndex = (p: string) => /appointment_group_start_idx|appointment_start_idx/.test(p) && !/SCAN (a|appointment)( |$)/.test(p.replace(/USING/g, 'USING'));

  it('รายการของกลุ่ม (upcoming/past/all)', async () => {
    for (const where of ['end_at > ?', 'end_at <= ?', '1 = 1 AND ? IS NOT NULL']) {
      const p = await plan(`SELECT * FROM appointment WHERE group_id = ? AND ${where} ORDER BY start_at, id LIMIT 21`, [w.gid, 1]);
      expect(p, where).toContain('appointment_group_start_idx');
      expect(p, where).not.toContain('USE TEMP B-TREE FOR ORDER BY');
    }
  });

  it('นัดของฉัน (ข้ามกลุ่ม) และนับเพดานของกลุ่ม', async () => {
    const mine = await plan(
      `SELECT a.* FROM group_member m JOIN groups g ON g.id = m.group_id AND g.deleted_at IS NULL JOIN appointment a ON a.group_id = m.group_id
       WHERE m.user_id = ? AND a.status = 'active' AND a.end_at > ? ORDER BY a.start_at, a.id LIMIT 20`,
      [w.a.id, 1],
    );
    expect(usesIndex(mine), mine).toBe(true);
    const cap = await plan("SELECT count(*) FROM appointment WHERE group_id = ? AND status = 'active' AND end_at > ?", [w.gid, 1]);
    expect(usesIndex(cap), cap).toBe(true);
  });
});
