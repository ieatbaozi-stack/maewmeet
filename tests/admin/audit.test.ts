// R5-6 — GET /api/admin/audit: ใหม่→เก่า · cursor ไม่ซ้ำ/ไม่ตกหล่นเมื่อ createdAt ซ้ำ · กรองได้ · meta ผ่าน whitelist ·
// admin.audit.view ไม่เกิน 1 แถว/10 นาที/ผู้ใช้ · admin.group.view ไม่เกิน 1 แถว/(ผู้ใช้,กลุ่ม)/10 นาที (Sec L4) (R5_CONTRACT §2 ข้อ 3)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/lib/shared/id';
import { MIN, call, get, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

type Entry = { id: string; createdAt: number; action: string; actor: { id: string; username: string } | null; targetType: string; targetId: string; groupId: string | null; meta: Record<string, unknown> };
type AuditPage = { entries: Entry[]; nextCursor: string | null };

let h: Harness;
let boss: Person;
let alice: Person;

const audit = (q = '') => get<AuditPage>(boss.c, `/api/admin/audit${q ? `?${q}` : ''}`);
const insert = (row: { id?: string; actorId?: string | null; action: string; targetType?: string; targetId?: string; groupId?: string | null; meta?: unknown; createdAt: number }) =>
  h.rows('INSERT INTO audit_log (id, actor_id, action, target_type, target_id, group_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    row.id ?? newId(),
    row.actorId ?? null,
    row.action,
    row.targetType ?? 'user',
    row.targetId ?? 't',
    row.groupId ?? null,
    row.meta === undefined ? null : JSON.stringify(row.meta),
    row.createdAt,
  ]);

beforeEach(async () => {
  h = await setupHarness();
  boss = await person(h, 'boss', { admin: true });
  alice = await person(h, 'alice');
});
afterEach(async () => {
  await h.cleanup();
});

describe('admin.audit.view — ลดความถี่', () => {
  it('เปิดซ้ำภายใน 10 นาที (รวมเลื่อนหน้า/กรอง) = 1 แถว · เกิน 10 นาที = แถวใหม่ · SA อีกคนมีแถวของตัวเอง', async () => {
    for (let i = 0; i < 5; i++) expect((await audit(i % 2 ? 'action=group.create' : '')).status).toBe(200);
    expect(await h.count("audit_log WHERE action = 'admin.audit.view' AND actor_id = ?", [boss.id])).toBe(1);
    h.clock.advance(10 * MIN - 1);
    await audit();
    expect(await h.count("audit_log WHERE action = 'admin.audit.view' AND actor_id = ?", [boss.id])).toBe(1); // ยังไม่ครบ 10 นาที
    h.clock.advance(1);
    await audit();
    expect(await h.count("audit_log WHERE action = 'admin.audit.view' AND actor_id = ?", [boss.id])).toBe(2);
    const boss2 = await person(h, 'boss2', { admin: true });
    await get(boss2.c, '/api/admin/audit');
    expect(await h.count("audit_log WHERE action = 'admin.audit.view' AND actor_id = ?", [boss2.id])).toBe(1);
  });

  it('ผู้ใช้ทั่วไปเปิดไม่ได้ (403) และไม่เกิดแถว', async () => {
    expect((await get(alice.c, '/api/admin/audit')).status).toBe(403);
    expect(await h.count("audit_log WHERE action = 'admin.audit.view'")).toBe(0);
  });
});

