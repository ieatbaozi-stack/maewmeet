// R15a (ฝั่ง UI) — โมเดล "เว้นบางวัน": ชุดวัน/ตารางเดือน/เลือกหลายวัน/เพดาน 31/คำขอ/แมป error · คีย์ข้อความ TH/EN ครบ
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { FullResult } from '@/components/appointments/api';
import { doneRef, type RoutineView } from '@/components/busy/routine-model';
import {
  SKIP_MAX_DAYS,
  ariaState,
  atLimit,
  buildSkipMonth,
  canSkip,
  dayState,
  doneCount,
  initialMode,
  initialMonth,
  isInteractive,
  mapSkipFailure,
  poolMonths,
  shiftMonth,
  skipPool,
  skipRequest,
  skippedUpcoming,
  togglePick,
} from '@/components/busy/skip-model';
import en from '../../messages/en.json';
import th from '../../messages/th.json';

const TODAY = '2026-11-18'; // พุธ

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
  startDate: '2026-11-16',
  endDate: '2026-12-13',
  tz: 'Asia/Bangkok',
  remaining: 18,
  skippedDates: [],
  ...over,
});

type Failure = Extract<FullResult<unknown>, { ok: false }>;
const api = (code: string, values: Record<string, string | number> = {}, status = 400): Failure =>
  ({ ok: false, kind: 'api', status, error: { code, key: `errors.${code}`, values }, fields: {} }) as unknown as Failure;
const network = { ok: false, kind: 'network' } as unknown as Failure;

describe('ชุดวันของชุด (skipPool)', () => {
  it('เฉพาะวันที่ตรงวันในสัปดาห์และ ≥ วันนี้ (วันนี้นับว่ายังไม่ผ่าน)', () => {
    const p = skipPool(routine(), TODAY);
    expect(p.days[0]).toBe('2026-11-18');
    expect(p.days).not.toContain('2026-11-21'); // เสาร์
    expect(p.days).not.toContain('2026-11-17'); // ผ่านแล้ว
    expect(p.days.at(-1)).toBe('2026-12-11'); // ศุกร์สุดท้ายก่อนสิ้นสุด 13 ธ.ค.
    expect(p.available).toEqual(p.days);
    expect(p.skipped).toEqual([]);
  });
  it('ชุดที่ยังไม่เริ่ม: เริ่มที่วันเริ่มของชุด ไม่ใช่วันนี้', () => {
    const p = skipPool(routine({ startDate: '2026-11-30', endDate: '2026-12-13' }), TODAY);
    expect(p.days[0]).toBe('2026-11-30');
  });
  it('วันที่เว้นไว้: แยกออกจาก available · วันเว้นที่กฎปัจจุบันไม่มีแล้ว (เสาร์ที่แยกแก้) ยังอยู่ในชุดให้คืนได้', () => {
    const p = skipPool(routine({ skippedDates: ['2026-11-24', '2026-11-21', '2026-11-10'] }), TODAY);
    expect(p.skipped).toEqual(['2026-11-21', '2026-11-24']); // 10 พ.ย. ผ่านแล้ว ตัดทิ้ง
    expect(p.days).toContain('2026-11-21');
    expect(p.available).not.toContain('2026-11-24');
    expect(p.available).not.toContain('2026-11-21');
  });
  it('ชุดจบแล้ว: ไม่มีวัน · ไม่มีปุ่ม ยกเว้นยังมีวันเว้นค้าง', () => {
    const done = routine({ startDate: '2026-10-05', endDate: '2026-11-08' });
    expect(skipPool(done, TODAY).days).toEqual([]);
    expect(canSkip(done, TODAY)).toBe(false);
    expect(canSkip(routine(), TODAY)).toBe(true);
    expect(canSkip({ endDate: '2026-11-08', skippedDates: ['2026-11-20'] }, TODAY)).toBe(true);
  });
  it('ชิป: นับเฉพาะวันเว้นที่ยังไม่ผ่าน ไม่ซ้ำ', () => {
    expect(skippedUpcoming({ skippedDates: ['2026-11-24', '2026-11-24', '2026-11-01'] }, TODAY)).toBe(1);
    expect(skippedUpcoming({ skippedDates: [] }, TODAY)).toBe(0);
  });
  it('โหมดตั้งต้น: เว้นวัน · เหลือวันเว้นได้ 0 แต่มีวันเว้นไว้ → แท็บเอากลับ', () => {
    expect(initialMode(skipPool(routine(), TODAY))).toBe('skip');
    const all = skipPool(routine({ skippedDates: skipPool(routine(), TODAY).days }), TODAY);
    expect(all.available).toEqual([]);
    expect(initialMode(all)).toBe('restore');
    expect(initialMode(skipPool(routine({ startDate: '2026-10-05', endDate: '2026-11-08' }), TODAY))).toBe('skip');
  });
});

