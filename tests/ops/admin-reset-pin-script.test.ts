// scripts/admin-reset-pin.ts — break-glass ADR 0002 §7.4 · R1-8 · DB = libSQL ไฟล์ชั่วคราวที่รัน migration จริง
// สถานการณ์จริงที่จำลอง: pepper V1 หายทุกสำเนา → boss ตั้ง V2 ใหม่ (V1 ไม่อยู่ใน env) → รันสคริปต์ → login ด้วย 123456 + cookie → ตั้ง PIN ใหม่
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESET_PIN } from '@/lib/auth/pin-rules';
import { resetPepperCache } from '@/lib/auth/pepper';
import { RESET_COOKIE_DEV, RESET_COOKIE_PROD } from '@/lib/auth/session';
import { sha256Hex } from '@/lib/auth/tokens';
import { breakGlassReset, checkConfirmation, parseArgs, type Args } from '../../scripts/admin-reset-pin';
import { Client, DAY, freshPepper, GOOD_PIN, OTHER_PIN, RESET_COOKIE, setPepperEnv, setupHarness, type Harness } from '../auth/harness';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/admin-reset-pin.ts');
const TSX = path.join(ROOT, 'node_modules/.bin/tsx');
const OK_ARGS = ['--username', 'boss', '--confirm-username', 'boss', '--confirm-pepper-lost'];

let h: Harness;
beforeEach(async () => {
  h = await setupHarness(); // pepper V1 (ในเทสต์เท่านั้น)
});
afterEach(async () => {
  await h.cleanup();
});

/** จำลอง "pepper V1 หายหมด": env ของ Vercel ใหม่มีแต่ V2 */
function losePepper(): { v2: string } {
  const v2 = freshPepper();
  setPepperEnv({ 2: v2 }, 2);
  resetPepperCache();
  return { v2 };
}

const argsOf = (...a: string[]): Args => parseArgs(a);
const NO_ENV = {}; // เครื่องของ boss ไม่มี pepper ใน env

async function snapshot() {
  return {
    users: await h.rows('SELECT id, pin_hash, must_change_pin, is_admin FROM user ORDER BY id'),
    resets: await h.rows('SELECT * FROM pin_reset_request ORDER BY id'),
    audit: await h.count('audit_log'),
  };
}

describe('ยืนยันก่อนทำ (ไม่แตะฐานถ้าไม่ครบ)', () => {
  it('parseArgs: รูป --a b และ --a=b · ไม่รู้จัก/ซ้ำ/ค่าที่ติดมากับ flag ยืนยัน → unknown', () => {
    expect(parseArgs(OK_ARGS)).toMatchObject({ username: 'boss', confirmUsername: 'boss', confirmPepperLost: true, unknown: [] });
    expect(parseArgs(['--username=boss', '--confirm-username=boss', '--confirm-pepper-lost'])).toMatchObject({ username: 'boss', confirmUsername: 'boss' });
    expect(parseArgs([...OK_ARGS, '--pin', '123456']).unknown).toEqual(['--pin', '123456']);
    expect(parseArgs(['--username', 'a', '--username', 'b']).unknown).toEqual(['--username', 'b']); // ซ้ำ = ปฏิเสธ
    expect(parseArgs(['--confirm-pepper-lost=yes']).unknown).toEqual(['--confirm-pepper-lost']);
  });

  it.each([
    ['ไม่มี --username', ['--confirm-username', 'boss', '--confirm-pepper-lost']],
    ['ไม่มี --confirm-pepper-lost', ['--username', 'boss', '--confirm-username', 'boss']],
    ['ไม่มี --confirm-username', ['--username', 'boss', '--confirm-pepper-lost']],
    ['confirm-username ไม่ตรง', ['--username', 'boss', '--confirm-username', 'bos', '--confirm-pepper-lost']],
    ['มี argument แปลก', [...OK_ARGS, '--force']],
  ])('%s → code 2 และฐานไม่เปลี่ยนเลย', async (_n, argv) => {
    await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    losePepper();
    const before = await snapshot();
    expect(checkConfirmation(parseArgs(argv))).not.toBeNull();
    const r = await breakGlassReset(h.db, parseArgs(argv), h.clock.now(), { env: NO_ENV });
    expect(r).toMatchObject({ ok: false, code: 2 });
    expect(await snapshot()).toEqual(before);
  });

  it('confirm-username เทียบแบบ normalize เดียวกับระบบ (ตัวพิมพ์ใหญ่/เล็กไม่สำคัญ)', async () => {
    await h.seedUser('Boss', GOOD_PIN, { isAdmin: true });
    losePepper();
    const r = await breakGlassReset(h.db, argsOf('--username', 'Boss', '--confirm-username', 'boss', '--confirm-pepper-lost'), h.clock.now(), { env: NO_ENV });
    expect(r.ok).toBe(true);
  });
});

