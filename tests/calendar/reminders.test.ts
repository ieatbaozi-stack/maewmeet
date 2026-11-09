// R10-2 · ADR 0011 Test requirements ข้อ 1: เวลาถึงกำหนด ช่วงเงียบ เงื่อนไขส่ง และกรณีกระชั้น · ขอบเวลา ข้ามวัน/เดือน/ปี ปีอธิกสุรทิน tz อื่น DST
import { describe, expect, it } from 'vitest';
import { decideReminder, reminderDueAt, reminderRawDueAt, reminderStillSendable, startOfMonthAt, toLocal, type ReminderKind } from '@/lib/calendar';

const MIN = 60_000;
const HOUR = 60 * MIN;
const BKK = 'Asia/Bangkok';
const bkk = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 7, mi);
const D1: ReminderKind = 'appointment.reminder_1d';
const H1: ReminderKind = 'appointment.reminder_1h';
const NUDGE: ReminderKind = 'appointment.rsvp_nudge';
const decide = (kind: ReminderKind, startAt: number, scheduledAt: number, now: number, tz = BKK) => decideReminder({ kind, startAt, tz, scheduledAt, now });

describe('reminderDueAt — ช่วงเงียบ 22:00–07:59', () => {
  it.each([D1, NUDGE])('%s: 21:59 ไม่เลื่อน', (k) => {
    const start = bkk(2026, 11, 11, 21, 59);
    expect(reminderDueAt(k, start, BKK)).toBe(bkk(2026, 11, 10, 21, 59));
  });

  it.each([D1, NUDGE])('%s: 22:00 พอดี → 08:00 วันถัดไป', (k) => {
    expect(reminderDueAt(k, bkk(2026, 11, 11, 22), BKK)).toBe(bkk(2026, 11, 11, 8));
  });

  it.each([D1, NUDGE])('%s: 07:59 → 08:00 วันเดียวกัน', (k) => {
    expect(reminderDueAt(k, bkk(2026, 11, 11, 7, 59), BKK)).toBe(bkk(2026, 11, 10, 8));
  });

  it.each([D1, NUDGE])('%s: 08:00 พอดี ไม่เลื่อน', (k) => {
    expect(reminderDueAt(k, bkk(2026, 11, 11, 8), BKK)).toBe(bkk(2026, 11, 10, 8));
  });

  it('นัดเช้ามาก 01:00: 1d ไม่เด้งกลางดึก → 08:00 ของวันก่อนนัด', () => {
    expect(reminderDueAt(D1, bkk(2026, 11, 11, 1), BKK)).toBe(bkk(2026, 11, 10, 8));
  });

  it('เตือน 1 ชม. ไม่มีช่วงเงียบ: นัด 03:00 → 02:00', () => {
    expect(reminderDueAt(H1, bkk(2026, 11, 11, 3), BKK)).toBe(bkk(2026, 11, 11, 2));
  });

  it('ข้ามเที่ยงคืน: raw 23:30 → 08:00 ของวันถัดไป', () => {
    expect(reminderDueAt(D1, bkk(2026, 11, 11, 23, 30), BKK)).toBe(bkk(2026, 11, 11, 8));
  });

  it('ข้ามเดือน: raw 31 ต.ค. 23:00 → 1 พ.ย. 08:00', () => {
    expect(reminderDueAt(D1, bkk(2026, 11, 1, 23), BKK)).toBe(bkk(2026, 11, 1, 8));
  });

  it('ข้ามปี: raw 31 ธ.ค. 2026 23:00 → 1 ม.ค. 2027 08:00', () => {
    expect(reminderDueAt(D1, bkk(2027, 1, 1, 23), BKK)).toBe(bkk(2027, 1, 1, 8));
  });

  it('ปีอธิกสุรทิน: raw 28 ก.พ. 2028 23:00 → 29 ก.พ. 08:00 · ปีปกติ raw 28 ก.พ. 2027 23:00 → 1 มี.ค. 08:00', () => {
    expect(reminderDueAt(D1, bkk(2028, 2, 29, 23), BKK)).toBe(bkk(2028, 2, 29, 8));
    expect(reminderDueAt(D1, bkk(2027, 3, 1, 23), BKK)).toBe(bkk(2027, 3, 1, 8));
  });

  it('ใช้ tz ของนัด: Asia/Tokyo raw 22:30 → 08:00 Tokyo วันถัดไป (ไม่ใช่เวลา Bangkok)', () => {
    const start = Date.UTC(2026, 10, 11, 13, 30); // 22:30 Tokyo
    const due = reminderDueAt(D1, start, 'Asia/Tokyo');
    expect(toLocal(due, 'Asia/Tokyo')).toEqual({ date: '2026-11-11', minute: 480 });
    expect(due).toBe(Date.UTC(2026, 10, 10, 23, 0));
  });

  it('startAt − 24 ชม. เป็นช่วงเวลาจริง ไม่ใช่เวลาผนัง: Europe/London ข้าม DST', () => {
    const start = Date.UTC(2026, 2, 29, 12, 0); // หลังเปลี่ยนเวลา 29 มี.ค. 2026
    expect(reminderRawDueAt(D1, start)).toBe(start - 24 * HOUR);
  });

  it('DST gap ที่ 08:00: Pacific/Apia ข้ามวันที่ 30 ธ.ค. 2011 ทั้งวัน → เลื่อนไปข้างหน้า ไม่โยน error', () => {
    const start = Date.UTC(2011, 11, 31, 8, 30); // raw due = 29 ธ.ค. 22:30 ที่ Apia
    expect(toLocal(reminderRawDueAt(D1, start), 'Pacific/Apia')).toEqual({ date: '2011-12-29', minute: 1350 });
    expect(toLocal(reminderDueAt(D1, start, 'Pacific/Apia'), 'Pacific/Apia')).toEqual({ date: '2011-12-31', minute: 480 });
  });
});

