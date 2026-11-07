// R7-1 (R7_CONTRACT §1 G1): กลุ่มใหม่ "ว่างอย่างน้อย" = 240 นาที · หน้าต่าง 08:00–22:00 เท่าเดิม · กลุ่มเดิมไม่เปลี่ยน · ไม่มี migration
// ค่ามาจาก service (GROUP_DEFAULT_MIN_FREE_MINUTES) ไม่ใช่ DB default — schema.ts ยัง default(120) (เทสต์ข้อสุดท้ายยืนยัน)
// POST /api/groups รับแค่ {name} (strict) — ส่ง minFreeMinutes มาตอนสร้างไม่ได้ (รูป API เดิม) · ปรับภายหลังผ่าน PATCH ได้ตามเดิม
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertGroupIfUnderCap } from '@/lib/data/repos/group';
import { newId } from '@/lib/shared/id';
import { GROUP_DEFAULT_MIN_FREE_MINUTES } from '@/lib/shared/limits';
import { get, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from './harness';

type Detail = { group: { id: string; freeWindowStartMin: number; freeWindowEndMin: number; minFreeMinutes: number } };
type Avail = { group: { windowStartMin: number; windowEndMin: number; minFreeMinutes: number } };

let h: Harness;
let alice: Person;
beforeEach(async () => {
  h = await setupHarness();
  alice = await person(h, 'alice');
});
afterEach(async () => {
  await h.cleanup();
});

const windowOf = async (gid: string) =>
  (await h.rows<{ s: number; e: number; m: number }>('SELECT free_window_start_min AS s, free_window_end_min AS e, min_free_minutes AS m FROM groups WHERE id = ?', [gid]))[0];

describe('R7-1 — ค่าเริ่มต้นของกลุ่มใหม่', () => {
  it('ค่าคงที่กลาง = 240 และอยู่ในหน้าต่างเริ่มต้น (≤ 22:00 − 08:00 · ทวีคูณ 30)', () => {
    expect(GROUP_DEFAULT_MIN_FREE_MINUTES).toBe(240);
    expect(GROUP_DEFAULT_MIN_FREE_MINUTES % 30).toBe(0);
    expect(GROUP_DEFAULT_MIN_FREE_MINUTES).toBeLessThanOrEqual(1320 - 480);
  });

  it('สร้างผ่าน API → minFree 240 · window 480–1320 (DB + GET /api/groups/:gid + availability)', async () => {
    const gid = await makeGroup(alice, 'กลุ่มใหม่');
    expect(await windowOf(gid)).toEqual({ s: 480, e: 1320, m: 240 });
    const d = await get<Detail>(alice.c, `/api/groups/${gid}`);
    expect(d.status).toBe(200);
    expect(d.data.group).toMatchObject({ freeWindowStartMin: 480, freeWindowEndMin: 1320, minFreeMinutes: 240 });
    const a = await get<Avail>(alice.c, `/api/groups/${gid}/availability?from=2026-11-02&to=2026-11-02`);
    expect(a.status).toBe(200);
    expect(a.data.group).toMatchObject({ windowStartMin: 480, windowEndMin: 1320, minFreeMinutes: 240 });
  });

  it('กลุ่มเดิม (สร้างก่อน R7 = DB default 120) ไม่เปลี่ยนเมื่อมีกลุ่มใหม่', async () => {
    const old = newId();
    await h.rows('INSERT INTO groups (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, 1, 1)', [old, 'เก่า', alice.id]);
    await makeGroup(alice, 'ใหม่');
    expect(await windowOf(old)).toEqual({ s: 480, e: 1320, m: 120 });
  });

  it('ตอนสร้างส่ง minFreeMinutes มาไม่ได้ (รูป API เดิม: strict → VALIDATION UNKNOWN_FIELD) · ปรับภายหลังผ่าน PATCH ได้', async () => {
    const r = await post(alice.c, '/api/groups', { name: 'x', minFreeMinutes: 60 });
    expect(r.status).toBe(400);
    expect(r.json.error?.params).toEqual({ fields: { minFreeMinutes: 'UNKNOWN_FIELD' } });
    expect(await h.count('groups')).toBe(0);
    const gid = await makeGroup(alice, 'ปรับได้');
    expect((await patch(alice.c, `/api/groups/${gid}`, { minFreeMinutes: 120 })).status).toBe(200);
    expect((await windowOf(gid))?.m).toBe(120);
  });

  it('repo: ไม่ส่ง = ค่ากลาง 240 · ส่งค่าเอง = ใช้ค่านั้น · DB default ยัง 120 (ไม่มี migration)', async () => {
    const a = newId();
    const b = newId();
    expect(await insertGroupIfUnderCap(h.db, { id: a, name: 'a', createdBy: alice.id, cap: 10 }, 1)).toBe(true);
    expect(await insertGroupIfUnderCap(h.db, { id: b, name: 'b', createdBy: alice.id, cap: 10, minFreeMinutes: 90 }, 1)).toBe(true);
    expect((await windowOf(a))?.m).toBe(240);
    expect((await windowOf(b))?.m).toBe(90);
    const cols = await h.rows<{ name: string; dflt_value: string | null }>("SELECT name, dflt_value FROM pragma_table_info('groups') WHERE name = 'min_free_minutes'");
    expect(cols).toEqual([{ name: 'min_free_minutes', dflt_value: '120' }]);
  });
});
