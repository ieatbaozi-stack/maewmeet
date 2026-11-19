// R17 frontend — ตัวช่วยล้วน: กู้คืนกลุ่ม (restore-model) · ลบบัญชี confirmUsername (deleteOutcome) · วันที่เหลือก่อนลบถาวร
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteOutcome } from '@/components/account/model';
import { PURGE_WARN_DAYS, purgeDaysLeft, restoreOutcome } from '@/components/admin/restore-model';
import { apiErrorMessage } from '@/i18n/errors';
import { normalizeUsername } from '@/lib/auth/pin-rules';
import { parseLocalDateTime } from '@/lib/calendar';

const fail = (code: string, params: Record<string, unknown> = {}, status = 400) =>
  ({ ok: false, kind: 'api', status, error: apiErrorMessage({ error: { code, params } }), params }) as const;

describe('restoreOutcome (POST /api/admin/groups/:gid/restore)', () => {
  it('200 changed:true → restored · changed:false → already', () => {
    expect(restoreOutcome({ ok: true, data: { group: { changed: true } } })).toEqual({ kind: 'restored' });
    expect(restoreOutcome({ ok: true, data: { group: { changed: false } } })).toEqual({ kind: 'already' });
  });
  it('409 CONFLICT reason → expired / noAdmin · 404 → purged', () => {
    expect(restoreOutcome(fail('CONFLICT', { reason: 'RETENTION_EXPIRED' }, 409))).toEqual({ kind: 'blocked', reason: 'expired' });
    expect(restoreOutcome(fail('CONFLICT', { reason: 'NO_ACTIVE_ADMIN' }, 409))).toEqual({ kind: 'blocked', reason: 'noAdmin' });
    expect(restoreOutcome(fail('NOT_FOUND', {}, 404))).toEqual({ kind: 'blocked', reason: 'purged' });
  });
  it('429 / 403 / reason แปลก / เครือข่าย → error กลาง (ไม่เดาเป็นเหตุที่รู้จัก)', () => {
    expect(restoreOutcome(fail('RATE_LIMITED', { retryAfterSec: 30 }, 429)).kind).toBe('error');
    expect(restoreOutcome(fail('FORBIDDEN', {}, 403)).kind).toBe('error');
    expect(restoreOutcome(fail('CONFLICT', { reason: 'WHATEVER' }, 409)).kind).toBe('error');
    expect(restoreOutcome({ ok: false, kind: 'network' }).kind).toBe('error');
  });
});

describe('purgeDaysLeft — วันปฏิทิน Asia/Bangkok ผ่าน lib กลาง', () => {
  const at = (date: string, time: string) => parseLocalDateTime(date, time, 'Asia/Bangkok');
  it('นับตามวันท้องถิ่น ไม่ใช่ 24 ชม.: 23:59 ของวันก่อนวันลบ = เหลือ 1 วัน', () => {
    expect(purgeDaysLeft(at('2026-12-31', '00:30'), at('2026-12-30', '23:59'))).toBe(1);
    expect(purgeDaysLeft(at('2026-12-31', '00:30'), at('2026-12-31', '00:10'))).toBe(0);
    expect(purgeDaysLeft(at('2026-12-31', '10:00'), at('2026-12-24', '12:00'))).toBe(PURGE_WARN_DAYS);
  });
  it('เลยกำหนดแล้ว → 0 (ไม่ติดลบ) · ไม่มีกำหนด → null', () => {
    expect(purgeDaysLeft(at('2026-12-01', '00:00'), at('2026-12-10', '00:00'))).toBe(0);
    expect(purgeDaysLeft(null, 0)).toBeNull();
    expect(purgeDaysLeft(Number.NaN, 0)).toBeNull();
  });
});

describe('deleteOutcome — confirmUsername (R17 A1)', () => {
  it('400 VALIDATION fields.confirmUsername → usernameMismatch (ไม่ใช่ PIN ผิด)', () => {
    expect(deleteOutcome(fail('VALIDATION', { fields: { confirmUsername: 'MISMATCH' } }))).toEqual({ kind: 'usernameMismatch' });
    expect(deleteOutcome(fail('VALIDATION', { fields: { confirmUsername: 'REQUIRED' } }))).toEqual({ kind: 'usernameMismatch' });
  });
  it('VALIDATION ของ pin ยังเป็น error ปกติ', () => {
    expect(deleteOutcome(fail('VALIDATION', { fields: { pin: 'FORMAT' } })).kind).toBe('error');
    expect(deleteOutcome(fail('VALIDATION', {})).kind).toBe('error');
  });
  it('เทียบชื่อผู้ใช้แบบเซิร์ฟเวอร์: NFKC + trim + ตัวเล็ก', () => {
    expect(normalizeUsername(' PALM_99 ')).toBe('palm_99');
    expect(normalizeUsername('ｐａｌｍ')).toBe('palm');
  });
});

describe('R17 ข้อความ/คีย์ที่ UI อ้าง มีทั้ง TH/EN', () => {
  const ROOT = path.resolve(import.meta.dirname, '../..');
  const load = (l: 'th' | 'en') => JSON.parse(readFileSync(path.join(ROOT, 'messages', `${l}.json`), 'utf8')) as Record<string, unknown>;
  const get = (tree: unknown, key: string): unknown => key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], tree);
  const KEYS = [
    'account.delete.noRestore', 'account.delete.typeLabel', 'account.delete.typeHint', 'account.delete.usernameMismatch', 'account.delete.pinLast', 'account.delete.gone.line',
    'adminGroups.purgeIn', 'adminGroups.restore', 'adminGroups.restoreAria',
    'adminGroup.purgeIn', 'adminGroup.restore.title', 'adminGroup.restore.body', 'adminGroup.restore.cta', 'adminGroup.restore.done',
    'adminGroup.restore.confirm.title', 'adminGroup.restore.confirm.body', 'adminGroup.restore.confirm.confirm',
    'adminGroup.restore.error.expired', 'adminGroup.restore.error.noAdmin', 'adminGroup.restore.error.purged', 'adminGroup.restore.error.alreadyRestored',
    'busy.routine.scope.confirmFrom.title', 'busy.routine.scope.confirmFrom.body', 'busy.routine.scope.confirmFrom.confirm',
    'notifications.group.restored',
  ];
  it.each(['th', 'en'] as const)('%s', (l) => {
    const m = load(l);
    for (const k of KEYS) expect(typeof get(m, k), `${l} ${k}`).toBe('string');
  });
});
