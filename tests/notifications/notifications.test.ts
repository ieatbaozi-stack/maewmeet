// R4B-3 แจ้งเตือนในแอป (ADR 0007): appointment.created ใน transaction เดียวกัน · list/read เจ้าของเท่านั้น · cron 90 วัน
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as dailyGET } from '@/app/api/cron/daily/route';
import { NOTIFICATION_KINDS } from '@/lib/data/notifications/notify';
import { Client, DAY, HOUR, createAppt, get, join, makeGroup, mustCreate, patch, person, post, put, setupHarness, world, type Harness, type World } from '../appointments/util';

let h: Harness;
let w: World;

beforeEach(async () => {
  h = await setupHarness();
  w = await world(h);
  // R11: world() เองเกิดแถว group.member.joined / role_changed → เริ่มเคสด้วยกล่องว่างเพื่อวัดเฉพาะสิ่งที่เคสทำ
  await h.rows('DELETE FROM notification');
});
afterEach(async () => {
  await h.cleanup();
});

type N = { id: string; kind: string; params: Record<string, unknown>; createdAt: number; readAt: number | null };
type L = { notifications: N[]; nextCursor: string | null; unreadCount: number };
const list = (p: { c: Client }, q = '') => get<L>(p.c, `/api/me/notifications${q}`);
const read = (p: { c: Client }, body: unknown) => post<{ updated: number; unreadCount: number }>(p.c, '/api/me/notifications/read', body);

