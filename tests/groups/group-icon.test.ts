// R15 §1.2 (B1/B2) · PUT /api/groups/:gid/icon + icon ในทุก DTO ของกลุ่ม (Platform)
//  R15-3 เฉพาะ admin/moderator (+ SA ตามกติกาการแก้กลุ่ม) ตั้งได้ — เซิร์ฟเวอร์ตรวจ · member 403 · คนนอก/IDOR/กลุ่มลบ 404 · anon 401
//        รับเฉพาะคีย์ใน allowlist หรือ null · 'cat' เก็บเป็น NULL · ค่าเสียในฐาน → null ในทุก DTO · audit แบบเปลี่ยนชื่อ (group.update fields=['icon'])
//        แสดงครบ: รายการกลุ่ม · รายละเอียดกลุ่ม · ปฏิทิน · นัด (รายการ/หน้าหลัก/รายละเอียด)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GROUP_ICON_KEYS } from '@/lib/shared/group-icons';
import th from '../../messages/th.json';
import en from '../../messages/en.json';
import { handlerFor, ORIGIN } from '../auth/harness';
import { Client, call, del, get, join, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from './harness';

let h: Harness;
let a: Person; // admin
let m: Person; // moderator
let b: Person; // member
let o: Person; // คนนอก
let boss: Person; // super admin ไม่ใช่สมาชิก
let g: string;
let gOther: string; // กลุ่มของ o

beforeEach(async () => {
  h = await setupHarness();
  [a, m, b, o, boss] = [await person(h, 'alice'), await person(h, 'mod'), await person(h, 'bob'), await person(h, 'oscar'), await person(h, 'boss', { admin: true })];
  g = await makeGroup(a, 'ก๊วนแบด');
  for (const p of [m, b]) await join(a, p, g);
  expect((await patch(a.c, `/api/groups/${g}/members/${m.id}`, { role: 'moderator' })).status).toBe(200);
  gOther = await makeGroup(o, 'กลุ่มออสการ์');
});
afterEach(async () => {
  await h.cleanup();
});

const url = (gid: string) => `/api/groups/${gid}/icon`;
const put = (p: Person | Client, gid: string, body: unknown) => call<{ groupId: string; icon: string | null }>(p instanceof Client ? p : p.c, 'PUT' as 'POST', url(gid), body);
const stored = async (gid: string) => (await h.rows<{ icon: string | null }>('SELECT icon FROM groups WHERE id = ?', [gid]))[0]?.icon;
const fieldsOf = (r: { json: unknown }) => (r.json as { error: { params: { fields: Record<string, string> } } }).error.params.fields;
const audits = (gid: string) =>
  h.rows<{ action: string; actor_id: string; meta: string }>("SELECT action, actor_id, meta FROM audit_log WHERE group_id = ? AND action = 'group.update' ORDER BY rowid", [gid]);

describe('allowlist กลาง', () => {
  it('24 คีย์ตามลำดับของ ux (แมวเป็นตัวแรก/ค่าเริ่มต้น) · รูปแบบ ^[a-z]{2,12}$ · ไม่ซ้ำ', () => {
    expect([...GROUP_ICON_KEYS]).toEqual(
      'cat food hotpot dessert coffee drinks badminton soccer volleyball fitness bike game music karaoke movie travel camping work study home shopping heart party star'.split(' '),
    );
    expect(new Set(GROUP_ICON_KEYS).size).toBe(24);
    for (const k of GROUP_ICON_KEYS) expect(k).toMatch(/^[a-z]{2,12}$/);
  });

  it('ทุกคีย์มีชื่อ groupIcon.names.<key> ทั้ง th และ en (และไม่มีชื่อเกิน)', () => {
    for (const msgs of [th, en] as { groupIcon: { names: Record<string, string> } }[]) {
      expect(Object.keys(msgs.groupIcon.names)).toEqual([...GROUP_ICON_KEYS]);
      for (const k of GROUP_ICON_KEYS) expect(msgs.groupIcon.names[k]?.trim().length, k).toBeGreaterThan(0);
    }
  });
});

describe('PUT /api/groups/:gid/icon — สิทธิ์', () => {
  it('admin และ moderator ตั้งได้ · ค่าอยู่ในฐาน · audit group.update fields=[icon] ของผู้กระทำ', async () => {
    const r1 = await put(a, g, { icon: 'badminton' });
    expect([r1.status, r1.data]).toEqual([200, { groupId: g, icon: 'badminton' }]);
    expect(await stored(g)).toBe('badminton');
    const r2 = await put(m, g, { icon: 'soccer' });
    expect([r2.status, r2.data]).toEqual([200, { groupId: g, icon: 'soccer' }]);
    expect(await stored(g)).toBe('soccer');
    const rows = await audits(g);
    expect(rows.map((r) => [r.actor_id, JSON.parse(r.meta)])).toEqual([
      [a.id, { fields: ['icon'], asSuperAdmin: false }],
      [m.id, { fields: ['icon'], asSuperAdmin: false }],
    ]);
  });

  it('member → 403 FORBIDDEN ไม่เขียน ไม่ audit', async () => {
    const r = await put(b, g, { icon: 'coffee' });
    expect([r.status, r.code]).toEqual([403, 'FORBIDDEN']);
    expect(await stored(g)).toBeNull();
    expect(await audits(g)).toEqual([]);
  });

  it('คนนอก / IDOR (กลุ่มคนอื่น) / uuid ที่ไม่มี → 404 NOT_FOUND เหมือนกันทุกไบต์', async () => {
    const outsider = await put(o, g, { icon: 'coffee' });
    const idor = await put(a, gOther, { icon: 'coffee' });
    const none = await put(a, '00000000-0000-4000-8000-000000000000', { icon: 'coffee' });
    for (const r of [outsider, idor, none]) expect([r.status, r.json]).toEqual([404, outsider.json]);
    expect(outsider.code).toBe('NOT_FOUND');
    expect(await stored(g)).toBeNull();
    expect(await stored(gOther)).toBeNull();
  });

  it('กลุ่มที่ถูกลบ → 404 ทั้ง admin เดิมและ SA', async () => {
    expect((await del(a.c, `/api/groups/${g}`)).status).toBe(200);
    for (const p of [a, boss]) {
      const r = await put(p, g, { icon: 'coffee' });
      expect([r.status, r.code]).toEqual([404, 'NOT_FOUND']);
    }
    expect(await stored(g)).toBeNull();
  });

  it('super admin ไม่ใช่สมาชิก → ทำได้ตามกติกาการแก้กลุ่มเดิม (เหมือน PATCH ชื่อ) · audit asSuperAdmin', async () => {
    const rename = await patch(boss.c, `/api/groups/${g}`, { name: 'ชื่อใหม่' });
    const r = await put(boss, g, { icon: 'star' });
    expect([rename.status, r.status, r.data]).toEqual([200, 200, { groupId: g, icon: 'star' }]);
    expect(await stored(g)).toBe('star');
    const last = (await audits(g)).at(-1)!;
    expect([last.actor_id, JSON.parse(last.meta)]).toEqual([boss.id, { fields: ['icon'], asSuperAdmin: true }]);
  });

  it('anonymous → 401 · must_change_pin → 403 PIN_CHANGE_REQUIRED · ไม่มี CSRF → 403 CSRF_REJECTED', async () => {
    const anon = await put(new Client(), g, { icon: 'coffee' });
    expect([anon.status, anon.code]).toEqual([401, 'AUTH_REQUIRED']);
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [m.id]);
    const pin = await put(m, g, { icon: 'coffee' });
    expect([pin.status, pin.code]).toEqual([403, 'PIN_CHANGE_REQUIRED']);
    const handler = await handlerFor({ method: 'PUT', path: '/api/groups/:gid/icon' });
    const res = await handler(
      new Request(`${ORIGIN}${url(g)}`, { method: 'PUT', headers: { cookie: a.c.cookieHeader(), 'content-type': 'application/json' }, body: JSON.stringify({ icon: 'coffee' }) }),
      { params: Promise.resolve({ gid: g }) },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: { code: string } }).error?.code).toBe('CSRF_REJECTED');
    expect(await stored(g)).toBeNull();
  });
});

