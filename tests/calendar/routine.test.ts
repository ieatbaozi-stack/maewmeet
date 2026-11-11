// R14 (ADR 0012 §4–§6, §8 · R14_CONTRACT R14-2): routineRange / expandRoutine / planRoutine — ขอบเขตทุกกรณี
// ค่าที่คาดหวังคำนวณมือ (Bangkok = UTC+7 ไม่มี DST · New York EST −5 / EDT −4 · Lord Howe +10:30 / +11:00)
import { describe, expect, it } from 'vitest';
import {
  expandRoutine,
  formatRoutineTime,
  maskToWeekdays,
  parseRoutineTimes,
  planRoutine,
  routinePeriods,
  routinePeriodStart,
  routineRange,
  weekdaysToMask,
  type RoutinePlanOptions,
  type RoutineRule,
  type RoutineSpec,
} from '@/lib/calendar';

const H = 3_600_000;
const BKK = 'Asia/Bangkok';
const NY = 'America/New_York';
const LH = 'Australia/Lord_Howe';
/** 2026-11-11 (พุธ) 10:00 เวลาไทย */
const NOW = Date.UTC(2026, 10, 11, 3);
const LIMITS = { maxWeeks: 26, maxMonths: 6, maxAheadMonths: 12 } as const;
const MON_FRI = [1, 2, 3, 4, 5];
const EVERY = [1, 2, 3, 4, 5, 6, 7];

const opts = (over: Partial<RoutinePlanOptions> = {}): RoutinePlanOptions => ({ now: NOW, ...LIMITS, ...over });
const weeks = (fromWeek: string, toWeek: string) => ({ rangeKind: 'weeks' as const, fromWeek, toWeek });
const months = (fromMonth: string, toMonth: string) => ({ rangeKind: 'months' as const, fromMonth, toMonth });
const timed = (range: RoutineSpec['range'], weekdays: number[], startTime: string, endTime: string, tz = BKK): RoutineSpec => ({
  range,
  weekdays,
  allDay: false,
  startTime,
  endTime,
  tz,
});

function ok<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}
function err(r: { ok: boolean; error?: { code: string; field?: string } }): { code: string; field?: string } {
  expect(r.ok).toBe(false);
  const e = r.error!;
  return e.field === undefined ? { code: e.code } : { code: e.code, field: e.field };
}
const rule = (over: Partial<RoutineRule>): RoutineRule => ({
  weekdays: 127,
  allDay: false,
  startMin: 9 * 60,
  endMin: 10 * 60,
  startDate: '2026-11-16',
  endDate: '2026-11-22',
  tz: BKK,
  ...over,
});

describe('routineRange — สัปดาห์ถึงสัปดาห์ (จันทร์–อาทิตย์)', () => {
  it('วันใดก็ได้ในสัปดาห์ → จันทร์ของสัปดาห์ต้น ถึง อาทิตย์ของสัปดาห์ปลาย', () => {
    expect(ok(routineRange(weeks('2026-11-18', '2026-11-26')))).toEqual({ rangeKind: 'weeks', startDate: '2026-11-16', endDate: '2026-11-29', periods: 2 });
    expect(ok(routineRange(weeks('2026-11-16', '2026-11-16')))).toEqual({ rangeKind: 'weeks', startDate: '2026-11-16', endDate: '2026-11-22', periods: 1 });
    // อาทิตย์เป็นวันสุดท้ายของสัปดาห์ (WEEK_START = 1)
    expect(ok(routineRange(weeks('2026-11-22', '2026-11-22'))).startDate).toBe('2026-11-16');
  });

  it('ข้ามปี: สัปดาห์ 28 ธ.ค. 2026 – 3 ม.ค. 2027', () => {
    expect(ok(routineRange(weeks('2027-01-01', '2027-01-03')))).toEqual({ rangeKind: 'weeks', startDate: '2026-12-28', endDate: '2027-01-03', periods: 1 });
    expect(ok(routineRange(weeks('2026-12-21', '2027-01-04')))).toEqual({ rangeKind: 'weeks', startDate: '2026-12-21', endDate: '2027-01-10', periods: 3 });
  });

  it('ปีอธิกสุรทิน: สัปดาห์ที่มี 29 ก.พ. 2028', () => {
    expect(ok(routineRange(weeks('2028-02-29', '2028-02-29')))).toEqual({ rangeKind: 'weeks', startDate: '2028-02-28', endDate: '2028-03-05', periods: 1 });
  });

  it('26 สัปดาห์พอดีผ่าน · 27 สัปดาห์ = SPAN_TOO_LONG ที่ toWeek', () => {
    const r26 = ok(routineRange(weeks('2026-11-16', '2027-05-10'), { maxWeeks: 26 }));
    expect(r26).toEqual({ rangeKind: 'weeks', startDate: '2026-11-16', endDate: '2027-05-16', periods: 26 });
    expect(err(routineRange(weeks('2026-11-16', '2027-05-17'), { maxWeeks: 26 }))).toEqual({ code: 'SPAN_TOO_LONG', field: 'toWeek' });
  });

  it('ปลายก่อนต้น = INVALID_RANGE (สัปดาห์เดียวกันได้) · รูปแบบ/วันไม่มีจริง/ปีนอกช่วง', () => {
    expect(err(routineRange(weeks('2026-11-23', '2026-11-22')))).toEqual({ code: 'INVALID_RANGE', field: 'toWeek' });
    expect(err(routineRange(weeks('2026-11-31', '2026-12-01')))).toEqual({ code: 'INVALID_DATE', field: 'fromWeek' });
    expect(err(routineRange(weeks('2027-02-29', '2027-03-01')))).toEqual({ code: 'INVALID_DATE', field: 'fromWeek' });
    expect(err(routineRange(weeks('2026-11-16', '2569-11-22')))).toEqual({ code: 'DATE_OUT_OF_RANGE', field: 'toWeek' });
    expect(err(routineRange(weeks('16/11/2026', '2026-11-22')))).toEqual({ code: 'INVALID_DATE', field: 'fromWeek' });
  });
});

