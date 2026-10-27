// R5 — ตัวช่วยล้วนของบัญชี/หน้า admin (src/components/account/model.ts, src/components/admin/audit-labels.ts)
// + ป้าย "บัญชีที่ถูกลบ" ในแจ้งเตือน (notificationView) · ทุก action ของ audit มีป้าย TH/EN · meta เฉพาะคีย์ whitelist
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendUnique,
  AUDIT_META_KEYS,
  deleteOutcome,
  queryString,
  renameErrorRef,
  renameLocalProblem,
  shortId,
  shownName,
  shownUsername,
  transferGroupsOf,
  visibleMeta,
} from '@/components/account/model';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES, auditActionKey, auditTargetTypeKey } from '@/components/admin/audit-labels';
import { notificationView } from '@/components/notifications/model';
import { apiErrorMessage } from '@/i18n/errors';
import { AUDIT_META_WHITELIST } from '@/lib/data/serializers/admin';

const ROOT = path.resolve(import.meta.dirname, '../..');
const load = (l: 'th' | 'en') => JSON.parse(readFileSync(path.join(ROOT, 'messages', `${l}.json`), 'utf8')) as Record<string, unknown>;
const get = (tree: unknown, key: string): unknown => key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], tree);
const fail = (code: string, params: Record<string, unknown> = {}, status = 400) =>
  ({ ok: false, kind: 'api', status, error: apiErrorMessage({ error: { code, params } }), params }) as const;

describe('shownName (displayName) / shownUsername (audit)', () => {
  it('displayName: ว่าง / มีแต่ช่องว่าง / null → ป้ายบัญชีที่ถูกลบ', () => {
    for (const v of ['', '   ', null, undefined]) expect(shownName(v, 'DEL')).toBe('DEL');
  });
  it('QA M1: ผู้ใช้ที่ยังอยู่ตั้งชื่อ deleted-totally-real → แสดงชื่อนั้นตรงตัว (ปลอมเป็นบัญชีที่ลบไม่ได้)', () => {
    expect(shownName('deleted-totally-real', 'DEL')).toBe('deleted-totally-real');
    expect(shownName('ปาล์ม', 'DEL')).toBe('ปาล์ม');
  });
  it('username: deleted-<id> / ว่าง → ป้าย · username จริงคงเดิม', () => {
    expect(shownUsername('deleted-0f2c4a1e-1111-4222-8333-444455556666', 'DEL')).toBe('DEL');
    expect(shownUsername('', 'DEL')).toBe('DEL');
    expect(shownUsername('palm_99', 'DEL')).toBe('palm_99');
  });
});

describe('transferGroupsOf (409 ADMIN_TRANSFER_REQUIRED)', () => {
  it('ดึง {id,name} ที่รูปถูก ข้ามตัวที่ผิดรูป', () => {
    expect(transferGroupsOf({ groups: [{ id: 'g1', name: 'ก๊วน' }, { id: 7, name: 'x' }, null, { id: 'bad id', name: 'y' }] })).toEqual([{ id: 'g1', name: 'ก๊วน' }]);
    expect(transferGroupsOf(undefined)).toEqual([]);
    expect(transferGroupsOf({ groups: 'nope' })).toEqual([]);
  });
});

describe('deleteOutcome', () => {
  it('409 → รายชื่อกลุ่ม · 403 → super admin · 401 AUTH_REQUIRED → กลับ /login · PIN ผิด → ข้อความ + ล้าง PIN · เครือข่าย → ไม่ล้าง', () => {
    expect(deleteOutcome(fail('ADMIN_TRANSFER_REQUIRED', { groups: [{ id: 'g', name: 'G' }] }, 409))).toEqual({ kind: 'transfer', groups: [{ id: 'g', name: 'G' }] });
    expect(deleteOutcome(fail('FORBIDDEN', {}, 403)).kind).toBe('superAdmin');
    expect(deleteOutcome(fail('AUTH_REQUIRED', {}, 401)).kind).toBe('authLost');
    const wrong = deleteOutcome(fail('INVALID_CREDENTIALS', { attemptsRemaining: 3 }, 401));
    expect(wrong).toEqual({ kind: 'error', ref: { key: 'errors.INVALID_CREDENTIALS', values: { attemptsRemaining: 3 } }, resetPin: true });
    expect(deleteOutcome({ ok: false, kind: 'network' })).toEqual({ kind: 'error', ref: { key: 'states.error.network', values: {} }, resetPin: false });
  });
});

