// R10 §1.4 · Security M1, L2, Info 6: เพดาน LINE · unfollow ไม่ตกจากเพดาน event · เดือนที่ชนโควตา
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mustCreate, patch, post, setupHarness, world, type Harness, type World } from '../appointments/util';
import { DAY, HOUR, LINE_A, MIN, clearFakeLine, disableLineEnv, enableLineEnv, fakeLine, linkLine, rsvp, runCron, sendEvents, textEvent, unfollowEvent } from './util';
import { toLocal } from '@/lib/calendar';
import { newId } from '@/lib/shared/id';
import { LINE_SEND_CAPS, LINE_WEBHOOK_MAX_EVENTS } from '@/lib/shared/limits';

const BKK = 'Asia/Bangkok';
const START_AT = Date.UTC(2026, 9, 24, 3);
const bkk = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 7, mi);
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
function slot(startAt: number) {
  const s = toLocal(startAt, BKK);
  const e = toLocal(startAt + HOUR, BKK);
  return { startDate: s.date, startTime: hhmm(s.minute), endDate: e.date, endTime: hhmm(e.minute) };
}

let h: Harness;
let w: World;

beforeEach(async () => {
  enableLineEnv();
  h = await setupHarness();
  w = await world(h);
  await linkLine(h, w.a.id, LINE_A);
});
afterEach(async () => {
  vi.restoreAllMocks();
  clearFakeLine();
  disableLineEnv();
  await h.cleanup();
});

/** นัดที่ a ตอบ going โดยตรงใน DB */
async function seedGoing(startAt: number, scheduledAt: number): Promise<string> {
  const id = newId();
  await h.rows(
    "INSERT INTO appointment (id, group_id, title, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at, scheduled_at) VALUES (?, ?, 'นัด', ?, ?, 'Asia/Bangkok', '2026-10-24', 'active', ?, ?, ?, ?)",
    [id, w.gid, startAt, startAt + HOUR, w.b.id, scheduledAt, scheduledAt, scheduledAt],
  );
  await h.rows("INSERT INTO appointment_rsvp (appointment_id, user_id, response, updated_at) VALUES (?, ?, 'going', ?)", [id, w.a.id, h.clock.now()]);
  return id;
}

const seedOutbox = (o: { status: string; kind?: string; appointmentId?: string; attempts?: number; sentAt?: number | null; next?: number }) => {
  const now = h.clock.now();
  const payload = JSON.stringify({ kind: o.kind ?? 'appointment.reminder_1d', params: { appointmentId: o.appointmentId ?? newId() } });
  return h.rows(
    "INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at, sent_at) VALUES (?, ?, 'line', ?, ?, ?, ?, ?, ?)",
    [newId(), w.a.id, payload, o.status, o.attempts ?? 1, o.next ?? now, now, o.sentAt ?? null],
  );
};

const statusCount = (status: string, err?: string) =>
  err === undefined ? h.count('notification_outbox WHERE status = ?', [status]) : h.count('notification_outbox WHERE status = ? AND last_error = ?', [status, err]);

describe('เพดาน นัด + ชนิด + ผู้รับเดียวกัน', () => {
  async function reschedule(apId: string): Promise<void> {
    const now = h.clock.now();
    const start = Math.ceil((now + 61 * MIN) / (30 * MIN)) * 30 * MIN;
    const r = await patch(w.b.c, `/api/appointments/${apId}`, slot(start));
    expect(r.status, r.text).toBe(200);
    h.clock.set(start - HOUR);
    await runCron(h);
  }

  it('เลื่อนนัดซ้ำ 12 รอบ: push ไม่เกินเพดาน · กระดิ่งครบ · พ้น 24 ชม. ส่งได้อีก', async () => {
    const line = fakeLine();
    const t0 = h.clock.now();
    const ap = await mustCreate(w.b, w.gid, slot(Math.ceil((t0 + 5 * HOUR) / (30 * MIN)) * 30 * MIN));
    await rsvp(w.a, ap.id, 'going');
    for (let i = 0; i < 12; i++) await reschedule(ap.id);

    expect(line.pushes()).toHaveLength(LINE_SEND_CAPS.perAppointmentKindUser);
    expect(await statusCount('sent')).toBe(2);
    expect(await statusCount('dead', 'LINE_CAP')).toBe(10);
    expect(await h.count("notification WHERE kind = 'appointment.reminder_1h' AND user_id = ?", [w.a.id])).toBe(12);

    // นัดรอบล่าสุดใกล้เริ่มแล้ว เลื่อนออกไปก่อนจึงเดินนาฬิกาข้ามหน้าต่าง 24 ชม. ได้
    const far = Math.ceil((h.clock.now() + 3 * DAY) / (30 * MIN)) * 30 * MIN;
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, slot(far))).status).toBe(200);
    h.clock.advance(DAY);
    await reschedule(ap.id);
    expect(line.pushes()).toHaveLength(3);
  });

  it('คนละชนิดของนัดเดียวกันไม่นับรวม', async () => {
    const line = fakeLine();
    const appointmentId = await seedGoing(START_AT, 0);
    h.clock.set(START_AT - HOUR);
    await seedOutbox({ status: 'sent', appointmentId, kind: 'appointment.reminder_1d', sentAt: h.clock.now() - HOUR });
    await seedOutbox({ status: 'sent', appointmentId, kind: 'appointment.reminder_1d', sentAt: h.clock.now() - HOUR });
    await runCron(h);
    expect(line.pushes()).toHaveLength(1);
  });

  it('retry ของแถวเดิมไม่นับตัวเอง', async () => {
    const line = fakeLine([{ status: 500 }]);
    await seedGoing(START_AT, 0);
    h.clock.set(START_AT - HOUR);
    await runCron(h);
    expect(await statusCount('pending')).toBe(1);
    h.clock.advance(2 * MIN);
    await runCron(h);
    expect(line.pushes()).toHaveLength(2);
    expect(await statusCount('sent')).toBe(1);
  });
});

