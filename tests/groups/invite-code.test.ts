// R2-3 · U5 (ข) โค้ดเชิญ: alphabet/สุ่ม · ไม่มีโค้ดดิบในฐาน/audit/notification · หมดอายุ 7 วัน · เพิกถอน · INVITE_INVALID ทุกสาเหตุเหมือนกันทุกไบต์ ·
// สมาชิกเดิมไม่สร้างแถวซ้ำ · เพดาน 20 โค้ด / 50 สมาชิก · rate limit แบบ reserve (ยิงเดาพร้อมกัน)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sameResponse } from '../auth/harness';
import { GROUP_LIMITS } from '@/lib/shared/limits';
import { DAY, del, dumpAllTables, get, join, makeCode, makeGroup, person, post, setupHarness, type Harness, type Person } from './harness';

let h: Harness;
let a: Person;
let b: Person;
let gid: string;
beforeEach(async () => {
  h = await setupHarness();
  [a, b] = [await person(h, 'alice'), await person(h, 'bob')];
  gid = await makeGroup(a);
});
afterEach(async () => {
  await h.cleanup();
});

const redeem = (p: Person, code: string) => post<{ groupId: string; groupName: string; alreadyMember: boolean }>(p.c, '/api/invites/redeem', { code });
type Created = { invite: { id: string; code: string; codeHint: string; createdAt: number; expiresAt: number } };

