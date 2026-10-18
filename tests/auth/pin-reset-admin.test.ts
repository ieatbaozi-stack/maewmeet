// ADR 0002 Test requirement 9 (U2/U12): approve/reject ลง audit_log ครบ (actor, target, เวลา) ·
// ผู้ที่ไม่ใช่ super admin เรียก → 403 (เมทริกซ์ ADR 0003) · + notification, 404/409, รายการสำหรับหน้า admin
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, DAY, GOOD_PIN, loggedIn, setupHarness, type Harness } from './harness';

let h: Harness;
let boss: Awaited<ReturnType<typeof loggedIn>>;
beforeEach(async () => {
  h = await setupHarness();
  await h.seedUser('alice', GOOD_PIN, { displayName: 'Alice A' });
  await h.seedUser('bob');
  boss = await loggedIn(h, 'boss', GOOD_PIN, { admin: true });
});
afterEach(async () => {
  await h.cleanup();
});

const pending = () => h.rows<{ id: string }>("SELECT id FROM pin_reset_request WHERE status = 'pending' ORDER BY requested_at");
const audits = () =>
  h.rows<{ actor_id: string; action: string; target_type: string; target_id: string; meta: string; created_at: number }>(
    'SELECT * FROM audit_log ORDER BY created_at, id',
  );

describe('เมทริกซ์: ใครเรียกได้', () => {
  it('ไม่ได้ล็อกอิน → 401 · ผู้ใช้ทั่วไป → 403 FORBIDDEN (list / approve / reject) และไม่เปลี่ยนสถานะ', async () => {
    await new Client().post('/api/auth/pin-reset', { username: 'bob' });
    const [{ id }] = (await pending()) as [{ id: string }];
    const user = await loggedIn(h, 'carol');
    for (const c of [new Client(), user.c]) {
      const anon = c === user.c ? false : true;
      const want = anon ? 401 : 403;
      const wantCode = anon ? 'AUTH_REQUIRED' : 'FORBIDDEN';
      const list = await c.getJson('/api/auth/admin/pin-resets');
      const ap = await c.post(`/api/auth/admin/pin-resets/${id}/approve`);
      const rj = await c.post(`/api/auth/admin/pin-resets/${id}/reject`);
      for (const r of [list, ap, rj]) {
        expect(r.status).toBe(want);
        expect(r.code).toBe(wantCode);
      }
    }
    expect(await pending()).toHaveLength(1);
    expect(await audits()).toHaveLength(0);
    expect((await h.rows('SELECT pin_hash FROM user WHERE username = \'bob\''))[0]).not.toEqual({ pin_hash: null });
  });

  it('super admin เห็นรายการ pending (เก่าสุดก่อน) พร้อมเวลา · อุปกรณ์ย่อ · ประเทศ · ไม่มีข้อมูลลับ', async () => {
    await new Client('1.1.1.1', 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36').post(
      '/api/auth/pin-reset',
      { username: 'alice' },
      { headers: { 'x-vercel-ip-country': 'TH' } },
    );
    h.clock.advance(60_000);
    await new Client().post('/api/auth/pin-reset', { username: 'bob' });
    const r = await boss.c.getJson<{ items: Record<string, unknown>[] }>('/api/auth/admin/pin-resets?status=pending');
    expect(r.status).toBe(200);
    expect(r.data.items).toHaveLength(2);
    expect(r.data.items[0]).toMatchObject({ username: 'alice', displayName: 'Alice A', device: 'Android · Chrome', country: 'TH' });
    expect(r.data.items[0]!.requestedAt).toBeLessThan(r.data.items[1]!.requestedAt as number);
    expect(r.data.items[0]!.pendingExpiresAt).toBe((r.data.items[0]!.requestedAt as number) + 7 * DAY);
    expect(r.text).not.toMatch(/token|hash|argon2/i);
    expect((await boss.c.getJson('/api/auth/admin/pin-resets?status=approved')).code).toBe('VALIDATION'); // R1 มีเฉพาะ pending
  });
});