describe('PUT /api/groups/:gid/icon — ค่า', () => {
  it("'cat' เก็บเป็น NULL (= ยังไม่ตั้ง) · null ล้างค่า · ค่าเท่าเดิม → 200 ไม่ audit ซ้ำ", async () => {
    expect((await put(a, g, { icon: 'music' })).status).toBe(200);
    const cat = await put(a, g, { icon: 'cat' });
    expect([cat.status, cat.data]).toEqual([200, { groupId: g, icon: null }]);
    expect(await stored(g)).toBeNull();
    const again = await put(a, g, { icon: null });
    expect([again.status, again.data]).toEqual([200, { groupId: g, icon: null }]);
    expect((await put(a, g, { icon: 'music' })).status).toBe(200);
    expect((await put(a, g, { icon: 'music' })).status).toBe(200);
    expect((await audits(g)).length).toBe(3); // music · cat(→null) · music — ซ้ำไม่นับ
  });

  it('รับเฉพาะคีย์ใน allowlist: คีย์แปลก/URL/emoji/ตัวใหญ่/ตัวเลข → 400 VALIDATION {icon: INVALID*} · ไม่ส่ง → INVALID · คีย์เกิน → UNKNOWN_FIELD', async () => {
    for (const icon of ['dog', 'https://evil.example/x.png', '🏸', 'Cat', 'CAT', '', ' cat', 'cat ', 'data:image/png;base64,AA', 1, true, {}, ['cat']]) {
      const r = await put(a, g, { icon });
      expect([r.status, r.code], JSON.stringify(icon)).toEqual([400, 'VALIDATION']);
      expect(fieldsOf(r).icon, JSON.stringify(icon)).toMatch(/^INVALID/);
    }
    const missing = await put(a, g, {});
    // zod enum ตอบ invalid_value แม้ไม่ส่ง → route แปลงเป็น INVALID (ไม่ใช่ REQUIRED) — UI แสดงข้อความกลางเหมือนกัน
    expect(fieldsOf(missing)).toEqual({ icon: 'INVALID' });
    const extra = await put(a, g, { icon: 'cat', url: 'x' });
    expect(fieldsOf(extra)).toEqual({ url: 'UNKNOWN_FIELD' });
    expect(await stored(g)).toBeNull();
  });

  it('ทุกคีย์ใน allowlist ตั้งได้', async () => {
    for (const icon of GROUP_ICON_KEYS) {
      const r = await put(a, g, { icon });
      expect([r.status, r.data.icon], icon).toEqual([200, icon === 'cat' ? null : icon]);
    }
  });
});