describe('สร้างโค้ด', () => {
  it('คืนโค้ดเต็มรูป XXXX-XXXX ครั้งเดียว + hint 4 ตัวท้าย + หมดอายุ 7 วัน · สมาชิกทุก role สร้างได้ · คนนอกกลุ่ม 404', async () => {
    const r = await post<Created>(a.c, `/api/groups/${gid}/invites/code`);
    expect(r.status).toBe(201);
    expect(r.data.invite.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(r.data.invite.codeHint).toBe(r.data.invite.code.replace('-', '').slice(-4));
    expect(r.data.invite.expiresAt - r.data.invite.createdAt).toBe(7 * DAY);
    await join(a, b, gid);
    expect((await post(b.c, `/api/groups/${gid}/invites/code`)).status).toBe(201); // member
    const outsider = await person(h, 'outsider');
    expect((await post(outsider.c, `/api/groups/${gid}/invites/code`)).status).toBe(404);
  });

  it('โค้ดเต็มไม่ปรากฏที่ใดอีก: ไม่อยู่ในรายการ, ไม่อยู่ทุกตารางของฐาน (รวม audit/notification/rate-limit), มีแต่ hash 64 hex + hint', async () => {
    const code = await makeCode(a, gid);
    const plain = code.replace('-', '');
    await redeem(b, code); // ใช้จริงหนึ่งครั้ง (เขียน audit/uses_count)
    await post(a.c, `/api/groups/${gid}/invites/direct`, { username: 'bob' }).catch(() => undefined);
    await redeem(await person(h, 'cara'), 'ZZZZ-ZZZZ'); // เดาผิด (เขียน rate-limit bucket)
    const list = await get(a.c, `/api/groups/${gid}/invites`);
    expect(list.text).not.toContain(plain);
    expect(list.text).not.toContain(code);
    const dump = await dumpAllTables(h);
    for (const needle of [plain, code, plain.toLowerCase(), plain.slice(0, 4) + plain.slice(4)]) expect(dump).not.toContain(needle);
    const rows = await h.rows<{ code_hash: string; code_hint: string }>("SELECT code_hash, code_hint FROM group_invite WHERE kind = 'code'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.code_hint).toBe(plain.slice(-4));
    // ไม่มีข้อมูลที่ไล่ย้อนโค้ดได้เกินกว่า 4 ตัวท้าย: hash ไม่ใช่ SHA-256 ล้วนของโค้ด (มีกุญแจ)
    const { createHash } = await import('node:crypto');
    expect(rows[0]!.code_hash).not.toBe(createHash('sha256').update(plain).digest('hex'));
  });

  it('เพดาน 20 โค้ดที่ยังใช้ได้ต่อกลุ่ม → ครั้งที่ 21 LIMIT_REACHED · เพิกถอน/หมดอายุคืนช่อง · ปฏิเสธพร้อมกันไม่เกิน 20', async () => {
    const ids: string[] = [];
    for (let i = 0; i < GROUP_LIMITS.activeCodesPerGroup; i++) ids.push((await post<Created>(a.c, `/api/groups/${gid}/invites/code`)).data.invite.id);
    const over = await post(a.c, `/api/groups/${gid}/invites/code`);
    expect([over.status, over.code]).toEqual([409, 'LIMIT_REACHED']);
    expect(over.json.error?.params).toEqual({ limit: 'codes', max: 20 });
    expect((await del(a.c, `/api/groups/${gid}/invites/${ids[0]}`)).status).toBe(200);
    expect((await post(a.c, `/api/groups/${gid}/invites/code`)).status).toBe(201);
    expect((await post(a.c, `/api/groups/${gid}/invites/code`)).code).toBe('LIMIT_REACHED');
    h.clock.advance(8 * DAY); // ทุกโค้ดหมดอายุ → ไม่นับ
    expect((await post(a.c, `/api/groups/${gid}/invites/code`)).status).toBe(201);
    // พร้อมกัน: กลุ่มใหม่ ยิง 30
    const g2 = await makeGroup(a, 'อีกกลุ่ม');
    const rs = await Promise.all(Array.from({ length: 30 }, () => post(a.c, `/api/groups/${g2}/invites/code`)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(20);
    expect(await h.count("group_invite WHERE group_id = ? AND kind = 'code' AND status = 'active'", [g2])).toBe(20);
  });
});

describe('ใช้โค้ด', () => {
  it('ใช้ได้ → เป็น member, uses_count เพิ่ม, audit (ไม่มีโค้ด) · ใช้ได้หลายคน (Q5) · ตัวพิมพ์เล็ก/ไม่มีขีด/ช่องว่าง/ขีดยูนิโค้ด/ตัวเต็มความกว้าง ใช้ได้', async () => {
    const code = await makeCode(a, gid);
    const plain = code.replace('-', '');
    const r = await redeem(b, code.toLowerCase());
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ groupId: gid, groupName: 'ก๊วนแมว', alreadyMember: false });
    expect(await h.count("group_member WHERE group_id = ? AND user_id = ? AND role = 'member'", [gid, b.id])).toBe(1);
    const cara = await person(h, 'cara');
    expect((await redeem(cara, `  ${plain.slice(0, 4)}–${plain.slice(4)} `)).status).toBe(200); // en dash
    const dan = await person(h, 'dan');
    expect((await redeem(dan, plain.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)))).status).toBe(200); // ตัวเต็มความกว้าง
    expect(await h.rows("SELECT uses_count FROM group_invite WHERE kind = 'code'")).toEqual([{ uses_count: 3 }]);
    const audit = await h.rows<{ actor_id: string; meta: string }>("SELECT actor_id, meta FROM audit_log WHERE action = 'invite.code.redeem' ORDER BY created_at, id");
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toContain(plain);
  });

  it('สมาชิกเดิมใช้โค้ดซ้ำ → 200 alreadyMember ไม่สร้างแถวซ้ำ ไม่เพิ่ม uses_count · admin เดิมใช้โค้ดตัวเอง role ไม่เปลี่ยน', async () => {
    const code = await makeCode(a, gid);
    await redeem(b, code);
    const again = await redeem(b, code);
    expect(again.status).toBe(200);
    expect(again.data.alreadyMember).toBe(true);
    expect((await redeem(a, code)).data.alreadyMember).toBe(true);
    expect(await h.count('group_member WHERE group_id = ?', [gid])).toBe(2);
    expect(await h.rows("SELECT uses_count FROM group_invite WHERE kind = 'code'")).toEqual([{ uses_count: 1 }]);
    expect(await h.count("group_member WHERE group_id = ? AND role = 'admin'", [gid])).toBe(1);
  });

  it('หมดอายุ 7 วัน (นาฬิกาจำลอง): ก่อนครบใช้ได้ ครบแล้ว INVITE_INVALID · เพิกถอนแล้วใช้ไม่ได้', async () => {
    const code = await makeCode(a, gid);
    h.clock.advance(7 * DAY - 1);
    expect((await redeem(b, code)).status).toBe(200);
    h.clock.advance(1); // ถึง expires_at พอดี = หมดอายุ
    const cara = await person(h, 'cara');
    const r = await redeem(cara, code);
    expect([r.status, r.code]).toEqual([400, 'INVITE_INVALID']);
    const code2 = await makeCode(a, gid);
    const inv = await h.rows<{ id: string }>("SELECT id FROM group_invite WHERE kind = 'code' AND status = 'active' AND expires_at > ?", [h.clock.now()]);
    expect((await del(a.c, `/api/groups/${gid}/invites/${inv[0]!.id}`)).status).toBe(200);
    expect((await redeem(cara, code2)).code).toBe('INVITE_INVALID');
    expect(await h.rows("SELECT status, revoked_by FROM group_invite WHERE id = ?", [inv[0]!.id])).toEqual([{ status: 'revoked', revoked_by: a.id }]);
  });

  it('INVITE_INVALID เหมือนกันทุกไบต์: ไม่มีอยู่จริง / หมดอายุ / เพิกถอน / กลุ่มถูกลบ / รูปผิด / ว่างเปล่าหลัง normalize', async () => {
    const expired = await makeCode(a, gid);
    h.clock.advance(8 * DAY);
    const revoked = await makeCode(a, gid);
    const revId = (await h.rows<{ id: string }>("SELECT id FROM group_invite WHERE status = 'active' AND expires_at > ?", [h.clock.now()]))[0]!.id;
    await del(a.c, `/api/groups/${gid}/invites/${revId}`);
    const g2 = await makeGroup(a, 'จะลบ');
    const inDeleted = await makeCode(a, g2);
    await del(a.c, `/api/groups/${g2}`);
    // ผู้ทดสอบแต่ละคนเครื่อง/ผู้ใช้ต่างกัน (กัน rate limit) แต่ response ต้องเหมือนกันทุกไบต์
    const attempts = [expired, revoked, inDeleted, 'ABCD-EFGH', 'AAAA-AAAA', 'abcdefgh', '0000-1111', 'ABCD', 'ABCD-EFGHJ', '----', '😀😀😀😀'];
    const responses = [];
    for (let i = 0; i < attempts.length; i++) {
      const p = await person(h, `guess${i}`);
      responses.push(await redeem(p, attempts[i]!));
    }
    expect(responses[0]!.status).toBe(400);
    expect(responses[0]!.code).toBe('INVITE_INVALID');
    for (const r of responses.slice(1)) sameResponse(responses[0]!, r);
  });

  it('คนที่ไม่ได้ล็อกอิน → 401 · body ผิดรูป → VALIDATION ไม่แตะโค้ด', async () => {
    const { Client } = await import('./harness');
    expect((await redeem({ c: new Client() } as Person, 'ABCD-EFGH')).code).toBe('AUTH_REQUIRED');
    expect((await post(b.c, '/api/invites/redeem', {})).code).toBe('VALIDATION');
    expect((await post(b.c, '/api/invites/redeem', { code: 'x'.repeat(65) })).code).toBe('VALIDATION');
    expect((await post(b.c, '/api/invites/redeem', { code: 'ABCD-EFGH', extra: 1 })).code).toBe('VALIDATION');
  });

  it('สมาชิกเต็ม 50 → LIMIT_REACHED, ไม่เพิ่มคน · คนเดิมที่อยู่แล้วยังได้ 200 · เมื่อมีที่ว่างเข้าได้ · ไม่นับเป็นการเดาผิด', async () => {
    const code = await makeCode(a, gid);
    // เติมสมาชิกตรงในฐาน (ข้ามขั้นตอนสมัคร 48 คน) ให้เหลือที่ว่าง 1 ที่ → เป็น 49
    const ids = await fillMembers(h, gid, GROUP_LIMITS.membersPerGroup - 2);
    expect(await h.count('group_member WHERE group_id = ?', [gid])).toBe(49);
    expect((await redeem(b, code)).status).toBe(200); // คนที่ 50
    const cara = await person(h, 'cara');
    const full = await redeem(cara, code);
    expect([full.status, full.code]).toEqual([409, 'LIMIT_REACHED']);
    expect(full.json.error?.params).toEqual({ limit: 'members', max: 50 });
    expect(await h.count('group_member WHERE group_id = ?', [gid])).toBe(50);
    expect((await redeem(b, code)).data.alreadyMember).toBe(true);
    await del(a.c, `/api/groups/${gid}/members/${ids[0]}`);
    expect((await redeem(cara, code)).status).toBe(200);
    // LIMIT_REACHED ของโค้ดที่ถูกต้องไม่กินช่อง rate limit
    const dave = await person(h, 'dave');
    for (let i = 0; i < 12; i++) expect((await redeem(dave, code)).code).toBe('LIMIT_REACHED');
  });

  it('ยิงใช้โค้ดพร้อมกัน 20 คน ตอนเหลือที่ว่าง 5 → เข้าได้พอดี 5 (สมาชิก = 50 ไม่เกิน)', async () => {
    const code = await makeCode(a, gid);
    await fillMembers(h, gid, GROUP_LIMITS.membersPerGroup - 1 - 5); // admin + 44 = 45
    const people = await Promise.all(Array.from({ length: 20 }, (_, i) => person(h, `racer${i}`)));
    const rs = await Promise.all(people.map((p) => redeem(p, code)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(5);
    for (const r of rs.filter((x) => x.status !== 200)) expect(['LIMIT_REACHED', 'CONFLICT']).toContain(r.code);
    expect(await h.count('group_member WHERE group_id = ?', [gid])).toBe(50);
  });
});

describe('rate limit การเดา (reserve-before-check)', () => {
  it('ผู้ใช้เดียวเดาผิดพร้อมกัน 25 ครั้ง → ถึงขั้นตรวจโค้ดแค่ 10 (INVITE_INVALID) ที่เหลือ 429 RATE_LIMITED + Retry-After', async () => {
    const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => redeem(b, `GUES-${String(i).padStart(4, '2')}`)));
    const invalid = rs.filter((r) => r.code === 'INVITE_INVALID');
    const limited = rs.filter((r) => r.code === 'RATE_LIMITED');
    expect(invalid).toHaveLength(10);
    expect(limited).toHaveLength(15);
    for (const r of limited) {
      expect(r.status).toBe(429);
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    // ตัวนับไม่เกินเพดาน (ผู้ถูกปฏิเสธไม่ทำให้ count เกิน limit)
    const buckets = await h.rows<{ key: string; count: number }>("SELECT key, count FROM rate_limit_bucket WHERE key LIKE 'redeem:%' ORDER BY key");
    expect(Math.max(...buckets.map((x) => x.count))).toBeLessThanOrEqual(30);
    expect(buckets.find((x) => x.key === `redeem:u:${b.id}`)!.count).toBe(10);
  });

  it('ติดลิมิตแล้ว แม้โค้ดถูกก็ถูกปฏิเสธ (ตอบเหมือนกันไม่ว่าโค้ดถูกหรือผิด) · ครบหน้าต่าง 15 นาทีใช้ได้อีก', async () => {
    const code = await makeCode(a, gid);
    for (let i = 0; i < 10; i++) expect((await redeem(b, 'AAAA-BBBB')).code).toBe('INVITE_INVALID');
    const right = await redeem(b, code);
    const wrong = await redeem(b, 'AAAA-BBBB');
    expect([right.status, right.code]).toEqual([429, 'RATE_LIMITED']);
    sameResponse(right, wrong);
    h.clock.advance(15 * 60_000);
    expect((await redeem(b, code)).status).toBe(200);
  });

  it('หลายบัญชีจาก IP เดียวกันเดาพร้อมกัน 40 ครั้ง (คนละ 10) → ตรวจโค้ดได้แค่ 30 ครั้งตามเพดาน IP', async () => {
    const ip = '203.0.113.9';
    const users = await Promise.all([1, 2, 3, 4].map((i) => person(h, `ipuser${i}`)));
    const rs = await Promise.all(
      users.flatMap((u, ui) =>
        Array.from({ length: 10 }, (_, i) => post(u.c, '/api/invites/redeem', { code: `AAAA-${'BCDE'[ui]}${String(i + 2).padStart(3, '2')}` }, { headers: { 'x-real-ip': ip } })),
      ),
    );
    expect(rs.filter((r) => r.code === 'INVITE_INVALID')).toHaveLength(30);
    expect(rs.filter((r) => r.code === 'RATE_LIMITED')).toHaveLength(10);
  });

  it('ช่องที่ถูกปฏิเสธตอนผู้ใช้เต็มถูกคืนให้ IP (ไม่กินโควตา IP ของคนอื่น) · สำเร็จคืนช่อง', async () => {
    const ip = '203.0.113.10';
    const hdr = { headers: { 'x-real-ip': ip } };
    for (let i = 0; i < 10; i++) await post(b.c, '/api/invites/redeem', { code: 'AAAA-BBBB' }, hdr);
    for (let i = 0; i < 5; i++) expect((await post(b.c, '/api/invites/redeem', { code: 'AAAA-BBBB' }, hdr)).code).toBe('RATE_LIMITED');
    const ipRow = await h.rows<{ count: number }>("SELECT count FROM rate_limit_bucket WHERE key LIKE 'redeem:ip:%'");
    expect(ipRow).toEqual([{ count: 10 }]); // 5 ครั้งที่ถูกปฏิเสธไม่ค้างในถัง IP
    const code = await makeCode(a, gid);
    const cara = await person(h, 'cara');
    expect((await post(cara.c, '/api/invites/redeem', { code }, hdr)).status).toBe(200);
    expect((await h.rows<{ count: number }>("SELECT count FROM rate_limit_bucket WHERE key LIKE 'redeem:ip:%'"))[0]!.count).toBe(10); // สำเร็จ → คืน
  });
});

describe('เพิกถอน', () => {
  it('admin/mod เพิกถอนโค้ดของใครก็ได้ · member เฉพาะของตัวเอง · ซ้ำ = 200 · โค้ดที่ถูกใช้แล้วเพิกถอนได้ · ของกลุ่มอื่น 404', async () => {
    await join(a, b, gid);
    const c1 = (await post<Created>(a.c, `/api/groups/${gid}/invites/code`)).data.invite.id;
    const c2 = (await post<Created>(b.c, `/api/groups/${gid}/invites/code`)).data.invite.id;
    expect((await del(b.c, `/api/groups/${gid}/invites/${c1}`)).status).toBe(403); // member → ของ admin
    expect((await del(b.c, `/api/groups/${gid}/invites/${c2}`)).status).toBe(200); // ของตัวเอง
    expect((await del(b.c, `/api/groups/${gid}/invites/${c2}`)).status).toBe(200); // ซ้ำ
    expect((await del(a.c, `/api/groups/${gid}/invites/${c1}`)).status).toBe(200);
    const g2 = await makeGroup(a, 'อีกกลุ่ม');
    const c3 = (await post<Created>(a.c, `/api/groups/${g2}/invites/code`)).data.invite.id;
    expect((await del(a.c, `/api/groups/${gid}/invites/${c3}`)).status).toBe(404); // iid ของอีกกลุ่ม
    expect((await del(a.c, `/api/groups/${gid}/invites/${'00000000-0000-4000-8000-000000000000'}`)).status).toBe(404);
    expect(await h.count("audit_log WHERE action = 'invite.revoke'")).toBe(2);
  });
});

/** เติมสมาชิก role member โดยตรงในฐาน (เทสต์เพดานโดยไม่ต้องสมัคร/ล็อกอิน 50 คน) · คืน user id */
async function fillMembers(h: Harness, gid: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = await h.seedUser(`fill${gid.slice(0, 4)}${i}`);
    await h.rows("INSERT INTO group_member (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", [gid, u.id, h.clock.now()]);
    ids.push(u.id);
  }
  return ids;
}
