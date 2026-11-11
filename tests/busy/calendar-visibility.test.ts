// R3 Platform — ปฏิทินกลุ่ม + การมองเห็น busy (ADR 0006 Test requirements 1–10) · R3-4, R3-5
// เทคนิค canary: seed busy ที่มี title/note เป็นสตริงสุ่มเฉพาะตัว แล้วค้น "ตัว body ดิบ" ของทุก endpoint ที่คนอื่นเรียกได้
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { sharedBusyInGroupQuery } from '@/lib/data/repos/busy';
import { BUSY_SHARED_FIELDS, toBusyForViewers, toBusyOwnView, type BusyHiddenView, type BusyOwnView, type BusySharedView } from '@/lib/data/serializers/busy';
import { memberColorIndex } from '@/lib/shared/member-color';
import { Client, call, del, get, join, makeGroup, person, post, setupHarness, type Harness, type Person, type Res } from '../groups/harness';

const rand = () => randomBytes(6).toString('hex');
const CT = `CANARY-T-${rand()}`; // title ของรายการที่ไม่ซ่อน — เพื่อนเห็นได้
const CH = `CANARY-H-${rand()}`; // title ของรายการที่ซ่อน — ห้ามหลุดให้ใคร (ยกเว้นเจ้าของ)
const CN = `CANARY-N-${rand()}`; // note — ห้ามหลุดให้ใครนอกจากเจ้าของ
const CX = `CANARY-X-${rand()}`; // busy ของคนนอกทุกกลุ่ม

let h: Harness;
let admin: Person; // admin G1 และสมาชิก G2
let owner: Person; // O: อยู่ G1 และ G2
let viewer: Person; // V: อยู่ G1 เท่านั้น
let p2: Person; // P: อยู่ G2 เท่านั้น (admin G2)
let out: Person; // ไม่อยู่กลุ่มไหน
let boss: Person; // super admin ไม่ใช่สมาชิก
let g1: string;
let g2: string;
let visibleId: string;
let hiddenId: string;

type Busy = Record<string, unknown> & { id: string; userId: string };
type Cal = { group: { id: string; tz: string }; from: string; to: string; members: { userId: string; displayName: string; colorIndex: number; shapeIndex: number }[]; busy: Busy[]; truncated: boolean };

const RANGE = 'from=2026-10-01&to=2026-10-31';
const calUrl = (g: string, q = RANGE) => `/api/groups/${g}/calendar?${q}`;
const mk = (p: Person, body: Record<string, unknown>) => post<{ busy: { id: string } }>(p.c, '/api/me/busy', body);

beforeEach(async () => {
  h = await setupHarness();
  [admin, owner, viewer, p2, out, boss] = [
    await person(h, 'alice'),
    await person(h, 'olive'),
    await person(h, 'vic'),
    await person(h, 'pat'),
    await person(h, 'nina'),
    await person(h, 'boss', { admin: true }),
  ];
  g1 = await makeGroup(admin, 'กลุ่มหนึ่ง');
  await join(admin, owner, g1);
  await join(admin, viewer, g1);
  g2 = await makeGroup(p2, 'กลุ่มสอง');
  await join(p2, owner, g2);
  await join(p2, admin, g2);
  // O: รายการไม่ซ่อน (title+note) · รายการซ่อน (title+note)
  const v = await mk(owner, { kind: 'timed', startDate: '2026-10-23', startTime: '18:00', endDate: '2026-10-23', endTime: '20:00', title: CT, note: `${CN}-1`, hideDetail: false });
  const hd = await mk(owner, { kind: 'all_day', startDate: '2026-10-24', endDate: '2026-10-25', title: CH, note: `${CN}-2`, hideDetail: true });
  expect([v.status, hd.status]).toEqual([201, 201]);
  visibleId = v.data.busy.id;
  hiddenId = hd.data.busy.id;
  // คนนอกทุกกลุ่ม + P (G2 เท่านั้น) มี busy เหมือนกัน — ต้องไม่โผล่ใน G1
  await mk(out, { kind: 'all_day', startDate: '2026-10-23', endDate: '2026-10-23', title: CX, note: CX });
  await mk(p2, { kind: 'all_day', startDate: '2026-10-23', endDate: '2026-10-23', title: `${CX}-P`, note: CX });
});
afterEach(async () => {
  await h.cleanup();
});

const cal = (p: Person, g: string, q = RANGE) => get<Cal>(p.c, calUrl(g, q));
const leaks = (r: Res, ...needles: string[]) => needles.filter((n) => r.text.includes(n));

