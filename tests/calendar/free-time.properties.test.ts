// property test: commonFreeTime เทียบกับ implementation ช้าแบบ "slot 1 นาที" บนข้อมูลสุ่ม (seed คงที่)
// naive ทำงานบน instant ล้วน (วันที่ DST ยาว 23/25 ชม. จึงไม่ต้องมีกรณีพิเศษ) · ขอบหน้าต่างตรวจอิสระด้วย Intl
import { describe, expect, it } from 'vitest';
import { addDays, commonFreeTime, dayWindow, eachDate, startOfDay, type FreeTimeBusyInput, type GroupWindow } from '@/lib/calendar';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;

interface NaiveDay {
  free: number;
  allFree: boolean;
  segments: Array<[number, number]>;
}

/** เทียบทีละนาทีของ instant ในหน้าต่าง [w0,w1) */
function naive(group: GroupWindow, members: string[], busy: FreeTimeBusyInput[], date: string): NaiveDay {
  const [w0, w1] = dayWindow(date, group.winStartMin, group.winEndMin, group.tz);
  const n = (w1 - w0) / MIN;
  expect(Number.isInteger(n)).toBe(true);
  const slotBusy = new Map<string, Uint8Array>();
  const allDay = new Set<string>();
  for (const m of members) slotBusy.set(m, new Uint8Array(n));
  for (const b of busy) {
    if (!members.includes(b.userId)) continue;
    if (b.allDay) {
      if (b.localStartDate <= date && date <= b.localEndDate) allDay.add(b.userId);
      continue;
    }
    const arr = slotBusy.get(b.userId)!;
    for (let i = 0; i < n; i++) {
      const t = w0 + i * MIN;
      if (b.startAt < t + MIN && b.endAt > t) arr[i] = 1;
    }
  }
  const runs = (isBusy: (i: number) => boolean): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const free = i < n && !isBusy(i);
      if (free && start < 0) start = i;
      if (!free && start >= 0) {
        if ((i - start) * MIN >= group.minFreeMin * MIN) out.push([w0 + start * MIN, w0 + i * MIN]);
        start = -1;
      }
    }
    return out;
  };
  let free = 0;
  for (const m of members) {
    if (allDay.has(m)) continue;
    const arr = slotBusy.get(m)!;
    if (runs((i) => arr[i] === 1).length > 0) free++;
  }
  const segments = allDay.size > 0 ? [] : runs((i) => members.some((m) => slotBusy.get(m)![i] === 1));
  return { free, allFree: segments.length > 0, segments };
}

function localHHMM(ms: number, tz: string): string {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return f.format(new Date(ms));
}

interface Scenario {
  tz: string;
  from: string;
  days: number;
  fullWindow: boolean;
}

function makeCase(rand: () => number, sc: Scenario) {
  const ri = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const winStartMin = sc.fullWindow ? 0 : ri(0, 40) * 30;
  const winEndMin = sc.fullWindow ? 1440 : Math.min(1440, winStartMin + ri(2, 44) * 30);
  const maxMin = winEndMin - winStartMin;
  const minFreeMin = sc.fullWindow ? ri(1, 12) * 30 : Math.max(30, Math.min(ri(1, 8) * 30, Math.floor(maxMin / 30) * 30));
  const group: GroupWindow = { tz: sc.tz, winStartMin, winEndMin, minFreeMin };
  const all = ['A', 'B', 'C', 'D', 'E'];
  const members = all.slice(0, ri(1, 4));
  const users = [...members, 'X']; // X = ไม่ใช่สมาชิก (ต้องถูกเมิน)
  const to = addDays(sc.from, sc.days - 1);
  const rangeStart = startOfDay(addDays(sc.from, -2), sc.tz);
  const rangeLen = (sc.days + 4) * 1440;
  const busy: FreeTimeBusyInput[] = [];
  const count = ri(0, 14);
  for (let i = 0; i < count; i++) {
    const userId = users[ri(0, users.length - 1)]!;
    if (rand() < 0.15) {
      const s = addDays(sc.from, ri(-2, sc.days));
      const e = addDays(s, ri(0, 3));
      busy.push({ id: `b${i}`, userId, allDay: true, startAt: startOfDay(s, sc.tz), endAt: startOfDay(addDays(e, 1), sc.tz), localStartDate: s, localEndDate: e });
    } else {
      const startAt = rangeStart + ri(0, rangeLen) * MIN;
      const lenMin = rand() < 0.05 ? 0 : rand() < 0.7 ? ri(1, 6 * 60) : ri(1, 40 * 60);
      busy.push({ id: `b${i}`, userId, allDay: false, startAt, endAt: startAt + lenMin * MIN, localStartDate: sc.from, localEndDate: sc.from });
    }
  }
  return { group, members, busy, to };
}

const scenarios: Scenario[] = [
  { tz: 'Asia/Bangkok', from: '2026-02-26', days: 6, fullWindow: false },
  { tz: 'Asia/Bangkok', from: '2026-12-29', days: 6, fullWindow: true },
  { tz: 'Asia/Tokyo', from: '2024-02-27', days: 6, fullWindow: false },
  { tz: 'Asia/Tokyo', from: '2026-06-10', days: 5, fullWindow: true },
  { tz: 'Europe/London', from: '2026-03-27', days: 5, fullWindow: true }, // spring forward 03-29 (23 ชม.)
  { tz: 'Europe/London', from: '2026-10-23', days: 5, fullWindow: true }, // fall back 10-25 (25 ชม.)
  { tz: 'America/New_York', from: '2026-03-06', days: 5, fullWindow: true }, // 03-08
  { tz: 'America/New_York', from: '2026-10-30', days: 5, fullWindow: true }, // 11-01
  { tz: 'Europe/London', from: '2026-03-27', days: 5, fullWindow: false },
  { tz: 'America/New_York', from: '2026-11-01', days: 4, fullWindow: false },
];

