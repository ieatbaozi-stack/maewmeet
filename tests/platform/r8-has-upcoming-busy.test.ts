// R8 F1 §2.2 · R8-3: `hasUpcomingBusy` ต่อสมาชิกใน GET /api/groups/:gid (handler + DB + migration จริง)
//  - true ⇔ มี busy_block (ลงเอง) ที่ทับ [now, now + 30 วันปฏิทินใน tz ของกลุ่ม) · end exclusive · นัดที่กด "ไป" ไม่นับ (ADR 0009)
//  - boolean อย่างเดียว ไม่มีเวลา/ชื่อ busy ใน DTO (ADR 0006) · สิทธิ์เดิม: คนนอก → 404 · super admin นอกกลุ่ม → เห็นตามกฎเดิม
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysAt, toLocal } from '@/lib/calendar';
import { UPCOMING_BUSY_LOOKAHEAD_DAYS } from '@/lib/shared/limits';
import { get, join, makeGroup, person, post, put, setupHarness, DAY, HOUR, MIN, type Harness, type Person } from '../appointments/util';

type Member = Record<string, unknown> & { userId: string; hasUpcomingBusy: boolean };
type Detail = { id: string; members: Member[] };

const TZ = 'Asia/Bangkok';
const CANARY = `CANARY-BUSY-${randomBytes(6).toString('hex')}`;

let h: Harness;
let now: number;
let horizon: number;
let A: Person, past: Person, straddle: Person, after: Person, edgeIn: Person, endsAtNow: Person, going: Person, none: Person, multi: Person;
let outsider: Person, boss: Person;
let G: string, H: string;

/** แทรก busy_block ตรงๆ (ขอบเวลาแม่นระดับ ms) · title = canary ไว้ตรวจว่าไม่รั่วออก DTO */
let seq = 0;
async function seedBusy(userId: string, startAt: number, endAt: number): Promise<void> {
  const s = toLocal(startAt, TZ).date;
  const e = toLocal(endAt - 1, TZ).date;
  await h.rows(
    `INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 1, 1)`,
    [`r8-${seq++}`, userId, CANARY, `${CANARY}-note`, startAt, endAt, s, e < s ? s : e, TZ],
  );
}

async function detail(p: Person, gid: string) {
  const r = await get<{ group: Detail }>(p.c, `/api/groups/${gid}`);
  expect(r.status, r.text).toBe(200);
  return r;
}
const flagOf = (d: Detail, u: Person) => d.members.find((m) => m.userId === u.id)?.hasUpcomingBusy;

beforeAll(async () => {
  h = await setupHarness(); // 2026-10-18 10:00 BKK
  now = h.clock.now();
  horizon = addDaysAt(now, UPCOMING_BUSY_LOOKAHEAD_DAYS, TZ);
  [A, past, straddle, after, edgeIn, endsAtNow, going, none, multi, outsider, boss] = [
    await person(h, 'r8a'),
    await person(h, 'r8past'),
    await person(h, 'r8straddle'),
    await person(h, 'r8after'),
    await person(h, 'r8edge'),
    await person(h, 'r8endnow'),
    await person(h, 'r8going'),
    await person(h, 'r8none'),
    await person(h, 'r8multi'),
    await person(h, 'r8out'),
    await person(h, 'r8boss', { admin: true }),
  ];
  G = await makeGroup(A, 'ก๊วน R8');
  for (const p of [past, straddle, after, edgeIn, endsAtNow, going, none, multi]) await join(A, p, G);
  H = await makeGroup(outsider, 'อีกกลุ่ม');
  await join(outsider, multi, H);

  await seedBusy(A.id, now + 2 * DAY, now + 2 * DAY + 2 * HOUR); // อนาคตในหน้าต่าง
  await seedBusy(past.id, now - 3 * DAY, now - 3 * DAY + HOUR); // อดีตล้วน
  await seedBusy(straddle.id, now - HOUR, now + HOUR); // เริ่มก่อน now จบหลัง now
  await seedBusy(after.id, horizon, horizon + HOUR); // เริ่มที่ขอบ +30 วันพอดี (exclusive) → ไม่นับ
  await seedBusy(after.id, horizon + DAY, horizon + DAY + HOUR); // หลัง +30 วัน
  await seedBusy(edgeIn.id, horizon - MIN, horizon + HOUR); // เริ่มก่อนขอบ 1 นาที → นับ
  await seedBusy(endsAtNow.id, now - HOUR, now); // จบที่ now พอดี (end exclusive) → ไม่นับ
  await seedBusy(multi.id, now + 5 * DAY, now + 5 * DAY + HOUR); // busy ระดับผู้ใช้ — นับทุกกลุ่มที่อยู่
  await seedBusy(outsider.id, now + DAY, now + DAY + HOUR); // คนนอกกลุ่ม G

  // going: มีแค่นัดที่กด "ไป" ในหน้าต่าง (ไม่มี busy_block) → ไม่นับ (ADR 0009)
  const ap = await post<{ appointment: { id: string } }>(A.c, `/api/groups/${G}/appointments`, {
    title: 'กินข้าว',
    startDate: '2026-10-24',
    startTime: '10:00',
    endDate: '2026-10-24',
    endTime: '11:00',
  });
  expect(ap.status, ap.text).toBe(201);
  const rs = await put(going.c, `/api/appointments/${ap.data.appointment.id}/rsvp`, { response: 'going' });
  expect(rs.status, rs.text).toBe(200);
});
afterAll(async () => h?.cleanup());

