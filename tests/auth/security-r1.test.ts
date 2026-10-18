// Review fixes S1–S3, S7 (ADR 0002 §3, §5)
//  S1 จองความพยายามแบบอะตอมมิกก่อน verify: ขนาน N=60 ต้อง verify ≤ 5 ครั้งต่อ username (และ ≤ 20 ต่อ IP) · PIN ถูกใน burst หลังล็อกไม่เข้า
//  S2 อนุมัติคำขอของตัวเองไม่ได้ · S3 approve ล้าง login_throttle + 123456 กับเครื่องที่ตรงข้ามล็อก username (ยังกินโควตา IP)
//  S7 ใช้ reset = ธุรกรรมเดียว (ล้มกลางทาง → ไม่เหลือสถานะครึ่งทาง) · ชนล็อกเขียน → 409 ไม่ใช่ 500
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const counts = vi.hoisted(() => ({ verifyPin: 0, verifyDummy: 0 }));
vi.mock('@/lib/auth/pin', async (orig) => {
  const m = await orig<typeof import('@/lib/auth/pin')>();
  return {
    ...m,
    verifyPin: (...a: Parameters<typeof m.verifyPin>) => (counts.verifyPin++, m.verifyPin(...a)),
    verifyDummy: (...a: Parameters<typeof m.verifyDummy>) => (counts.verifyDummy++, m.verifyDummy(...a)),
  };
});

