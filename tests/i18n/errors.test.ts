// apiErrorMessage() (src/i18n/errors.ts) — แปลง {error:{code, params}} → คีย์ errors.<CODE> + ค่าให้ t()
// LOGIN_LOCKED: API ส่ง retryAfterSec แต่ข้อความใช้นาที = max(1, ceil(sec/60)) (UX.md §4)
import { describe, expect, it } from 'vitest';
import { apiErrorMessage, retryAfterMinutes } from '@/i18n/errors';
import { ERROR_CODES } from '@/lib/shared/errors';

const locked = (retryAfterSec: unknown) => apiErrorMessage({ error: { code: 'LOGIN_LOCKED', params: { retryAfterSec } } });

describe('apiErrorMessage — LOGIN_LOCKED วินาที → นาที', () => {
  it.each([
    [120, 2],
    [61, 2],
    [60, 1],
    [5, 1],
    [0, 1],
  ])('retryAfterSec %i → retryAfterMin %i', (sec, min) => {
    const m = locked(sec);
    expect(m.code).toBe('LOGIN_LOCKED');
    expect(m.key).toBe('errors.LOGIN_LOCKED');
    expect(m.values.retryAfterMin).toBe(min);
  });

  it('retryAfterSec หาย/ไม่ใช่ตัวเลข → 1 นาที (ไม่ใช่ NaN)', () => {
    expect(locked(undefined).values.retryAfterMin).toBe(1);
    expect(locked('120').values.retryAfterMin).toBe(1);
    expect(locked(Number.NaN).values.retryAfterMin).toBe(1);
    expect(apiErrorMessage({ error: { code: 'LOGIN_LOCKED' } }).values.retryAfterMin).toBe(1);
  });

  it('retryAfterMinutes ตรงสูตร max(1, ceil(sec/60))', () => {
    expect(retryAfterMinutes(3600)).toBe(60);
    expect(retryAfterMinutes(-30)).toBe(1);
  });
});

describe('apiErrorMessage — รหัส', () => {
  it.each(ERROR_CODES)('%s → key errors.%s', (code) => {
    const m = apiErrorMessage({ error: { code } });
    expect(m.code).toBe(code);
    expect(m.key).toBe(`errors.${code}`);
  });

  it.each([
    ['รหัสไม่รู้จัก', { error: { code: 'NOPE' } }],
    ['code ไม่ใช่ string', { error: { code: 42 } }],
    ['ไม่มี error', { data: {} }],
    ['body undefined (parse JSON ไม่ได้)', undefined],
    ['body null', null],
    ['body เป็น string', 'Internal Server Error'],
  ])('%s → UNKNOWN', (_label, body) => {
    const m = apiErrorMessage(body);
    expect(m.code).toBe('UNKNOWN');
    expect(m.key).toBe('errors.UNKNOWN');
  });

  it('ส่งต่อเฉพาะ params ที่เป็น string/ตัวเลขจำกัด', () => {
    const m = apiErrorMessage({
      error: { code: 'VALIDATION', params: { field: 'username', max: 20, bad: { x: 1 }, inf: Infinity, nil: null } },
    });
    expect(m.values).toEqual({ field: 'username', max: 20 });
  });

  it('INVALID_CREDENTIALS ไม่มี attemptsRemaining → 0 (ข้อความ plural ไม่พัง)', () => {
    expect(apiErrorMessage({ error: { code: 'INVALID_CREDENTIALS' } }).values.attemptsRemaining).toBe(0);
    expect(
      apiErrorMessage({ error: { code: 'INVALID_CREDENTIALS', params: { attemptsRemaining: 2 } } }).values.attemptsRemaining,
    ).toBe(2);
  });
});
