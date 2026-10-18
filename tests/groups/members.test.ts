// R2-5 · U6: ลบสมาชิก D7 · ตั้ง moderator · โอน admin D8 (อะตอมมิก) · ออกจากกลุ่ม D8 · ลบกลุ่ม soft delete · super admin นอกกลุ่ม → audit
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminCount, del, get, join, makeCode, makeGroup, patch, person, post, roleOf, setupHarness, type Harness, type Person } from './harness';

let h: Harness;
let a: Person; // admin
let m: Person; // moderator
let b: Person; // member
let c: Person; // member
let gid: string;
beforeEach(async () => {
  h = await setupHarness();
  [a, m, b, c] = [await person(h, 'alice'), await person(h, 'mod'), await person(h, 'bob'), await person(h, 'cara')];
  gid = await makeGroup(a);
  for (const p of [m, b, c]) await join(a, p, gid);
  expect((await patch(a.c, `/api/groups/${gid}/members/${m.id}`, { role: 'moderator' })).status).toBe(200);
});
afterEach(async () => {
  await h.cleanup();
});

const auditRows = (action: string) => h.rows<{ actor_id: string; meta: string }>('SELECT actor_id, meta FROM audit_log WHERE action = ? AND group_id = ? ORDER BY created_at', [action, gid]);

describe('GET /api/groups/:gid', () => {
  it('สมาชิกเห็นรายละเอียด + รายชื่อ (id, ชื่อ, role, colorIndex 0–9) เรียง admin → mod → member · ไม่มี username/hash', async () => {
    const r = await get<{ group: { members: { userId: string; role: string; colorIndex: number; displayName: string }[]; myRole: string; memberCount: number } }>(b.c, `/api/groups/${gid}`);
    expect(r.status).toBe(200);
    expect(r.data.group.myRole).toBe('member');
    expect(r.data.group.memberCount).toBe(4);
    expect(r.data.group.members.map((x) => x.role)).toEqual(['admin', 'moderator', 'member', 'member']);
    for (const x of r.data.group.members) {
      expect(Number.isInteger(x.colorIndex) && x.colorIndex >= 0 && x.colorIndex <= 9).toBe(true);
      expect(Object.keys(x).sort()).toEqual(['colorIndex', 'displayName', 'joinedAt', 'role', 'userId']);
    }
    expect(r.text).not.toMatch(/pin_hash|pinHash|code_hash|codeHash|username/i);
    // สีคงที่ข้ามคำขอ และไม่ขึ้นกับสมาชิกคนอื่นเข้า/ออก
    const before = r.data.group.members.find((x) => x.userId === b.id)!.colorIndex;
    expect((await post(c.c, `/api/groups/${gid}/leave`)).status).toBe(200);
    const r2 = await get<typeof r.data>(b.c, `/api/groups/${gid}`);
    expect(r2.data.group.members.find((x) => x.userId === b.id)!.colorIndex).toBe(before);
  });
});

