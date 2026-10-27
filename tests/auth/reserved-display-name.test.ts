// Security R5 L5 — ห้ามตั้งชื่อที่แสดงเป็นป้าย "บัญชีที่ถูกลบ" / "Deleted account" (เทียบแบบ normalize) ทั้งสมัครและเปลี่ยนชื่อ
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isReservedDisplayName, RESERVED_DISPLAY_NAMES } from '@/lib/shared/name-rules';
import { GOOD_PIN } from './harness';
import { Client, call, person, setupHarness, type Harness, type Person } from '../groups/harness';

const ROOT = path.resolve(import.meta.dirname, '../..');
const label = (l: 'th' | 'en') => (JSON.parse(readFileSync(path.join(ROOT, 'messages', `${l}.json`), 'utf8')) as { account: { deletedName: string } }).account.deletedName;

const RESERVED = ['บัญชีที่ถูกลบ', 'Deleted account', 'DELETED  ACCOUNT', 'deleted-account!', 'Ｄｅｌｅｔｅｄ ａｃｃｏｕｎｔ', 'บัญชี ที่ถูกลบ', '“Deleted account”'];
const ALLOWED = ['deleted-totally-real', 'Deleted', 'บัญชีของฉัน', 'Deleted accounts fan'];

describe('isReservedDisplayName', () => {
  it('รายการสงวนตรงกับ account.deletedName ของทั้งสองภาษา (ข้อความเปลี่ยน → เทสต์นี้ล้ม)', () => {
    expect([...RESERVED_DISPLAY_NAMES].sort()).toEqual([label('th'), label('en')].sort());
  });
  it.each(RESERVED)('สงวน: %s', (n) => expect(isReservedDisplayName(n)).toBe(true));
  it.each(ALLOWED)('ไม่สงวน: %s', (n) => expect(isReservedDisplayName(n)).toBe(false));
});

let h: Harness;
let me: Person;
beforeEach(async () => {
  h = await setupHarness();
  me = await person(h, 'alice');
});
afterEach(async () => {
  await h.cleanup();
});

describe('API', () => {
  it('PATCH /api/me ชื่อสงวน → 400 VALIDATION {displayName: RESERVED} · ชื่อไม่เปลี่ยน · ไม่กินโควตา', async () => {
    for (const n of RESERVED) {
      const r = await call(me.c, 'PATCH', '/api/me', { displayName: n });
      expect(r.status, n).toBe(400);
      expect(r.json.error, n).toEqual({ code: 'VALIDATION', params: { fields: { displayName: 'RESERVED' } } });
    }
    expect((await h.rows<{ display_name: string }>('SELECT display_name FROM user WHERE id = ?', [me.id]))[0]!.display_name).toBe('ชื่อ alice');
    expect((await call(me.c, 'PATCH', '/api/me', { displayName: 'deleted-totally-real' })).status).toBe(200);
  });

  it('สมัครด้วยชื่อสงวน → 400 VALIDATION {displayName: RESERVED} · ไม่สร้างบัญชี', async () => {
    const r = await new Client().post('/api/auth/signup', { username: 'spoof', displayName: 'Deleted account', pin: GOOD_PIN, pinConfirm: GOOD_PIN });
    expect(r.status).toBe(400);
    expect(r.json.error).toEqual({ code: 'VALIDATION', params: { fields: { displayName: 'RESERVED' } } });
    expect(await h.count("user WHERE username = 'spoof'")).toBe(0);
  });
});
