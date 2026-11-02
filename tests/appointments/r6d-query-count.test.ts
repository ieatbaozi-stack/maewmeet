// R6D-6 — จำนวน query ต่อ request เพิ่มไม่เกิน 1 (ADR 0009 §6)
// นับทุกคำสั่งที่แอปส่งผ่าน getDb().$client.execute ระหว่าง request เดียว แล้วแยกว่าคำสั่งไหนเป็นของใหม่ R6D:
//   going query (alias "vm") · คำมั่นของฉัน (UNION ALL) — ต้องมี ≤ 1 ต่อ request · ?rsvp=going ไม่เพิ่ม query (กรองในคิวรีเดิม)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { get, join, makeGroup, person, post, put, setupHarness, type Harness, type Person } from './util';

let h: Harness;
let A: Person, B: Person;
let gid: string;
let other: string;
let appt: string;
let seen: string[] = [];

const measure = async (fn: () => Promise<{ status: number; text: string }>) => {
  seen = [];
  const r = await fn();
  expect(r.status, r.text).toBeLessThan(300);
  const all = [...seen];
  return { total: all.length, going: all.filter((s) => s.includes('"vm"')).length, mine: all.filter((s) => s.includes('UNION ALL')).length };
};

beforeAll(async () => {
  h = await setupHarness({ startAt: Date.UTC(2026, 9, 1, 3) });
  [A, B] = [await person(h, 'qa1'), await person(h, 'qb1')];
  gid = await makeGroup(A, 'นับคิวรี');
  await join(A, B, gid);
  other = await makeGroup(B, 'อีกกลุ่ม');
  await join(B, A, other);
  const r = await post<{ appointment: { id: string } }>(B.c, `/api/groups/${other}/appointments`, { title: 'นัด', startDate: '2026-10-07', startTime: '12:00', endDate: '2026-10-07', endTime: '15:00' });
  expect(r.status, r.text).toBe(201);
  appt = r.data.appointment.id;
  const client = getDb().$client;
  const orig = client.execute.bind(client);
  client.execute = ((stmt: string | { sql: string }) => {
    seen.push(typeof stmt === 'string' ? stmt : stmt.sql);
    return orig(stmt as never);
  }) as typeof client.execute;
});
afterAll(async () => {
  await h.cleanup();
});

describe('R6D-6 — query ใหม่ต่อ request ≤ 1', () => {
  it('GET calendar / availability · POST check → going query 1 ครั้ง ไม่มี UNION ALL', async () => {
    const reqs = [
      () => get(A.c, `/api/groups/${gid}/calendar?from=2026-10-01&to=2026-10-31`),
      () => get(A.c, `/api/groups/${gid}/availability?from=2026-10-01&to=2026-10-31`),
      () => post(A.c, `/api/groups/${gid}/appointments/check`, { startDate: '2026-10-07', startTime: '12:00', endDate: '2026-10-07', endTime: '13:00' }),
    ];
    for (const fn of reqs) {
      const m = await measure(fn);
      expect(m.going).toBe(1);
      expect(m.mine).toBe(0);
    }
  });

  it('GET /api/appointments/:id · PUT rsvp → UNION ALL 1 ครั้ง ไม่มี going query', async () => {
    const d = await measure(() => get(A.c, `/api/appointments/${appt}`));
    expect([d.mine, d.going]).toEqual([1, 0]);
    const r = await measure(() => put(A.c, `/api/appointments/${appt}/rsvp`, { response: 'going' }));
    expect([r.mine, r.going]).toEqual([1, 0]);
  });

  it('GET /api/me/appointments: มีนัดที่ฉันตอบไป → +1 (UNION ALL) · ?rsvp=going ไม่เพิ่ม query · คนที่ไม่ได้ตอบไป → +0', async () => {
    const plain = await measure(() => get(A.c, '/api/me/appointments'));
    const going = await measure(() => get(A.c, '/api/me/appointments?rsvp=going'));
    expect(plain.mine).toBe(1);
    expect(going.total).toBe(plain.total);
    const none = await measure(() => get(B.c, '/api/me/appointments'));
    expect(none.mine).toBe(0);
    expect(none.total).toBe(plain.total - 1);
  });
});
