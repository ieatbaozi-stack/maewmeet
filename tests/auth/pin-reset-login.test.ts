// ADR 0002 Test requirement 7 + 8 (U2/D3): login กับ 123456
//  7) ระหว่าง pending: PIN เดิมเข้าได้ → คำขอ cancelled + notification · 123456 → INVALID_CREDENTIALS และนับ throttle
//  8) approved: 123456 + cookie ถูกเครื่อง → เข้าได้ must_change_pin=1 คำขอ used · ไม่มี cookie/เครื่องอื่น → INVALID_CREDENTIALS ·
//     PIN เดิมหลัง approve → ผิด · เลื่อน 24 ชม.+1 วินาที → ผิดและ expired (ไม่พึ่ง cron) · ใช้ซ้ำ → ผิด
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESET_PIN } from '@/lib/auth/pin-rules';
import { Client, DAY, GOOD_PIN, HOUR, loggedIn, OTHER_PIN, RESET_COOKIE, SESSION_COOKIE, setupHarness, type Harness } from './harness';

let h: Harness;
let boss: Awaited<ReturnType<typeof loggedIn>>;
beforeEach(async () => {
  h = await setupHarness();
  await h.seedUser('alice');
  boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
});
afterEach(async () => {
  await h.cleanup();
});

type Req = { id: string; status: string; used_at: number | null; expires_at: number | null; decided_by: string | null };
const reqs = () => h.rows<Req>('SELECT id, status, used_at, expires_at, decided_by FROM pin_reset_request ORDER BY requested_at');
const user = async () =>
  (await h.rows<{ pin_hash: string | null; must_change_pin: number }>("SELECT pin_hash, must_change_pin FROM user WHERE username = 'alice'"))[0]!;
const failures = async () =>
  (await h.rows<{ failures: number }>("SELECT failures FROM login_throttle WHERE key = 'u:alice'"))[0]?.failures ?? 0;

/** alice ขอจากเครื่อง `device` แล้ว boss อนุมัติ */
async function requestAndApprove(device: Client): Promise<string> {
  await device.post('/api/auth/pin-reset', { username: 'alice' });
  const [r] = await reqs();
  const res = await boss.c.post(`/api/auth/admin/pin-resets/${r!.id}/approve`);
  expect(res.status).toBe(200);
  return r!.id;
}

describe('ระหว่าง pending', () => {
  it('PIN เดิมเข้าได้ → คำขอ cancelled + notification pin_reset.cancelled_by_login 1 รายการ', async () => {
    const phone = new Client();
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    const other = new Client();
    const r = await other.login('alice', GOOD_PIN);
    expect(r.status).toBe(200);
    expect((await reqs())[0]!.status).toBe('cancelled');
    const notes = await h.rows<{ kind: string; user_id: string }>('SELECT kind, user_id FROM notification');
    expect(notes).toEqual([{ kind: 'pin_reset.cancelled_by_login', user_id: r.data.user ? (r.data.user as { id: string }).id : '' }]);
    // ขอใหม่ได้หลังยกเลิก
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    expect((await reqs()).map((x) => x.status)).toEqual(['cancelled', 'pending']);
  });

  it('123456 ระหว่าง pending → 401 INVALID_CREDENTIALS และนับ throttle (แม้เป็นเครื่องที่ขอ)', async () => {
    const phone = new Client();
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    expect(await failures()).toBe(0);
    const r = await phone.login('alice', RESET_PIN);
    expect(r.status).toBe(401);
    expect(r.json.error).toEqual({ code: 'INVALID_CREDENTIALS', params: { attemptsRemaining: 4 } });
    expect(await failures()).toBe(1);
    expect(phone.get(SESSION_COOKIE)).toBeUndefined();
    expect((await user()).must_change_pin).toBe(0);
    expect((await reqs())[0]!.status).toBe('pending');
  });

  it('123456 โดยไม่มีคำขอเลย → INVALID_CREDENTIALS เหมือนกัน และนับ throttle', async () => {
    const r = await new Client().login('alice', RESET_PIN);
    expect(r.code).toBe('INVALID_CREDENTIALS');
    expect(await failures()).toBe(1);
  });
});