// response schema แบบ strict — ฟิลด์เกินแล้วล้ม (ADR 0006 test 8)
const base = {
  kind: z.literal('busy'), // R6D (ADR 0009 §2): ทุกชิ้นมี kind
  id: z.uuid(),
  userId: z.uuid(),
  allDay: z.boolean(),
  startAt: z.number().int(),
  endAt: z.number().int(),
  localStartDate: z.string(),
  localEndDate: z.string(),
  tz: z.string(),
};
const hiddenViewSchema = z.object(base).strict();
const sharedViewSchema = z.object({ ...base, title: z.string().min(1) }).strict();
const calendarSchema = z
  .object({
    group: z.object({ id: z.uuid(), tz: z.string() }).strict(),
    from: z.string(),
    to: z.string(),
    members: z.array(z.object({ userId: z.uuid(), displayName: z.string(), colorIndex: z.number().int().min(0).max(9), shapeIndex: z.number().int().min(0).max(9) }).strict()),
    busy: z.array(z.union([sharedViewSchema, hiddenViewSchema])),
    truncated: z.boolean(),
  })
  .strict();

describe('ADR 0006 ข้อ 1 — สมาชิกเห็นผ่านกลุ่ม: title ที่ไม่ซ่อน · ไม่มี note · รายการซ่อนเหลือเวลาเท่านั้น', () => {
  it('V ใน G1: เห็น CANARY-T, ไม่เห็น CANARY-H, ไม่เห็น CANARY-N แม้แต่ครั้งเดียว · รูปร่างตรง schema strict', async () => {
    const r = await cal(viewer, g1);
    expect(r.status).toBe(200);
    expect(leaks(r, CH, CN, 'CANARY-N', CX)).toEqual([]);
    expect(r.text).toContain(CT);
    const body = calendarSchema.parse(r.json.data);
    expect(body.busy.map((b) => b.id)).toEqual([visibleId, hiddenId]);
    const hidden = r.data.busy.find((b) => b.id === hiddenId)!;
    expect(Object.keys(hidden).sort()).toEqual(['allDay', 'endAt', 'id', 'kind', 'localEndDate', 'localStartDate', 'startAt', 'tz', 'userId']); // R6D: + kind
    expect('title' in hidden).toBe(false); // ไม่ใช่ null หรือ ""
    expect(hidden).toMatchObject({ allDay: true, localStartDate: '2026-10-24', localEndDate: '2026-10-25', userId: owner.id });
    const shown = r.data.busy.find((b) => b.id === visibleId)!;
    expect(Object.keys(shown).sort()).toEqual([...BUSY_SHARED_FIELDS].sort());
    expect(shown.title).toBe(CT);
  });

  it('เจ้าของเองดูผ่านปฏิทินกลุ่ม = เท่าที่เพื่อนเห็น (ไม่มี note ไม่มี hidden) · ดูของตัวเองครบที่ /api/me/busy', async () => {
    const viaGroup = await cal(owner, g1);
    expect(leaks(viaGroup, CH, CN)).toEqual([]);
    const mine = await get<{ busy: BusyOwnView[] }>(owner.c, '/api/me/busy');
    expect(mine.data.busy.map((b) => [b.title, b.note, b.hidden])).toEqual([
      [CT, `${CN}-1`, false],
      [CH, `${CN}-2`, true],
    ]);
  });

  it('item ที่ไม่ได้กรอก title หน้าตาเหมือนรายการซ่อน (UX X28 — ไม่รั่วว่าซ่อนหรือไม่ได้กรอก)', async () => {
    const plain = await mk(owner, { kind: 'all_day', startDate: '2026-10-26', endDate: '2026-10-26' });
    const r = await cal(viewer, g1);
    const a = r.data.busy.find((b) => b.id === plain.data.busy.id)!;
    const b = r.data.busy.find((x) => x.id === hiddenId)!;
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it('สมาชิกแสดงชื่อ + สีประจำตัวของกลุ่มนี้ · ผู้ดูก่อน · คนนอกกลุ่มไม่อยู่ในรายการ', async () => {
    const r = await cal(viewer, g1);
    const ids = r.data.members.map((m) => m.userId);
    expect(ids[0]).toBe(viewer.id);
    expect(ids.sort()).toEqual([admin.id, owner.id, viewer.id].sort());
    for (const m of r.data.members) expect([m.colorIndex, m.shapeIndex]).toEqual([memberColorIndex(g1, m.userId), memberColorIndex(g1, m.userId)]); // R6C-1
    expect(r.data.members.find((m) => m.userId === owner.id)!.displayName).toBe(owner.displayName);
    expect(r.text).not.toContain(p2.id);
    expect(r.text).not.toContain(out.id);
    expect(r.data.group).toEqual({ id: g1, tz: 'Asia/Bangkok' });
  });
});

describe('ADR 0006 canary — ทุก endpoint ที่คนอื่นเรียกได้ (R3-4)', () => {
  const actorsOf = () => [
    ['viewer (สมาชิก)', viewer],
    ['admin กลุ่ม', admin],
    ['คนนอก', out],
    ['super admin ไม่ใช่สมาชิก', boss],
    ['P (กลุ่มอื่น)', p2],
  ] as const;

  /** ทุก GET ใน manifest ที่เป็น actor + PATCH/DELETE ของ busy คนอื่น · แทน path param ด้วยค่าจริงของ fixture */
  function surface(): { method: 'GET' | 'PATCH' | 'DELETE'; path: string; body?: unknown }[] {
    const fill = (p: string) =>
      p.replace(':gid', g1).replace(':uid', owner.id).replace(':iid', hiddenId).replace(':id', hiddenId);
    const gets = ROUTE_MANIFEST.filter((e) => e.method === 'GET' && e.auth === 'actor').map((e) => {
      const path = fill(e.path);
      return { method: 'GET' as const, path: path.endsWith('/calendar') ? `${path}?${RANGE}` : path };
    });
    return [
      ...gets,
      { method: 'GET', path: `/api/me/busy?${RANGE}` },
      { method: 'PATCH', path: `/api/me/busy/${hiddenId}`, body: { title: 'x' } },
      { method: 'DELETE', path: `/api/me/busy/${visibleId}` },
    ];
  }

  it('ไม่มี CANARY-N / CANARY-H (และ CANARY-X ของคนนอก) ในไบต์ใดของ response ของทุก endpoint × ทุกผู้เรียกที่ไม่ใช่เจ้าของ', async () => {
    const seen = new Set<string>();
    let n = 0;
    for (const [label, who] of actorsOf()) {
      for (const s of surface()) {
        const r = await call(who.c, s.method, s.path, s.body);
        n++;
        seen.add(`${s.method} ${s.path.split('?')[0]}`);
        expect(leaks(r, CN, 'CANARY-N', CH), `${label} ${s.method} ${s.path}`).toEqual([]);
        // รวมหัวและ cookie ด้วย
        expect(JSON.stringify([...r.headers.entries()]), `${label} headers ${s.path}`).not.toContain('CANARY');
      }
    }
    expect(n).toBeGreaterThan(40);
    expect([...seen]).toContain('GET /api/groups/:gid/calendar'.replace(':gid', g1));
    // รายการของ O ยังอยู่ครบ (PATCH/DELETE ของคนอื่นไม่ได้ผล)
    expect(await h.count('busy_block WHERE user_id = ?', [owner.id])).toBe(2);
  });

  it('คนนอกกลุ่มไม่เห็น CANARY-T ด้วย · P ผ่าน G1 ไม่ได้ · และ log ของ server ไม่มี canary', async () => {
    const logs: string[] = [];
    const sinks = (['log', 'error', 'warn', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' '))));
    try {
      for (const who of [out, p2, viewer, boss, admin]) {
        const r = await cal(who, g1);
        if (who === out || who === p2) expect(leaks(r, CT, CH, CN)).toEqual([]);
      }
      await mk(owner, { kind: 'all_day', startDate: '2026-10-26', endDate: '2026-10-26', title: CT, note: `${CN}-bad`, hideDetail: 'x' }); // ผิด → error path
      await mk(owner, { kind: 'timed', startDate: '2026-10-26', endDate: '2026-10-26', startTime: '18:07', endTime: '19:00', title: CT, note: `${CN}-bad2` });
    } finally {
      for (const s of sinks) s.mockRestore();
    }
    expect(logs.join('\n')).not.toMatch(/CANARY/);
  });

  it('error response ของการลงที่ผิดไม่สะท้อน title/note/ค่าที่ส่งมา', async () => {
    const r = await mk(owner, { kind: 'timed', startDate: '2026-10-26', endDate: '2026-10-26', startTime: '18:07', endTime: '19:00', title: CT, note: `${CN}-e`, extra: CX });
    expect(r.status).toBe(400);
    expect(leaks(r, CT, CN, CX)).toEqual([]);
    const r2 = await mk(owner, { kind: 'timed', startDate: '2026-10-26', endDate: '2026-10-26', startTime: '18:07', endTime: '19:00', title: CT, note: `${CN}-e2` });
    expect(r2.code).toBe('TIME_NOT_ON_STEP');
    expect(leaks(r2, CT, CN)).toEqual([]);
  });
});

