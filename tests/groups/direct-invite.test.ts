// R2-4 · U5 (ก) ชวนตรง: USER_NOT_FOUND (Q4) · 30/ชม. · ซ้ำ → ปฏิเสธ · รับ → เป็นสมาชิก · ปฏิเสธ → ไม่เป็น · หมดอายุ 7 วัน · notification
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GROUP_LIMITS } from '@/lib/shared/limits';
import { DAY, del, get, join, makeCode, makeGroup, person, post, roleOf, setupHarness, type Harness, type Person } from './harness';

let h: Harness;
let a: Person;
let b: Person;
let gid: string;
beforeEach(async () => {
  h = await setupHarness();
  [a, b] = [await person(h, 'alice'), await person(h, 'bob')];
  gid = await makeGroup(a, 'ก๊วนแมว');
});
afterEach(async () => {
  await h.cleanup();
});

type Pending = { invites: { id: string; groupId: string; groupName: string; inviterName: string; expiresAt: number }[] };
const invite = (p: Person, username: string, g = gid) => post<{ invite: { id: string; kind: string; inviteeName: string; expiresAt: number; createdAt: number } }>(p.c, `/api/groups/${g}/invites/direct`, { username });
const mine = (p: Person) => get<Pending>(p.c, '/api/me/invites');