describe('routineRange — เดือนถึงเดือน', () => {
  it('วันที่ 1 ของเดือนต้น ถึงวันสุดท้ายของเดือนปลาย · เดือนยาวไม่เท่ากัน', () => {
    expect(ok(routineRange(months('2026-11', '2026-11')))).toEqual({ rangeKind: 'months', startDate: '2026-11-01', endDate: '2026-11-30', periods: 1 });
    expect(ok(routineRange(months('2027-04', '2027-04'))).endDate).toBe('2027-04-30');
    expect(ok(routineRange(months('2026-12', '2027-01')))).toEqual({ rangeKind: 'months', startDate: '2026-12-01', endDate: '2027-01-31', periods: 2 });
  });

  it('ก.พ. 2027 = 28 วัน · ก.พ. 2028 = 29 วัน · ม.ค.–ก.พ. 2028', () => {
    expect(ok(routineRange(months('2027-02', '2027-02'))).endDate).toBe('2027-02-28');
    expect(ok(routineRange(months('2028-02', '2028-02'))).endDate).toBe('2028-02-29');
    expect(ok(routineRange(months('2028-01', '2028-02')))).toEqual({ rangeKind: 'months', startDate: '2028-01-01', endDate: '2028-02-29', periods: 2 });
  });

  it('6 เดือนผ่าน (ก.ค.–ธ.ค. = 184 วัน) · 7 เดือน = SPAN_TOO_LONG ที่ toMonth', () => {
    expect(ok(routineRange(months('2027-07', '2027-12'), { maxMonths: 6 }))).toEqual({ rangeKind: 'months', startDate: '2027-07-01', endDate: '2027-12-31', periods: 6 });
    expect(err(routineRange(months('2027-07', '2028-01'), { maxMonths: 6 }))).toEqual({ code: 'SPAN_TOO_LONG', field: 'toMonth' });
  });

  it('รูปแบบผิด / เดือน 13 / ปีนอกช่วง / ปลายก่อนต้น', () => {
    expect(err(routineRange(months('2026-1', '2026-02')))).toEqual({ code: 'INVALID_DATE', field: 'fromMonth' });
    expect(err(routineRange(months('2026-11', '2026-13')))).toEqual({ code: 'INVALID_DATE', field: 'toMonth' });
    expect(err(routineRange(months('1999-12', '2000-01')))).toEqual({ code: 'DATE_OUT_OF_RANGE', field: 'fromMonth' });
    expect(err(routineRange(months('2026-12', '2026-11')))).toEqual({ code: 'INVALID_RANGE', field: 'toMonth' });
  });

  it('routinePeriodStart / routinePeriods', () => {
    expect(routinePeriodStart('2026-11-19', 'weeks')).toBe('2026-11-16');
    expect(routinePeriodStart('2026-11-19', 'months')).toBe('2026-11-01');
    expect(routinePeriodStart('2028-02-29', 'months')).toBe('2028-02-01');
    expect(routinePeriods('weeks', '2026-11-18', '2026-12-01')).toBe(3);
    expect(routinePeriods('months', '2026-11-30', '2027-04-01')).toBe(6);
  });
});

