// R6F (ฝั่ง UI) — ลง busy หลายวัน "เฉพาะช่วงเวลา": เลือก payload · สรุปก่อนบันทึก (expandDailyBusyInput) · แมป error · popup ลงซ้ำกับ daily
import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@/components/auth/api';
import { buildPayload, dailySummary, formStateOfOwn, initialFormState, kindChangePatch, mapDailySaveFailure, type BusyFormState } from '@/components/busy/form-model';
import { candidatesOf, findOverlapsAny, hullOf, listQueryFor } from '@/components/busy/overlap-model';
import type { OwnBusy } from '@/components/calendar/model';
import { expandDailyBusyInput, normalizeBusyInput } from '@/lib/calendar';
import en from '../../messages/en.json';
import th from '../../messages/th.json';

type Failure = Extract<ApiResult<unknown>, { ok: false }>;
const api = (code: string, values: Record<string, unknown> = {}, status = 400): Failure =>
  ({ ok: false, kind: 'api', status, error: { code, values } }) as unknown as Failure;
const network = { ok: false, kind: 'network' } as unknown as Failure;
const multi = (over: Partial<BusyFormState> = {}): BusyFormState => ({
  ...initialFormState('2026-11-03'),
  kind: 'multi',
  pickStart: '2026-11-03',
  pickEnd: '2026-11-30',
  startTime: '17:00',
  endTime: '20:00',
  ...over,
});

describe('R6F payload', () => {
  it('หลายวัน + เฉพาะช่วงเวลา → kind daily พร้อมเวลา', () => {
    const r = buildPayload(multi({ scope: 'daily', title: 'เรียน' }));
    expect(r).toEqual({ ok: true, payload: { kind: 'daily', startDate: '2026-11-03', endDate: '2026-11-30', startTime: '17:00', endTime: '20:00', title: 'เรียน', note: null, hideDetail: false } });
  });
  it('หลายวัน + ทั้งวัน (ค่าเริ่มต้น) → all_day เหมือนเดิม (R6F-1)', () => {
    expect(initialFormState('2026-11-03').scope).toBe('allDay');
    const r = buildPayload(multi({ scope: 'allDay' }));
    expect(r).toMatchObject({ ok: true, payload: { kind: 'all_day', startDate: '2026-11-03', endDate: '2026-11-30' } });
    expect(r.ok && 'startTime' in r.payload).toBe(false);
  });
  it('scope ไม่มีผลกับ ทั้งวัน/ช่วงเวลา (ไม่ส่ง daily)', () => {
    expect(buildPayload({ ...multi({ scope: 'daily' }), kind: 'allDay' })).toMatchObject({ payload: { kind: 'all_day' } });
    expect(buildPayload({ ...multi({ scope: 'daily' }), kind: 'timed', pickEnd: '2026-11-03' })).toMatchObject({ payload: { kind: 'timed' } });
  });
  it('daily เวลาจบ ≤ เริ่ม → error ใต้แถวเวลา (daily.end) ไม่ส่งข้ามเที่ยงคืน', () => {
    for (const endTime of ['17:00', '09:00']) {
      expect(buildPayload(multi({ scope: 'daily', endTime }))).toEqual({ ok: false, problem: { pos: 'time', ref: { key: 'busy.form.error.daily.end', values: {} } } });
    }
  });
  it('daily ยังเลือกวันไม่ครบ → ปัญหาที่วัน · แก้รายการ: ส่ง tz เดิม', () => {
    expect(buildPayload(multi({ scope: 'daily', pickStart: null, pickEnd: null }))).toMatchObject({ ok: false, problem: { pos: 'date' } });
    expect(buildPayload(multi({ scope: 'daily' }), { tz: 'Asia/Bangkok' })).toMatchObject({ payload: { tz: 'Asia/Bangkok' } });
  });
  it('kindChangePatch ไม่แตะ scope · formStateOfOwn ตั้ง scope ทั้งวัน', () => {
    expect(kindChangePatch({ pickStart: '2026-11-03', pickEnd: '2026-11-05' }, 'multi')).toEqual({ kind: 'multi' });
    const n = normalizeBusyInput({ kind: 'all_day', startDate: '2026-11-03', endDate: '2026-11-05' });
    if (!n.ok) throw new Error('bad fixture');
    const own: OwnBusy = { id: 'a', title: null, note: null, hidden: false, seriesId: 's1', ...n.value };
    expect(formStateOfOwn(own)).toMatchObject({ kind: 'multi', scope: 'allDay' });
  });
});

