// R2-6 IDOR: คนที่ไม่ใช่สมาชิกเรียก endpoint กลุ่ม/สมาชิก/คำเชิญของกลุ่มอื่นทุกตัว → 404 (ไม่ใช่ 403) · กลุ่มที่ลบแล้ว/ไม่มีอยู่ → 404 เหมือนกัน
// R2-7 invite.list: MEM เห็นเฉพาะโค้ดที่ตนสร้าง (ทั้งที่ชั้นข้อมูลและ API)
// + ทุก endpoint ใหม่อยู่ใน manifest และ "ปฏิเสธ anonymous"
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { listActiveInvitesOfGroup } from '@/lib/data/repos/group-invite';
import { call, del, get, join, makeCode, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from './harness';

let h: Harness;
let a: Person; // admin
let m: Person; // moderator
let b: Person; // member
let c: Person; // member
let out: Person; // ไม่ใช่สมาชิก
let boss: Person; // super admin
let gid: string;
beforeEach(async () => {
  h = await setupHarness();
  [a, m, b, c, out, boss] = [await person(h, 'alice'), await person(h, 'mod'), await person(h, 'bob'), await person(h, 'cara'), await person(h, 'out'), await person(h, 'boss', { admin: true })];
  gid = await makeGroup(a);
  for (const p of [m, b, c]) await join(a, p, gid);
  await patch(a.c, `/api/groups/${gid}/members/${m.id}`, { role: 'moderator' });
});
afterEach(async () => {
  await h.cleanup();
});

const NIL = '00000000-0000-4000-8000-000000000000';

/** ทุก endpoint ที่ผูกกลุ่ม (ยกเว้นที่ไม่ผูกกลุ่ม) — สร้างคำขอจาก gid/uid/iid จริง */
function groupScoped(g: string, uid: string, iid: string) {
  return [
    ['GET', `/api/groups/${g}`, undefined],
    ['PATCH', `/api/groups/${g}`, { name: 'แฮ็ก' }],
    ['DELETE', `/api/groups/${g}`, undefined],
    ['DELETE', `/api/groups/${g}/members/${uid}`, undefined],
    ['PATCH', `/api/groups/${g}/members/${uid}`, { role: 'moderator' }],
    ['POST', `/api/groups/${g}/transfer-admin`, { toUserId: uid }],
    ['POST', `/api/groups/${g}/leave`, undefined],
    ['POST', `/api/groups/${g}/invites/direct`, { username: 'cara' }],
    ['POST', `/api/groups/${g}/invites/code`, undefined],
    ['GET', `/api/groups/${g}/invites`, undefined],
    ['DELETE', `/api/groups/${g}/invites/${iid}`, undefined],
  ] as const;
}

describe('R2-6 IDOR', () => {
  it('คนนอกกลุ่ม: ทุก endpoint ผูกกลุ่ม → 404 NOT_FOUND ตัวเดียวกัน และไม่แก้อะไร', async () => {
    const codeId = (await h.rows<{ id: string }>("SELECT id FROM group_invite WHERE kind = 'code' LIMIT 1"))[0]!.id;
    const before = await snapshot(h);
    const seen: string[] = [];
    for (const [method, path, body] of groupScoped(gid, b.id, codeId)) {
      const r = await call(out.c, method, path, body);
      expect([r.status, r.code], `${method} ${path}`).toEqual([404, 'NOT_FOUND']);
      seen.push(r.text);
    }
    expect(new Set(seen).size).toBe(1); // ทุกไบต์เหมือนกัน
    expect(await snapshot(h)).toEqual(before);
  });

  it('กลุ่มไม่มีอยู่ / กลุ่มที่ลบแล้ว (สำหรับสมาชิกเดิมและ super admin ด้วย) → 404 เหมือนคนนอกกลุ่มทุกไบต์', async () => {
    const codeId = (await post<{ invite: { id: string } }>(a.c, `/api/groups/${gid}/invites/code`)).data.invite.id;
    const outsider404 = (await get(out.c, `/api/groups/${gid}`)).text;
    const ghost = (await get(out.c, `/api/groups/${NIL}`)).text;
    expect(ghost).toBe(outsider404);
    expect((await del(a.c, `/api/groups/${gid}`)).status).toBe(200);
    for (const who of [a, m, b, boss, out]) {
      for (const [method, path, body] of groupScoped(gid, b.id, codeId)) {
        const r = await call(who.c, method, path, body);
        expect([r.status, r.text], `${who.username} ${method} ${path}`).toEqual([404, outsider404]);
      }
      for (const [method, path, body] of groupScoped(NIL, b.id, codeId)) {
        const r = await call(who.c, method, path, body);
        expect([r.status, r.text], `${who.username} ${method} ${path} (ghost)`).toEqual([404, outsider404]);
      }
    }
  });

  it('ผู้ถูกลบออกจากกลุ่ม → request ถัดไปได้ 404 ทันที (ไม่มี cache)', async () => {
    expect((await get(b.c, `/api/groups/${gid}`)).status).toBe(200);
    await del(a.c, `/api/groups/${gid}/members/${b.id}`);
    expect((await get(b.c, `/api/groups/${gid}`)).status).toBe(404);
    expect((await get(b.c, `/api/groups/${gid}/invites`)).status).toBe(404);
  });

  it('สมาชิกกลุ่ม A เรียกกลุ่ม B ที่ตัวเองไม่ได้อยู่ → 404 · iid/uid ของกลุ่มอื่นไม่ข้ามกลุ่ม', async () => {
    const g2 = await makeGroup(c, 'กลุ่มของ cara');
    const c2Code = (await post<{ invite: { id: string } }>(c.c, `/api/groups/${g2}/invites/code`)).data.invite.id;
    // b เป็นสมาชิก gid ไม่ใช่ g2
    expect((await get(b.c, `/api/groups/${g2}`)).status).toBe(404);
    // a (admin ของ gid) ใช้ gid + iid ของ g2 → 404 (เพิกถอนข้ามกลุ่มไม่ได้)
    expect((await del(a.c, `/api/groups/${gid}/invites/${c2Code}`)).status).toBe(404);
    expect(await h.rows('SELECT status FROM group_invite WHERE id = ?', [c2Code])).toEqual([{ status: 'active' }]);
    // a เป็น admin ของ gid ลบสมาชิกของ g2 ผ่าน path gid → 404 (ไม่เป็นสมาชิกของ gid)
    expect((await del(a.c, `/api/groups/${gid}/members/${c.id}`)).status).toBe(200); // c เป็นสมาชิก gid จริง — ลบได้
    expect((await del(a.c, `/api/groups/${gid}/members/${c.id}`)).status).toBe(404); // ลบไปแล้ว
    expect(await h.count('group_member WHERE group_id = ?', [g2])).toBe(1);
  });

  it('super admin ที่ไม่ใช่สมาชิก เห็น/จัดการกลุ่มได้ (ไม่ใช่ 404) แต่ leave → 404', async () => {
    expect((await get(boss.c, `/api/groups/${gid}`)).status).toBe(200);
    expect((await get(boss.c, `/api/groups/${gid}/invites`)).status).toBe(200);
    expect((await post(boss.c, `/api/groups/${gid}/leave`)).status).toBe(404);
  });
});

describe('endpoint ใหม่ทั้งหมดอยู่ใน manifest + ปฏิเสธ anonymous', () => {
  const R2 = ROUTE_MANIFEST.filter((e) => e.owner === 'platform' && (e.path.startsWith('/api/groups') || e.path.startsWith('/api/invites') || e.path.startsWith('/api/me/invites')) && !e.path.endsWith('/calendar') && !e.path.endsWith('/availability')); // calendar = R3, availability = R4A

  it('ครบ 17 endpoint ของ R2_CONTRACT §2', () => {
    expect(R2.map((e) => `${e.method} ${e.path}`).sort()).toEqual(
      [
        'POST /api/groups',
        'GET /api/groups',
        'GET /api/groups/:gid',
        'PATCH /api/groups/:gid',
        'DELETE /api/groups/:gid',
        'DELETE /api/groups/:gid/members/:uid',
        'PATCH /api/groups/:gid/members/:uid',
        'POST /api/groups/:gid/transfer-admin',
        'POST /api/groups/:gid/leave',
        'POST /api/groups/:gid/invites/direct',
        'POST /api/groups/:gid/invites/code',
        'GET /api/groups/:gid/invites',
        'DELETE /api/groups/:gid/invites/:iid',
        'POST /api/invites/redeem',
        'GET /api/me/invites',
        'POST /api/me/invites/:iid/accept',
        'POST /api/me/invites/:iid/decline',
      ].sort(),
    );
    for (const e of R2) expect(e.action, `${e.method} ${e.path}`).not.toBeNull();
  });

  it('anonymous → 401 AUTH_REQUIRED ทุกตัว (ผ่านด่าน CSRF/validation แล้ว) · ผู้ใช้ที่ต้องเปลี่ยน PIN → 403 PIN_CHANGE_REQUIRED ทุกตัว', async () => {
    const { Client } = await import('./harness');
    const anon = new Client();
    await h.rows("UPDATE user SET must_change_pin = 1 WHERE id = ?", [out.id]);
    const outPin = new Client();
    outPin.set(...cookieOf(out));
    const samples: Record<string, unknown> = {
      'POST /api/groups': { name: 'x' },
      'PATCH /api/groups/:gid': { name: 'x' },
      'PATCH /api/groups/:gid/members/:uid': { role: 'member' },
      'POST /api/groups/:gid/transfer-admin': { toUserId: NIL },
      'POST /api/groups/:gid/invites/direct': { username: 'cara' },
      'POST /api/invites/redeem': { code: 'ABCD-EFGH' },
    };
    for (const e of R2) {
      const url = e.path.replace(/:\w+/g, NIL);
      const body = e.method === 'GET' ? undefined : (samples[`${e.method} ${e.path}`] ?? {});
      const r = await call(anon, e.method as 'POST', url, body);
      expect([r.status, r.code], `${e.method} ${e.path}`).toEqual([401, 'AUTH_REQUIRED']);
      const p = await call(outPin, e.method as 'POST', url, body);
      expect([p.status, p.code], `${e.method} ${e.path} (must_change_pin)`).toEqual([403, 'PIN_CHANGE_REQUIRED']);
    }
  });

  it('non-GET ที่ไม่มี Origin/JSON → CSRF_REJECTED (DELETE ด้วย)', async () => {
    const r = await call(a.c, 'DELETE', `/api/groups/${gid}`, undefined, { headers: { origin: 'https://evil.example' } });
    expect([r.status, r.code]).toEqual([403, 'CSRF_REJECTED']);
    expect((await get(a.c, `/api/groups/${gid}`)).status).toBe(200); // ไม่ถูกลบ
  });
});

describe('R2-7 invite.list — MEM เห็นเฉพาะของตัวเอง', () => {
  it('API: admin/mod/SA เห็นทุกโค้ดและคำเชิญตรง · member เห็นเฉพาะที่ตัวเองสร้าง · ไม่มีฟิลด์โค้ดเต็ม/hash', async () => {
    const c1 = await makeCode(a, gid);
    const c2 = await makeCode(b, gid);
    const c3 = await makeCode(c, gid);
    await post(c.c, `/api/groups/${gid}/invites/direct`, { username: 'out' });
    type L = { invites: { kind: string; createdBy: string; codeHint: string | null }[] };
    const as = async (p: Person) => (await get<L>(p.c, `/api/groups/${gid}/invites`)).data.invites;
    // + 3 โค้ดที่ admin สร้างตอน join() ใน beforeEach (m, b, c เข้ากลุ่ม)
    expect((await as(a)).length).toBe(7);
    expect((await as(m)).length).toBe(7);
    expect((await as(boss)).length).toBe(7);
    const bs = await as(b);
    expect(bs.map((x) => x.createdBy)).toEqual([b.id]);
    expect(bs[0]!.codeHint).toBe(c2.replace('-', '').slice(-4));
    const cs = await as(c);
    expect(cs.map((x) => `${x.kind}:${x.createdBy}`).sort()).toEqual([`code:${c.id}`, `direct:${c.id}`].sort());
    const raw = (await get(a.c, `/api/groups/${gid}/invites`)).text;
    for (const code of [c1, c2, c3]) expect(raw).not.toContain(code.replace('-', ''));
    expect(raw).not.toMatch(/codeHash|code_hash/);
    expect((await get(out.c, `/api/groups/${gid}/invites`)).status).toBe(404);
  });

  it('ชั้นข้อมูล: listActiveInvitesOfGroup กรอง created_by ที่ SQL · เฉพาะ active และยังไม่หมดอายุ · เพิกถอนแล้วหายจากรายการ', async () => {
    await makeCode(a, gid);
    await makeCode(b, gid);
    const now = h.clock.now();
    expect(await listActiveInvitesOfGroup(h.db, gid, now)).toHaveLength(5); // + 3 โค้ดจาก join() ใน beforeEach
    const mine = await listActiveInvitesOfGroup(h.db, gid, now, { createdBy: b.id });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.createdBy).toBe(b.id);
    expect(mine.every((r) => r.codeHash === null)).toBe(true);
    const id = mine[0]!.id;
    await del(b.c, `/api/groups/${gid}/invites/${id}`);
    expect(await listActiveInvitesOfGroup(h.db, gid, now, { createdBy: b.id })).toHaveLength(0);
    expect(await listActiveInvitesOfGroup(h.db, gid, now + 8 * 86_400_000)).toHaveLength(0); // หมดอายุหมด
  });

  it('member ที่ถูกเลื่อนเป็น moderator เห็นทุกแถว · ลดกลับเป็น member เห็นเฉพาะของตัวเองอีกครั้ง (ตัดสินสด ไม่ cache)', async () => {
    await makeCode(a, gid);
    await makeCode(b, gid);
    type L = { invites: unknown[] };
    expect((await get<L>(b.c, `/api/groups/${gid}/invites`)).data.invites).toHaveLength(1);
    await patch(a.c, `/api/groups/${gid}/members/${b.id}`, { role: 'moderator' });
    expect((await get<L>(b.c, `/api/groups/${gid}/invites`)).data.invites).toHaveLength(5); // ทุกแถว (รวม 3 โค้ดจาก join())
    await patch(a.c, `/api/groups/${gid}/members/${b.id}`, { role: 'member' });
    expect((await get<L>(b.c, `/api/groups/${gid}/invites`)).data.invites).toHaveLength(1);
  });

  it('super admin นอกกลุ่มดูรายการ → audit asSuperAdmin', async () => {
    await makeCode(a, gid);
    await get(boss.c, `/api/groups/${gid}/invites`);
    const rows = await h.rows<{ meta: string }>("SELECT meta FROM audit_log WHERE action = 'invite.list' AND actor_id = ?", [boss.id]);
    expect(rows.map((r) => JSON.parse(r.meta))).toEqual([{ asSuperAdmin: true }]);
  });
});

/** คุกกี้ session ของเครื่อง */
function cookieOf(p: Person): [string, string] {
  const entry = [...p.c.jar][0]!;
  return [entry[0], entry[1]];
}

/** สถานะที่เกี่ยวกับกลุ่มทั้งหมด (เทียบก่อน/หลัง) */
async function snapshot(h: Harness) {
  return {
    groups: await h.rows('SELECT * FROM groups ORDER BY id'),
    members: await h.rows('SELECT * FROM group_member ORDER BY group_id, user_id'),
    invites: await h.rows('SELECT * FROM group_invite ORDER BY id'),
  };
}
