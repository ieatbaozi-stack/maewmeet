// R2-2 · U4: สร้างกลุ่ม → ผู้สร้างเป็น admin (1 คน/กลุ่ม — ปฏิเสธระดับ DB ด้วย) · ชื่อผิดกติกา → VALIDATION · เกินลิมิต → LIMIT_REACHED
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GROUP_LIMITS } from '@/lib/shared/limits';
import { adminCount, get, makeGroup, person, post, setupHarness, type GroupDto, type Harness, type Person } from './harness';

let h: Harness;
let alice: Person;
beforeEach(async () => {
  h = await setupHarness();
  alice = await person(h, 'alice');
});
afterEach(async () => {
  await h.cleanup();
});

describe('POST /api/groups (U4)', () => {
  it('สร้างได้ → 201, ผู้สร้างเป็น admin คนเดียวของกลุ่ม, audit group.create', async () => {
    const r = await post<{ group: GroupDto }>(alice.c, '/api/groups', { name: '  ก๊วนแมว  ' });
    expect(r.status).toBe(201);
    expect(r.data.group).toMatchObject({ name: 'ก๊วนแมว', role: 'admin', memberCount: 1 }); // trim แล้ว
    const gid = r.data.group.id;
    expect(await h.rows('SELECT user_id, role FROM group_member WHERE group_id = ?', [gid])).toEqual([{ user_id: alice.id, role: 'admin' }]);
    expect(await h.count("audit_log WHERE action = 'group.create' AND group_id = ? AND actor_id = ?", [gid, alice.id])).toBe(1);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });

  it('ไม่ได้ล็อกอิน → 401 AUTH_REQUIRED, ไม่สร้างอะไร', async () => {
    const { Client } = await import('./harness');
    const r = await post(new Client(), '/api/groups', { name: 'x' });
    expect(r.status).toBe(401);
    expect(r.code).toBe('AUTH_REQUIRED');
    expect(await h.count('groups')).toBe(0);
  });

  it.each([
    ['ว่าง', '', 'TOO_SHORT'],
    ['ช่องว่างล้วน', '   　 ', 'TOO_SHORT'],
    ['41 ตัว', 'ก'.repeat(41), 'TOO_LONG'],
    ['มีขึ้นบรรทัดใหม่', 'a\nb', 'INVALID'],
    ['มี tab', 'a\tb', 'INVALID'],
    ['มี NUL', 'a\u0000b', 'INVALID'],
    ['bidi override (RLO)', 'abc‮def', 'INVALID'],
    ['bidi isolate', '⁦abc⁩', 'INVALID'],
    ['LRM', 'abc‎def', 'INVALID'],
    ['zero-width space', 'ab​cd', 'INVALID'],
    ['zero-width joiner', 'ab‍cd', 'INVALID'],
    ['word joiner', 'ab⁠cd', 'INVALID'],
    ['BOM กลางชื่อ', 'ab﻿cd', 'INVALID'],
    ['line separator', 'ab cd', 'INVALID'],
    ['Hangul filler', 'abㅤcd', 'INVALID'],
  ])('ชื่อ %s → 400 VALIDATION (%s)', async (_label, name, reason) => {
    const r = await post(alice.c, '/api/groups', { name });
    expect(r.status).toBe(400);
    expect(r.code).toBe('VALIDATION');
    expect(r.json.error?.params).toEqual({ fields: { name: reason } });
    expect(await h.count('groups')).toBe(0);
  });

  it('ขอบเขต: 40 ตัวอักษรพอดีผ่าน (นับ code point · ไทย/อีโมจิ) · ชื่อซ้ำกันได้', async () => {
    expect((await post(alice.c, '/api/groups', { name: 'ก'.repeat(40) })).status).toBe(201);
    expect((await post(alice.c, '/api/groups', { name: '🐱'.repeat(40) })).status).toBe(201);
    expect((await post(alice.c, '/api/groups', { name: '🐱'.repeat(41) })).code).toBe('VALIDATION');
    expect((await post(alice.c, '/api/groups', { name: 'ซ้ำ' })).status).toBe(201);
    expect((await post(alice.c, '/api/groups', { name: 'ซ้ำ' })).status).toBe(201);
  });

  it('รูปแบบ body ผิด/ฟิลด์แปลก → VALIDATION (ไม่สร้าง)', async () => {
    expect((await post(alice.c, '/api/groups', {})).code).toBe('VALIDATION');
    expect((await post(alice.c, '/api/groups', { name: 5 })).code).toBe('VALIDATION');
    expect((await post(alice.c, '/api/groups', { name: 'x', role: 'admin', createdBy: 'someone' })).code).toBe('VALIDATION');
    expect(await h.count('groups')).toBe(0);
  });

  it('เพดาน: สร้างได้ 10 กลุ่ม ครั้งที่ 11 → 409 LIMIT_REACHED {limit: groups, max: 10} · ลบกลุ่มแล้วสร้างได้อีก · เพดานต่อผู้ใช้', async () => {
    const ids: string[] = [];
    for (let i = 0; i < GROUP_LIMITS.groupsCreatedPerUser; i++) ids.push(await makeGroup(alice, `g${i}`));
    const over = await post(alice.c, '/api/groups', { name: 'เกิน' });
    expect(over.status).toBe(409);
    expect(over.code).toBe('LIMIT_REACHED');
    expect(over.json.error?.params).toEqual({ limit: 'groups', max: 10 });
    expect(await h.count('groups WHERE created_by = ?', [alice.id])).toBe(10);
    // ถูกปฏิเสธแล้วไม่เหลือแถวครึ่งทาง (กลุ่มไม่มี admin)
    expect(await h.count('groups g WHERE NOT EXISTS (SELECT 1 FROM group_member m WHERE m.group_id = g.id AND m.role = ?)', ['admin'])).toBe(0);
    // คนอื่นไม่ได้รับผลกระทบ
    const bob = await person(h, 'bob');
    expect((await post(bob.c, '/api/groups', { name: 'ของบ๊อบ' })).status).toBe(201);
    // ลบหนึ่งกลุ่ม → สร้างได้อีกหนึ่ง
    const { del } = await import('./harness');
    expect((await del(alice.c, `/api/groups/${ids[0]}`)).status).toBe(200);
    expect((await post(alice.c, '/api/groups', { name: 'ใหม่' })).status).toBe(201);
    expect((await post(alice.c, '/api/groups', { name: 'เกินอีก' })).code).toBe('LIMIT_REACHED');
  });

  it('เพดานชนะการแข่ง: สร้างพร้อมกัน 15 ครั้ง → สำเร็จ ≤ 10 เสมอ (คำสั่งเดียวมีเงื่อนไข)', async () => {
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => post(alice.c, '/api/groups', { name: `race${i}` })));
    const okN = results.filter((r) => r.status === 201).length;
    expect(okN).toBe(10);
    for (const r of results.filter((x) => x.status !== 201)) expect(['LIMIT_REACHED', 'CONFLICT']).toContain(r.code);
    expect(await h.count('groups WHERE created_by = ?', [alice.id])).toBe(10);
    expect(await h.count("group_member WHERE role = 'admin' AND user_id = ?", [alice.id])).toBe(10);
  });

  it('GET /api/groups → กลุ่มของฉัน + role + จำนวนสมาชิก · ไม่เห็นกลุ่มของคนอื่น', async () => {
    const bob = await person(h, 'bob');
    const g1 = await makeGroup(alice, 'B กลุ่ม');
    await makeGroup(alice, 'a กลุ่ม');
    await makeGroup(bob, 'ของบ๊อบ');
    const r = await get<{ groups: GroupDto[] }>(alice.c, '/api/groups');
    expect(r.status).toBe(200);
    expect(r.data.groups.map((g) => g.name)).toEqual(['a กลุ่ม', 'B กลุ่ม']); // ไม่สนตัวพิมพ์
    expect(r.data.groups.find((g) => g.id === g1)).toMatchObject({ role: 'admin', memberCount: 1 });
    expect(JSON.stringify(r.json)).not.toContain('ของบ๊อบ');
  });
});

