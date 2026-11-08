// addDaysAt (R8 F1 §2.2): instant + n วันปฏิทินใน tz — คงเวลาผนัง · ขอบ: ข้ามเดือน/ปี, ปีอธิกสุรทิน, ข้ามเที่ยงคืน, DST, n = 0, ค่าผิด
import { describe, expect, it } from 'vitest';
import { addDaysAt, isCalendarError, toLocal } from '@/lib/calendar';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const BKK = 'Asia/Bangkok';
const bkk = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 7, mi);

describe('addDaysAt', () => {
  it('Asia/Bangkok (ไม่มี DST): +30 วัน = 30 × 24 ชม. และเวลาผนังเท่าเดิม', () => {
    const t = bkk(2026, 10, 18, 10);
    expect(addDaysAt(t, 30, BKK) - t).toBe(30 * DAY);
    expect(toLocal(addDaysAt(t, 30, BKK), BKK)).toEqual({ date: '2026-11-17', minute: 600 });
  });

  it('ข้ามเดือน/ปี: 20 ธ.ค. 2026 23:30 + 30 วัน → 19 ม.ค. 2027 23:30', () => {
    expect(toLocal(addDaysAt(bkk(2026, 12, 20, 23, 30), 30, BKK), BKK)).toEqual({ date: '2027-01-19', minute: 1410 });
  });

  it('ปีอธิกสุรทิน: 15 ก.พ. 2028 + 30 วัน → 16 มี.ค. (ก.พ. มี 29 วัน) · ปีปกติ 2027 → 17 มี.ค.', () => {
    expect(toLocal(addDaysAt(bkk(2028, 2, 15, 9), 30, BKK), BKK).date).toBe('2028-03-16');
    expect(toLocal(addDaysAt(bkk(2027, 2, 15, 9), 30, BKK), BKK).date).toBe('2027-03-17');
  });

  it('ข้ามเที่ยงคืน UTC แต่ไม่ข้ามวันท้องถิ่น: 06:59 BKK (= 23:59 UTC วันก่อน) + 1 วัน → วันถัดไป 06:59 BKK', () => {
    expect(toLocal(addDaysAt(bkk(2026, 10, 31, 6, 59), 1, BKK), BKK)).toEqual({ date: '2026-11-01', minute: 419 });
  });

  it('DST (America/New_York): ข้ามวันเปลี่ยนเวลา = คงเวลาผนัง (23 ชม. / 25 ชม.)', () => {
    const ny = 'America/New_York';
    const beforeSpring = Date.UTC(2026, 2, 7, 17); // 2026-03-07 12:00 EST
    expect(addDaysAt(beforeSpring, 1, ny) - beforeSpring).toBe(23 * HOUR);
    expect(toLocal(addDaysAt(beforeSpring, 1, ny), ny)).toEqual({ date: '2026-03-08', minute: 720 });
    const beforeFall = Date.UTC(2026, 9, 31, 16); // 2026-10-31 12:00 EDT
    expect(addDaysAt(beforeFall, 1, ny) - beforeFall).toBe(25 * HOUR);
  });

  it('n = 0 คืนค่าเดิม · n ติดลบย้อนได้', () => {
    const t = bkk(2026, 3, 1, 8);
    expect(addDaysAt(t, 0, BKK)).toBe(t);
    expect(toLocal(addDaysAt(t, -1, BKK), BKK).date).toBe('2026-02-28');
  });

  it('ค่าผิด → CalendarError (n ไม่ใช่จำนวนเต็ม, epoch ไม่ finite, tz ไม่รู้จัก)', () => {
    for (const run of [() => addDaysAt(0, 1.5, BKK), () => addDaysAt(Number.NaN, 1, BKK), () => addDaysAt(0, 1, 'Mars/Base')]) {
      let err: unknown;
      try {
        run();
      } catch (e) {
        err = e;
      }
      expect(isCalendarError(err)).toBe(true);
    }
  });
});
