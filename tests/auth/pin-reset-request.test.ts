// ADR 0002 Test requirement 6 (U2): คำขอ reset ตอบเหมือนกันไม่ว่า username มีหรือไม่ (รวม Set-Cookie mm_reset) ·
// ขอซ้ำระหว่าง pending ไม่สร้างแถวใหม่ (นับแถว = 1) · + rate limit เงียบ · status ตาม cookie ของเครื่อง
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, DAY, GOOD_PIN, HOUR, loggedIn, RESET_COOKIE, sameResponse, setupHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
  await h.seedUser('alice');
});
afterEach(async () => {
  await h.cleanup();
});

const resets = () =>
  h.rows<{ id: string; status: string; user_id: string; device_token_hash: string; requester_ua: string | null; requester_country: string | null }>(
    'SELECT * FROM pin_reset_request ORDER BY requested_at',
  );

describe('POST /api/auth/pin-reset', () => {
  it('202 เหมือนกันทุกไบต์ (body, headers, รูป Set-Cookie mm_reset) ไม่ว่า username มีจริงหรือไม่', async () => {
    const real = await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    const ghost = await new Client().post('/api/auth/pin-reset', { username: 'nobody_here' });
    expect(real.status).toBe(202);
    sameResponse(real, ghost);
    for (const r of [real, ghost]) {
      const sc = r.setCookies.find((s) => s.startsWith(`${RESET_COOKIE}=`))!;
      expect(sc).toMatch(/HttpOnly/);
      expect(sc).toMatch(/Secure/);
      expect(sc).toMatch(/SameSite=Lax/);
      expect(sc).toMatch(/Max-Age=691200/); // 8 วัน
    }
    expect(await resets()).toHaveLength(1); // เฉพาะ alice
  });

  it('ขอซ้ำระหว่าง pending ไม่สร้างแถวใหม่ (=1) · ตอบเหมือนเดิม · เครื่องเดิมได้ token เดิม (ผูกเครื่องไม่หลุด)', async () => {
    const c = new Client();
    const first = await c.post('/api/auth/pin-reset', { username: 'alice' });
    const token = tokenOf(c.get(RESET_COOKIE)!);
    const again = await c.post('/api/auth/pin-reset', { username: 'Alice' });
    sameResponse(first, again);
    expect(tokenOf(c.get(RESET_COOKIE)!)).toBe(token);
    expect(await resets()).toHaveLength(1);
  });

  it('คนอื่นขอ reset ของ alice ซ้ำระหว่าง pending ก็ไม่เกิดแถวใหม่ (partial unique) และคำขอเดิมยังผูกเครื่องแรก', async () => {
    const owner = new Client();
    await owner.post('/api/auth/pin-reset', { username: 'alice' });
    const other = new Client();
    const r = await other.post('/api/auth/pin-reset', { username: 'alice' });
    expect(r.status).toBe(202);
    const rows = await resets();
    expect(rows).toHaveLength(1);
    // เครื่องที่สองได้ cookie ของตัวเอง แต่ไม่ตรงกับคำขอ
    expect(rows[0]!.device_token_hash).not.toBe(await sha(tokenOf(other.get(RESET_COOKIE)!)));
    expect(rows[0]!.device_token_hash).toBe(await sha(tokenOf(owner.get(RESET_COOKIE)!)));
  });

  it('เก็บอุปกรณ์แบบย่อ + ประเทศ (x-vercel-ip-country) ไม่เก็บ UA ดิบ/IP', async () => {
    const c = new Client('203.0.113.50');
    await c.post('/api/auth/pin-reset', { username: 'alice' }, { headers: { 'x-vercel-ip-country': 'th' } });
    const [row] = await resets();
    expect(row!.requester_ua).toBe('iPhone · Safari');
    expect(row!.requester_country).toBe('TH');
    expect(JSON.stringify(row)).not.toContain('203.0.113.50');
    expect(JSON.stringify(row)).not.toContain('Mozilla');
  });

  it('บัญชี suspended / deleted → ไม่สร้างคำขอ แต่ตอบเหมือนเดิม', async () => {
    await h.seedUser('sus');
    await h.seedUser('del');
    await h.rows("UPDATE user SET status = 'suspended' WHERE username = 'sus'");
    await h.rows("UPDATE user SET status = 'deleted' WHERE username = 'del'");
    const a = await new Client().post('/api/auth/pin-reset', { username: 'sus' });
    const b = await new Client().post('/api/auth/pin-reset', { username: 'del' });
    const c = await new Client().post('/api/auth/pin-reset', { username: 'nobody_here' });
    sameResponse(a, c);
    sameResponse(b, c);
    expect(await resets()).toHaveLength(0);
  });

  it('เกินเพดาน 3/ชม. ต่อ IP → ตอบ 202 เหมือนเดิมแต่ไม่สร้างคำขอ (ไม่บอกว่าโดนจำกัด)', async () => {
    for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) await h.seedUser(u);
    const ip = '203.0.113.60';
    const outs = [];
    for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) outs.push(await new Client(ip).post('/api/auth/pin-reset', { username: u }));
    for (const o of outs) {
      expect(o.status).toBe(202);
      sameResponse(o, outs[0]!);
    }
    expect(await resets()).toHaveLength(3);
    h.clock.advance(HOUR); // หน้าต่างใหม่
    await new Client(ip).post('/api/auth/pin-reset', { username: 'u4' });
    expect(await resets()).toHaveLength(4);
  });

  it('เกินเพดาน 3/24 ชม. ต่อ username (ขอจาก IP ต่างกัน) → ไม่สร้างคำขอที่ 4', async () => {
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    for (let i = 0; i < 4; i++) {
      const r = await new Client().post('/api/auth/pin-reset', { username: 'alice' });
      expect(r.status).toBe(202);
      const open = (await resets()).filter((x) => x.status === 'pending');
      if (open[0]) await boss.c.post(`/api/auth/admin/pin-resets/${open[0].id}/reject`);
    }
    expect(await resets()).toHaveLength(3);
    h.clock.advance(DAY);
    await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    expect(await resets()).toHaveLength(4);
  });

  it('username รูปแบบแปลกก็ตอบ 202 เหมือนกัน (ไม่ใช่ VALIDATION) · ไม่มี username → VALIDATION', async () => {
    const a = await new Client().post('/api/auth/pin-reset', { username: 'x' });
    const b = await new Client().post('/api/auth/pin-reset', { username: 'nobody_here' });
    sameResponse(a, b);
    expect((await new Client().post('/api/auth/pin-reset', {})).code).toBe('VALIDATION');
  });
});

