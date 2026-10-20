// snapshot การแสดงผล th/en (ADR 0004 §6) — ค่าคงที่ในไฟล์ เพื่อให้เห็นความเปลี่ยนแปลงใน diff
import { describe, expect, it } from 'vitest';
import { format, weekdayLabels, type FormatStyle } from '@/lib/calendar';

const T = Date.UTC(2026, 9, 15, 3, 30); // 2026-10-15T03:30Z = 10:30 BKK
const BKK = 'Asia/Bangkok';

describe('format — epoch ms, Asia/Bangkok', () => {
  const th: Record<FormatStyle, string> = {
    'datetime-full': 'วันพฤหัสบดีที่ 15 ตุลาคม พ.ศ. 2569 เวลา 10:30',
    'date-full': 'วันพฤหัสบดีที่ 15 ตุลาคม พ.ศ. 2569',
    'date-long': '15 ตุลาคม 2569',
    'date-medium': '15 ต.ค. 2569',
    'date-short': '15/10/2569',
    'day-month': '15 ต.ค.',
    'month-year': 'ตุลาคม พ.ศ. 2569',
    'month-long': 'ตุลาคม',
    'weekday-short': 'พฤหัส',
    'weekday-long': 'วันพฤหัสบดี',
    time: '10:30',
  };
  const en: Record<FormatStyle, string> = {
    'datetime-full': 'Thursday, 15 October 2026 at 10:30',
    'date-full': 'Thursday, 15 October 2026',
    'date-long': '15 October 2026',
    'date-medium': '15 Oct 2026',
    'date-short': '15/10/2026',
    'day-month': '15 Oct',
    'month-year': 'October 2026',
    'month-long': 'October',
    'weekday-short': 'Thu',
    'weekday-long': 'Thursday',
    time: '10:30',
  };
  it.each(Object.keys(th) as FormatStyle[])('th %s', (style) => {
    expect(format(T, { locale: 'th', style, tz: BKK })).toBe(th[style]);
  });
  it.each(Object.keys(en) as FormatStyle[])('en %s', (style) => {
    expect(format(T, { locale: 'en', style, tz: BKK })).toBe(en[style]);
  });
});

describe('format — เรื่องเวลา', () => {
  it('24 ชม. ไม่มี AM/PM: 13:05 และเที่ยงคืน = 00:xx ไม่ใช่ 24:xx', () => {
    const pm = Date.UTC(2026, 9, 15, 6, 5); // 13:05 BKK
    const midnight = Date.UTC(2026, 9, 14, 17, 5); // 00:05 BKK
    for (const locale of ['th', 'en'] as const) {
      expect(format(pm, { locale, style: 'time', tz: BKK })).toBe('13:05');
      expect(format(midnight, { locale, style: 'time', tz: BKK })).toBe('00:05');
      expect(format(pm, { locale, style: 'datetime-full', tz: BKK })).not.toMatch(/AM|PM|น\.|ก่อนเที่ยง|หลังเที่ยง/i);
    }
  });

  it('ตัวเลขอารบิกเสมอ (ไม่ใช่เลขไทย)', () => {
    expect(format(T, { locale: 'th', style: 'datetime-full', tz: BKK })).not.toMatch(/[๐-๙]/);
  });

  it('ตาม tz: instant เดียวกัน Tokyo = 12:30 และเปลี่ยนวันได้', () => {
    expect(format(T, { locale: 'en', style: 'time', tz: 'Asia/Tokyo' })).toBe('12:30');
    const late = Date.UTC(2026, 9, 15, 16, 30); // 23:30 BKK, 01:30 JST วันถัดไป
    expect(format(late, { locale: 'en', style: 'date-long', tz: BKK })).toBe('15 October 2026');
    expect(format(late, { locale: 'en', style: 'date-long', tz: 'Asia/Tokyo' })).toBe('16 October 2026');
  });

  it('tz ดีฟอลต์ Asia/Bangkok', () => {
    expect(format(T, { locale: 'en', style: 'time' })).toBe('10:30');
  });

  it('พ.ศ. = ค.ศ. + 543 ข้ามปีใหม่', () => {
    const ny = Date.UTC(2026, 11, 31, 17, 0); // 2027-01-01 00:00 BKK
    expect(format(ny, { locale: 'th', style: 'date-long', tz: BKK })).toBe('1 มกราคม 2570');
    expect(format(ny, { locale: 'en', style: 'date-long', tz: BKK })).toBe('1 January 2027');
  });
});

describe('format — วันที่ลอย (YYYY-MM-DD) ไม่เลื่อนตาม tz', () => {
  it('แสดงวันเดิมเสมอ', () => {
    expect(format('2026-10-15', { locale: 'th', style: 'date-full' })).toBe('วันพฤหัสบดีที่ 15 ตุลาคม พ.ศ. 2569');
    expect(format('2026-10-15', { locale: 'en', style: 'date-full', tz: 'Pacific/Kiritimati' })).toBe('Thursday, 15 October 2026');
    expect(format('2024-02-29', { locale: 'en', style: 'day-month' })).toBe('29 Feb');
    expect(format('2026-10-01', { locale: 'th', style: 'month-year' })).toBe('ตุลาคม พ.ศ. 2569');
  });

  it('สไตล์ที่ต้องมีเวลาใช้กับวันที่ล้วนไม่ได้ · วันที่ผิด/ตัวเลขไม่จำกัด', () => {
    expect(() => format('2026-10-15', { locale: 'en', style: 'time' })).toThrowError(expect.objectContaining({ code: 'INVALID_FORMAT' }));
    expect(() => format('2026-10-15', { locale: 'en', style: 'datetime-full' })).toThrowError(expect.objectContaining({ code: 'INVALID_FORMAT' }));
    expect(() => format('2026-02-30', { locale: 'en', style: 'date-long' })).toThrowError(expect.objectContaining({ code: 'INVALID_DATE' }));
    expect(() => format(Number.NaN, { locale: 'en', style: 'time' })).toThrowError(expect.objectContaining({ code: 'INVALID_RANGE' }));
    expect(() => format(T, { locale: 'en', style: 'time', tz: 'Nope/Zone' })).toThrowError(expect.objectContaining({ code: 'INVALID_TZ' }));
  });
});

describe('weekdayLabels — เริ่มจันทร์ทั้งสองภาษา (ไม่อ่านจาก locale)', () => {
  it('th narrow = จ อ พ พฤ ศ ส อา', () => {
    expect(weekdayLabels('th', 'narrow')).toEqual(['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']);
  });
  it('en short = Mon … Sun', () => {
    expect(weekdayLabels('en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
  it('th long / en long ขึ้นต้นด้วยจันทร์/Monday', () => {
    expect(weekdayLabels('th', 'long')[0]).toBe('วันจันทร์');
    expect(weekdayLabels('en', 'long')[6]).toBe('Sunday');
  });
});