describe('R6F สรุปก่อนบันทึก (นับจาก expandDailyBusyInput)', () => {
  it('3–30 พ.ย. 17:00–20:00 = 28 วัน (R6F-2 ฝั่ง UI)', () => {
    expect(dailySummary(multi({ scope: 'daily' }))).toEqual({ count: 28, start: '17:00', end: '20:00' });
  });
  it('จำนวนวัน = จำนวนแถวที่ expandDailyBusyInput ให้ (ตัวเดียวกับเซิร์ฟเวอร์)', () => {
    const r = expandDailyBusyInput({ kind: 'daily', startDate: '2026-11-03', endDate: '2026-11-30', startTime: '17:00', endTime: '20:00' });
    expect(r.ok && r.value.length).toBe(28);
  });
  it('วันเดียว = 1 วัน', () => {
    expect(dailySummary(multi({ scope: 'daily', pickEnd: '2026-11-03' }))?.count).toBe(1);
  });
  it('ไม่ใช่ daily / เวลาจบ ≤ เริ่ม / เกิน 62 วัน / ยังไม่เลือก → null (ไม่แสดงสรุป)', () => {
    expect(dailySummary(multi({ scope: 'allDay' }))).toBeNull();
    expect(dailySummary(multi({ scope: 'daily', endTime: '17:00' }))).toBeNull();
    expect(dailySummary(multi({ scope: 'daily', pickEnd: '2027-03-01' }))).toBeNull();
    expect(dailySummary(multi({ scope: 'daily', pickStart: null }))).toBeNull();
    expect(dailySummary({ ...multi({ scope: 'daily' }), kind: 'timed' })).toBeNull();
  });
  it('62 วันพอดีได้ · 63 วันไม่ได้', () => {
    expect(dailySummary(multi({ scope: 'daily', pickEnd: '2027-01-03' }))?.count).toBe(62);
    expect(dailySummary(multi({ scope: 'daily', pickEnd: '2027-01-04' }))).toBeNull();
  });
});

describe('R6F แมป error (R6F-4 ฝั่ง UI)', () => {
  const ref = (f: ReturnType<typeof mapDailySaveFailure>) => (f.type === 'problem' ? { pos: f.problem.pos, key: f.problem.ref.key, values: f.problem.ref.values, d: f.invalidDate, t: f.invalidTime } : null);
  it('เพดานจำนวน/ช่วง/ย้อนหลัง', () => {
    expect(ref(mapDailySaveFailure(api('LIMIT_REACHED', { limit: 'busyCount', max: 300 })))).toMatchObject({ pos: 'banner', key: 'busy.form.error.daily.count', values: { max: 300 } });
    expect(ref(mapDailySaveFailure(api('LIMIT_REACHED', { limit: 'busySpan', max: 62 })))).toMatchObject({ pos: 'banner', key: 'busy.form.error.daily.span', values: { max: 62 } });
    expect(ref(mapDailySaveFailure(api('LIMIT_REACHED', { limit: 'busyBackdate', max: 7 })))).toMatchObject({ pos: 'date', key: 'busy.form.error.daily.backdate', values: { max: 7 }, d: true });
  });
  it('INVALID_RANGE kind=time → daily.end ใต้เวลา · kind=dates → ข้อความช่วงวันเดิม', () => {
    expect(ref(mapDailySaveFailure(api('INVALID_RANGE', { kind: 'time' })))).toMatchObject({ pos: 'time', key: 'busy.form.error.daily.end', t: true });
    expect(ref(mapDailySaveFailure(api('INVALID_RANGE', { kind: 'dates' })))).toMatchObject({ pos: 'date', key: 'errors.INVALID_RANGE', d: true });
  });
  it('429 → daily.rate · เครือข่าย/อื่นๆ → daily.generic', () => {
    expect(ref(mapDailySaveFailure(api('RATE_LIMITED', {}, 429)))).toMatchObject({ pos: 'banner', key: 'busy.form.error.daily.rate' });
    expect(ref(mapDailySaveFailure(network))).toMatchObject({ pos: 'banner', key: 'busy.form.error.daily.generic' });
    expect(ref(mapDailySaveFailure(api('CONFLICT', {}, 409)))).toMatchObject({ key: 'busy.form.error.daily.generic' });
    expect(ref(mapDailySaveFailure(api('LIMIT_REACHED', { limit: 'other' })))).toMatchObject({ key: 'busy.form.error.daily.generic' });
  });
  it('รหัสทั่วไป: เวลา/วัน/VALIDATION ใช้ errors.* เดิม', () => {
    expect(ref(mapDailySaveFailure(api('TIME_NOT_ON_STEP')))).toMatchObject({ pos: 'time', key: 'errors.TIME_NOT_ON_STEP' });
    expect(ref(mapDailySaveFailure(api('INVALID_DATE')))).toMatchObject({ pos: 'date', key: 'errors.INVALID_DATE' });
    expect(ref(mapDailySaveFailure(api('VALIDATION')))).toMatchObject({ key: 'errors.VALIDATION' });
  });
  it('ทุกคีย์ที่แมปมีใน th/en', () => {
    const has = (o: unknown, path: string) => path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], o) !== undefined;
    for (const k of ['count', 'span', 'end', 'backdate', 'rate', 'generic']) {
      expect(has(en, `busy.form.error.daily.${k}`), k).toBe(true);
      expect(has(th, `busy.form.error.daily.${k}`), k).toBe(true);
    }
    for (const k of ['tag', 'detailPlain', 'deleteBody', 'deleteTitle', 'deleteOne', 'deleteOneHelp', 'deleteAll', 'deleteAllHelp', 'confirmAllTitle', 'confirmAllBody', 'confirmAll', 'cancel', 'tagAria']) {
      expect(has(en, `busy.series.${k}`), k).toBe(true);
      expect(has(th, `busy.series.${k}`), k).toBe(true);
    }
    for (const k of ['savedDaily', 'deletedDay', 'deletedSeries', 'deletedSeriesCount']) {
      expect(has(en, `busy.toast.${k}`), k).toBe(true);
      expect(has(th, `busy.toast.${k}`), k).toBe(true);
    }
  });
});

