// จับคู่ error → ข้อความตามบริบท (UX §4 R2 "จับคู่ error → ข้อความ") + flash ข้ามหน้า
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiResult } from '@/components/auth/api';
import { failureRef, isGone } from '@/components/groups/errors';
import { setFlash, takeFlash } from '@/components/groups/flash';
import { apiErrorMessage } from '@/i18n/errors';
import { GROUP_LIMITS } from '@/lib/shared/limits';

type Failure = Extract<ApiResult<unknown>, { ok: false }>;
const api = (status: number, code: string, params?: Record<string, unknown>): Failure => ({
  ok: false,
  kind: 'api',
  status,
  error: apiErrorMessage({ error: { code, params } }),
});
const network: Failure = { ok: false, kind: 'network' };

describe('failureRef — เครือข่ายล่ม', () => {
  it('ทุกบริบท → states.error.network', () => {
    for (const ctx of ['generic', 'join', 'groupName', 'directInvite', 'respondInvite', 'leave'] as const) {
      expect(failureRef(ctx, network).key).toBe('states.error.network');
    }
  });
});

describe('failureRef — ใส่โค้ดเชิญ', () => {
  it('INVITE_INVALID ใช้ errors.INVITE_INVALID (ข้อความเดียวไม่ว่าสาเหตุใด)', () => {
    expect(failureRef('join', api(400, 'INVITE_INVALID')).key).toBe('errors.INVITE_INVALID');
  });
  it('RATE_LIMITED ใช้ errors.RATE_LIMITED', () => {
    expect(failureRef('join', api(429, 'RATE_LIMITED', { retryAfterSec: 30 })).key).toBe('errors.RATE_LIMITED');
  });
  it('กลุ่มเต็ม → errors.LIMIT_REACHED พร้อม limit/max จาก params ของ API ตรงๆ', () => {
    const r = failureRef('join', api(409, 'LIMIT_REACHED', { limit: 'members', max: 50 }));
    expect(r).toEqual({ key: 'errors.LIMIT_REACHED', values: { limit: 'members', max: 50 } });
  });
});

describe('failureRef — ชื่อกลุ่ม', () => {
  it('VALIDATION → groups.createSheet.nameInvalid ← max จากค่าคงที่', () => {
    expect(failureRef('groupName', api(400, 'VALIDATION', { fields: { name: 'TOO_LONG' } }))).toEqual({
      key: 'groups.createSheet.nameInvalid',
      values: { max: GROUP_LIMITS.nameMax },
    });
  });
  it('เกินจำนวนกลุ่ม → LIMIT_REACHED (limit=groups)', () => {
    expect(failureRef('groupName', api(409, 'LIMIT_REACHED', { limit: 'groups', max: 10 }))).toEqual({
      key: 'errors.LIMIT_REACHED',
      values: { limit: 'groups', max: 10 },
    });
  });
});

describe('failureRef — ชวนตรง', () => {
  it('USER_NOT_FOUND / ALREADY_MEMBER ใช้ errors.* ตรงๆ', () => {
    expect(failureRef('directInvite', api(404, 'USER_NOT_FOUND')).key).toBe('errors.USER_NOT_FOUND');
    expect(failureRef('directInvite', api(409, 'ALREADY_MEMBER')).key).toBe('errors.ALREADY_MEMBER');
  });
  it('CONFLICT = มีคำเชิญค้างอยู่ → alreadyInvited ← username (ไม่ใช้ errors.CONFLICT)', () => {
    expect(failureRef('directInvite', api(409, 'CONFLICT'), { username: 'nong_fah' })).toEqual({
      key: 'groupSettings.invite.direct.alreadyInvited',
      values: { username: 'nong_fah' },
    });
  });
});

describe('failureRef — รับ/ปฏิเสธคำเชิญ', () => {
  it('NOT_FOUND และ CONFLICT → groups.invites.unavailable', () => {
    expect(failureRef('respondInvite', api(404, 'NOT_FOUND')).key).toBe('groups.invites.unavailable');
    expect(failureRef('respondInvite', api(409, 'CONFLICT')).key).toBe('groups.invites.unavailable');
  });
  it('สมาชิกเต็มตอนรับ → errors.LIMIT_REACHED', () => {
    expect(failureRef('respondInvite', api(409, 'LIMIT_REACHED', { limit: 'members', max: 50 })).key).toBe('errors.LIMIT_REACHED');
  });
});

describe('failureRef — ออกจากกลุ่ม / อื่นๆ', () => {
  it('admin ออกเอง → leave.adminBlocked', () => {
    expect(failureRef('leave', api(409, 'ADMIN_TRANSFER_REQUIRED')).key).toBe('groupSettings.leave.adminBlocked');
  });
  it('บริบททั่วไป: CONFLICT/NOT_FOUND/INVALID_WINDOW/รหัสแปลก ใช้ errors.<CODE>', () => {
    expect(failureRef('generic', api(409, 'CONFLICT')).key).toBe('errors.CONFLICT');
    expect(failureRef('generic', api(404, 'NOT_FOUND')).key).toBe('errors.NOT_FOUND');
    expect(failureRef('generic', api(400, 'INVALID_WINDOW')).key).toBe('errors.INVALID_WINDOW');
    expect(failureRef('generic', api(500, 'WHATEVER')).key).toBe('errors.UNKNOWN');
  });
});

describe('isGone', () => {
  it('404 จาก API เท่านั้น', () => {
    expect(isGone(api(404, 'NOT_FOUND'))).toBe(true);
    expect(isGone(api(409, 'CONFLICT'))).toBe(false);
    expect(isGone(network)).toBe(false);
  });
});

describe('flash ข้ามหน้า', () => {
  const store = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it('อ่านได้ครั้งเดียวแล้วถูกลบ', () => {
    setFlash({ key: 'groups.createSheet.created', values: { name: 'ก๊วน' } });
    expect(takeFlash()).toEqual({ key: 'groups.createSheet.created', values: { name: 'ก๊วน' } });
    expect(takeFlash()).toBeNull();
  });
  it('ข้อมูลเสีย/ไม่มี storage → null ไม่โยน', () => {
    store.set('mm_flash', '{not json');
    expect(takeFlash()).toBeNull();
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(() => setFlash({ key: 'x', values: {} })).not.toThrow();
    expect(takeFlash()).toBeNull();
  });
});
