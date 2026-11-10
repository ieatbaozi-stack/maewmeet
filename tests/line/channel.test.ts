// R10-5 · ADR 0011 Test requirements ข้อ 4: ช่องทาง LINE (จำลอง) — เนื้อหา · retry · โควตา · ตรวจซ้ำก่อนส่ง · ไม่มี env ปิดเงียบ
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, call, mustCreate, patch, setupHarness, world, type ApptDto, type Harness, type World } from '../appointments/util';
import { ACCESS_TOKEN, DAY, HOUR, LINE_A, LINE_B, MIN, clearFakeLine, disableLineEnv, enableLineEnv, fakeLine, linkLine, rsvp, runCron } from './util';
import { newId } from '@/lib/shared/id';

const START_AT = Date.UTC(2026, 9, 24, 3);
const DUE_1D = START_AT - DAY;
const DUE_1H = START_AT - HOUR;

let h: Harness;
let w: World;
let ap: ApptDto;

beforeEach(async () => {
  enableLineEnv();
  h = await setupHarness();
  w = await world(h);
  ap = await mustCreate(w.b, w.gid, { title: 'กินข้าว', description: 'รายละเอียดลับ', placeName: 'ที่ลับ', mapUrl: 'https://www.openstreetmap.org/#map=15/13.7/100.5' });
  await rsvp(w.a, ap.id, 'going');
  await linkLine(h, w.a.id, LINE_A);
});
afterEach(async () => {
  vi.restoreAllMocks();
  clearFakeLine();
  disableLineEnv();
  await h.cleanup();
});

type OB = { status: string; attempts: number; next_attempt_at: number; last_error: string | null; id: string; payload: string };
const outbox = () => h.rows<OB>('SELECT id, status, attempts, next_attempt_at, last_error, payload FROM notification_outbox ORDER BY created_at, id');