describe('ตารางเดือน', () => {
  const pool = skipPool(routine(), TODAY);
  it('เดือนของชุด: พ.ย. และ ธ.ค. · ปุ่ม ‹ › หยุดที่ขอบ', () => {
    const months = poolMonths(pool.days);
    expect(months).toEqual(['2026-11', '2026-12']);
    expect(shiftMonth(months, '2026-11', -1)).toBeNull();
    expect(shiftMonth(months, '2026-11', 1)).toBe('2026-12');
    expect(shiftMonth(months, '2026-12', 1)).toBeNull();
    expect(initialMonth(pool, 'skip')).toBe('2026-11');
  });
  it('เริ่มที่สัปดาห์แรกที่ยังมีวันของชุด (จันทร์ 16) — วันที่ผ่านแล้วในสัปดาห์นั้นเป็น off · เสาร์/อาทิตย์เป็น off', () => {
    const cells = buildSkipMonth('2026-11', pool);
    expect(cells[0]).toMatchObject({ type: 'off', date: '2026-11-16' });
    expect(cells[1]).toMatchObject({ type: 'off', date: '2026-11-17' });
    expect(cells[2]).toMatchObject({ type: 'day', date: '2026-11-18', skipped: false });
    expect(cells).toHaveLength(15); // 16–30 พ.ย.
    expect(cells.filter((c) => c.type === 'blank')).toEqual([]);
    expect(cells.find((c) => c.type !== 'blank' && c.date === '2026-11-21')).toMatchObject({ type: 'off' });
  });
  it('เดือนถัดไปเริ่มกลางสัปดาห์: ช่องว่างนำหน้า = วันก่อนวันที่ 1 (1 ธ.ค. 2026 = อังคาร → 1 ช่องว่าง)', () => {
    const cells = buildSkipMonth('2026-12', pool);
    expect(cells.filter((c) => c.type === 'blank')).toHaveLength(1);
    expect(cells[1]).toMatchObject({ type: 'day', date: '2026-12-01' });
    expect(cells.at(-1)).toMatchObject({ date: '2026-12-31' });
    expect(cells.find((c) => c.type !== 'blank' && c.date === '2026-12-14')).toMatchObject({ type: 'off' }); // หลังสิ้นสุดชุด
  });
  it('วันที่เว้นไว้แล้วทำเครื่องหมาย skipped', () => {
    const p = skipPool(routine({ skippedDates: ['2026-11-24'] }), TODAY);
    expect(buildSkipMonth('2026-11', p).find((c) => c.type === 'day' && c.date === '2026-11-24')).toMatchObject({ skipped: true });
  });
  it('เดือนที่ไม่มีวัน → ตารางว่าง', () => {
    expect(buildSkipMonth('2027-03', pool)).toEqual([]);
  });
});

