// R15 §1.1 (ADR 0012 §13.2): routineOccursOn / checkRoutineSkipDate / expandRoutineDates — ขอบเขต
// ค่าที่คาดหวังคำนวณมือ (Bangkok = UTC+7 ไม่มี DST · New York EST −5 / EDT −4 — DST สหรัฐ 2026: เริ่ม 8 มี.ค. 02:00, จบ 1 พ.ย. 02:00)
import { describe, expect, it } from 'vitest';
import { checkRoutineSkipDate, expandRoutine, expandRoutineDates, routineOccursOn, weekdaysToMask, type RoutineRule } from '@/lib/calendar';

const BKK = 'Asia/Bangkok';
const NY = 'America/New_York';
const utc = (y: number, m: number, d: number, hh: number, mm = 0) => Date.UTC(y, m - 1, d, hh, mm);

const rule = (over: Partial<RoutineRule> = {}): RoutineRule => ({
  weekdays: weekdaysToMask([1, 2, 3, 4, 5]),
  allDay: false,
  startMin: 540,
  endMin: 1080,
  startDate: '2026-11-16',
  endDate: '2026-11-29',
  tz: BKK,
  ...over,
});

describe('routineOccursOn', () => {
  it('ในช่วงรวมปลาย + วันในสัปดาห์ตรง mask เท่านั้น', () => {
    const r = rule();
    expect(routineOccursOn(r, '2026-11-16')).toBe(true); // จันทร์ วันแรก
    expect(routineOccursOn(r, '2026-11-27')).toBe(true); // ศุกร์
    expect(routineOccursOn(r, '2026-11-28')).toBe(false); // เสาร์
    expect(routineOccursOn(r, '2026-11-29')).toBe(false); // อาทิตย์ วันสุดท้าย (ไม่อยู่ใน mask)
    expect(routineOccursOn(r, '2026-11-15')).toBe(false); // ก่อนช่วง
    expect(routineOccursOn(r, '2026-11-30')).toBe(false); // หลังช่วง (จันทร์)
  });

  it('ข้ามเดือน/ข้ามปี/ปีอธิกสุรทิน', () => {
    const r = rule({ weekdays: 127, startDate: '2027-12-27', endDate: '2028-03-05' });
    for (const d of ['2027-12-31', '2028-01-01', '2028-02-28', '2028-02-29', '2028-03-01']) expect(routineOccursOn(r, d), d).toBe(true);
    const tue = rule({ weekdays: weekdaysToMask([2]), startDate: '2028-02-01', endDate: '2028-03-31' });
    expect(routineOccursOn(tue, '2028-02-29')).toBe(true); // 29 ก.พ. 2028 = อังคาร
    expect(routineOccursOn(tue, '2028-03-01')).toBe(false);
  });

  it('เริ่ม = จบ (ชุดวันเดียว)', () => {
    const r = rule({ weekdays: 127, startDate: '2026-11-18', endDate: '2026-11-18' });
    expect([routineOccursOn(r, '2026-11-17'), routineOccursOn(r, '2026-11-18'), routineOccursOn(r, '2026-11-19')]).toEqual([false, true, false]);
  });
});

describe('checkRoutineSkipDate', () => {
  const r = rule({ startDate: '2026-11-09' });
  const today = '2026-11-11';
  it('add: วันนี้ได้ · อดีต PAST · นอกช่วง OUT_OF_RANGE · ไม่ตรงวัน NOT_IN_RULE · รูปแบบผิด INVALID', () => {
    expect(checkRoutineSkipDate(r, '2026-11-11', today, 'add')).toBeNull();
    expect(checkRoutineSkipDate(r, '2026-11-27', today, 'add')).toBeNull();
    expect(checkRoutineSkipDate(r, '2026-11-10', today, 'add')).toBe('PAST');
    expect(checkRoutineSkipDate(r, '2026-11-08', today, 'add')).toBe('PAST'); // อดีตมาก่อนนอกช่วง
    expect(checkRoutineSkipDate(r, '2026-11-30', today, 'add')).toBe('OUT_OF_RANGE');
    expect(checkRoutineSkipDate(r, '2026-11-21', today, 'add')).toBe('NOT_IN_RULE');
    for (const bad of ['2026-02-29', '2026-13-01', '2026-1-01', '', 20261111, null, '1999-12-31', '2101-01-01']) {
      expect(checkRoutineSkipDate(r, bad, today, 'add'), String(bad)).toBe('INVALID');
    }
  });

  it('remove: ไม่บังคับวันในสัปดาห์ (กฎถูกแก้ทีหลังได้) · อดีต/นอกช่วงยังปฏิเสธ', () => {
    expect(checkRoutineSkipDate(r, '2026-11-21', today, 'remove')).toBeNull();
    expect(checkRoutineSkipDate(r, '2026-11-10', today, 'remove')).toBe('PAST');
    expect(checkRoutineSkipDate(r, '2026-11-30', today, 'remove')).toBe('OUT_OF_RANGE');
  });

  it('ขอบปี: วันนี้ 31 ธ.ค. · 1 ม.ค. ปีถัดไปยังไม่ผ่าน · ปีอธิกสุรทิน 29 ก.พ. ใช้ได้', () => {
    const y = rule({ weekdays: 127, startDate: '2027-12-27', endDate: '2028-03-05' });
    expect(checkRoutineSkipDate(y, '2027-12-30', '2027-12-31', 'add')).toBe('PAST');
    expect(checkRoutineSkipDate(y, '2027-12-31', '2027-12-31', 'add')).toBeNull();
    expect(checkRoutineSkipDate(y, '2028-01-01', '2027-12-31', 'add')).toBeNull();
    expect(checkRoutineSkipDate(y, '2028-02-29', '2027-12-31', 'add')).toBeNull();
  });
});

