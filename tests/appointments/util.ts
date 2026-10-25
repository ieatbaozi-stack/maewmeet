// เครื่องมือเทสต์นัด/แจ้งเตือน (R4B) — ต่อจาก tests/groups/harness
import { expect } from 'vitest';
import { newId } from '@/lib/shared/id';
import { call, makeGroup, join, person, post, type Harness, type Person, type Res } from '../groups/harness';

export { Client, call, get, join, makeGroup, patch, person, post, setupHarness, DAY, HOUR, MIN } from '../groups/harness';
export type { Harness, Person, Res };

export const put = <T = Record<string, unknown>>(c: Person['c'], p: string, b?: unknown) => call<T>(c, 'PUT' as 'POST', p, b);

// START ของ harness = 2026-10-18 10:00 เวลากรุงเทพฯ → นัดตัวอย่างอยู่วันที่ 24 ตุลาคม
export const SLOT = { startDate: '2026-10-24', startTime: '10:00', endDate: '2026-10-24', endTime: '11:00' } as const;

export type ApptDto = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  description: string | null;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
  startAt: number;
  endAt: number;
  tz: string;
  localDate: string;
  status: 'active' | 'cancelled';
  isPast: boolean;
  daysUntil: number;
  createdBy: { userId: string; displayName: string; colorIndex: number } | null;
  createdAt: number;
  updatedAt: number;
  cancelledAt: number | null;
  cancelledBy: { userId: string; displayName: string; colorIndex: number } | null;
  rsvp: { counts: { going: number; maybe: number; not_going: number; noResponse: number }; mine: string | null; members?: Record<string, { userId: string }[]> };
  permissions?: { canEdit: boolean; canCancel: boolean; canRsvp: boolean };
};
export type Overlap = { status: 'ok' | 'unknown'; blocked: { userId: string; displayName: string; colorIndex: number; items: Record<string, unknown>[] }[] };
export type Created = { appointment: ApptDto; overlap: Overlap };

export async function createAppt(p: Person, gid: string, over: Record<string, unknown> = {}): Promise<Res<Created>> {
  return post<Created>(p.c, `/api/groups/${gid}/appointments`, { title: 'กินข้าว', ...SLOT, ...over });
}

export async function mustCreate(p: Person, gid: string, over: Record<string, unknown> = {}): Promise<ApptDto> {
  const r = await createAppt(p, gid, over);
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.data.appointment;
}

/** กลุ่มมาตรฐาน: admin(a) · moderator(m) · สมาชิกธรรมดา(b, c) · คนนอก(o) · super admin ที่ไม่ใช่สมาชิก(boss) */
export type World = { a: Person; m: Person; b: Person; c: Person; o: Person; boss: Person; gid: string };

export async function world(h: Harness): Promise<World> {
  const [a, m, b, c, o, boss] = [
    await person(h, 'alice'),
    await person(h, 'mod'),
    await person(h, 'bob'),
    await person(h, 'carol'),
    await person(h, 'oscar'),
    await person(h, 'boss', { admin: true }),
  ];
  const gid = await makeGroup(a, 'ก๊วนแมว');
  for (const x of [m, b, c]) await join(a, x, gid);
  const r = await call(a.c, 'PATCH', `/api/groups/${gid}/members/${m.id}`, { role: 'moderator' });
  expect(r.status).toBe(200);
  return { a, m, b, c, o, boss, gid };
}

/** แทรกนัด active ตรง ๆ ผ่าน SQL (เลี่ยงยิง API ร้อยครั้ง) — startAt เรียงต่อกันครั้งละชั่วโมงนับจาก base */
export async function seedAppointments(h: Harness, gid: string, createdBy: string, n: number, base: number, tz = 'Asia/Bangkok'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = newId();
    ids.push(id);
    await h.rows(
      `INSERT INTO appointment (id, group_id, title, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '2026-11-01', 'active', ?, ?, ?)`,
      [id, gid, `seed ${i}`, base + i * 3_600_000, base + i * 3_600_000 + 1_800_000, tz, createdBy, base, base],
    );
  }
  return ids;
}