describe('R6F popup ลงซ้ำกับ daily (E11)', () => {
  const own = (id: string, p: Parameters<typeof normalizeBusyInput>[0]): OwnBusy => {
    const r = normalizeBusyInput(p);
    if (!r.ok) throw new Error('bad fixture');
    return { id, title: null, note: null, hidden: false, ...r.value };
  };
  const dailyPayload = { kind: 'daily' as const, startDate: '2026-11-03', endDate: '2026-11-30', startTime: '17:00', endTime: '20:00' };

  it('ขยายเป็นรายวัน (28) แต่ละวัน 17:00–20:00', () => {
    const c = candidatesOf(dailyPayload)!;
    expect(c).toHaveLength(28);
    expect(c[0]!.localStartDate).toBe('2026-11-03');
    expect(c[27]!.localStartDate).toBe('2026-11-30');
    expect(c.every((x) => !x.allDay)).toBe(true);
  });
  it('ทับเฉพาะวันที่ช่วงเวลาชนกัน · ไม่นับซ้ำ · ชนขอบไม่ทับ', () => {
    const c = candidatesOf(dailyPayload)!;
    const existing = [
      own('hit1', { kind: 'timed', startDate: '2026-11-05', startTime: '19:00', endDate: '2026-11-05', endTime: '21:00' }),
      own('edge', { kind: 'timed', startDate: '2026-11-06', startTime: '20:00', endDate: '2026-11-06', endTime: '22:00' }),
      own('morning', { kind: 'timed', startDate: '2026-11-07', startTime: '08:00', endDate: '2026-11-07', endTime: '12:00' }),
      own('allday', { kind: 'all_day', startDate: '2026-11-09', endDate: '2026-11-10' }),
      own('outside', { kind: 'timed', startDate: '2026-12-02', startTime: '18:00', endDate: '2026-12-02', endTime: '19:00' }),
    ];
    expect(findOverlapsAny(c, existing, null).map((b) => b.id)).toEqual(['hit1', 'allday']);
    // ช่วงข้ามหลายวันที่ครอบหลายรายการ ไม่ซ้ำ
    const long = own('long', { kind: 'timed', startDate: '2026-11-11', startTime: '10:00', endDate: '2026-11-14', endTime: '10:00' });
    expect(findOverlapsAny(c, [long], null).map((b) => b.id)).toEqual(['long']);
  });
  it('ไม่มีอะไรทับ → ว่าง · แก้รายการตัวเองไม่นับตัวเอง', () => {
    const c = candidatesOf(dailyPayload)!;
    const mine = own('me', { kind: 'timed', startDate: '2026-11-05', startTime: '18:00', endDate: '2026-11-05', endTime: '19:00' });
    expect(findOverlapsAny(c, [mine], 'me')).toEqual([]);
    expect(findOverlapsAny(c, [], null)).toEqual([]);
  });
  it('query ของการเช็ก = ช่วงวันรวม (≤ เพดานช่วงอ่าน)', () => {
    expect(listQueryFor(hullOf(candidatesOf(dailyPayload)!))).toBe('?from=2026-11-03&to=2026-11-30');
  });
  it('payload เดิม (all_day/timed) ยังได้ 1 รายการ · daily ที่แปลงไม่ได้ = null', () => {
    expect(candidatesOf({ kind: 'all_day', startDate: '2026-11-03', endDate: '2026-11-05' })).toHaveLength(1);
    expect(candidatesOf({ ...dailyPayload, endTime: '17:00' })).toBeNull();
    expect(candidatesOf({ kind: 'daily', startDate: '2026-11-03', endDate: '2026-11-05' })).toBeNull();
  });
});