describe('ลบสมาชิก (D7)', () => {
  it('admin ลบ moderator/member ได้ · ผู้ถูกลบเห็นข้อมูลกลุ่มไม่ได้ทันที (404) · มี audit', async () => {
    expect((await del(a.c, `/api/groups/${gid}/members/${b.id}`)).status).toBe(200);
    expect(await roleOf(h, gid, b.id)).toBeNull();
    const after = await get(b.c, `/api/groups/${gid}`);
    expect(after.status).toBe(404);
    expect(after.code).toBe('NOT_FOUND');
    expect((await del(a.c, `/api/groups/${gid}/members/${m.id}`)).status).toBe(200);
    const rows = await auditRows('member.remove');
    expect(rows.map((r) => JSON.parse(r.meta))).toEqual([
      { targetUserId: b.id, targetRole: 'member', asSuperAdmin: false },
      { targetUserId: m.id, targetRole: 'moderator', asSuperAdmin: false },
    ]);
  });

  it('moderator ลบ member ได้ · ลบ moderator/admin ไม่ได้ (403/409) · member ลบใครไม่ได้ · ลบตัวเองผ่านทางนี้ไม่ได้', async () => {
    const m2 = await person(h, 'mod2');
    await join(a, m2, gid);
    await patch(a.c, `/api/groups/${gid}/members/${m2.id}`, { role: 'moderator' });
    expect((await del(m.c, `/api/groups/${gid}/members/${m2.id}`)).status).toBe(403); // mod → mod
    const toAdmin = await del(m.c, `/api/groups/${gid}/members/${a.id}`);
    expect([toAdmin.status, toAdmin.code]).toEqual([403, 'FORBIDDEN']); // mod → admin (D7: ไม่ใช่ 409 — mod ไม่มีสิทธิ์ลบ)
    expect((await del(b.c, `/api/groups/${gid}/members/${c.id}`)).status).toBe(403); // member → member
    expect((await del(m.c, `/api/groups/${gid}/members/${m.id}`)).status).toBe(403); // ตัวเอง
    expect((await del(m.c, `/api/groups/${gid}/members/${c.id}`)).status).toBe(200); // mod → member
    expect(await h.count('group_member WHERE group_id = ?', [gid])).toBe(4);
  });

  it('ลบ admin → 409 ADMIN_TRANSFER_REQUIRED แม้เป็น super admin · ลบตัวเองไม่ได้ (403)', async () => {
    const boss = await person(h, 'boss', { admin: true });
    const r = await del(boss.c, `/api/groups/${gid}/members/${a.id}`);
    expect([r.status, r.code]).toEqual([409, 'ADMIN_TRANSFER_REQUIRED']);
    expect((await del(a.c, `/api/groups/${gid}/members/${a.id}`)).status).toBe(403);
    expect(await roleOf(h, gid, a.id)).toBe('admin');
  });

  it('เป้าหมายไม่ใช่สมาชิก → 404 · ลบแล้วโค้ดที่คนนั้นสร้างค้างไว้ใช้ไม่ได้', async () => {
    const outsider = await person(h, 'outsider');
    expect((await del(a.c, `/api/groups/${gid}/members/${outsider.id}`)).status).toBe(404);
    const code = await makeCode(b, gid);
    expect((await del(a.c, `/api/groups/${gid}/members/${b.id}`)).status).toBe(200);
    const r = await post(outsider.c, '/api/invites/redeem', { code });
    expect([r.status, r.code]).toEqual([400, 'INVITE_INVALID']);
  });

  it('super admin ลบ member ของกลุ่มที่ตัวเองไม่ได้เป็นสมาชิก → สำเร็จ + audit asSuperAdmin', async () => {
    const boss = await person(h, 'boss', { admin: true });
    expect((await del(boss.c, `/api/groups/${gid}/members/${b.id}`)).status).toBe(200);
    const rows = await auditRows('member.remove');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(boss.id);
    expect(JSON.parse(rows[0]!.meta).asSuperAdmin).toBe(true);
  });
});

describe('ตั้ง/ปลด moderator', () => {
  it('admin: member → moderator → member · admin เป้าหมาย/ตัวเองไม่ได้ · mod/member ทำไม่ได้', async () => {
    expect((await patch(a.c, `/api/groups/${gid}/members/${b.id}`, { role: 'moderator' })).status).toBe(200);
    expect(await roleOf(h, gid, b.id)).toBe('moderator');
    expect((await patch(a.c, `/api/groups/${gid}/members/${b.id}`, { role: 'member' })).status).toBe(200);
    expect(await roleOf(h, gid, b.id)).toBe('member');
    expect((await patch(a.c, `/api/groups/${gid}/members/${a.id}`, { role: 'member' })).status).toBe(403);
    expect((await patch(m.c, `/api/groups/${gid}/members/${b.id}`, { role: 'moderator' })).status).toBe(403);
    expect((await patch(b.c, `/api/groups/${gid}/members/${c.id}`, { role: 'moderator' })).status).toBe(403);
    expect((await patch(a.c, `/api/groups/${gid}/members/${b.id}`, { role: 'admin' })).code).toBe('VALIDATION'); // admin ตั้งผ่านทางนี้ไม่ได้
    expect(await adminCount(h, gid)).toBe(1);
  });
});

