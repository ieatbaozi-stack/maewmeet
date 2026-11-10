// R6F-T — เมทริกซ์ role×action ของ "ชุด busy รายวัน" ผ่าน route จริง (สิทธิ์ตรวจที่เซิร์ฟเวอร์ — กฎ 6)
// ช่อง: anonymous · must_change_pin · suspended · สมาชิกกลุ่ม · ไม่ใช่สมาชิก · admin กลุ่ม · super admin × (POST kind 'daily' · DELETE scope=one|series)
// + scope ซ้ำ/ค่าแปลก · policy ระดับ can(): busy.create / busy.delete ไม่มี dimension ใหม่ (scope ไม่ใช่ resource)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIONS } from '@/lib/rbac/actions';
import { call, Client, del, join, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

let h: Harness;
let owner: Person; // เจ้าของชุด + admin กลุ่ม
let member: Person; // สมาชิกกลุ่มเดียวกัน
let outsider: Person; // ไม่ใช่สมาชิกกลุ่มใดเลย
let sa: Person; // super admin (ไม่อยู่ในกลุ่ม)
let ids: string[];
let seriesId: string;

type Series = { seriesId: string | null; count: number; items: { id: string }[] };
const daily = (over: Record<string, unknown> = {}) => ({ kind: 'daily', startDate: '2026-11-03', endDate: '2026-11-07', startTime: '17:00', endTime: '20:00', ...over });
const snapshot = async () => JSON.stringify(await h.rows('SELECT * FROM busy_block ORDER BY id'));

beforeEach(async () => {
  h = await setupHarness();
  owner = await person(h, 'olive');
  member = await person(h, 'mark');
  outsider = await person(h, 'otto');
  sa = await person(h, 'boss', { admin: true });
  const gid = await makeGroup(owner);
  await join(owner, member, gid);
  const s = await post<Series>(owner.c, '/api/me/busy', daily());
  expect(s.status).toBe(201);
  ids = s.data.items.map((i) => i.id);
  seriesId = s.data.seriesId!;
});
afterEach(async () => {
  await h.cleanup();
});

describe('policy: R6F ไม่เพิ่ม action ใหม่ (scope ไม่ใช่มิติสิทธิ์)', () => {
  it("ชุด action busy.* ยังเป็น 4 ตัวเดิม — daily/series ใช้ 'busy.create' / 'busy.delete'", () => {
    // R14 เพิ่ม busy.routine.* (tests/rbac/busy-routine.test.ts) — ชุด busy เดี่ยว/รายวันยังเป็น 4 ตัวเดิม
    expect(ACTIONS.filter((a) => a.startsWith('busy.') && !a.startsWith('busy.routine.')).sort()).toEqual(['busy.create', 'busy.delete', 'busy.list.own', 'busy.update']);
  });
});

describe('busy.create kind daily — ทุกบทบาทที่ล็อกอินปกติสร้างของตัวเองได้ · ที่เหลือไม่ได้ · ไม่เขียนแถว', () => {
  it.each([
    ['เจ้าของ/admin กลุ่ม', () => owner],
    ['สมาชิกกลุ่ม', () => member],
    ['ไม่ใช่สมาชิกกลุ่ม', () => outsider],
    ['super admin', () => sa],
  ])('%s → 201 · แถวเป็นของตัวเอง', async (_n, who) => {
    const p = who();
    const r = await post<Series>(p.c, '/api/me/busy', daily());
    expect(r.status).toBe(201);
    expect(r.data.count).toBe(5);
    expect(await h.count('busy_block WHERE user_id = ? AND series_id = ?', [p.id, r.data.seriesId])).toBe(5);
  });

  it('anonymous → 401 AUTH_REQUIRED · must_change_pin → 403 PIN_CHANGE_REQUIRED · suspended → 401 · ไม่เขียน', async () => {
    const before = await snapshot();
    const anon = await post(new Client(), '/api/me/busy', daily());
    expect([anon.status, anon.code]).toEqual([401, 'AUTH_REQUIRED']);
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [member.id]);
    const pin = await post(member.c, '/api/me/busy', daily());
    expect([pin.status, pin.code]).toEqual([403, 'PIN_CHANGE_REQUIRED']);
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [outsider.id]);
    expect((await post(outsider.c, '/api/me/busy', daily())).status).toBe(401);
    expect(await snapshot()).toBe(before);
  });
});

