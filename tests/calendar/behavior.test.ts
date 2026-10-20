// พฤติกรรมเสริมของ lib เวลา: ค่าเริ่มต้น, DST fold, tz ต่างๆ, now ที่ inject, เพดาน (366 วัน / ย้อนหลัง 7 วัน)
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  compareDates,
  dayOfWeek,
  dayWindow,
  daysBetween,
  daysInMonth,
  daysUntil,
  earliestAllowedDate,
  eachDate,
  exceedsMaxSpan,
  isTooFarBack,
  isValidDate,
  isValidTimeZone,
  monthGrid,
  normalizeBusyInput,
  parseLocalDateTime,
  spanDays,
  startOfDay,
  toLocal,
  todayIn,
} from '@/lib/calendar';

const BKK = 'Asia/Bangkok';
const iso = (ms: number) => new Date(ms).toISOString();

describe('parseLocalDateTime / toLocal', () => {
  it('DST fold (Europe/London 2026-10-25 01:30 เกิดสองครั้ง) → ครั้งแรก ไม่ปฏิเสธ', () => {
    const ms = parseLocalDateTime('2026-10-25', '01:30', 'Europe/London');
    expect(iso(ms)).toBe('2026-10-25T00:30:00.000Z'); // BST ครั้งแรก
    expect(toLocal(ms, 'Europe/London')).toEqual({ date: '2026-10-25', minute: 90 });
  });

  it('New York gap 2026-03-08 02:30 → INVALID_LOCAL_TIME; 03:00 ผ่าน', () => {
    expect(() => parseLocalDateTime('2026-03-08', '02:30', 'America/New_York')).toThrowError(
      expect.objectContaining({ code: 'INVALID_LOCAL_TIME' }),
    );
    expect(iso(parseLocalDateTime('2026-03-08', '03:00', 'America/New_York'))).toBe('2026-03-08T07:00:00.000Z');
  });

  it('รูปแบบเวลา/วันที่/tz ผิดได้รหัสตรงตัว', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as { code?: string }).code;
      }
      return undefined;
    };
    expect(code(() => parseLocalDateTime('2026-10-15', '24:00', BKK))).toBe('INVALID_TIME');
    expect(code(() => parseLocalDateTime('2026-10-15', '9:00', BKK))).toBe('INVALID_TIME');
    expect(code(() => parseLocalDateTime('2026-10-15 ', '09:00', BKK))).toBe('INVALID_DATE');
    expect(code(() => parseLocalDateTime('15/10/2026', '09:00', BKK))).toBe('INVALID_DATE');
    expect(code(() => parseLocalDateTime('2026-10-15', '09:00', 'Mars/Olympus'))).toBe('INVALID_TZ');
    expect(code(() => parseLocalDateTime('2026-10-15', '09:00', '+07:00'))).toBe('INVALID_TZ');
    expect(code(() => parseLocalDateTime('2026-10-15', '09:00', 'asia/bangkok'))).toBe('INVALID_TZ');
    expect(code(() => parseLocalDateTime('1999-12-31', '09:00', BKK))).toBe('DATE_OUT_OF_RANGE');
    expect(code(() => parseLocalDateTime('2101-01-01', '09:00', BKK))).toBe('DATE_OUT_OF_RANGE');
    expect(parseLocalDateTime('2000-01-01', '00:00', BKK)).toBe(Date.UTC(1999, 11, 31, 17));
  });

  it('isValidTimeZone / isValidDate', () => {
    expect(isValidTimeZone('Asia/Bangkok')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(7)).toBe(false);
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2025-02-29')).toBe(false);
    expect(isValidDate('2569-01-01')).toBe(false);
  });
});

