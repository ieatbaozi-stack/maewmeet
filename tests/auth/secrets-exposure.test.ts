// ADR 0002 Test requirement 12 + 17: ไม่มี PIN/hash/token/pepper ใน log และ response ตลอด flow ทั้งหมด
// จับ console.* ทุกระดับระหว่าง signup → login ผิด/ถูก → lockout → reset → approve → 123456 → ตั้ง PIN → เปลี่ยน PIN → logout-all → pepper ล่ม
// แล้วค้นสตริง PIN, token (session/device), `$argon2id$`, pepper, fingerprint เต็ม — ไม่เจอ
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listPepperFingerprintPrefixes, readPepperHealth, pepperFingerprint } from '@/lib/auth/pepper';
import { RESET_PIN } from '@/lib/auth/pin-rules';
import { Client, freshPepper, loggedIn, RESET_COOKIE, SESSION_COOKIE, setPepperEnv, setupHarness, type Harness, type Res } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

// PIN ที่ใช้ในเทสต์นี้โดยเฉพาะ (6 หลัก ไม่ชนกับตัวเลขในเวลา/ID)
const PIN_A = '482915';
const PIN_B = '730164';
const PIN_C = '905318';
const PIN_WRONG = '618273';

describe('ไม่มีความลับใน log/response', () => {
  it('flow ทั้งหมด: console.* ทุกระดับ + body ของทุก response + Set-Cookie ที่ไม่ใช่คุกกี้ session/reset ไม่มีค่าลับ', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    const responses: Res[] = [];
    const tokens = new Set<string>();
    const pins = new Set([PIN_A, PIN_B, PIN_C, PIN_WRONG]);
    const track = async (p: Promise<Res>) => {
      const r = await p;
      responses.push(r);
      return r;
    };
    const grab = (c: Client) => {
      for (const n of [SESSION_COOKIE, RESET_COOKIE]) {
        const v = c.get(n);
        if (v) tokens.add(v);
      }
    };

    // สมัคร → logout → login ผิด x5 (ล็อก) → ครบเวลา → login ถูก
    const u = new Client();
    await track(u.post('/api/auth/signup', { username: 'alice', displayName: 'Alice', pin: PIN_A, pinConfirm: PIN_A }));
    grab(u);
    await track(u.post('/api/auth/logout'));
    for (let i = 0; i < 5; i++) await track(u.login('alice', PIN_WRONG));
    await track(u.login('alice', PIN_A)); // ระหว่างล็อก
    h.clock.advance(120_000);
    await track(u.login('alice', PIN_A));
    grab(u);

    // reset flow: ขอ → admin อนุมัติ → 123456 → ตั้ง PIN ใหม่ → เปลี่ยน PIN → logout-all
    const boss = await loggedIn(h, 'boss', PIN_B, { admin: true });
    grab(boss.c);
    const dev = new Client();
    await track(dev.post('/api/auth/pin-reset', { username: 'alice' }));
    grab(dev);
    await track(dev.getJson('/api/auth/pin-reset/status'));
    const list = await track(boss.c.getJson('/api/auth/admin/pin-resets'));
    const id = ((list.data as { items: { id: string }[] }).items[0] as { id: string }).id;
    await track(boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`));
    h.clock.advance(120_000); // พ้นช่วงล็อกของ alice
    await track(dev.login('alice', RESET_PIN));
    grab(dev);
    await track(dev.post('/api/auth/pin', { newPin: PIN_C, newPinConfirm: PIN_C }));
    await track(dev.post('/api/auth/pin', { newPin: PIN_A, newPinConfirm: PIN_A, currentPin: PIN_WRONG }));
    await track(dev.post('/api/auth/pin', { newPin: PIN_A, newPinConfirm: PIN_A, currentPin: PIN_C }));
    await track(dev.getJson('/api/auth/session'));
    await track(dev.post('/api/auth/logout-all'));
    await track(boss.c.getJson('/api/auth/session'));

    // pepper ล่ม (log PEPPER_CHECK_FAILED) + health ข้อมูล
    const pepperV1 = h.peppers[1]!;
    const fullFp = pepperFingerprint(Buffer.from(pepperV1, 'base64'));
    setPepperEnv({ 1: freshPepper() }, 1);
    await track(new Client().login('alice', PIN_A));
    setPepperEnv({ 1: pepperV1 }, 1);
    const health = await readPepperHealth(h.db, h.clock.now());
    const prefixes = await listPepperFingerprintPrefixes(h.db);

    // ── ค้นหา ──
    const bodies = responses.map((r) => r.text).join('\n');
    const logged = logs.join('\n');
    const dbDump = JSON.stringify(await h.rows('SELECT * FROM audit_log')) + JSON.stringify(await h.rows('SELECT * FROM notification'));
    const surfaces: [string, string][] = [
      ['response bodies', bodies],
      ['console', logged],
      ['audit/notification', dbDump],
      ['health data', JSON.stringify(health)],
    ];
    expect(responses.length).toBeGreaterThan(20);
    expect(tokens.size).toBeGreaterThanOrEqual(3);

    const forbidden: [string, string][] = [
      ...[...pins].map((p): [string, string] => ['PIN ' + p, p]),
      ['argon2 hash', '$argon2id$'],
      ['pepper V1', pepperV1],
      ['pepper V1 (hex)', Buffer.from(pepperV1, 'base64').toString('hex')],
      ['fingerprint เต็ม', fullFp],
      ['fingerprint 16 ตัว', fullFp.slice(0, 16)],
      ['APP_SECRET', process.env.APP_SECRET!],
      ...[...tokens].map((t): [string, string] => ['token ' + t.slice(0, 6) + '…', t]),
    ];
    for (const [name, needle] of forbidden) {
      for (const [where, text] of surfaces) expect(text, `${name} ใน ${where}`).not.toContain(needle);
    }
    // 123456 อยู่ในข้อความได้ (ค่าตายตัวของระบบ ไม่ใช่ความลับ) — แต่ log ก็ไม่ควรมีผู้ใช้/PIN ใด ๆ อยู่ดี
    expect(logged).not.toMatch(/alice/i);
    // log ที่มีต้องเป็นรหัสเหตุการณ์ + ชื่อตัวแปรเท่านั้น
    for (const line of logs) expect(line).toMatch(/^\[(auth|api)\]/);

    // ข้อ 17: หน้า admin/สถานะ pepper ให้แค่ prefix 8 ตัว
    expect(prefixes).toEqual([{ version: 1, prefix: fullFp.slice(0, 8) }]);
    expect(health).toEqual({ ok: true, currentVersion: 1, usersByVersion: expect.any(Object) });
  });

  it('คุกกี้ session อยู่ใน Set-Cookie เท่านั้น ไม่อยู่ใน body ของ login/signup/session', async () => {
    const c = new Client();
    const s = await c.post('/api/auth/signup', { username: 'carol', displayName: 'C', pin: PIN_A, pinConfirm: PIN_A });
    const token = c.get(SESSION_COOKIE)!;
    expect(s.text).not.toContain(token);
    const r = await c.getJson('/api/auth/session');
    expect(r.text).not.toContain(token);
    expect(r.text).not.toMatch(/pinHash|pin_hash|hash|token|pepper|argon/i);
  });

  it('error ที่ไม่คาดคิด: log มีแค่ชื่อชนิด ไม่มีข้อความ/ค่า (route wrapper) แม้เกิดระหว่างตรวจ PIN', async () => {
    await h.seedUser('dave', PIN_A);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.rows('DROP TABLE login_throttle'); // ทำให้ขั้นนับ throttle ล้ม
    const r = await new Client().login('dave', PIN_WRONG);
    expect(r.status).toBe(500);
    expect(r.code).toBe('UNKNOWN');
    const out = spy.mock.calls.map((a) => a.join(' ')).join('\n');
    expect(out).toMatch(/unexpected/);
    expect(out).not.toContain(PIN_A);
    expect(out).not.toContain(PIN_WRONG);
    expect(out).not.toMatch(/argon2|login_throttle|SELECT|INSERT/i);
  });
});