describe('โอน admin (D8)', () => {
  it('admin → member: admin เดิมกลายเป็น moderator, เป้าหมายเป็น admin, admin ยัง 1 คน, audit', async () => {
    const r = await post<{ adminUserId: string; previousAdminId: string }>(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ adminUserId: b.id, previousAdminId: a.id });
    expect(await roleOf(h, gid, a.id)).toBe('moderator');
    expect(await roleOf(h, gid, b.id)).toBe('admin');
    expect(await adminCount(h, gid)).toBe(1);
    const rows = await auditRows('group.transferAdmin');
    expect(JSON.parse(rows[0]!.meta)).toEqual({ fromUserId: a.id, toUserId: b.id, asSuperAdmin: false });
  });

  it('โอนให้ moderator ได้ · ให้ตัวเอง/ให้ admin อยู่แล้ว/คนนอก → ไม่ได้ · mod/member โอนไม่ได้', async () => {
    expect((await post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: a.id })).status).toBe(403);
    const outsider = await person(h, 'outsider');
    expect((await post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: outsider.id })).status).toBe(404);
    expect((await post(m.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id })).status).toBe(403);
    expect((await post(b.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id })).status).toBe(403);
    expect((await post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: m.id })).status).toBe(200);
    expect(await roleOf(h, gid, m.id)).toBe('admin');
    expect(await roleOf(h, gid, a.id)).toBe('moderator');
  });

  it('ยิงโอน 2 ครั้งพร้อมกัน (ไปคนละคน) → สำเร็จครั้งเดียว, admin เหลือ 1 คนเสมอ', async () => {
    const [r1, r2] = await Promise.all([
      post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id }),
      post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: c.id }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 200 ? r2 : r1;
    expect(['CONFLICT', 'ADMIN_TRANSFER_REQUIRED', 'FORBIDDEN']).toContain(loser.code);
    expect(await adminCount(h, gid)).toBe(1);
    const winner = r1.status === 200 ? b : c;
    expect(await roleOf(h, gid, winner.id)).toBe('admin');
    expect(await roleOf(h, gid, a.id)).toBe('moderator');
    // คนที่แพ้ยังเป็นสมาชิกเดิม (rollback ไม่ทิ้งสถานะครึ่งทาง)
    const other = r1.status === 200 ? c : b;
    expect(await roleOf(h, gid, other.id)).toBe('member');
  });

  it('โอนซ้ำ 10 ครั้งพร้อมกัน (ไปคนเดียวกัน) → admin 1 คน · กลุ่มไม่เคยไม่มี admin', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await adminCount(h, gid)).toBe(1);
    expect(await roleOf(h, gid, b.id)).toBe('admin');
  });

  it('โอนแข่งกับเป้าหมายที่ออกจากกลุ่ม → โอนล้ม (CONFLICT/404) และ admin เดิมยังเป็น admin', async () => {
    const [t, l] = await Promise.all([post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id }), post(b.c, `/api/groups/${gid}/leave`)]);
    expect(await adminCount(h, gid)).toBe(1);
    if (t.status === 200) {
      // โอนก่อน: b เป็น admin แล้วจึงออกไม่ได้ (ADMIN_TRANSFER_REQUIRED)
      expect(l.code).toBe('ADMIN_TRANSFER_REQUIRED');
      expect(await roleOf(h, gid, b.id)).toBe('admin');
    } else {
      expect(l.status).toBe(200);
      expect(await roleOf(h, gid, a.id)).toBe('admin');
      expect(await roleOf(h, gid, b.id)).toBeNull();
    }
  });

  it('super admin โอน admin ของกลุ่มที่ตัวเองไม่ได้อยู่ได้ → audit asSuperAdmin · หลังโอน SA ลบ admin เดิม (ตอนนี้ moderator) ได้', async () => {
    const boss = await person(h, 'boss', { admin: true });
    expect((await del(boss.c, `/api/groups/${gid}/members/${a.id}`)).code).toBe('ADMIN_TRANSFER_REQUIRED');
    expect((await post(boss.c, `/api/groups/${gid}/transfer-admin`, { toUserId: b.id })).status).toBe(200);
    expect(await roleOf(h, gid, b.id)).toBe('admin');
    expect(await roleOf(h, gid, a.id)).toBe('moderator');
    expect(await adminCount(h, gid)).toBe(1);
    const rows = await auditRows('group.transferAdmin');
    expect(rows[0]!.actor_id).toBe(boss.id);
    expect(JSON.parse(rows[0]!.meta)).toMatchObject({ asSuperAdmin: true, fromUserId: a.id, toUserId: b.id });
    expect((await del(boss.c, `/api/groups/${gid}/members/${a.id}`)).status).toBe(200);
  });
});

