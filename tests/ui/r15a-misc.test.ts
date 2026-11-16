// R15a §1.4 — ขั้น 3 ของแถบขั้นตอน (freeSeen + localStorage) · NavProgress ตอน router.push · skeleton ค้าง ≥ 250 ms
import { beforeEach, describe, expect, it } from 'vitest';
import { freeSeenKey, markFreeSeen, readFreeSeen, resetFreeSeenMemory, subscribeFreeSeen } from '@/components/groups/free-seen';
import { computeSteps } from '@/components/groups/steps-model';
import { isPathChange } from '@/components/shell/nav-start';
import { SKELETON_DELAY_MS, SKELETON_MIN_MS, skeletonHoldUntil } from '@/components/shell/useMinSkeleton';

const states = (r: ReturnType<typeof computeSteps>) => r.steps.map((s) => s.state);

describe('computeSteps — ขั้น 3 เสร็จได้ (R15a)', () => {
  it('ยังไม่เคยดู: ขั้น 3 เป็น "ถัดไป" (มาก่อนขั้น 4) · ดูแล้ว: ขั้น 3 เสร็จ ขั้น 4 เป็นถัดไป', () => {
    const base = { memberCount: 3, viewerHasBusy: true, upcomingCount: 0 };
    expect(states(computeSteps(base))).toEqual(['done', 'done', 'next', 'todo']);
    const seen = computeSteps({ ...base, freeSeen: true });
    expect(states(seen)).toEqual(['done', 'done', 'done', 'next']);
    expect(seen.doneCount).toBe(3);
    expect(seen.allDone).toBe(false);
  });
  it('มีนัดแล้ว = ขั้น 3 เสร็จเอง แม้เครื่องนี้ไม่เคยดู (เครื่องใหม่/ล้างข้อมูล)', () => {
    const r = computeSteps({ memberCount: 2, viewerHasBusy: true, upcomingCount: 1 });
    expect(states(r)).toEqual(['done', 'done', 'done', 'done']);
    expect(r.allDone).toBe(true);
    expect(r.doneCount).toBe(4);
  });
  it('allDone ไม่ขึ้นกับ freeSeen (เซิร์ฟเวอร์ตัดสินปุ่มสร้างนัดได้) · ดูแล้วแต่ขั้นอื่นไม่ครบ = ไม่ครบ', () => {
    for (const memberCount of [1, 2]) for (const viewerHasBusy of [false, true]) for (const upcomingCount of [0, 1]) {
      const a = computeSteps({ memberCount, viewerHasBusy, upcomingCount, freeSeen: false }).allDone;
      const b = computeSteps({ memberCount, viewerHasBusy, upcomingCount, freeSeen: true }).allDone;
      expect(a).toBe(b);
    }
    expect(computeSteps({ memberCount: 1, viewerHasBusy: false, upcomingCount: 0, freeSeen: true }).allDone).toBe(false);
    expect(states(computeSteps({ memberCount: 1, viewerHasBusy: false, upcomingCount: 0, freeSeen: true }))).toEqual(['next', 'todo', 'done', 'todo']);
  });
  it('มี "ถัดไป" ได้ขั้นเดียว (ยกเว้นครบ) ทุกชุดค่า', () => {
    for (const memberCount of [1, 2]) for (const viewerHasBusy of [false, true]) for (const upcomingCount of [0, 1]) for (const freeSeen of [false, true]) {
      const r = computeSteps({ memberCount, viewerHasBusy, upcomingCount, freeSeen });
      expect(r.steps.filter((s) => s.state === 'next').length).toBe(r.allDone ? 0 : 1);
    }
  });
});

function fakeStorage(init: Record<string, string> = {}, opts: { failRead?: boolean; failWrite?: boolean } = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => {
      if (opts.failRead) throw new Error('blocked');
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.failWrite) throw new Error('quota');
      m.set(k, v);
    },
  };
}

