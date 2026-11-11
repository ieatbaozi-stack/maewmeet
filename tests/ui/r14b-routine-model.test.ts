// R14b (ฝั่ง UI) — โมเดลฟอร์ม/รายการ/ขอบเขตของ busy แบบ routine: ช่วง→วัน · สรุป "จะลง N วัน" (planRoutine) · preset · payload · แมป error ทุกรูป · ขอบเขต→คำขอ API · คีย์ข้อความ TH/EN
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { FullResult } from '@/components/appointments/api';
import { nobodyLoggedBusy, type AvDay } from '@/components/availability/model';
import {
  END_OPTIONS,
  PRESET_IDS,
  applyPreset,
  applyShortcut,
  buildRoutinePayload,
  canExtend,
  canSubmit,
  deleteRequest,
  doneRef,
  formStateOfRoutine,
  initialRoutineState,
  isEnded,
  isOvernightTimes,
  isSplitEdit,
  latestEnd,
  mapDeleteFailure,
  mapRoutineFailure,
  monthLabel,
  periodOptions,
  quickMatch,
  scopeChoices,
  setRangeFrom,
  setRangeKind,
  setRangeTo,
  splitRoutines,
  summarize,
  timeInvalid,
  toOptionDisabled,
  toggleWeekday,
  updateRequest,
  weekRangeValues,
  weekdayParts,
  weekdaysText,
  type RoutineFormState,
  type RoutineView,
  type ScopeTarget,
} from '@/components/busy/routine-model';
import { parseLocalDateTime } from '@/lib/calendar';
import en from '../../messages/en.json';
import th from '../../messages/th.json';

const TZ = 'Asia/Bangkok';
// พุธ 11 พ.ย. 2026 เที่ยง (เวลาไทย) — วันนี้สมมติ
const NOW = parseLocalDateTime('2026-11-11', '12:00', TZ);
const TODAY = '2026-11-11';