describe('weekdays / เวลา', () => {
  it('weekdaysToMask ↔ maskToWeekdays (ISO 1 = จันทร์ … 7 = อาทิตย์)', () => {
    expect(weekdaysToMask(MON_FRI)).toBe(31);
    expect(weekdaysToMask([6, 7])).toBe(96);
    expect(weekdaysToMask([7, 1])).toBe(65);
    expect(weekdaysToMask(EVERY)).toBe(127);
    expect(maskToWeekdays(65)).toEqual([1, 7]);
    expect(maskToWeekdays(127)).toEqual(EVERY);
  });

  it('ว่าง = WEEKDAYS_REQUIRED · นอก 1–7 / ซ้ำ / ไม่ใช่จำนวนเต็ม = INVALID_WEEKDAYS', () => {
    const code = (d: number[]) => {
      try {
        weekdaysToMask(d);
        return 'ok';
      } catch (e) {
        return (e as { code: string }).code;
      }
    };
    expect(code([])).toBe('WEEKDAYS_REQUIRED');
    for (const bad of [[0], [8], [1, 1], [1.5], [-1]]) expect(code(bad)).toBe('INVALID_WEEKDAYS');
  });

  it('parseRoutineTimes: "24:00" และ "00:00" ตอนจบ = 1440 · ข้ามคืน · เริ่ม = จบ ห้าม · ลงตัว 30', () => {
    expect(parseRoutineTimes('09:00', '18:00')).toEqual({ startMin: 540, endMin: 1080 });
    expect(parseRoutineTimes('18:00', '24:00')).toEqual({ startMin: 1080, endMin: 1440 });
    expect(parseRoutineTimes('18:00', '00:00')).toEqual({ startMin: 1080, endMin: 1440 });
    expect(parseRoutineTimes('22:00', '06:00')).toEqual({ startMin: 1320, endMin: 360 });
    expect(parseRoutineTimes('00:00', '24:00')).toEqual({ startMin: 0, endMin: 1440 });
    const code = (s: string, e: string) => {
      try {
        parseRoutineTimes(s, e);
        return 'ok';
      } catch (x) {
        return `${(x as { code: string }).code}:${(x as { field: string }).field}`;
      }
    };
    expect(code('09:00', '09:00')).toBe('INVALID_RANGE:endTime');
    expect(code('00:00', '00:00')).toBe('ok'); // 00:00 → 24:00 = ทั้งวันแบบมีเวลา
    expect(code('09:15', '10:00')).toBe('TIME_NOT_ON_STEP:startTime');
    expect(code('09:00', '10:45')).toBe('TIME_NOT_ON_STEP:endTime');
    expect(code('24:00', '10:00')).toBe('INVALID_TIME:startTime');
    expect(code('9:00', '10:00')).toBe('INVALID_TIME:startTime');
    expect(code('09:00', '24:30')).toBe('INVALID_TIME:endTime');
    expect(formatRoutineTime(1440)).toBe('24:00');
    expect(formatRoutineTime(0)).toBe('00:00');
    expect(formatRoutineTime(570)).toBe('09:30');
  });
});

