// R5-2 — POST /api/me/delete (R5_CONTRACT §2 ข้อ 2, §6)
// PIN ผิด → ปฏิเสธ + นับ throttle · เป็น admin → 409 พร้อมรายชื่อกลุ่ม ไม่มีอะไรเปลี่ยน · สำเร็จ: ทุกข้อใน §2.2 ตรวจจาก DB ·
// login/session เดิมใช้ไม่ได้ · ชื่อผู้ใช้เดิมสมัครใหม่ได้ · นัดเดิมยังอยู่ (ผู้สร้าง = null → UI "บัญชีที่ถูกลบ") · super admin ลบเองไม่ได้ ·
// race: ลบพร้อมรับตำแหน่ง admin → ไม่มีกลุ่มไร้ admin
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markUserDeletedGuarded } from '@/lib/data/repos/account';
import { GOOD_PIN, OTHER_PIN, sameResponse } from '../auth/harness';
import { Client, call, get, join, makeGroup, mustCreate, person, post, put, setupHarness, type ApptDto, type Harness, type Person } from '../appointments/util';

let h: Harness;
let a: Person; // admin ของกลุ่ม g1
let b: Person; // ผู้ใช้ที่จะลบบัญชี
let c: Person;

const del = (p: Person, pin: unknown = GOOD_PIN) => post<{ deleted: true }>(p.c, '/api/me/delete', { pin });

async function snapshot(userId: string) {
  return {
    user: await h.rows('SELECT * FROM user WHERE id = ?', [userId]),
    sessions: await h.count('session WHERE user_id = ?', [userId]),
    members: await h.rows('SELECT * FROM group_member WHERE user_id = ? ORDER BY group_id', [userId]),
    busy: await h.count('busy_block WHERE user_id = ?', [userId]),
    rsvp: await h.count('appointment_rsvp WHERE user_id = ?', [userId]),
    notifications: await h.count('notification WHERE user_id = ?', [userId]),
    invites: await h.rows('SELECT id, status FROM group_invite ORDER BY id'),
    resets: await h.rows('SELECT id, status FROM pin_reset_request ORDER BY id'),
    audit: await h.count('audit_log'),
  };
}

beforeEach(async () => {
  h = await setupHarness();
  a = await person(h, 'alice');
  b = await person(h, 'bob');
  c = await person(h, 'carol');
});
afterEach(async () => {
  await h.cleanup();
});

