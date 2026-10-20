// โมเดลฟอร์มลง/แก้ busy (R3): form → payload · ข้ามเที่ยงคืน · ตัวเลือกวัน · error → ตำแหน่ง · ประกาศครั้งแรก
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '@/components/auth/api';
import {
  TIME_OPTIONS,
  buildPayload,
  durationRef,
  formStateOfOwn,
  initialFormState,
  kindChangePatch,
  mapSaveFailure,
  minPickDate,
  pickDate,
  resolveTimedEnd,
  textLength,
  timedMinutes,
  totalDays,
  type BusyFormState,
} from '@/components/busy/form-model';
import { hasSeenNotice, markNoticeSeen, noticeKey, resetNoticeMemory } from '@/components/busy/notice';
import type { OwnBusy } from '@/components/calendar/model';
import { parseLocalDateTime } from '@/lib/calendar';

type Failure = Extract<ApiResult<unknown>, { ok: false }>;
const api = (code: string, values: Record<string, unknown> = {}): Failure =>
  ({ ok: false, kind: 'api', status: 400, error: { code, values } }) as unknown as Failure;
const network = { ok: false, kind: 'network' } as unknown as Failure;
const base = (over: Partial<BusyFormState>): BusyFormState => ({ ...initialFormState('2026-10-20'), ...over });

describe('ตัวเลือกเวลา/วัน', () => {
  it('00:00–23:30 ทีละ 30 นาที = 48 ช่อง', () => {
    expect(TIME_OPTIONS).toHaveLength(48);
    expect(TIME_OPTIONS[0]).toBe('00:00');
    expect(TIME_OPTIONS[47]).toBe('23:30');
  });
  it('วันแรกที่เลือกได้ = วันนี้ − 7', () => {
    expect(minPickDate('2026-10-20')).toBe('2026-10-13');
    expect(minPickDate('2026-01-03')).toBe('2025-12-27');
  });
});

describe('resolveTimedEnd / timedMinutes — ข้ามเที่ยงคืน', () => {
  it('วันเดียว: จบ > เริ่ม = วันเดียวกัน', () => {
    expect(resolveTimedEnd({ pickStart: '2026-10-20', pickEnd: '2026-10-20', startTime: '09:00', endTime: '10:30' })).toEqual({ endDate: '2026-10-20', overnight: false });
  });
  it('วันเดียว: จบ < เริ่ม = วันถัดไป (ข้ามคืน)', () => {
    expect(resolveTimedEnd({ pickStart: '2026-10-31', pickEnd: '2026-10-31', startTime: '22:00', endTime: '06:00' })).toEqual({ endDate: '2026-11-01', overnight: true });
  });
  it('หลายวัน: วันจบ = วันสุดท้ายที่เลือก', () => {
    expect(resolveTimedEnd({ pickStart: '2026-10-20', pickEnd: '2026-10-22', startTime: '22:00', endTime: '06:00' })).toEqual({ endDate: '2026-10-22', overnight: true });
  });
  it('ยังไม่เลือกวัน → null', () => {
    expect(resolveTimedEnd({ pickStart: null, pickEnd: null, startTime: '09:00', endTime: '10:00' })).toBeNull();
  });
  it('ความยาวรวมเป็นนาที', () => {
    expect(timedMinutes(base({ kind: 'timed', startTime: '22:00', endTime: '06:00' }))).toBe(480);
    expect(timedMinutes(base({ kind: 'timed', startTime: '09:00', endTime: '09:00' }))).toBeNull();
  });
  it('durationRef: นาที / ชั่วโมง / ชั่วโมง+นาที', () => {
    expect(durationRef(30)).toEqual({ key: 'busy.duration.min', values: { minutes: 30 } });
    expect(durationRef(120)).toEqual({ key: 'busy.duration.hour', values: { hours: 2 } });
    expect(durationRef(90)).toEqual({ key: 'busy.duration.hourMin', values: { hours: 1, minutes: 30 } });
  });
});

describe('pickDate — แตะเลือกวัน', () => {
  const none = { start: null, end: null, pending: false };
  it('single: วันเดียว เสร็จทันที', () => {
    expect(pickDate('single', none, '2026-10-21')).toEqual({ start: '2026-10-21', end: '2026-10-21', pending: false, done: true });
  });
  it('range: แตะแรก = เริ่ม (รอ) · แตะวันหลัง = จบ · แตะวันเดิม = วันเดียว', () => {
    const first = pickDate('range', none, '2026-10-21');
    expect(first).toMatchObject({ start: '2026-10-21', pending: true, done: false });
    expect(pickDate('range', first, '2026-10-24')).toEqual({ start: '2026-10-21', end: '2026-10-24', pending: false, done: true });
    expect(pickDate('range', first, '2026-10-21')).toMatchObject({ end: '2026-10-21', done: true });
  });
  it('range: แตะวันก่อนวันเริ่ม = เริ่มใหม่', () => {
    const first = pickDate('range', none, '2026-10-21');
    expect(pickDate('range', first, '2026-10-19')).toMatchObject({ start: '2026-10-19', pending: true, done: false });
  });
  it('totalDays', () => {
    expect(totalDays({ pickStart: '2026-10-29', pickEnd: '2026-10-31' })).toBe(3);
    expect(totalDays({ pickStart: null, pickEnd: null })).toBeNull();
  });
});