describe('planRoutine — Bangkok (กรณีหลัก)', () => {
  it('จ.–ศ. 09:00–18:00 สัปดาห์ 16–22 พ.ย. → 5 วัน (16–20) เวลาผนังตรง · วันท้องถิ่นแยก', () => {
    const p = ok(planRoutine(timed(weeks('2026-11-16', '2026-11-16'), MON_FRI, '09:00', '18:00'), opts()));
    expect(p.today).toBe('2026-11-11');
    expect(p.rule).toEqual({ weekdays: 31, allDay: false, startMin: 540, endMin: 1080, startDate: '2026-11-16', endDate: '2026-11-22', tz: BKK });
    expect(p.rows).toHaveLength(5);
    p.rows.forEach((r, i) => {
      const d = `2026-11-${16 + i}`;
      expect(r).toEqual({ allDay: false, startAt: Date.UTC(2026, 10, 16 + i, 2), endAt: Date.UTC(2026, 10, 16 + i, 11), localStartDate: d, localEndDate: d, tz: BKK });
    });
  });

  it('"ทั้งเดือนนี้" กลางเดือน: start_date = 1 พ.ย. แต่สร้างตั้งแต่วันนี้ (11) → 14 วันทำงาน', () => {
    const p = ok(planRoutine(timed(months('2026-11', '2026-11'), MON_FRI, '09:00', '18:00'), opts()));
    expect([p.rule.startDate, p.rule.endDate]).toEqual(['2026-11-01', '2026-11-30']);
    expect(p.rows.map((r) => r.localStartDate)).toEqual([
      '2026-11-11', '2026-11-12', '2026-11-13',
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
      '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
      '2026-11-30',
    ]);
    // วันนี้รวมอยู่แม้ช่วงของวันนี้เริ่มไปแล้ว (09:00 < 10:00) — เหมือน "ตั้งแต่วันนี้" ของ ADR 0012 §4
    expect(p.rows[0]!.startAt).toBe(Date.UTC(2026, 10, 11, 2));
  });

  it('ข้ามเที่ยงคืน 22:00–06:00 เลือก "จันทร์" = จันทร์ 22:00 → อังคาร 06:00 · local_end_date = วันถัดไป', () => {
    const p = ok(planRoutine(timed(weeks('2026-11-16', '2026-11-16'), [1], '22:00', '06:00'), opts()));
    expect(p.rule).toMatchObject({ startMin: 1320, endMin: 360 });
    expect(p.rows).toEqual([{ allDay: false, startAt: Date.UTC(2026, 10, 16, 15), endAt: Date.UTC(2026, 10, 16, 23), localStartDate: '2026-11-16', localEndDate: '2026-11-17', tz: BKK }]);
  });

  it('ข้ามคืนวันสุดท้ายของช่วง (อาทิตย์) ล้ำไปเช้าวันจันทร์ถัดไป — ผูกกับวันเริ่ม', () => {
    const p = ok(planRoutine(timed(weeks('2026-11-16', '2026-11-16'), [7], '22:00', '06:00'), opts()));
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ localStartDate: '2026-11-22', localEndDate: '2026-11-23', endAt: Date.UTC(2026, 10, 22, 23) });
  });

  it('จบ 24:00 พอดี = เที่ยงคืนท้ายวันเดียวกัน ไม่ข้ามวัน (local_end_date = d)', () => {
    const p = ok(planRoutine(timed(weeks('2026-11-16', '2026-11-16'), [1], '18:00', '24:00'), opts()));
    expect(p.rule.endMin).toBe(1440);
    expect(p.rows).toEqual([{ allDay: false, startAt: Date.UTC(2026, 10, 16, 11), endAt: Date.UTC(2026, 10, 16, 17), localStartDate: '2026-11-16', localEndDate: '2026-11-16', tz: BKK }]);
    const whole = ok(planRoutine(timed(weeks('2026-11-16', '2026-11-16'), [1], '00:00', '24:00'), opts()));
    expect(whole.rows[0]!.endAt - whole.rows[0]!.startAt).toBe(24 * H);
    expect(whole.rows[0]).toMatchObject({ localStartDate: '2026-11-16', localEndDate: '2026-11-16' });
  });

  it('ทั้งวัน ส. อา. → เที่ยงคืนต้น/ท้ายวันใน tz · local start = end = d', () => {
    const p = ok(planRoutine({ range: weeks('2026-11-16', '2026-11-16'), weekdays: [6, 7], allDay: true }, opts()));
    expect(p.rule).toMatchObject({ weekdays: 96, allDay: true, startMin: null, endMin: null, tz: BKK });
    expect(p.rows).toEqual([
      { allDay: true, startAt: Date.UTC(2026, 10, 20, 17), endAt: Date.UTC(2026, 10, 21, 17), localStartDate: '2026-11-21', localEndDate: '2026-11-21', tz: BKK },
      { allDay: true, startAt: Date.UTC(2026, 10, 21, 17), endAt: Date.UTC(2026, 10, 22, 17), localStartDate: '2026-11-22', localEndDate: '2026-11-22', tz: BKK },
    ]);
  });

  it('ข้ามปี: ทุกวัน 28 ธ.ค. 2026 – 3 ม.ค. 2027 = 7 แถว (31 ธ.ค. → 1 ม.ค. ต่อกัน)', () => {
    const p = ok(planRoutine(timed(weeks('2026-12-28', '2026-12-28'), EVERY, '20:00', '21:00'), opts()));
    expect(p.rows.map((r) => r.localStartDate)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
    expect(p.rows[4]!.startAt - p.rows[3]!.startAt).toBe(24 * H);
  });

  it('ข้ามคืนวันที่ 31 ธ.ค. → จบ 1 ม.ค. ปีถัดไป', () => {
    const p = ok(planRoutine(timed(weeks('2026-12-28', '2026-12-28'), [4], '23:00', '02:00'), opts()));
    expect(p.rows[0]).toMatchObject({ localStartDate: '2026-12-31', localEndDate: '2027-01-01', startAt: Date.UTC(2026, 11, 31, 16), endAt: Date.UTC(2026, 11, 31, 19) });
  });

  it('ก.พ. 2027 (28 วัน) ทุกวัน = 28 แถว · ก.พ. 2028 (29 วัน) = 29 แถว · ม.ค.–ก.พ. 2028 = 60 แถว', () => {
    const now27 = Date.UTC(2027, 0, 15, 3);
    expect(ok(planRoutine(timed(months('2027-02', '2027-02'), EVERY, '07:00', '08:00'), opts({ now: now27 }))).rows).toHaveLength(28);
    const now28 = Date.UTC(2027, 11, 15, 3);
    const feb28 = ok(planRoutine(timed(months('2028-02', '2028-02'), EVERY, '07:00', '08:00'), opts({ now: now28 })));
    expect(feb28.rows).toHaveLength(29);
    expect(feb28.rows.at(-1)!.localStartDate).toBe('2028-02-29');
    expect(ok(planRoutine(timed(months('2028-01', '2028-02'), EVERY, '07:00', '08:00'), opts({ now: now28 }))).rows).toHaveLength(60);
  });

  it('ข้ามคืนวันที่ 28 ก.พ. 2027 → 1 มี.ค. · 29 ก.พ. 2028 → 1 มี.ค.', () => {
    const a = ok(planRoutine(timed(months('2027-02', '2027-02'), [7], '23:00', '01:00'), opts({ now: Date.UTC(2027, 0, 15, 3) })));
    expect(a.rows.at(-1)).toMatchObject({ localStartDate: '2027-02-28', localEndDate: '2027-03-01' });
    const b = ok(planRoutine(timed(months('2028-02', '2028-02'), [2], '23:00', '01:00'), opts({ now: Date.UTC(2027, 11, 15, 3) })));
    expect(b.rows.at(-1)).toMatchObject({ localStartDate: '2028-02-29', localEndDate: '2028-03-01' });
  });

  it('6 เดือนยาวสุด (ก.ค.–ธ.ค. 2027) ทุกวัน = 184 แถว', () => {
    const p = ok(planRoutine(timed(months('2027-07', '2027-12'), EVERY, '07:00', '08:00'), opts({ now: Date.UTC(2027, 5, 1, 3) })));
    expect(p.rows).toHaveLength(184);
  });

  it('skip: วันที่ถูกลบ/แยกไม่ถูกสร้าง', () => {
    const p = ok(planRoutine(timed(weeks('2026-11-16', '2026-11-16'), MON_FRI, '09:00', '18:00'), opts({ skip: ['2026-11-17', '2026-11-19', '2026-11-21'] })));
    expect(p.rows.map((r) => r.localStartDate)).toEqual(['2026-11-16', '2026-11-18', '2026-11-20']);
  });

  it('startDate (PATCH แบบแยก) แทนวันแรก · ปลายก่อน startDate = INVALID_RANGE · ความยาวคิดจาก startDate', () => {
    const p = ok(planRoutine(timed(weeks('2026-11-16', '2026-12-14'), MON_FRI, '09:00', '18:00'), opts({ startDate: '2026-11-30' })));
    expect([p.rule.startDate, p.rule.endDate, p.rows.length]).toEqual(['2026-11-30', '2026-12-20', 15]);
    expect(err(planRoutine(timed(weeks('2026-11-16', '2026-11-16'), MON_FRI, '09:00', '18:00'), opts({ startDate: '2026-11-30' })))).toEqual({ code: 'INVALID_RANGE', field: 'toWeek' });
    // ช่วงเดิม 30 สัปดาห์ แต่นับจาก startDate เหลือ 26 → ผ่าน
    expect(planRoutine(timed(weeks('2026-11-16', '2027-06-07'), MON_FRI, '09:00', '18:00'), opts({ startDate: '2026-12-14' })).ok).toBe(true);
  });

  it('requireOccurrence: false → 0 แถวไม่ error', () => {
    const p = ok(planRoutine(timed(weeks('2026-11-09', '2026-11-09'), [1], '09:00', '10:00'), opts({ requireOccurrence: false })));
    expect(p.rows).toEqual([]);
  });
});