describe('commonFreeTime เทียบ naive slot 1 นาที (สุ่ม seed คงที่)', () => {
  it.each(scenarios.map((s, i) => [`${s.tz} ${s.from} +${s.days}d ${s.fullWindow ? '00:00–24:00' : 'หน้าต่างสุ่ม'}`, s, i] as const))(
    '%s',
    (_name, sc, idx) => {
      const rand = rng(0x5eed + idx * 7919);
      let checkedDays = 0;
      let withSegments = 0;
      let withAllDay = 0;
      for (let k = 0; k < 120; k++) {
        const { group, members, busy, to } = makeCase(rand, sc);
        const out = commonFreeTime(group, members, busy, sc.from, to);
        expect(out.map((d) => d.date)).toEqual(eachDate(sc.from, to));
        for (const d of out) {
          const ref = naive(group, members, busy, d.date);
          const ctx = `${sc.tz} case#${k} ${d.date}`;
          expect({ ctx, free: d.freeMembers }).toEqual({ ctx, free: ref.free });
          expect({ ctx, allFree: d.allFree }).toEqual({ ctx, allFree: ref.allFree });
          expect({ ctx, segs: d.segments.map((s) => [s.startAt, s.endAt]) }).toEqual({ ctx, segs: ref.segments });
          expect(d.totalMembers).toBe(members.length);
          expect(d.freeMemberIds.length + d.blockers.length).toBe(members.length);

          // ขอบหน้าต่างตรวจอิสระ (Intl) — หน้าต่างเต็มวัน หรือ tz ที่ไม่มี DST
          const [w0, w1] = dayWindow(d.date, group.winStartMin, group.winEndMin, group.tz);
          if (sc.fullWindow || sc.tz.startsWith('Asia/')) {
            expect(localHHMM(w0, group.tz)).toBe(`${String(Math.floor(group.winStartMin / 60)).padStart(2, '0')}:${String(group.winStartMin % 60).padStart(2, '0')}`);
            if (group.winEndMin < 1440) expect(localHHMM(w1, group.tz)).toBe(`${String(Math.floor(group.winEndMin / 60)).padStart(2, '0')}:${String(group.winEndMin % 60).padStart(2, '0')}`);
            else expect(localHHMM(w1, group.tz)).toBe('00:00');
          }
          // HH:MM ของทุก segment ตรงกับ Intl
          for (const s of d.segments) {
            expect(s.start).toBe(localHHMM(s.startAt, group.tz));
            expect(s.end).toBe(s.endAt === w1 && group.winEndMin === 1440 ? '24:00' : localHHMM(s.endAt, group.tz));
          }
          checkedDays++;
          if (d.segments.length) withSegments++;
          if (d.freeMembers < d.totalMembers) withAllDay++;
        }
      }
      // ข้อมูลสุ่มต้องครอบคลุมทั้งวันว่างและวันไม่ว่างจริง (กัน test เสื่อมเป็นไม่ได้ตรวจอะไร)
      expect(checkedDays).toBeGreaterThan(400);
      expect(withSegments).toBeGreaterThan(30);
      expect(withAllDay).toBeGreaterThan(30);
    },
    60_000,
  );

  it('วัน DST ยาว 23 / 25 ชม. จริงในข้อมูลที่ทดสอบ (ไม่ได้ทดสอบแต่วันยาว 24 ชม.)', () => {
    const len = (tz: string, d: string) => {
      const [a, b] = dayWindow(d, 0, 1440, tz);
      return (b - a) / 3_600_000;
    };
    expect(len('Europe/London', '2026-03-29')).toBe(23);
    expect(len('Europe/London', '2026-10-25')).toBe(25);
    expect(len('America/New_York', '2026-03-08')).toBe(23);
    expect(len('America/New_York', '2026-11-01')).toBe(25);
  });

  it('วัน fall-back 25 ชม.: busy 01:30 BST → 01:30 GMT (ข้ามช่วงซ้ำ) คิดเป็น 60 นาทีจริง', () => {
    const group: GroupWindow = { tz: 'Europe/London', winStartMin: 0, winEndMin: 1440, minFreeMin: 60 };
    const [w0] = dayWindow('2026-10-25', 0, 1440, 'Europe/London');
    const b: FreeTimeBusyInput = { id: 'x', userId: 'A', allDay: false, startAt: w0 + 90 * MIN, endAt: w0 + 150 * MIN, localStartDate: '2026-10-25', localEndDate: '2026-10-25' };
    const [d] = commonFreeTime(group, ['A'], [b], '2026-10-25', '2026-10-25');
    expect(d!.segments.map((s) => [s.start, s.end])).toEqual([
      ['00:00', '01:30'],
      ['01:30', '24:00'],
    ]);
    expect(d!.segments[0]!.endAt).toBe(b.startAt);
    expect(d!.segments[1]!.startAt).toBe(b.endAt);
  });
});