describe('เงื่อนไขความปลอดภัย → code 3 ฐานไม่เปลี่ยน', () => {
  it.each([
    ['ไม่มีบัญชีชื่อนี้', async () => {}],
    ['มีบัญชีแต่ไม่ใช่ super admin', async () => void (await h.seedUser('boss', GOOD_PIN))],
    ['super admin ถูกระงับ', async () => {
      await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
      await h.rows("UPDATE user SET status = 'suspended' WHERE username = 'boss'");
    }],
  ])('%s', async (_n, setup) => {
    await setup();
    losePepper();
    const before = await snapshot();
    const r = await breakGlassReset(h.db, parseArgs(OK_ARGS), h.clock.now(), { env: NO_ENV });
    expect(r).toMatchObject({ ok: false, code: 3 });
    expect(await snapshot()).toEqual(before);
  });

  it('pepper ใน env ของเครื่องนี้ยังตรงกับ fingerprint ในฐาน (ไม่ได้หายจริง) → ปฏิเสธ', async () => {
    await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    const before = await snapshot();
    expect((await h.rows('SELECT version FROM pepper_fingerprint')).length).toBe(1);
    const r = await breakGlassReset(h.db, parseArgs(OK_ARGS), h.clock.now(), {
      env: { PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: h.peppers[1]! },
    });
    expect(r).toMatchObject({ ok: false, code: 3 });
    expect(await snapshot()).toEqual(before);
  });

  it('env มี pepper แต่เป็นค่าผิด (ไม่ตรง fingerprint) → ถือว่าหายจริง ทำต่อได้', async () => {
    await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    const r = await breakGlassReset(h.db, parseArgs(OK_ARGS), h.clock.now(), {
      env: { PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: freshPepper() },
    });
    expect(r.ok).toBe(true);
  });
});

