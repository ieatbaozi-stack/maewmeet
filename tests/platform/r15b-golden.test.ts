// R15b §3 · R15-6 — เทสต์เทียบผลก่อน-หลัง (golden): JSON ที่ออกจาก RSVP PUT · GET รายละเอียดนัด · ข้อมูลหน้า /groups/[gid] ต้องเท่าเดิมทุกไบต์
//
// วิธี: บันทึกผลจากโค้ดเดิม (ก่อนลด query) ไว้ที่ tests/platform/fixtures/r15b-golden.json แล้วทุกครั้งที่รันเทียบผลปัจจุบันกับไฟล์นั้นทีละตัวอักษร
//  - body ของ API = ข้อความดิบจาก Response (ลำดับคีย์/ช่องว่าง/escape ต้องตรง) · ข้อมูลหน้า = JSON.stringify ของค่าที่ loader คืน
//  - newId เป็นลำดับคงที่ในเทสต์นี้ (สี/รูปทรงเริ่มต้นคำนวณจาก id · ลำดับที่เรียงตาม id จึงคงที่ทุกรอบ) แล้วแทนด้วยชื่อ
//    (<user:bob> · <appt:X> · <group:main>) ให้อ่านง่าย · id อื่น (notification) → <uuid>
//  - นาฬิกา inject + เลื่อน 1 นาทีหลังทุกการเขียน
//  - กรณีที่ครอบ: ตอบครั้งแรก/ซ้ำ/เปลี่ยน · ผู้สร้างตอบเอง · ผู้สร้างออกจากกลุ่ม · ผู้สร้างถูกระงับ · ออกแล้วกลับเข้า (คำตอบเก่าไม่นับ) ·
//    สีประจำตัว · myConflicts · super admin นอกกลุ่ม (403 RSVP · ดูได้) · คนนอก (404) · กระดิ่งของผู้สร้าง (ชื่อผู้ตอบ) · กลุ่มคนเดียว
// บันทึกใหม่ (เฉพาะเมื่อตั้งใจเปลี่ยนรูป API — R15b ห้าม): R15B_GOLDEN_RECORD=1 npx vitest run tests/platform/r15b-golden.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shared/id', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shared/id')>();
  let n = 0;
  return { ...actual, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
});
import { dataCtx } from '@/lib/data/context';
import * as groupsSvc from '@/lib/data/services/groups';
import { listGroupAppointments } from '@/lib/data/services/appointments';
import { AppError } from '@/lib/shared/errors';
import type { UserActor } from '@/lib/rbac/types';
import { call, get, join, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';
import { put } from '../appointments/util';

const FIXTURE = new URL('./fixtures/r15b-golden.json', import.meta.url);
const RECORD = process.env.R15B_GOLDEN_RECORD === '1';
const START = Date.UTC(2026, 10, 1, 3); // 2026-11-01 10:00 BKK
const MIN = 60_000;

let h: Harness;
const names = new Map<string, string>();
const P: Record<string, Person> = {};
let gid = '';
let solo = '';
const appts: Record<string, string> = {};
const out: Record<string, string> = {};

const tick = () => h.clock.advance(MIN);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const norm = (s: string) => s.replace(UUID, (id) => names.get(id) ?? '<uuid>');
const actorOf = (p: Person, isSuperAdmin = false): UserActor => ({ kind: 'user', id: p.id, isSuperAdmin, status: 'active', mustChangePin: false });
const ctx = () => dataCtx(new Request('https://maewmeet.test/groups'), h.clock.now());

function record(key: string, text: string): void {
  expect(out[key], `คีย์ซ้ำ ${key}`).toBeUndefined();
  out[key] = norm(text);
}

async function rsvp(key: string, who: Person, appt: string, response: string): Promise<void> {
  const r = await put(who.c, `/api/appointments/${appts[appt]}/rsvp`, { response });
  record(`PUT rsvp ${key}`, `${r.status} ${r.text}`);
  tick();
}

async function detail(who: string, appt: string, note = ''): Promise<void> {
  const r = await get(P[who]!.c, `/api/appointments/${appts[appt]}`);
  record(`GET appointment ${appt} as ${who}${note}`, `${r.status} ${r.text}`);
}

async function orNotFound(run: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await run());
  } catch (e) {
    if (e instanceof AppError && e.code === 'NOT_FOUND') return '404';
    throw e;
  }
}