describe('สร้างคำเชิญตรง', () => {
  it('ชวน username (ไม่สนตัวพิมพ์) → 201, ผู้รับเห็นในรายการ, สร้าง notification group.invite.received (ค่าดิบ ไม่มีโค้ด), audit', async () => {
    const r = await invite(a, '  BoB ');
    expect(r.status).toBe(201);
    expect(r.data.invite).toMatchObject({ kind: 'direct', inviteeName: b.displayName });
    expect(r.data.invite.expiresAt - r.data.invite.createdAt).toBe(7 * DAY);
    const list = await mine(b);
    expect(list.data.invites).toEqual([{ id: r.data.invite.id, groupId: gid, groupName: 'ก๊วนแมว', inviterName: a.displayName, createdAt: h.clock.now(), expiresAt: h.clock.now() + 7 * DAY }]);
    const n = await h.rows<{ user_id: string; kind: string; params: string }>('SELECT user_id, kind, params FROM notification');
    expect(n).toHaveLength(1);
    expect(n[0]!.user_id).toBe(b.id);
    expect(n[0]!.kind).toBe('group.invite.received');
    expect(JSON.parse(n[0]!.params)).toEqual({ groupId: gid, groupName: 'ก๊วนแมว', inviterName: a.displayName, inviteId: r.data.invite.id });
    expect(await h.count("audit_log WHERE action = 'invite.direct.create' AND group_id = ?", [gid])).toBe(1);
    expect((await mine(a)).data.invites).toEqual([]); // ผู้ชวนไม่เห็นเป็นคำเชิญของตัวเอง
  });

  it('username ไม่มี/ถูกระงับ/ลบแล้ว → 404 USER_NOT_FOUND (Q4) · ชวนคนที่เป็นสมาชิกอยู่แล้ว/ตัวเอง → 409 ALREADY_MEMBER', async () => {
    const none = await invite(a, 'nobody_here');
    expect([none.status, none.code]).toEqual([404, 'USER_NOT_FOUND']);
    const sus = await person(h, 'sus');
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [sus.id]);
    expect((await invite(a, 'sus')).code).toBe('USER_NOT_FOUND');
    await join(a, b, gid);
    const dup = await invite(a, 'bob');
    expect([dup.status, dup.code]).toEqual([409, 'ALREADY_MEMBER']);
    expect((await invite(a, 'alice')).code).toBe('ALREADY_MEMBER');
    expect(await h.count('group_invite WHERE kind = ?', ['direct'])).toBe(0);
  });

  it('ซ้ำ (คำเชิญ active ถึงคนเดิมในกลุ่มเดิม) → 409 CONFLICT · หมดอายุแล้วชวนใหม่ได้ · ต่างกลุ่มได้', async () => {
    expect((await invite(a, 'bob')).status).toBe(201);
    const dup = await invite(a, 'bob');
    expect([dup.status, dup.code]).toEqual([409, 'CONFLICT']);
    expect(await h.count("group_invite WHERE kind = 'direct' AND status = 'active'")).toBe(1);
    const g2 = await makeGroup(a, 'อีกกลุ่ม');
    expect((await invite(a, 'bob', g2)).status).toBe(201);
    h.clock.advance(7 * DAY);
    expect((await mine(b)).data.invites).toEqual([]); // หมดอายุไม่โผล่
    expect((await invite(a, 'bob')).status).toBe(201); // ชวนใหม่ได้ (ตัวเก่าถูกปิดเป็น expired)
    expect(await h.count("group_invite WHERE kind = 'direct' AND status = 'expired'")).toBe(1); // เฉพาะคู่ (g, bob) — ของ g2 ยัง active
  });

  it('สมาชิกทุก role ชวนได้ · คนนอกกลุ่ม 404 · ไม่ล็อกอิน 401', async () => {
    await join(a, b, gid);
    await person(h, 'cara');
    const d = await person(h, 'dan');
    expect((await invite(b, 'cara')).status).toBe(201); // member ชวนได้ (PRD §3 แถว 6)
    expect((await invite(d, 'cara')).status).toBe(404); // ไม่ใช่สมาชิก → 404 ก่อนค้นหา username
    const { Client } = await import('./harness');
    expect((await post(new Client(), `/api/groups/${gid}/invites/direct`, { username: 'cara' })).status).toBe(401);
  });

  it('จำกัด 30 ครั้ง/ชม./ผู้ใช้ (นับทุกครั้งรวมที่ไม่พบ) → ครั้งที่ 31 RATE_LIMITED · ผู้ใช้อื่นไม่กระทบ · ครบชั่วโมงใช้ได้อีก', async () => {
    for (let i = 0; i < 30; i++) expect((await invite(a, `ghost${i}`)).code).toBe('USER_NOT_FOUND');
    const lim = await invite(a, 'bob');
    expect([lim.status, lim.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(lim.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await h.count('group_invite WHERE kind = ?', ['direct'])).toBe(0);
    await join(a, b, gid);
    expect((await invite(b, 'ghost')).code).toBe('USER_NOT_FOUND');
    h.clock.advance(60 * 60_000);
    expect((await invite(a, 'nobody')).code).toBe('USER_NOT_FOUND');
  });

  it('ยิงพร้อมกัน 45 ครั้ง → ตรวจ username ได้แค่ 30 ครั้ง', async () => {
    const rs = await Promise.all(Array.from({ length: 45 }, (_, i) => invite(a, `ghost${i}`)));
    expect(rs.filter((r) => r.code === 'USER_NOT_FOUND')).toHaveLength(30);
    expect(rs.filter((r) => r.code === 'RATE_LIMITED')).toHaveLength(15);
  });
});

describe('รับ/ปฏิเสธ', () => {
  it('รับ → เป็น member, คำเชิญ accepted, ผู้ชวนได้ notification, ออกจากรายการค้าง · รับซ้ำ 409', async () => {
    const inv = (await invite(a, 'bob')).data.invite.id;
    const r = await post<{ groupId: string; alreadyMember: boolean }>(b.c, `/api/me/invites/${inv}/accept`);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ groupId: gid, alreadyMember: false });
    expect(await roleOf(h, gid, b.id)).toBe('member');
    expect((await mine(b)).data.invites).toEqual([]);
    expect(await h.rows('SELECT status, uses_count FROM group_invite WHERE id = ?', [inv])).toEqual([{ status: 'accepted', uses_count: 1 }]);
    const n = await h.rows<{ user_id: string; kind: string; params: string }>("SELECT user_id, kind, params FROM notification WHERE kind = 'group.invite.accepted'");
    expect(n).toHaveLength(1);
    expect(n[0]!.user_id).toBe(a.id);
    expect(JSON.parse(n[0]!.params)).toMatchObject({ groupId: gid, inviteeName: b.displayName });
    const again = await post(b.c, `/api/me/invites/${inv}/accept`);
    expect([again.status, again.code]).toEqual([409, 'CONFLICT']);
    expect((await post(b.c, `/api/me/invites/${inv}/decline`)).code).toBe('CONFLICT');
    expect(await h.count('group_member WHERE group_id = ?', [gid])).toBe(2);
  });

  it('ปฏิเสธ → ไม่เป็นสมาชิก, คำเชิญ declined, ผู้ชวนได้ notification · ชวนใหม่ได้หลังปฏิเสธ', async () => {
    const inv = (await invite(a, 'bob')).data.invite.id;
    const r = await post(b.c, `/api/me/invites/${inv}/decline`);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ declined: true });
    expect(await roleOf(h, gid, b.id)).toBeNull();
    expect(await h.count("notification WHERE kind = 'group.invite.declined' AND user_id = ?", [a.id])).toBe(1);
    expect((await post(b.c, `/api/me/invites/${inv}/accept`)).code).toBe('CONFLICT');
    expect((await invite(a, 'bob')).status).toBe(201);
  });

  it('หมดอายุ 7 วัน → รับไม่ได้ (404) ไม่เป็นสมาชิก', async () => {
    const inv = (await invite(a, 'bob')).data.invite.id;
    h.clock.advance(7 * DAY - 1);
    const early = await mine(b);
    expect(early.data.invites).toHaveLength(1);
    h.clock.advance(1);
    const r = await post(b.c, `/api/me/invites/${inv}/accept`);
    expect([r.status, r.code]).toEqual([404, 'NOT_FOUND']);
    expect(await roleOf(h, gid, b.id)).toBeNull();
  });

  it('คำเชิญของคนอื่น/ไม่มีอยู่/โค้ด (ไม่ใช่ตรง) → 404 เหมือนกัน (ไม่ใช่ 403)', async () => {
    const c = await person(h, 'cara');
    const inv = (await invite(a, 'bob')).data.invite.id;
    const codeInvId = (await post<{ invite: { id: string } }>(a.c, `/api/groups/${gid}/invites/code`)).data.invite.id;
    for (const [who, id] of [[c, inv], [a, inv], [b, '00000000-0000-4000-8000-000000000000'], [b, codeInvId]] as const) {
      const r = await post(who.c, `/api/me/invites/${id}/accept`);
      expect([r.status, r.code]).toEqual([404, 'NOT_FOUND']);
      expect((await post(who.c, `/api/me/invites/${id}/decline`)).status).toBe(404);
    }
    expect(await roleOf(h, gid, c.id)).toBeNull();
    expect((await mine(b)).data.invites).toHaveLength(1); // ยังไม่ถูกแตะ
  });

  it('เพิกถอนโดยผู้ชวน/admin → ผู้รับรับไม่ได้ · ผู้ชวนออกจากกลุ่ม → คำเชิญที่ค้างใช้ไม่ได้ · กลุ่มถูกลบ → รับไม่ได้', async () => {
    await join(a, b, gid);
    const c = await person(h, 'cara');
    const d = await person(h, 'dan');
    const e = await person(h, 'eve');
    const i1 = (await invite(b, 'cara')).data.invite.id;
    const i2 = (await invite(b, 'dan')).data.invite.id;
    expect((await del(a.c, `/api/groups/${gid}/invites/${i1}`)).status).toBe(200);
    expect((await post(c.c, `/api/me/invites/${i1}/accept`)).status).toBe(404);
    await post(b.c, `/api/groups/${gid}/leave`);
    expect((await post(d.c, `/api/me/invites/${i2}/accept`)).status).toBe(404);
    const i3 = (await invite(a, 'eve')).data.invite.id;
    await del(a.c, `/api/groups/${gid}`);
    expect((await post(e.c, `/api/me/invites/${i3}/accept`)).status).toBe(404);
    expect(await h.count('group_member WHERE user_id IN (?, ?, ?)', [c.id, d.id, e.id])).toBe(0);
  });

  it('สมาชิกเต็ม 50 → รับไม่ได้ LIMIT_REACHED และคำเชิญยังค้างอยู่ (rollback) · มีที่ว่างแล้วรับได้', async () => {
    const inv = (await invite(a, 'bob')).data.invite.id;
    const ids: string[] = [];
    for (let i = 0; i < GROUP_LIMITS.membersPerGroup - 1; i++) {
      const u = await h.seedUser(`fill${i}`);
      ids.push(u.id);
      await h.rows("INSERT INTO group_member (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', 1)", [gid, u.id]);
    }
    expect(await h.count('group_member WHERE group_id = ?', [gid])).toBe(50);
    const r = await post(b.c, `/api/me/invites/${inv}/accept`);
    expect([r.status, r.code]).toEqual([409, 'LIMIT_REACHED']);
    expect(await h.rows('SELECT status, uses_count FROM group_invite WHERE id = ?', [inv])).toEqual([{ status: 'active', uses_count: 0 }]);
    expect(await h.count("notification WHERE kind = 'group.invite.accepted'")).toBe(0);
    await h.rows('DELETE FROM group_member WHERE user_id = ?', [ids[0]!]);
    expect((await post(b.c, `/api/me/invites/${inv}/accept`)).status).toBe(200);
  });

  it('รับพร้อมกัน 2 ครั้ง → สำเร็จครั้งเดียว · เป็นสมาชิกแล้วมาถูกชวนซ้ำ → alreadyMember', async () => {
    const inv = (await invite(a, 'bob')).data.invite.id;
    const rs = await Promise.all([post(b.c, `/api/me/invites/${inv}/accept`), post(b.c, `/api/me/invites/${inv}/accept`)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [gid, b.id])).toBe(1);
    // เข้ากลุ่มด้วยโค้ดระหว่างที่คำเชิญตรงค้างอยู่ แล้วค่อยกดรับ
    const c = await person(h, 'cara');
    const i2 = (await invite(a, 'cara')).data.invite.id;
    const code = await makeCode(a, gid);
    await post(c.c, '/api/invites/redeem', { code });
    const r = await post<{ alreadyMember: boolean }>(c.c, `/api/me/invites/${i2}/accept`);
    expect(r.status).toBe(200);
    expect(r.data.alreadyMember).toBe(true);
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [gid, c.id])).toBe(1);
  });
});
