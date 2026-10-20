// ADR 0004 — ข้อ 1–21 ทั้งหมด (ค่าคาดหวังคำนวณมือ แล้วยืนยันซ้ำด้วย temporal-polyfill ตอนเขียน lib)
import { describe, expect, it } from 'vitest';
import {
  CalendarError,
  addDays,
  dayWindow,
  daysUntil,
  eachDate,
  format,
  monthGrid,
  normalizeBusyInput,
  parseLocalDateTime,
  startOfWeek,
  WEEK_START,
  type NormalizeBusyResult,
} from '@/lib/calendar';

const BKK = 'Asia/Bangkok';

function okRow(r: NormalizeBusyResult) {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.value;
}
function errCode(r: NormalizeBusyResult) {
  if (r.ok) throw new Error('expected error');
  return r.error.code;
}
const iso = (ms: number) => new Date(ms).toISOString();

describe('ADR 0004 test requirements', () => {
  it('#1 แปลงพื้นฐาน 2026-10-15 10:30 Asia/Bangkok', () => {
    expect(parseLocalDateTime('2026-10-15', '10:30', BKK)).toBe(1792035000000);
    expect(iso(1792035000000)).toBe('2026-10-15T03:30:00.000Z');
  });

  it('#2 ข้ามเที่ยงคืน+ปี', () => {
    const row = okRow(
      normalizeBusyInput({ kind: 'timed', startDate: '2024-12-31', startTime: '22:00', endDate: '2025-01-01', endTime: '02:00', tz: BKK }),
    );
    expect(iso(row.startAt)).toBe('2024-12-31T15:00:00.000Z');
    expect(iso(row.endAt)).toBe('2024-12-31T19:00:00.000Z');
    expect(row.localStartDate).toBe('2024-12-31');
    expect(row.localEndDate).toBe('2025-01-01');
    expect(row.allDay).toBe(false);
  });

  it('#3 จบตรงเที่ยงคืน → local_end_date = วันก่อนหน้า (end − 1 ms)', () => {
    const row = okRow(
      normalizeBusyInput({ kind: 'timed', startDate: '2026-03-05', startTime: '20:00', endDate: '2026-03-06', endTime: '00:00', tz: BKK }),
    );
    expect(row.localStartDate).toBe('2026-03-05');
    expect(row.localEndDate).toBe('2026-03-05');
  });

  it('#4 ปีอธิกสุรทิน: all-day 2024-02-28..2024-03-02 ครอบ 4 วัน', () => {
    const row = okRow(normalizeBusyInput({ kind: 'all_day', startDate: '2024-02-28', endDate: '2024-03-02', tz: BKK }));
    expect(eachDate(row.localStartDate, row.localEndDate)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02']);
    expect(iso(row.endAt)).toBe('2024-03-02T17:00:00.000Z');
    expect(iso(row.startAt)).toBe('2024-02-27T17:00:00.000Z');
    expect(row.allDay).toBe(true);
  });

  it('#5 ไม่ใช่ปีอธิกสุรทิน: 3 วัน และ 2025-02-29 → INVALID_DATE', () => {
    const row = okRow(normalizeBusyInput({ kind: 'all_day', startDate: '2025-02-28', endDate: '2025-03-02', tz: BKK }));
    expect(eachDate(row.localStartDate, row.localEndDate)).toEqual(['2025-02-28', '2025-03-01', '2025-03-02']);
    expect(errCode(normalizeBusyInput({ kind: 'all_day', startDate: '2025-02-28', endDate: '2025-02-29' }))).toBe('INVALID_DATE');
    expect(errCode(normalizeBusyInput({ kind: 'all_day', startDate: '2025-02-29', endDate: '2025-03-02' }))).toBe('INVALID_DATE');
  });

  it('#6 เริ่ม=จบ (วันที่) ผ่าน ครอบ 1 วัน', () => {
    const row = okRow(normalizeBusyInput({ kind: 'all_day', startDate: '2026-05-01', endDate: '2026-05-01' }));
    expect(eachDate(row.localStartDate, row.localEndDate)).toEqual(['2026-05-01']);
    expect(row.endAt - row.startAt).toBe(86_400_000);
  });

  it('#7 เริ่ม=จบ (เวลา) → INVALID_RANGE', () => {
    expect(
      errCode(normalizeBusyInput({ kind: 'timed', startDate: '2026-05-01', startTime: '12:00', endDate: '2026-05-01', endTime: '12:00' })),
    ).toBe('INVALID_RANGE');
  });

  it('#8 จบก่อนเริ่ม (วันที่) → INVALID_RANGE', () => {
    expect(errCode(normalizeBusyInput({ kind: 'all_day', startDate: '2026-05-02', endDate: '2026-05-01' }))).toBe('INVALID_RANGE');
  });

  it('#9 ไม่ลงตัว 30 นาที → TIME_NOT_ON_STEP', () => {
    const r = normalizeBusyInput({ kind: 'timed', startDate: '2026-05-01', startTime: '10:15', endDate: '2026-05-01', endTime: '11:00' });
    expect(errCode(r)).toBe('TIME_NOT_ON_STEP');
    if (!r.ok) expect(r.error.field).toBe('startTime');
    expect(
      errCode(normalizeBusyInput({ kind: 'timed', startDate: '2026-05-01', startTime: '10:00', endDate: '2026-05-01', endTime: '11:45' })),
    ).toBe('TIME_NOT_ON_STEP');
  });

  it('#10 tz อื่น: Asia/Tokyo 10:00–12:00 → start = 01:00Z', () => {
    const row = okRow(
      normalizeBusyInput({ kind: 'timed', startDate: '2026-11-10', startTime: '10:00', endDate: '2026-11-10', endTime: '12:00', tz: 'Asia/Tokyo' }),
    );
    expect(iso(row.startAt)).toBe('2026-11-10T01:00:00.000Z');
    expect(iso(row.endAt)).toBe('2026-11-10T03:00:00.000Z');
    expect(row.tz).toBe('Asia/Tokyo');
  });

  it('#11 DST gap: 2026-03-29 01:30 Europe/London → INVALID_LOCAL_TIME', () => {
    expect(() => parseLocalDateTime('2026-03-29', '01:30', 'Europe/London')).toThrowError(
      expect.objectContaining({ name: 'CalendarError', code: 'INVALID_LOCAL_TIME' }),
    );
    const r = normalizeBusyInput({ kind: 'timed', startDate: '2026-03-29', startTime: '01:30', endDate: '2026-03-29', endTime: '03:00', tz: 'Europe/London' });
    expect(errCode(r)).toBe('INVALID_LOCAL_TIME');
    if (!r.ok) expect(r.error.field).toBe('startTime');
  });

  it('#12 dayWindow DST: 2026-03-29 0–1440 Europe/London = 23 ชม.', () => {
    const [s, e] = dayWindow('2026-03-29', 0, 1440, 'Europe/London');
    expect(e - s).toBe(82_800_000);
  });

  it('#13 แสดงผลไทย: พ.ศ. 2569, ตุลาคม, 10:30', () => {
    const out = format(Date.UTC(2026, 9, 15, 3, 30), { locale: 'th', style: 'datetime-full', tz: BKK });
    expect(out).toContain('พ.ศ. 2569');
    expect(out).toContain('ตุลาคม');
    expect(out).toContain('10:30');
  });

  it('#14 แสดงผลอังกฤษ: 2026, October, 10:30, ไม่มี AM/PM', () => {
    const out = format(Date.UTC(2026, 9, 15, 3, 30), { locale: 'en', style: 'datetime-full', tz: BKK });
    expect(out).toContain('2026');
    expect(out).toContain('October');
    expect(out).toContain('10:30');
    expect(out).not.toMatch(/AM|PM/i);
  });

  it('#15 daysUntil เป็นวันปฏิทิน ไม่ใช่ 24 ชม.', () => {
    const now = Date.parse('2026-10-15T16:59:00Z'); // 23:59 BKK
    expect(daysUntil(now, Date.parse('2026-10-16T01:00:00Z'), BKK)).toBe(1);
  });

  it('#16 ปี พ.ศ. ผิดรูป 2569-10-15 → DATE_OUT_OF_RANGE', () => {
    expect(errCode(normalizeBusyInput({ kind: 'all_day', startDate: '2569-10-15', endDate: '2569-10-15' }))).toBe('DATE_OUT_OF_RANGE');
    expect(
      errCode(normalizeBusyInput({ kind: 'timed', startDate: '2569-10-15', startTime: '10:00', endDate: '2026-10-15', endTime: '11:00' })),
    ).toBe('DATE_OUT_OF_RANGE');
    expect(() => parseLocalDateTime('2569-10-15', '10:00', BKK)).toThrowError(expect.objectContaining({ code: 'DATE_OUT_OF_RANGE' }));
  });

  it('#17 monthGrid ต.ค. 2026 (1 = พฤหัส)', () => {
    expect(monthGrid(2026, 10)).toEqual({ from: '2026-09-28', to: '2026-11-01', weeks: 5 });
  });

  it('#18 monthGrid ก.พ. 2027 (1 = จันทร์, 28 วัน) = 4 สัปดาห์', () => {
    expect(monthGrid(2027, 2)).toEqual({ from: '2027-02-01', to: '2027-02-28', weeks: 4 });
  });

  it('#19 monthGrid มี.ค. 2026 (1 = อาทิตย์) = 6 สัปดาห์', () => {
    const g = monthGrid(2026, 3);
    expect(g).toEqual({ from: '2026-02-23', to: '2026-04-05', weeks: 6 });
    expect(eachDate(g.from, g.to)).toHaveLength(42);
  });

  it('#20 monthGrid ม.ค. 2027 ข้ามปี', () => {
    expect(monthGrid(2027, 1)).toEqual({ from: '2026-12-28', to: '2027-01-31', weeks: 5 });
  });

  it('#21 monthGrid ก.พ. 2024 (อธิกสุรทิน) และ startOfWeek(อาทิตย์ 2026-10-18)', () => {
    expect(monthGrid(2024, 2)).toEqual({ from: '2024-01-29', to: '2024-03-03', weeks: 5 });
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
    expect(WEEK_START).toBe(1);
  });
});

describe('ส่วนเสริม', () => {
  it('addDays ข้ามเดือน/ปี/อธิกสุรทิน', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('CalendarError เป็น Error ที่มี code', () => {
    try {
      parseLocalDateTime('2026-13-01', '10:00', BKK);
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CalendarError);
      expect((e as CalendarError).code).toBe('INVALID_DATE');
    }
  });
});
