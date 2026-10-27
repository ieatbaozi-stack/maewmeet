// R5-5 — ความเป็นส่วนตัวของหน้า admin (R5_CONTRACT §2 ข้อ 3, §5, §6 · ADR 0006)
// canary: response ของ /api/admin/* ไม่มี pin_hash/pepper/note/busy/ชื่อนัด/พิกัด · รายละเอียดกลุ่มมีเฉพาะชื่อ+role+จำนวน ·
// SA เรียก /api/groups/:gid/calendar|availability|appointments ของกลุ่มที่ไม่ใช่สมาชิก → ผลตามเดิมของ R3–R4B (ไม่เปิดช่องใหม่)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { call, get, join, makeGroup, mustCreate, person, post, put, setupHarness, type Harness, type Person } from '../appointments/util';

let h: Harness;
let boss: Person;
let alice: Person;
let bob: Person;
let gid: string;

const CANARY = {
  note: 'CANARY-NOTE-7f3a',
  busyTitle: 'CANARY-BUSY-91c2',
  apptTitle: 'CANARY-APPT-44d0',
  apptDesc: 'CANARY-DESC-1e9b',
  place: 'CANARY-PLACE-5a6c',
  lat: 13.7563309,
  lng: 100.5017651,
};

beforeEach(async () => {
  h = await setupHarness();
  boss = await person(h, 'boss', { admin: true });
  alice = await person(h, 'alice');
  bob = await person(h, 'bob');
  gid = await makeGroup(alice, 'ก๊วนลับ');
  await join(alice, bob, gid);
  expect(
    (await post(bob.c, '/api/me/busy', { kind: 'all_day', startDate: '2026-10-24', endDate: '2026-10-24', title: CANARY.busyTitle, note: CANARY.note })).status,
  ).toBe(201);
  await mustCreate(alice, gid, { title: CANARY.apptTitle, description: CANARY.apptDesc, placeName: CANARY.place, lat: CANARY.lat, lng: CANARY.lng });
});
afterEach(async () => {
  await h.cleanup();
});

const FORBIDDEN_IN_ADMIN = [
  /pin_?hash/i,
  /\$argon2/i,
  /pepper/i,
  /CANARY-/,
  /13\.7563/,
  /100\.5017/,
  /"note"/,
  /"busy"/i,
  /"title"/,
  /"description"/,
  /"lat"|"lng"/,
  /mapUrl|placeName/,
];

describe('canary: ทุก GET /api/admin/* ของ super admin', () => {
  it('ไม่มีความลับ/busy/รายละเอียดนัด/พิกัดหลุด', async () => {
    // canary มีอยู่จริงในระบบ (เจ้าของ/สมาชิกเห็น) — เทสต์ด้านลบจึงมีความหมาย
    const own = await get(alice.c, `/api/groups/${gid}/appointments`);
    expect(own.text).toContain(CANARY.apptTitle);
    expect(own.text).toContain('13.7563');
    expect((await get(bob.c, '/api/me/busy')).text).toContain(CANARY.note);
    const paths = [
      '/api/admin/users',
      `/api/admin/users?q=bob`,
      '/api/admin/groups',
      '/api/admin/groups?status=all&q=ก๊วน',
      `/api/admin/groups/${gid}`,
      '/api/admin/audit?limit=100',
    ];
    // ทุก GET admin ใน manifest ต้องอยู่ในรายการตรวจ
    for (const e of ROUTE_MANIFEST.filter((x) => x.method === 'GET' && x.path.startsWith('/api/admin/'))) {
      expect(paths.some((p) => p.split('?')[0] === e.path.replace(':gid', gid)), e.path).toBe(true);
    }
    for (const p of paths) {
      const r = await get(boss.c, p);
      expect(r.status, `${p} ${r.text}`).toBe(200);
      for (const re of FORBIDDEN_IN_ADMIN) expect(re.test(r.text), `${p} มี ${re}`).toBe(false);
    }
  });

  it('รายละเอียดกลุ่ม: ชื่อ + tz + สมาชิก (username, displayName, role, joinedAt) + จำนวน เท่านั้น', async () => {
    const r = await get<{ group: Record<string, unknown> & { members: Record<string, unknown>[] } }>(boss.c, `/api/admin/groups/${gid}`);
    expect(Object.keys(r.data.group).sort()).toEqual(['createdAt', 'deletedAt', 'id', 'memberCount', 'members', 'name', 'openAppointmentCount', 'tz'].sort());
    expect(r.data.group).toMatchObject({ name: 'ก๊วนลับ', tz: 'Asia/Bangkok', memberCount: 2, openAppointmentCount: 1, deletedAt: null });
    for (const m of r.data.group.members) expect(Object.keys(m).sort()).toEqual(['displayName', 'joinedAt', 'role', 'userId', 'username']);
    expect(r.data.group.members.map((m) => [m.username, m.role])).toEqual([
      ['alice', 'admin'],
      ['bob', 'member'],
    ]);
  });

  it('audit ของการกระทำในกลุ่ม (สร้างนัด/busy) ไม่มีชื่อนัด/หมายเหตุใน meta', async () => {
    const r = await get(boss.c, '/api/admin/audit?limit=100');
    expect(r.text).toContain('appointment.create');
    expect(r.text).not.toMatch(/CANARY-/);
  });
});

describe('SA นอกกลุ่มกับ endpoint กลุ่มเดิม — พฤติกรรมเดิมของ R3–R4B (ไม่เปิดช่องใหม่)', () => {
  it('calendar / availability / appointments: 200 แบบเดิม + audit asSuperAdmin · note ไม่หลุด · RSVP → 403', async () => {
    const auditBefore = await h.count('audit_log WHERE actor_id = ?', [boss.id]);
    const cal = await get(boss.c, `/api/groups/${gid}/calendar?from=2026-10-01&to=2026-10-31`);
    expect(cal.status).toBe(200);
    expect(cal.text).not.toContain(CANARY.note);
    const av = await get(boss.c, `/api/groups/${gid}/availability?from=2026-10-24&to=2026-10-24`);
    expect(av.status).toBe(200);
    expect(av.text).not.toContain(CANARY.note);
    const ap = await get<{ appointments: { id: string }[] }>(boss.c, `/api/groups/${gid}/appointments`);
    expect(ap.status).toBe(200);
    expect(await h.count('audit_log WHERE actor_id = ?', [boss.id])).toBe(auditBefore + 3);
    const id = ap.data.appointments[0]!.id;
    expect((await put(boss.c, `/api/appointments/${id}/rsvp`, { response: 'going' })).code).toBe('FORBIDDEN');
  });

  it('ผู้ใช้ทั่วไปที่ไม่ใช่สมาชิกยังได้ 404 ตามเดิม', async () => {
    const nina = await person(h, 'nina');
    for (const p of [`/api/groups/${gid}/calendar?from=2026-10-01&to=2026-10-31`, `/api/groups/${gid}/availability?from=2026-10-24&to=2026-10-24`, `/api/groups/${gid}/appointments`]) {
      expect((await call(nina.c, 'GET', p)).status, p).toBe(404);
    }
    expect((await get(nina.c, `/api/admin/groups/${gid}`)).status).toBe(403);
  });
});