describe('ปฏิเสธ — ไม่มีอะไรเปลี่ยน', () => {
  it('PIN ผิด → 401 INVALID_CREDENTIALS + นับเข้า login_throttle เดียวกับ login · ครบ 5 → LOGIN_LOCKED (แม้ PIN ถูก) และ login ก็ล็อกด้วย', async () => {
    const before = await snapshot(b.id);
    const r1 = await del(b, OTHER_PIN);
    expect(r1.status).toBe(401);
    expect(r1.code).toBe('INVALID_CREDENTIALS');
    expect(r1.json.error?.params).toEqual({ attemptsRemaining: 4 });
    expect((await h.rows<{ failures: number }>("SELECT failures FROM login_throttle WHERE key = 'u:bob'"))[0]!.failures).toBe(1);
    for (let i = 0; i < 4; i++) await del(b, OTHER_PIN);
    const locked = await del(b, GOOD_PIN);
    expect(locked.code).toBe('LOGIN_LOCKED');
    expect((await new Client().login('bob', GOOD_PIN)).code).toBe('LOGIN_LOCKED');
    const after = await snapshot(b.id);
    expect(after).toEqual(before);
  });

  it('PIN รูปแบบผิด → 400 PIN_FORMAT ไม่นับ · ไม่ส่ง pin → VALIDATION', async () => {
    expect((await del(b, '12')).code).toBe('PIN_FORMAT');
    expect((await post(b.c, '/api/me/delete', {})).code).toBe('VALIDATION');
    expect(await h.count("login_throttle WHERE key = 'u:bob' AND failures > 0")).toBe(0);
  });

  it('ถือ admin ของกลุ่มที่ยังอยู่ → 409 ADMIN_TRANSFER_REQUIRED + groups (เฉพาะกลุ่มที่เป็น admin, ไม่รวมกลุ่มที่ลบแล้ว/เป็น moderator) · ไม่แตะ PIN/throttle', async () => {
    const g1 = await makeGroup(b, 'กลุ่มของบ๊อบ');
    const g2 = await makeGroup(b, 'กลุ่มที่ลบแล้ว');
    expect((await call(b.c, 'DELETE', `/api/groups/${g2}`)).status).toBe(200);
    const g3 = await makeGroup(a, 'กลุ่มอลิซ');
    await join(a, b, g3);
    expect((await call(a.c, 'PATCH', `/api/groups/${g3}/members/${b.id}`, { role: 'moderator' })).status).toBe(200);
    const before = await snapshot(b.id);
    const r = await del(b, OTHER_PIN); // PIN ผิดก็ได้ 409 ก่อน — ไม่มีการ verify/นับ
    expect(r.status).toBe(409);
    expect(r.code).toBe('ADMIN_TRANSFER_REQUIRED');
    expect(r.json.error?.params).toEqual({ groups: [{ id: g1, name: 'กลุ่มของบ๊อบ' }] });
    expect(await snapshot(b.id)).toEqual(before);
    expect(await h.count("login_throttle WHERE key = 'u:bob' AND failures > 0")).toBe(0);
    // โอนแล้วลบได้
    await join(b, c, g1);
    expect((await post(b.c, `/api/groups/${g1}/transfer-admin`, { toUserId: c.id })).status).toBe(200);
    expect((await del(b)).status).toBe(200);
  });

  it('super admin ลบตัวเองผ่านแอปไม่ได้ → 403 FORBIDDEN (ไม่ verify PIN)', async () => {
    const boss = await person(h, 'boss', { admin: true });
    const before = await snapshot(boss.id);
    const r = await del(boss, OTHER_PIN);
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
    expect(await snapshot(boss.id)).toEqual(before);
  });

  it('must_change_pin → 403 PIN_CHANGE_REQUIRED · anonymous → 401 · CSRF → 403', async () => {
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [b.id]);
    expect((await del(b)).code).toBe('PIN_CHANGE_REQUIRED');
    expect((await post(new Client(), '/api/me/delete', { pin: GOOD_PIN })).status).toBe(401);
    expect((await post(a.c, '/api/me/delete', { pin: GOOD_PIN }, { headers: { origin: 'https://evil.test' } })).code).toBe('CSRF_REJECTED');
  });
});