describe('approve', () => {
  it('→ approved + หมดอายุ 24 ชม. · pin_hash=NULL · notification pin_reset.approved · audit (actor, target, เวลา, decision)', async () => {
    await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await pending()) as [{ id: string }];
    h.clock.advance(5000);
    const r = await boss.c.post<{ id: string; status: string; expiresAt: number }>(`/api/auth/admin/pin-resets/${id}/approve`);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ id, status: 'approved', expiresAt: h.clock.now() + DAY });

    const [row] = await h.rows<{ status: string; decided_by: string; decided_at: number; expires_at: number }>('SELECT * FROM pin_reset_request');
    expect(row).toMatchObject({ status: 'approved', decided_by: boss.user.id, decided_at: h.clock.now(), expires_at: h.clock.now() + DAY });
    const [alice] = await h.rows<{ id: string; pin_hash: string | null }>("SELECT id, pin_hash FROM user WHERE username = 'alice'");
    expect(alice!.pin_hash).toBeNull();

    const notes = await h.rows<{ user_id: string; kind: string; params: string }>('SELECT user_id, kind, params FROM notification');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ user_id: alice!.id, kind: 'pin_reset.approved' });
    expect(JSON.parse(notes[0]!.params)).toEqual({ expiresAt: h.clock.now() + DAY });

    const [a] = await audits();
    expect(await audits()).toHaveLength(1);
    expect(a).toMatchObject({ actor_id: boss.user.id, action: 'pinReset.decide', target_type: 'pin_reset', target_id: id, created_at: h.clock.now() });
    expect(JSON.parse(a!.meta)).toEqual({ decision: 'approved', targetUserId: alice!.id });
  });

  it('อนุมัติซ้ำ → 409 CONFLICT (ไม่ audit ซ้ำ) · id ไม่มี → 404 · id ไม่ใช่ uuid → 400 VALIDATION', async () => {
    await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await pending()) as [{ id: string }];
    expect((await boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`)).status).toBe(200);
    const again = await boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`);
    expect(again.status).toBe(409);
    expect(again.code).toBe('CONFLICT');
    const reject = await boss.c.post(`/api/auth/admin/pin-resets/${id}/reject`);
    expect(reject.code).toBe('CONFLICT'); // อนุมัติแล้วปฏิเสธไม่ได้
    expect(await audits()).toHaveLength(1);
    const ghost = await boss.c.post('/api/auth/admin/pin-resets/7c9e6679-7425-40de-944b-e07fc1f90ae7/approve');
    expect(ghost.status).toBe(404);
    expect(ghost.code).toBe('NOT_FOUND');
    expect((await boss.c.post('/api/auth/admin/pin-resets/not-a-uuid/approve')).code).toBe('VALIDATION');
  });

  it('approve พร้อมกัน 2 คำขอ → สำเร็จครั้งเดียว มี audit/notification อย่างละ 1', async () => {
    await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await pending()) as [{ id: string }];
    const boss2 = new Client();
    boss.c.cloneJarTo(boss2);
    const rs = await Promise.all([
      boss.c.post(`/api/auth/admin/pin-resets/${id}/approve`),
      boss2.post(`/api/auth/admin/pin-resets/${id}/approve`),
    ]);
    // ผู้ชนะ 200 ครั้งเดียว · ผู้แพ้ 409 (อนุมัติไปแล้ว หรือเขียนชนกัน) — ไม่ใช่ 500
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await h.rows('SELECT * FROM notification')).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });
});

describe('reject', () => {
  it('→ rejected · PIN เดิมยังใช้ได้ · ไม่มี notification · audit decision=rejected', async () => {
    await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await pending()) as [{ id: string }];
    const r = await boss.c.post<{ status: string }>(`/api/auth/admin/pin-resets/${id}/reject`);
    expect(r.status).toBe(200);
    expect(r.data.status).toBe('rejected');
    expect((await h.rows<{ status: string }>('SELECT status FROM pin_reset_request'))[0]!.status).toBe('rejected');
    expect((await new Client().login('alice', GOOD_PIN)).status).toBe(200);
    expect(await h.rows('SELECT * FROM notification')).toHaveLength(0);
    const [a] = await audits();
    expect(a).toMatchObject({ actor_id: boss.user.id, action: 'pinReset.decide', target_type: 'pin_reset', target_id: id });
    expect(JSON.parse(a!.meta).decision).toBe('rejected');
  });

  it('ปฏิเสธแล้วเจ้าของขอใหม่ได้ (partial unique ปล่อยเมื่อไม่ใช่ pending/approved)', async () => {
    const c = new Client();
    await c.post('/api/auth/pin-reset', { username: 'alice' });
    const [{ id }] = (await pending()) as [{ id: string }];
    await boss.c.post(`/api/auth/admin/pin-resets/${id}/reject`);
    await c.post('/api/auth/pin-reset', { username: 'alice' });
    expect(await pending()).toHaveLength(1);
  });
});

describe('audit ไม่มีความลับ', () => {
  it('meta ของทุกแถวไม่มีคีย์ที่ตรง pin|token|hash|secret|pepper|code|password และไม่มีค่า PIN/hash', async () => {
    await new Client().post('/api/auth/pin-reset', { username: 'alice' });
    await new Client().post('/api/auth/pin-reset', { username: 'bob' });
    const [first, second] = (await pending()) as [{ id: string }, { id: string }];
    await boss.c.post(`/api/auth/admin/pin-resets/${first.id}/approve`);
    await boss.c.post(`/api/auth/admin/pin-resets/${second.id}/reject`);
    const rows = await audits();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      for (const k of Object.keys(JSON.parse(r.meta) as object)) expect(k).not.toMatch(/pin|token|hash|secret|pepper|code|password/i);
      expect(r.meta).not.toMatch(/argon2|123456/);
    }
  });
});