describe('เพดานต่อผู้รับ', () => {
  it('7 นัดพร้อมกัน: push 6 · แถวที่ 7 dead LINE_CAP · กระดิ่ง 7 · พ้น 24 ชม. ส่งได้', async () => {
    const line = fakeLine();
    for (let i = 0; i < 7; i++) await seedGoing(START_AT + i * MIN, 0);
    h.clock.set(START_AT - DAY + 10 * MIN);
    const res = await runCron(h);
    expect(res.line).toMatchObject({ sent: 6, capped: 1 });
    expect(line.pushes()).toHaveLength(LINE_SEND_CAPS.perUser);
    expect(await statusCount('dead', 'LINE_CAP')).toBe(1);
    expect(await h.count("notification WHERE kind = 'appointment.reminder_1d' AND user_id = ?", [w.a.id])).toBe(7);

    h.clock.advance(DAY);
    await seedGoing(h.clock.now() + 2 * HOUR, 0);
    h.clock.advance(HOUR);
    await runCron(h);
    expect(line.pushes()).toHaveLength(7);
  });

  it('รันพร้อมกันที่ขอบเพดาน: ไม่เกิน (จองในคำสั่งเดียว)', async () => {
    const line = fakeLine();
    h.clock.set(START_AT - DAY + 10 * MIN);
    for (let i = 0; i < 5; i++) await seedOutbox({ status: 'sent', sentAt: h.clock.now() - HOUR });
    await seedGoing(START_AT, 0);
    await seedGoing(START_AT + MIN, 0);
    await seedGoing(START_AT + 2 * MIN, 0);
    await Promise.all([runCron(h), runCron(h), runCron(h)]);
    expect(line.pushes()).toHaveLength(1);
  });

  it('แถวที่จองแล้วแต่ยังไม่จบ (กำลังส่ง/รอ retry) นับเข้าเพดาน', async () => {
    const line = fakeLine();
    h.clock.set(START_AT - HOUR);
    for (let i = 0; i < 5; i++) await seedOutbox({ status: 'sent', sentAt: h.clock.now() - HOUR });
    await seedOutbox({ status: 'pending', attempts: 1, next: h.clock.now() + HOUR });
    await seedGoing(START_AT, 0);
    await runCron(h);
    expect(line.pushes()).toHaveLength(0);
    expect(await statusCount('dead', 'LINE_CAP')).toBe(1);
  });

  it.each([
    ['sent_at = now − 24 ชม. ไม่นับ', 0, 1],
    ['sent_at = now − 24 ชม. + 1 ms นับ', 1, 0],
  ])('ขอบ 24 ชม.: %s', async (_n, offset, pushes) => {
    const line = fakeLine();
    h.clock.set(START_AT - HOUR);
    const now = h.clock.now();
    for (let i = 0; i < 5; i++) await seedOutbox({ status: 'sent', sentAt: now - HOUR });
    await seedOutbox({ status: 'sent', sentAt: now - DAY + offset });
    await seedGoing(START_AT, 0);
    await runCron(h);
    expect(line.pushes()).toHaveLength(pushes);
    expect(await statusCount('dead', 'LINE_CAP')).toBe(1 - pushes);
  });

  it('แถว dead ไม่นับเข้าเพดาน', async () => {
    const line = fakeLine();
    h.clock.set(START_AT - HOUR);
    for (let i = 0; i < 8; i++) await seedOutbox({ status: 'dead' });
    await seedGoing(START_AT, 0);
    await runCron(h);
    expect(line.pushes()).toHaveLength(1);
  });

  it('เพดานของคนหนึ่งไม่กระทบคนอื่น', async () => {
    const line = fakeLine();
    h.clock.set(START_AT - HOUR);
    for (let i = 0; i < 6; i++) await seedOutbox({ status: 'sent', sentAt: h.clock.now() - HOUR });
    const other = `U${'c'.repeat(32)}`;
    await linkLine(h, w.c.id, other);
    const ap = await seedGoing(START_AT, 0);
    await h.rows("INSERT INTO appointment_rsvp (appointment_id, user_id, response, updated_at) VALUES (?, ?, 'going', ?)", [ap, w.c.id, h.clock.now()]);
    await runCron(h);
    expect(line.pushes().map((p) => p.body.to)).toEqual([other]);
  });
});