describe('สำเร็จ — ทุกข้อใน §2.2 ตรวจจาก DB', () => {
  it('ลบ/ปิดร่องรอยครบ · นัดยังอยู่ · audit user.delete (actor = ตัวเอง, ไม่มีชื่อ/PIN)', async () => {
    // b: moderator ใน g1 (สร้างนัด + RSVP + busy) · member ใน g2 · สร้างโค้ดเชิญ + ชวนตรง c · มีคำเชิญตรงค้างจาก a · มีคำขอ reset ค้าง
    const g1 = await makeGroup(a, 'ก๊วนหนึ่ง');
    const g2 = await makeGroup(c, 'ก๊วนสอง');
    await join(a, b, g1);
    await join(c, b, g2);
    expect((await call(a.c, 'PATCH', `/api/groups/${g1}/members/${b.id}`, { role: 'moderator' })).status).toBe(200);
    const appt: ApptDto = await mustCreate(b, g1);
    expect((await put(b.c, `/api/appointments/${appt.id}/rsvp`, { response: 'going' })).status).toBe(200);
    expect((await put(a.c, `/api/appointments/${appt.id}/rsvp`, { response: 'maybe' })).status).toBe(200);
    expect((await post(b.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-10-24', endDate: '2026-10-24', note: 'ลับ' })).status).toBe(201);
    expect((await post(b.c, `/api/groups/${g1}/invites/code`)).status).toBe(201);
    expect((await post(b.c, `/api/groups/${g2}/invites/direct`, { username: 'carol' })).status).not.toBe(201); // c เป็นสมาชิก g2 อยู่แล้ว
    const g3 = await makeGroup(a, 'ก๊วนสาม');
    await join(a, b, g3);
    const d = await person(h, 'dave');
    const byB = await post<{ invite: { id: string } }>(b.c, `/api/groups/${g3}/invites/direct`, { username: 'dave' });
    expect(byB.status).toBe(201);
    const g4 = await makeGroup(c, 'ก๊วนสี่');
    const toB = await post<{ invite: { id: string } }>(c.c, `/api/groups/${g4}/invites/direct`, { username: 'bob' });
    expect(toB.status).toBe(201);
    await h.rows(
      "INSERT INTO pin_reset_request (id, user_id, status, device_token_hash, requested_at, pending_expires_at) VALUES ('rq-b', ?, 'pending', 'x', ?, ?)",
      [b.id, h.clock.now(), h.clock.now() + 7 * 86_400_000],
    );
    const second = new Client();
    expect((await second.login('bob', GOOD_PIN)).status).toBe(200);
    expect(await h.count('session WHERE user_id = ?', [b.id])).toBe(2);
    expect(await h.count('notification WHERE user_id = ?', [b.id])).toBeGreaterThan(0);
    const auditBefore = await h.count('audit_log');

    const r = await del(b);
    expect(r.status, r.text).toBe(200);
    expect(r.data).toEqual({ deleted: true });
    expect(r.setCookies.some((s) => /^mm_session=;/.test(s) && /Max-Age=0/i.test(s))).toBe(true);
    expect(r.headers.get('cache-control')).toBe('private, no-store');

    const [u] = await h.rows<Record<string, unknown>>('SELECT * FROM user WHERE id = ?', [b.id]);
    expect(u).toMatchObject({
      status: 'deleted',
      pin_hash: null,
      display_name: '',
      username: `deleted-${b.id}`,
      username_normalized: `deleted-${b.id}`,
      must_change_pin: 0,
      deleted_at: h.clock.now(),
    });
    expect(await h.count('session WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count('group_member WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count('busy_block WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count('appointment_rsvp WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count('appointment_rsvp WHERE user_id = ?', [a.id])).toBe(1);
    expect(await h.count('notification WHERE user_id = ?', [b.id])).toBe(0);
    expect(await h.count("group_invite WHERE created_by = ? AND status = 'active'", [b.id])).toBe(0);
    expect(await h.count("group_invite WHERE created_by = ? AND status = 'revoked'", [b.id])).toBe(2);
    expect((await h.rows<{ status: string }>('SELECT status FROM group_invite WHERE id = ?', [toB.data.invite.id]))[0]!.status).toBe('declined');
    expect((await h.rows<{ status: string }>("SELECT status FROM pin_reset_request WHERE id = 'rq-b'"))[0]!.status).toBe('cancelled');
    // นัดยังอยู่ · admin ของทุกกลุ่มยังอยู่ครบ (กลุ่มละ 1)
    expect(await h.count("appointment WHERE id = ? AND status = 'active'", [appt.id])).toBe(1);
    for (const g of [g1, g2, g3, g4]) expect(await h.count("group_member WHERE group_id = ? AND role = 'admin'", [g])).toBe(1);
    // แจ้งเตือนของ dave ที่อ้างชื่อ b ถูกล้างชื่อ (UI แสดง "บัญชีที่ถูกลบ")
    const dn = await h.rows<{ params: string }>("SELECT params FROM notification WHERE user_id = ? AND kind = 'group.invite.received'", [d.id]);
    expect(dn).toHaveLength(1);
    expect(JSON.parse(dn[0]!.params)).toMatchObject({ inviterName: '', inviteId: byB.data.invite.id });
    // audit
    const audits = await h.rows<{ actor_id: string; action: string; target_type: string; target_id: string; meta: string | null }>(
      "SELECT actor_id, action, target_type, target_id, meta FROM audit_log WHERE action = 'user.delete'",
    );
    expect(audits).toEqual([{ actor_id: b.id, action: 'user.delete', target_type: 'user', target_id: b.id, meta: null }]);
    expect(await h.count('audit_log')).toBe(auditBefore + 1);
    // ไม่มีชื่อเดิมของ b หลงเหลือในตาราง user / audit
    const dump = JSON.stringify(await h.rows('SELECT * FROM user WHERE id = ?', [b.id])) + JSON.stringify(await h.rows('SELECT * FROM audit_log'));
    expect(dump).not.toContain('ชื่อ bob');
    expect(dump).not.toMatch(/"bob"/);
  });

  it('ผู้ถูกลบหายจากรายชื่อสมาชิก / ปฏิทิน / วันว่าง / RSVP · นัดที่สร้างยังอยู่ ผู้สร้าง = null', async () => {
    const gid = await makeGroup(a, 'ก๊วน');
    await join(a, b, gid);
    await join(a, c, gid);
    const appt = await mustCreate(b, gid);
    await put(b.c, `/api/appointments/${appt.id}/rsvp`, { response: 'going' });
    await post(b.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-10-24', endDate: '2026-10-24' });
    expect((await del(b)).status).toBe(200);

    const g = await get<{ group: { members: { userId: string }[]; memberCount: number } }>(a.c, `/api/groups/${gid}`);
    expect(g.data.group.members.map((m) => m.userId)).not.toContain(b.id);
    expect(g.data.group.memberCount).toBe(2);
    const cal = await get<{ members: { userId: string }[]; busy: { userId: string }[] }>(a.c, `/api/groups/${gid}/calendar?from=2026-10-01&to=2026-10-31`);
    expect(cal.status).toBe(200);
    expect(cal.data.members.map((m) => m.userId)).not.toContain(b.id);
    expect(cal.data.busy.map((x) => x.userId)).not.toContain(b.id);
    const av = await get<{ members: { userId: string }[] }>(a.c, `/api/groups/${gid}/availability?from=2026-10-24&to=2026-10-24`);
    expect(av.status).toBe(200);
    expect(av.data.members.map((m) => m.userId)).not.toContain(b.id);
    const detail = await get<{ appointment: ApptDto }>(a.c, `/api/appointments/${appt.id}`);
    expect(detail.status).toBe(200);
    expect(detail.data.appointment.createdBy).toBeNull();
    expect(detail.data.appointment.rsvp.counts.going).toBe(0);
    expect(JSON.stringify(detail.data)).not.toContain(b.id);
  });

  it('หลังลบ: login ด้วยชื่อ/PIN เดิม = ตอบเหมือนไม่มีบัญชีทุกไบต์ · session เดิม/ลบซ้ำ → 401 · username เดิมสมัครใหม่ได้', async () => {
    const stale = new Client();
    b.c.cloneJarTo(stale);
    expect((await del(b)).status).toBe(200);

    const asDeleted = await new Client('10.9.9.1').login('bob', GOOD_PIN);
    const ghost = await new Client('10.9.9.2').login('nobody', GOOD_PIN);
    expect(asDeleted.code).toBe('INVALID_CREDENTIALS');
    sameResponse(asDeleted, ghost);

    expect((await get(stale, '/api/auth/session')).status).toBe(401);
    const again = await post(stale, '/api/me/delete', { pin: GOOD_PIN });
    expect(again.status).toBe(401);
    expect(again.code).toBe('AUTH_REQUIRED');

    const fresh = new Client();
    const s = await fresh.post<{ user: { id: string; username: string } }>('/api/auth/signup', { username: 'bob', displayName: 'บ๊อบคนใหม่', pin: GOOD_PIN, pinConfirm: GOOD_PIN });
    expect(s.status, s.text).toBe(201);
    expect(s.data.user.id).not.toBe(b.id);
    // บัญชีใหม่ไม่ได้รับตัวนับ login ของคนเดิม และไม่เห็นกลุ่ม/ข้อมูลของคนเดิม
    expect((await get<{ groups: unknown[] }>(fresh, '/api/groups')).data.groups).toEqual([]);
  });

  it('ตัวนับ login ของ username เดิมถูกล้าง (คนสมัครชื่อเดิมไม่รับล็อก)', async () => {
    for (let i = 0; i < 3; i++) await new Client().login('bob', OTHER_PIN);
    expect(await h.count("login_throttle WHERE key = 'u:bob' AND failures = 3")).toBe(1);
    expect((await del(b)).status).toBe(200);
    expect(await h.count("login_throttle WHERE key = 'u:bob'")).toBe(0);
  });
});

describe('race: ลบบัญชีพร้อมรับตำแหน่ง admin (R5_CONTRACT §6)', () => {
  it('repo: UPDATE มีเงื่อนไขในตัว — ถือ admin อยู่ = ไม่ลบ (ด่านอยู่ในคำสั่งเดียวกับการเขียน ไม่ใช่การอ่านก่อน)', async () => {
    const gid = await makeGroup(a, 'ก๊วน');
    await join(a, b, gid);
    expect((await post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id })).status).toBe(200);
    expect(await markUserDeletedGuarded(h.db, b.id, h.clock.now())).toBe(false);
    expect((await h.rows<{ status: string }>('SELECT status FROM user WHERE id = ?', [b.id]))[0]!.status).toBe('active');
    // super admin / ไม่ active ก็ไม่ลบ
    const boss = await person(h, 'boss', { admin: true });
    expect(await markUserDeletedGuarded(h.db, boss.id, h.clock.now())).toBe(false);
  });

  it('โอน admin มาให้ "ระหว่าง" ที่กำลัง verify PIN (หลังผ่านด่านอ่านแล้ว) → 409 พร้อมรายชื่อกลุ่ม · ไม่มีอะไรถูกลบ · กลุ่มมี admin 1 คน', async () => {
    const gid = await makeGroup(a, 'ก๊วนแข่ง');
    await join(a, b, gid);
    const pending = del(b); // ผ่าน authorize + ตรวจ admin (ยังไม่เป็น) แล้วไปติด argon2 verify
    const t = await post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id });
    expect(t.status).toBe(200);
    const r = await pending;
    expect(r.status).toBe(409);
    expect(r.code).toBe('ADMIN_TRANSFER_REQUIRED');
    expect(r.json.error?.params).toEqual({ groups: [{ id: gid, name: 'ก๊วนแข่ง' }] });
    expect((await h.rows<{ status: string }>('SELECT status FROM user WHERE id = ?', [b.id]))[0]!.status).toBe('active');
    expect(await h.count('session WHERE user_id = ?', [b.id])).toBe(1);
    expect(await h.count("group_member WHERE group_id = ? AND role = 'admin' AND user_id = ?", [gid, b.id])).toBe(1);
  });

  it('ลบสำเร็จก่อน แล้วค่อยโอน admin ให้ → โอนไม่สำเร็จ · admin เดิมยังเป็น admin (ไม่มีกลุ่มไร้ admin)', async () => {
    const gid = await makeGroup(a, 'ก๊วน');
    await join(a, b, gid);
    expect((await del(b)).status).toBe(200);
    const t = await post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id });
    expect(t.status).toBe(404);
    expect(await h.count("group_member WHERE group_id = ? AND role = 'admin' AND user_id = ?", [gid, a.id])).toBe(1);
  });

  it('ยิงพร้อมกันหลายรอบ: ผลรวมสอดคล้องเสมอ (ลบแล้ว ⇒ ไม่ถือ admin · กลุ่มมี admin 1 คนเสมอ)', async () => {
    for (let i = 0; i < 4; i++) {
      const owner = await person(h, `own${i}`);
      const victim = await person(h, `vic${i}`);
      const gid = await makeGroup(owner, `ก๊วน ${i}`);
      await join(owner, victim, gid);
      const [dr, tr] = await Promise.all([del(victim), post(owner.c, `/api/groups/${gid}/transfer-admin`, { toUserId: victim.id })]);
      const [st] = await h.rows<{ status: string }>('SELECT status FROM user WHERE id = ?', [victim.id]);
      expect(await h.count("group_member WHERE group_id = ? AND role = 'admin'", [gid])).toBe(1);
      if (st!.status === 'deleted') {
        expect(dr.status).toBe(200);
        expect(tr.status).not.toBe(200);
        expect(await h.count('group_member WHERE user_id = ?', [victim.id])).toBe(0);
      } else {
        expect(dr.status).toBe(409);
        expect(tr.status).toBe(200);
      }
    }
  });

  it('เข้ากลุ่มด้วยโค้ดหลังบัญชีถูกลบ (คำขอที่ผ่านด่านไปแล้ว) ไม่สร้างสมาชิกของบัญชีที่ลบ — ด่าน status ในคำสั่ง INSERT', async () => {
    const { joinGroupWithCode } = await import('@/lib/data/repos/group-invite');
    const gid = await makeGroup(a, 'ก๊วน');
    const code = await post<{ invite: { code: string } }>(a.c, `/api/groups/${gid}/invites/code`);
    expect(code.status).toBe(201);
    expect((await del(b)).status).toBe(200);
    const [row] = await h.rows<{ code_hash: string }>("SELECT code_hash FROM group_invite WHERE kind = 'code' AND group_id = ?", [gid]);
    expect(await joinGroupWithCode(h.db, { codeHash: row!.code_hash, userId: b.id, cap: 50 }, h.clock.now())).toBeNull();
    expect(await h.count('group_member WHERE user_id = ?', [b.id])).toBe(0);
  });
});
