// R11-4, R11-5: LINE ยกเลิกนัด — ผู้รับแคบกว่ากระดิ่ง · ส่งทันทีหลัง commit (after) · cron ตามแล้วไม่ซ้ำ · cron ลองต่อเมื่อส่งไม่สำเร็จ · ตรวจซ้ำก่อนส่ง · reminder คงเกณฑ์เดิม
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const afterTasks = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));

import { mustCreate, post, setupHarness, world, type Harness, type World } from '../appointments/util';
import { DAY, LINE_A, LINE_B, MIN, clearFakeLine, disableLineEnv, enableLineEnv, fakeLine, linkLine, rsvp, runCron } from './util';
import { newId } from '@/lib/shared/id';
import { APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX, LINE_SEND_CAPS } from '@/lib/shared/limits';

const flushAfter = async () => {
  for (const task of afterTasks.splice(0)) await task();
};

const START_AT = Date.UTC(2026, 9, 24, 3);

let h: Harness;
let w: World;

beforeEach(async () => {
  afterTasks.length = 0;
  enableLineEnv();
  h = await setupHarness();
  w = await world(h);
  await h.rows('DELETE FROM notification');
});
afterEach(async () => {
  clearFakeLine();
  disableLineEnv();
  await h.cleanup();
});

const cancel = async (id: string, by = w.b) => {
  const r = await post(by.c, `/api/appointments/${id}/cancel`);
  expect(r.status, r.text).toBe(200);
};
const outbox = () => h.rows<{ user_id: string; status: string; attempts: number; last_error: string | null; payload: string }>('SELECT user_id, status, attempts, last_error, payload FROM notification_outbox ORDER BY user_id');

/** นัดของ b ที่ m/c ตอบไว้ · m, c เชื่อม LINE */
async function setup(mResponse: 'going' | 'maybe' | 'not_going' = 'going', cResponse: 'going' | 'maybe' | 'not_going' = 'maybe') {
  const ap = await mustCreate(w.b, w.gid, { title: 'หมูกระทะ' });
  await rsvp(w.m, ap.id, mResponse);
  await rsvp(w.c, ap.id, cResponse);
  await linkLine(h, w.m.id, LINE_A);
  await linkLine(h, w.c.id, LINE_B);
  await h.rows('DELETE FROM notification');
  return ap;
}

