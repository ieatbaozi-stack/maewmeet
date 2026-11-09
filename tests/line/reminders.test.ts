// R10-1, R10-3, R10-4 (ฝั่ง server): ผู้รับ · กันซ้ำ · เลื่อนเวลา · ชนิดในกระดิ่ง · cron auth
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, call, get, join, mustCreate, patch, setupHarness, world, type Harness, type World } from '../appointments/util';
import { HOUR, DAY, MIN, clearFakeLine, disableLineEnv, enableLineEnv, fakeLine, linkLine, LINE_A, rsvp, runCron } from './util';
import { NOTIFICATION_KINDS } from '@/lib/data/notifications/notify';
import { APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX, REMINDER_CRON } from '@/lib/shared/limits';
import { insertNotificationRows } from '@/lib/data/repos/notification';
import { newId } from '@/lib/shared/id';

// SLOT = 24 ต.ค. 2026 10:00–11:00 BKK → 1d ถึงกำหนด 23 ต.ค. 10:00 BKK (03:00Z) · 1h = 24 ต.ค. 09:00 BKK (02:00Z)
const START_AT = Date.UTC(2026, 9, 24, 3);
const DUE_1D = START_AT - DAY;
const DUE_1H = START_AT - HOUR;

let h: Harness;
let w: World;

beforeEach(async () => {
  disableLineEnv();
  h = await setupHarness();
  w = await world(h);
});
afterEach(async () => {
  clearFakeLine();
  disableLineEnv();
  await h.cleanup();
});

const byKind = async (kind: string) => (await h.rows<{ user_id: string }>('SELECT user_id FROM notification WHERE kind = ? ORDER BY user_id', [kind])).map((r) => r.user_id);
const sorted = (...ids: string[]) => [...ids].sort();