describe('เดือนที่ชนโควตา (Info 6)', () => {
  it('ชน 429 นาทีสุดท้ายของเดือน: next_attempt_at = เวลาที่ชน · เดือนถัดไปส่งได้', async () => {
    const line = fakeLine([{ status: 429, body: '{"message":"You have reached your monthly limit."}' }]);
    const hitAt = bkk(2026, 10, 31, 23, 59);
    h.clock.set(hitAt);
    await seedGoing(hitAt + HOUR, 0);
    await runCron(h);
    const rows = await h.rows<{ n: number; e: string }>('SELECT next_attempt_at AS n, last_error AS e FROM notification_outbox');
    expect(rows.map((r) => [Number(r.n), r.e])).toEqual([[hitAt, 'LINE_MONTHLY_LIMIT']]);

    // ยังเดือนเดิม = ไม่เรียก LINE
    h.clock.set(hitAt + 30_000);
    await seedGoing(hitAt + 30_000 + HOUR, 0);
    await runCron(h);
    expect(line.pushes()).toHaveLength(1);

    // เดือนใหม่ (ภายในเวลาที่ backoff ของแถวเดิมจะล้ำเข้ามา)
    const nov = bkk(2026, 11, 1, 0, 1);
    h.clock.set(nov);
    await seedGoing(nov + HOUR, 0);
    await runCron(h);
    expect(line.pushes()).toHaveLength(2);
    expect(await statusCount('sent')).toBe(1);
  });
});

describe('unfollow กับเพดาน event (L2)', () => {
  it('unfollow หลัง event เกินเพดานยังถูกจัดการ · log จำนวนที่ทิ้ง', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fakeLine();
    const padding = Array.from({ length: LINE_WEBHOOK_MAX_EVENTS + 3 }, (_, i) => textEvent(LINE_A, 'hello', `r${i}`));
    const res = await sendEvents([...padding, unfollowEvent(LINE_A)]);
    expect(res.status).toBe(200);
    expect((await h.rows<{ l: string | null }>('SELECT line_user_id AS l FROM user WHERE id = ?', [w.a.id]))[0]!.l).toBeNull();
    expect(warn).toHaveBeenCalledWith('[line] webhook events over cap; dropped=3');
    expect(warn.mock.calls.join(' ')).not.toContain(LINE_A);
  });

  it('คงลำดับ event: ส่งโค้ดแล้ว unfollow ในคำขอเดียวกัน = จบที่ไม่ผูก', async () => {
    fakeLine();
    const other = `U${'d'.repeat(32)}`;
    const code = await post<{ code: string }>(w.c.c, '/api/me/line');
    expect(code.status, code.text).toBe(201);
    expect((await sendEvents([textEvent(other, code.data.code), unfollowEvent(other)])).status).toBe(200);
    expect((await h.rows<{ l: string | null }>('SELECT line_user_id AS l FROM user WHERE id = ?', [w.c.id]))[0]!.l).toBeNull();
  });

  it('event ที่ throw: ตอบ 200 · log เฉพาะชื่อชนิด ไม่มีข้อมูลลับ', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeLine();
    await h.rows("CREATE TRIGGER fail_unlink BEFORE UPDATE OF line_user_id ON user BEGIN SELECT RAISE(ABORT, 'SECRET-BOOM'); END");
    const res = await sendEvents([unfollowEvent(LINE_A)]);
    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledTimes(1);
    const logged = String(error.mock.calls[0]![0]);
    expect(logged).toMatch(/^\[line\] webhook event failed /);
    expect(logged).not.toMatch(/SECRET-BOOM|U[a-f0-9]{32}/);
  });
});