describe('ผลที่เขียนลงฐาน', () => {
  it('เปิดคำขอ approved ผูก device token (เก็บเฉพาะ hash) · pin_hash NULL · must_change_pin · audit · ผู้ใช้อื่นไม่ถูกแตะ · is_admin ไม่เปลี่ยน', async () => {
    const boss = await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    const other = await h.seedUser('somchai', OTHER_PIN);
    const otherBefore = (await h.rows('SELECT * FROM user WHERE id = ?', [other.id]))[0];
    // คำขอ pending เดิมของ boss ต้องไม่ชน partial unique index
    await h.rows(
      "INSERT INTO pin_reset_request (id, user_id, status, device_token_hash, requested_at, pending_expires_at) VALUES ('old', ?, 'pending', 'x', ?, ?)",
      [boss.id, h.clock.now(), h.clock.now() + 7 * DAY],
    );
    losePepper();
    const now = h.clock.now();
    const r = await breakGlassReset(h.db, parseArgs(OK_ARGS), now, { env: NO_ENV });
    if (!r.ok) throw new Error(r.message);

    expect(r.expiresAt).toBe(now + DAY);
    expect(r.cookieName).toBe(RESET_COOKIE_PROD);
    const reqs = await h.rows<Record<string, unknown>>('SELECT * FROM pin_reset_request WHERE user_id = ? ORDER BY requested_at, id', [boss.id]);
    expect(reqs.map((x) => x.status).sort()).toEqual(['approved', 'cancelled']);
    const approved = reqs.find((x) => x.status === 'approved')!;
    expect(approved).toMatchObject({ id: r.requestId, device_token_hash: sha256Hex(r.deviceToken), expires_at: now + DAY, decided_by: null });
    // ไม่มี token ดิบในฐานทุกตาราง
    for (const tbl of ['user', 'pin_reset_request', 'audit_log', 'session', 'notification']) {
      expect(JSON.stringify(await h.rows(`SELECT * FROM ${tbl}`)), tbl).not.toContain(r.deviceToken);
    }
    const [u] = await h.rows<Record<string, unknown>>('SELECT pin_hash, must_change_pin, is_admin FROM user WHERE id = ?', [boss.id]);
    expect(u).toEqual({ pin_hash: null, must_change_pin: 1, is_admin: 1 });
    expect((await h.rows('SELECT * FROM user WHERE id = ?', [other.id]))[0]).toEqual(otherBefore);
    const audit = await h.rows<Record<string, unknown>>("SELECT actor_id, action, target_type, target_id, meta FROM audit_log WHERE action = 'script.adminResetPin'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: null, target_type: 'pin_reset', target_id: r.requestId });
    expect(JSON.stringify(audit[0])).not.toContain(r.deviceToken);
  });

  it('รันซ้ำ → ออก token ใหม่ ของเก่าใช้ไม่ได้ (เหลือคำขอ approved เดียว)', async () => {
    await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    losePepper();
    const a = await breakGlassReset(h.db, parseArgs(OK_ARGS), h.clock.now(), { env: NO_ENV });
    const b = await breakGlassReset(h.db, parseArgs(OK_ARGS), h.clock.now() + 1000, { env: NO_ENV });
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.deviceToken).not.toBe(b.deviceToken);
    expect(await h.count("pin_reset_request WHERE status = 'approved'")).toBe(1);

    h.clock.set(h.clock.now() + 2000);
    const old = new Client();
    old.set(RESET_COOKIE, a.deviceToken);
    expect((await old.login('boss', RESET_PIN)).status).toBe(401);
  });
});

describe('ทั้งเส้นทางจริง: pepper หาย → สคริปต์ → login ด้วย 123456 บนเครื่องที่มี token → ถูกบังคับตั้ง PIN ใหม่', () => {
  it('สำเร็จ · เครื่องที่ไม่มี token / เกิน 24 ชม. / ใช้ซ้ำ ไม่ได้', async () => {
    await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    await h.seedUser('somchai', OTHER_PIN);
    const { v2 } = losePepper();
    const r = await breakGlassReset(h.db, parseArgs(OK_ARGS), h.clock.now(), { env: NO_ENV });
    if (!r.ok) throw new Error(r.message);

    // ก่อนแก้: ผู้ใช้อื่นที่ hash ด้วย V1 เข้าไม่ได้ (AUTH_MAINTENANCE เฉพาะกลุ่ม) แต่ boss ที่ pin_hash = NULL ไปต่อทาง reset ได้
    expect((await new Client().login('somchai', OTHER_PIN)).code).toBe('AUTH_MAINTENANCE');

    const stranger = new Client(); // ไม่มี cookie
    expect((await stranger.login('boss', RESET_PIN)).status).toBe(401);

    const device = new Client();
    device.set(RESET_COOKIE, r.deviceToken);
    const login = await device.login('boss', RESET_PIN);
    expect(login.status).toBe(200);
    expect(login.data).toMatchObject({ user: { mustChangePin: true, isAdmin: true } });
    expect((await device.getJson('/api/auth/admin/pin-resets')).code).toBe('PIN_CHANGE_REQUIRED');

    const change = await device.post('/api/auth/pin', { newPin: '482615', newPinConfirm: '482615' });
    expect(change.status).toBe(200);
    // PIN ใหม่ hash ด้วย V2 และใช้งานได้
    expect((await h.rows<{ v: number }>("SELECT pin_pepper_version AS v FROM user WHERE username = 'boss'"))[0]!.v).toBe(2);
    expect((await new Client().login('boss', '482615')).status).toBe(200);
    expect((await device.getJson('/api/auth/admin/pin-resets')).status).toBe(200); // super admin ใช้งานได้อีกครั้ง

    // ใช้ซ้ำไม่ได้
    const again = new Client();
    again.set(RESET_COOKIE, r.deviceToken);
    expect((await again.login('boss', RESET_PIN)).status).toBe(401);
    expect(v2.length).toBeGreaterThan(0);
  });

  it('เกิน 24 ชม. → ใช้ไม่ได้', async () => {
    await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    losePepper();
    const r = await breakGlassReset(h.db, parseArgs(OK_ARGS), h.clock.now(), { env: NO_ENV });
    if (!r.ok) throw new Error(r.message);
    h.clock.set(h.clock.now() + DAY + 1000);
    const device = new Client();
    device.set(RESET_COOKIE, r.deviceToken);
    expect((await device.login('boss', RESET_PIN)).status).toBe(401);
  });
});