describe('R11-4 ผู้รับ LINE แคบกว่ากระดิ่ง', () => {
  it('กระดิ่ง = ไป/อาจไป/ยังไม่ตอบ · outbox เฉพาะคนตอบ "ไป" ที่เชื่อม LINE', async () => {
    const ap = await setup('going', 'maybe');
    await cancel(ap.id);
    const bell = await h.rows<{ user_id: string }>("SELECT user_id FROM notification WHERE kind = 'appointment.cancelled' ORDER BY user_id");
    expect(bell.map((r) => r.user_id)).toEqual([w.a.id, w.m.id, w.c.id].sort());
    const rows = await outbox();
    expect(rows.map((r) => r.user_id)).toEqual([w.m.id]);
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('ตอบไปแต่ไม่เชื่อม LINE / ผู้กดยกเลิกที่ตอบไป ไม่อยู่ใน outbox', async () => {
    const ap = await setup('going', 'going');
    await h.rows('UPDATE user SET line_user_id = NULL WHERE id = ?', [w.c.id]);
    await rsvp(w.b, ap.id, 'going');
    await linkLine(h, w.b.id, `U${'c'.repeat(32)}`);
    await cancel(ap.id);
    expect((await outbox()).map((r) => r.user_id)).toEqual([w.m.id]);
  });

  it('payload ไม่มีชื่อ/ไอดีผู้กดยกเลิก · เก็บเฉพาะข้อมูลที่ต้องใช้ส่ง', async () => {
    const ap = await setup();
    await cancel(ap.id);
    const payload = JSON.parse((await outbox())[0]!.payload) as { kind: string; params: Record<string, unknown> };
    expect(payload.kind).toBe('appointment.cancelled');
    expect(payload.params).toEqual({ groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap.id, title: 'หมูกระทะ', startAt: ap.startAt, tz: 'Asia/Bangkok' });
  });

  it('ยกเลิกหลังเวลาเริ่ม: ไม่มี outbox และไม่ตั้ง after()', async () => {
    const ap = await setup();
    h.clock.set(START_AT + 5 * MIN);
    await cancel(ap.id);
    expect(await outbox()).toEqual([]);
    expect(afterTasks).toHaveLength(0);
  });

  it('ไม่มีใครตอบไป: ไม่ตั้ง after()', async () => {
    const ap = await setup('maybe', 'not_going');
    await cancel(ap.id);
    expect(await outbox()).toEqual([]);
    expect(afterTasks).toHaveLength(0);
  });
});

describe('R11-4 ส่งทันที + ไม่ซ้ำ', () => {
  it('ก่อน after รัน: ยังไม่ push (ไม่บล็อก API) · หลัง after: push 1 ครั้ง · cron ตามไม่ส่งซ้ำ', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await cancel(ap.id);
    expect(fake.pushes()).toHaveLength(0);
    expect(afterTasks).toHaveLength(1);
    await flushAfter();
    expect(fake.pushes()).toHaveLength(1);
    expect(fake.pushes()[0]!.body.to).toBe(LINE_A);
    expect(fake.pushes()[0]!.headers['X-Line-Retry-Key']).toBeTruthy();
    expect((await outbox())[0]).toMatchObject({ status: 'sent', attempts: 1 });
    h.clock.advance(15 * MIN);
    await runCron(h);
    await runCron(h);
    expect(fake.pushes()).toHaveLength(1);
    expect((await outbox())[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('cron แซงก่อน after: ส่งครั้งเดียวเช่นกัน', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await cancel(ap.id);
    await runCron(h);
    expect(fake.pushes()).toHaveLength(1);
    await flushAfter();
    expect(fake.pushes()).toHaveLength(1);
  });

  it('after + cron พร้อมกัน: จองแถวได้ผู้ชนะคนเดียว', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await cancel(ap.id);
    await Promise.all([runCron(h), flushAfter()]);
    expect(fake.pushes()).toHaveLength(1);
    expect((await outbox())[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('เนื้อความ: ชื่อนัด เวลา ชื่อกลุ่ม ลิงก์ · ไม่มีชื่อคนกดยกเลิก · ภาษาตาม locale ตอนส่ง', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await h.rows("UPDATE user SET locale = 'en' WHERE id = ?", [w.m.id]);
    await cancel(ap.id);
    await flushAfter();
    const text = fake.pushes()[0]!.body.messages[0]!.text;
    expect(text).toContain('หมูกระทะ');
    expect(text).toContain('ก๊วนแมว');
    expect(text).toContain(`/appointments/${ap.id}?openExternalBrowser=1`);
    expect(text).toMatch(/^Cancelled:/);
    expect(text).not.toContain(w.b.displayName);
  });

  it('ไม่แตะแถวของนัดอื่น/reminder ที่ถึงกำหนดใน dispatch ทันที (scope เฉพาะนัดนี้)', async () => {
    const fake = fakeLine();
    const ap = await setup();
    const other = await mustCreate(w.b, w.gid, { title: 'อีกนัด' });
    await h.rows(
      "INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at) VALUES (?, ?, 'line', ?, 'pending', 0, ?, ?)",
      [newId(), w.m.id, JSON.stringify({ kind: 'appointment.reminder_1d', params: { groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: other.id, title: 'อีกนัด', startAt: other.startAt, tz: 'Asia/Bangkok' } }), h.clock.now(), h.clock.now()],
    );
    await cancel(ap.id);
    await flushAfter();
    expect(fake.pushes()).toHaveLength(1);
    expect(fake.pushes()[0]!.body.messages[0]!.text).toContain('หมูกระทะ');
    expect(await h.count("notification_outbox WHERE status = 'pending'")).toBe(1);
  });
});

describe('R11-4 cron ลองต่อเมื่อส่งไม่สำเร็จ', () => {
  it('ส่งทันทีล้ม (เครือข่าย): แถวยัง pending · cron ลองซ้ำด้วย retry key เดิม · รวม 1 ข้อความจริง', async () => {
    const fake = fakeLine(['network']);
    const ap = await setup();
    await cancel(ap.id);
    await flushAfter();
    expect(fake.pushes()).toHaveLength(1);
    expect((await outbox())[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'LINE_NETWORK' });
    h.clock.advance(2 * MIN);
    await runCron(h);
    expect(fake.pushes()).toHaveLength(2);
    expect(fake.pushes()[1]!.headers['X-Line-Retry-Key']).toBe(fake.pushes()[0]!.headers['X-Line-Retry-Key']);
    expect((await outbox())[0]).toMatchObject({ status: 'sent', attempts: 2 });
    h.clock.advance(15 * MIN);
    await runCron(h);
    expect(fake.pushes()).toHaveLength(2);
  });

  it('5xx แล้ว retry · ยังไม่ถึง backoff = ไม่ลองซ้ำ', async () => {
    const fake = fakeLine([{ status: 500 }]);
    const ap = await setup();
    await cancel(ap.id);
    await flushAfter();
    await runCron(h);
    expect(fake.pushes()).toHaveLength(1);
    h.clock.advance(2 * MIN);
    await runCron(h);
    expect(fake.pushes()).toHaveLength(2);
  });

  it('dispatch ไม่ได้ทำงานเลย (after ไม่รัน): cron ส่งให้', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await cancel(ap.id);
    afterTasks.length = 0;
    await runCron(h);
    expect(fake.pushes()).toHaveLength(1);
  });

  it('after ตั้งไม่ได้เพราะ env หาย ไม่ทำให้ API ล้ม', async () => {
    const ap = await setup();
    disableLineEnv();
    await cancel(ap.id);
    expect(afterTasks).toHaveLength(0);
  });
});

describe('R11-5 ตรวจซ้ำก่อนส่ง §2', () => {
  async function queued() {
    const ap = await setup();
    await cancel(ap.id);
    return ap;
  }
  const expectStale = async () => {
    const fake = fakeLine();
    await flushAfter();
    expect(fake.pushes()).toHaveLength(0);
    expect((await outbox())[0]).toMatchObject({ status: 'dead', last_error: 'STALE' });
  };

  it('นัดไม่ cancelled (active) → STALE', async () => {
    const ap = await queued();
    await h.rows("UPDATE appointment SET status = 'active' WHERE id = ?", [ap.id]);
    await expectStale();
  });

  it('startAt เปลี่ยนจากตอนเข้าคิว → STALE', async () => {
    const ap = await queued();
    await h.rows('UPDATE appointment SET start_at = start_at + 3600000, end_at = end_at + 3600000 WHERE id = ?', [ap.id]);
    await expectStale();
  });

  it('เลยเวลาเริ่มแล้ว → STALE', async () => {
    await queued();
    h.clock.set(START_AT + MIN);
    await expectStale();
  });

  it('กลุ่มถูกลบ → STALE', async () => {
    await queued();
    await h.rows('UPDATE groups SET deleted_at = ? WHERE id = ?', [h.clock.now(), w.gid]);
    await expectStale();
  });

  it('ผู้รับบัญชีไม่ active → STALE', async () => {
    await queued();
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [w.m.id]);
    await expectStale();
  });

  it('ผู้รับยกเลิกการเชื่อม LINE → STALE', async () => {
    await queued();
    await h.rows('UPDATE user SET line_user_id = NULL WHERE id = ?', [w.m.id]);
    await expectStale();
  });

  it('ผู้รับเลิกตอบไป / ออกจากกลุ่ม → STALE', async () => {
    const ap = await queued();
    await h.rows("UPDATE appointment_rsvp SET response = 'maybe' WHERE appointment_id = ? AND user_id = ?", [ap.id, w.m.id]);
    await expectStale();
  });
});

describe('เพดาน unread ของ appointment.cancelled กับ LINE', () => {
  const seedUnread = async (userId: string, kind: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await h.rows('INSERT INTO notification (id, user_id, kind, params, created_at) VALUES (?, ?, ?, ?, ?)', [
        newId(),
        userId,
        kind,
        JSON.stringify({ groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: newId(), title: 'เก่า', startAt: 1, tz: 'Asia/Bangkok' }),
        h.clock.now(),
      ]);
    }
  };

  it('ผู้ตอบ "ไป" ที่ unread cancelled ครบเพดาน: ไม่มีทั้งกระดิ่งและ LINE · คนอื่นยังได้', async () => {
    const fake = fakeLine();
    const ap = await setup('going', 'going');
    h.clock.advance(1000);
    await seedUnread(w.m.id, 'appointment.cancelled', APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX);
    await cancel(ap.id);
    expect((await outbox()).map((r) => r.user_id)).toEqual([w.c.id]);
    expect(await h.count("notification WHERE user_id = ? AND kind = 'appointment.cancelled' AND json_extract(params, '$.appointmentId') = ?", [w.m.id, ap.id])).toBe(0);
    await flushAfter();
    expect(fake.pushes().map((p) => p.body.to)).toEqual([LINE_B]);
  });

  it('created ที่ค้างอ่านครบเพดาน ไม่บัง LINE ยกเลิกนัด', async () => {
    const fake = fakeLine();
    const ap = await setup();
    h.clock.advance(1000);
    await seedUnread(w.m.id, 'appointment.created', APPOINTMENT_NOTIFY_UNREAD_PER_GROUP_MAX);
    await cancel(ap.id);
    await flushAfter();
    expect(fake.pushes().map((p) => p.body.to)).toEqual([LINE_A]);
  });
});

describe('R11-5 เพดาน/โควตาเดิม', () => {
  const seedSent = (n: number, userId: string, kind = 'appointment.created', appointmentId = newId()) =>
    Promise.all(
      Array.from({ length: n }, () =>
        h.rows(
          "INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at, sent_at) VALUES (?, ?, 'line', ?, 'sent', 1, ?, ?, ?)",
          [newId(), userId, JSON.stringify({ kind, params: { appointmentId } }), h.clock.now(), h.clock.now(), h.clock.now()],
        ),
      ),
    );

  it('เกิน perUser: dead LINE_CAP ไม่ push · กระดิ่งยังขึ้น', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await seedSent(LINE_SEND_CAPS.perUser, w.m.id);
    await cancel(ap.id);
    await flushAfter();
    expect(fake.pushes()).toHaveLength(0);
    const row = (await outbox()).find((r) => r.status === 'dead')!;
    expect(row.last_error).toBe('LINE_CAP');
    expect(await h.count("notification WHERE user_id = ? AND kind = 'appointment.cancelled'", [w.m.id])).toBe(1);
  });

  it('เพดาน perAppointmentKindUser นับตามชนิด appointment.cancelled ของนัดนี้', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await seedSent(LINE_SEND_CAPS.perAppointmentKindUser, w.m.id, 'appointment.cancelled', ap.id);
    await cancel(ap.id);
    await flushAfter();
    expect(fake.pushes()).toHaveLength(0);
    expect((await outbox()).some((r) => r.last_error === 'LINE_CAP')).toBe(true);
  });

  it('ชนิดอื่นของนัดเดียวกันไม่นับเพดานต่อนัด+ชนิดของ appointment.cancelled', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await seedSent(LINE_SEND_CAPS.perAppointmentKindUser, w.m.id, 'appointment.reminder_1d', ap.id);
    await cancel(ap.id);
    await flushAfter();
    expect(fake.pushes()).toHaveLength(1);
  });
});