describe('GET /api/auth/pin-reset/status (ตาม cookie ของเครื่อง)', () => {
  it('none → pending → approved(expiresAt) → (หมดอายุ 24 ชม.) pending จนครบ 7 วันนับจากออกคุกกี้ → closed', async () => {
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    const c = new Client();
    expect((await c.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'none' });
    await c.post('/api/auth/pin-reset', { username: 'alice' });
    const issued = h.clock.now();
    expect((await c.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'pending' });
    const [row] = await resets();
    const approved = await boss.c.post(`/api/auth/admin/pin-resets/${row!.id}/approve`);
    const st = await c.getJson<{ status: string; expiresAt: number }>('/api/auth/pin-reset/status');
    expect(st.data).toEqual({ status: 'approved', expiresAt: h.clock.now() + DAY });
    expect(approved.status).toBe(200);
    h.clock.advance(DAY + 1000); // approved หมดอายุ (lazy) — อ่านเหมือน ghost: ยัง pending จนครบ 7 วัน
    expect((await c.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'pending' });
    h.clock.set(issued + 7 * DAY - 1);
    expect((await c.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'pending' });
    h.clock.set(issued + 7 * DAY);
    expect((await c.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'closed' });
  });

  it('D2/S6: เครื่องจริง (ถูก reject / ยกเลิกโดย login / หมดอายุ) กับเครื่อง ghost อ่านเหมือนกันทุกไบต์ ตามตารางเวลาเดียวกัน', async () => {
    const boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
    await h.seedUser('carol');
    await h.seedUser('dave');
    const rejected = new Client();
    const cancelled = new Client();
    const expired = new Client();
    const ghost = new Client();
    await rejected.post('/api/auth/pin-reset', { username: 'alice' });
    await cancelled.post('/api/auth/pin-reset', { username: 'carol' });
    await expired.post('/api/auth/pin-reset', { username: 'dave' });
    await ghost.post('/api/auth/pin-reset', { username: 'nobody_here' });
    const issued = h.clock.now();

    const idOf = async (username: string) =>
      (await h.rows<{ id: string }>('SELECT r.id AS id FROM pin_reset_request r JOIN user u ON u.id = r.user_id WHERE u.username = ?', [username]))[0]!.id;
    expect((await boss.c.post(`/api/auth/admin/pin-resets/${await idOf('alice')}/reject`)).status).toBe(200);
    expect((await new Client().login('carol', GOOD_PIN)).status).toBe(200); // PIN เดิมถูก → คำขอ pending ถูกยกเลิก
    expect(await h.rows('SELECT u.username AS username, r.status AS status FROM pin_reset_request r JOIN user u ON u.id = r.user_id ORDER BY u.username')).toEqual([
      { username: 'alice', status: 'rejected' },
      { username: 'carol', status: 'cancelled' },
      { username: 'dave', status: 'pending' },
    ]);

    const same = async () => {
      const [a, ...rest] = await Promise.all([rejected, cancelled, expired, ghost].map((c) => c.getJson('/api/auth/pin-reset/status')));
      for (const r of rest) sameResponse(a!, r);
      return a!.data;
    };
    expect(await same()).toEqual({ status: 'pending' });
    h.clock.set(issued + 7 * DAY - 1000);
    expect(await same()).toEqual({ status: 'pending' });
    h.clock.set(issued + 7 * DAY + 1000); // แถวของ dave หมดอายุ (lazy) พอดีช่วงเดียวกับที่ ghost ปิด
    expect(await same()).toEqual({ status: 'closed' });
    expect((await h.rows<{ status: string }>("SELECT status FROM pin_reset_request WHERE id = ?", [await idOf('dave')]))[0]!.status).toBe('expired');
  });

  it('คุกกี้ปลอม/แก้เวลาออก (MAC ไม่ตรง) = ไม่มีคุกกี้ (none) · แก้เวลาให้ใหม่ขึ้นเพื่อยืดหน้าต่างไม่ได้', async () => {
    const c = new Client();
    await c.post('/api/auth/pin-reset', { username: 'nobody_here' });
    const [token, sec, mac] = c.get(RESET_COOKIE)!.split('.') as [string, string, string];
    const forged = new Client();
    forged.set(RESET_COOKIE, `${token}.${Number(sec) + 86_400 * 30}.${mac}`);
    expect((await forged.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'none' });
    const wrongMac = new Client();
    wrongMac.set(RESET_COOKIE, `${token}.${sec}.${'0'.repeat(32)}`);
    expect((await wrongMac.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'none' });
    expect((await c.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'pending' });
  });

  it('ขอซ้ำออกคุกกี้ใหม่ (เวลาใหม่) ทั้งเครื่องจริงและ ghost เหมือนกัน → หน้าต่าง 7 วันนับจากคำขอล่าสุด', async () => {
    const real = new Client();
    const ghost = new Client();
    await real.post('/api/auth/pin-reset', { username: 'alice' });
    await ghost.post('/api/auth/pin-reset', { username: 'nobody_here' });
    h.clock.advance(5 * DAY);
    const a = await real.post('/api/auth/pin-reset', { username: 'alice' });
    const b = await ghost.post('/api/auth/pin-reset', { username: 'nobody_here' });
    sameResponse(a, b);
    h.clock.advance(3 * DAY); // 8 วันจากครั้งแรก แต่ 3 วันจากครั้งล่าสุด
    for (const c of [real, ghost]) expect((await c.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'pending' });
    h.clock.advance(5 * DAY);
    for (const c of [real, ghost]) expect((await c.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'closed' });
  });

  it('เครื่องอื่น (cookie อื่น/ไม่มี) ไม่เห็นสถานะของคำขอนี้ · ไม่รับ username เป็น input (ถามไล่ชื่อไม่ได้)', async () => {
    await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    const other = new Client();
    expect((await other.getJson('/api/auth/pin-reset/status')).data).toEqual({ status: 'none' });
    const r = await other.getJson('/api/auth/pin-reset/status?username=alice');
    expect(r.data).toEqual({ status: 'none' });
  });
});

/** ส่วน token ของคุกกี้ mm_reset (`<token>.<issuedAtSec>.<mac>`) */
const tokenOf = (cookie: string): string => cookie.split('.')[0]!;

async function sha(v: string): Promise<string> {
  const { sha256Hex } = await import('@/lib/auth/tokens');
  return sha256Hex(v);
}
