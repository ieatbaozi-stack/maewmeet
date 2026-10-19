// MEDIUM (R2 review): displayName ใช้กติกาตัวอักษรเดียวกับชื่อกลุ่ม (shared validator) + ตัดตัวต้องห้ามตอนอ่านแถวเก่า
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkGroupName } from '@/lib/data/group-name';
import { checkVisibleName, sanitizeDisplayText } from '@/lib/shared/name-rules';
import { Client, GOOD_PIN, loggedIn, setupHarness, type Harness } from './harness';
import { get, join, makeGroup, person, post } from '../groups/harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const signup = (displayName: string, username = 'nong_mew') =>
  new Client().post('/api/auth/signup', { username, displayName, pin: GOOD_PIN, pinConfirm: GOOD_PIN });

const BAD = {
  'RLO (U+202E)': 'ab‮cd',
  'RLI/PDI isolates': '⁧ab⁩',
  'LRM mark': 'a‎b',
  'zero-width space': 'a​b',
  'ZWNJ': 'a‌b',
  'ZWJ นอก emoji': 'a‍b',
  'word joiner': 'a⁠b',
  'BOM': 'a\uFEFFb',
  'soft hyphen': 'a­b',
  'newline': 'a\nb',
  'NUL': 'a\u0000b',
  'Hangul filler': 'aㅤb',
  'braille blank only': '⠀⠀',
  'NBSP': 'a b',
  'combining ซ้อนเกิน': 'x\u0301\u0302\u0303\u0304',
  'combining ไม่มีตัวฐาน': '\u0301x',
};

describe('displayName: กติกาตัวอักษรเดียวกับชื่อกลุ่ม', () => {
  for (const [label, name] of Object.entries(BAD)) {
    it(`สมัครด้วยชื่อที่มี ${label} → 400 VALIDATION fields.displayName=INVALID และไม่สร้างผู้ใช้`, async () => {
      const r = await signup(name);
      expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
      expect(r.json.error?.params).toEqual({ fields: { displayName: 'INVALID' } });
      expect(await h.count('user')).toBe(0);
    });
  }

  it('ใช้ตัวตรวจร่วมกับชื่อกลุ่ม: ผลเหมือนกันทุกกรณี', () => {
    for (const name of [...Object.values(BAD), 'น้องเหมียว', '🐈‍⬛ แมว', '👨‍👩‍👧', 'ก'.repeat(41), '   ']) {
      expect(checkVisibleName(name, { min: 1, max: 40 })).toEqual(checkGroupName(name));
    }
  });

  it('ผ่าน: ไทย (สระ/วรรณยุกต์ซ้อน) · ZWJ ใน emoji · ยุบช่องว่างซ้ำ · 40 code point · ความยาวเดิม', async () => {
    for (const [i, name] of ['น้องเหมียว ก๊วน', '🐈‍⬛ แมว', '👨‍👩‍👧 family'].entries()) {
      expect((await signup(name, `ok_user_${i}`)).status).toBe(201);
    }
    const r = await signup('a    b', 'spaced_user');
    expect(r.status).toBe(201);
    expect((r.data as { user: { displayName: string } }).user.displayName).toBe('a b');
    expect((await signup('ก'.repeat(41), 'long_user')).json.error?.params).toEqual({ fields: { displayName: 'TOO_LONG' } });
    expect((await signup('   ', 'blank_user')).json.error?.params).toEqual({ fields: { displayName: 'TOO_SHORT' } });
  });
});

describe('sanitizeDisplayText (ตัดตอนอ่านแถวเก่า)', () => {
  it('ลบ bidi/zero-width/ควบคุม · ช่องว่างพิเศษ→ปกติ · คง ZWJ ใน emoji · เครื่องหมายผสมเกินถูกตัด', () => {
    expect(sanitizeDisplayText('a‮b​c⁧d⁩')).toBe('abcd');
    expect(sanitizeDisplayText('a  b\nc')).toBe('a bc');
    expect(sanitizeDisplayText('🐈‍⬛ x')).toBe('🐈‍⬛ x');
    expect(sanitizeDisplayText('a‍b')).toBe('ab');
    expect(sanitizeDisplayText('x\u0301\u0302\u0303\u0304')).toBe('x\u0301\u0302\u0303');
    expect(sanitizeDisplayText('น้องเหมียว')).toBe('น้องเหมียว');
  });
});

describe('แถวเก่า (ก่อนมีกติกา) ถูกตัดตัวต้องห้ามใน API/DTO', () => {
  const dirty = 'Ev‮il​';
  const clean = 'Evil';

  it('รายชื่อสมาชิก · การ์ดคำเชิญ · รายการ reset ของ admin · /api/auth/session', async () => {
    const a = await person(h as never, 'alice');
    const b = await person(h as never, 'bob');
    await h.rows('UPDATE user SET display_name = ? WHERE id = ?', [dirty, a.id]);
    const gid = await makeGroup(a, 'ก๊วนแมว');
    await join(a, b, gid);
    const detail = await get<{ group: { members: { displayName: string }[] } }>(b.c, `/api/groups/${gid}`);
    expect(detail.data.group.members.map((m) => m.displayName).sort()).toEqual([clean, b.displayName].sort());

    const c = await person(h as never, 'carol');
    expect((await post(a.c, `/api/groups/${gid}/invites/direct`, { username: 'carol' })).status).toBe(201);
    const mine = await get<{ invites: { inviterName: string }[] }>(c.c, '/api/me/invites');
    expect(mine.data.invites[0]!.inviterName).toBe(clean);
    const list = await get<{ invites: { creatorName: string }[] }>(a.c, `/api/groups/${gid}/invites`);
    expect(list.data.invites[0]!.creatorName).toBe(clean);
    const notif = await h.rows<{ params: string }>('SELECT params FROM notification');
    expect(JSON.parse(notif[0]!.params).inviterName).toBe(clean);

    await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    const resets = await boss.c.getJson<{ items: { displayName: string }[] }>('/api/auth/admin/pin-resets');
    expect(resets.data.items.map((i) => i.displayName)).toEqual([clean]);

    const me = await a.c.getJson<{ user?: { displayName: string }; displayName?: string }>('/api/auth/session');
    expect(me.data.user?.displayName ?? me.data.displayName).toBe(clean);
  });
});