/** ข้อมูลหน้า /groups/[gid] ทางเดิม: getGroup แล้ว (กลุ่มมีมากกว่า 1 คน) listGroupAppointments upcoming 50 · ล้ม → null · NOT_FOUND → "404" */
const oldGroupPage = (p: Person, g: string, sa = false) =>
  orNotFound(async () => {
    const actor = actorOf(p, sa);
    const { group } = await groupsSvc.getGroup(actor, g, ctx());
    const upcoming = group.memberCount <= 1 ? null : await listGroupAppointments(actor, g, { scope: 'upcoming', limit: '50' }, ctx()).catch(() => null);
    return { group, upcoming };
  });

/** R15b: ทางใหม่ getGroupPage (ด่านกลุ่มครั้งเดียว) ต้องได้สตริงเดียวกับทางเดิมทุกไบต์ · ตอนบันทึกจากโค้ดเดิม (ยังไม่มีฟังก์ชันนี้) → ข้าม */
async function groupPage(key: string, p: Person, g: string, sa = false): Promise<void> {
  const before = await oldGroupPage(p, g, sa);
  const getGroupPage = (groupsSvc as Record<string, unknown>).getGroupPage as typeof groupsSvc.getGroupPage | undefined;
  if (getGroupPage) {
    const after = await orNotFound(() => getGroupPage(actorOf(p, sa), g, { scope: 'upcoming', limit: '50' }, ctx()));
    expect(norm(after), `${key}: getGroupPage = getGroup + listGroupAppointments`).toBe(norm(before));
  } else expect(RECORD, 'ไม่มี getGroupPage นอกโหมดบันทึก').toBe(true);
  record(key, before);
}

async function notificationsOf(who: string): Promise<void> {
  const r = await get(P[who]!.c, '/api/me/notifications?limit=50');
  record(`GET notifications as ${who}`, `${r.status} ${r.text}`);
}

beforeAll(async () => {
  h = await setupHarness({ startAt: START });
  for (const n of ['alice', 'mod', 'bob', 'carol', 'dave', 'eve', 'oscar']) {
    P[n] = await person(h, n);
    names.set(P[n]!.id, `<user:${n}>`);
  }
  P.boss = await person(h, 'boss', { admin: true });
  names.set(P.boss.id, '<user:boss>');
  gid = await makeGroup(P.alice!, 'ก๊วน "แมว" <b>&');
  names.set(gid, '<group:main>');
  tick();
  for (const n of ['mod', 'bob', 'carol', 'dave', 'eve']) {
    await join(P.alice!, P[n]!, gid);
    tick();
  }
  expect((await call(P.alice!.c, 'PATCH', `/api/groups/${gid}/members/${P.mod!.id}`, { role: 'moderator' })).status).toBe(200);
  tick();
  expect((await call(P.bob!.c, 'PATCH', `/api/groups/${gid}/members/me/appearance`, { color: 3, shape: 5 })).status).toBe(200);
  tick();
  solo = await makeGroup(P.oscar!, 'คนเดียว');
  names.set(solo, '<group:solo>');
  tick();

  const mk = async (key: string, who: Person, body: Record<string, unknown>) => {
    const r = await post<{ appointment: { id: string } }>(who.c, `/api/groups/${gid}/appointments`, body);
    expect(r.status, r.text).toBe(201);
    appts[key] = r.data.appointment.id;
    names.set(r.data.appointment.id, `<appt:${key}>`);
    record(`POST create ${key}`, `${r.status} ${r.text}`); // toDetailDto ตัวเดียวกับ RSVP/GET
    tick();
  };
  await mk('X', P.alice!, { title: 'กินหมูกระทะ 🐷', description: 'บรรทัด 1\nบรรทัด 2', placeName: 'ร้าน "ลุง" & ป้า', lat: 13.7563, lng: 100.5018, mapUrl: 'https://maps.app.goo.gl/abc', startDate: '2026-11-07', startTime: '18:00', endDate: '2026-11-07', endTime: '21:00' });
  await mk('Y', P.mod!, { title: 'Badminton', startDate: '2026-11-08', startTime: '09:00', endDate: '2026-11-08', endTime: '11:00' });
  await mk('Z', P.carol!, { title: 'นัดของคนที่ออก', startDate: '2026-11-09', startTime: '19:00', endDate: '2026-11-09', endTime: '20:00' });
  await mk('W', P.dave!, { title: 'นัดของคนที่ถูกระงับ', startDate: '2026-11-10', startTime: '19:00', endDate: '2026-11-10', endTime: '20:00' });
  // myConflicts ของ bob: busy ทับนัด X + ตอบ "ไป" นัด Y ที่ไม่ทับ
  expect((await post(P.bob!.c, '/api/me/busy', { kind: 'timed', startDate: '2026-11-07', startTime: '20:00', endDate: '2026-11-07', endTime: '22:00', title: 'ซ้อมดนตรี' })).status).toBe(201);
  tick();
}, 300_000);

