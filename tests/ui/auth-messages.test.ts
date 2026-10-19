// R1 Front-end — ข้อความ auth ที่ UI คำนวณก่อนส่งเข้า t() (UX.md §4 "R1 — ไฟล์จริง" ICU param contract)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { deviceLabel, lockedMessage, messageRefOf, regionName, splitMinutes } from '@/i18n/auth-messages';
import { apiErrorMessage } from '@/i18n/errors';

type Tree = { [k: string]: string | Tree };
const ROOT = path.resolve(import.meta.dirname, '../..');
const load = (l: 'th' | 'en') => JSON.parse(readFileSync(path.join(ROOT, 'messages', `${l}.json`), 'utf8')) as Tree;
const MSG = { th: load('th'), en: load('en') };

function say(locale: 'th' | 'en', key: string, values: Record<string, string | number> = {}): string {
  let node: string | Tree = MSG[locale];
  for (const part of key.split('.')) {
    if (typeof node === 'string') throw new Error(`no key ${key}`);
    node = node[part] as string | Tree;
  }
  if (typeof node !== 'string') throw new Error(`no key ${key}`);
  return String(new IntlMessageFormat(node, locale).format(values));
}

describe('splitMinutes', () => {
  it.each([
    [60, 1, 0],
    [61, 1, 1],
    [90, 1, 30],
    [1440, 24, 0],
    [59, 0, 59],
  ])('%i นาที → %i ชม. %i นาที', (min, hours, minutes) => {
    expect(splitMinutes(min)).toEqual({ hours, minutes });
  });
});

describe('lockedMessage — เลือกคีย์ตามเวลาที่เหลือ', () => {
  it('< 60 นาที ใช้ errors.LOGIN_LOCKED ← retryAfterMin (ปัดขึ้น)', () => {
    expect(lockedMessage(61)).toEqual({ key: 'errors.LOGIN_LOCKED', values: { retryAfterMin: 2 } });
    expect(lockedMessage(1)).toEqual({ key: 'errors.LOGIN_LOCKED', values: { retryAfterMin: 1 } });
    expect(lockedMessage(0)).toEqual({ key: 'errors.LOGIN_LOCKED', values: { retryAfterMin: 1 } });
    expect(lockedMessage(3540)).toEqual({ key: 'errors.LOGIN_LOCKED', values: { retryAfterMin: 59 } });
  });

  it('≥ 60 นาที ใช้ login.locked.long ← {hours, minutes}', () => {
    expect(lockedMessage(3600)).toEqual({ key: 'login.locked.long', values: { hours: 1, minutes: 0 } });
    expect(lockedMessage(5400)).toEqual({ key: 'login.locked.long', values: { hours: 1, minutes: 30 } });
    expect(lockedMessage(86400)).toEqual({ key: 'login.locked.long', values: { hours: 24, minutes: 0 } });
  });

  it('ข้อความจริงทั้งสองภาษา: en ใช้พหูพจน์ minute/minutes · th ไม่มีพหูพจน์', () => {
    const one = lockedMessage(30);
    const two = lockedMessage(120);
    expect(say('en', one.key, one.values)).toContain('1 minute.');
    expect(say('en', two.key, two.values)).toContain('2 minutes.');
    expect(say('th', two.key, two.values)).toContain('2 นาที');
    const long = lockedMessage(5400);
    expect(say('en', long.key, long.values)).toContain('1 h 30 min');
    expect(say('th', long.key, long.values)).toContain('1 ชม. 30 นาที');
  });
});

describe('messageRefOf — error ของ API → คีย์ + ค่า', () => {
  it('LOGIN_LOCKED จาก API (retryAfterSec) ยาวเกิน 1 ชม. → login.locked.long', () => {
    const ref = messageRefOf(apiErrorMessage({ error: { code: 'LOGIN_LOCKED', params: { retryAfterSec: 7200 } } }));
    expect(ref).toEqual({ key: 'login.locked.long', values: { hours: 2, minutes: 0 } });
  });

  it('INVALID_CREDENTIALS: 0 = ไม่บอกจำนวน · 1 = ครั้งสุดท้าย · ≥2 = เหลืออีก N ครั้ง', () => {
    const at = (n: number | undefined, locale: 'th' | 'en') => {
      const ref = messageRefOf(
        apiErrorMessage({ error: { code: 'INVALID_CREDENTIALS', params: n === undefined ? undefined : { attemptsRemaining: n } } }),
      );
      return say(locale, ref.key, ref.values);
    };
    expect(at(0, 'en')).toBe('Wrong username or PIN.');
    expect(at(undefined, 'en')).toBe('Wrong username or PIN.');
    expect(at(1, 'en')).toContain('One try left');
    expect(at(3, 'en')).toContain('3 tries left');
    expect(at(0, 'th')).not.toMatch(/เหลือ/);
    expect(at(3, 'th')).toContain('3');
  });

  it('AUTH_MAINTENANCE และ RATE_LIMITED มีข้อความทั้งสองภาษา', () => {
    for (const code of ['AUTH_MAINTENANCE', 'RATE_LIMITED'] as const) {
      const ref = messageRefOf(apiErrorMessage({ error: { code } }));
      expect(ref.key).toBe(`errors.${code}`);
      for (const l of ['th', 'en'] as const) expect(say(l, ref.key, ref.values).length).toBeGreaterThan(10);
    }
  });
});

describe('regionName', () => {
  it('แปลงรหัสประเทศตามภาษา', () => {
    expect(regionName('en', 'th')).toBe('Thailand');
    expect(regionName('th', 'TH')).toBe('ไทย');
  });
  it('รหัสว่าง/แปลก → null', () => {
    for (const bad of [null, undefined, '', 'T', 'THA', '12', 'ZZ']) expect(regionName('en', bad)).toBeNull();
  });
});

describe('deviceLabel', () => {
  it('ตัดส่วน Unknown · ไม่เหลือ → null', () => {
    expect(deviceLabel('iPhone · Safari')).toBe('iPhone · Safari');
    expect(deviceLabel('Unknown · Safari')).toBe('Safari');
    expect(deviceLabel('Unknown · Unknown')).toBeNull();
    expect(deviceLabel('')).toBeNull();
    expect(deviceLabel(null)).toBeNull();
  });
});