import { getDb } from '@/db/client';
import { RESET_PIN } from '@/lib/auth/pin-rules';
import { Client, GOOD_PIN, loggedIn, OTHER_PIN, RESET_COOKIE, setupHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  counts.verifyPin = 0;
  counts.verifyDummy = 0;
  h = await setupHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const verifications = () => counts.verifyPin + counts.verifyDummy;
const N = 60;
/** 60 PIN ที่ต่างกัน — ตำแหน่ง `at` เป็น PIN ที่ถูก */
const guesses = (correct: string, at: number): string[] =>
  Array.from({ length: N }, (_, i) => (i === at ? correct : String(100_000 + ((i * 7919) % 800_000))));
const throttle = async (u: string) =>
  (await h.rows<{ failures: number; locked_until: number | null }>('SELECT failures, locked_until FROM login_throttle WHERE key = ?', [`u:${u}`]))[0];

describe('S1: จองก่อน verify (ไม่มี check-then-act)', () => {
  it('ขนาน 60 คำขอ (คนละ IP) รวม PIN ถูก 1 ตัว → verify ≤ 5 ครั้ง · สำเร็จ ≤ 1 · ที่เหลือ LOGIN_LOCKED', async () => {
    for (const at of [0, 20, 59]) {
      counts.verifyPin = counts.verifyDummy = 0;
      const name = `victim${at}`;
      await h.seedUser(name);
      const rs = await Promise.all(guesses(GOOD_PIN, at).map((pin) => new Client().login(name, pin)));
      expect(verifications(), `at=${at}`).toBeLessThanOrEqual(5);
      const ok = rs.filter((r) => r.status === 200);
      expect(ok.length).toBeLessThanOrEqual(1);
      const tally = rs.reduce<Record<string, number>>((m, r) => ((m[r.code ?? 'OK'] = (m[r.code ?? 'OK'] ?? 0) + 1), m), {});
      expect(Object.keys(tally).every((k) => ['OK', 'INVALID_CREDENTIALS', 'LOGIN_LOCKED'].includes(k)), JSON.stringify(tally)).toBe(true);
      expect(rs.filter((r) => r.code === 'LOGIN_LOCKED').length).toBeGreaterThanOrEqual(N - 5);
    }
  });

  it('5 ครั้งผิดถูกใช้หมดแล้ว: burst 60 รวม PIN ถูก × 5 รอบ → 200 = 0 · verify = 0 · ตัวนับไม่ขยับ', async () => {
    await h.seedUser('victim');
    for (let i = 0; i < 5; i++) await new Client().login('victim', OTHER_PIN);
    const before = await throttle('victim');
    expect(before?.failures).toBe(5);
    counts.verifyPin = counts.verifyDummy = 0;
    for (let round = 0; round < 5; round++) {
      const rs = await Promise.all(guesses(GOOD_PIN, round * 11).map((pin) => new Client().login('victim', pin)));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(0);
      expect(new Set(rs.map((r) => r.code))).toEqual(new Set(['LOGIN_LOCKED']));
    }
    expect(verifications()).toBe(0);
    expect(await throttle('victim')).toEqual(before);
    expect(await h.rows('SELECT * FROM session')).toHaveLength(0);
  });

  it('IP เดียวขนาน 60 (ต่าง username ที่ไม่มีจริง) → verify ≤ 20 (เพดาน IP) · ที่เหลือ RATE_LIMITED', async () => {
    const rs = await Promise.all(Array.from({ length: N }, (_, i) => new Client('198.51.100.9').login(`ghost_${i}`, OTHER_PIN)));
    expect(verifications()).toBeLessThanOrEqual(20);
    expect(rs.filter((r) => r.code === 'RATE_LIMITED')).toHaveLength(N - 20);
    expect((await h.rows<{ count: number }>("SELECT count FROM rate_limit_bucket WHERE key LIKE 'login:ip:%'"))[0]!.count).toBe(20);
  });

  it('IP เดียว + username เดียวขนาน 60 รวม PIN ถูก (t4) → verify ≤ 5 · ช่อง IP ของคำขอที่ถูกล็อกถูกคืน (ถังไม่เกิน 5)', async () => {
    await h.seedUser('victim');
    const rs = await Promise.all(guesses(GOOD_PIN, 30).map((pin) => new Client('198.51.100.10').login('victim', pin)));
    expect(verifications()).toBeLessThanOrEqual(5);
    expect(rs.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    const bucket = Number((await h.rows<{ count: number }>("SELECT count FROM rate_limit_bucket WHERE key LIKE 'login:ip:%'"))[0]!.count);
    expect(bucket).toBeLessThanOrEqual(5);
  });

  it('สำเร็จคืนช่อง IP + ล้างตัวนับ username: ผิด 3 แล้วถูก → failures 0 · ถัง IP = 0', async () => {
    await h.seedUser('victim');
    const c = new Client('198.51.100.11');
    for (let i = 0; i < 3; i++) await c.login('victim', OTHER_PIN);
    expect(Number((await h.rows<{ count: number }>("SELECT count FROM rate_limit_bucket"))[0]!.count)).toBe(3);
    expect((await c.login('victim', GOOD_PIN)).status).toBe(200);
    expect((await throttle('victim'))!.failures).toBe(0);
    expect(Number((await h.rows<{ count: number }>("SELECT count FROM rate_limit_bucket"))[0]!.count)).toBe(3); // 3 ผิด ยังอยู่ · ครั้งที่สำเร็จคืนช่องของตัวเอง
    // ขนานสำเร็จ 4 ครั้ง (ใช้ช่อง username ได้สูงสุด 4 < เกณฑ์ล็อก 5) จาก IP เดียว: ไม่ติดเพดาน และถังไม่เพิ่ม
    const ok = await Promise.all(Array.from({ length: 4 }, () => new Client('198.51.100.11').login('victim', GOOD_PIN)));
    expect(ok.every((r) => r.status === 200)).toBe(true);
    expect(Number((await h.rows<{ count: number }>("SELECT count FROM rate_limit_bucket"))[0]!.count)).toBe(3);
  });

  it('ดีฟอลต์เดิมคงอยู่: attemptsRemaining 4,3,2,1 · ครั้งที่ 5 LOGIN_LOCKED 60 วินาที · ghost ตอบเหมือน user จริงทุกไบต์ (ไล่ถึงล็อก)', async () => {
    await h.seedUser('real');
    const seen = async (name: string) => {
      const c = new Client();
      const out: string[] = [];
      for (let i = 0; i < 6; i++) out.push((await c.login(name, OTHER_PIN)).text);
      return out;
    };
    const real = await seen('real');
    const ghost = await seen('real_not');
    expect(ghost).toEqual(real.map((t) => t)); // ข้อความ error ไม่มีชื่อ จึงเทียบตรงได้
    expect(real.map((t) => JSON.parse(t).error.params)).toEqual([
      { attemptsRemaining: 4 },
      { attemptsRemaining: 3 },
      { attemptsRemaining: 2 },
      { attemptsRemaining: 1 },
      { retryAfterSec: 60 },
      { retryAfterSec: 60 },
    ]);
  });

  it('เปลี่ยน PIN (currentPin): ขนาน 60 รวมค่าถูก → verify ≤ 5 · ใช้ตัวนับชุดเดียวกับ login', async () => {
    const { c: me } = await loggedIn(h, 'alice');
    counts.verifyPin = counts.verifyDummy = 0;
    const rs = await Promise.all(
      guesses(GOOD_PIN, 40).map((pin) => me.post('/api/auth/pin', { newPin: '482915', newPinConfirm: '482915', currentPin: pin })),
    );
    expect(verifications()).toBeLessThanOrEqual(5);
    expect(rs.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    // ผู้โจมตีเปลี่ยนจุดเข้าไม่ได้: login ต่อจากนี้ก็ถูกล็อกด้วยตัวนับเดียวกัน (ถ้า 5 ผิดหมดก่อน)
    const t = await throttle('alice');
    expect(t).toBeDefined();
  });
});

describe('S2: อนุมัติคำขอของตัวเองไม่ได้', () => {
  it('super admin approve คำขอของตัวเอง → 403 FORBIDDEN · คำขอยัง pending · pin_hash ไม่ถูกล้าง · ไม่มี audit · SA คนอื่น approve ได้', async () => {
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    const boss2 = await loggedIn(h, 'boss2', GOOD_PIN, { admin: true });
    await new Client().post('/api/auth/pin-reset', { username: 'boss' });
    const [{ id }] = (await h.rows<{ id: string }>("SELECT id FROM pin_reset_request WHERE status = 'pending'")) as [{ id: string }];
    const self = await boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`);
    expect(self.status).toBe(403);
    expect(self.code).toBe('FORBIDDEN');
    expect((await h.rows<{ status: string }>('SELECT status FROM pin_reset_request WHERE id = ?', [id]))[0]!.status).toBe('pending');
    expect((await h.rows<{ pin_hash: string | null }>("SELECT pin_hash FROM user WHERE username = 'boss'"))[0]!.pin_hash).not.toBeNull();
    expect(await h.count('audit_log')).toBe(0);
    expect(await h.count('notification')).toBe(0);
    // ปฏิเสธคำขอตัวเองทำได้ (ไม่ให้สิทธิ์เพิ่ม)
    expect((await boss2.c.post(`/api/auth/admin/pin-resets/${id}/approve`)).status).toBe(200);
  });
});

describe('S3: approve ล้างตัวนับ + 123456 กับเครื่องที่ตรงข้ามล็อก username', () => {
  async function lockAlice() {
    await h.seedUser('alice');
    for (let i = 0; i < 5; i++) await new Client().login('alice', OTHER_PIN);
    expect((await throttle('alice'))!.locked_until).not.toBeNull();
  }

  it('approve → login_throttle ของ user นั้นเป็น failures 0 / ไม่ล็อก (และของคนอื่นไม่ถูกแตะ)', async () => {
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    await h.seedUser('bob');
    await new Client().login('bob', OTHER_PIN);
    await lockAlice();
    const phone = new Client();
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await h.rows<{ id: string }>("SELECT id FROM pin_reset_request WHERE status = 'pending'")) as [{ id: string }];
    expect((await boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`)).status).toBe(200);
    expect(await throttle('alice')).toEqual({ failures: 0, locked_until: null });
    expect((await throttle('bob'))!.failures).toBe(1);
    expect((await phone.login('alice', RESET_PIN)).status).toBe(200);
  });

  it('ถูกล็อกซ้ำหลัง approve → 123456 + คุกกี้เครื่องที่ตรง เข้าได้ (ข้ามล็อก) · เครื่องอื่น/ไม่มีคุกกี้ยัง LOGIN_LOCKED · ตัวนับไม่ขยับ', async () => {
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    await h.seedUser('alice');
    const phone = new Client();
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await h.rows<{ id: string }>("SELECT id FROM pin_reset_request WHERE status = 'pending'")) as [{ id: string }];
    await boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`);
    for (let i = 0; i < 5; i++) await new Client().login('alice', OTHER_PIN); // ผู้โจมตีล็อกบัญชีหลัง approve
    const locked = await throttle('alice');
    expect(locked!.locked_until).not.toBeNull();

    const attacker = new Client();
    await attacker.post('/api/auth/pin-reset', { username: 'zzz_nobody' });
    for (const c of [new Client(), attacker]) {
      const r = await c.login('alice', RESET_PIN);
      expect(r.code).toBe('LOGIN_LOCKED');
    }
    expect(await throttle('alice')).toEqual(locked);

    const ok = await phone.login('alice', RESET_PIN);
    expect(ok.status).toBe(200);
    expect(ok.data.user).toMatchObject({ username: 'alice', mustChangePin: true });
    expect(await throttle('alice')).toEqual({ failures: 0, locked_until: null });
  });

  it('ข้ามล็อก username แต่ยังกินโควตา IP: ถัง IP เต็ม → RATE_LIMITED แม้คุกกี้ตรง', async () => {
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    await h.seedUser('alice');
    const ip = '198.51.100.77';
    const phone = new Client(ip);
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await h.rows<{ id: string }>("SELECT id FROM pin_reset_request WHERE status = 'pending'")) as [{ id: string }];
    await boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`);
    for (let i = 0; i < 20; i++) await new Client(ip).login(`ghost_${i}`, OTHER_PIN);
    const r = await phone.login('alice', RESET_PIN);
    expect(r.status).toBe(429);
    expect(r.code).toBe('RATE_LIMITED');
    expect((await h.rows<{ status: string }>('SELECT status FROM pin_reset_request WHERE id = ?', [id]))[0]!.status).toBe('approved');
  });
});