describe('หลัง approve', () => {
  it('123456 + cookie เครื่องที่ขอ → เข้าได้ · must_change_pin=1 · คำขอ used · cookie mm_reset ถูกล้าง · มี session', async () => {
    const phone = new Client();
    const id = await requestAndApprove(phone);
    expect((await user()).pin_hash).toBeNull(); // PIN เดิมถูกล้าง
    const r = await phone.login('alice', RESET_PIN);
    expect(r.status).toBe(200);
    expect(r.data.user).toMatchObject({ username: 'alice', mustChangePin: true });
    expect(phone.get(SESSION_COOKIE)).toBeTruthy();
    expect(phone.get(RESET_COOKIE)).toBeUndefined();
    expect(r.setCookies.find((s) => s.startsWith(`${RESET_COOKIE}=`))).toMatch(/Max-Age=0/);
    const [row] = await reqs();
    expect(row).toMatchObject({ id, status: 'used', used_at: h.clock.now() });
    expect((await user()).must_change_pin).toBe(1);
    expect(await failures()).toBe(0);
  });

  it('123456 ไม่มี cookie → INVALID_CREDENTIALS · cookie เครื่องอื่น → INVALID_CREDENTIALS · ทั้งคู่นับ throttle และคำขอยัง approved', async () => {
    const phone = new Client();
    await requestAndApprove(phone);
    const nocookie = await new Client().login('alice', RESET_PIN);
    expect(nocookie.code).toBe('INVALID_CREDENTIALS');
    const attacker = new Client();
    await attacker.post('/api/auth/pin-reset', { username: 'somebody_else' }); // ได้ cookie mm_reset ของตัวเอง
    expect(attacker.get(RESET_COOKIE)).toBeTruthy();
    const wrongDevice = await attacker.login('alice', RESET_PIN);
    expect(wrongDevice.json.error).toEqual({ code: 'INVALID_CREDENTIALS', params: { attemptsRemaining: 3 } });
    expect(await failures()).toBe(2);
    expect((await reqs())[0]!.status).toBe('approved');
    // เจ้าของเครื่องจริงยังใช้ได้
    expect((await phone.login('alice', RESET_PIN)).status).toBe(200);
  });

  it('คัดลอก cookie ไปเครื่องอื่น = ใช้ได้ (ผูกด้วย token ไม่ใช่ IP) แต่ต้องมี cookie จริง — ค่าเดาไม่ผ่าน', async () => {
    const phone = new Client();
    await requestAndApprove(phone);
    const guess = new Client();
    guess.set(RESET_COOKIE, 'a'.repeat(52));
    expect((await guess.login('alice', RESET_PIN)).code).toBe('INVALID_CREDENTIALS');
  });

  it('PIN เดิมหลัง approve → ผิด (pin_hash ถูกล้าง)', async () => {
    await requestAndApprove(new Client());
    const r = await new Client().login('alice', GOOD_PIN);
    expect(r.status).toBe(401);
    expect(r.code).toBe('INVALID_CREDENTIALS');
  });

  it('เลื่อนนาฬิกา 24 ชม. + 1 วินาที → 123456 ผิด และคำขอเป็น expired (ไม่พึ่ง cron)', async () => {
    const phone = new Client();
    await requestAndApprove(phone);
    h.clock.advance(DAY + 1000);
    const r = await phone.login('alice', RESET_PIN);
    expect(r.code).toBe('INVALID_CREDENTIALS');
    expect((await reqs())[0]!.status).toBe('expired');
    expect((await user()).must_change_pin).toBe(0);
  });

  it('ขอบเขต: ก่อนครบ 24 ชม. 1 วินาที ยังใช้ได้ · พอดี 24 ชม. ใช้ไม่ได้', async () => {
    const a = new Client();
    await requestAndApprove(a);
    h.clock.advance(DAY - 1000);
    expect((await a.login('alice', RESET_PIN)).status).toBe(200);
  });

  it('พอดี 24 ชม. (now = expires_at) → ใช้ไม่ได้', async () => {
    const a = new Client();
    await requestAndApprove(a);
    h.clock.advance(DAY);
    expect((await a.login('alice', RESET_PIN)).code).toBe('INVALID_CREDENTIALS');
  });

  it('ใช้ 123456 ครั้งที่สอง → ผิด (ใช้ได้ครั้งเดียว) แม้ถือ cookie mm_reset เดิมที่สำเนาไว้ก่อนเข้า', async () => {
    const phone = new Client();
    await requestAndApprove(phone);
    const copiedToken = phone.get(RESET_COOKIE)!;
    expect((await phone.login('alice', RESET_PIN)).status).toBe(200);
    const again = new Client(); // เครื่องที่ไม่มี session (ไม่ติด PIN_CHANGE_REQUIRED) แต่มี cookie เดิม
    again.set(RESET_COOKIE, copiedToken);
    const r = await again.login('alice', RESET_PIN);
    expect(r.code).toBe('INVALID_CREDENTIALS');
    expect(again.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('ใช้ 123456 พร้อมกันสองคำขอ → สำเร็จได้ครั้งเดียว (UPDATE … WHERE status=approved)', async () => {
    const phone = new Client();
    await requestAndApprove(phone);
    const twin = new Client();
    phone.cloneJarTo(twin);
    const [a, b] = await Promise.all([phone.login('alice', RESET_PIN), twin.login('alice', RESET_PIN)]);
    // ผู้แพ้: แพ้ UPDATE (401) หรือชนล็อกเขียนของ file: DB ในโปรเซสเดียว (409 CONFLICT ให้ลองใหม่ — S7 ธุรกรรม rollback ทั้งก้อน)
    expect([a.status, b.status].filter((x) => x === 200)).toHaveLength(1);
    expect([a.status, b.status].find((x) => x !== 200)).toBeOneOf([401, 409]);
    expect(await h.rows('SELECT * FROM session WHERE user_id = (SELECT id FROM user WHERE username = \'alice\')')).toHaveLength(1);
  });

  it('คำขอที่ approve แล้วแต่บัญชีถูกระงับ → ACCOUNT_SUSPENDED (เมื่อ credential ถูก) และไม่ consume คำขอ', async () => {
    const phone = new Client();
    await requestAndApprove(phone);
    await h.rows("UPDATE user SET status = 'suspended' WHERE username = 'alice'");
    const r = await phone.login('alice', RESET_PIN);
    expect(r.code).toBe('ACCOUNT_SUSPENDED');
    expect((await reqs())[0]!.status).toBe('approved');
  });

  it('123456 เป็นค่าพิเศษของระบบ: บัญชีที่มี PIN ปกติ (ไม่มี reset) ลอง 123456 ไม่ได้อะไร', async () => {
    const r = await new Client().login('alice', RESET_PIN);
    expect(r.status).toBe(401);
    expect(OTHER_PIN).not.toBe(RESET_PIN);
  });
});

describe('lazy expiry ฝั่ง pending (7 วัน)', () => {
  it('pending เกิน 7 วัน → อ่านแล้วเป็น expired และขอใหม่ได้ (ไม่ถูกคำขอเก่าบัง) · ใบเก่ากดอนุมัติไม่ได้ (409)', async () => {
    const phone = new Client();
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    const [old] = await reqs();
    h.clock.advance(7 * DAY + HOUR);
    const stale = await boss.c.post(`/api/auth/admin/pin-resets/${old!.id}/approve`);
    expect(stale.status).toBe(409);
    expect(stale.code).toBe('CONFLICT');
    await phone.post('/api/auth/pin-reset', { username: 'alice' });
    expect((await reqs()).map((r) => r.status)).toEqual(['expired', 'pending']);
  });
});
