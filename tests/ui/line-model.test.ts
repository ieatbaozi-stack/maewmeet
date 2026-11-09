// R10 — ตัวช่วยล้วนของส่วนเชื่อม LINE ใน /me + คีย์ข้อความที่คอมโพเนนต์ใช้ครบ TH/EN
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeActive, lineErrorKey, lineIsConflict, lineView, msUntil, parseLineCode, parseLineStatus } from '@/components/account/line-model';

const ROOT = path.resolve(import.meta.dirname, '../..');
const load = (l: 'th' | 'en') => JSON.parse(readFileSync(path.join(ROOT, 'messages', `${l}.json`), 'utf8')) as Record<string, unknown>;
const get = (tree: unknown, key: string): unknown => key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], tree);

const on = { available: true, addFriendUrl: 'https://line.me/R/ti/p/@x', linked: false, pendingExpiresAt: null };
const code = { code: 'MM-ABCD-EFGH', expiresAt: 1_000 };

describe('parseLineStatus', () => {
  it('รูปถูกต้อง', () => expect(parseLineStatus(on)).toEqual(on));
  it('ผิดรูป → null (ซ่อน ไม่เดา)', () => {
    for (const v of [null, 'x', {}, { available: 'yes', linked: false }, { available: true }]) expect(parseLineStatus(v)).toBeNull();
  });
  it('addFriendUrl ที่ไม่ใช่ https → null (กัน javascript:)', () => {
    expect(parseLineStatus({ ...on, addFriendUrl: 'javascript:alert(1)' })?.addFriendUrl).toBeNull();
    expect(parseLineStatus({ ...on, addFriendUrl: 42 })?.addFriendUrl).toBeNull();
  });
});

describe('parseLineCode / codeActive / msUntil', () => {
  it('parse', () => {
    expect(parseLineCode({ code: 'MM-AAAA-BBBB', expiresAt: 5 })).toEqual({ code: 'MM-AAAA-BBBB', expiresAt: 5 });
    for (const v of [null, {}, { code: '', expiresAt: 1 }, { code: 'x', expiresAt: 'a' }]) expect(parseLineCode(v)).toBeNull();
  });
  it('หมดพอดี = หมด', () => {
    expect(codeActive(code, 999)).toBe(true);
    expect(codeActive(code, 1_000)).toBe(false);
    expect(codeActive(null, 0)).toBe(false);
  });
  it('msUntil ไม่ติดลบ', () => {
    expect(msUntil(1_000, 400)).toBe(600);
    expect(msUntil(1_000, 2_000)).toBe(0);
  });
});

describe('lineView', () => {
  it('ช่องทางปิด/ไม่รู้สถานะ → hidden', () => {
    expect(lineView(null, null, 0)).toBe('hidden');
    expect(lineView({ ...on, available: false }, code, 0)).toBe('hidden');
  });
  it('ยังไม่เชื่อม → idle · มีโค้ดที่ยังไม่หมดอายุ → code · หมดอายุ → idle', () => {
    expect(lineView(on, null, 0)).toBe('idle');
    expect(lineView(on, code, 500)).toBe('code');
    expect(lineView(on, code, 1_000)).toBe('idle');
  });
  it('เชื่อมแล้วชนะโค้ดค้าง', () => expect(lineView({ ...on, linked: true }, code, 500)).toBe('linked'));
});

describe('lineErrorKey', () => {
  const api = (status: number) => ({ ok: false, kind: 'api', status }) as const;
  it('429/503 ใช้ข้อความกลาง · อื่น ๆ + เครือข่ายใช้ me.line.error', () => {
    expect(lineErrorKey(api(429))).toBe('errors.RATE_LIMITED');
    expect(lineErrorKey(api(503))).toBe('errors.FEATURE_DISABLED');
    expect(lineErrorKey(api(500))).toBe('me.line.error');
    expect(lineErrorKey({ ok: false, kind: 'network' })).toBe('me.line.error');
  });
  it('409 ถือเป็น conflict (โหลดสถานะใหม่)', () => {
    expect(lineIsConflict(api(409))).toBe(true);
    expect(lineIsConflict(api(429))).toBe(false);
  });
});

describe('คีย์ข้อความ TH/EN ที่ส่วน LINE / privacy ใช้', () => {
  const keys = [
    ...['title', 'hint', 'connect', 'codeLabel', 'codeHint', 'addFriend', 'connected', 'disconnect', 'disconnectConfirm', 'error'].map((k) => `me.line.${k}`),
    'common.cancel', 'common.loading', 'errors.RATE_LIMITED', 'errors.FEATURE_DISABLED',
    'privacy.line.title', 'privacy.line.body', 'privacy.retention.line',
  ];
  for (const l of ['th', 'en'] as const) {
    it(`${l}: ครบและไม่ว่าง`, () => {
      const tree = load(l);
      for (const k of keys) expect(typeof get(tree, k) === 'string' && (get(tree, k) as string).trim() !== '', k).toBe(true);
    });
  }
});