describe('R11-5 reminder คงเกณฑ์เดิม (regression)', () => {
  it('reminder ของนัดที่ถูกยกเลิก: STALE ไม่ถูกส่ง · ขณะที่แถวยกเลิกนัดส่งได้', async () => {
    const fake = fakeLine();
    await setup();
    h.clock.set(START_AT - DAY);
    await runCron(h);
    expect(fake.pushes()).toHaveLength(1);
    expect(fake.pushes()[0]!.body.messages[0]!.text).not.toMatch(/ยกเลิก/);

    const ap2 = await mustCreate(w.b, w.gid, { title: 'อีกนัด' });
    await rsvp(w.m, ap2.id, 'going');
    await h.rows(
      "INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at) VALUES (?, ?, 'line', ?, 'pending', 0, ?, ?)",
      [newId(), w.m.id, JSON.stringify({ kind: 'appointment.reminder_1d', params: { groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap2.id, title: 'อีกนัด', startAt: ap2.startAt, tz: 'Asia/Bangkok' } }), h.clock.now(), h.clock.now()],
    );
    await cancel(ap2.id);
    const before = fake.pushes().length;
    await runCron(h);
    const reminder = await h.rows<{ status: string; last_error: string | null }>("SELECT status, last_error FROM notification_outbox WHERE json_extract(payload, '$.kind') = 'appointment.reminder_1d' AND json_extract(payload, '$.params.appointmentId') = ?", [ap2.id]);
    expect(reminder).toEqual([{ status: 'dead', last_error: 'STALE' }]);
    expect(fake.pushes().length).toBe(before + 1); // แถวยกเลิกนัดจากการยกเลิกนี้เท่านั้น
  });

  it('reminder 1h ถูก STALE ถ้าเหลือเวลาน้อยกว่า minLead เหมือนเดิม', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await h.rows(
      "INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at) VALUES (?, ?, 'line', ?, 'pending', 0, ?, ?)",
      [newId(), w.m.id, JSON.stringify({ kind: 'appointment.reminder_1h', params: { groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap.id, title: 'หมูกระทะ', startAt: ap.startAt, tz: 'Asia/Bangkok' } }), h.clock.now(), h.clock.now()],
    );
    h.clock.set(ap.startAt - MIN);
    await h.rows('UPDATE notification_outbox SET next_attempt_at = ?', [h.clock.now()]);
    await runCron(h);
    expect(fake.pushes()).toHaveLength(0);
    expect((await outbox())[0]).toMatchObject({ status: 'dead', last_error: 'STALE' });
  });

  it('reminder ปกติยังส่งได้', async () => {
    const fake = fakeLine();
    const ap = await setup();
    await h.rows(
      "INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at) VALUES (?, ?, 'line', ?, 'pending', 0, ?, ?)",
      [newId(), w.m.id, JSON.stringify({ kind: 'appointment.reminder_1d', params: { groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap.id, title: 'หมูกระทะ', startAt: ap.startAt, tz: 'Asia/Bangkok' } }), h.clock.now(), h.clock.now()],
    );
    await runCron(h);
    expect(fake.pushes()).toHaveLength(1);
    expect((await outbox())[0]).toMatchObject({ status: 'sent' });
  });
});