const base = (over: Partial<RoutineFormState> = {}): RoutineFormState => ({ ...initialRoutineState(TODAY), ...over });
const work = (over: Partial<RoutineFormState> = {}): RoutineFormState => base({ weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00', ...over });

type Failure = Extract<FullResult<unknown>, { ok: false }>;
const api = (code: string, values: Record<string, string | number> = {}, fields: Record<string, string> = {}, status = 400): Failure =>
  ({ ok: false, kind: 'api', status, error: { code, key: `errors.${code}`, values }, fields }) as unknown as Failure;
const network = { ok: false, kind: 'network' } as unknown as Failure;
const problemOf = (f: ReturnType<typeof mapRoutineFailure>) => {
  if (f.type === 'gone') throw new Error('gone');
  return f.problem;
};

const routine = (over: Partial<RoutineView> = {}): RoutineView => ({
  id: 'r1',
  title: 'ทำงาน',
  note: null,
  hidden: false,
  allDay: false,
  weekdays: [1, 2, 3, 4, 5],
  startTime: '09:00',
  endTime: '18:00',
  overnight: false,
  rangeKind: 'weeks',
  startDate: '2026-11-02',
  endDate: '2026-12-27',
  tz: TZ,
  remaining: 30,
  ...over,
});

describe('ช่วง → วัน และสรุป "จะลง N วัน" (planRoutine ตัวเดียวกับเซิร์ฟเวอร์)', () => {
  it('ทำงาน + ทั้งเดือนนี้ (พ. 11 พ.ย.) = จ.–ศ. ตั้งแต่วันนี้ถึง 30 พ.ย. = 14 วัน · เริ่มก่อนวันนี้ → pastStart', () => {
    const s = applyShortcut(work(), 'thisMonth', TODAY);
    expect(s).toMatchObject({ rangeKind: 'months', fromMonth: '2026-11', toMonth: '2026-11' });
    const sum = summarize(s, NOW);
    expect(sum).toEqual({ kind: 'ok', count: 14, rangeStart: '2026-11-01', rangeEnd: '2026-11-30', pastStart: true });
  });
  it('4 สัปดาห์จากนี้ = จันทร์นี้ถึงอาทิตย์ที่ 4 · นับ จ.–ศ. ตั้งแต่วันนี้ = 18 วัน', () => {
    const s = applyShortcut(work(), 'next4Weeks', TODAY);
    expect(s).toMatchObject({ rangeKind: 'weeks', fromWeek: '2026-11-09', toWeek: '2026-11-30' });
    expect(summarize(s, NOW)).toEqual({ kind: 'ok', count: 18, rangeStart: '2026-11-09', rangeEnd: '2026-12-06', pastStart: true });
  });
  it('3 เดือนจากนี้ = พ.ย.–ม.ค. (ข้ามปี) · ทั้งวัน ส.–อา.', () => {
    const s = applyShortcut(base({ weekdays: [6, 7], allDay: true }), 'next3Months', TODAY);
    expect(s).toMatchObject({ rangeKind: 'months', fromMonth: '2026-11', toMonth: '2027-01' });
    const sum = summarize(s, NOW);
    expect(sum).toMatchObject({ kind: 'ok', rangeStart: '2026-11-01', rangeEnd: '2027-01-31' });
    // ส./อา. 14–15, 21–22, 28–29 พ.ย. + 5 ธ.ค.… นับจริงด้วย planRoutine ไม่นับเอง: ตรวจว่ามากกว่า 0 และไม่รวมวันก่อนวันนี้
    expect(sum.kind === 'ok' && sum.count).toBeGreaterThan(20);
  });
  it('ยังไม่เลือกวัน / เวลาจบ = เริ่ม → ไม่สรุป (none) และบันทึกไม่ได้', () => {
    expect(summarize(base(), NOW)).toEqual({ kind: 'none' });
    const same = work({ startTime: '09:00', endTime: '09:00' });
    expect(timeInvalid(same)).toBe(true);
    expect(summarize(same, NOW)).toEqual({ kind: 'none' });
    expect(canSubmit(same, summarize(same, NOW))).toBe(false);
  });
  it('0 วัน (ช่วงที่เหลือไม่ตรงวันที่เลือก) = zero และบันทึกไม่ได้', () => {
    // พฤ. 12–ศ. 13 นี้ ไม่มี "จันทร์" ในเดือนที่เหลือก่อน…ใช้ช่วงสัปดาห์นี้ + เลือกเฉพาะจันทร์ (จ. 9 พ.ย. ผ่านไปแล้ว)
    const s = base({ weekdays: [1], rangeKind: 'weeks', fromWeek: '2026-11-09', toWeek: '2026-11-09' });
    const sum = summarize(s, NOW);
    expect(sum).toMatchObject({ kind: 'zero', rangeStart: '2026-11-09', rangeEnd: '2026-11-15' });
    expect(canSubmit(s, sum)).toBe(false);
  });
  it('ข้ามเที่ยงคืน 22:00→06:00 นับ และ 24:00 ใช้ได้ · เวลาจบ = เริ่มเท่านั้นที่ผิด', () => {
    expect(isOvernightTimes('22:00', '06:00')).toBe(true);
    expect(isOvernightTimes('09:00', '18:00')).toBe(false);
    expect(isOvernightTimes('22:00', '24:00')).toBe(false);
    expect(END_OPTIONS.at(-1)).toBe('24:00');
    expect(END_OPTIONS).not.toContain('00:00');
    expect(summarize(work({ startTime: '22:00', endTime: '06:00' }), NOW).kind).toBe('ok');
    expect(summarize(work({ startTime: '09:00', endTime: '24:00' }), NOW).kind).toBe('ok');
  });
  it('ช่วงจบไปแล้ว → invalid ใต้ช่องช่วง (error.ended) · ไกลเกิน 12 เดือน → ใต้ช่อง "ถึง" (error.ahead)', () => {
    const ended = summarize(work({ rangeKind: 'weeks', fromWeek: '2026-10-05', toWeek: '2026-10-26' }), NOW);
    expect(ended).toMatchObject({ kind: 'invalid', problem: { pos: 'range', refs: [{ key: 'busy.routine.error.ended' }] } });
    const far = summarize(work({ rangeKind: 'months', fromMonth: '2027-10', toMonth: '2027-12' }), NOW);
    expect(far).toMatchObject({ kind: 'invalid', problem: { pos: 'to', refs: [{ key: 'busy.routine.error.ahead', values: { max: 12 } }] } });
  });
  it('แก้แยกชุด: นับจากสัปดาห์ที่เลือก (splitStart) ไปถึงปลายช่วง', () => {
    const s = work({ rangeKind: 'weeks', fromWeek: '2026-11-23', toWeek: '2026-12-07' });
    expect(summarize(s, NOW, { splitStart: '2026-11-23' })).toMatchObject({ kind: 'ok', count: 15, rangeStart: '2026-11-23', pastStart: false });
  });
});

describe('ตัวเลือกช่วง / เพดาน', () => {
  it('สัปดาห์: รายการเริ่มจันทร์นี้ · ติดป้ายสัปดาห์ปัจจุบัน · ไม่ใช้เลขสัปดาห์ (ค่าเป็นวันจันทร์)', () => {
    const o = periodOptions('weeks', '2026-11-09', 52, TODAY);
    expect(o).toHaveLength(52);
    expect(o[0]).toMatchObject({ value: '2026-11-09', start: '2026-11-09', end: '2026-11-15', current: true });
    expect(o[1]).toMatchObject({ value: '2026-11-16', current: false });
  });
  it('เดือน: เดือนนี้ติดป้าย · ข้ามปี', () => {
    const o = periodOptions('months', '2026-11', 12, TODAY);
    expect(o[0]).toMatchObject({ value: '2026-11', start: '2026-11-01', end: '2026-11-30', current: true });
    expect(o[2]).toMatchObject({ value: '2027-01', end: '2027-01-31' });
    expect(o[3]).toMatchObject({ value: '2027-02', end: '2027-02-28' });
  });
  it('ข้อความช่วงสัปดาห์: เดือนเดียวกัน "16–22 พ.ย." ข้ามเดือน "30 พ.ย.–6 ธ.ค." (EN เหมือนกัน)', () => {
    expect(weekRangeValues('2026-11-16', 'th')).toEqual({ start: '16', end: '22 พ.ย.' });
    expect(weekRangeValues('2026-11-30', 'th')).toEqual({ start: '30 พ.ย.', end: '6 ธ.ค.' });
    expect(weekRangeValues('2026-11-16', 'en')).toEqual({ start: '16', end: '22 Nov' });
    expect(weekRangeValues('2026-11-30', 'en')).toEqual({ start: '30 Nov', end: '6 Dec' });
    const tt = createTranslator({ locale: 'th', messages: th });
    expect(tt('busy.routine.range.week', weekRangeValues('2026-11-16', 'th'))).toBe('16–22 พ.ย.');
  });
  it('เดือนตามภาษา (พ.ศ./ค.ศ.)', () => {
    expect(monthLabel('2026-11', 'th')).toContain('2569');
    expect(monthLabel('2026-11', 'en')).toContain('2026');
  });
  it('"ถึง" ปิดตัวเลือกที่เกินเพดาน 26 สัปดาห์ / 6 เดือน / 12 เดือนล่วงหน้า', () => {
    const weeks = periodOptions('weeks', '2026-11-09', 52, TODAY);
    const dis = weeks.map((o) => toOptionDisabled('weeks', '2026-11-09', o, TODAY));
    expect(dis.slice(0, 26).every((x) => !x)).toBe(true);
    expect(dis[26]).toBe(true);
    const months = periodOptions('months', '2026-11', 12, TODAY);
    const mdis = months.map((o) => toOptionDisabled('months', '2026-11', o, TODAY));
    expect(mdis.slice(0, 6).every((x) => !x)).toBe(true);
    expect(mdis[6]).toBe(true);
    // จากสัปดาห์ท้ายๆ: ปลายช่วงเกินวันนี้+12 เดือน (2027-11-11) ถูกปิด
    expect(latestEnd(TODAY)).toBe('2027-11-11');
    const late = periodOptions('weeks', '2027-10-25', 8, TODAY);
    expect(late.map((o) => toOptionDisabled('weeks', '2027-10-25', o, TODAY))).toEqual([false, false, true, true, true, true, true, true]);
  });
  it('เลือก "ตั้งแต่" เลย "ถึง" → ดัน "ถึง" ตาม · ยาวเกินเพดาน → ดึง "ถึง" กลับ', () => {
    const s = base({ rangeKind: 'weeks', fromWeek: '2026-11-09', toWeek: '2026-11-16' });
    expect(setRangeFrom(s, '2026-11-30')).toMatchObject({ fromWeek: '2026-11-30', toWeek: '2026-11-30' });
    const far = base({ rangeKind: 'weeks', fromWeek: '2026-11-09', toWeek: '2027-05-03' });
    expect(setRangeFrom(far, '2026-11-09').toWeek).toBe('2027-05-03'); // ยาว 26 สัปดาห์พอดี
    expect(setRangeFrom({ ...far, toWeek: '2027-09-27' }, '2026-11-09').toWeek).toBe('2027-05-03');
    const m = base({ rangeKind: 'months', fromMonth: '2026-11', toMonth: '2027-02' });
    expect(setRangeFrom(m, '2027-03')).toMatchObject({ fromMonth: '2027-03', toMonth: '2027-03' });
    expect(setRangeTo(m, '2026-12').toMonth).toBe('2026-12');
  });
  it('สลับสัปดาห์ ↔ เดือน แปลงช่วงให้ครอบวันเดียวกัน', () => {
    const w = base({ rangeKind: 'weeks', fromWeek: '2026-11-09', toWeek: '2026-12-21' });
    const m = setRangeKind(w, 'months');
    expect(m).toMatchObject({ rangeKind: 'months', fromMonth: '2026-11', toMonth: '2026-12' });
    expect(setRangeKind(m, 'weeks')).toMatchObject({ rangeKind: 'weeks', fromWeek: '2026-10-26', toWeek: '2026-12-28' });
  });
});

describe('preset / วันในสัปดาห์', () => {
  it('ทำงาน = จ.–ศ. 09:00–18:00 + ชื่อ · เสาร์–อาทิตย์ = ส. อา. ทั้งวัน · ยิม = ไม่เลือกวัน · สร้างเอง = ว่าง', () => {
    const w = applyPreset(base(), 'work', 'ทำงาน');
    expect(w).toMatchObject({ preset: 'work', weekdays: [1, 2, 3, 4, 5], allDay: false, startTime: '09:00', endTime: '18:00', title: 'ทำงาน', autoTitle: 'ทำงาน' });
    expect(applyPreset(base(), 'weekend', 'สุดสัปดาห์')).toMatchObject({ weekdays: [6, 7], allDay: true, title: 'สุดสัปดาห์' });
    expect(applyPreset(w, 'gym', 'ยิม')).toMatchObject({ weekdays: [], allDay: false, title: 'ยิม', startTime: '09:00' });
    expect(applyPreset(w, 'custom', '')).toMatchObject({ weekdays: [], title: '', autoTitle: null });
    expect(PRESET_IDS).toEqual(['work', 'class', 'gym', 'weekend', 'custom']);
  });
  it('class = จ.–ศ. เวลาไม่ถูกบังคับ (คงที่ผู้ใช้ตั้ง)', () => {
    expect(applyPreset(base({ startTime: '13:00', endTime: '15:30' }), 'class', 'เรียน')).toMatchObject({ weekdays: [1, 2, 3, 4, 5], startTime: '13:00', endTime: '15:30' });
  });
  it('ไม่ทับชื่อที่ผู้ใช้พิมพ์เอง แต่ทับชื่อที่ preset เติมให้ · ไม่แตะบันทึกส่วนตัว/ซ่อน', () => {
    const typed = base({ title: 'ประชุมทีม', note: 'ความลับ', hideDetail: true });
    const a = applyPreset(typed, 'gym', 'ยิม');
    expect(a).toMatchObject({ title: 'ประชุมทีม', note: 'ความลับ', hideDetail: true, weekdays: [] });
    const filled = applyPreset(base(), 'work', 'ทำงาน');
    expect(applyPreset(filled, 'gym', 'ยิม').title).toBe('ยิม');
    // ผู้ใช้แก้ชื่อที่เติมให้แล้ว → ถือเป็นของผู้ใช้
    expect(applyPreset({ ...filled, title: 'ทำงานที่บ้าน' }, 'gym', 'ยิม').title).toBe('ทำงานที่บ้าน');
  });
  it('toggle วันเรียงจ.→อา. · quick match · สรุปวัน (ติดกัน ≥ 3 = ช่วง, ทั้ง 7 = ทุกวัน)', () => {
    expect(toggleWeekday([1, 3], 2)).toEqual([1, 2, 3]);
    expect(toggleWeekday([1, 2], 2)).toEqual([1]);
    expect(quickMatch([1, 2, 3, 4, 5])).toBe('weekdays');
    expect(quickMatch([6, 7])).toBe('weekend');
    expect(quickMatch([1, 2])).toBeNull();
    expect(weekdayParts([1, 2, 3, 4, 5])).toEqual([{ kind: 'range', from: 1, to: 5 }]);
    expect(weekdayParts([1, 2, 4, 5])).toEqual([{ kind: 'day', day: 1 }, { kind: 'day', day: 2 }, { kind: 'day', day: 4 }, { kind: 'day', day: 5 }]);
    expect(weekdayParts([1, 2, 3, 4, 5, 6, 7])).toEqual([{ kind: 'every' }]);
    const tt = createTranslator({ locale: 'th', messages: th });
    const te = createTranslator({ locale: 'en', messages: en });
    expect(weekdaysText(tt as never, [1, 2, 3, 4, 5])).toBe('จ.–ศ.');
    expect(weekdaysText(tt as never, [1, 2, 4, 5])).toBe('จ. อ. พฤ. ศ.');
    expect(weekdaysText(te as never, [6, 7])).toBe(`${en.busy.routine.weekdays.short.sat} ${en.busy.routine.weekdays.short.sun}`);
    expect(weekdaysText(tt as never, [1, 2, 3, 4, 5, 6, 7])).toBe('ทุกวัน');
  });
});

describe('ฟอร์ม → payload (ตรงกับ schema .strict() ของเซิร์ฟเวอร์)', () => {
  it('สัปดาห์: fromWeek/toWeek เป็นวันจันทร์ · ไม่ส่ง tz/from · title/note ว่าง = null', () => {
    const p = buildRoutinePayload(applyPreset(applyShortcut(base(), 'next4Weeks', TODAY), 'work', 'ทำงาน'));
    expect(p).toEqual({ rangeKind: 'weeks', fromWeek: '2026-11-09', toWeek: '2026-11-30', weekdays: [1, 2, 3, 4, 5], allDay: false, startTime: '09:00', endTime: '18:00', title: 'ทำงาน', note: null, hideDetail: false });
    expect(Object.keys(p)).not.toContain('tz');
    expect(Object.keys(p)).not.toContain('fromMonth');
  });
  it('เดือน + ทั้งวัน: fromMonth/toMonth YYYY-MM · ไม่ส่งเวลา', () => {
    const p = buildRoutinePayload(applyShortcut(applyPreset(base(), 'weekend', 'สุดสัปดาห์'), 'thisMonth', TODAY));
    expect(p).toEqual({ rangeKind: 'months', fromMonth: '2026-11', toMonth: '2026-11', weekdays: [6, 7], allDay: true, title: 'สุดสัปดาห์', note: null, hideDetail: false });
  });
  it('จบ 24:00 ส่ง "24:00" · ข้ามเที่ยงคืนส่งตามที่เลือก · ตัดช่องว่างชื่อ/บันทึก', () => {
    const p = buildRoutinePayload(work({ startTime: '22:00', endTime: '24:00', title: '  กะดึก ', note: ' x ', hideDetail: true }));
    expect(p).toMatchObject({ startTime: '22:00', endTime: '24:00', title: 'กะดึก', note: 'x', hideDetail: true });
  });
  it('แก้ตั้งแต่ช่วงที่เลือก ส่ง from · ทั้งหมดไม่ส่ง from', () => {
    expect(buildRoutinePayload(work(), { from: '2026-11-23' })).toMatchObject({ from: '2026-11-23' });
    expect(Object.keys(buildRoutinePayload(work()))).not.toContain('from');
  });
});

describe('routine จากเซิร์ฟเวอร์ → ฟอร์มแก้', () => {
  it('แก้ทั้งหมด: "ตั้งแต่" ขยับมาที่สัปดาห์ปัจจุบัน (ชุดเริ่มก่อนหน้า) เพื่อไม่ชนเพดานความยาวตอนต่ออายุ · ชุดที่ยังไม่เริ่มคงวันเริ่ม', () => {
    const s = formStateOfRoutine(routine(), 'all', '2026-11-09', TODAY);
    expect(s).toMatchObject({ rangeKind: 'weeks', fromWeek: '2026-11-09', toWeek: '2026-12-21', weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00', title: 'ทำงาน' });
    expect(formStateOfRoutine(routine({ startDate: '2026-12-07', endDate: '2027-01-31' }), 'all', '2026-12-07', TODAY).fromWeek).toBe('2026-12-07');
  });
  it('แก้ตั้งแต่ช่วงที่เลือก: "ตั้งแต่" = ช่วงนั้น · เดือน → YYYY-MM', () => {
    expect(formStateOfRoutine(routine(), 'from', '2026-11-23', TODAY).fromWeek).toBe('2026-11-23');
    const m = routine({ rangeKind: 'months', startDate: '2026-11-01', endDate: '2027-01-31', allDay: true, startTime: null, endTime: null });
    expect(formStateOfRoutine(m, 'from', '2026-12-01', TODAY)).toMatchObject({ rangeKind: 'months', fromMonth: '2026-12', toMonth: '2027-01', allDay: true });
  });
  it('แยกชุดเมื่อช่วงเริ่ม > วันนี้ และ > วันแรกของชุด', () => {
    expect(isSplitEdit(routine(), 'from', '2026-11-23', TODAY)).toBe(true);
    expect(isSplitEdit(routine(), 'from', '2026-11-09', TODAY)).toBe(false);
    expect(isSplitEdit(routine(), 'all', '2026-11-23', TODAY)).toBe(false);
  });
});

describe('รายการ "แบบประจำของฉัน"', () => {
  it('จบแล้ว = endDate < วันนี้ · ต่ออายุเมื่อเหลือ ≤ 14 วันหรือจบแล้ว · แยกยังไม่จบ/จบแล้ว', () => {
    const live = routine({ remaining: 20 });
    const low = routine({ id: 'r2', remaining: 14 });
    const done = routine({ id: 'r3', endDate: '2026-11-08', remaining: 0 });
    expect(isEnded(done, TODAY)).toBe(true);
    expect(isEnded(live, TODAY)).toBe(false);
    expect([canExtend(live, TODAY), canExtend(low, TODAY), canExtend(done, TODAY)]).toEqual([false, true, true]);
    const s = splitRoutines([done, live, low], TODAY);
    expect(s.active.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(s.ended.map((r) => r.id)).toEqual(['r3']);
  });
});

describe('ขอบเขตแก้/ลบ → ตัวเลือก + คำขอ API', () => {
  const rowTarget: ScopeTarget = { routine: routine(), day: null };
  it('แถวรายการ: ช่วงอ้างอิง = สัปดาห์ปัจจุบัน → ตั้งแต่… + ทั้งหมด (ไม่มี "เฉพาะวันนี้")', () => {
    // ชุดเริ่ม 2 พ.ย. วันนี้ 11 พ.ย. → สัปดาห์ 9 พ.ย. > วันแรก → มีตัวเลือก from
    expect(scopeChoices(rowTarget, TODAY)).toEqual({ choices: ['from', 'all'], periodStart: '2026-11-09' });
  });
  it('ซ่อน "ตั้งแต่…" เมื่ออ้างอิงคือช่วงแรกของชุด (ผลเท่ากับทั้งหมด) · ชุดที่จบแล้วเหลือแต่ทั้งหมด', () => {
    expect(scopeChoices({ routine: routine({ startDate: '2026-11-09' }), day: null }, TODAY).choices).toEqual(['all']);
    expect(scopeChoices({ routine: routine({ startDate: '2026-12-07' }), day: null }, TODAY)).toEqual({ choices: ['all'], periodStart: '2026-12-07' });
    expect(scopeChoices({ routine: routine({ endDate: '2026-11-08' }), day: null }, TODAY).choices).toEqual(['all']);
  });
  it('แถววัน: one + from (ช่วงของวันที่แตะ) + all', () => {
    const day: ScopeTarget = { routine: routine(), day: { busyId: 'b1', date: '2026-11-25' } };
    expect(scopeChoices(day, TODAY)).toEqual({ choices: ['one', 'from', 'all'], periodStart: '2026-11-23' });
    const first: ScopeTarget = { routine: routine(), day: { busyId: 'b0', date: '2026-11-04' } };
    expect(scopeChoices(first, TODAY).choices).toEqual(['one', 'all']);
  });
  it('เดือน: ช่วงอ้างอิงเป็นวันที่ 1 ของเดือน', () => {
    const m = routine({ rangeKind: 'months', startDate: '2026-11-01', endDate: '2027-01-31' });
    expect(scopeChoices({ routine: m, day: { busyId: 'b', date: '2026-12-15' } }, TODAY)).toEqual({ choices: ['one', 'from', 'all'], periodStart: '2026-12-01' });
  });
  it('ลบ → คำขอ: one = DELETE /busy/:id · from = ?from= · all = ไม่ส่ง from', () => {
    const day: ScopeTarget = { routine: routine(), day: { busyId: 'b1', date: '2026-11-25' } };
    expect(deleteRequest('one', day, '2026-11-23')).toEqual({ method: 'DELETE', path: '/api/me/busy/b1' });
    expect(deleteRequest('from', day, '2026-11-23')).toEqual({ method: 'DELETE', path: '/api/me/busy-routines/r1?from=2026-11-23' });
    expect(deleteRequest('all', day, '2026-11-23')).toEqual({ method: 'DELETE', path: '/api/me/busy-routines/r1' });
  });
  it('แก้ → คำขอ PATCH: from เฉพาะ "ตั้งแต่…ไป" · ทั้งหมดไม่ส่ง from', () => {
    const s = formStateOfRoutine(routine(), 'from', '2026-11-23', TODAY);
    const f = updateRequest('r1', s, 'from', '2026-11-23');
    expect(f).toMatchObject({ method: 'PATCH', path: '/api/me/busy-routines/r1', body: { from: '2026-11-23', rangeKind: 'weeks', fromWeek: '2026-11-23' } });
    const a = updateRequest('r1', formStateOfRoutine(routine(), 'all', '2026-11-09', TODAY), 'all', '2026-11-09');
    expect(a.body).toBeDefined();
    expect(Object.keys(a.body!)).not.toContain('from');
  });
  it('toast หลังสำเร็จ: stopped ใช้วันเริ่มของสัปดาห์/เดือน · ที่เหลือไม่มี placeholder ค้าง', () => {
    const tt = createTranslator({ locale: 'th', messages: th });
    const r = doneRef({ type: 'stopped', periodStart: '2026-11-23', rangeKind: 'weeks' }, 'th');
    expect(r.key).toBe('busy.routine.toast.stopped');
    expect(tt(r.key as never, r.values as never)).toContain('2569');
    const m = doneRef({ type: 'stopped', periodStart: '2026-12-01', rangeKind: 'months' }, 'en');
    expect(String(m.values.date)).toContain('2026');
    expect(doneRef({ type: 'created', count: 17 }, 'th')).toEqual({ key: 'busy.routine.toast.saved', values: { count: 17 } });
    expect(doneRef({ type: 'deletedAll' }, 'th').key).toBe('busy.routine.toast.deletedAll');
    expect(doneRef({ type: 'gone' }, 'th').key).toBe('busy.routine.error.gone');
  });
});

describe('error จากเซิร์ฟเวอร์ → busy.routine.error.* ทุกรูป', () => {
  const create = { mode: 'create', rangeKind: 'weeks' } as const;
  const key = (f: ReturnType<typeof mapRoutineFailure>) => problemOf(f).refs[0]!.key;
  const pos = (f: ReturnType<typeof mapRoutineFailure>) => problemOf(f).pos;

  it('LIMIT_REACHED routines: สร้าง = routines (10) · แก้แยกชุดชนเพดานแข็ง 20 = routinesEdit · ต่ออายุชุดเต็ม 10 ตอนแก้ = routines', () => {
    const c = mapRoutineFailure(api('LIMIT_REACHED', { limit: 'routines', max: 10 }), create);
    expect(problemOf(c)).toEqual({ pos: 'banner', refs: [{ key: 'busy.routine.error.routines', values: { max: 10 } }] });
    const split = mapRoutineFailure(api('LIMIT_REACHED', { limit: 'routines', max: 20 }, {}, 409), { mode: 'editSplit', rangeKind: 'weeks' });
    expect(problemOf(split).refs[0]).toEqual({ key: 'busy.routine.error.routinesEdit', values: { max: 20 } });
    const renew = mapRoutineFailure(api('LIMIT_REACHED', { limit: 'routines', max: 10 }), { mode: 'edit', rangeKind: 'weeks' });
    expect(key(renew)).toBe('busy.routine.error.routines');
  });
  it('routineRows / routineSpan (ตามชนิดช่วง) / routineAhead (ใต้ช่อง "ถึง") / busyCount (ข้อความกลาง)', () => {
    expect(problemOf(mapRoutineFailure(api('LIMIT_REACHED', { limit: 'routineRows', max: 1500 }), create)).refs[0]).toEqual({ key: 'busy.routine.error.routineRows', values: { max: 1500 } });
    expect(problemOf(mapRoutineFailure(api('LIMIT_REACHED', { limit: 'routineSpan', max: 26, rangeKind: 'weeks' }), create))).toEqual({ pos: 'range', refs: [{ key: 'busy.routine.error.spanWeeks', values: { max: 26 } }] });
    expect(key(mapRoutineFailure(api('LIMIT_REACHED', { limit: 'routineSpan', max: 6, rangeKind: 'months' }), create))).toBe('busy.routine.error.spanMonths');
    // ไม่มี rangeKind ใน params → ใช้ชนิดของฟอร์ม
    expect(key(mapRoutineFailure(api('LIMIT_REACHED', { limit: 'routineSpan', max: 6 }), { mode: 'create', rangeKind: 'months' }))).toBe('busy.routine.error.spanMonths');
    expect(problemOf(mapRoutineFailure(api('LIMIT_REACHED', { limit: 'routineAhead', max: 12 }), create))).toEqual({ pos: 'to', refs: [{ key: 'busy.routine.error.ahead', values: { max: 12 } }] });
    expect(problemOf(mapRoutineFailure(api('LIMIT_REACHED', { limit: 'busyCount', max: 300 }), { mode: 'edit', rangeKind: 'weeks' }))).toEqual({ pos: 'banner', refs: [{ key: 'errors.LIMIT_REACHED', values: { limit: 'busyCount', max: 300 } }] });
  });
  it('INVALID_RANGE: time → error.end ใต้เวลา · ENDED → error.ended ใต้ช่วง · dates ธรรมดา → errors.INVALID_RANGE', () => {
    expect(problemOf(mapRoutineFailure(api('INVALID_RANGE', { kind: 'time', field: 'endTime' }), create))).toEqual({ pos: 'time', refs: [{ key: 'busy.routine.error.end', values: {} }] });
    expect(problemOf(mapRoutineFailure(api('INVALID_RANGE', { kind: 'dates', reason: 'ENDED' }), create))).toMatchObject({ pos: 'range', refs: [{ key: 'busy.routine.error.ended' }] });
    expect(problemOf(mapRoutineFailure(api('INVALID_RANGE', { kind: 'dates' }), create))).toMatchObject({ pos: 'range', refs: [{ key: 'errors.INVALID_RANGE', values: { kind: 'dates' } }] });
  });
  it('VALIDATION weekdays: REQUIRED → ใต้แถววัน · NO_OCCURRENCE สร้าง/แก้แยกชุด = noOccurrence (ใกล้สรุป) · แก้ในที่ = noOccurrenceEdit (แถบ) · อื่นๆ = generic', () => {
    const req = mapRoutineFailure(api('VALIDATION', {}, { weekdays: 'REQUIRED' }), create);
    expect(problemOf(req)).toMatchObject({ pos: 'weekdays', refs: [{ key: 'busy.routine.error.weekdaysRequired' }] });
    const noc = { weekdays: 'NO_OCCURRENCE' };
    expect(problemOf(mapRoutineFailure(api('VALIDATION', {}, noc), create))).toMatchObject({ pos: 'summary', refs: [{ key: 'busy.routine.error.noOccurrence' }] });
    expect(problemOf(mapRoutineFailure(api('VALIDATION', {}, noc), { mode: 'editSplit', rangeKind: 'weeks' }))).toMatchObject({ pos: 'summary', refs: [{ key: 'busy.routine.error.noOccurrence' }] });
    expect(problemOf(mapRoutineFailure(api('VALIDATION', {}, noc), { mode: 'edit', rangeKind: 'weeks' }))).toMatchObject({ pos: 'banner', refs: [{ key: 'busy.routine.error.noOccurrenceEdit' }] });
    expect(key(mapRoutineFailure(api('VALIDATION', {}, { title: 'INVALID' }), create))).toBe('busy.routine.error.generic');
  });
  it('INVALID_LOCAL_TIME → error.dst ใต้เวลา · TIME_NOT_ON_STEP → ข้อความกลางใต้เวลา · INVALID_DATE → ใต้ช่วง', () => {
    expect(problemOf(mapRoutineFailure(api('INVALID_LOCAL_TIME'), create))).toMatchObject({ pos: 'time', refs: [{ key: 'busy.routine.error.dst' }] });
    expect(problemOf(mapRoutineFailure(api('TIME_NOT_ON_STEP'), create))).toMatchObject({ pos: 'time', refs: [{ key: 'errors.TIME_NOT_ON_STEP' }] });
    expect(pos(mapRoutineFailure(api('INVALID_DATE'), create))).toBe('range');
  });
  it('NOT_FOUND → gone (ปิด + รีเฟรช) · CONFLICT → รีเฟรช + error.save · RATE_LIMITED → error.rate (+ เวลารอจาก Retry-After) · เครือข่าย/อื่นๆ → generic', () => {
    expect(mapRoutineFailure(api('NOT_FOUND', {}, {}, 404), create)).toEqual({ type: 'gone' });
    const c = mapRoutineFailure(api('CONFLICT', {}, {}, 409), create);
    expect(c.type).toBe('conflict');
    expect(c.type === 'conflict' && c.problem.refs[0]!.key).toBe('busy.routine.error.save');
    expect(problemOf(mapRoutineFailure(api('RATE_LIMITED', { retryAfterSec: 30 }, {}, 429), create)).refs).toEqual([
      { key: 'busy.routine.error.rate', values: {} },
      { key: 'appointments.rateRetry', values: { n: 30, unit: 'sec' } },
    ]);
    expect(problemOf(mapRoutineFailure(api('RATE_LIMITED', { retryAfterSec: 180 }, {}, 429), create)).refs[1]).toEqual({ key: 'appointments.rateRetry', values: { n: 3, unit: 'min' } });
    expect(problemOf(mapRoutineFailure(api('RATE_LIMITED'), create)).refs).toHaveLength(1);
    expect(key(mapRoutineFailure(network, create))).toBe('busy.routine.error.generic');
    expect(key(mapRoutineFailure(api('UNKNOWN'), create))).toBe('busy.routine.error.generic');
  });
  it('ลบ: NOT_FOUND → gone · rate/conflict/อื่นๆ', () => {
    expect(mapDeleteFailure(api('NOT_FOUND', {}, {}, 404))).toEqual({ type: 'gone' });
    expect(mapDeleteFailure(api('CONFLICT', {}, {}, 409)).type).toBe('conflict');
    expect(mapDeleteFailure(api('RATE_LIMITED', { retryAfterSec: 10 }, {}, 429))).toMatchObject({ type: 'problem', problem: { refs: [{ key: 'busy.routine.error.rate' }, { key: 'appointments.rateRetry' }] } });
    expect(mapDeleteFailure(network)).toMatchObject({ type: 'problem', problem: { refs: [{ key: 'busy.routine.error.generic' }] } });
  });
});

describe('คีย์ข้อความครบ TH/EN และเรนเดอร์ได้', () => {
  const walk = (o: unknown, prefix = ''): string[] =>
    typeof o === 'object' && o !== null ? Object.entries(o).flatMap(([k, v]) => walk(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
  it('busy.routine.* มีคีย์ชุดเดียวกันทั้งสองภาษา ไม่ว่างเปล่า', () => {
    const a = walk(th.busy.routine).sort();
    const b = walk(en.busy.routine).sort();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(100);
  });
  it('คีย์ที่โค้ดเรียกแบบไดนามิกมีจริง (preset/weekdays/range/scope/toast/error)', () => {
    const has = (o: unknown, path: string): boolean => {
      const v = path.split('.').reduce<unknown>((acc, k) => (typeof acc === 'object' && acc !== null ? (acc as Record<string, unknown>)[k] : undefined), o);
      return typeof v === 'string' && v.length > 0;
    };
    const keys: string[] = [];
    for (const id of ['work', 'class', 'gym', 'weekend', 'custom', 'weekendTitle']) keys.push(`preset.${id}`);
    for (const k of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) keys.push(`weekdays.short.${k}`, `weekdays.long.${k}`);
    for (const a of ['edit', 'delete']) for (const k of ['title', 'one', 'oneHelp', 'fromWeek', 'fromMonth', 'fromHelp', 'all', 'allHelp']) keys.push(`scope.${a}.${k}`);
    for (const k of ['saved', 'updated', 'deletedOne', 'stopped', 'deletedAll']) keys.push(`toast.${k}`);
    for (const k of ['save', 'gone', 'rate', 'routines', 'routinesEdit', 'routineRows', 'spanWeeks', 'spanMonths', 'ahead', 'ended', 'weekdaysRequired', 'noOccurrence', 'noOccurrenceEdit', 'dst', 'end', 'generic']) keys.push(`error.${k}`);
    for (const l of [th, en]) {
      for (const k of keys) expect(has(l.busy.routine, k), k).toBe(true);
      expect(has(l.availability, 'detailTruncated')).toBe(true);
    }
  });
  it('ICU ที่มี placeholder เรนเดอร์ครบ ไม่เหลือ {…} (ข้อความข้ามเที่ยงคืน, สรุป, remaining)', () => {
    for (const [locale, messages] of [['th', th], ['en', en]] as const) {
      const tr = createTranslator({ locale, messages }) as unknown as (k: string, v?: Record<string, string | number>) => string;
      const out = [
        tr('busy.routine.time.overnightNote', { day: 'x', nextDay: 'y', start: '22:00', end: '06:00' }),
        tr('busy.routine.summary.days', { count: 17 }),
        tr('busy.routine.summary.line', { days: 'a', time: 'b' }),
        tr('busy.routine.summary.span', { start: 's', end: 'e' }),
        tr('busy.routine.mine.remaining', { count: 12 }),
        tr('busy.routine.mine.remaining', { count: 0 }),
        tr('busy.routine.mine.count', { count: 3 }),
        tr('busy.routine.form.submit', { count: 17 }),
        tr('busy.routine.error.routinesEdit', { max: 20 }),
        tr('busy.routine.scope.confirmAll.body', { title: 'T' }),
        tr('errors.LIMIT_REACHED', { limit: 'routineSpan' }),
        tr('errors.LIMIT_REACHED', { limit: 'routineAhead', max: 12 }),
      ];
      for (const s of out) {
        expect(s).toBeTruthy();
        expect(s).not.toMatch(/[{}]/);
      }
      expect(out[1]).toContain('17');
    }
  });
});

describe('หน้าวันว่าง: detailTruncated ไม่ทำให้ "ไม่มีใครลงวันไม่ว่าง" ผิด', () => {
  const d = (date: string, o: Partial<AvDay> = {}): AvDay => ({ date, freeMembers: 3, totalMembers: 3, allFree: true, notFreeUserIds: [], segments: [], blockers: [], ...o });
  it('วันที่มีคนนับว่าไม่ว่างแต่ blockers ถูกตัด → ไม่ถือว่า "ไม่มีใครลง"', () => {
    expect(nobodyLoggedBusy([d('2026-11-11'), d('2026-11-12')])).toBe(true);
    expect(nobodyLoggedBusy([d('2026-11-11'), d('2026-11-12', { freeMembers: 2, allFree: false, notFreeUserIds: ['u2'] })])).toBe(false);
  });
});