describe('ADR 0006 ข้อ 2–5 — ใครเห็นผ่านกลุ่มไหน', () => {
  it('คนนอก (ล็อกอิน ไม่อยู่ G1) → 404 NOT_FOUND ตัวเดียวกับกลุ่มที่ไม่มีอยู่ และ body ไม่มี CANARY', async () => {
    const r = await cal(out, g1);
    const ghost = await cal(out, '00000000-0000-4000-8000-00000000dead');
    expect([r.status, r.code]).toEqual([404, 'NOT_FOUND']);
    expect(r.text).toBe(ghost.text);
    expect(r.text).not.toContain('CANARY');
    // ช่วงผิดก็ไม่เป็น oracle: คนนอกที่ส่งช่วงผิดได้ 404 เช่นกัน
    expect((await cal(out, g1, 'from=2026-13-01&to=2026-10-01')).status).toBe(404);
  });

  it('ข้ามกลุ่ม: O อยู่ G1+G2 · V (G1) เห็น O ผ่าน G1 แต่ G2 → 404 · P (G2) เห็น O ผ่าน G2 แต่ G1 → 404 · P ไม่ปรากฏใน G1 เลย', async () => {
    expect((await cal(viewer, g2)).status).toBe(404);
    const viaG2 = await cal(p2, g2);
    expect(viaG2.status).toBe(200);
    expect(viaG2.data.busy.map((b) => b.id).sort()).toEqual([visibleId, hiddenId, ...viaG2.data.busy.filter((b) => b.userId === p2.id).map((b) => b.id)].sort());
    expect(leaks(viaG2, CN, CH)).toEqual([]);
    expect((await cal(p2, g1)).status).toBe(404);
    const g1Body = await cal(admin, g1);
    expect(g1Body.data.busy.map((b) => b.userId)).not.toContain(p2.id);
    expect(g1Body.data.members.map((m) => m.userId)).not.toContain(p2.id);
    expect(g1Body.text).not.toContain(`${CX}`);
  });

  it('D5: รายการเดียวของ O เห็นได้ในทุกกลุ่มที่ผู้ดูอยู่ร่วมกับ O (admin อยู่ทั้ง G1 และ G2)', async () => {
    const a1 = await cal(admin, g1);
    const a2 = await cal(admin, g2);
    for (const r of [a1, a2]) expect(r.data.busy.filter((b) => b.userId === owner.id).map((b) => b.id)).toEqual([visibleId, hiddenId]);
  });

  it('ถอดออก (U6): V ถูกนำออก → /calendar ทันที 404 · O ออกจาก G1 → busy ของ O หายจาก G1 ทันที (ยังอยู่ใน G2)', async () => {
    expect((await cal(viewer, g1)).status).toBe(200);
    expect((await del(admin.c, `/api/groups/${g1}/members/${viewer.id}`)).status).toBe(200);
    expect((await cal(viewer, g1)).status).toBe(404);

    expect((await cal(admin, g1)).data.busy.map((b) => b.userId)).toContain(owner.id);
    expect((await post(owner.c, `/api/groups/${g1}/leave`)).status).toBe(200);
    const after = await cal(admin, g1);
    expect(after.data.busy.map((b) => b.userId)).not.toContain(owner.id);
    expect(after.data.members.map((m) => m.userId)).not.toContain(owner.id);
    expect((await cal(owner, g1)).status).toBe(404);
    expect((await cal(p2, g2)).data.busy.map((b) => b.userId)).toContain(owner.id);
    expect(await h.count('busy_block WHERE user_id = ?', [owner.id])).toBe(2); // busy ผูกผู้ใช้ ไม่หายตามการออกกลุ่ม
  });

  it('กลุ่มถูกลบ (soft) → 404 สำหรับสมาชิกเดิมทุกคน', async () => {
    expect((await del(admin.c, `/api/groups/${g1}`)).status).toBe(200);
    for (const who of [admin, owner, viewer]) {
      const r = await cal(who, g1);
      expect([r.status, r.code]).toEqual([404, 'NOT_FOUND']);
    }
    expect((await cal(boss, g1)).status).toBe(404);
  });

  it('super admin ไม่ใช่สมาชิก: เห็นเวลา, รายการซ่อนไม่มี title, ไม่มี note · มีแถว audit_log (group.calendar.view) · สมาชิกธรรมดาไม่ audit', async () => {
    expect(await h.count("audit_log WHERE action = 'group.calendar.view'")).toBe(0);
    await cal(viewer, g1);
    await cal(admin, g1);
    expect(await h.count("audit_log WHERE action = 'group.calendar.view'")).toBe(0);
    const r = await cal(boss, g1);
    expect(r.status).toBe(200);
    expect(leaks(r, CH, CN)).toEqual([]);
    expect('title' in r.data.busy.find((b) => b.id === hiddenId)!).toBe(false);
    expect(r.text).toContain(CT);
    const rows = await h.rows<{ actor_id: string; group_id: string; target_type: string; meta: string }>("SELECT actor_id, group_id, target_type, meta FROM audit_log WHERE action = 'group.calendar.view'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: boss.id, group_id: g1, target_type: 'group' });
    expect(JSON.parse(rows[0]!.meta)).toEqual({ from: '2026-10-01', to: '2026-10-31', asSuperAdmin: true });
    expect(rows[0]!.meta).not.toMatch(/CANARY/);
  });

  it('super admin แก้/ลบ busy ของ O ไม่ได้ (404) และ /api/me/busy ของ SA เห็นแต่ของตัวเอง', async () => {
    expect((await call(boss.c, 'PATCH', `/api/me/busy/${visibleId}`, { title: 'x' })).status).toBe(404);
    expect((await del(boss.c, `/api/me/busy/${visibleId}`)).status).toBe(404);
    expect((await get<{ busy: unknown[] }>(boss.c, '/api/me/busy')).data.busy).toEqual([]);
  });

  it('เปลี่ยน hideDetail แล้วมีผลทันทีโดยไม่ต้องล้าง cache (title กลับมา / หายไป)', async () => {
    await call(owner.c, 'PATCH', `/api/me/busy/${hiddenId}`, { hideDetail: false });
    expect((await cal(viewer, g1)).text).toContain(CH);
    await call(owner.c, 'PATCH', `/api/me/busy/${visibleId}`, { hideDetail: true });
    const r = await cal(viewer, g1);
    expect(r.text).not.toContain(CT);
    expect(leaks(r, CN)).toEqual([]);
    await del(owner.c, `/api/me/busy/${hiddenId}`);
    expect((await cal(viewer, g1)).data.busy.map((b) => b.id)).toEqual([visibleId]);
  });
});

describe('ปฏิทินกลุ่ม — ช่วงวันที่ + header (R3-5, ADR 0006 ข้อ 10)', () => {
  it('Cache-Control: private, no-store ทั้ง 200 และ error', async () => {
    for (const r of [await cal(viewer, g1), await cal(out, g1), await cal(viewer, g1, 'from=x&to=y')]) {
      expect(r.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('ขอบเขตช่วง: รวมปลายทั้งสองข้าง · ครอบเฉพาะวันที่ทับ (all_day 24–25)', async () => {
    const ids = async (q: string) => (await cal(viewer, g1, q)).data.busy.map((b) => b.id);
    expect(await ids('from=2026-10-25&to=2026-10-25')).toEqual([hiddenId]);
    expect(await ids('from=2026-10-26&to=2026-10-26')).toEqual([]);
    expect(await ids('from=2026-10-23&to=2026-10-23')).toEqual([visibleId]);
    expect(await ids('from=2026-10-22&to=2026-10-24')).toEqual([visibleId, hiddenId]);
    expect(await ids('from=2026-10-24&to=2026-10-24')).toEqual([hiddenId]);
    expect(await ids('from=2026-09-01&to=2026-09-30')).toEqual([]);
  });

  it('ช่วง 62 วันพอดีผ่าน · 63 วัน/สลับ/วันที่ผิด/ขาดพารามิเตอร์/พารามิเตอร์แปลก → 400 VALIDATION', async () => {
    expect((await cal(viewer, g1, 'from=2026-10-01&to=2026-12-01')).status).toBe(200); // 62 วัน
    for (const q of [
      'from=2026-10-01&to=2026-12-02', // 63 วัน
      'from=2026-10-10&to=2026-10-09',
      'from=2026-02-30&to=2026-03-01',
      'from=2026-10-01',
      'to=2026-10-01',
      '',
      'from=2026-10-01&to=2026-10-02&userId=' + owner.id,
      'from=2569-10-01&to=2569-10-02', // พ.ศ.
      'from=2026-1-1&to=2026-1-2',
    ]) {
      const r = await cal(viewer, g1, q);
      expect([r.status, r.code], q).toEqual([400, 'VALIDATION']);
    }
  });

  it('เดือนกริด 42 วัน (monthGrid) ข้ามปี และปีอธิกสุรทิน ใช้ได้', async () => {
    await mk(owner, { kind: 'all_day', startDate: '2028-02-29', endDate: '2028-02-29', title: 'leap' });
    await mk(owner, { kind: 'all_day', startDate: '2026-12-31', endDate: '2027-01-01', title: 'ข้ามปี' });
    const leap = await cal(viewer, g1, 'from=2028-01-31&to=2028-03-12');
    expect(leap.data.busy.map((b) => b.localStartDate)).toEqual(['2028-02-29']);
    const year = await cal(viewer, g1, 'from=2026-12-28&to=2027-02-07');
    expect(year.data.busy).toHaveLength(1);
    expect(year.data.busy[0]).toMatchObject({ localStartDate: '2026-12-31', localEndDate: '2027-01-01', title: 'ข้ามปี' });
  });

  it('busy ข้ามเที่ยงคืนเห็นทั้งสองวัน (จบ 00:30) แต่จบ 00:00 พอดีไม่ล้ำไปวันถัดไป', async () => {
    await mk(owner, { kind: 'timed', startDate: '2026-11-03', startTime: '22:00', endDate: '2026-11-04', endTime: '00:30', title: 'ล้ำ' });
    await mk(owner, { kind: 'timed', startDate: '2026-11-10', startTime: '22:00', endDate: '2026-11-11', endTime: '00:00', title: 'พอดี' });
    const day = async (d: string) => (await cal(viewer, g1, `from=${d}&to=${d}`)).data.busy.map((b) => b.title);
    expect(await day('2026-11-03')).toEqual(['ล้ำ']);
    expect(await day('2026-11-04')).toEqual(['ล้ำ']);
    expect(await day('2026-11-10')).toEqual(['พอดี']);
    expect(await day('2026-11-11')).toEqual([]);
  });

  it('DST: busy ใน tz ที่มี DST ถูกจัดวันท้องถิ่นของ tz นั้น (New York 2026-11-01 01:30 EDT/EST)', async () => {
    const r = await mk(owner, { kind: 'timed', tz: 'America/New_York', startDate: '2026-11-01', startTime: '23:00', endDate: '2026-11-02', endTime: '01:00', title: 'NY' });
    expect(r.status).toBe(201);
    const c = await cal(viewer, g1, 'from=2026-11-02&to=2026-11-02');
    expect(c.data.busy[0]).toMatchObject({ tz: 'America/New_York', localStartDate: '2026-11-01', localEndDate: '2026-11-02' });
  });

  it('หลายรายการในวันเดียว: เรียงตามเวลาเริ่ม (ไม่ขึ้นกับลำดับที่ลง) และไม่มี note', async () => {
    const t0 = Date.UTC(2026, 9, 5);
    for (let i = 0; i < 12; i++) {
      await h.rows(
        "INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, '2026-10-05', '2026-10-05', 'Asia/Bangkok', 0, 1, 1)",
        [`6b0f6b5e-8f55-4a3e-9c1d-0000000000${String(i).padStart(2, '0')}`, viewer.id, `t${i}`, CN, t0 + (12 - i) * 3600_000, t0 + (12 - i) * 3600_000 + 1800_000],
      );
    }
    const r = await cal(admin, g1, 'from=2026-10-05&to=2026-10-05');
    const starts = r.data.busy.map((b) => b.startAt as number);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
    expect(r.data.busy).toHaveLength(12);
    expect(r.text).not.toContain(CN);
  });
});

describe('ADR 0006 test 8–9 — ระดับชนิดข้อมูล + SQL', () => {
  it('type-level: BusyHiddenView ไม่มี title/note · BusySharedView ไม่มี note · BusyOwnView มี note+title', () => {
    expectTypeOf<BusyHiddenView>().not.toHaveProperty('title');
    expectTypeOf<BusyHiddenView>().not.toHaveProperty('note');
    expectTypeOf<BusySharedView>().not.toHaveProperty('note');
    expectTypeOf<BusySharedView>().toHaveProperty('title');
    expectTypeOf<BusyOwnView>().toHaveProperty('note');
    expectTypeOf<BusyOwnView>().toHaveProperty('title');
  });

  it('serializer เป็น allowlist: ฟิลด์เกินที่แฝงมากับแถว (note, created_at, hideDetail) ไม่ถูกคัดลอกออก', () => {
    const row = {
      id: 'i', userId: 'u', allDay: false, startAt: 1, endAt: 2, localStartDate: '2026-10-23', localEndDate: '2026-10-23', tz: 'Asia/Bangkok', hideDetail: false, title: 'ok',
      note: CN, createdAt: 9, updatedAt: 9, pinHash: 'x',
    };
    const view = toBusyForViewers(row as never);
    expect(Object.keys(view).sort()).toEqual([...BUSY_SHARED_FIELDS].sort());
    expect(JSON.stringify(view)).not.toContain(CN);
    const hidden = toBusyForViewers({ ...row, hideDetail: true } as never);
    expect('title' in hidden).toBe(false);
    expect(Object.keys(hidden)).toHaveLength(9); // R6D: + kind
    // แม้ SQL ปล่อย title ของรายการซ่อนมา (สมมติบั๊ก) serializer ก็ตัดซ้ำ
    expect('title' in toBusyForViewers({ ...row, hideDetail: true, title: CH } as never)).toBe(false);
    // title ว่างหลังทำความสะอาด → ไม่มีฟิลด์
    expect('title' in toBusyForViewers({ ...row, title: '​' } as never)).toBe(false);
    expect(Object.keys(toBusyOwnView({ ...row, hideDetail: true, createdAt: 1, updatedAt: 1 } as never)).sort()).toEqual(
      ['allDay', 'endAt', 'hidden', 'id', 'localEndDate', 'localStartDate', 'note', 'routineId', 'seriesId', 'startAt', 'title', 'tz', 'userId'], // R6F (ADR 0010 §6): + seriesId (เจ้าของเท่านั้น)
    );
  });

  it('SQL ที่ Drizzle สร้างสำหรับฝั่งแชร์ไม่มีคอลัมน์ note และตัด title ของรายการซ่อนใน SQL', () => {
    const q = sharedBusyInGroupQuery(h.db, g1, Date.UTC(2026, 8, 30, 17), Date.UTC(2026, 9, 31, 17), 5001).toSQL();
    expect(q.sql).not.toMatch(/note/i);
    expect(q.sql).toMatch(/CASE WHEN "busy_block"\."hide_detail" = 0 THEN "busy_block"\."title" ELSE NULL END/);
    expect(q.sql).toMatch(/inner join "group_member"/i);
    expect(q.params).toContain(g1);
    // M1/L3: กรองด้วยช่วงเวลาจริง + เรียงแน่นอน + LIMIT (ไม่กรองด้วย local_*_date อีก)
    expect(q.sql).toMatch(/"busy_block"\."start_at" < \?/);
    expect(q.sql).toMatch(/"busy_block"\."end_at" > \?/);
    expect(q.sql).not.toMatch(/local_(start|end)_date" [<>]=? \?/);
    expect(q.sql).toMatch(/order by "busy_block"\."start_at" asc, "busy_block"\."id" asc limit \?/i);
    expect(q.params).toContain(5001);
  });

  it('ผลจริงจาก DB ของคิวรีแชร์ไม่มีคีย์ note และ title ของรายการซ่อนเป็น null ตั้งแต่ชั้น SQL', async () => {
    const rows = await sharedBusyInGroupQuery(h.db, g1, Date.UTC(2026, 8, 30, 17), Date.UTC(2026, 9, 31, 17), 5001);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect('note' in r).toBe(false);
    expect(rows.find((r) => r.id === hiddenId)!.title).toBeNull();
    expect(JSON.stringify(rows)).not.toContain('CANARY-N');
    expect(JSON.stringify(rows)).not.toContain(CH);
  });

  it('EXPLAIN QUERY PLAN: คิวรีปฏิทินใช้ดัชนี busy_user_*_idx (ไม่สแกนทั้งตาราง busy_block)', async () => {
    const q = sharedBusyInGroupQuery(h.db, g1, Date.UTC(2026, 8, 30, 17), Date.UTC(2026, 9, 31, 17), 5001).toSQL();
    const plan = await h.db.$client.execute({ sql: `EXPLAIN QUERY PLAN ${q.sql}`, args: q.params as never[] });
    const detail = plan.rows.map((r) => String((r as unknown as { detail: string }).detail)).join('\n');
    expect(detail).toMatch(/SEARCH busy_block USING (COVERING )?INDEX busy_user_(start|end)_idx \(user_id=\? AND (start_at|end_at)[<>]\?/);
    expect(detail).not.toMatch(/SCAN busy_block/);
  });

  it('ไม่มี endpoint รับ user id ของคนอื่นแล้วคืน busy: manifest ไม่มี path /users/:id/busy และ busy ออกได้เฉพาะ /me/busy กับ /groups/:gid/calendar', () => {
    const busyish = ROUTE_MANIFEST.filter((e) => /busy|calendar/.test(e.path) && e.path !== '/api/appointments/:id/calendar.ics').map((e) => e.path);
    expect([...new Set(busyish)].sort()).toEqual(['/api/groups/:gid/calendar', '/api/me/busy', '/api/me/busy-routines', '/api/me/busy-routines/:id', '/api/me/busy/:id']); // R14: routine = owner-only (/api/me/*)
  });
});

describe('ปฏิทินกลุ่ม: ช่วงเวลาตาม tz ของกลุ่ม + เพดานแถว (R3 M1/L3)', () => {
  const on = (day: string) => calUrl(g1, `from=${day}&to=${day}`);
  const ids = async (day: string) => (await get<Cal>(viewer.c, on(day))).data.busy.map((b) => b.id);

  it('รายการ tz อื่นที่ขอบตาราง: Honolulu 20:00-23:00 วัน 22 = 13:00-16:00 กรุงเทพวัน 23 · Tokyo 00:30-01:30 วัน 23 = 22:30-23:30 กรุงเทพวัน 22', async () => {
    const hnl = (await mk(owner, { kind: 'timed', startDate: '2026-10-22', startTime: '20:00', endDate: '2026-10-22', endTime: '23:00', tz: 'Pacific/Honolulu' })).data.busy.id;
    const tyo = (await mk(owner, { kind: 'timed', startDate: '2026-10-23', startTime: '00:30', endDate: '2026-10-23', endTime: '01:30', tz: 'Asia/Tokyo' })).data.busy.id;
    expect(await ids('2026-10-22')).toContain(tyo);
    expect(await ids('2026-10-22')).not.toContain(hnl);
    expect(await ids('2026-10-23')).toContain(hnl);
    expect(await ids('2026-10-23')).not.toContain(tyo);
    // ช่วงติดกันครบทั้งสองรายการ ไม่ซ้ำ
    const both = (await get<Cal>(viewer.c, calUrl(g1, 'from=2026-10-22&to=2026-10-23'))).data.busy.map((b) => b.id);
    expect(both).toEqual(expect.arrayContaining([hnl, tyo]));
  });

  it('ขอบเที่ยงคืนกรุงเทพ: จบ 00:00 ไม่ทับวันถัดไป · เริ่ม 00:00 ของวันหลังช่วง ไม่ทับ', async () => {
    const e = (await mk(owner, { kind: 'timed', startDate: '2026-10-27', startTime: '22:00', endDate: '2026-10-28', endTime: '00:00' })).data.busy.id;
    expect(await ids('2026-10-27')).toContain(e);
    expect(await ids('2026-10-28')).not.toContain(e);
    expect(await ids('2026-10-26')).not.toContain(e);
  });

  async function bulk(n: number): Promise<void> {
    // n แถวของ owner ในช่วง 2026-11-10 (เวลาเริ่มไม่ซ้ำ → ลำดับแน่นอน)
    const base = Date.UTC(2026, 10, 10, 1);
    await h.rows(
      `WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n < ${n}) INSERT INTO busy_block (id, user_id, title, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) SELECT 'bk-' || printf('%05d', n), ?, 't', 0, ? + n * 1000, ? + n * 1000 + 500, '2026-11-10', '2026-11-10', 'Asia/Bangkok', 0, 1, 1 FROM c`,
      [owner.id, base, base],
    );
  }

  it('เกิน CALENDAR_MAX_ITEMS → ตัดที่ 5000 เรียงตามเวลาเริ่ม + truncated true · พอดี 5000 → false', async () => {
    await bulk(5001);
    const r = await get<Cal>(viewer.c, on('2026-11-10'));
    expect(r.data.busy).toHaveLength(5000);
    expect(r.data.truncated).toBe(true);
    expect(r.data.busy[0]!.id).toBe('bk-00001');
    expect(r.data.busy[4999]!.id).toBe('bk-05000');
    await h.rows("DELETE FROM busy_block WHERE id = 'bk-05001'");
    const exact = await get<Cal>(viewer.c, on('2026-11-10'));
    expect([exact.data.busy.length, exact.data.truncated]).toEqual([5000, false]);
  });

  it('ปกติ truncated false', async () => {
    const r = await get<Cal>(viewer.c, calUrl(g1));
    expect(r.data.truncated).toBe(false);
  });
});

describe('ผู้เรียก', () => {
  it('anonymous เรียก /calendar → 401 และ body ไม่มี CANARY', async () => {
    const r = await call(new Client(), 'GET', calUrl(g1));
    expect([r.status, r.code]).toEqual([401, 'AUTH_REQUIRED']);
    expect(r.text).not.toContain('CANARY');
    // ไม่ส่งพารามิเตอร์เลย: anonymous ยังได้ 401 (ไม่ใช่ 400) และคนนอกได้ 404
    expect((await call(new Client(), 'GET', `/api/groups/${g1}/calendar`)).code).toBe('AUTH_REQUIRED');
    expect((await call(out.c, 'GET', `/api/groups/${g1}/calendar`)).code).toBe('NOT_FOUND');
  });
});
