// R4B-fix: RATE_LIMITED (Retry-After) · LIMIT_REACHED appointmentsPerDay · ข้อความกล่อง "ใครไปบ้าง" เมื่อปิดรับคำตอบ
import { describe, expect, it } from 'vitest';
import { callApiFull, type Failure } from '@/components/appointments/api';
import { actionFailureRef, mapFormFailure, rateLimitedRef } from '@/components/appointments/model';
import { createTranslator } from 'use-intl/core';
import en from '../../messages/en.json';
import th from '../../messages/th.json';

const say = (l: 'th' | 'en', key: string, values: Record<string, string | number> = {}) =>
  (createTranslator({ locale: l, messages: (l === 'th' ? th : en) as never }) as unknown as (k: string, v?: unknown) => string)(key, values);

const api = (code: string, values: Record<string, string | number> = {}): Failure =>
  ({ ok: false, kind: 'api', status: 400, error: { code, key: `errors.${code}`, values }, fields: {} }) as unknown as Failure;

describe('RATE_LIMITED', () => {
  it('callApiFull เก็บ Retry-After จาก header ไว้ใน values.retryAfterSec', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '42' } })) as unknown as typeof fetch;
    const r = await callApiFull('/api/appointments/a/rsvp', { method: 'PUT', body: {}, fetchImpl });
    expect(r).toMatchObject({ ok: false, kind: 'api', status: 429, error: { code: 'RATE_LIMITED', values: { retryAfterSec: 42 } } });
  });
  it('ไม่มี header → ไม่มี retryAfterSec → ข้อความทั่วไป', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), { status: 429 })) as unknown as typeof fetch;
    const r = await callApiFull('/x', { fetchImpl });
    expect(r).toMatchObject({ error: { values: {} } });
    expect(rateLimitedRef({})).toEqual({ key: 'errors.RATE_LIMITED', values: {} });
  });
  it('วินาที ≤ 60 · เกินนั้นเป็นนาที (ปัดขึ้น)', () => {
    expect(rateLimitedRef({ retryAfterSec: 42 })).toEqual({ key: 'appointments.rateRetry', values: { n: 42, unit: 'sec' } });
    expect(rateLimitedRef({ retryAfterSec: 61 })).toEqual({ key: 'appointments.rateRetry', values: { n: 2, unit: 'min' } });
  });
  it('ฟอร์ม/RSVP/ยกเลิก แสดงข้อความ RATE_LIMITED ไม่ใช่ข้อความทั่วไป', () => {
    expect(mapFormFailure(api('RATE_LIMITED', { retryAfterSec: 30 }), 'create')).toMatchObject({ problems: [{ pos: 'banner', ref: { key: 'appointments.rateRetry' } }] });
    expect(actionFailureRef(api('RATE_LIMITED'), 'appointments.rsvp.error').key).toBe('errors.RATE_LIMITED');
    expect(actionFailureRef(api('RATE_LIMITED', { retryAfterSec: 5 }), 'appointments.cancel.error').key).toBe('appointments.rateRetry');
    expect(actionFailureRef(api('UNKNOWN'), 'appointments.rsvp.error').key).toBe('appointments.rsvp.error');
    expect(actionFailureRef({ ok: false, kind: 'network' } as Failure, 'appointments.cancel.error').key).toBe('appointments.cancel.error');
  });
  it('ข้อความ th/en เรนเดอร์ได้ ไม่มีวงเล็บปีกกาหลุด', () => {
    for (const l of ['th', 'en'] as const) {
      for (const v of [{ n: 30, unit: 'sec' }, { n: 2, unit: 'min' }, { n: 1, unit: 'sec' }]) {
        const s = say(l, 'appointments.rateRetry', v);
        expect(s).toContain(String(v.n));
        expect(s).not.toMatch(/[{}]/);
      }
    }
    expect(say('en', 'appointments.rateRetry', { n: 1, unit: 'sec' })).toContain('1 second.');
    expect(say('en', 'appointments.rateRetry', { n: 2, unit: 'min' })).toContain('2 minutes.');
  });
});

describe('LIMIT_REACHED appointmentsPerDay', () => {
  it('ฟอร์ม → banner พร้อม limit/max · th/en มีข้อความเฉพาะ', () => {
    expect(mapFormFailure(api('LIMIT_REACHED', { limit: 'appointmentsPerDay', max: 20 }), 'create')).toMatchObject({
      problems: [{ pos: 'banner', ref: { key: 'errors.LIMIT_REACHED', values: { limit: 'appointmentsPerDay', max: 20 } } }],
    });
    for (const l of ['th', 'en'] as const) {
      const s = say(l, 'errors.LIMIT_REACHED', { limit: 'appointmentsPerDay', max: 20 });
      expect(s).toContain('20');
      expect(s).not.toBe(say(l, 'errors.LIMIT_REACHED', { limit: 'zzz', max: 20 }));
    }
  });
});

describe('กล่อง "ใครไปบ้าง" ว่าง', () => {
  it('มีข้อความแบบปิดรับคำตอบที่ไม่ชวนตอบ ทั้ง th/en', () => {
    for (const l of ['th', 'en'] as const) {
      const closed = say(l, 'appointments.rsvp.list.nobodyClosed');
      expect(closed.length).toBeGreaterThan(5);
      expect(closed).not.toBe(say(l, 'appointments.rsvp.list.nobody'));
    }
    expect(en.appointments.rsvp.list.nobodyClosed).not.toMatch(/be the first/i);
    expect(th.appointments.rsvp.list.nobodyClosed).not.toContain('เป็นคนแรก');
  });
});