describe('S7: ใช้ reset = ธุรกรรมเดียว', () => {
  async function approvedAlice() {
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    await h.seedUser('alice');
    const phone = new Client();
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await h.rows<{ id: string }>("SELECT id FROM pin_reset_request WHERE status = 'pending'")) as [{ id: string }];
    await boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`);
    return { phone, id };
  }
  const state = async (id: string) => ({
    status: (await h.rows<{ status: string }>('SELECT status FROM pin_reset_request WHERE id = ?', [id]))[0]!.status,
    mustChange: (await h.rows<{ m: number }>("SELECT must_change_pin AS m FROM user WHERE username = 'alice'"))[0]!.m,
    sessions: await h.count("session WHERE user_id = (SELECT id FROM user WHERE username = 'alice')"),
  });

  it('สร้าง session ล้มกลางทาง → rollback ทั้งก้อน: คำขอยัง approved · must_change_pin=0 · ไม่มี session · ลองใหม่สำเร็จ', async () => {
    const { phone, id } = await approvedAlice();
    await h.rows("CREATE TRIGGER boom BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const r = await phone.login('alice', RESET_PIN);
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(await state(id)).toEqual({ status: 'approved', mustChange: 0, sessions: 0 });
    await h.rows('DROP TRIGGER boom');
    expect((await phone.login('alice', RESET_PIN)).status).toBe(200);
    expect(await state(id)).toEqual({ status: 'used', mustChange: 1, sessions: 1 });
  });

  it('ชนล็อกเขียน (SQLITE_BUSY ในธุรกรรม) → 409 CONFLICT (ไม่ใช่ 500) · ไม่เหลือสถานะครึ่งทาง · ช่อง IP ถูกคืน · ลองใหม่สำเร็จ', async () => {
    const { phone, id } = await approvedAlice();
    const busy = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' });
    const spy = vi.spyOn(getDb(), 'transaction').mockRejectedValueOnce(busy);
    const r = await phone.login('alice', RESET_PIN);
    spy.mockRestore();
    expect(r.status).toBe(409);
    expect(r.code).toBe('CONFLICT');
    expect(await state(id)).toEqual({ status: 'approved', mustChange: 0, sessions: 0 });
    const bucket = await h.rows<{ count: number }>("SELECT count FROM rate_limit_bucket WHERE key LIKE 'login:ip:%'");
    expect(Number(bucket[0]?.count ?? 0)).toBe(0);
    expect((await phone.login('alice', RESET_PIN)).status).toBe(200);
    expect(await state(id)).toEqual({ status: 'used', mustChange: 1, sessions: 1 });
  });
});