describe('dayWindow / startOfDay', () => {
  it('ปกติ Bangkok 08:00–22:00', () => {
    const [s, e] = dayWindow('2026-10-15', 480, 1320, BKK);
    expect(iso(s)).toBe('2026-10-15T01:00:00.000Z');
    expect(iso(e)).toBe('2026-10-15T15:00:00.000Z');
  });

  it('วัน DST ยาว 25 ชม. (London 2026-10-25) และ NY 23 ชม.', () => {
    const [s, e] = dayWindow('2026-10-25', 0, 1440, 'Europe/London');
    expect(e - s).toBe(25 * 3_600_000);
    const [s2, e2] = dayWindow('2026-03-08', 0, 1440, 'America/New_York');
    expect(e2 - s2).toBe(23 * 3_600_000);
  });

  it('นาทีอยู่ใน DST gap เลื่อนไปข้างหน้า ไม่ปฏิเสธและไม่ว่างเปล่า', () => {
    const [s, e] = dayWindow('2026-03-29', 75, 105, 'Europe/London'); // 01:15–01:45 ไม่มีจริง
    expect(e).toBeGreaterThan(s);
  });

  it('ช่วงนาทีผิด → INVALID_RANGE', () => {
    for (const [a, b] of [
      [100, 100],
      [200, 100],
      [-1, 100],
      [0, 1441],
      [0.5, 10],
    ] as const) {
      expect(() => dayWindow('2026-10-15', a, b, BKK)).toThrowError(expect.objectContaining({ code: 'INVALID_RANGE' }));
    }
  });

  it('startOfDay', () => {
    expect(iso(startOfDay('2026-10-15', BKK))).toBe('2026-10-14T17:00:00.000Z');
  });
});

describe('now ที่ inject: todayIn / daysUntil', () => {
  const now = Date.parse('2026-10-15T16:59:00Z');
  it('todayIn ขึ้นกับ tz', () => {
    expect(todayIn(BKK, now)).toBe('2026-10-15');
    expect(todayIn(BKK, now + 60_000)).toBe('2026-10-16'); // 00:00 BKK พอดี
    expect(todayIn('America/New_York', now)).toBe('2026-10-15');
    expect(todayIn('Asia/Tokyo', now)).toBe('2026-10-16');
  });
  it('daysUntil: วันนี้ 0 · ผ่านแล้วเป็นลบ · ข้ามปี', () => {
    expect(daysUntil(now, Date.parse('2026-10-15T17:00:00Z'), BKK)).toBe(1);
    expect(daysUntil(now, Date.parse('2026-10-15T16:00:00Z'), BKK)).toBe(0);
    expect(daysUntil(now, Date.parse('2026-10-14T03:00:00Z'), BKK)).toBe(-1);
    expect(daysUntil(Date.parse('2026-12-31T10:00:00Z'), Date.parse('2027-01-01T10:00:00Z'), BKK)).toBe(1);
  });
});