describe('busy.delete scope=one|series — เจ้าของเท่านั้น · คนอื่นทุกบทบาท 404 เหมือน id ที่ไม่มี · ไม่ลบอะไร', () => {
  const ghost = '00000000-0000-4000-8000-00000000dead';

  it.each([
    ['สมาชิกกลุ่มเดียวกัน', () => member],
    ['ไม่ใช่สมาชิก', () => outsider],
    ['super admin', () => sa],
  ])('%s × scope ทั้งหมด → 404 NOT_FOUND ตัวเดียวกับ id ที่ไม่มี', async (_n, who) => {
    const p = who();
    const before = await snapshot();
    for (const q of ['', '?scope=one', '?scope=series']) {
      const r = await del(p.c, `/api/me/busy/${ids[0]}${q}`);
      const g = await del(p.c, `/api/me/busy/${ghost}${q}`);
      expect([r.status, r.code], q).toEqual([404, 'NOT_FOUND']);
      expect(r.text, q).toBe(g.text);
    }
    expect(await snapshot()).toBe(before);
  });

  it('anonymous → 401 · must_change_pin → 403 · suspended → 401 (แม้ใช้ id ของชุดจริง) · ไม่ลบ', async () => {
    const before = await snapshot();
    const anon = await call(new Client(), 'DELETE', `/api/me/busy/${ids[0]}?scope=series`);
    expect([anon.status, anon.code]).toEqual([401, 'AUTH_REQUIRED']);
    await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [owner.id]);
    const pin = await del(owner.c, `/api/me/busy/${ids[0]}?scope=series`);
    expect([pin.status, pin.code]).toEqual([403, 'PIN_CHANGE_REQUIRED']);
    await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [owner.id]);
    expect((await del(owner.c, `/api/me/busy/${ids[0]}?scope=series`)).status).toBe(401);
    expect(await snapshot()).toBe(before);
  });

  it('เจ้าของ scope=one → 1 แถว · scope=series → ที่เหลือทั้งชุด (4)', async () => {
    expect((await del(owner.c, `/api/me/busy/${ids[0]}?scope=one`)).data).toEqual({ deleted: true, count: 1 });
    expect(await h.count('busy_block WHERE series_id = ?', [seriesId])).toBe(4);
    expect((await del(owner.c, `/api/me/busy/${ids[1]}?scope=series`)).data).toEqual({ deleted: true, count: 4 });
    expect(await h.count('busy_block WHERE user_id = ?', [owner.id])).toBe(0);
  });
});

describe('scope ซ้ำ/ค่าแปลก — ไม่ลบเกินสิทธิ์ ไม่สะท้อนค่า', () => {
  it('scope ซ้ำ (one&series / series&one) → ไม่เคยแตะแถวของคนอื่น · ผลต้องเป็น 200 หรือ 400 เท่านั้น', async () => {
    const other = await post<Series>(outsider.c, '/api/me/busy', daily());
    const otherRows = JSON.stringify(await h.rows('SELECT * FROM busy_block WHERE user_id = ? ORDER BY id', [outsider.id]));
    for (const q of ['scope=one&scope=series', 'scope=series&scope=one']) {
      const mine = await post<Series>(owner.c, '/api/me/busy', daily({ startDate: '2026-12-01', endDate: '2026-12-03' }));
      const r = await del(owner.c, `/api/me/busy/${mine.data.items[0]!.id}?${q}`);
      expect([200, 400], q).toContain(r.status);
      if (r.status === 200) expect([1, 3], q).toContain((r.data as { count: number }).count);
      await h.rows('DELETE FROM busy_block WHERE series_id = ?', [mine.data.seriesId]);
    }
    expect(JSON.stringify(await h.rows('SELECT * FROM busy_block WHERE user_id = ? ORDER BY id', [outsider.id]))).toBe(otherRows);
    expect(other.data.count).toBe(5);
  });

  it('ค่าแปลก (ว่าง/ตัวพิมพ์ใหญ่/ตัวเลข/อาร์เรย์/SQL/เกินยาว/คีย์อื่น) → 400 VALIDATION { scope: INVALID } ไม่สะท้อนค่า · ไม่ลบอะไร', async () => {
    const before = await snapshot();
    const qs = ['scope=', 'scope=Series', 'scope=1', 'scope[]=series', "scope=series'--", `scope=${'a'.repeat(5000)}`, 'scope=all', 'seriesId=x', 'scope=series&scope', 'scope=%00'];
    for (const q of qs) {
      const r = await del(owner.c, `/api/me/busy/${ids[0]}?${q}`);
      expect([r.status, r.code], q.slice(0, 30)).toEqual([400, 'VALIDATION']);
      expect(r.text).not.toMatch(/Series|aaaa|--/);
    }
    expect(await snapshot()).toBe(before);
  });
});