describe('decideReminder — เงื่อนไขส่ง', () => {
  const start = bkk(2026, 11, 11, 18);
  const raw1d = start - 24 * HOUR;
  const raw1h = start - 60 * MIN;
  const created = bkk(2026, 11, 1, 12);

  it('ก่อนถึงกำหนด 1 ms = ยังไม่ส่ง · ถึงกำหนดพอดี = ส่ง', () => {
    expect(decide(D1, start, created, raw1d - 1)).toBe('not_due');
    expect(decide(D1, start, created, raw1d)).toBe('send');
    expect(decide(H1, start, created, raw1h - 1)).toBe('not_due');
    expect(decide(H1, start, created, raw1h)).toBe('send');
  });

  it('เหลือ 3 ชม. พอดี = ส่ง · ขาด 1 ms = ไม่ส่ง (1d, nudge)', () => {
    for (const k of [D1, NUDGE]) {
      expect(decide(k, start, created, start - 3 * HOUR)).toBe('send');
      expect(decide(k, start, created, start - 3 * HOUR + 1)).toBe('too_late');
    }
  });

  it('เหลือ 15 นาทีพอดี = ส่ง · ขาด 1 ms = ไม่ส่ง (1h)', () => {
    expect(decide(H1, start, created, start - 15 * MIN)).toBe('send');
    expect(decide(H1, start, created, start - 15 * MIN + 1)).toBe('too_late');
  });

  it('เลยเวลาเริ่มนัดแล้ว = ไม่ส่ง', () => {
    expect(decide(H1, start, created, start)).toBe('too_late');
    expect(decide(H1, start, created, start + HOUR)).toBe('too_late');
  });

  it('scheduledAt == rawDue = ไม่ข้าม · rawDue + 1 ms = ข้าม', () => {
    expect(decide(D1, start, raw1d, raw1d)).toBe('send');
    expect(decide(D1, start, raw1d + 1, raw1d + HOUR)).toBe('scheduled_too_close');
    expect(decide(H1, start, raw1h, raw1h)).toBe('send');
    expect(decide(H1, start, raw1h + 1, raw1h + MIN)).toBe('scheduled_too_close');
  });

  it('สร้างกระชั้น < 24 ชม. = ข้าม 1d และ nudge แต่ยังเตือน 1 ชม.', () => {
    const at = start - 5 * HOUR;
    expect(decide(D1, start, at, at)).toBe('scheduled_too_close');
    expect(decide(NUDGE, start, at, at)).toBe('scheduled_too_close');
    expect(decide(H1, start, at, raw1h)).toBe('send');
  });

  it('สร้างกระชั้น < 1 ชม. = ไม่มีเตือน', () => {
    const at = start - 30 * MIN;
    for (const k of [D1, H1, NUDGE]) expect(decide(k, start, at, at + MIN)).toBe('scheduled_too_close');
  });

  it('main ข้อ 1 (ADR 0011 §9): นัดพุธ 23:00 สร้างอังคาร 23:30 = ข้าม 1d และ nudge แม้ due หลังเลื่อนคือพุธ 08:00', () => {
    const wed23 = bkk(2026, 11, 11, 23); // 11 พ.ย. 2026 = วันพุธ
    const tue2330 = bkk(2026, 11, 10, 23, 30);
    const wed08 = bkk(2026, 11, 11, 8);
    expect(reminderDueAt(D1, wed23, BKK)).toBe(wed08);
    expect(tue2330).toBeLessThan(wed08);
    expect(decide(D1, wed23, tue2330, wed08)).toBe('scheduled_too_close');
    expect(decide(NUDGE, wed23, tue2330, wed08)).toBe('scheduled_too_close');
  });

  it('สร้างก่อน rawDue แต่ due ถูกเลื่อน: รอถึง 08:00 แล้วส่ง', () => {
    const wed23 = bkk(2026, 11, 11, 23);
    const earlier = bkk(2026, 11, 10, 22, 59);
    expect(decide(D1, wed23, earlier, bkk(2026, 11, 11, 7, 59))).toBe('not_due');
    expect(decide(D1, wed23, earlier, bkk(2026, 11, 11, 8))).toBe('send');
  });

  it('scheduledAt = 0 (แถวจากโค้ดรุ่นเก่า) ไม่ข้ามการเตือน', () => {
    expect(decide(D1, start, 0, raw1d)).toBe('send');
  });

  it('reminderStillSendable ตรงกับ minLead', () => {
    expect(reminderStillSendable(D1, start, start - 3 * HOUR)).toBe(true);
    expect(reminderStillSendable(D1, start, start - 3 * HOUR + 1)).toBe(false);
    expect(reminderStillSendable(H1, start, start - 15 * MIN)).toBe(true);
    expect(reminderStillSendable(H1, start, start - 15 * MIN + 1)).toBe(false);
  });
});

describe('startOfMonthAt', () => {
  it('ต้นเดือนตาม tz: 1 ธ.ค. 02:00 BKK ยังอยู่เดือนธันวาคม แม้ UTC ยังเป็นพฤศจิกายน', () => {
    expect(startOfMonthAt(bkk(2026, 12, 1, 2), BKK)).toBe(bkk(2026, 12, 1));
  });
  it('ข้ามปี + ปีอธิกสุรทิน', () => {
    expect(startOfMonthAt(bkk(2027, 1, 31, 23, 59), BKK)).toBe(bkk(2027, 1, 1));
    expect(startOfMonthAt(bkk(2028, 2, 29, 12), BKK)).toBe(bkk(2028, 2, 1));
  });
});