afterAll(async () => {
  await h?.cleanup();
});

describe('R15b golden — JSON เท่าเดิมทุกไบต์', () => {
  it('RSVP PUT · GET รายละเอียด · ข้อมูลหน้ากลุ่ม · กระดิ่งผู้สร้าง', async () => {
    // eve ตอบแล้วออกแล้วกลับเข้า → คำตอบเก่าไม่นับ
    await rsvp('eve going X (ก่อนออก)', P.eve!, 'X', 'going');
    expect((await post(P.eve!.c, `/api/groups/${gid}/leave`, {})).status).toBe(200);
    tick();
    await join(P.alice!, P.eve!, gid);
    tick();

    await rsvp('bob going X (ครั้งแรก)', P.bob!, 'X', 'going');
    await rsvp('bob going X (ซ้ำ)', P.bob!, 'X', 'going');
    await rsvp('bob maybe X (เปลี่ยน)', P.bob!, 'X', 'maybe');
    await rsvp('carol not_going X', P.carol!, 'X', 'not_going');
    await rsvp('alice going X (ผู้สร้าง)', P.alice!, 'X', 'going');
    await rsvp('alice going Y (แจ้ง mod)', P.alice!, 'Y', 'going');
    await rsvp('bob going Y', P.bob!, 'Y', 'going');
    await rsvp('boss going X (SA นอกกลุ่ม)', P.boss!, 'X', 'going');
    await rsvp('oscar going X (คนนอก)', P.oscar!, 'X', 'going');

    // ผู้สร้าง Z ออกจากกลุ่ม → ตอบได้แต่ไม่มีใครได้แจ้งเตือน
    expect((await post(P.carol!.c, `/api/groups/${gid}/leave`, {})).status).toBe(200);
    tick();
    await rsvp('bob going Z (ผู้สร้างออกแล้ว)', P.bob!, 'Z', 'going');
    // ผู้สร้าง W ถูกระงับ → ไม่แจ้ง
    expect((await post(P.boss!.c, `/api/admin/users/${P.dave!.id}/suspend`, {})).status).toBe(200);
    tick();
    await rsvp('bob going W (ผู้สร้างถูกระงับ)', P.bob!, 'W', 'going');
    await rsvp('mod maybe W', P.mod!, 'W', 'maybe');

    for (const who of ['alice', 'mod', 'bob', 'eve', 'boss', 'oscar']) for (const a of ['X', 'Y', 'Z', 'W']) await detail(who, a);

    for (const who of ['alice', 'mod', 'bob']) await notificationsOf(who);

    for (const who of ['alice', 'bob', 'eve']) await groupPage(`PAGE /groups/[gid] as ${who}`, P[who]!, gid);
    await groupPage('PAGE /groups/[gid] as boss (SA นอกกลุ่ม)', P.boss!, gid, true);
    await groupPage('PAGE /groups/[gid] as oscar (คนนอก)', P.oscar!, gid);
    await groupPage('PAGE /groups/[solo] as oscar (คนเดียว)', P.oscar!, solo);
    // แก้เวลา X (แจ้งสมาชิก) + ยกเลิก Y — คำตอบของทั้งสองใช้ toDetailDto เดียวกัน · นัดที่ยกเลิกยังอยู่ในรายการ upcoming ของหน้ากลุ่ม
    const upd = await call(P.alice!.c, 'PATCH', `/api/appointments/${appts.X}`, { startDate: '2026-11-07', startTime: '18:30', endDate: '2026-11-07', endTime: '21:30' });
    record('PATCH X (แก้เวลา)', `${upd.status} ${upd.text}`);
    tick();
    const cancel = await post(P.mod!.c, `/api/appointments/${appts.Y}/cancel`, {});
    record('POST cancel Y', `${cancel.status} ${cancel.text}`);
    tick();
    await groupPage('PAGE /groups/[gid] as bob (หลังยกเลิก Y)', P.bob!, gid);
    await detail('bob', 'Y', ' (หลังยกเลิก)');

    if (RECORD) {
      writeFileSync(FIXTURE, `${JSON.stringify(out, null, 2)}\n`);
      return;
    }
    expect(existsSync(FIXTURE), 'ยังไม่มีไฟล์ golden — บันทึกจากโค้ดเดิมก่อน').toBe(true);
    const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
    expect(Object.keys(out)).toEqual(Object.keys(golden));
    for (const k of Object.keys(golden)) expect(out[k], k).toBe(golden[k]);
  }, 300_000);
});