describe('appointment.created', () => {
  it('ส่งถึงสมาชิกทุกคนยกเว้นผู้สร้าง · params ดิบตาม ADR 0007 · ผู้สร้าง/คนนอกไม่ได้', async () => {
    const ap = await mustCreate(w.b, w.gid, { title: 'ปาร์ตี้ <b>x</b>' });
    for (const p of [w.a, w.m, w.c]) {
      const r = await list(p);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('private, no-store');
      expect(r.data.unreadCount).toBe(1);
      expect(r.data.notifications).toHaveLength(1);
      expect(r.data.notifications[0]).toMatchObject({
        kind: 'appointment.created',
        readAt: null,
        createdAt: h.clock.now(),
        params: { groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap.id, title: 'ปาร์ตี้ <b>x</b>', startAt: ap.startAt, tz: 'Asia/Bangkok' },
      });
    }
    expect((await list(w.b)).data).toEqual({ notifications: [], nextCursor: null, unreadCount: 0 });
    expect((await list(w.o)).data.notifications).toEqual([]);
    expect((await list(w.boss)).data.notifications).toEqual([]);
  });

  it('params มีเฉพาะคีย์ใน allowlist ไม่มีความลับ (pin/token/hash/code/note/username) และเป็นค่าเรียบ', async () => {
    await mustCreate(w.b, w.gid, { description: 'รายละเอียดลับ', placeName: 'ที่ลับ', mapUrl: 'https://example.com/secret' });
    const rows = await h.rows<{ params: string; kind: string }>('SELECT kind, params FROM notification');
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const p = JSON.parse(r.params) as Record<string, unknown>;
      expect(Object.keys(p).sort()).toEqual(['appointmentId', 'groupId', 'groupName', 'startAt', 'title', 'tz']);
      for (const v of Object.values(p)) expect(['string', 'number']).toContain(typeof v);
      expect(r.params).not.toMatch(/pin|token|hash|secret|pepper|password|username|ที่ลับ|รายละเอียดลับ|example\.com/i);
    }
  });

  it('atomic: เขียนแจ้งเตือนล้ม → นัดไม่ถูกสร้าง (rollback ทั้งก้อน) · คำตอบเป็น 500 ไม่รั่วรายละเอียด', async () => {
    await h.rows("CREATE TRIGGER fail_notif BEFORE INSERT ON notification BEGIN SELECT RAISE(ABORT, 'SECRET-BOOM'); END");
    const r = await createAppt(w.b, w.gid, { title: 'จะไม่เกิด' });
    expect(r.status).toBe(500);
    expect(r.text).not.toContain('SECRET-BOOM');
    expect(await h.count('appointment')).toBe(0);
    expect(await h.count("audit_log WHERE action = 'appointment.create'")).toBe(0);
    await h.rows('DROP TRIGGER fail_notif');
    expect((await createAppt(w.b, w.gid)).status).toBe(201);
    expect(await h.count('notification')).toBe(3);
  });

  it('create ที่ถูกปฏิเสธ (เต็มเพดาน/ validation/ ไม่มีสิทธิ์) ไม่ทิ้งแจ้งเตือน', async () => {
    await createAppt(w.b, w.gid, { title: '' });
    await createAppt(w.o, w.gid);
    await createAppt(new Client() as never, w.gid).catch(() => undefined);
    expect(await h.count('notification')).toBe(0);
  });

  it('R11: แก้ชื่อ/ตอบซ้ำ/ผู้สร้างตอบเอง ไม่แจ้ง · เปลี่ยนเวลา → updated · ตอบเปลี่ยนค่า → rsvp_changed ถึงผู้สร้าง · ยกเลิก → cancelled', async () => {
    const kinds = async (p: { id: string }) => (await h.rows<{ kind: string }>('SELECT kind FROM notification WHERE user_id = ? ORDER BY created_at, id', [p.id])).map((r) => r.kind);
    const ap = await mustCreate(w.b, w.gid);
    await h.rows('DELETE FROM notification');
    // แก้แค่ชื่อ → ไม่แจ้ง
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { title: 'ชื่อใหม่' })).status).toBe(200);
    expect(await h.count('notification')).toBe(0);
    // ผู้สร้างตอบนัดตัวเอง → ไม่แจ้ง
    expect((await put(w.b.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' })).status).toBe(200);
    expect(await h.count('notification')).toBe(0);
    // คนอื่นตอบครั้งแรก → rsvp_changed ถึงผู้สร้างคนเดียว · ตอบซ้ำค่าเดิม → ไม่เพิ่ม
    expect((await put(w.a.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' })).status).toBe(200);
    expect(await kinds(w.b)).toEqual(['appointment.rsvp_changed']);
    expect((await put(w.a.c, `/api/appointments/${ap.id}/rsvp`, { response: 'going' })).status).toBe(200);
    expect(await h.count('notification')).toBe(1);
    // เปลี่ยนเวลา → updated ถึงสมาชิกที่เหลือ (ไม่รวมผู้แก้)
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { startDate: '2026-10-24', startTime: '12:00', endDate: '2026-10-24', endTime: '13:00' })).status).toBe(200);
    for (const p of [w.a, w.m, w.c]) expect(await kinds(p), p.id).toContain('appointment.updated');
    expect(await kinds(w.b)).toEqual(['appointment.rsvp_changed']);
    // ยกเลิก → cancelled ถึงสมาชิกที่เหลือ (ไม่รวมผู้ยกเลิก) · คนนอกไม่ได้
    expect((await post(w.b.c, `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
    for (const p of [w.a, w.m, w.c]) expect(await kinds(p), p.id).toContain('appointment.cancelled');
    expect(await kinds(w.b)).toEqual(['appointment.rsvp_changed']);
    expect(await kinds(w.o)).toEqual([]);
  });

  it('ทุก kind ใน union มีข้อความ th/en ใน messages (กันเพิ่มชนิดแล้วลืมข้อความ)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const l of ['th', 'en']) {
      const m = JSON.parse(readFileSync(`messages/${l}.json`, 'utf8')) as { notifications: Record<string, unknown> };
      for (const k of NOTIFICATION_KINDS) {
        const v = k.split('.').reduce<unknown>((o, seg) => (o as Record<string, unknown> | undefined)?.[seg], m.notifications);
        expect(typeof v === 'string' || (v !== null && typeof v === 'object'), `${l}: notifications.${k}`).toBe(true);
      }
    }
  });
});

describe('GET /api/me/notifications', () => {
  it('ใหม่สุดก่อน · cursor ครบไม่ซ้ำ · unreadCount ทั้งกล่อง (ไม่ใช่เฉพาะหน้า) · limit bounded', async () => {
    for (let i = 0; i < 5; i++) {
      h.clock.advance(1000);
      await mustCreate(w.b, w.gid, { title: `นัด ${i}` });
    }
    const p1 = await list(w.a, '?limit=2');
    expect(p1.data.notifications.map((n) => n.params.title)).toEqual(['นัด 4', 'นัด 3']);
    expect(p1.data.unreadCount).toBe(5);
    const p2 = await list(w.a, `?limit=2&cursor=${p1.data.nextCursor}`);
    expect(p2.data.notifications.map((n) => n.params.title)).toEqual(['นัด 2', 'นัด 1']);
    const p3 = await list(w.a, `?limit=2&cursor=${p2.data.nextCursor}`);
    expect(p3.data.notifications.map((n) => n.params.title)).toEqual(['นัด 0']);
    expect(p3.data.nextCursor).toBeNull();
    expect((await list(w.a)).data.notifications).toHaveLength(5);
  });

  it.each(['limit=0', 'limit=51', 'limit=x', 'cursor=@@@', 'cursor=e30', 'foo=1'])('query ผิด (%s) → 400', async (q) => {
    expect((await list(w.a, `?${q}`)).status).toBe(400);
  });

  it('anonymous 401 · must_change_pin 403', async () => {
    expect((await get(new Client(), '/api/me/notifications')).status).toBe(401);
    const x = await person(h, 'pinny');
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [x.id]);
    expect((await list(x)).code).toBe('PIN_CHANGE_REQUIRED');
    expect((await read(x, { all: true })).code).toBe('PIN_CHANGE_REQUIRED');
  });

  it('ออกจากกลุ่ม/ถูกลบออก/กลุ่มถูกลบ → แจ้งเตือนเรื่องนัดของกลุ่มนั้นหายและไม่นับ · กลับเข้ากลุ่มแล้วกลับมา', async () => {
    await mustCreate(w.b, w.gid, { title: 'ลับเฉพาะสมาชิก' });
    expect((await list(w.c)).data.unreadCount).toBe(1);
    await post(w.c.c, `/api/groups/${w.gid}/leave`);
    const gone = await list(w.c);
    expect(gone.data).toEqual({ notifications: [], nextCursor: null, unreadCount: 0 });
    expect(gone.text).not.toContain('ลับเฉพาะสมาชิก');
    // กลุ่มถูกลบ → ไม่เห็นแม้ยังเป็นสมาชิก
    // m (moderator) ได้ member.left ของ c ด้วย (R11) → นับเฉพาะ appointment.created
    expect((await list(w.m)).data.notifications.filter((n) => n.kind === 'appointment.created')).toHaveLength(1);
    await h.rows('UPDATE groups SET deleted_at = ? WHERE id = ?', [h.clock.now(), w.gid]);
    // กรองด้วยชนิดนัด: group.member.* ไม่ผูกกับการซ่อนตามกลุ่ม (visibleToOwner ครอบเฉพาะ appointment.%) — ดูหมายเหตุในรายงาน R11
    expect((await list(w.m)).data.notifications.filter((n) => n.kind.startsWith('appointment.'))).toEqual([]);
  });

  it('แจ้งเตือนชนิดอื่น (ไม่ผูกกลุ่ม) ไม่ถูกกรองเมื่อไม่มีกลุ่ม', async () => {
    await h.rows("INSERT INTO notification (id, user_id, kind, params, created_at) VALUES ('11111111-1111-4111-8111-111111111111', ?, 'pin_reset.cancelled_by_login', '{}', ?)", [w.o.id, h.clock.now()]);
    const r = await list(w.o);
    expect(r.data.notifications.map((n) => n.kind)).toEqual(['pin_reset.cancelled_by_login']);
    expect(r.data.unreadCount).toBe(1);
  });
});

describe('POST /api/me/notifications/read', () => {
  it('{ids}: ทำเครื่องหมายเฉพาะที่ระบุ · ซ้ำ = updated 0 · {all:true}: ทั้งหมดของฉัน', async () => {
    await mustCreate(w.b, w.gid, { title: 'หนึ่ง' });
    h.clock.advance(1000);
    await mustCreate(w.b, w.gid, { title: 'สอง' });
    const l = (await list(w.a)).data.notifications;
    const r1 = await read(w.a, { ids: [l[0]!.id] });
    expect(r1.data).toEqual({ updated: 1, unreadCount: 1 });
    expect((await read(w.a, { ids: [l[0]!.id] })).data).toEqual({ updated: 0, unreadCount: 1 });
    const after = (await list(w.a)).data.notifications;
    expect(after[0]!.readAt).toBe(h.clock.now());
    expect(after[1]!.readAt).toBeNull();
    expect((await read(w.a, { all: true })).data).toEqual({ updated: 1, unreadCount: 0 });
    // คนอื่นไม่ถูกแตะ
    expect((await list(w.m)).data.unreadCount).toBe(2);
  });

  it('IDOR: ใส่ id แจ้งเตือนของคนอื่น → เมินเงียบ ๆ (updated 0) ไม่ยืนยันว่ามีอยู่ · ของเจ้าของยังไม่อ่าน', async () => {
    await mustCreate(w.b, w.gid);
    const theirs = (await list(w.a)).data.notifications[0]!.id;
    const ghost = '00000000-0000-4000-8000-000000000000';
    const mine = await read(w.m, { ids: [theirs] });
    const none = await read(w.m, { ids: [ghost] });
    expect([mine.status, mine.data]).toEqual([200, { updated: 0, unreadCount: 1 }]);
    expect(mine.text).toBe(none.text);
    expect((await read(w.o, { ids: [theirs] })).data.updated).toBe(0);
    expect((await list(w.a)).data.notifications[0]!.readAt).toBeNull();
    expect(await h.count('notification WHERE read_at IS NOT NULL')).toBe(0);
  });

  it.each([
    [{}],
    [{ ids: [] }],
    [{ ids: ['x'] }],
    [{ ids: Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) }],
    [{ all: false }],
    [{ all: true, ids: [] }],
    [{ ids: ['00000000-0000-4000-8000-000000000000'], userId: 'x' }],
    [{ all: 'true' }],
  ])('body ผิด %j → 400', async (body) => {
    const r = await read(w.a, body);
    expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
  });

  it('mark all ไม่ทำให้ของ user อื่นเปลี่ยน และไม่ข้ามเจ้าของ', async () => {
    await mustCreate(w.b, w.gid);
    await read(w.a, { all: true });
    expect(await h.count('notification WHERE read_at IS NOT NULL AND user_id <> ?', [w.a.id])).toBe(0);
  });
});

describe('cron: ลบแจ้งเตือนเก่ากว่า 90 วัน', () => {
  const ORIGIN = 'https://maewmeet.test';
  const daily = () => dailyGET(new Request(`${ORIGIN}/api/cron/daily`, { method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));

  it('ลบเฉพาะที่เก่ากว่า 90 วัน (พอดี 90 วันเก็บไว้) ทั้งอ่านแล้วและยังไม่อ่าน · รันซ้ำไม่เปลี่ยน', async () => {
    const now = h.clock.now();
    const ins = (id: string, age: number, readAt: number | null) =>
      h.rows("INSERT INTO notification (id, user_id, kind, params, created_at, read_at) VALUES (?, ?, 'pin_reset.cancelled_by_login', '{}', ?, ?)", [id, w.a.id, now - age, readAt]);
    await ins('n-old-unread', 90 * DAY + 1, null);
    await ins('n-old-read', 120 * DAY, now - 100 * DAY);
    await ins('n-edge', 90 * DAY, null);
    await ins('n-new', HOUR, null);
    const res = await daily();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { cleaned: Record<string, number> } };
    expect(body.data.cleaned.oldNotifications).toBe(2);
    expect((await h.rows<{ id: string }>('SELECT id FROM notification ORDER BY id')).map((r) => r.id)).toEqual(['n-edge', 'n-new']);
    expect(((await (await daily()).json()) as { data: { cleaned: Record<string, number> } }).data.cleaned.oldNotifications).toBe(0);
  });
});

describe('ไม่มี endpoint นอกสัญญา', () => {
  it('ไม่มี route unread-count แยก (ใช้ unreadCount ในรายการ) และ makeGroup/join ของกลุ่มอื่นไม่รั่ว', async () => {
    const { ROUTE_MANIFEST } = await import('@/app/api/_lib/manifest');
    expect(ROUTE_MANIFEST.filter((e) => /notifications/.test(e.path)).map((e) => `${e.method} ${e.path}`).sort()).toEqual(['GET /api/me/notifications', 'POST /api/me/notifications/read']);
    const g2 = await makeGroup(w.o, 'อีกกลุ่ม');
    await join(w.o, w.b, g2);
    await mustCreate(w.o, g2, { title: 'นัดกลุ่มสอง' });
    expect((await list(w.b)).data.notifications.map((n) => n.params.title)).toEqual(['นัดกลุ่มสอง']);
    expect((await list(w.c)).data.notifications).toEqual([]);
  });
});