describe('เนื้อหา + รูปแบบ Push', () => {
  it('Push ครั้งเดียว · header ครบ · ข้อความมีแค่ชื่อนัด วันเวลา ชื่อกลุ่ม ลิงก์ · ไม่มีสถานที่/รายละเอียด/ชื่อสมาชิก', async () => {
    const line = fakeLine();
    h.clock.set(DUE_1D);
    const res = await runCron(h);
    expect(res.line).toMatchObject({ enabled: true, sent: 1 });
    expect(line.pushes()).toHaveLength(1);
    const p = line.pushes()[0]!;
    expect(p.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    const rows = await outbox();
    expect(rows[0]).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
    expect(p.headers['X-Line-Retry-Key']).toBe(rows[0]!.id);
    expect(p.body.to).toBe(LINE_A);
    const text = p.body.messages[0]!.text;
    expect(p.body.messages).toHaveLength(1);
    expect(text).toContain('กินข้าว');
    expect(text).toContain('ก๊วนแมว');
    expect(text).toContain('พ.ศ. 2569');
    expect(text).toContain('10:00');
    expect(text).toContain(`https://maewmeet.test/appointments/${ap.id}?openExternalBrowser=1`);
    expect(text).not.toMatch(/ที่ลับ|รายละเอียดลับ|openstreetmap|ชื่อ alice|ชื่อ bob/);
    expect(JSON.parse(rows[0]!.payload)).toEqual({
      kind: 'appointment.reminder_1d',
      params: { groupId: w.gid, groupName: 'ก๊วนแมว', appointmentId: ap.id, title: 'กินข้าว', startAt: START_AT, tz: 'Asia/Bangkok' },
    });
  });

  it('แปลตาม user.locale ตอนส่ง + ใช้คีย์ reminder_1h', async () => {
    await h.rows("UPDATE user SET locale = 'en' WHERE id = ?", [w.a.id]);
    const line = fakeLine();
    h.clock.set(DUE_1H);
    await runCron(h);
    const text = line.pushes()[0]!.body.messages[0]!.text;
    expect(text).toMatch(/^Starting soon: กินข้าว/);
    expect(text).toContain('2026');
    expect(text).not.toContain('พ.ศ.');
  });

  it('รันซ้ำไม่ส่งซ้ำ · คนไม่เชื่อม LINE ไม่เข้าคิวแต่ได้กระดิ่ง', async () => {
    await rsvp(w.c, ap.id, 'going');
    const line = fakeLine();
    h.clock.set(DUE_1D);
    await runCron(h);
    await runCron(h);
    expect(line.pushes()).toHaveLength(1);
    expect(await h.count("notification WHERE kind = 'appointment.reminder_1d'")).toBe(2);
    expect(await h.count('notification_outbox')).toBe(1);
  });

  it('รันพร้อมกันส่งครั้งเดียว', async () => {
    const line = fakeLine();
    h.clock.set(DUE_1D);
    await Promise.all([runCron(h), runCron(h), runCron(h)]);
    expect(line.pushes()).toHaveLength(1);
  });
});

describe('ผลจาก LINE (ADR 0011 §5)', () => {
  it('409 = sent', async () => {
    fakeLine([{ status: 409 }]);
    h.clock.set(DUE_1D);
    await runCron(h);
    expect((await outbox())[0]).toMatchObject({ status: 'sent' });
  });

  it('5xx/เครือข่ายล้ม: retry ≤ 5 ครั้ง backoff 2^attempts นาที retry key เดิม แล้ว dead', async () => {
    const line = fakeLine([{ status: 500 }, 'network', { status: 503 }, { status: 500 }, { status: 502 }]);
    h.clock.set(DUE_1D);
    await runCron(h);
    let row = (await outbox())[0]!;
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'LINE_HTTP_500' });
    expect(Number(row.next_attempt_at)).toBe(DUE_1D + 2 * MIN);

    // ยังไม่ถึงเวลา = ไม่ลอง
    h.clock.advance(2 * MIN - 1);
    await runCron(h);
    expect(line.pushes()).toHaveLength(1);

    const expected = [4, 8, 16];
    for (let i = 0; i < 3; i++) {
      h.clock.set(Number((await outbox())[0]!.next_attempt_at));
      const t = h.clock.now();
      await runCron(h);
      row = (await outbox())[0]!;
      expect(row.status).toBe('pending');
      expect(Number(row.attempts)).toBe(i + 2);
      expect(Number(row.next_attempt_at)).toBe(t + expected[i]! * MIN);
    }
    h.clock.set(Number((await outbox())[0]!.next_attempt_at));
    await runCron(h);
    row = (await outbox())[0]!;
    expect(row).toMatchObject({ status: 'dead', attempts: 5, last_error: 'LINE_HTTP_502' });
    expect(line.pushes()).toHaveLength(5);
    expect(new Set(line.pushes().map((p) => p.headers['X-Line-Retry-Key'])).size).toBe(1);

    h.clock.advance(HOUR);
    await runCron(h);
    expect(line.pushes()).toHaveLength(5);
  });

  it('429 rate limit อื่น = retry', async () => {
    fakeLine([{ status: 429, body: '{"message":"The API rate limit has been exceeded."}' }]);
    h.clock.set(DUE_1D);
    await runCron(h);
    expect((await outbox())[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'LINE_RATE_LIMIT' });
  });

  it('4xx อื่น = dead ไม่ retry', async () => {
    const line = fakeLine([{ status: 400, body: '{"message":"bad"}' }]);
    h.clock.set(DUE_1D);
    await runCron(h);
    expect((await outbox())[0]).toMatchObject({ status: 'dead', last_error: 'LINE_HTTP_400' });
    h.clock.advance(HOUR);
    await runCron(h);
    expect(line.pushes()).toHaveLength(1);
  });

  it('429 monthly limit: dead ทั้งคิว · หยุดเรียก LINE · กระดิ่งปกติ · log จำนวนไม่ log เนื้อหา · เดือนนี้ไม่ลองอีก · เดือนใหม่ลองได้', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await rsvp(w.c, ap.id, 'going');
    await linkLine(h, w.c.id, LINE_B);
    const line = fakeLine([{ status: 429, body: '{"message":"You have reached your monthly limit."}' }]);
    h.clock.set(DUE_1D);
    const res = await runCron(h);
    expect(res.line.monthlyLimit).toBe(true);
    expect(line.pushes()).toHaveLength(1);
    const rows = await outbox();
    expect(rows.map((r) => [r.status, r.last_error])).toEqual([
      ['dead', 'LINE_MONTHLY_LIMIT'],
      ['dead', 'LINE_MONTHLY_LIMIT'],
    ]);
    expect(await h.count("notification WHERE kind = 'appointment.reminder_1d'")).toBe(2);
    expect(warn).toHaveBeenCalledWith('[line] monthly limit reached; dropped=2');
    for (const c of warn.mock.calls) expect(String(c[0])).not.toMatch(/กินข้าว|U[a-f0-9]{32}/);

    // รอบถัดไปในเดือนเดียวกัน: แถวใหม่ไม่ถูกส่ง
    h.clock.set(DUE_1H);
    await runCron(h);
    expect(line.pushes()).toHaveLength(1);
    expect(await h.count("notification_outbox WHERE status = 'pending'")).toBe(0);

    // เดือนใหม่
    const next = await mustCreateAt(Date.UTC(2026, 10, 3, 3));
    await rsvp(w.a, next, 'going');
    h.clock.set(Date.UTC(2026, 10, 2, 3));
    await runCron(h);
    expect(line.pushes()).toHaveLength(2);
    expect(await h.count("notification_outbox WHERE status = 'sent'")).toBe(1);
  });

  async function mustCreateAt(startAt: number): Promise<string> {
    const id = newId();
    await h.rows(
      "INSERT INTO appointment (id, group_id, title, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at, scheduled_at) VALUES (?, ?, 'นัดเดือนหน้า', ?, ?, 'Asia/Bangkok', '2026-11-03', 'active', ?, ?, ?, ?)",
      [id, w.gid, startAt, startAt + HOUR, w.b.id, h.clock.now(), h.clock.now(), h.clock.now()],
    );
    return id;
  }
});