describe('เรียงใหม่→เก่า · cursor (createdAt, id)', () => {
  it('createdAt ซ้ำกัน 7 แถว + แถวอื่น: เดินทีละ 3 ได้ครบทุกแถวครั้งเดียว ลำดับ (createdAt desc, id desc)', async () => {
    const t = h.clock.now() - 60_000;
    const ids = Array.from({ length: 7 }, () => newId());
    for (const id of ids) await insert({ id, action: 'group.create', createdAt: t });
    await insert({ action: 'group.create', createdAt: t - 1 });
    await insert({ action: 'group.create', createdAt: t + 1 });
    const seen: Entry[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: { status: number; data: AuditPage } = await audit(`action=group.create&limit=3${cursor ? `&before=${cursor}` : ''}`);
      expect(r.status).toBe(200);
      seen.push(...r.data.entries);
      cursor = r.data.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toHaveLength(9);
    expect(new Set(seen.map((e) => e.id)).size).toBe(9);
    const sorted = [...seen].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    expect(seen.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
    expect(seen.filter((e) => e.createdAt === t).map((e) => e.id)).toEqual([...ids].sort().reverse());
  });

  it('limit: ดีฟอลต์ 50 · สูงสุด 100 · 0/101/ไม่ใช่ตัวเลข → VALIDATION · before เสีย → VALIDATION', async () => {
    for (let i = 0; i < 120; i++) await insert({ action: 'group.update', createdAt: h.clock.now() - 1000 - i });
    expect((await audit()).data.entries).toHaveLength(50);
    expect((await audit('limit=100')).data.entries).toHaveLength(100);
    for (const bad of ['limit=0', 'limit=101', 'limit=abc', 'limit=-1']) {
      const r = await audit(bad);
      expect(r.status, bad).toBe(400);
      expect(r.code).toBe('VALIDATION');
    }
    for (const bad of ['before=xyz', `before=${Buffer.from('{"c":"x","i":"y"}').toString('base64url')}`, `before=${Buffer.from('{"c":1,"i":"not-uuid"}').toString('base64url')}`, 'before=%25%25']) {
      const r = await audit(bad);
      expect(r.status, bad).toBe(400);
      expect(r.json.error?.params).toEqual({ fields: { before: 'INVALID' } });
    }
  });
});

describe('กรอง', () => {
  it('actor / action / targetType / targetId (เท่ากันพอดี) · ค่าว่าง = ไม่กรอง · รูปผิด → VALIDATION', async () => {
    const t = h.clock.now() - 10_000;
    await insert({ actorId: alice.id, action: 'group.create', targetType: 'group', targetId: 'g1', groupId: 'g1', createdAt: t });
    await insert({ actorId: boss.id, action: 'member.remove', targetType: 'member', targetId: alice.id, groupId: 'g1', createdAt: t + 1 });
    await insert({ actorId: null, action: 'script.adminResetPin', targetType: 'pin_reset', targetId: 'r1', createdAt: t + 2 });
    const only = async (q: string) => (await audit(q)).data.entries.filter((e) => e.action !== 'admin.audit.view').map((e) => e.action);
    expect(await only(`actor=${alice.id}`)).toEqual(['group.create']);
    expect(await only('action=member.remove')).toEqual(['member.remove']);
    expect(await only('targetType=pin_reset')).toEqual(['script.adminResetPin']);
    expect(await only(`targetId=${alice.id}`)).toEqual(['member.remove']);
    expect(await only('targetType=group&targetId=g1')).toEqual(['group.create']);
    expect(await only('actor=&action=&targetType=&targetId=')).toEqual(['script.adminResetPin', 'member.remove', 'group.create']);
    // LIKE ไม่ถูกใช้: wildcard เป็นตัวอักษรธรรมดา (และรูปไม่ผ่าน)
    expect((await audit('action=group.%25')).status).toBe(400);
    expect((await audit('actor=not-a-uuid')).status).toBe(400);
    expect((await audit('targetId=a%20b')).status).toBe(400);
    expect((await audit('foo=1')).status).toBe(400);
  });

  it('actor: id + username · ระบบ (actor_id NULL) = null', async () => {
    await insert({ actorId: alice.id, action: 'group.create', createdAt: h.clock.now() - 2 });
    await insert({ actorId: null, action: 'script.adminResetPin', meta: { targetUserId: alice.id }, createdAt: h.clock.now() - 1 });
    const es = (await audit('limit=10')).data.entries;
    expect(es.find((e) => e.action === 'group.create')?.actor).toEqual({ id: alice.id, username: 'alice' });
    expect(es.find((e) => e.action === 'script.adminResetPin')?.actor).toBeNull();
  });
});

describe('meta whitelist ต่อ action (ตอนอ่าน)', () => {
  it('คีย์ที่ไม่รู้จักถูกตัด · ค่าซ้อน/อ็อบเจ็กต์ถูกตัด · action ไม่รู้จัก → {} · ไม่สะท้อนข้อความลับ', async () => {
    const t = h.clock.now() - 100;
    await insert({ action: 'member.remove', meta: { targetUserId: 'u1', targetRole: 'member', asSuperAdmin: true, note: 'CANARY_NOTE', displayName: 'CANARY_NAME' }, createdAt: t });
    await insert({ action: 'group.update', meta: { fields: ['name', 'minFreeMinutes'], asSuperAdmin: { nested: 'CANARY_NESTED' } }, createdAt: t + 1 });
    await insert({ action: 'totally.unknown', meta: { targetUserId: 'u2', anything: 'CANARY_UNKNOWN' }, createdAt: t + 2 });
    await insert({ action: 'pinReset.decide', meta: { decision: 'approved', targetUserId: 'u3', extra: 'CANARY_EXTRA' }, createdAt: t + 3 });
    await insert({ action: 'group.calendar.view', meta: 'not-an-object', createdAt: t + 4 });
    const r = await audit('limit=20');
    const by = (a: string) => r.data.entries.find((e) => e.action === a)!.meta;
    expect(by('member.remove')).toEqual({ targetUserId: 'u1', targetRole: 'member', asSuperAdmin: true });
    expect(by('group.update')).toEqual({ fields: ['name', 'minFreeMinutes'] });
    expect(by('totally.unknown')).toEqual({});
    expect(by('pinReset.decide')).toEqual({ decision: 'approved', targetUserId: 'u3' });
    expect(by('group.calendar.view')).toEqual({});
    expect(r.text).not.toMatch(/CANARY_/);
  });

  it('แถวจริงที่ระบบเขียน (suspend / unlock / group.view / user.delete) แสดง meta ที่คาดไว้', async () => {
    const bob = await person(h, 'bob');
    await post(boss.c, `/api/admin/users/${bob.id}/suspend`);
    await post(boss.c, `/api/admin/users/${bob.id}/unlock`);
    const gid = await makeGroup(alice, 'ก๊วน');
    await get(boss.c, `/api/admin/groups/${gid}`);
    expect((await post(alice.c, '/api/me/delete', { pin: '135792' })).status).toBe(409); // ยังเป็น admin
    const es = (await audit('limit=20')).data.entries;
    const pick = (a: string) => es.filter((e) => e.action === a).map((e) => ({ actor: e.actor?.username, t: e.targetType, id: e.targetId, meta: e.meta }));
    expect(pick('admin.user.suspend')).toEqual([{ actor: 'boss', t: 'user', id: bob.id, meta: { state: 'suspended', asSuperAdmin: true } }]);
    expect(pick('admin.user.unlock')).toEqual([{ actor: 'boss', t: 'user', id: bob.id, meta: { wasLocked: false, asSuperAdmin: true } }]);
    expect(pick('admin.group.view')).toEqual([{ actor: 'boss', t: 'group', id: gid, meta: { asSuperAdmin: true } }]);
    expect(pick('admin.audit.view')).toEqual([{ actor: 'boss', t: 'audit_log', id: 'audit_log', meta: { filtered: false, asSuperAdmin: true } }]);
  });
});

describe('admin.group.view — audit การเปิดรายละเอียด ไม่เกิน 1 แถว/(ผู้ใช้, กลุ่ม)/10 นาที (Security R5 L4) · ไม่ audit การเปิดรายการ', () => {
  it('เปิดซ้ำใน 10 นาที = 1 แถว · กลุ่มอื่นนับแยก · ผู้ใช้อื่นนับแยก · พ้น 10 นาที = แถวใหม่ · รายการ = 0 แถว · ไม่พบ = 404 ไม่มีแถว', async () => {
    const gid = await makeGroup(alice, 'ก๊วน');
    const gid2 = await makeGroup(alice, 'ก๊วนสอง');
    const boss2 = await person(h, 'boss2', { admin: true });
    const views = (actor: string, g: string) =>
      h.count("audit_log WHERE action = 'admin.group.view' AND actor_id = ? AND target_id = ? AND group_id = ?", [actor, g, g]);
    for (let i = 0; i < 5; i++) expect((await get(boss.c, `/api/admin/groups/${gid}`)).status).toBe(200);
    await get(boss.c, '/api/admin/groups');
    await get(boss.c, '/api/admin/users');
    expect(await views(boss.id, gid)).toBe(1);
    await get(boss.c, `/api/admin/groups/${gid2}`);
    await get(boss2.c, `/api/admin/groups/${gid}`);
    expect(await views(boss.id, gid2)).toBe(1);
    expect(await views(boss2.id, gid)).toBe(1);
    expect(await h.count("audit_log WHERE action IN ('admin.group.list','admin.user.list')")).toBe(0);
    // meta คงเดิม
    const [row] = await h.rows<{ meta: string }>("SELECT meta FROM audit_log WHERE action = 'admin.group.view' AND actor_id = ? AND target_id = ?", [boss.id, gid]);
    expect(JSON.parse(row!.meta)).toEqual({ asSuperAdmin: true });
    h.clock.advance(10 * MIN + 1);
    await get(boss.c, `/api/admin/groups/${gid}`);
    expect(await views(boss.id, gid)).toBe(2);
    expect((await get(boss.c, '/api/admin/groups/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect(await h.count("audit_log WHERE action = 'admin.group.view'")).toBe(4);
    expect((await call(boss.c, 'GET', '/api/admin/groups/not-uuid')).code).toBe('VALIDATION');
  });
});