describe('เปลี่ยนชื่อ', () => {
  it('renameLocalProblem: ว่าง → TOO_SHORT · > 40 ตัว (code point) → TOO_LONG · ไทยมีวรรณยุกต์นับตาม code point', () => {
    expect(renameLocalProblem('  ')).toBe('TOO_SHORT');
    expect(renameLocalProblem('ก'.repeat(41))).toBe('TOO_LONG');
    expect(renameLocalProblem('ก'.repeat(40))).toBeNull();
  });
  it('renameErrorRef: VALIDATION fields.displayName → เหตุผลตรงตัว · RATE_LIMITED → เพดานต่อวัน · อื่น → errors.<CODE>', () => {
    expect(renameErrorRef(fail('VALIDATION', { fields: { displayName: 'INVALID' } }))).toEqual({ key: 'account.rename.invalid', values: { reason: 'INVALID', max: 40 } });
    expect(renameErrorRef(fail('RATE_LIMITED', {}, 429))).toEqual({ key: 'account.rename.rateLimited', values: { perDay: 10 } });
    expect(renameErrorRef(fail('VALIDATION'))).toEqual({ key: 'errors.VALIDATION', values: {} });
    expect(renameErrorRef({ ok: false, kind: 'network' }).key).toBe('states.error.network');
  });
});

describe('รายการ admin', () => {
  it('appendUnique ตัด id ซ้ำ คงลำดับ', () => {
    expect(appendUnique([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('queryString ข้ามค่าว่าง · encode', () => {
    expect(queryString({ q: '', status: 'all', action: null })).toBe('?status=all');
    expect(queryString({ q: ' a&b ' })).toBe('?q=a%26b');
    expect(queryString({})).toBe('');
  });
  it('shortId', () => {
    expect(shortId('0f2c4a1e-1111-4222-8333-444455556666')).toBe('0f2c4a1e…');
    expect(shortId('abc')).toBe('abc');
  });
});

describe('audit — ป้ายและ meta', () => {
  const th = load('th');
  const en = load('en');
  it('ทุก action ที่ระบบเขียน (AUDIT_META_WHITELIST) มีป้าย TH/EN · ไม่รู้จัก → null', () => {
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(20);
    for (const a of AUDIT_ACTIONS) {
      const key = auditActionKey(a)!;
      expect(typeof get(th, key), `th ${key}`).toBe('string');
      expect(typeof get(en, key), `en ${key}`).toBe('string');
    }
    expect(auditActionKey('evil.action')).toBeNull();
    expect(auditActionKey('__proto__')).toBeNull();
  });
  it('ชนิดเป้าหมายมีป้ายครบ', () => {
    for (const x of AUDIT_TARGET_TYPES) expect(typeof get(th, auditTargetTypeKey(x)!)).toBe('string');
    expect(auditTargetTypeKey('secret')).toBeNull();
  });
  it('คีย์ meta ที่ UI รู้จัก = ทุกคีย์ใน whitelist ของ serializer (ไม่ขาดไม่เกิน) และมีป้ายทั้งสองภาษา', () => {
    const fromServer = new Set(Object.values(AUDIT_META_WHITELIST).flat());
    expect([...AUDIT_META_KEYS].sort()).toEqual([...fromServer].sort());
    for (const k of AUDIT_META_KEYS) {
      expect(typeof get(th, `adminAudit.meta.${k}`), k).toBe('string');
      expect(typeof get(en, `adminAudit.meta.${k}`), k).toBe('string');
    }
  });
  it('visibleMeta แสดงเฉพาะคีย์ whitelist ค่าพื้นฐาน (คีย์แปลก/ค่าอ็อบเจกต์ถูกทิ้ง)', () => {
    expect(visibleMeta({ state: 'suspended', note: 'ลับ', pin: '123456', asSuperAdmin: true, fields: ['name', 3], from: { x: 1 } })).toEqual([
      { key: 'state', value: 'suspended' },
      { key: 'asSuperAdmin', value: true },
    ]);
    expect(visibleMeta(null)).toEqual([]);
    expect(visibleMeta(['state'])).toEqual([]);
  });
});

describe('แจ้งเตือน: ชื่อคนของบัญชีที่ถูกลบ (params ถูกล้างเป็น "")', () => {
  it('inviterName/inviteeName ว่าง → ป้ายบัญชีที่ถูกลบ (ไม่ตกเป็น "แจ้งเตือนอื่น")', () => {
    const r = notificationView('group.invite.received', { groupId: 'g1', groupName: 'ก๊วน', inviterName: '', inviteId: 'i' }, 'th', 'บัญชีที่ถูกลบ');
    expect(r.known).toBe(true);
    expect(r.values.inviterName).toBe('⁨บัญชีที่ถูกลบ⁩');
    const a = notificationView('group.invite.accepted', { groupId: 'g1', groupName: 'ก๊วน', inviteeName: '', inviteId: 'i' }, 'en', 'Deleted account');
    expect(a.values.inviteeName).toBe('⁨Deleted account⁩');
  });
  it('ไม่ส่งป้าย (ผู้เรียกเดิม) → พฤติกรรมเดิม (UNKNOWN)', () => {
    expect(notificationView('group.invite.received', { groupId: 'g1', groupName: 'ก๊วน', inviterName: '', inviteId: 'i' }, 'th').known).toBe(false);
  });
});