describe('ตรวจซ้ำก่อนส่ง (แถวค้างจาก retry)', () => {
  async function pendingAfterFailure() {
    const line = fakeLine([{ status: 500 }]);
    h.clock.set(DUE_1D);
    await runCron(h);
    expect((await outbox())[0]).toMatchObject({ status: 'pending' });
    h.clock.advance(15 * MIN);
    return line;
  }
  // R11: ยกเลิกนัดเขียนแถว appointment.cancelled ลง outbox ด้วย (และส่งได้) → ตรวจเฉพาะแถว reminder: ต้องไม่ถูกส่งซ้ำ และตายเป็น STALE
  const reminders = async () => (await outbox()).filter((r) => (JSON.parse(r.payload) as { kind: string }).kind.startsWith('appointment.reminder'));
  const expectStale = async (line: ReturnType<typeof fakeLine>) => {
    await runCron(h);
    const [rem, ...rest] = await reminders();
    expect(rest).toHaveLength(0);
    expect(rem).toMatchObject({ status: 'dead', last_error: 'STALE' });
    expect(line.pushes().filter((x) => x.headers['X-Line-Retry-Key'] === rem!.id)).toHaveLength(1); // ส่งแค่ครั้งแรกที่ล้มเหลว (500) ไม่ส่งรอบสอง
  };

  it('เปลี่ยนจาก going = ไม่ส่ง', async () => {
    const line = await pendingAfterFailure();
    await rsvp(w.a, ap.id, 'maybe');
    await expectStale(line);
  });

  it('นัดถูกยกเลิก = ไม่ส่ง', async () => {
    const line = await pendingAfterFailure();
    expect((await call(w.b.c, 'POST', `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
    await expectStale(line);
  });

  it('เลื่อนเวลานัด = แถวเก่าไม่ส่ง', async () => {
    const line = await pendingAfterFailure();
    expect((await patch(w.b.c, `/api/appointments/${ap.id}`, { startDate: '2026-10-25', startTime: '10:00', endDate: '2026-10-25', endTime: '11:00' })).status).toBe(200);
    await expectStale(line);
  });

  it('line_user_id ถูกล้างแล้ว = ไม่ส่ง', async () => {
    const line = await pendingAfterFailure();
    await h.rows('UPDATE user SET line_user_id = NULL WHERE id = ?', [w.a.id]);
    await expectStale(line);
  });

  it('เหลือเวลาต่ำกว่า minLead = ไม่ส่ง', async () => {
    const line = fakeLine([{ status: 500 }]);
    h.clock.set(DUE_1H);
    await runCron(h);
    h.clock.set(START_AT - 15 * MIN + 1);
    await runCron(h);
    expect(line.pushes()).toHaveLength(1);
    expect((await outbox())[0]).toMatchObject({ status: 'dead', last_error: 'STALE' });
  });

  it('เหลือ 15 นาทีพอดียังส่ง', async () => {
    const line = fakeLine([{ status: 500 }]);
    h.clock.set(DUE_1H);
    await runCron(h);
    h.clock.set(START_AT - 15 * MIN);
    await runCron(h);
    expect(line.pushes()).toHaveLength(2);
    expect((await outbox())[0]).toMatchObject({ status: 'sent' });
  });
});

describe('ไม่มี env = ปิดเงียบ', () => {
  it('กระดิ่งปกติ · ไม่เขียน outbox · ไม่เรียก LINE', async () => {
    disableLineEnv();
    const line = fakeLine();
    h.clock.set(DUE_1D);
    const res = await runCron(h);
    expect(res.line.enabled).toBe(false);
    expect(await h.count("notification WHERE kind = 'appointment.reminder_1d'")).toBe(1);
    expect(await h.count('notification_outbox')).toBe(0);
    expect(line.calls).toHaveLength(0);
  });

  it('มีแค่ token (ไม่ครบคู่) = ปิด', async () => {
    delete process.env.LINE_MESSAGING_CHANNEL_SECRET;
    const { resetEnvCache } = await import('@/lib/shared/env');
    resetEnvCache();
    const line = fakeLine();
    h.clock.set(DUE_1D);
    expect((await runCron(h)).line.enabled).toBe(false);
    expect(line.calls).toHaveLength(0);
  });
});

describe('เก็บกวาดใน cron รายวัน', () => {
  it('ลบเฉพาะ sent/dead เกิน 90 วัน ไม่แตะ pending หรือแถวใหม่', async () => {
    const t = h.clock.now();
    const ins = (id: string, status: string, created: number) =>
      h.rows("INSERT INTO notification_outbox (id, user_id, channel, payload, status, attempts, next_attempt_at, created_at) VALUES (?, ?, 'line', '{}', ?, 0, ?, ?)", [id, w.a.id, status, created, created]);
    await ins('o-sent-old', 'sent', t - 91 * DAY);
    await ins('o-dead-old', 'dead', t - 91 * DAY);
    await ins('o-pending-old', 'pending', t - 91 * DAY);
    await ins('o-sent-new', 'sent', t - 89 * DAY);
    const r = await new Client().call<{ cleaned: Record<string, number> }>('GET', '/api/cron/daily', undefined, { headers: { authorization: `Bearer ${h.t.env.CRON_SECRET}` }, noCookie: true });
    expect(r.status).toBe(200);
    expect(r.data.cleaned.oldLineOutbox).toBe(2);
    expect((await h.rows<{ id: string }>('SELECT id FROM notification_outbox ORDER BY id')).map((x) => x.id)).toEqual(['o-pending-old', 'o-sent-new']);
  });
});

describe('ความลับ', () => {
  it('ไม่มี token/LINE id ใน log · ไม่มี LINE id ใน params/last_error', async () => {
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    fakeLine([{ status: 500 }]);
    h.clock.set(DUE_1D);
    await runCron(h);
    for (const s of spies) for (const c of s.mock.calls) expect(c.join(' ')).not.toMatch(new RegExp(`${ACCESS_TOKEN}|${LINE_A}`));
    const rows = await h.rows<{ payload: string; last_error: string | null }>('SELECT payload, last_error FROM notification_outbox');
    expect(JSON.stringify(rows)).not.toContain(LINE_A);
  });
});