describe('planRoutine — ลำดับ error (ADR 0012 §6)', () => {
  const base = timed(weeks('2026-11-16', '2026-11-16'), MON_FRI, '09:00', '18:00');

  it('tz ผิด = INVALID_TZ ก่อนอย่างอื่น', () => {
    expect(err(planRoutine({ ...base, tz: 'Mars/Base', weekdays: [] }, opts()))).toEqual({ code: 'INVALID_TZ', field: 'tz' });
  });

  it('ยาวเกิน = SPAN_TOO_LONG ก่อนเรื่องวันในสัปดาห์', () => {
    expect(err(planRoutine({ ...base, range: weeks('2026-11-16', '2027-05-17'), weekdays: [] }, opts()))).toEqual({ code: 'SPAN_TOO_LONG', field: 'toWeek' });
    expect(err(planRoutine({ ...base, range: months('2026-11', '2027-05') }, opts()))).toEqual({ code: 'SPAN_TOO_LONG', field: 'toMonth' });
  });

  it('วันจบ > วันนี้ + 12 เดือน = TOO_FAR_AHEAD · พอดี 12 เดือนผ่าน', () => {
    // วันนี้ 2026-11-11 → ไกลสุด 2027-11-11
    expect(err(planRoutine({ ...base, range: months('2027-11', '2027-11') }, opts()))).toEqual({ code: 'TOO_FAR_AHEAD', field: 'toMonth' });
    expect(planRoutine({ ...base, range: months('2027-10', '2027-10') }, opts()).ok).toBe(true);
    expect(err(planRoutine({ ...base, range: weeks('2027-11-08', '2027-11-08') }, opts()))).toEqual({ code: 'TOO_FAR_AHEAD', field: 'toWeek' });
    expect(planRoutine({ ...base, range: weeks('2027-11-01', '2027-11-01') }, opts()).ok).toBe(true); // จบ 2027-11-07
  });

  it('ช่วงจบไปแล้ว = RANGE_ENDED (สัปดาห์ก่อน) · สัปดาห์นี้ยังได้', () => {
    expect(err(planRoutine({ ...base, range: weeks('2026-11-02', '2026-11-02') }, opts()))).toEqual({ code: 'RANGE_ENDED', field: 'toWeek' });
    expect(err(planRoutine({ ...base, range: months('2026-10', '2026-10') }, opts()))).toEqual({ code: 'RANGE_ENDED', field: 'toMonth' });
    expect(planRoutine({ ...base, range: weeks('2026-11-09', '2026-11-09') }, opts()).ok).toBe(true);
  });

  it('weekdays ว่าง = WEEKDAYS_REQUIRED · ผิด = INVALID_WEEKDAYS', () => {
    expect(err(planRoutine({ ...base, weekdays: [] }, opts()))).toEqual({ code: 'WEEKDAYS_REQUIRED', field: 'weekdays' });
    expect(err(planRoutine({ ...base, weekdays: [1, 1] }, opts()))).toEqual({ code: 'INVALID_WEEKDAYS', field: 'weekdays' });
  });

  it('เวลา: เริ่ม = จบ = INVALID_RANGE · ไม่ลงตัว · ไม่ส่งเวลาตอนไม่ใช่ทั้งวัน', () => {
    expect(err(planRoutine({ ...base, startTime: '09:00', endTime: '09:00' }, opts()))).toEqual({ code: 'INVALID_RANGE', field: 'endTime' });
    expect(err(planRoutine({ ...base, startTime: '09:10' }, opts()))).toEqual({ code: 'TIME_NOT_ON_STEP', field: 'startTime' });
    expect(err(planRoutine({ ...base, startTime: undefined }, opts()))).toEqual({ code: 'INVALID_TIME', field: 'startTime' });
  });

  it('ไม่ได้สักวัน = NO_OCCURRENCE (เลือกแต่จันทร์ในสัปดาห์นี้ที่จันทร์ผ่านไปแล้ว)', () => {
    expect(err(planRoutine({ ...base, range: weeks('2026-11-09', '2026-11-09'), weekdays: [1] }, opts()))).toEqual({ code: 'NO_OCCURRENCE', field: 'weekdays' });
  });
});