describe('expandRoutineDates — ได้แถวเท่ากับ expandRoutine ทุกไบต์ (เฉพาะวันที่ขอ)', () => {
  const sameAs = (r: RoutineRule, dates: string[]) => {
    const all = expandRoutine(r);
    const some = expandRoutineDates(r, dates);
    expect(all.ok && some.ok).toBe(true);
    if (!all.ok || !some.ok) return;
    expect(some.value).toEqual(all.value.filter((x) => dates.includes(x.localStartDate)));
  };

  it('มีเวลา: วันที่ขอเรียง/ซ้ำ → แถวเรียงตามวันไม่ซ้ำ · วันที่กฎไม่มี (เสาร์/นอกช่วง) ข้ามเงียบ', () => {
    const r = rule();
    const res = expandRoutineDates(r, ['2026-11-27', '2026-11-18', '2026-11-18', '2026-11-21', '2026-12-01']);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((x) => [x.localStartDate, x.startAt, x.endAt])).toEqual([
      ['2026-11-18', utc(2026, 11, 18, 2), utc(2026, 11, 18, 11)],
      ['2026-11-27', utc(2026, 11, 27, 2), utc(2026, 11, 27, 11)],
    ]);
    sameAs(r, ['2026-11-18', '2026-11-27']);
  });

  it('ข้ามเที่ยงคืน 22:00–06:00: วันเริ่ม = วันที่ขอ · localEndDate = วันถัดไป · ข้ามเดือน 30 พ.ย. → 1 ธ.ค.', () => {
    const r = rule({ startMin: 1320, endMin: 360, startDate: '2026-11-23', endDate: '2026-12-06' });
    const res = expandRoutineDates(r, ['2026-11-30']);
    expect(res.ok && res.value.map((x) => [x.localStartDate, x.localEndDate, x.startAt, x.endAt])).toEqual([
      ['2026-11-30', '2026-12-01', utc(2026, 11, 30, 15), utc(2026, 11, 30, 23)],
    ]);
    sameAs(r, ['2026-11-30', '2026-12-04']);
  });

  it('ทั้งวัน · จบ 24:00 · ข้ามปี 31 ธ.ค. · ปีอธิกสุรทิน 29 ก.พ.', () => {
    const allDay = rule({ allDay: true, startMin: null, endMin: null, weekdays: 127, startDate: '2027-12-27', endDate: '2028-03-05' });
    const res = expandRoutineDates(allDay, ['2027-12-31', '2028-02-29']);
    expect(res.ok && res.value.map((x) => [x.localStartDate, x.localEndDate, x.startAt, x.endAt, x.allDay])).toEqual([
      ['2027-12-31', '2027-12-31', utc(2027, 12, 30, 17), utc(2027, 12, 31, 17), true],
      ['2028-02-29', '2028-02-29', utc(2028, 2, 28, 17), utc(2028, 2, 29, 17), true],
    ]);
    const midnight = rule({ startMin: 1080, endMin: 1440, weekdays: 127, startDate: '2027-12-27', endDate: '2028-01-02' });
    const m = expandRoutineDates(midnight, ['2027-12-31']);
    expect(m.ok && m.value.map((x) => [x.localStartDate, x.localEndDate, x.startAt, x.endAt])).toEqual([['2027-12-31', '2027-12-31', utc(2027, 12, 31, 11), utc(2027, 12, 31, 17)]]);
    sameAs(allDay, ['2027-12-31', '2028-01-01', '2028-02-29']);
  });

  it('New York ข้าม DST (1 พ.ย. 2026): เวลาผนังเท่าเดิม UTC ต่างกัน 1 ชม. ตรงกับ expandRoutine', () => {
    const r = rule({ tz: NY, weekdays: 127, startDate: '2026-10-26', endDate: '2026-11-08', startMin: 540, endMin: 600 });
    const res = expandRoutineDates(r, ['2026-10-31', '2026-11-02']);
    expect(res.ok && res.value.map((x) => [x.localStartDate, x.startAt])).toEqual([
      ['2026-10-31', utc(2026, 10, 31, 13)], // EDT −4
      ['2026-11-02', utc(2026, 11, 2, 14)], // EST −5
    ]);
    sameAs(r, ['2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('ไม่มีวันที่ขอ = [] · กฎเสีย → Result error (ไม่โยน)', () => {
    const empty = expandRoutineDates(rule(), []);
    expect(empty.ok && empty.value).toEqual([]);
    const bad = expandRoutineDates(rule({ tz: 'Mars/Base' }), ['2026-11-18']);
    expect(bad.ok).toBe(false);
  });
});
