// R5-1 — PATCH /api/me เปลี่ยนชื่อที่แสดง (R5_CONTRACT §2 ข้อ 1)
// validation เท่าสมัคร · เพดาน 10/วัน · ชื่อใหม่ขึ้นในรายชื่อสมาชิก/RSVP/นัดทันที · ชื่อต้องห้ามถูกปฏิเสธ · ไม่ audit
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, DAY, call, get, join, makeGroup, mustCreate, person, put, setupHarness, type ApptDto, type Harness, type Person } from '../appointments/util';

let h: Harness;
let a: Person;
let b: Person;

const rename = (p: Person, displayName: unknown) => call<{ user: { displayName: string } }>(p.c, 'PATCH', '/api/me', { displayName });

beforeEach(async () => {
  h = await setupHarness();
  a = await person(h, 'alice');
  b = await person(h, 'bob');
});
afterEach(async () => {
  await h.cleanup();
});

describe('PATCH /api/me — validation', () => {
  it('สำเร็จ: NFC + trim + ยุบช่องว่าง เหมือนสมัคร · คืน user (ไม่มี hash) · Cache-Control no-store', async () => {
    const r = await rename(a, '  แมว   ส้ม  ');
    expect(r.status, r.text).toBe(200);
    expect(r.data.user.displayName).toBe('แมว ส้ม');
    expect(r.text).not.toMatch(/pin_?hash|pepper|argon/i);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const row = await h.rows<{ display_name: string }>('SELECT display_name FROM user WHERE id = ?', [a.id]);
    expect(row[0]!.display_name).toBe('แมว ส้ม');
  });

  it.each([
    ['ว่าง', '', 'TOO_SHORT'],
    ['ช่องว่างล้วน', '    ', 'TOO_SHORT'],
    ['ยาว 41 ตัว', 'ก'.repeat(41), 'TOO_LONG'],
    ['bidi override', 'abc‮def', 'INVALID'],
    ['zero-width space', 'แมว​ส้ม', 'INVALID'],
    ['ตัวควบคุม', 'a\u0007b', 'INVALID'],
    ['Hangul filler (มองไม่เห็น)', 'ㅤ', 'INVALID'],
  ])('%s → 400 VALIDATION displayName=%s', async (_l, name, reason) => {
    const r = await rename(a, name);
    expect(r.status).toBe(400);
    expect(r.code).toBe('VALIDATION');
    expect(r.json.error?.params).toEqual({ fields: { displayName: reason } });
  });

  it('ยาว 40 ตัวพอดีผ่าน · emoji ZWJ ผ่าน', async () => {
    expect((await rename(a, 'ก'.repeat(40))).status).toBe(200);
    expect((await rename(a, '🐈‍⬛ ดำ')).data.user.displayName).toBe('🐈‍⬛ ดำ');
  });

  it('คีย์แปลก (username/isAdmin) → VALIDATION UNKNOWN_FIELD · ไม่เปลี่ยนอะไร', async () => {
    const r = await call(a.c, 'PATCH', '/api/me', { displayName: 'x', isAdmin: true });
    expect(r.code).toBe('VALIDATION');
    expect(await h.count('user WHERE id = ? AND is_admin = 1', [a.id])).toBe(0);
  });

  it('anonymous → 401 · CSRF (Origin ผิด) → 403', async () => {
    expect((await rename({ ...a, c: new Client() }, 'x')).status).toBe(401);
    const r = await call(a.c, 'PATCH', '/api/me', { displayName: 'x' }, { headers: { origin: 'https://evil.test' } });
    expect(r.code).toBe('CSRF_REJECTED');
  });

  it('must_change_pin → 403 PIN_CHANGE_REQUIRED', async () => {
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [a.id]);
    expect((await rename(a, 'ใหม่')).code).toBe('PIN_CHANGE_REQUIRED');
  });

  it('ไม่ audit (เรื่องของตัวเอง)', async () => {
    await rename(a, 'ชื่อใหม่');
    expect(await h.count('audit_log WHERE actor_id = ?', [a.id])).toBe(0);
  });
});

describe('PATCH /api/me — เพดาน 10 ครั้ง/วัน/ผู้ใช้', () => {
  it('ครั้งที่ 11 → 429 RATE_LIMITED + Retry-After · ผู้ใช้อื่นไม่โดน · ชื่อเดิมซ้ำไม่กินโควตา · ข้ามวันได้ใหม่', async () => {
    for (let i = 1; i <= 10; i++) expect((await rename(a, `ชื่อ ${i}`)).status, `ครั้งที่ ${i}`).toBe(200);
    const over = await rename(a, 'ชื่อ 11');
    expect(over.status).toBe(429);
    expect(over.code).toBe('RATE_LIMITED');
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    // ชื่อเดิม (ไม่เปลี่ยน) ไม่ถูกจำกัด
    expect((await rename(a, 'ชื่อ 10')).status).toBe(200);
    // คนอื่นไม่เกี่ยว
    expect((await rename(b, 'บ๊อบ')).status).toBe(200);
    const row = await h.rows<{ display_name: string }>('SELECT display_name FROM user WHERE id = ?', [a.id]);
    expect(row[0]!.display_name).toBe('ชื่อ 10');
    h.clock.advance(DAY);
    expect((await rename(a, 'วันใหม่')).status).toBe(200);
  });

  it('validation ผิดไม่กินโควตา', async () => {
    for (let i = 0; i < 12; i++) await rename(a, '');
    expect((await rename(a, 'ได้')).status).toBe(200);
  });
});

describe('ชื่อใหม่เห็นทันทีทุกที่ (join จาก user.display_name)', () => {
  it('รายชื่อสมาชิก · ผู้สร้างนัด · รายชื่อ RSVP', async () => {
    const gid = await makeGroup(a, 'ก๊วน');
    await join(a, b, gid);
    const appt: ApptDto = await mustCreate(b, gid);
    expect((await put(b.c, `/api/appointments/${appt.id}/rsvp`, { response: 'going' })).status).toBe(200);

    expect((await rename(b, 'บ๊อบใหม่')).status).toBe(200);

    const g = await get<{ group: { members: { userId: string; displayName: string }[] } }>(a.c, `/api/groups/${gid}`);
    expect(g.data.group.members.find((m) => m.userId === b.id)?.displayName).toBe('บ๊อบใหม่');
    const d = await get<{ appointment: ApptDto }>(a.c, `/api/appointments/${appt.id}`);
    expect(d.data.appointment.createdBy?.displayName).toBe('บ๊อบใหม่');
    expect(d.data.appointment.rsvp.members?.going?.map((x) => (x as { displayName?: string }).displayName)).toEqual(['บ๊อบใหม่']);
    const list = await get<{ appointments: ApptDto[] }>(a.c, `/api/groups/${gid}/appointments`);
    expect(list.data.appointments[0]?.createdBy?.displayName).toBe('บ๊อบใหม่');
    const session = await get<{ user: { displayName: string } }>(b.c, '/api/auth/session');
    expect(session.data.user.displayName).toBe('บ๊อบใหม่');
  });
});