describe('free-seen (localStorage ครอบ try/catch)', () => {
  beforeEach(() => resetFreeSeenMemory());
  it('คีย์ตามสเปก mm:free-seen:v1:<userId>:<groupId>', () => {
    expect(freeSeenKey('u1', 'g1')).toBe('mm:free-seen:v1:u1:g1');
  });
  it('เขียนแล้วอ่านได้ · แยกตามบัญชี/กลุ่ม', () => {
    const s = fakeStorage();
    expect(readFreeSeen('u1', 'g1', s)).toBe(false);
    markFreeSeen('u1', 'g1', s);
    expect(s.m.get('mm:free-seen:v1:u1:g1')).toBe('1');
    expect(readFreeSeen('u1', 'g1', s)).toBe(true);
    expect(readFreeSeen('u1', 'g2', s)).toBe(false);
    expect(readFreeSeen('u2', 'g1', s)).toBe(false);
  });
  it('อ่านไม่ได้ (บล็อก) → ยังไม่เห็น ไม่ throw · เขียนไม่ได้ → จำในหน่วยความจำของแท็บ', () => {
    expect(readFreeSeen('u1', 'g1', fakeStorage({ 'mm:free-seen:v1:u1:g1': '1' }, { failRead: true }))).toBe(false);
    const s = fakeStorage({}, { failWrite: true });
    expect(() => markFreeSeen('u1', 'g1', s)).not.toThrow();
    expect(readFreeSeen('u1', 'g1', s)).toBe(true);
    expect(readFreeSeen('u1', 'g1', null)).toBe(true);
  });
  it('ค่าอื่นที่ไม่ใช่ "1" ไม่นับ · storage เป็น null = ไม่เห็น', () => {
    expect(readFreeSeen('u1', 'g1', fakeStorage({ 'mm:free-seen:v1:u1:g1': 'yes' }))).toBe(false);
    expect(readFreeSeen('u9', 'g9', null)).toBe(false);
  });
  it('แจ้งผู้สมัครเมื่อเขียนครั้งแรกเท่านั้น', () => {
    const s = fakeStorage();
    let n = 0;
    const off = subscribeFreeSeen(() => n++);
    markFreeSeen('u1', 'g1', s);
    markFreeSeen('u1', 'g1', s);
    off();
    expect(n).toBe(1);
  });
});

describe('isPathChange (NavProgress ตอน router.push)', () => {
  const cur = { origin: 'https://mm.test', pathname: '/groups' };
  it('หน้าอื่นในโดเมนเดียวกัน = เปลี่ยนหน้า', () => {
    expect(isPathChange('/groups/abc', cur)).toBe(true);
    expect(isPathChange('https://mm.test/appointments/1', cur)).toBe(true);
  });
  it('pathname เดิม (เปลี่ยนแค่ query/hash) หรือโดเมนอื่น หรือ href พัง = ไม่เริ่ม', () => {
    expect(isPathChange('/groups?x=1', cur)).toBe(false);
    expect(isPathChange('/groups#a', cur)).toBe(false);
    expect(isPathChange('https://evil.test/other', cur)).toBe(false);
    expect(isPathChange('http://[bad', cur)).toBe(false);
  });
});

describe('skeleton ค้างอย่างน้อย 250 ms (skeletonHoldUntil)', () => {
  it('ค่าตั้งต้น: เห็นหลัง 150 ms แล้วค้าง 250 ms', () => {
    expect(SKELETON_DELAY_MS).toBe(150);
    expect(SKELETON_MIN_MS).toBe(250);
  });
  it('โหลดเสร็จก่อน skeleton ขึ้น (≤ 150 ms) = ไม่ต้องค้าง (ไม่เคยเห็น)', () => {
    expect(skeletonHoldUntil(1000, 1100)).toBe(0);
    expect(skeletonHoldUntil(1000, 1150)).toBe(0);
  });
  it('เสร็จหลัง skeleton ขึ้นแต่ยังไม่ครบ 250 ms → ค้างจนถึง since+150+250', () => {
    expect(skeletonHoldUntil(1000, 1200)).toBe(1400);
    expect(skeletonHoldUntil(1000, 1151)).toBe(1400);
  });
  it('เห็นครบ 250 ms แล้ว = ไม่ค้างต่อ', () => {
    expect(skeletonHoldUntil(1000, 1400)).toBe(0);
    expect(skeletonHoldUntil(1000, 5000)).toBe(0);
  });
});