describe('ระดับ DB (ด่านสุดท้าย — ข้าม service)', () => {
  it('admin คนที่สองในกลุ่มเดียวกัน → ถูกปฏิเสธโดย unique index group_one_admin_uq', async () => {
    const bob = await person(h, 'bob');
    const gid = await makeGroup(alice);
    await expect(
      h.rows("INSERT INTO group_member (group_id, user_id, role, joined_at) VALUES (?, ?, 'admin', 1)", [gid, bob.id]),
    ).rejects.toThrow(/UNIQUE|constraint/i);
    expect(await adminCount(h, gid)).toBe(1);
  });

  it('สมาชิกซ้ำ (PK group_id+user_id) · role นอกชุด (CHECK) ถูกปฏิเสธ', async () => {
    const bob = await person(h, 'bob');
    const gid = await makeGroup(alice);
    await expect(h.rows("INSERT INTO group_member VALUES (?, ?, 'member', 1)", [gid, alice.id])).rejects.toThrow(/UNIQUE|constraint/i);
    await expect(h.rows("INSERT INTO group_member VALUES (?, ?, 'owner', 1)", [gid, bob.id])).rejects.toThrow(/CHECK|constraint/i);
  });

  it('หน้าต่างวันว่างผิดกติกา (CHECK) ถูกปฏิเสธระดับ DB', async () => {
    const gid = await makeGroup(alice);
    await expect(h.rows('UPDATE groups SET free_window_start_min = 1000, free_window_end_min = 900 WHERE id = ?', [gid])).rejects.toThrow(/CHECK|constraint/i);
    await expect(h.rows('UPDATE groups SET min_free_minutes = 45 WHERE id = ?', [gid])).rejects.toThrow(/CHECK|constraint/i);
  });
});