describe('R8-3 hasUpcomingBusy', () => {
  it('หน้าต่าง 30 วันคิดด้วย lib กลางตาม tz กลุ่ม (Asia/Bangkok ไม่มี DST = 30 × 24 ชม.)', () => {
    expect(UPCOMING_BUSY_LOOKAHEAD_DAYS).toBe(30);
    expect(horizon - now).toBe(30 * DAY);
  });

  it('ค่าต่อสมาชิกตรงกับกรณีขอบ: อนาคต/ทับ now/ก่อนขอบ 1 นาที → true · อดีต/จบที่ now/เริ่มที่ขอบหรือหลัง/ไม่มี/มีแค่นัดที่ไป → false', async () => {
    const { group } = (await detail(A, G)).data;
    expect(flagOf(group, A)).toBe(true);
    expect(flagOf(group, straddle)).toBe(true);
    expect(flagOf(group, edgeIn)).toBe(true);
    expect(flagOf(group, multi)).toBe(true);
    expect(flagOf(group, past)).toBe(false);
    expect(flagOf(group, endsAtNow)).toBe(false);
    expect(flagOf(group, after)).toBe(false);
    expect(flagOf(group, none)).toBe(false);
    expect(flagOf(group, going)).toBe(false);
    // ทุกสมาชิกมี field เป็น boolean แท้ (ไม่ใช่ 0/1 หรือ undefined)
    for (const m of group.members) expect(typeof m.hasUpcomingBusy).toBe('boolean');
  });

  it('busy ระดับผู้ใช้: สมาชิกที่อยู่สองกลุ่มได้ true ทั้งสองกลุ่ม · คนนอกไม่โผล่ในรายชื่อกลุ่ม G', async () => {
    const g = (await detail(A, G)).data.group;
    const hh = (await detail(outsider, H)).data.group;
    expect(flagOf(hh, multi)).toBe(true);
    expect(flagOf(hh, outsider)).toBe(true);
    expect(g.members.map((m) => m.userId)).not.toContain(outsider.id);
    expect(g.members).toHaveLength(9);
  });

  it('สมาชิกธรรมดาเห็นค่าเดียวกับ admin (ข้อมูลระดับกลุ่ม ไม่ใช่ของผู้ดู)', async () => {
    const byAdmin = (await detail(A, G)).data.group.members.map((m) => [m.userId, m.hasUpcomingBusy]);
    const byMember = (await detail(none, G)).data.group.members.map((m) => [m.userId, m.hasUpcomingBusy]);
    expect(byMember).toEqual(byAdmin);
  });

  it('DTO ไม่มีรายละเอียด busy: คีย์ของสมาชิกเท่าเดิม + hasUpcomingBusy · ไม่มี title/note canary ใน JSON ดิบ', async () => {
    const r = await detail(A, G);
    for (const m of r.data.group.members) {
      expect(Object.keys(m).sort()).toEqual(['colorIndex', 'displayName', 'hasUpcomingBusy', 'joinedAt', 'role', 'shapeIndex', 'userId']);
    }
    expect(r.text).not.toContain(CANARY);
    expect(r.text).not.toMatch(/startAt|endAt|localStartDate|"busy"/);
  });

  it('สิทธิ์เดิม: คนนอกกลุ่ม → 404 (ไม่มีธงรั่ว) · super admin นอกกลุ่ม → 200 ตามกฎเดิม', async () => {
    const r = await get(outsider.c, `/api/groups/${G}`);
    expect(r.status).toBe(404);
    expect(r.text).not.toContain('hasUpcomingBusy');
    const sa = await detail(boss, G);
    expect(flagOf(sa.data.group, A)).toBe(true);
    expect(flagOf(sa.data.group, past)).toBe(false);
  });

  it('ลง busy ผ่าน API จริงแล้วธงเปลี่ยน false → true · เวลาเดินจนพ้น busy → กลับเป็น false', async () => {
    expect(flagOf((await detail(A, G)).data.group, none)).toBe(false);
    const c = await post(none.c, '/api/me/busy', { kind: 'timed', startDate: '2026-10-20', startTime: '18:00', endDate: '2026-10-20', endTime: '20:00' });
    expect(c.status, c.text).toBe(201);
    expect(flagOf((await detail(A, G)).data.group, none)).toBe(true);
    const saved = h.clock.now();
    try {
      h.clock.set(Date.UTC(2026, 9, 20, 13, 0)); // 2026-10-20 20:00 BKK = จบพอดี
      expect(flagOf((await detail(A, G)).data.group, none)).toBe(false);
    } finally {
      h.clock.set(saved);
    }
  });
});