describe('R10-1 ผู้รับ', () => {
  it('reminder_1d เฉพาะ going · nudge เฉพาะ maybe/ยังไม่ตอบ · not_going คนนอก super admin ไม่ได้', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    await rsvp(w.m, ap.id, 'maybe');
    await rsvp(w.c, ap.id, 'not_going');
    h.clock.set(DUE_1D);
    const res = await runCron(h);
    expect(res.claimed).toBe(2);
    expect(await byKind('appointment.reminder_1d')).toEqual([w.a.id]);
    expect(await byKind('appointment.rsvp_nudge')).toEqual(sorted(w.m.id, w.b.id));
    expect(await byKind('appointment.reminder_1h')).toEqual([]);
  });

  it('reminder_1h เฉพาะ going ตอนถึงกำหนด (เปลี่ยนใจแล้วไม่ได้ · เพิ่งตอบไปได้)', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    await rsvp(w.m, ap.id, 'going');
    h.clock.set(DUE_1D);
    await runCron(h);
    await rsvp(w.a, ap.id, 'not_going');
    await rsvp(w.c, ap.id, 'going');
    h.clock.set(DUE_1H);
    await runCron(h);
    expect(await byKind('appointment.reminder_1h')).toEqual(sorted(w.m.id, w.c.id));
  });

  it('สมาชิกที่ออกแล้วไม่ได้รับ · ออกแล้วกลับเข้า คำตอบเก่าถือว่ายังไม่ตอบ = ได้ nudge ไม่ได้ 1d', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.c, ap.id, 'going');
    await rsvp(w.m, ap.id, 'going');
    expect((await call(w.c.c, 'POST', `/api/groups/${w.gid}/leave`)).status).toBe(200);
    expect((await call(w.m.c, 'POST', `/api/groups/${w.gid}/leave`)).status).toBe(200);
    h.clock.advance(MIN);
    await join(w.a, w.m, w.gid);
    h.clock.set(DUE_1D);
    await runCron(h);
    expect(await byKind('appointment.reminder_1d')).toEqual([]);
    const nudged = await byKind('appointment.rsvp_nudge');
    expect(nudged).toContain(w.m.id);
    expect(nudged).not.toContain(w.c.id);
  });

  it('บัญชีถูกระงับไม่ได้รับ', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    await rsvp(w.c, ap.id, 'going');
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [w.c.id]);
    h.clock.set(DUE_1D);
    await runCron(h);
    expect(await byKind('appointment.reminder_1d')).toEqual([w.a.id]);
  });

  it('นัดยกเลิก = ไม่เตือน', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    expect((await call(w.b.c, 'POST', `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
    h.clock.set(DUE_1D);
    expect((await runCron(h)).claimed).toBe(0);
    expect(await h.count('appointment_reminder')).toBe(0);
  });

  it('กลุ่มถูกลบ = ไม่เตือน', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    await h.rows('UPDATE groups SET deleted_at = ? WHERE id = ?', [h.clock.now(), w.gid]);
    h.clock.set(DUE_1D);
    expect((await runCron(h)).claimed).toBe(0);
  });
});

describe('R10-3 กันซ้ำ', () => {
  it('รันซ้ำ (catch-up/ส่งซ้ำของ Vercel) ได้ผลเดิม', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    h.clock.set(DUE_1D);
    expect((await runCron(h)).claimed).toBe(2);
    const n = await h.count('notification');
    expect((await runCron(h)).claimed).toBe(0);
    h.clock.advance(15 * MIN);
    expect((await runCron(h)).claimed).toBe(0);
    expect(await h.count('notification')).toBe(n);
    expect(await h.count('appointment_reminder')).toBe(2);
  });

  it('รันพร้อมกันได้ผลเดิม (แจ้งเตือนต่อคนแถวเดียว)', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    h.clock.set(DUE_1D);
    const results = await Promise.all([runCron(h), runCron(h), runCron(h)]);
    expect(results.reduce((s, r) => s + r.claimed, 0)).toBe(2);
    expect(await byKind('appointment.reminder_1d')).toEqual([w.a.id]);
  });

  it('ไม่มีผู้รับก็เขียนแถวกันซ้ำ · ตอบ going ทีหลังไม่ได้เตือนย้อนหลัง', async () => {
    const ap = await mustCreate(w.b, w.gid);
    h.clock.set(DUE_1D);
    await runCron(h);
    expect(await h.count("appointment_reminder WHERE kind = 'appointment.reminder_1d'")).toBe(1);
    await rsvp(w.a, ap.id, 'going');
    h.clock.advance(15 * MIN);
    await runCron(h);
    expect(await byKind('appointment.reminder_1d')).toEqual([]);
  });

  it('ตัวตั้งเวลาพลาด: เลยเงื่อนไข 3 ชม. แล้วไม่ส่ง 1d ย้อนหลัง', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    h.clock.set(START_AT - 3 * HOUR + 1);
    expect((await runCron(h)).claimed).toBe(0);
    expect(await byKind('appointment.reminder_1d')).toEqual([]);
  });

  it('สร้างกระชั้น (< 24 ชม.) ไม่มี 1d/nudge แต่มี 1h', async () => {
    h.clock.set(START_AT - 5 * HOUR);
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    await runCron(h);
    expect(await h.count('appointment_reminder')).toBe(0);
    h.clock.set(DUE_1H);
    expect((await runCron(h)).claimed).toBe(1);
    expect(await byKind('appointment.reminder_1h')).toEqual([w.a.id]);
  });

  it('แก้เวลานัด: เตือนตามเวลาใหม่ได้ · scheduled_at อัปเดต · แก้ชื่อ/ส่งเวลาเดิมไม่แตะ scheduled_at', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    const sched = async () => Number((await h.rows<{ s: number }>('SELECT scheduled_at AS s FROM appointment WHERE id = ?', [ap.id]))[0]!.s);
    const created = await sched();
    expect(created).toBe(h.clock.now());

    h.clock.advance(HOUR);
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { title: 'ชื่อใหม่' })).status).toBe(200);
    expect(await sched()).toBe(created);
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { startDate: '2026-10-24', startTime: '10:00', endDate: '2026-10-24', endTime: '12:00' })).status).toBe(200);
    expect(await sched()).toBe(created);

    h.clock.set(DUE_1D);
    await runCron(h);
    expect(await byKind('appointment.reminder_1d')).toEqual([w.a.id]);

    // เลื่อนไปวันที่ 26 → เตือนใหม่ตามเวลาใหม่ (rsvp เดิมยังอยู่)
    h.clock.advance(HOUR);
    const moveAt = h.clock.now();
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { startDate: '2026-10-26', startTime: '10:00', endDate: '2026-10-26', endTime: '11:00' })).status).toBe(200);
    expect(await sched()).toBe(moveAt);
    h.clock.set(Date.UTC(2026, 9, 25, 3));
    expect((await runCron(h)).claimed).toBe(2);
    expect(await byKind('appointment.reminder_1d')).toEqual([w.a.id, w.a.id]);
    expect(await h.count('appointment_reminder WHERE appointment_id = ?', [ap.id])).toBe(4);
  });

  it('จำกัดงานต่อรอบ: ที่เหลือไปรอบถัดไป ไม่หาย ไม่ซ้ำ', async () => {
    const n = REMINDER_CRON.maxClaimsPerRun + 3;
    for (let i = 0; i < n; i++) {
      await h.rows(
        "INSERT INTO appointment (id, group_id, title, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at, scheduled_at) VALUES (?, ?, 'x', ?, ?, 'Asia/Bangkok', '2026-10-24', 'active', ?, ?, ?, ?)",
        [newId(), w.gid, START_AT + i, START_AT + HOUR, w.a.id, DUE_1D - DAY, DUE_1D - DAY, DUE_1D - DAY],
      );
    }
    h.clock.set(DUE_1D + n);
    const first = await runCron(h);
    expect(first.claimed).toBe(REMINDER_CRON.maxClaimsPerRun);
    expect(first.more).toBe(true);
    let total = first.claimed;
    for (let i = 0; i < 5; i++) total += (await runCron(h)).claimed;
    expect(total).toBe(n * 2); // 1d + nudge ต่อนัด
    expect(await h.count('appointment_reminder')).toBe(n * 2);
  });
});

describe('R10-4 กระดิ่ง (ฝั่ง server)', () => {
  it('มี 3 ชนิดใหม่ใน NOTIFICATION_KINDS', () => {
    expect(NOTIFICATION_KINDS).toEqual(expect.arrayContaining(['appointment.reminder_1d', 'appointment.reminder_1h', 'appointment.rsvp_nudge']));
  });

  it('API แสดงแถว + params ดิบครบ · นับ unread', async () => {
    const ap = await mustCreate(w.b, w.gid, { description: 'รายละเอียดลับ', placeName: 'ที่ลับ' });
    await rsvp(w.a, ap.id, 'going');
    h.clock.set(DUE_1D);
    await runCron(h);
    const r = await get<{ notifications: { kind: string; params: Record<string, unknown> }[]; unreadCount: number }>(w.a.c, '/api/me/notifications');
    expect(r.status).toBe(200);
    const n = r.data.notifications.find((x) => x.kind === 'appointment.reminder_1d');
    expect(n?.params).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap.id, title: 'กินข้าว', startAt: ap.startAt, tz: 'Asia/Bangkok' });
    expect(r.text).not.toMatch(/ที่ลับ|รายละเอียดลับ/);
    expect(r.data.unreadCount).toBe(2); // appointment.created + reminder_1d
  });

  it('rsvp_nudge ไม่เข้า outbox แม้เชื่อม LINE และเปิดช่องทาง', async () => {
    enableLineEnv();
    fakeLine();
    await mustCreate(w.b, w.gid);
    await linkLine(h, w.m.id, LINE_A);
    h.clock.set(DUE_1D);
    await runCron(h);
    expect(await byKind('appointment.rsvp_nudge')).toContain(w.m.id);
    expect(await h.count('notification_outbox')).toBe(0);
  });

  it('เพดาน unread ของ appointment.created ไม่กระทบชนิดใหม่', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    const row = (i: number) => ({ id: newId(), userId: w.a.id, kind: 'appointment.created', params: { groupId: w.gid, groupName: 'g', appointmentId: `seed-${i}`, title: 't', startAt: 1, tz: 'Asia/Bangkok' } });
    await insertNotificationRows(h.db, Array.from({ length: APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX + 1 }, (_, i) => row(i)), h.clock.now());
    h.clock.set(DUE_1D);
    await runCron(h);
    expect(await byKind('appointment.reminder_1d')).toEqual([w.a.id]);
  });
});

describe('ด่าน /api/cron/reminders', () => {
  it.each(['GET', 'POST'] as const)('%s: ไม่มี/ผิด secret → 401 ไม่ทำงาน · ถูก → 200', async (method) => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    h.clock.set(DUE_1D);
    const c = new Client();
    for (const headers of [{}, { authorization: 'Bearer wrong-secret-0123456789abcdef' }] as Record<string, string>[]) {
      const r = await c.call(method, '/api/cron/reminders', method === 'GET' ? undefined : {}, { headers, noCookie: true });
      expect(r.status).toBe(401);
      expect(r.code).toBe('AUTH_REQUIRED');
    }
    expect(await h.count('appointment_reminder')).toBe(0);
    const ok = await c.call(method, '/api/cron/reminders', method === 'GET' ? undefined : {}, { headers: { authorization: `Bearer ${h.t.env.CRON_SECRET}` }, noCookie: true });
    expect(ok.status).toBe(200);
    expect(await h.count('appointment_reminder')).toBe(2);
  });

  it('ผลลัพธ์มีแต่ตัวนับ ไม่มีชื่อนัด/id', async () => {
    const ap = await mustCreate(w.b, w.gid);
    await rsvp(w.a, ap.id, 'going');
    h.clock.set(DUE_1D);
    const r = await new Client().call('GET', '/api/cron/reminders', undefined, { headers: { authorization: `Bearer ${h.t.env.CRON_SECRET}` }, noCookie: true });
    expect(r.text).not.toContain(ap.id);
    expect(r.text).not.toContain('กินข้าว');
  });
});