describe('รันสคริปต์จริง (subprocess) — ผลที่พิมพ์', { timeout: 90_000 }, () => {
  const TURSO_TOKEN = 'turso-token-should-never-print-9f3a';
  const run = (argv: string[], env: Record<string, string>) => {
    const r = spawnSync(TSX, [SCRIPT, ...argv], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } as unknown as NodeJS.ProcessEnv,
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { code: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}\n${r.stderr}` };
  };

  it('พิมพ์ชื่อ cookie + token เท่านั้น · ไม่พิมพ์ PIN / pepper / TURSO_AUTH_TOKEN · token ใช้ login ได้จริง', async () => {
    await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    const { v2 } = losePepper();
    const r = run(OK_ARGS, { TURSO_DATABASE_URL: h.t.url, TURSO_AUTH_TOKEN: TURSO_TOKEN });
    expect(r.code).toBe(0);
    const m = /ค่า cookie\s*:\s*([a-z2-7]+)/.exec(r.out);
    expect(m, r.out).not.toBeNull();
    expect(r.out).toContain(RESET_COOKIE_DEV); // ฐานเป็น file: → ชื่อ dev
    for (const secret of [RESET_PIN, GOOD_PIN, OTHER_PIN, h.peppers[1]!, v2, TURSO_TOKEN, h.t.url]) {
      expect(r.all, 'ไม่ควรพิมพ์ความลับ').not.toContain(secret);
    }
    const device = new Client();
    device.set(RESET_COOKIE, m![1]!);
    expect((await device.login('boss', RESET_PIN)).status).toBe(200);
  });

  it('ไม่ใส่แฟลกยืนยัน / ไม่มี URL / URL ระยะไกลแต่ไม่มี token → ไม่ทำงาน (exit 2) ไม่มี stdout', async () => {
    await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    const before = await snapshot();
    for (const [argv, env] of [
      [['--username', 'boss'], { TURSO_DATABASE_URL: h.t.url }],
      [OK_ARGS, {}],
      [OK_ARGS, { TURSO_DATABASE_URL: 'libsql://example.turso.io' }],
    ] as const) {
      const r = run([...argv], { ...env });
      expect(r.code).toBe(2);
      expect(r.out).toBe('');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('ปฏิเสธเพราะ pepper ยังอยู่ (env ของ process มี pepper ที่ตรง) → exit 3 ไม่พิมพ์ pepper', async () => {
    await h.seedUser('boss', GOOD_PIN, { isAdmin: true });
    const before = await snapshot();
    const r = run(OK_ARGS, { TURSO_DATABASE_URL: h.t.url, PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: h.peppers[1]! });
    expect(r.code).toBe(3);
    expect(r.all).not.toContain(h.peppers[1]!);
    expect(await snapshot()).toEqual(before);
  });
});