describe('normalizeBusyInput', () => {
  it('tz ดีฟอลต์ Asia/Bangkok', () => {
    const r = normalizeBusyInput({ kind: 'all_day', startDate: '2026-10-15', endDate: '2026-10-15' });
    expect(r.ok && r.value.tz).toBe(BKK);
  });

  it('all-day เป็นวันที่ลอย: Tokyo 2026-11-11 → local date ไม่เลื่อน, startAt = เที่ยงคืน JST', () => {
    const r = normalizeBusyInput({ kind: 'all_day', startDate: '2026-11-11', endDate: '2026-11-11', tz: 'Asia/Tokyo' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.localStartDate).toBe('2026-11-11');
      expect(iso(r.value.startAt)).toBe('2026-11-10T15:00:00.000Z');
      expect(iso(r.value.endAt)).toBe('2026-11-11T15:00:00.000Z');
    }
  });

  it('timed หลายวัน = ช่วงต่อเนื่องเดียว (ข้ามเดือน)', () => {
    const r = normalizeBusyInput({ kind: 'timed', startDate: '2026-01-30', startTime: '18:00', endDate: '2026-02-02', endTime: '09:30' });
    expect(r.ok && [r.value.localStartDate, r.value.localEndDate, r.value.endAt - r.value.startAt]).toEqual([
      '2026-01-30',
      '2026-02-02',
      (3 * 24 - 8.5) * 3_600_000,
    ]);
  });

  it('timed ข้ามช่วง DST: ความยาวจริงตาม instant', () => {
    const r = normalizeBusyInput({
      kind: 'timed', startDate: '2026-03-28', startTime: '12:00', endDate: '2026-03-29', endTime: '12:00', tz: 'Europe/London',
    });
    expect(r.ok && r.value.endAt - r.value.startAt).toBe(23 * 3_600_000);
  });

  it('timed ปลายเป็น 00:30 ของวันถัดไป → local_end_date เป็นวันถัดไป', () => {
    const r = normalizeBusyInput({ kind: 'timed', startDate: '2026-03-05', startTime: '23:00', endDate: '2026-03-06', endTime: '00:30' });
    expect(r.ok && r.value.localEndDate).toBe('2026-03-06');
  });

  it('ไม่ throw: ชนิดผิด/ฟิลด์ขาดคืน error code ที่ใช้ได้', () => {
    // @ts-expect-error runtime guard: ข้อมูลจาก HTTP อาจไม่ตรงชนิด
    const r = normalizeBusyInput({ kind: 'all_day', startDate: undefined, endDate: '2026-10-15' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_DATE');
  });

  it('tz ผิด → INVALID_TZ', () => {
    const r = normalizeBusyInput({ kind: 'all_day', startDate: '2026-10-15', endDate: '2026-10-15', tz: 'Nowhere/City' });
    expect(!r.ok && r.error.code).toBe('INVALID_TZ');
  });

  it('timed ยาวเกิน 62 วัน (ADR 0004 §2) → SPAN_TOO_LONG · ปิดด้วย maxTimedDays: null', () => {
    const input = { kind: 'timed', startDate: '2026-01-01', startTime: '00:00', endDate: '2026-03-04', endTime: '00:30' } as const;
    const r = normalizeBusyInput(input);
    expect(!r.ok && r.error.code).toBe('SPAN_TOO_LONG');
    expect(normalizeBusyInput(input, { maxTimedDays: null }).ok).toBe(true);
    // พอดี 62 วัน ผ่าน
    expect(
      normalizeBusyInput({ kind: 'timed', startDate: '2026-01-01', startTime: '00:00', endDate: '2026-03-04', endTime: '00:00' }).ok,
    ).toBe(true);
  });
});

describe('เพดาน (ส่งเป็นพารามิเตอร์) — 366 วัน / ย้อนหลัง 7 วัน', () => {
  const now = Date.parse('2026-10-15T05:00:00Z'); // 12:00 BKK
  const limits = { now, maxSpanDays: 366, maxBackdateDays: 7 };

  it('spanDays / exceedsMaxSpan', () => {
    expect(spanDays('2026-05-01', '2026-05-01')).toBe(1);
    expect(spanDays('2026-01-01', '2026-12-31')).toBe(365);
    expect(spanDays('2024-01-01', '2024-12-31')).toBe(366);
    expect(exceedsMaxSpan('2024-01-01', '2024-12-31', 366)).toBe(false);
    expect(exceedsMaxSpan('2024-01-01', '2025-01-01', 366)).toBe(true);
  });

  it('all-day 366 วันผ่าน, 367 วัน → SPAN_TOO_LONG', () => {
    expect(normalizeBusyInput({ kind: 'all_day', startDate: '2026-11-01', endDate: '2027-10-31' }, limits).ok).toBe(true); // 365
    expect(normalizeBusyInput({ kind: 'all_day', startDate: '2027-01-01', endDate: '2028-01-01' }, limits).ok).toBe(true); // 366 (ข้าม 2027 ไม่อธิกฯ → 365+1)
    const r = normalizeBusyInput({ kind: 'all_day', startDate: '2027-01-01', endDate: '2028-01-02' }, limits);
    expect(!r.ok && r.error.code).toBe('SPAN_TOO_LONG');
  });

  it('ย้อนหลัง: ขอบเขต = วันนี้ − 7 (ใน tz ที่ส่งมา)', () => {
    expect(earliestAllowedDate(now, BKK, 7)).toBe('2026-10-08');
    expect(isTooFarBack('2026-10-08', now, BKK, 7)).toBe(false);
    expect(isTooFarBack('2026-10-07', now, BKK, 7)).toBe(true);
    const ok = normalizeBusyInput({ kind: 'all_day', startDate: '2026-10-08', endDate: '2026-10-08' }, limits);
    expect(ok.ok).toBe(true);
    const bad = normalizeBusyInput({ kind: 'all_day', startDate: '2026-10-07', endDate: '2026-10-07' }, limits);
    expect(!bad.ok && bad.error.code).toBe('TOO_FAR_BACK');
  });

  it('ย้อนหลังผูกกับ tz: 22:00Z ของวันที่ 14 = 15 Oct ใน BKK แต่ยังเป็น 14 Oct ใน New York', () => {
    const t = Date.parse('2026-10-14T22:00:00Z');
    expect(earliestAllowedDate(t, BKK, 7)).toBe('2026-10-08');
    expect(earliestAllowedDate(t, 'America/New_York', 7)).toBe('2026-10-07');
  });

  it('รายการที่เริ่มนานแล้วแต่ยังไม่จบ ไม่ถูกปฏิเสธเรื่องย้อนหลัง', () => {
    const r = normalizeBusyInput({ kind: 'all_day', startDate: '2026-09-01', endDate: '2026-10-20' }, limits);
    expect(r.ok).toBe(true);
  });

  it('timed ย้อนหลังใช้ local_end_date (จบตรงเที่ยงคืน = วันก่อนหน้า)', () => {
    // จบ 2026-10-08 00:00 → local_end_date = 2026-10-07 → เกิน
    const r = normalizeBusyInput(
      { kind: 'timed', startDate: '2026-10-07', startTime: '20:00', endDate: '2026-10-08', endTime: '00:00' },
      limits,
    );
    expect(!r.ok && r.error.code).toBe('TOO_FAR_BACK');
  });

  it('ส่ง maxBackdateDays โดยไม่ส่ง now → TypeError (ไม่เงียบ)', () => {
    expect(() => normalizeBusyInput({ kind: 'all_day', startDate: '2026-10-15', endDate: '2026-10-15' }, { maxBackdateDays: 7 })).toThrow(TypeError);
  });

  it('ไม่ส่งเพดาน = ไม่ตรวจ', () => {
    expect(normalizeBusyInput({ kind: 'all_day', startDate: '2001-01-01', endDate: '2050-01-01' }).ok).toBe(true);
  });
});

describe('date helpers', () => {
  it('compareDates / daysBetween / dayOfWeek', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-02')).toBe(0);
    expect(compareDates('2027-01-01', '2026-12-31')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-10-15', '2026-10-14')).toBe(-1);
    expect(dayOfWeek('2026-10-12')).toBe(1);
    expect(dayOfWeek('2026-10-18')).toBe(7);
  });

  it('eachDate: from > to → []', () => {
    expect(eachDate('2026-05-02', '2026-05-01')).toEqual([]);
  });

  it('addMonths / daysInMonth', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28); // 2100 ไม่ใช่ปีอธิกสุรทิน
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it('monthGrid: ปี/เดือนผิดรูป', () => {
    expect(() => monthGrid(2569, 10)).toThrowError(expect.objectContaining({ code: 'DATE_OUT_OF_RANGE' }));
    expect(() => monthGrid(2026, 13)).toThrowError(expect.objectContaining({ code: 'INVALID_DATE' }));
    expect(() => monthGrid(2026, 0)).toThrowError(expect.objectContaining({ code: 'INVALID_DATE' }));
  });
});
