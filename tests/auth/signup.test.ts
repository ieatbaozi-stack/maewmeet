// ADR 0002 Test requirement 1 (U1): username ซ้ำต่างตัวพิมพ์ · PIN_FORMAT · PIN_TOO_WEAK ครบ 20 ตัว
// + กติกา username/displayName · ผลของการสมัคร (session, cookie ภาษา/ธีม) · ตั้ง is_admin ผ่าน body ไม่ได้
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FORBIDDEN_PINS, normalizeUsername } from '@/lib/auth/pin-rules';
import { Client, GOOD_PIN, setupHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const body = (o: Record<string, unknown> = {}) => ({
  username: 'nong_mew',
  displayName: 'น้องเหมียว',
  pin: GOOD_PIN,
  pinConfirm: GOOD_PIN,
  ...o,
});

describe('U1 สมัคร', () => {
  it('สำเร็จ → 201 + session cookie (HttpOnly/Secure/SameSite=Lax) + user DTO ไม่มี hash/isAdmin=false', async () => {
    const c = new Client();
    const r = await c.post('/api/auth/signup', body());
    expect(r.status).toBe(201);
    expect(r.data).toEqual({
      user: expect.objectContaining({ username: 'nong_mew', displayName: 'น้องเหมียว', isAdmin: false, mustChangePin: false, locale: 'th', theme: 'system' }),
    });
    expect(r.text).not.toMatch(/argon2|pin_?hash/i);
    const session = r.setCookies.find((s) => s.startsWith('mm_session='))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\//);
    expect(session).toMatch(/Max-Age=5184000/); // 60 วัน
    // เข้าด้วย session ที่ได้ทันที
    const me = await c.getJson<{ user: { username: string } }>('/api/auth/session');
    expect(me.status).toBe(200);
    expect(me.data.user.username).toBe('nong_mew');
  });

  it('locale/theme จาก cookie ของผู้เยี่ยมชมถูกบันทึกลงบัญชี · ค่านอกชุดไม่ถูกใช้', async () => {
    const c = new Client();
    c.set('mm_locale', 'en');
    c.set('mm_theme', 'dark');
    const r = await c.post<{ user: { locale: string; theme: string } }>('/api/auth/signup', body());
    expect(r.data.user).toMatchObject({ locale: 'en', theme: 'dark' });
    const c2 = new Client();
    c2.set('mm_locale', 'fr');
    const r2 = await c2.post<{ user: { locale: string } }>('/api/auth/signup', body({ username: 'second_user' }));
    expect(r2.data.user.locale).toBe('th');
  });

  it('username ซ้ำต่างตัวพิมพ์เล็ก/ใหญ่ (และ NFKC) → USERNAME_TAKEN · ผู้ใช้ไม่เพิ่ม', async () => {
    expect((await new Client().post('/api/auth/signup', body({ username: 'Jimmy.Dev' }))).status).toBe(201);
    for (const dup of ['jimmy.dev', 'JIMMY.DEV', 'jImMy.DeV', 'ｊｉｍｍｙ.ｄｅｖ' /* fullwidth */]) {
      const r = await new Client().post('/api/auth/signup', body({ username: dup }));
      expect(r.status, dup).toBe(409);
      expect(r.code, dup).toBe('USERNAME_TAKEN');
    }
    expect(await h.count('user')).toBe(1);
  });

  it('เก็บ username ตามที่พิมพ์ (แสดงผล) แต่ค้นด้วย normalized', async () => {
    await new Client().post('/api/auth/signup', body({ username: '  Jimmy.Dev ' }));
    const [row] = await h.rows<{ username: string; username_normalized: string }>('SELECT username, username_normalized FROM user');
    expect(row).toEqual({ username: 'Jimmy.Dev', username_normalized: 'jimmy.dev' });
    expect(normalizeUsername(' Jimmy.Dev ')).toBe('jimmy.dev');
  });

  it.each(['ab', 'a'.repeat(21), 'has space', 'ก้อน', 'semi;colon', 'a-b-c', 'a@b.c', '<script>'])(
    'username รูปแบบผิด %j → USERNAME_FORMAT',
    async (username) => {
      const r = await new Client().post('/api/auth/signup', body({ username }));
      expect(r.status).toBe(400);
      expect(r.code).toBe('USERNAME_FORMAT');
    },
  );

  it.each(['12345', '1234567', 'abcdef', '12 456', '12345a', '', '１２３４５６'])('PIN รูปแบบผิด %j → PIN_FORMAT', async (pin) => {
    const r = await new Client().post('/api/auth/signup', body({ pin, pinConfirm: pin }));
    expect(r.status).toBe(400);
    expect(r.code).toBe('PIN_FORMAT');
  });

  it('PIN ต้องห้ามครบทั้ง 20 ตัว → PIN_TOO_WEAK (วนทุกตัว) และไม่สร้างผู้ใช้', async () => {
    expect(FORBIDDEN_PINS).toHaveLength(20);
    expect(new Set(FORBIDDEN_PINS).size).toBe(20);
    expect(FORBIDDEN_PINS).toEqual(
      expect.arrayContaining([
        ...'0123456789'.split('').map((d) => d.repeat(6)),
        '012345', '123456', '234567', '345678', '456789',
        '987654', '876543', '765432', '654321', '543210',
      ]),
    );
    // IP ต่างกันต่อรอบ — กันชนเพดาน rate limit (ซึ่งทดสอบแยกใน ip-ratelimit.test.ts)
    for (const pin of FORBIDDEN_PINS) {
      const r = await new Client().post('/api/auth/signup', body({ pin, pinConfirm: pin }));
      expect(r.status, pin).toBe(400);
      expect(r.code, pin).toBe('PIN_TOO_WEAK');
    }
    expect(await h.count('user')).toBe(0);
  });

  it('PIN ใกล้เคียงแต่ไม่ต้องห้าม (เช่น 123457, 111112, 654320) ตั้งได้', async () => {
    for (const [i, pin] of ['123457', '111112', '654320', '121212'].entries()) {
      const r = await new Client().post('/api/auth/signup', body({ username: `ok_user_${i}`, pin, pinConfirm: pin }));
      expect(r.status, pin).toBe(201);
    }
  });

  it('PIN กับ PIN ยืนยันไม่ตรง → PIN_MISMATCH', async () => {
    const r = await new Client().post('/api/auth/signup', body({ pinConfirm: '864209' }));
    expect(r.status).toBe(400);
    expect(r.code).toBe('PIN_MISMATCH');
  });

  it('displayName: ว่าง/เกิน 40 ตัวอักษร → VALIDATION · 40 พอดี (ภาษาไทย/อีโมจิ) ผ่าน', async () => {
    const bad = await new Client().post('/api/auth/signup', body({ displayName: '   ' }));
    expect(bad.code).toBe('VALIDATION');
    const long = await new Client().post('/api/auth/signup', body({ displayName: 'ก'.repeat(41) }));
    expect(long.code).toBe('VALIDATION');
    const ok = await new Client().post('/api/auth/signup', body({ displayName: 'ก'.repeat(40) }));
    expect(ok.status).toBe(201);
  });

  it('ไม่รับฟิลด์แปลก (strict) — isAdmin/is_admin/status ใน body → VALIDATION และไม่มีผู้ใช้ถูกสร้าง', async () => {
    for (const extra of [{ isAdmin: true }, { is_admin: 1 }, { status: 'active' }, { mustChangePin: false }]) {
      const r = await new Client().post('/api/auth/signup', body(extra));
      expect(r.status).toBe(400);
      expect(r.code).toBe('VALIDATION');
    }
    expect(await h.count('user')).toBe(0);
  });

  it('hash ของผู้ใช้ใหม่เป็น argon2id ด้วย pepper เวอร์ชันปัจจุบัน', async () => {
    await new Client().post('/api/auth/signup', body());
    const [row] = await h.rows<{ pin_hash: string; pin_pepper_version: number }>('SELECT pin_hash, pin_pepper_version FROM user');
    expect(row!.pin_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(row!.pin_pepper_version).toBe(1);
  });
});