describe('DST — America/New_York (เวลาผนังทีละวัน)', () => {
  const nyNow = Date.UTC(2026, 9, 20, 16); // 2026-10-20 12:00 EDT

  it('ทุกวัน 09:00–10:00 ครอบ 2026-11-01 (ถอยเวลา): ก่อน = 13:00Z (EDT) หลัง = 14:00Z (EST) · ยาว 1 ชม. ทุกวัน', () => {
    const p = ok(planRoutine(timed(weeks('2026-10-26', '2026-11-02'), EVERY, '09:00', '10:00', NY), opts({ now: nyNow })));
    const byDate = new Map(p.rows.map((r) => [r.localStartDate, r]));
    expect(byDate.get('2026-10-31')!.startAt).toBe(Date.UTC(2026, 9, 31, 13));
    expect(byDate.get('2026-11-01')!.startAt).toBe(Date.UTC(2026, 10, 1, 14));
    expect(byDate.get('2026-11-02')!.startAt).toBe(Date.UTC(2026, 10, 2, 14));
    for (const r of p.rows) expect(r.endAt - r.startAt).toBe(H);
  });

  it('fold 01:30 ของ 2026-11-01 (เกิดสองครั้ง) → ใช้ครั้งแรก (EDT) · 01:30–02:30 วันนั้นยาว 2 ชม. จริง', () => {
    const p = ok(planRoutine(timed(weeks('2026-10-26', '2026-11-02'), [7], '01:30', '02:30', NY), opts({ now: nyNow })));
    expect(p.rows.map((r) => [r.localStartDate, r.startAt, r.endAt])).toEqual([
      ['2026-11-01', Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 10, 1, 7, 30)],
      ['2026-11-08', Date.UTC(2026, 10, 8, 6, 30), Date.UTC(2026, 10, 8, 7, 30)],
    ]);
  });

  it('ข้ามคืน 22:00–06:00 คืนถอยเวลา (ส. 31 ต.ค. → อา. 1 พ.ย.) ยาว 9 ชม. · คืนก่อนหน้า 8 ชม.', () => {
    const p = ok(planRoutine(timed(weeks('2026-10-26', '2026-10-26'), [5, 6], '22:00', '06:00', NY), opts({ now: nyNow })));
    expect(p.rows.map((r) => [r.localStartDate, r.localEndDate, (r.endAt - r.startAt) / H])).toEqual([
      ['2026-10-30', '2026-10-31', 8],
      ['2026-10-31', '2026-11-01', 9],
    ]);
  });

  it('จบ 24:00 ในวันถอยเวลา = เที่ยงคืนท้ายวัน EST (18:00–24:00 = 6 ชม.)', () => {
    const p = ok(planRoutine(timed(weeks('2026-10-26', '2026-10-26'), [7], '18:00', '24:00', NY), opts({ now: nyNow })));
    expect(p.rows[0]).toMatchObject({ startAt: Date.UTC(2026, 10, 1, 23), endAt: Date.UTC(2026, 10, 2, 5), localStartDate: '2026-11-01', localEndDate: '2026-11-01' });
  });

  it('ช่วงครอบ 2027-03-14 (เดินหน้า): ทุกวัน 09:00 ก่อน = 14:00Z หลัง = 13:00Z', () => {
    const p = ok(planRoutine(timed(weeks('2027-03-08', '2027-03-15'), EVERY, '09:00', '10:00', NY), opts({ now: Date.UTC(2027, 1, 20, 17) })));
    const byDate = new Map(p.rows.map((r) => [r.localStartDate, r.startAt]));
    expect(byDate.get('2027-03-13')).toBe(Date.UTC(2027, 2, 13, 14));
    expect(byDate.get('2027-03-14')).toBe(Date.UTC(2027, 2, 14, 13));
    expect(byDate.get('2027-03-15')).toBe(Date.UTC(2027, 2, 15, 13));
  });

  it('gap: อา. 02:30 ไม่มีจริงในวัน 2027-03-14 → INVALID_LOCAL_TIME ทั้งคำขอ (ไม่ใช่ข้ามวันนั้น)', () => {
    expect(err(planRoutine(timed(weeks('2027-03-08', '2027-03-15'), [7], '02:30', '03:30', NY), opts({ now: Date.UTC(2027, 1, 20, 17) })))).toEqual({
      code: 'INVALID_LOCAL_TIME',
      field: 'startTime',
    });
    // เวลาจบตกใน gap (ข้ามคืน ส. 22:00 → อา. 02:30)
    expect(err(planRoutine(timed(weeks('2027-03-08', '2027-03-08'), [6], '22:00', '02:30', NY), opts({ now: Date.UTC(2027, 1, 20, 17) })))).toEqual({
      code: 'INVALID_LOCAL_TIME',
      field: 'endTime',
    });
  });

  it('gap ในวันที่ผ่านไปแล้ว (ก่อนวันนี้) ไม่ทำให้ล้ม — สร้างตั้งแต่วันนี้เท่านั้น', () => {
    // วันนี้ 2027-03-15 (จันทร์) · ช่วงเริ่ม 2027-03-08 · gap 2027-03-14 อยู่ในอดีต
    const p = ok(planRoutine(timed(weeks('2027-03-08', '2027-03-15'), [7], '02:30', '03:30', NY), opts({ now: Date.UTC(2027, 2, 15, 16) })));
    expect(p.rows.map((r) => r.localStartDate)).toEqual(['2027-03-21']);
  });
});