describe('ออกจากกลุ่ม (D8)', () => {
  it('member/moderator ออกได้ (แล้วเห็นกลุ่มไม่ได้) · admin ออกเอง → 409 จนกว่าจะโอน · หลังโอนออกได้', async () => {
    expect((await post(b.c, `/api/groups/${gid}/leave`)).status).toBe(200);
    expect((await get(b.c, `/api/groups/${gid}`)).status).toBe(404);
    expect((await post(m.c, `/api/groups/${gid}/leave`)).status).toBe(200);
    const blocked = await post(a.c, `/api/groups/${gid}/leave`);
    expect([blocked.status, blocked.code]).toEqual([409, 'ADMIN_TRANSFER_REQUIRED']);
    expect(await roleOf(h, gid, a.id)).toBe('admin');
    await post(a.c, `/api/groups/${gid}/transfer-admin`, { toUserId: c.id });
    expect((await post(a.c, `/api/groups/${gid}/leave`)).status).toBe(200);
    expect(await roleOf(h, gid, a.id)).toBeNull();
    expect(await adminCount(h, gid)).toBe(1);
  });

  it('ออกแล้วโค้ดที่ตัวเองสร้างไว้ใช้ไม่ได้ · super admin นอกกลุ่ม leave → 404', async () => {
    const outsider = await person(h, 'outsider');
    const code = await makeCode(b, gid);
    await post(b.c, `/api/groups/${gid}/leave`);
    expect((await post(outsider.c, '/api/invites/redeem', { code })).code).toBe('INVITE_INVALID');
    const boss = await person(h, 'boss', { admin: true });
    expect((await post(boss.c, `/api/groups/${gid}/leave`)).status).toBe(404);
  });
});

describe('แก้ชื่อ/ตั้งหน้าต่างวันว่าง (D9)', () => {
  it('admin/mod แก้ได้ · member ไม่ได้ · ค่าผิดกติกา → INVALID_WINDOW / VALIDATION', async () => {
    expect((await patch(a.c, `/api/groups/${gid}`, { name: '  ชื่อใหม่ ' })).data).toMatchObject({ group: { name: 'ชื่อใหม่' } });
    expect((await patch(m.c, `/api/groups/${gid}`, { freeWindowStartMin: 540, freeWindowEndMin: 1200, minFreeMinutes: 90 })).status).toBe(200);
    const got = await get<{ group: { freeWindowStartMin: number; freeWindowEndMin: number; minFreeMinutes: number } }>(b.c, `/api/groups/${gid}`);
    expect(got.data.group).toMatchObject({ freeWindowStartMin: 540, freeWindowEndMin: 1200, minFreeMinutes: 90 });
    expect((await patch(b.c, `/api/groups/${gid}`, { name: 'x' })).status).toBe(403);
    expect((await patch(a.c, `/api/groups/${gid}`, { freeWindowStartMin: 1300 })).code).toBe('INVALID_WINDOW'); // เริ่ม ≥ จบ
    expect((await patch(a.c, `/api/groups/${gid}`, { freeWindowEndMin: 1500 })).code).toBe('INVALID_WINDOW');
    expect((await patch(a.c, `/api/groups/${gid}`, { minFreeMinutes: 45 })).code).toBe('INVALID_WINDOW'); // ไม่ใช่ทวีคูณ 30
    expect((await patch(a.c, `/api/groups/${gid}`, { minFreeMinutes: 900 })).code).toBe('INVALID_WINDOW'); // เกินความยาวหน้าต่าง
    expect((await patch(a.c, `/api/groups/${gid}`, { freeWindowStartMin: 481 })).code).toBe('INVALID_WINDOW');
    expect((await patch(a.c, `/api/groups/${gid}`, { name: '' })).code).toBe('VALIDATION');
    expect((await patch(a.c, `/api/groups/${gid}`, {})).code).toBe('VALIDATION');
    expect((await patch(a.c, `/api/groups/${gid}`, { tz: 'UTC' })).code).toBe('VALIDATION');
    expect(await h.count("audit_log WHERE action = 'group.update' AND group_id = ?", [gid])).toBe(2);
  });
});