describe('เลือกหลายวัน + เพดาน 31', () => {
  it('สลับเลือก/เลิกเลือก · เรียงจากน้อยเสมอ · เลือกข้ามเดือนได้', () => {
    let p: string[] = [];
    p = togglePick(p, '2026-12-02');
    p = togglePick(p, '2026-11-18');
    p = togglePick(p, '2026-11-19');
    expect(p).toEqual(['2026-11-18', '2026-11-19', '2026-12-02']);
    expect(togglePick(p, '2026-11-19')).toEqual(['2026-11-18', '2026-12-02']);
  });
  it('ครบ 31 แล้วเลือกเพิ่มไม่ได้ (ค่าเดิม) แต่เลิกเลือกได้', () => {
    const days = Array.from({ length: SKIP_MAX_DAYS }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
    expect(SKIP_MAX_DAYS).toBe(31);
    expect(atLimit(days)).toBe(true);
    expect(togglePick(days, '2027-01-04')).toEqual(days);
    expect(togglePick(days, '2026-12-05')).toHaveLength(30);
    expect(atLimit(days.slice(1))).toBe(false);
  });
  it('สถานะช่อง โหมดเว้น: เว้นไว้แล้วกดไม่ได้ · เลือกแล้ว · ชนเพดาน = locked ยกเว้นที่เลือกไว้', () => {
    const open = { skipped: false, date: '2026-11-18' };
    expect(dayState('skip', open, [])).toBe('plain');
    expect(dayState('skip', open, ['2026-11-18'])).toBe('picked');
    expect(dayState('skip', { skipped: true, date: '2026-11-24' }, [])).toBe('skipped');
    const full = Array.from({ length: 31 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
    expect(dayState('skip', open, full)).toBe('locked');
    expect(dayState('skip', { skipped: false, date: '2026-12-02' }, full)).toBe('picked');
    expect(isInteractive('skipped')).toBe(false);
    expect(isInteractive('locked')).toBe(false);
    expect(isInteractive('plain')).toBe(true);
  });
  it('สถานะช่อง โหมดเอากลับ: เฉพาะวันเว้นไว้กดได้ · วันอื่นล็อก', () => {
    expect(dayState('restore', { skipped: true, date: '2026-11-24' }, [])).toBe('restorable');
    expect(dayState('restore', { skipped: true, date: '2026-11-24' }, ['2026-11-24'])).toBe('restorePicked');
    expect(dayState('restore', { skipped: false, date: '2026-11-18' }, [])).toBe('locked');
  });
  it('ข้อความช่องสำหรับ screen reader: on / skipped / off', () => {
    expect(ariaState('picked')).toBe('on');
    expect(ariaState('restorePicked')).toBe('on');
    expect(ariaState('skipped')).toBe('skipped');
    expect(ariaState('restorable')).toBe('skipped');
    expect(ariaState('plain')).toBe('off');
    expect(ariaState('locked')).toBe('off');
  });
});

describe('คำขอ + ผล', () => {
  it('เว้น = add · เอากลับ = remove · เรียงวัน · path ผูก id', () => {
    expect(skipRequest('r1', 'skip', ['2026-11-27', '2026-11-18'])).toEqual({ path: '/api/me/busy-routines/r1/skips', body: { add: ['2026-11-18', '2026-11-27'] } });
    expect(skipRequest('r1', 'restore', ['2026-11-24'])).toEqual({ path: '/api/me/busy-routines/r1/skips', body: { remove: ['2026-11-24'] } });
  });
  it('จำนวนใน toast: ค่าจริงของเซิร์ฟเวอร์ · 0 (เว้นซ้ำ) → จำนวนที่เลือก', () => {
    expect(doneCount('skip', { skipped: 2, restored: 0 }, 3)).toBe(2);
    expect(doneCount('restore', { skipped: 0, restored: 1 }, 1)).toBe(1);
    expect(doneCount('skip', { skipped: 0 }, 3)).toBe(3);
    expect(doneCount('skip', undefined, 2)).toBe(2);
  });
  it('toast สำเร็จ: คีย์ + จำนวน', () => {
    expect(doneRef({ type: 'skipped', count: 2 }, 'th')).toEqual({ key: 'busy.routine.skip.toast.skipped', values: { count: 2 } });
    expect(doneRef({ type: 'restored', count: 1 }, 'en')).toEqual({ key: 'busy.routine.skip.toast.restored', values: { count: 1 } });
  });
});

describe('แมป error ทุกรูป (§3.3)', () => {
  it('เครือข่าย/ไม่รู้จัก/CONFLICT/FORBIDDEN = generic', () => {
    for (const f of [network, api('INTERNAL'), api('CONFLICT', {}, 409), api('FORBIDDEN', {}, 403)]) {
      expect(mapSkipFailure(f)).toEqual({ type: 'error', refs: [{ key: 'busy.routine.skip.error.generic', values: {} }] });
    }
  });
  it('NOT_FOUND = ชุดหาย (gone)', () => {
    expect(mapSkipFailure(api('NOT_FOUND', {}, 404))).toEqual({ type: 'gone' });
  });
  it('VALIDATION (วันผ่านแล้ว/ไม่อยู่ในชุด/นอกช่วง) = stale', () => {
    expect(mapSkipFailure(api('VALIDATION'))).toEqual({ type: 'error', refs: [{ key: 'busy.routine.skip.error.stale', values: {} }] });
  });
  it('RATE_LIMITED = skip.error.rate (ไม่ใช้ข้อความเดิมของแบบประจำ)', () => {
    expect(mapSkipFailure(api('RATE_LIMITED', { retryAfterSec: 30 }, 429))).toEqual({ type: 'error', refs: [{ key: 'busy.routine.skip.error.rate', values: {} }] });
  });
  it('LIMIT_REACHED: skipDays → errors.LIMIT_REACHED {limit,max} · routineRows → ข้อความแถวรวม', () => {
    expect(mapSkipFailure(api('LIMIT_REACHED', { limit: 'skipDays', max: 31 }))).toEqual({ type: 'error', refs: [{ key: 'errors.LIMIT_REACHED', values: { limit: 'skipDays', max: 31 } }] });
    expect(mapSkipFailure(api('LIMIT_REACHED', { limit: 'routineRows', max: 1500 }, 409))).toEqual({ type: 'error', refs: [{ key: 'busy.routine.skip.error.rows', values: { max: 1500 } }] });
  });
});

describe('คีย์ข้อความ', () => {
  const T = (locale: 'th' | 'en') => createTranslator({ locale, messages: locale === 'th' ? th : en } as never) as unknown as (k: string, v?: Record<string, unknown>) => string;
  it('ข้อความ skip.* ครบ ทั้ง TH/EN · plural จำนวนวัน · skipDays มีใน LIMIT_REACHED', () => {
    for (const l of ['th', 'en'] as const) {
      const t = T(l);
      expect(t('busy.routine.skip.confirm', { count: 2 })).toMatch(/2/);
      expect(t('busy.routine.skip.confirmRestore', { count: 3 })).toMatch(/3/);
      expect(t('busy.routine.skip.chip', { count: 4 })).toMatch(/4/);
      expect(t('busy.routine.skip.count', { count: 0 })).not.toMatch(/0/);
      expect(t('busy.routine.skip.limit', { max: SKIP_MAX_DAYS })).toMatch(/31/);
      expect(t('busy.routine.skip.day.aria', { date: '18', state: 'on' })).not.toBe(t('busy.routine.skip.day.aria', { date: '18', state: 'off' }));
      expect(t('busy.routine.skip.day.aria', { date: '18', state: 'skipped' })).not.toBe(t('busy.routine.skip.day.aria', { date: '18', state: 'off' }));
      expect(t('errors.LIMIT_REACHED', { limit: 'skipDays', max: 31 })).toMatch(/31/);
      expect(t('busy.routine.skip.toast.skipped', { count: 2 })).toMatch(/2/);
      expect(t('busy.routine.skip.restoreNote')).toBeTruthy();
      expect(t('busy.routine.skip.error.rows', { max: 1500 })).toMatch(/1500/);
    }
  });
});