describe('DST — Australia/Lord_Howe (เลื่อน 30 นาที)', () => {
  it('gap 02:00–02:30 ของ 2026-10-04: อา. 02:00 = INVALID_LOCAL_TIME · อา. 02:30 ได้ (+11:00)', () => {
    const now = Date.UTC(2026, 8, 20);
    expect(err(planRoutine(timed(weeks('2026-09-28', '2026-10-05'), [7], '02:00', '03:00', LH), opts({ now })))).toEqual({ code: 'INVALID_LOCAL_TIME', field: 'startTime' });
    const p = ok(planRoutine(timed(weeks('2026-09-28', '2026-09-28'), [7], '02:30', '03:30', LH), opts({ now })));
    expect(p.rows[0]).toMatchObject({ localStartDate: '2026-10-04', startAt: Date.UTC(2026, 9, 3, 15, 30), endAt: Date.UTC(2026, 9, 3, 16, 30) });
  });

  it('fold 01:30–02:00 ของ 2027-04-04: อา. 01:30 = ครั้งแรก (+11:00) · ถึง 02:30 (+10:30) ยาว 1.5 ชม.', () => {
    const r = ok(expandRoutine(rule({ weekdays: 64, startMin: 90, endMin: 150, startDate: '2027-03-29', endDate: '2027-04-04', tz: LH })));
    expect(r).toEqual([{ allDay: false, startAt: Date.UTC(2027, 3, 3, 14, 30), endAt: Date.UTC(2027, 3, 3, 16, 0), localStartDate: '2027-04-04', localEndDate: '2027-04-04', tz: LH }]);
  });
});