describe('ลบกลุ่ม (soft delete)', () => {
  it('admin ลบได้ → 200, แถวยังอยู่แต่มี deleted_at, audit · ทุกคนในกลุ่มเห็นไม่ได้ทันที · member/mod ลบไม่ได้', async () => {
    expect((await del(m.c, `/api/groups/${gid}`)).status).toBe(403);
    expect((await del(b.c, `/api/groups/${gid}`)).status).toBe(403);
    expect((await del(a.c, `/api/groups/${gid}`)).status).toBe(200);
    expect(await h.rows('SELECT deleted_at FROM groups WHERE id = ?', [gid])).toEqual([{ deleted_at: h.clock.now() }]);
    for (const p of [a, m, b]) {
      expect((await get(p.c, `/api/groups/${gid}`)).status, p.username).toBe(404);
    }
    const list = await get<{ groups: unknown[] }>(b.c, '/api/groups');
    expect(list.data.groups).toEqual([]);
    expect((await del(a.c, `/api/groups/${gid}`)).status).toBe(404); // ลบซ้ำ
    const rows = await auditRows('group.delete');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.meta)).toEqual({ asSuperAdmin: false });
  });

  it('super admin ลบกลุ่มที่ไม่ได้เป็นสมาชิก → ได้ + audit asSuperAdmin · ลบแล้วโค้ด/คำเชิญของกลุ่มใช้ไม่ได้ทันที', async () => {
    const outsider = await person(h, 'outsider');
    const code = await makeCode(a, gid);
    await post(a.c, `/api/groups/${gid}/invites/direct`, { username: 'outsider' });
    const boss = await person(h, 'boss', { admin: true });
    expect((await del(boss.c, `/api/groups/${gid}`)).status).toBe(200);
    expect(JSON.parse((await auditRows('group.delete'))[0]!.meta).asSuperAdmin).toBe(true);
    expect((await post(outsider.c, '/api/invites/redeem', { code })).code).toBe('INVITE_INVALID');
    expect((await get<{ invites: unknown[] }>(outsider.c, '/api/me/invites')).data.invites).toEqual([]);
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [gid, outsider.id])).toBe(0);
    // super admin ก็เห็นกลุ่มที่ลบแล้วผ่าน endpoint กลุ่มไม่ได้ (R5 มีหน้า admin)
    expect((await get(boss.c, `/api/groups/${gid}`)).status).toBe(404);
  });
});

describe('super admin อ่านกลุ่มที่ไม่ได้เป็นสมาชิก → audit', () => {
  it('GET group → 200 + audit group.view asSuperAdmin · สมาชิกธรรมดาไม่ audit การอ่าน', async () => {
    const boss = await person(h, 'boss', { admin: true });
    const r = await get<{ group: { myRole: string | null } }>(boss.c, `/api/groups/${gid}`);
    expect(r.status).toBe(200);
    expect(r.data.group.myRole).toBeNull();
    await get(b.c, `/api/groups/${gid}`);
    const rows = await auditRows('group.view');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(boss.id);
  });
});