describe('buildPayload — form → payload', () => {
  it('ทั้งวัน → all_day วันเดียว ไม่ส่ง tz ตอนสร้าง', () => {
    const r = buildPayload(base({ title: '  ไปเที่ยว  ' }));
    expect(r).toEqual({ ok: true, payload: { kind: 'all_day', startDate: '2026-10-20', endDate: '2026-10-20', title: 'ไปเที่ยว', note: null, hideDetail: false } });
  });
  it('หลายวัน → all_day ช่วง · ตอนแก้ส่ง tz เดิมของรายการ', () => {
    const r = buildPayload(base({ kind: 'multi', pickEnd: '2026-10-23', hideDetail: true, note: 'โน้ต' }), { tz: 'Asia/Bangkok' });
    expect(r).toEqual({ ok: true, payload: { kind: 'all_day', startDate: '2026-10-20', endDate: '2026-10-23', tz: 'Asia/Bangkok', title: null, note: 'โน้ต', hideDetail: true } });
  });
  it('ช่วงเวลาข้ามคืน → วันจบเป็นวันถัดไป', () => {
    const r = buildPayload(base({ kind: 'timed', startTime: '22:00', endTime: '06:00' }));
    expect(r.ok && r.payload).toMatchObject({ kind: 'timed', startDate: '2026-10-20', startTime: '22:00', endDate: '2026-10-21', endTime: '06:00' });
  });
  it('เวลาจบ = เริ่ม ในวันเดียว → INVALID_RANGE ใต้แถวเวลา', () => {
    const r = buildPayload(base({ kind: 'timed', startTime: '09:00', endTime: '09:00' }));
    expect(r).toEqual({ ok: false, problem: { pos: 'time', ref: { key: 'errors.INVALID_RANGE', values: { kind: 'time' } } } });
  });
  it('ยังไม่เลือกวัน → ข้อความใต้ปุ่มวัน', () => {
    const r = buildPayload(base({ pickStart: null, pickEnd: null }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem.pos).toBe('date');
  });
  it('หลายวันที่วันจบก่อนวันเริ่ม → INVALID_RANGE kind=dates', () => {
    const r = buildPayload(base({ kind: 'multi', pickStart: '2026-10-22', pickEnd: '2026-10-20' }));
    expect(!r.ok && r.problem).toEqual({ pos: 'date', ref: { key: 'errors.INVALID_RANGE', values: { kind: 'dates' } } });
  });
  it('นับตัวอักษรเป็น code point หลัง trim', () => {
    expect(textLength('  สวัสดี ')).toBe(6);
    expect(textLength('😀😀')).toBe(2);
  });
});

describe('formStateOfOwn', () => {
  const own = (over: Partial<OwnBusy>): OwnBusy => ({
    id: 'x', allDay: true, startAt: 0, endAt: 0, localStartDate: '2026-10-29', localEndDate: '2026-10-31', tz: 'Asia/Bangkok', title: 'เชียงใหม่', note: 'ส่วนตัว', hidden: true, ...over,
  });
  it('ทั้งวันหลายวัน → multi + ค่าเดิม', () => {
    expect(formStateOfOwn(own({}))).toMatchObject({ kind: 'multi', pickStart: '2026-10-29', pickEnd: '2026-10-31', title: 'เชียงใหม่', note: 'ส่วนตัว', hideDetail: true });
    expect(formStateOfOwn(own({ localEndDate: '2026-10-29' })).kind).toBe('allDay');
  });
  it('timed → อ่านวัน/เวลาใน tz ของรายการ', () => {
    const s = formStateOfOwn(own({ allDay: false, startAt: parseLocalDateTime('2026-10-23', '20:00', 'Asia/Bangkok'), endAt: parseLocalDateTime('2026-10-24', '02:00', 'Asia/Bangkok'), title: null, note: null, hidden: false }));
    expect(s).toMatchObject({ kind: 'timed', pickStart: '2026-10-23', pickEnd: '2026-10-24', startTime: '20:00', endTime: '02:00', title: '', hideDetail: false });
  });
});

describe('mapSaveFailure — error → ตำแหน่ง (UX 7.5)', () => {
  const pos = (f: Failure, k: 'allDay' | 'timed' | 'multi' = 'timed') => {
    const r = mapSaveFailure(f, k);
    return r.type === 'problem' ? r.problem.pos : r.type;
  };
  it('INVALID_RANGE: timed → time · วัน → date', () => {
    expect(pos(api('INVALID_RANGE'), 'timed')).toBe('time');
    expect(pos(api('INVALID_RANGE'), 'multi')).toBe('date');
    expect(mapSaveFailure(api('INVALID_RANGE'), 'multi')).toMatchObject({ invalidDate: true, invalidTime: false });
  });
  it('เวลา: TIME_NOT_ON_STEP / INVALID_LOCAL_TIME → time', () => {
    expect(pos(api('TIME_NOT_ON_STEP'))).toBe('time');
    expect(pos(api('INVALID_LOCAL_TIME'))).toBe('time');
  });
  it('วัน: INVALID_DATE / DATE_OUT_OF_RANGE / busyBackdate → date', () => {
    expect(pos(api('INVALID_DATE'))).toBe('date');
    expect(pos(api('DATE_OUT_OF_RANGE'))).toBe('date');
    expect(pos(api('LIMIT_REACHED', { limit: 'busyBackdate', max: 7 }))).toBe('date');
  });
  it('เพดานจำนวน/ช่วง → banner พร้อม limit และ max', () => {
    const r = mapSaveFailure(api('LIMIT_REACHED', { limit: 'busyCount', max: 300 }), 'allDay');
    expect(r).toMatchObject({ type: 'problem', problem: { pos: 'banner', ref: { key: 'errors.LIMIT_REACHED', values: { limit: 'busyCount', max: 300 } } } });
    expect(pos(api('LIMIT_REACHED', { limit: 'busySpan', max: 366 }))).toBe('banner');
  });
  it('NOT_FOUND → gone · VALIDATION → banner · เครือข่าย/อื่นๆ → ข้อความบันทึกไม่สำเร็จ', () => {
    expect(mapSaveFailure(api('NOT_FOUND'), 'allDay')).toEqual({ type: 'gone' });
    expect(mapSaveFailure(api('VALIDATION'), 'allDay')).toMatchObject({ problem: { ref: { key: 'errors.VALIDATION' } } });
    expect(mapSaveFailure(network, 'allDay')).toMatchObject({ problem: { pos: 'banner', ref: { key: 'busy.form.error.save' } } });
    expect(mapSaveFailure(api('WHATEVER'), 'allDay')).toMatchObject({ problem: { pos: 'banner', ref: { key: 'busy.form.error.save' } } });
  });
});

describe('notice — "เห็นแล้ว" ต่อผู้ใช้ ใน localStorage (try/catch)', () => {
  afterEach(() => {
    resetNoticeMemory();
    vi.unstubAllGlobals();
  });
  const stubWindow = (storage: unknown) =>
    vi.stubGlobal('window', { localStorage: storage, addEventListener: () => {}, removeEventListener: () => {} });

  it('เขียนแล้วอ่านกลับได้ แยกตามผู้ใช้', () => {
    const data = new Map<string, string>();
    stubWindow({ getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    expect(hasSeenNotice('u1')).toBe(false);
    markNoticeSeen('u1');
    expect(data.get(noticeKey('u1'))).toBe('1');
    resetNoticeMemory();
    expect(hasSeenNotice('u1')).toBe(true);
    expect(hasSeenNotice('u2')).toBe(false);
  });
  it('storage ใช้ไม่ได้ (throw) → ไม่พัง จำในหน่วยความจำ', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    stubWindow({ getItem: boom, setItem: boom });
    expect(hasSeenNotice('u1')).toBe(false);
    expect(() => markNoticeSeen('u1')).not.toThrow();
    expect(hasSeenNotice('u1')).toBe(true);
  });
});

describe('kindChangePatch — เปลี่ยนแบบฟอร์มไม่พ่วงช่วงหลายวัน', () => {
  const range = { pickStart: '2026-10-20', pickEnd: '2026-12-31' };
  it('หลายวัน → ช่วงเวลา: วันจบ = วันเริ่ม (ไม่เกิด busy 769 ชม.)', () => {
    const next = { ...initialFormState('2026-10-20'), ...range, ...kindChangePatch(range, 'timed') };
    expect(next.kind).toBe('timed');
    expect(next.pickEnd).toBe('2026-10-20');
    expect(timedMinutes(next)).toBe(60);
  });
  it('หลายวัน → ทั้งวัน: วันจบ = วันเริ่ม', () => {
    expect(kindChangePatch(range, 'allDay')).toEqual({ kind: 'allDay', pickEnd: '2026-10-20' });
  });
  it('→ หลายวัน: คงช่วงเดิม · ยังไม่เลือกวัน: เปลี่ยนแค่ kind', () => {
    expect(kindChangePatch(range, 'multi')).toEqual({ kind: 'multi' });
    expect(kindChangePatch({ pickStart: null, pickEnd: null }, 'timed')).toEqual({ kind: 'timed' });
  });
});