describe('icon ในทุก DTO ของกลุ่ม', () => {
  type Appt = { groupId: string; groupName: string; groupIcon: string | null };
  async function views(viewer: Person) {
    const list = await get<{ groups: { id: string; icon: string | null }[] }>(viewer.c, '/api/groups');
    const detail = await get<{ group: { icon: string | null } }>(viewer.c, `/api/groups/${g}`);
    const cal = await get<{ group: { id: string; tz: string; icon: string | null } }>(viewer.c, `/api/groups/${g}/calendar?from=2026-10-01&to=2026-10-31`);
    const mine = await get<{ appointments: Appt[] }>(viewer.c, '/api/me/appointments');
    const groupAppts = await get<{ appointments: Appt[] }>(viewer.c, `/api/groups/${g}/appointments`);
    for (const r of [list, detail, cal, mine, groupAppts]) expect(r.status, JSON.stringify(r.json)).toBe(200);
    return {
      list: list.data.groups.find((x) => x.id === g)!.icon,
      detail: detail.data.group.icon,
      calendar: cal.data.group.icon,
      home: mine.data.appointments.map((x) => x.groupIcon),
      groupAppts: groupAppts.data.appointments.map((x) => x.groupIcon),
    };
  }

  it('ไม่ตั้ง = null ทุกจุด · ตั้งแล้วเพื่อนเห็นทุกจุด (T2) · รายละเอียดนัดก็มี groupIcon · กลุ่มใหม่ icon null', async () => {
    const created = await post<{ group: { icon: string | null } }>(a.c, '/api/groups', { name: 'ใหม่' });
    expect(created.data.group.icon).toBeNull();
    const ap = await post<{ appointment: Appt & { id: string } }>(a.c, `/api/groups/${g}/appointments`, {
      title: 'ตีแบด',
      startDate: '2026-10-24',
      startTime: '10:00',
      endDate: '2026-10-24',
      endTime: '11:00',
    });
    expect(ap.status, JSON.stringify(ap.json)).toBe(201);
    expect(ap.data.appointment.groupIcon).toBeNull();
    expect(await views(b)).toEqual({ list: null, detail: null, calendar: null, home: [null], groupAppts: [null] });

    expect((await put(a, g, { icon: 'badminton' })).status).toBe(200);
    expect(await views(b)).toEqual({ list: 'badminton', detail: 'badminton', calendar: 'badminton', home: ['badminton'], groupAppts: ['badminton'] });
    expect(await views(a)).toEqual({ list: 'badminton', detail: 'badminton', calendar: 'badminton', home: ['badminton'], groupAppts: ['badminton'] });
    const one = await get<{ appointment: Appt }>(b.c, `/api/appointments/${ap.data.appointment.id}`);
    expect([one.data.appointment.groupName, one.data.appointment.groupIcon]).toEqual(['ก๊วนแบด', 'badminton']);
  });

  it('ค่าในฐานที่ไม่อยู่ใน allowlist (ลบคีย์ภายหลัง/ข้อมูลเสีย) → null ทุกจุด ไม่ error · ตั้งใหม่ทับได้', async () => {
    expect(
      (await post(a.c, `/api/groups/${g}/appointments`, { title: 'x', startDate: '2026-10-24', startTime: '10:00', endDate: '2026-10-24', endTime: '11:00' })).status,
    ).toBe(201);
    for (const junk of ['dog', 'https://evil.example/x.png', '<script>', 'CAT']) {
      await h.rows('UPDATE groups SET icon = ? WHERE id = ?', [junk, g]);
      expect(await views(b), junk).toEqual({ list: null, detail: null, calendar: null, home: [null], groupAppts: [null] });
    }
    const r = await put(a, g, { icon: null }); // ค่าเสีย ≠ null → เขียนทับให้สะอาด
    expect(r.status).toBe(200);
    expect(await stored(g)).toBeNull();
  });
});