describe('expandRoutine — กฎดิบ (ที่เก็บใน busy_routine)', () => {
  it('fromDate ตัดวันก่อนหน้า · fromDate ก่อน startDate ไม่ขยายย้อน', () => {
    expect(ok(expandRoutine(rule({}), { fromDate: '2026-11-20' })).map((r) => r.localStartDate)).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(ok(expandRoutine(rule({}), { fromDate: '2026-11-01' }))).toHaveLength(7);
    expect(ok(expandRoutine(rule({}), { fromDate: '2026-11-23' }))).toEqual([]);
  });

  it('กฎผิดรูป → error (ไม่ขยาย)', () => {
    expect(err(expandRoutine(rule({ weekdays: 0 })))).toEqual({ code: 'INVALID_WEEKDAYS', field: 'weekdays' });
    expect(err(expandRoutine(rule({ weekdays: 128 })))).toEqual({ code: 'INVALID_WEEKDAYS', field: 'weekdays' });
    expect(err(expandRoutine(rule({ startMin: 600, endMin: 600 })))).toEqual({ code: 'INVALID_RANGE', field: 'endTime' });
    expect(err(expandRoutine(rule({ endMin: 1470 })))).toEqual({ code: 'INVALID_TIME', field: 'endTime' });
    expect(err(expandRoutine(rule({ allDay: true })))).toEqual({ code: 'INVALID_RANGE', field: 'startTime' });
    expect(err(expandRoutine(rule({ endDate: '2026-11-15' })))).toEqual({ code: 'INVALID_RANGE', field: 'endDate' });
    expect(err(expandRoutine(rule({ tz: '+07:00' })))).toEqual({ code: 'INVALID_TZ', field: 'tz' });
  });

  it('ทุกแถว: end > start · local_end_date ≥ local_start_date (ตรง CHECK busy_range_ck) · ยาว ≤ 24 ชม.', () => {
    for (const [s, e] of [[0, 1440], [1410, 30], [1320, 360], [540, 1080], [1080, 1440], [30, 0 + 1440]] as const) {
      for (const tz of [BKK, NY, LH]) {
        const rows = ok(expandRoutine(rule({ startMin: s, endMin: e, startDate: '2026-10-26', endDate: '2026-11-08', tz })));
        expect(rows).toHaveLength(14);
        for (const r of rows) {
          expect(r.endAt).toBeGreaterThan(r.startAt);
          expect(r.localEndDate >= r.localStartDate).toBe(true);
          expect(r.endAt - r.startAt).toBeLessThanOrEqual(25 * H); // วันถอยเวลายาว 25 ชม.ได้
        }
      }
    }
  });
});
