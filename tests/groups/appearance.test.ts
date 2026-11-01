// R6C F3ก · PATCH /api/groups/:gid/members/me/appearance + ค่าที่ใช้แสดงในทุก serializer (Platform — R6C_CONTRACT §2, §4)
//  R6C-1 ไม่ตั้ง = hash เดิมทุกที่ (สี = รูปทรง = memberColorIndex)
//  R6C-2 ตั้งสี/รูปทรงแยกกัน · ซ้ำกับคนอื่นได้ · null กลับค่าเดิม · กลุ่ม A ไม่กระทบกลุ่ม B · เห็นผลทุก serializer
//  R6C-3 ค่าผิด → 400 · ไม่ใช่สมาชิก 404 · SA นอกกลุ่ม 403 · กลุ่มลบ 404 · anon 401 · must_change_pin 403 · suspended 401 · ไม่มี CSRF 403 · rate limit 429 · ไม่ลง audit
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memberColorIndex } from '@/lib/shared/member-color';
import { MEMBER_APPEARANCE_RATE_LIMIT } from '@/lib/shared/limits';
import { handlerFor, ORIGIN } from '../auth/harness';
import { Client, call, del, get, join, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from './harness';

type Look = { colorIndex: number; shapeIndex: number };
type Mine = Look & { color: number | null; shape: number | null };
type Member = Look & { userId: string; displayName: string };
type GroupRes = { group: { members: (Member & { role: string })[]; myAppearance: Mine | null } };
type Person6 = Look & { userId: string };
type ApptRes = {
  appointment: {
    id: string;
    createdBy: Person6 | null;
    rsvp: { members: Record<'going' | 'maybe' | 'not_going', Person6[]> };
    myAppearance: Look | null;
  };
};

let h: Harness;
let a: Person; // admin กลุ่ม A และ B
let b: Person; // member กลุ่ม A และ B
let c: Person; // member กลุ่ม A
let o: Person; // คนนอก
let boss: Person; // super admin ที่ไม่ใช่สมาชิก
let gA: string;
let gB: string;

beforeEach(async () => {
  h = await setupHarness();
  [a, b, c, o, boss] = [await person(h, 'alice'), await person(h, 'bob'), await person(h, 'cara'), await person(h, 'oscar'), await person(h, 'boss', { admin: true })];
  gA = await makeGroup(a, 'กลุ่มเอ');
  gB = await makeGroup(a, 'กลุ่มบี');
  for (const p of [b, c]) await join(a, p, gA);
  await join(a, b, gB);
});
afterEach(async () => {
  await h.cleanup();
});

const url = (gid: string) => `/api/groups/${gid}/members/me/appearance`;
const setLook = (p: Person, gid: string, body: unknown) => patch<Mine>(p.c, url(gid), body);
const hashLook = (gid: string, uid: string): Look => ({ colorIndex: memberColorIndex(gid, uid), shapeIndex: memberColorIndex(gid, uid) });
/** slot (1–10) ที่ให้ index ต่างจาก hash แน่นอน */
const otherSlot = (gid: string, uid: string, shift = 3) => ((memberColorIndex(gid, uid) + shift) % 10) + 1;
const pick = (x: Look) => ({ colorIndex: x.colorIndex, shapeIndex: x.shapeIndex });

async function groupMembers(p: Person, gid: string) {
  const r = await get<GroupRes>(p.c, `/api/groups/${gid}`);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.data.group;
}
async function calendarMembers(p: Person, gid: string): Promise<Member[]> {
  const r = await get<{ members: Member[] }>(p.c, `/api/groups/${gid}/calendar?from=2026-10-01&to=2026-10-31`);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.data.members;
}
async function availabilityMembers(p: Person, gid: string): Promise<Member[]> {
  const r = await get<{ members: Member[] }>(p.c, `/api/groups/${gid}/availability?from=2026-10-20&to=2026-10-21`);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.data.members;
}
const SLOT = { startDate: '2026-10-24', startTime: '10:00', endDate: '2026-10-24', endTime: '11:00' } as const;

/** b มี busy ทับนัด → overlap.blocked มี b · b ตอบ going · คืน DTO ทั้งหมดที่มีสมาชิก */
async function appointmentViews(gid: string) {
  expect((await post(b.c, '/api/me/busy', { kind: 'timed', ...SLOT })).status).toBe(201);
  const created = await post<ApptRes & { overlap: { blocked: Person6[] } }>(a.c, `/api/groups/${gid}/appointments`, { title: 'กินข้าว', ...SLOT });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const id = created.data.appointment.id;
  const rsvp = await call<ApptRes>(b.c, 'PUT' as 'POST', `/api/appointments/${id}/rsvp`, { response: 'going' });
  expect(rsvp.status, JSON.stringify(rsvp.json)).toBe(200);
  const detailA = await get<ApptRes>(a.c, `/api/appointments/${id}`);
  const detailB = await get<ApptRes>(b.c, `/api/appointments/${id}`);
  const list = await get<{ appointments: ApptRes['appointment'][] }>(b.c, `/api/groups/${gid}/appointments`);
  expect([detailA.status, detailB.status, list.status]).toEqual([200, 200, 200]);
  return {
    blockedB: created.data.overlap.blocked.find((x) => x.userId === b.id)!,
    creatorInDetail: detailB.data.appointment.createdBy!,
    creatorInList: list.data.appointments.find((x) => x.id === id)!.createdBy!,
    rsvpB: detailA.data.appointment.rsvp.members.going.find((x) => x.userId === b.id)!,
    myAppearanceB: detailB.data.appointment.myAppearance,
    myAppearanceA: detailA.data.appointment.myAppearance,
  };
}

describe('R6C-1 ไม่ได้ตั้ง → หน้าตาเดิม (hash) ทุก serializer', () => {
  it('group detail / calendar / availability / นัด (ผู้สร้าง, RSVP, เตือนนัดทับ, myAppearance) = memberColorIndex ทั้งสีและรูปทรง', async () => {
    const g = await groupMembers(b, gA);
    for (const m of g.members) expect(pick(m), m.userId).toEqual(hashLook(gA, m.userId));
    expect(g.myAppearance).toEqual({ ...hashLook(gA, b.id), color: null, shape: null });
    for (const m of await calendarMembers(b, gA)) expect(pick(m)).toEqual(hashLook(gA, m.userId));
    for (const m of await availabilityMembers(b, gA)) expect(pick(m)).toEqual(hashLook(gA, m.userId));
    const v = await appointmentViews(gA);
    expect(pick(v.blockedB)).toEqual(hashLook(gA, b.id));
    expect(pick(v.rsvpB)).toEqual(hashLook(gA, b.id));
    expect(pick(v.creatorInDetail)).toEqual(hashLook(gA, a.id));
    expect(pick(v.creatorInList)).toEqual(hashLook(gA, a.id));
    expect(v.myAppearanceB).toEqual(hashLook(gA, b.id));
    expect(v.myAppearanceA).toEqual(hashLook(gA, a.id));
  });

  it('แถวเดิมหลัง migration มี color_slot/shape_slot เป็น NULL (ไม่ backfill)', async () => {
    const rows = await h.rows<{ color_slot: number | null; shape_slot: number | null }>('SELECT color_slot, shape_slot FROM group_member');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect([r.color_slot, r.shape_slot]).toEqual([null, null]);
  });
});

describe('R6C-2 ตั้งสี/รูปทรงของตัวเอง', () => {
  it('ตั้งสีอย่างเดียว · รูปทรงอย่างเดียว · ทั้งคู่ · null กลับค่าเดิม — response = ค่าที่ใช้แสดง + slot ที่เลือก', async () => {
    const H = memberColorIndex(gA, b.id);
    const cs = otherSlot(gA, b.id, 3);
    const ss = otherSlot(gA, b.id, 6);

    let r = await setLook(b, gA, { color: cs, shape: null });
    expect([r.status, r.data]).toEqual([200, { colorIndex: cs - 1, shapeIndex: H, color: cs, shape: null }]);

    r = await setLook(b, gA, { color: null, shape: ss });
    expect(r.data).toEqual({ colorIndex: H, shapeIndex: ss - 1, color: null, shape: ss });

    r = await setLook(b, gA, { color: cs, shape: ss });
    expect(r.data).toEqual({ colorIndex: cs - 1, shapeIndex: ss - 1, color: cs, shape: ss });
    expect((await groupMembers(b, gA)).myAppearance).toEqual(r.data);

    r = await setLook(b, gA, { color: null, shape: null }); // "ใช้แบบอัตโนมัติ"
    expect(r.data).toEqual({ ...hashLook(gA, b.id), color: null, shape: null });
    const row = await h.rows<{ color_slot: number | null; shape_slot: number | null }>('SELECT color_slot, shape_slot FROM group_member WHERE group_id = ? AND user_id = ?', [gA, b.id]);
    expect(row).toEqual([{ color_slot: null, shape_slot: null }]);
  });

  it('ขอบ 1 และ 10 → index 0 และ 9', async () => {
    expect((await setLook(b, gA, { color: 1, shape: 10 })).data).toEqual({ colorIndex: 0, shapeIndex: 9, color: 1, shape: 10 });
    expect((await setLook(b, gA, { color: 10, shape: 1 })).data).toEqual({ colorIndex: 9, shapeIndex: 0, color: 10, shape: 1 });
  });

  it('ซ้ำกับคนอื่นได้ (สองคนเลือกสี+รูปทรงเดียวกัน)', async () => {
    expect((await setLook(b, gA, { color: 4, shape: 7 })).status).toBe(200);
    expect((await setLook(c, gA, { color: 4, shape: 7 })).status).toBe(200);
    const g = await groupMembers(a, gA);
    for (const id of [b.id, c.id]) expect(pick(g.members.find((m) => m.userId === id)!)).toEqual({ colorIndex: 3, shapeIndex: 6 });
  });

  it('ตั้งในกลุ่ม A ไม่กระทบกลุ่ม B · ไม่กระทบสมาชิกคนอื่น', async () => {
    const cs = otherSlot(gA, b.id);
    expect((await setLook(b, gA, { color: cs, shape: cs })).status).toBe(200);
    const inB = (await groupMembers(b, gB)).members.find((m) => m.userId === b.id)!;
    expect(pick(inB)).toEqual(hashLook(gB, b.id));
    expect((await groupMembers(b, gB)).myAppearance).toEqual({ ...hashLook(gB, b.id), color: null, shape: null });
    const inA = await groupMembers(a, gA);
    for (const m of inA.members.filter((x) => x.userId !== b.id)) expect(pick(m)).toEqual(hashLook(gA, m.userId));
    expect(inA.myAppearance).toEqual({ ...hashLook(gA, a.id), color: null, shape: null }); // ผู้ดูคนอื่นเห็น myAppearance ของตัวเอง ไม่ใช่ของ b
  });

  it('เห็นผลทุก serializer: group / calendar / availability / นัด (ผู้สร้าง, RSVP, เตือนนัดทับ, myAppearance)', async () => {
    const want = { colorIndex: 1, shapeIndex: 8 };
    expect((await setLook(b, gA, { color: 2, shape: 9 })).status).toBe(200);
    expect((await setLook(a, gA, { color: 5, shape: null })).status).toBe(200);
    const wantA = { colorIndex: 4, shapeIndex: memberColorIndex(gA, a.id) };

    expect(pick((await groupMembers(c, gA)).members.find((m) => m.userId === b.id)!)).toEqual(want);
    expect(pick((await calendarMembers(c, gA)).find((m) => m.userId === b.id)!)).toEqual(want);
    expect(pick((await availabilityMembers(c, gA)).find((m) => m.userId === b.id)!)).toEqual(want);
    const v = await appointmentViews(gA);
    expect(pick(v.blockedB)).toEqual(want);
    expect(pick(v.rsvpB)).toEqual(want);
    expect(v.myAppearanceB).toEqual(want);
    expect(pick(v.creatorInDetail)).toEqual(wantA);
    expect(pick(v.creatorInList)).toEqual(wantA);
    expect(v.myAppearanceA).toEqual(wantA);
  });

  it('ออกจากกลุ่มแล้วกลับเข้าใหม่ → แถวใหม่ (slot = NULL) · ค่าเดิมไม่ค้าง', async () => {
    expect((await setLook(c, gA, { color: 3, shape: 3 })).status).toBe(200);
    expect((await post(c.c, `/api/groups/${gA}/leave`)).status).toBe(200);
    await join(a, c, gA);
    expect((await groupMembers(c, gA)).myAppearance).toEqual({ ...hashLook(gA, c.id), color: null, shape: null });
  });

  it('ไม่ลง audit log', async () => {
    const before = await h.count('audit_log');
    expect((await setLook(b, gA, { color: 2, shape: 2 })).status).toBe(200);
    expect(await h.count('audit_log')).toBe(before);
  });
});

describe('R6C-3 สิทธิ์และค่า (ตรวจที่เซิร์ฟเวอร์)', () => {
  const slotOf = async (gid: string, uid: string) =>
    (await h.rows<{ color_slot: number | null; shape_slot: number | null }>('SELECT color_slot, shape_slot FROM group_member WHERE group_id = ? AND user_id = ?', [gid, uid]))[0];

  it.each([
    ['color 0', { color: 0, shape: null }, 'color', 'TOO_SMALL'],
    ['color 11', { color: 11, shape: null }, 'color', 'TOO_LARGE'],
    ['shape 0', { color: null, shape: 0 }, 'shape', 'TOO_SMALL'],
    ['shape 11', { color: 1, shape: 11 }, 'shape', 'TOO_LARGE'],
    ['color 1.5', { color: 1.5, shape: null }, 'color', undefined],
    ['color "3"', { color: '3', shape: null }, 'color', 'INVALID_TYPE'],
    ['shape true', { color: null, shape: true }, 'shape', 'INVALID_TYPE'],
    ['color -1', { color: -1, shape: 1 }, 'color', 'TOO_SMALL'],
    ['ขาด shape', { color: 1 }, 'shape', 'REQUIRED'],
    ['ขาด color', { shape: 1 }, 'color', 'REQUIRED'],
    ['body ว่าง', {}, 'color', 'REQUIRED'],
    ['คีย์เกิน (userId — ตั้งให้คนอื่นไม่ได้)', { color: 1, shape: 1, userId: 'x' }, 'userId', 'UNKNOWN_FIELD'],
  ])('%s → 400 VALIDATION · ไม่เขียน', async (_name, body, field, reason) => {
    const r = await setLook(b, gA, body);
    expect([r.status, r.code]).toEqual([400, 'VALIDATION']);
    const fields = (r.json.error?.params as { fields: Record<string, string> }).fields;
    expect(fields).toHaveProperty(field);
    if (reason) expect(fields[field]).toBe(reason);
    expect(await slotOf(gA, b.id)).toEqual({ color_slot: null, shape_slot: null });
  });

  it('body ไม่ใช่ JSON object (array / null / ข้อความ) → 400', async () => {
    for (const body of [[1, 2], null, 'red']) expect((await setLook(b, gA, body)).status, JSON.stringify(body)).toBe(400);
  });

  it('gid ไม่ใช่ uuid → 400 · ไม่ใช่สมาชิก → 404 · กลุ่มไม่มีจริง → 404', async () => {
    expect((await setLook(b, 'not-a-uuid', { color: 1, shape: 1 })).status).toBe(400);
    const out = await setLook(o, gA, { color: 1, shape: 1 });
    expect([out.status, out.code]).toEqual([404, 'NOT_FOUND']);
    const ghost = await setLook(b, '00000000-0000-4000-8000-000000000000', { color: 1, shape: 1 });
    expect([ghost.status, ghost.code]).toEqual([404, 'NOT_FOUND']);
    // คนนอกในกลุ่ม B: c ไม่ใช่สมาชิก B
    expect((await setLook(c, gB, { color: 1, shape: 1 })).status).toBe(404);
  });

  it('super admin ที่ไม่ใช่สมาชิก → 403 FORBIDDEN · ไม่มีแถวถูกสร้าง', async () => {
    const r = await setLook(boss, gA, { color: 1, shape: 1 });
    expect([r.status, r.code]).toEqual([403, 'FORBIDDEN']);
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [gA, boss.id])).toBe(0);
  });

  it('super admin ที่เป็นสมาชิก → ตั้งของตัวเองได้', async () => {
    await join(a, boss, gA);
    expect((await setLook(boss, gA, { color: 6, shape: 2 })).data).toMatchObject({ colorIndex: 5, shapeIndex: 1 });
  });

  it('ทุก role ในกลุ่ม (admin / moderator / member) ตั้งได้', async () => {
    expect((await patch(a.c, `/api/groups/${gA}/members/${c.id}`, { role: 'moderator' })).status).toBe(200);
    for (const p of [a, b, c]) expect((await setLook(p, gA, { color: 2, shape: 3 })).status, p.username).toBe(200);
  });

  it('กลุ่มถูกลบ → 404', async () => {
    expect((await del(a.c, `/api/groups/${gA}`)).status).toBe(200);
    const r = await setLook(b, gA, { color: 1, shape: 1 });
    expect([r.status, r.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('anonymous → 401 · suspended → 401 · must_change_pin → 403 PIN_CHANGE_REQUIRED · ไม่เขียน', async () => {
    const anon = await call(new Client(), 'PATCH', url(gA), { color: 1, shape: 1 });
    expect([anon.status, anon.code]).toEqual([401, 'AUTH_REQUIRED']);
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [c.id]);
    const pin = await setLook(c, gA, { color: 1, shape: 1 });
    expect([pin.status, pin.code]).toEqual([403, 'PIN_CHANGE_REQUIRED']);
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [b.id]);
    const sus = await setLook(b, gA, { color: 1, shape: 1 });
    expect(sus.status).toBe(401);
    for (const id of [b.id, c.id]) expect(await slotOf(gA, id)).toEqual({ color_slot: null, shape_slot: null });
  });

  it('ไม่มี CSRF (Origin ผิด / ไม่มี Origin / ไม่ใช่ JSON) → 403 CSRF_REJECTED · ไม่เขียน', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { origin: 'http://maewmeet.test' }]) {
      const r = await call(b.c, 'PATCH', url(gA), { color: 1, shape: 1 }, { headers });
      expect([r.status, r.code], JSON.stringify(headers)).toEqual([403, 'CSRF_REJECTED']);
    }
    // Client ของ harness บังคับ JSON content-type เสมอ → ยิง Request ดิบ: ไม่มี Origin / ไม่ใช่ JSON (คุกกี้ถูกต้อง)
    const handler = await handlerFor({ method: 'PATCH', path: '/api/groups/:gid/members/me/appearance' });
    const raw = (headers: Record<string, string>) =>
      handler(new Request(`${ORIGIN}${url(gA)}`, { method: 'PATCH', headers: { cookie: b.c.cookieHeader(), ...headers }, body: JSON.stringify({ color: 1, shape: 1 }) }), {
        params: Promise.resolve({ gid: gA }),
      });
    for (const headers of [{ 'content-type': 'application/json' }, { origin: ORIGIN, 'content-type': 'text/plain' }, { origin: ORIGIN }] as Record<string, string>[]) {
      const res = await raw(headers);
      expect([res.status, ((await res.json()) as { error?: { code: string } }).error?.code], JSON.stringify(headers)).toEqual([403, 'CSRF_REJECTED']);
    }
    const ok = await raw({ origin: ORIGIN, 'content-type': 'application/json' }); // ตัวควบคุม: Request ดิบที่ถูกต้องผ่าน
    expect(ok.status).toBe(200);
    await setLook(b, gA, { color: null, shape: null });
    expect(await slotOf(gA, b.id)).toEqual({ color_slot: null, shape_slot: null });
  });

  it(`rate limit ${MEMBER_APPEARANCE_RATE_LIMIT.limit} ครั้ง/หน้าต่าง/ผู้ใช้ → 429 RATE_LIMITED + Retry-After · คนอื่นไม่โดน · หน้าต่างใหม่ใช้ได้`, async () => {
    for (let i = 0; i < MEMBER_APPEARANCE_RATE_LIMIT.limit; i++) expect((await setLook(b, gA, { color: (i % 10) + 1, shape: null })).status).toBe(200);
    const r = await setLook(b, gB, { color: 1, shape: 1 }); // ทุกกลุ่มรวมกัน
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await setLook(c, gA, { color: 1, shape: 1 })).status).toBe(200);
    h.clock.advance(MEMBER_APPEARANCE_RATE_LIMIT.windowMs);
    expect((await setLook(b, gB, { color: 1, shape: 1 })).status).toBe(200);
  });

  it('ไม่มี route ตั้งให้คนอื่น: /members/:uid/appearance ไม่อยู่ใน manifest', async () => {
    const { ROUTE_MANIFEST } = await import('@/app/api/_lib/manifest');
    const paths = ROUTE_MANIFEST.filter((e) => e.path.endsWith('/appearance')).map((e) => `${e.method} ${e.path}`);
    expect(paths).toEqual(['PATCH /api/groups/:gid/members/me/appearance']);
    expect(ROUTE_MANIFEST.find((e) => e.path.endsWith('/appearance'))!.action).toBe('member.setOwnAppearance');
  });

  it('response มีเฉพาะ 4 ฟิลด์ ไม่มี userId/username/hash', async () => {
    const r = await setLook(b, gA, { color: 1, shape: 2 });
    expect(Object.keys(r.data).sort()).toEqual(['color', 'colorIndex', 'shape', 'shapeIndex']);
    expect(r.text).not.toMatch(/pin|hash|username|token/i);
  });
});
