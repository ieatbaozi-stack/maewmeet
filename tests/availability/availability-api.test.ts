// R4A Platform — GET /api/groups/:gid/availability · ADR 0005 Test requirements (T1, T2, T15, T16, T24 ผ่าน API) + ADR 0006 canary (ข้อ 1, 5, 7, 8, 9, 10)
// เรียก route handler จริงผ่าน Request/Response บน libSQL จริง + migration จริง + นาฬิกา inject (tests/groups/harness)
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { sharedBusyInGroupQuery } from '@/lib/data/repos/busy';
import { availabilityFetchRange, AVAILABILITY_FETCH_MARGIN_MS } from '@/lib/data/services/availability';
import { CALENDAR_MAX_ITEMS, FREE_TIME_MAX_ITEMS } from '@/lib/shared/limits';
import { memberColorIndex } from '@/lib/shared/member-color';
import { Client, call, del, get, join, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

const rand = () => randomBytes(6).toString('hex');
const CT = `CANARY-T-${rand()}`; // title ที่ไม่ซ่อน — เพื่อนเห็นได้
const CH = `CANARY-H-${rand()}`; // title ที่ซ่อน — ห้ามหลุด
const CN = `CANARY-N-${rand()}`; // note — ห้ามหลุดให้ใครนอกจากเจ้าของ
const CX = `CANARY-X-${rand()}`; // busy ของคนนอกกลุ่ม

let h: Harness;
let alice: Person; // A: admin กลุ่ม
let bob: Person; // B
let carol: Person; // C
let boss: Person; // super admin ไม่ใช่สมาชิก
let out: Person; // ไม่อยู่กลุ่มไหน
let gid: string;

type View = Record<string, unknown> & { id: string; userId: string };
type Day = {
  date: string;
  freeMembers: number;
  totalMembers: number;
  allFree: boolean;
  notFreeUserIds: string[];
  segments: { startAt: number; endAt: number; start: string; end: string }[];
  blockers: { userId: string; itemIdx: number[] }[];
};
type Avail = {
  group: { id: string; tz: string; windowStartMin: number; windowEndMin: number; minFreeMinutes: number };
  from: string;
  to: string;
  members: { userId: string; displayName: string; colorIndex: number; shapeIndex: number }[];
  days: Day[];
  busy: View[];
  truncated: boolean;
  detailTruncated: boolean;
};

const url = (g: string, from: string, to = from) => `/api/groups/${g}/availability?from=${from}&to=${to}`;
const avail = (p: Person, from: string, to = from, g = gid) => get<Avail>(p.c, url(g, from, to));
const timed = (p: Person, date: string, s: string, e: string, extra: Record<string, unknown> = {}) =>
  post<{ busy: { id: string } }>(p.c, '/api/me/busy', { kind: 'timed', startDate: date, startTime: s, endDate: date, endTime: e, ...extra });
const allDay = (p: Person, from: string, to = from, extra: Record<string, unknown> = {}) =>
  post<{ busy: { id: string } }>(p.c, '/api/me/busy', { kind: 'all_day', startDate: from, endDate: to, ...extra });
const day = (r: { data: Avail }, date: string): Day => r.data.days.find((d) => d.date === date)!;
/** busy items ของวันหนึ่ง (join ด้วยดัชนีเข้า busy[] ระดับบน) — ทุกดัชนีต้องมีใน array */
const itemsOf = (r: { data: Avail }, d: Day, userId?: string): View[] =>
  d.blockers
    .filter((b) => userId === undefined || b.userId === userId)
    .flatMap((b) => b.itemIdx.map((i) => r.data.busy[i] ?? expect.fail(`missing busy[${i}]`)));
const segs = (d: Day) => d.segments.map((s) => `${s.start}-${s.end}`);
const ids = (...ps: Person[]) => ps.map((p) => p.id);

beforeEach(async () => {
  h = await setupHarness();
  [alice, bob, carol, boss, out] = [
    await person(h, 'alice'),
    await person(h, 'bob'),
    await person(h, 'carol'),
    await person(h, 'boss', { admin: true }),
    await person(h, 'nina'),
  ];
  gid = await makeGroup(alice, 'กลุ่มทดสอบ');
  // ตาราง T1/T2/T24 ของ ADR 0005 คำนวณมือที่ขั้นต่ำ 120 นาที — R7 G1 ให้กลุ่มใหม่ได้ 240 จึงตั้งกลับเป็น 120 ตรง ๆ (ไม่ผ่าน API: ไม่เพิ่ม audit)
  await h.rows('UPDATE groups SET min_free_minutes = 120 WHERE id = ?', [gid]);
  await join(alice, bob, gid);
  await join(alice, carol, gid);
});
afterEach(async () => {
  await h.cleanup();
});

describe('ADR 0005 — ข้อมูล T1/T2/T24 ผ่าน API ตรงตาราง', () => {
  it('T1: A 10:00–12:00 · B ทั้งวัน 2026-11-02 → ว่าง 2/3 ไม่ว่างร่วม · notFree = B · blockers มีทั้ง A (ว่างอยู่) และ B', async () => {
    await timed(alice, '2026-11-02', '10:00', '12:00');
    await allDay(bob, '2026-11-02');
    const r = await avail(alice, '2026-11-02');
    expect(r.status).toBe(200);
    const d = day(r, '2026-11-02');
    expect([d.freeMembers, d.totalMembers, d.allFree, d.segments]).toEqual([2, 3, false, []]);
    expect(d.notFreeUserIds).toEqual([bob.id]);
    expect(d.blockers.map((b) => b.userId).sort()).toEqual(ids(alice, bob).sort());
    expect(itemsOf(r, d, bob.id)[0]).toMatchObject({ allDay: true, localStartDate: '2026-11-02', localEndDate: '2026-11-02' });
  });

  it('T2: A 10–12 · B 14–16 → 3/3 ว่างร่วม 08–10 · 12–14 · 16–22 (instant + HH:MM)', async () => {
    await timed(alice, '2026-11-03', '10:00', '12:00');
    await timed(bob, '2026-11-03', '14:00', '16:00');
    const d = day(await avail(carol, '2026-11-03'), '2026-11-03');
    expect([d.freeMembers, d.totalMembers, d.allFree, d.notFreeUserIds]).toEqual([3, 3, true, []]);
    expect(segs(d)).toEqual(['08:00-10:00', '12:00-14:00', '16:00-22:00']);
    expect(d.segments[0]).toMatchObject({ startAt: Date.UTC(2026, 10, 3, 1), endAt: Date.UTC(2026, 10, 3, 3) }); // 08:00–10:00 BKK
    expect(d.blockers.map((b) => b.userId).sort()).toEqual(ids(alice, bob).sort()); // ว่างทั้งคู่ แต่ยังอธิบายได้ว่าติดช่วงไหน
  });

  it('T24: ทุกคนว่างรายคน แต่ไม่มีช่วงตรงกัน (A 08–15, B 15–22) → 3/3 แต่ allFree=false · notFree ว่าง · blockers ครบสองคน', async () => {
    await timed(alice, '2026-12-02', '08:00', '15:00');
    await timed(bob, '2026-12-02', '15:00', '22:00');
    const d = day(await avail(alice, '2026-12-02'), '2026-12-02');
    expect([d.freeMembers, d.totalMembers, d.allFree, d.segments, d.notFreeUserIds]).toEqual([3, 3, false, [], []]);
    expect(d.blockers.map((b) => b.userId).sort()).toEqual(ids(alice, bob).sort());
  });

  it('busy นอกหน้าต่างทั้งหมด (22:00–06:00) ไม่อยู่ใน blockers · ข้ามเที่ยงคืนนับเฉพาะส่วนที่ทับหน้าต่าง (T4-style)', async () => {
    await post(alice.c, '/api/me/busy', { kind: 'timed', startDate: '2026-11-10', startTime: '22:00', endDate: '2026-11-11', endTime: '06:00' });
    await post(bob.c, '/api/me/busy', { kind: 'timed', startDate: '2026-11-10', startTime: '21:00', endDate: '2026-11-11', endTime: '09:00' });
    const r = await avail(carol, '2026-11-10', '2026-11-11');
    expect(day(r, '2026-11-10').blockers.map((b) => b.userId)).toEqual([bob.id]);
    expect(segs(day(r, '2026-11-10'))).toEqual(['08:00-21:00']);
    expect(day(r, '2026-11-11').blockers.map((b) => b.userId)).toEqual([bob.id]);
    expect(segs(day(r, '2026-11-11'))).toEqual(['09:00-22:00']);
  });

  it('busy ใน tz อื่น (Tokyo 10:00–12:00 JST = 08:00–10:00 BKK) · ทั้งวัน Tokyo = วันที่ลอย (T19/T20)', async () => {
    await timed(alice, '2026-11-10', '10:00', '12:00', { tz: 'Asia/Tokyo' });
    await allDay(bob, '2026-11-11', '2026-11-11', { tz: 'Asia/Tokyo' });
    const r = await avail(carol, '2026-11-10', '2026-11-12');
    expect(segs(day(r, '2026-11-10'))).toEqual(['10:00-22:00']);
    expect([day(r, '2026-11-11').freeMembers, day(r, '2026-11-11').allFree]).toEqual([2, false]);
    expect(day(r, '2026-11-12').allFree).toBe(true);
  });

  it('ทั้งวันของ tz สุดขอบ (UTC+14 ↔ UTC−12) ก็ถูกดึงมา: กลุ่ม Pacific/Kiritimati ← busy ทั้งวันใน Etc/GMT+12', async () => {
    await h.rows("UPDATE groups SET tz = 'Pacific/Kiritimati', free_window_start_min = 480, free_window_end_min = 510, min_free_minutes = 30 WHERE id = ?", [gid]);
    expect((await allDay(bob, '2026-11-11', '2026-11-11', { tz: 'Etc/GMT+12' })).status).toBe(201);
    const d = day(await avail(alice, '2026-11-11'), '2026-11-11');
    expect(d.notFreeUserIds).toEqual([bob.id]);
  });

  it('รูปร่าง response ตรง strict schema (ฟิลด์เกินแล้วล้ม) · members: ผู้ดูก่อน + colorIndex ตรง /calendar · group มีหน้าต่าง', async () => {
    await timed(alice, '2026-11-03', '10:00', '12:00', { title: CT, note: CN });
    await timed(bob, '2026-11-03', '14:00', '16:00', { title: CH, note: CN, hideDetail: true });
    const base = { kind: z.literal('busy'), id: z.uuid(), userId: z.uuid(), allDay: z.boolean(), startAt: z.number().int(), endAt: z.number().int(), localStartDate: z.string(), localEndDate: z.string(), tz: z.string() };
    const item = z.union([z.object({ ...base, title: z.string().min(1) }).strict(), z.object(base).strict()]);
    const schema = z
      .object({
        group: z.object({ id: z.uuid(), tz: z.string(), windowStartMin: z.number(), windowEndMin: z.number(), minFreeMinutes: z.number() }).strict(),
        from: z.string(),
        to: z.string(),
        members: z.array(z.object({ userId: z.uuid(), displayName: z.string(), colorIndex: z.number().int().min(0).max(9), shapeIndex: z.number().int().min(0).max(9) }).strict()),
        busy: z.array(item),
        days: z.array(
          z
            .object({
              date: z.string(),
              freeMembers: z.number(),
              totalMembers: z.number(),
              allFree: z.boolean(),
              notFreeUserIds: z.array(z.uuid()),
              segments: z.array(z.object({ startAt: z.number(), endAt: z.number(), start: z.string(), end: z.string() }).strict()),
              blockers: z.array(z.object({ userId: z.uuid(), itemIdx: z.array(z.number().int().min(0)).min(1) }).strict()),
            })
            .strict(),
        ),
        truncated: z.boolean(),
        detailTruncated: z.boolean(),
      })
      .strict();
    const r = await avail(carol, '2026-11-01', '2026-11-07');
    const body = schema.parse(r.json.data);
    expect(body.days).toHaveLength(7);
    // busy ครั้งเดียว: ทุกดัชนีที่อ้างอยู่ใน array และไม่มีรายการที่ไม่ถูกอ้าง · busy เรียง startAt,id ไม่ซ้ำ id · itemIdx เรียงน้อย→มาก · blockers เรียงตาม members
    const referenced = new Set(body.days.flatMap((d) => d.blockers.flatMap((b) => b.itemIdx)));
    expect([...referenced].sort((a, b) => a - b)).toEqual(body.busy.map((_, i) => i));
    expect(referenced.size).toBeGreaterThan(0);
    expect(new Set(body.busy.map((b) => b.id)).size).toBe(body.busy.length);
    const keyOf = (v: { startAt: number; id: string }) => `${String(v.startAt).padStart(16, '0')}|${v.id}`;
    expect(body.busy.map(keyOf)).toEqual(body.busy.map(keyOf).sort());
    const order = body.members.map((m) => m.userId);
    for (const d of body.days) {
      const idx = d.blockers.map((b) => order.indexOf(b.userId));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
      for (const b of d.blockers) {
        expect(b.itemIdx).toEqual([...b.itemIdx].sort((x, y) => x - y));
        for (const i of b.itemIdx) expect(body.busy[i]!.userId).toBe(b.userId);
      }
    }
    expect(r.data.group).toEqual({ id: gid, tz: 'Asia/Bangkok', windowStartMin: 480, windowEndMin: 1320, minFreeMinutes: 120 });
    expect(r.data.members[0]!.userId).toBe(carol.id);
    expect(r.data.members.map((m) => m.userId).sort()).toEqual(ids(alice, bob, carol).sort());
    for (const m of r.data.members) expect([m.colorIndex, m.shapeIndex]).toEqual([memberColorIndex(gid, m.userId), memberColorIndex(gid, m.userId)]); // R6C-1
    expect(r.data.members.find((m) => m.userId === bob.id)!.displayName).toBe(bob.displayName);
    expect([r.data.from, r.data.to, r.data.truncated, r.data.detailTruncated]).toEqual(['2026-11-01', '2026-11-07', false, false]);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });

  it('เปลี่ยนหน้าต่างวันของกลุ่ม → ผลเปลี่ยนทันที (18:00–23:00 ขั้นต่ำ 60: T17)', async () => {
    await timed(alice, '2026-11-03', '19:00', '20:30');
    expect(segs(day(await avail(bob, '2026-11-03'), '2026-11-03'))).toEqual(['08:00-19:00']); // 20:30–22:00 = 90 นาที < ขั้นต่ำ 120
    expect((await patch(alice.c, `/api/groups/${gid}`, { freeWindowStartMin: 1080, freeWindowEndMin: 1380, minFreeMinutes: 60 })).status).toBe(200);
    const r = await avail(bob, '2026-11-03');
    expect(segs(day(r, '2026-11-03'))).toEqual(['18:00-19:00', '20:30-23:00']);
    expect(r.data.group).toMatchObject({ windowStartMin: 1080, windowEndMin: 1380, minFreeMinutes: 60 });
    // busy 08:00–10:00 ตอนนี้อยู่นอกหน้าต่าง → ไม่ใช่ blocker
    await timed(bob, '2026-11-04', '08:00', '10:00');
    expect(day(await avail(bob, '2026-11-04'), '2026-11-04').blockers).toEqual([]);
  });
});

describe('สมาชิก ณ ตอนนี้ (ADR 0005 §1 · T15/T16)', () => {
  it('T15: B (ทั้งวัน) ออกจากกลุ่ม → นับ 2/2 ว่างร่วมทันที · B ไม่อยู่ใน members/blockers/notFree', async () => {
    await allDay(bob, '2026-11-05');
    const before = day(await avail(alice, '2026-11-05'), '2026-11-05');
    expect([before.freeMembers, before.totalMembers, before.allFree]).toEqual([2, 3, false]);
    expect((await post(bob.c, `/api/groups/${gid}/leave`)).status).toBe(200);
    const r = await avail(alice, '2026-11-05');
    const d = day(r, '2026-11-05');
    expect([d.freeMembers, d.totalMembers, d.allFree, segs(d), d.blockers, d.notFreeUserIds]).toEqual([2, 2, true, ['08:00-22:00'], [], []]);
    expect(r.data.members.map((m) => m.userId)).not.toContain(bob.id);
    expect((await avail(bob, '2026-11-05')).status).toBe(404);
    // ถูกนำออกโดย admin ก็เช่นกัน
    await allDay(carol, '2026-11-06');
    expect((await del(alice.c, `/api/groups/${gid}/members/${carol.id}`)).status).toBe(200);
    const d2 = day(await avail(alice, '2026-11-06'), '2026-11-06');
    expect([d2.freeMembers, d2.totalMembers, d2.allFree]).toEqual([1, 1, true]);
  });

  it('คนที่เพิ่งเข้าถูกนับทุกวัน รวมวันอดีต', async () => {
    const dave = await person(h, 'dave');
    expect((await allDay(dave, '2026-10-14')).status).toBe(201);
    await join(alice, dave, gid);
    const d = day(await avail(alice, '2026-10-14'), '2026-10-14');
    expect([d.freeMembers, d.totalMembers, d.notFreeUserIds]).toEqual([3, 4, [dave.id]]);
  });

  it('T16: super admin ไม่ใช่สมาชิก (busy ทั้งวัน) ไม่ถูกนับ ไม่อยู่ใน members/blockers · แต่ audit การอ่าน; สมาชิกธรรมดาไม่ audit', async () => {
    await allDay(boss, '2026-11-07');
    expect(await h.count("audit_log WHERE action = 'group.availability.view'")).toBe(0);
    await avail(alice, '2026-11-07');
    expect(await h.count("audit_log WHERE action = 'group.availability.view'")).toBe(0);
    const r = await avail(boss, '2026-11-07');
    expect(r.status).toBe(200);
    const d = day(r, '2026-11-07');
    expect([d.freeMembers, d.totalMembers, d.allFree, segs(d), d.blockers]).toEqual([3, 3, true, ['08:00-22:00'], []]);
    expect(r.data.members.map((m) => m.userId)).not.toContain(boss.id);
    expect(r.text).not.toContain(boss.id);
    const rows = await h.rows<{ actor_id: string; group_id: string; target_type: string; meta: string }>("SELECT actor_id, group_id, target_type, meta FROM audit_log WHERE action = 'group.availability.view'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: boss.id, group_id: gid, target_type: 'group' });
    expect(JSON.parse(rows[0]!.meta)).toEqual({ from: '2026-11-07', to: '2026-11-07', asSuperAdmin: true });
  });
});

describe('RBAC / สถานะบัญชี / ช่วงวันที่', () => {
  it('คนนอก → 404 NOT_FOUND ตัวเดียวกับกลุ่มที่ไม่มีอยู่ (ช่วงผิดก็ไม่เป็น oracle) · anonymous → 401', async () => {
    await allDay(bob, '2026-11-02', '2026-11-02', { title: CX });
    const r = await avail(out, '2026-11-02');
    const ghost = await avail(out, '2026-11-02', '2026-11-02', '00000000-0000-4000-8000-00000000dead');
    expect([r.status, r.code]).toEqual([404, 'NOT_FOUND']);
    expect(r.text).toBe(ghost.text);
    expect(r.text).not.toContain('CANARY');
    expect((await get(out.c, `/api/groups/${gid}/availability?from=2026-13-01&to=2026-10-01`)).status).toBe(404);
    const anon = await get(new Client(), url(gid, '2026-11-02'));
    expect([anon.status, anon.code]).toEqual([401, 'AUTH_REQUIRED']);
  });

  it('กลุ่มถูกลบ → 404 ทุกคน รวมสมาชิกเดิมและ super admin · ไม่ audit', async () => {
    expect((await del(alice.c, `/api/groups/${gid}`)).status).toBe(200);
    for (const who of [alice, bob, boss]) {
      const r = await avail(who, '2026-11-02');
      expect([r.status, r.code]).toEqual([404, 'NOT_FOUND']);
    }
    expect(await h.count("audit_log WHERE action = 'group.availability.view'")).toBe(0);
  });

  it('must_change_pin → 403 PIN_CHANGE_REQUIRED · suspended → 401 ACCOUNT_SUSPENDED', async () => {
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [alice.id]);
    const a = await avail(alice, '2026-11-02');
    expect([a.status, a.code]).toEqual([403, 'PIN_CHANGE_REQUIRED']);
    await h.rows("UPDATE user SET must_change_pin = 0, status = 'suspended' WHERE id = ?", [bob.id]);
    const s = await avail(bob, '2026-11-02');
    expect([s.status, s.code]).toEqual([401, 'ACCOUNT_SUSPENDED']);
  });

  it('ช่วง 62 วันพอดีผ่าน · 63 วัน → 400 VALIDATION fields.to=RANGE_TOO_LARGE · สลับ/ผิด/ขาด/พารามิเตอร์แปลก → VALIDATION พร้อม fields', async () => {
    const ok = await avail(alice, '2026-10-01', '2026-12-01');
    expect([ok.status, ok.data.days.length]).toEqual([200, 62]);
    const bad = await avail(alice, '2026-10-01', '2026-12-02');
    expect([bad.status, bad.code]).toEqual([400, 'VALIDATION']);
    expect(bad.json.error?.params).toEqual({ fields: { to: 'RANGE_TOO_LARGE' } });
    const field = async (q: string) => {
      const r = await get(alice.c, `/api/groups/${gid}/availability?${q}`);
      expect(r.status, q).toBe(400);
      expect(r.code, q).toBe('VALIDATION');
      return r.json.error?.params;
    };
    expect(await field('from=2026-10-10&to=2026-10-09')).toEqual({ fields: { to: 'BEFORE_FROM' } });
    expect(await field('from=2026-02-30&to=2026-03-01')).toEqual({ fields: { from: 'INVALID' } });
    expect(await field('from=2026-10-01&to=bad')).toEqual({ fields: { to: 'INVALID' } });
    expect(await field('from=2026-10-01')).toEqual({ fields: { to: 'REQUIRED' } });
    expect(await field('to=2026-10-01')).toEqual({ fields: { from: 'REQUIRED' } });
    await field('');
    await field(`from=2026-10-01&to=2026-10-02&userId=${bob.id}`);
    await field('from=2569-10-01&to=2569-10-02');
  });

  it('manifest: route ลงทะเบียนด้วย action group.availability.view · no-store ทั้ง 200 และ error', async () => {
    const e = ROUTE_MANIFEST.find((x) => x.path === '/api/groups/:gid/availability')!;
    expect([e.method, e.action, e.auth, e.owner]).toEqual(['GET', 'group.availability.view', 'actor', 'platform']);
    for (const r of [await avail(alice, '2026-11-02'), await avail(out, '2026-11-02'), await get(alice.c, `/api/groups/${gid}/availability?from=x&to=y`)]) {
      expect(r.headers.get('cache-control')).toBe('private, no-store');
    }
  });
});

describe('ADR 0006 canary — availability ไม่รั่ว note / title ที่ซ่อน (R4A-4)', () => {
  beforeEach(async () => {
    await timed(bob, '2026-11-12', '10:00', '12:00', { title: CT, note: `${CN}-1` }); // ไม่ซ่อน
    await timed(bob, '2026-11-12', '14:00', '16:00', { title: CH, note: `${CN}-2`, hideDetail: true }); // ซ่อน (timed)
    await allDay(carol, '2026-11-12', '2026-11-13', { title: `${CH}-D`, note: `${CN}-3`, hideDetail: true }); // ซ่อน (ทั้งวัน)
    await allDay(out, '2026-11-12', '2026-11-12', { title: CX, note: CX }); // คนนอกกลุ่ม
  });

  it('ทุกผู้ดู (สมาชิกคนอื่น / เจ้าของเอง / admin / super admin): ไม่มี CANARY-N, ไม่มี title ซ่อน, ไม่มีของคนนอก · เห็น CANARY-T ที่ไม่ซ่อน', async () => {
    for (const [label, who] of [['viewer สมาชิก', alice], ['เจ้าของ busy', bob], ['เจ้าของ busy ทั้งวัน', carol], ['super admin', boss]] as const) {
      const r = await avail(who, '2026-11-12', '2026-11-13');
      expect(r.status, label).toBe(200);
      expect(r.text, label).toContain(CT);
      for (const needle of [CN, 'CANARY-N', CH, 'CANARY-H', CX]) expect(r.text, `${label} ${needle}`).not.toContain(needle);
      expect(JSON.stringify([...r.headers.entries()])).not.toContain('CANARY');
      const items = itemsOf(r, day(r, '2026-11-12'));
      expect(items).toHaveLength(3);
      for (const it of items) {
        expect('note' in it).toBe(false);
        if (it.id !== items.find((x) => 'title' in x)!.id) expect('title' in it, `${label} ${it.id}`).toBe(false); // ซ่อน → ไม่มีฟิลด์ (ไม่ใช่ null/"")
      }
      expect(items.filter((x) => 'title' in x)).toHaveLength(1);
    }
  });

  it('รายการที่ไม่กรอก title หน้าตาเหมือนรายการซ่อน (X28)', async () => {
    await timed(alice, '2026-11-14', '10:00', '11:00');
    await timed(alice, '2026-11-14', '12:00', '13:00', { title: CH, hideDetail: true });
    const r14 = await avail(bob, '2026-11-14');
    const items = itemsOf(r14, day(r14, '2026-11-14'));
    expect(items).toHaveLength(2);
    expect(Object.keys(items[0]!).sort()).toEqual(Object.keys(items[1]!).sort());
  });

  it('ถอด/เปลี่ยน hideDetail มีผลทันทีโดยไม่มี cache · คนนอกกลุ่มไม่เห็น CANARY-T', async () => {
    const before = await avail(alice, '2026-11-12');
    expect(before.text).not.toContain(CH);
    const hidden = (await h.rows<{ id: string }>("SELECT id FROM busy_block WHERE title = ?", [CH]))[0]!.id;
    await call(bob.c, 'PATCH', `/api/me/busy/${hidden}`, { hideDetail: false });
    expect((await avail(alice, '2026-11-12')).text).toContain(CH);
    expect((await avail(out, '2026-11-12')).text).not.toContain('CANARY');
  });

  it('SQL ที่ใช้ดึง busy (ช่วงที่ service คำนวณ) ไม่มีคอลัมน์ note · ตัด title ซ่อนใน SQL · ผลจริงไม่มีคีย์ note/ไม่มี title ซ่อน', async () => {
    const { fromMs, toMs } = availabilityFetchRange({ from: '2026-11-12', to: '2026-11-13' }, { tz: 'Asia/Bangkok', freeWindowStartMin: 480, freeWindowEndMin: 1320 });
    const q = sharedBusyInGroupQuery(h.db, gid, fromMs, toMs, 5001).toSQL();
    expect(q.sql).not.toMatch(/note/i);
    expect(q.sql).toMatch(/CASE WHEN "busy_block"\."hide_detail" = 0 THEN "busy_block"\."title" ELSE NULL END/);
    expect(q.params).toEqual(expect.arrayContaining([gid, fromMs, toMs, 5001]));
    const rows = await sharedBusyInGroupQuery(h.db, gid, fromMs, toMs, 5001);
    for (const r of rows) expect('note' in r).toBe(false);
    expect(JSON.stringify(rows)).not.toMatch(/CANARY-[NH]/);
  });

  it('ช่วงดึง = หน้าต่างวันแรกต้น − margin … หน้าต่างวันสุดท้ายปลาย + margin (margin 26 ชม. เผื่อ tz เจ้าของ ±)', () => {
    const r = availabilityFetchRange({ from: '2026-11-12', to: '2026-11-13' }, { tz: 'Asia/Bangkok', freeWindowStartMin: 480, freeWindowEndMin: 1320 });
    expect(r.fromMs).toBe(Date.UTC(2026, 10, 12, 1) - AVAILABILITY_FETCH_MARGIN_MS);
    expect(r.toMs).toBe(Date.UTC(2026, 10, 13, 15) + AVAILABILITY_FETCH_MARGIN_MS);
    expect(AVAILABILITY_FETCH_MARGIN_MS).toBe(26 * 3600_000);
  });

  it('EXPLAIN QUERY PLAN: คิวรีใช้ดัชนี busy_user_*_idx (ไม่สแกนทั้งตาราง busy_block)', async () => {
    const { fromMs, toMs } = availabilityFetchRange({ from: '2026-11-01', to: '2026-12-01' }, { tz: 'Asia/Bangkok', freeWindowStartMin: 480, freeWindowEndMin: 1320 });
    const q = sharedBusyInGroupQuery(h.db, gid, fromMs, toMs, 5001).toSQL();
    const plan = await h.db.$client.execute({ sql: `EXPLAIN QUERY PLAN ${q.sql}`, args: q.params as never[] });
    const detail = plan.rows.map((r) => String((r as unknown as { detail: string }).detail)).join('\n');
    console.log(`EXPLAIN availability busy query:\n${detail}`);
    expect(detail).toMatch(/SEARCH busy_block USING (COVERING )?INDEX busy_user_(start|end)_idx \(user_id=\? AND (start_at|end_at)[<>]\?/);
    expect(detail).not.toMatch(/SCAN busy_block/);
  });

  it('M1/M3: busy หลายวันถูกส่งครั้งเดียว — all-day 5 วัน → 1 รายการใน busy, 5 วันอ้าง id เดียวกัน', async () => {
    const id = (await allDay(bob, '2026-11-02', '2026-11-06')).data.busy.id;
    const r = await avail(alice, '2026-11-01', '2026-11-10');
    expect(r.data.busy.map((b) => b.id)).toEqual([id]);
    const refs = r.data.days.filter((d) => d.blockers.length > 0);
    expect(refs.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    for (const d of refs) expect(d.blockers).toEqual([{ userId: bob.id, itemIdx: [0] }]);
  });

  /** แทรก n แถว busy ของ owner ใน 2026-11-20 (09:00 BKK เป็นต้นไป · เริ่มไม่ซ้ำ · เว้น 1 วินาที — 32,001 แถวยังอยู่ในวันเดียว) ด้วย recursive CTE ครั้งเดียว */
  const bulkBusy = (ownerId: string, n: number) =>
    h.rows(
      `WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n < ${n}) INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) SELECT 'cap-' || printf('%06d', n), ?, NULL, NULL, 0, ? + n * 1000, ? + n * 1000 + 500, '2026-11-20', '2026-11-20', 'Asia/Bangkok', 0, 1, 1 FROM c`,
      [ownerId, Date.UTC(2026, 10, 20, 2), Date.UTC(2026, 10, 20, 2)],
    );

  it('R14 B11: availability ใช้เพดานคำนวณ FREE_TIME_MAX_ITEMS — CALENDAR_MAX_ITEMS+1 แถว → truncated=false · พอดีเพดาน → false · FREE_TIME_MAX_ITEMS+1 → true (ยังตอบ 200)', async () => {
    expect(FREE_TIME_MAX_ITEMS).toBeGreaterThan(CALENDAR_MAX_ITEMS);
    await bulkBusy(alice.id, CALENDAR_MAX_ITEMS + 1);
    const over = await avail(bob, '2026-11-20');
    expect([over.status, over.data.truncated, over.data.detailTruncated]).toEqual([200, false, true]); // คำนวณจากครบ · รายละเอียดที่ส่ง (busy[]) ตัดที่ CALENDAR_MAX_ITEMS
    expect(over.data.busy).toHaveLength(CALENDAR_MAX_ITEMS);
    await h.rows("DELETE FROM busy_block WHERE id LIKE 'cap-%'");
    await bulkBusy(alice.id, FREE_TIME_MAX_ITEMS);
    expect((await avail(bob, '2026-11-20')).data.truncated).toBe(false);
    await h.rows("DELETE FROM busy_block WHERE id LIKE 'cap-%'");
    await bulkBusy(alice.id, FREE_TIME_MAX_ITEMS + 1);
    const r = await avail(bob, '2026-11-20');
    expect([r.status, r.data.truncated, r.data.detailTruncated]).toEqual([200, true, true]);
    const quiet = await avail(bob, '2026-11-25');
    expect([quiet.data.truncated, quiet.data.detailTruncated]).toEqual([false, false]);
  }, 60_000);

  it('R14 B11: appointments/check — busy เกิน FREE_TIME_MAX_ITEMS → overlap.status = unknown · พอดีเพดาน → ok', async () => {
    const slot = { startDate: '2026-11-20', startTime: '09:00', endDate: '2026-11-20', endTime: '10:00' };
    const check = () => post<{ overlap: { status: string; blocked: unknown[] } }>(bob.c, `/api/groups/${gid}/appointments/check`, slot);
    await bulkBusy(alice.id, FREE_TIME_MAX_ITEMS);
    const exact = await check();
    expect([exact.status, exact.data.overlap.status]).toEqual([200, 'ok']);
    expect(exact.data.overlap.blocked).toHaveLength(1);
    await h.rows("DELETE FROM busy_block WHERE id LIKE 'cap-%'");
    await bulkBusy(alice.id, FREE_TIME_MAX_ITEMS + 1);
    const over = await check();
    expect([over.status, over.data.overlap.status]).toEqual([200, 'unknown']);
  }, 60_000);
});

describe('M1/M3 — ขนาด response ไม่พองตามจำนวนวัน', () => {
  it('M1: สมาชิกคนเดียว 300 แถว all-day ยาว 366 วัน ช่วง 62 วัน → JSON < 300 KiB (เดิม 4–9 MB)', async () => {
    const start = Date.UTC(2026, 10, 1) - 7 * 3600_000; // 2026-11-01 00:00 BKK
    const end = start + 366 * 86_400_000;
    for (let i = 0; i < 300; i += 100) {
      const stmts: string[] = [];
      const args: (string | number)[] = [];
      for (let j = i; j < i + 100; j++) {
        stmts.push("(?, ?, ?, ?, 1, ?, ?, '2026-11-01', '2027-10-31', 'Asia/Bangkok', 0, 1, 1)");
        args.push(`7b0f6b5e-8f55-4a3e-9c1d-${String(j).padStart(12, '0')}`, bob.id, `t${j}`, `NOTE-CANARY-${j}`, start, end);
      }
      await h.rows(`INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${stmts.join(',')}`, args);
    }
    const r = await avail(alice, '2026-11-01', '2027-01-01');
    expect(r.status).toBe(200);
    expect(r.data.days).toHaveLength(62);
    expect(r.data.busy).toHaveLength(300);
    expect(r.data.days.every((d) => d.blockers.length === 1 && d.blockers[0]!.itemIdx.length === 300)).toBe(true);
    const bytes = Buffer.byteLength(r.text);
    console.log(`availability size (1 member x 300 all-day x 366d, 62-day range): ${(bytes / 1024).toFixed(1)} KiB`);
    expect(bytes).toBeLessThan(300 * 1024);
    expect(r.text).not.toContain('NOTE-CANARY');
  });
});
