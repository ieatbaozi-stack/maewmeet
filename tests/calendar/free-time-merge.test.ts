// R14 B11 (ค) · R14_CONTRACT §9: mergeBusyForFreeTime — ผลของ commonFreeTime ต้องเท่าเดิมทุกกรณี (เทียบรวมแล้ว vs ไม่รวม)
// property test แบบ seed คงที่ (ไม่มีไลบรารีสุ่ม): timed / all-day ปน · ชนขอบ · ทับ · ซ้อนใน · ยาวศูนย์/กลับด้าน · ข้ามเที่ยงคืน · แถว going ('g:*') ·
// คนนอกกลุ่ม · tz Bangkok / New York (ช่วงถอยเวลา 2026-11-01) / Lord Howe · หน้าต่างกลุ่มหลายแบบ
import { describe, expect, it } from 'vitest';
import { addDays, commonFreeTime, mergeBusyForFreeTime, startOfDay, type FreeDay, type FreeTimeBusyInput, type GroupWindow } from '@/lib/calendar';

const H = 3_600_000;
const M = 60_000;

/** mulberry32 — สุ่มแบบกำหนดซ้ำได้ */
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

/** ส่วนที่ต้องเท่ากัน: ทุกฟิลด์ ยกเว้น blockers[].blocks (เป็นชิ้นที่รวมแล้ว — ใช้คำนวณภายใน) */
const comparable = (days: FreeDay[]) =>
  days.map((d) => ({
    date: d.date,
    freeMembers: d.freeMembers,
    totalMembers: d.totalMembers,
    freeMemberIds: d.freeMemberIds,
    allFree: d.allFree,
    segments: d.segments,
    blockerIds: d.blockers.map((b) => b.userId),
  }));

function randomBlocks(r: () => number, tz: string, from: string, days: number, users: string[]): FreeTimeBusyInput[] {
  const base = startOfDay(from, tz);
  const out: FreeTimeBusyInput[] = [];
  const n = 20 + Math.floor(r() * 120);
  for (let i = 0; i < n; i++) {
    const userId = users[Math.floor(r() * users.length)]!;
    const kind = r();
    if (kind < 0.15) {
      const s = Math.floor(r() * days);
      const len = Math.floor(r() * 4);
      out.push({ id: `a${i}`, userId, allDay: true, startAt: 0, endAt: 1, localStartDate: addDays(from, s), localEndDate: addDays(from, s + len) });
      continue;
    }
    // เริ่มที่ขั้น 30 นาที (ชนขอบกันบ่อย) · ยาว −1 ชม. … 20 ชม. (ศูนย์/กลับด้าน/ข้ามคืน)
    const start = base + Math.floor(r() * days * 48) * 30 * M;
    const len = (Math.floor(r() * 42) - 2) * 30 * M;
    const id = r() < 0.2 ? `g:${i}` : `b${i}`;
    out.push({ id, userId, allDay: false, startAt: start, endAt: start + len, localStartDate: '', localEndDate: '' });
    // บางครั้งใส่ชิ้นที่ต่อกันพอดี / ซ้ำเป๊ะ / ซ้อนใน
    const extra = r();
    if (extra < 0.15) out.push({ id: `t${i}`, userId, allDay: false, startAt: start + len, endAt: start + len + 2 * H, localStartDate: '', localEndDate: '' });
    else if (extra < 0.25) out.push({ id: `d${i}`, userId, allDay: false, startAt: start, endAt: start + len, localStartDate: '', localEndDate: '' });
    else if (extra < 0.32 && len > 2 * H) out.push({ id: `n${i}`, userId, allDay: false, startAt: start + H, endAt: start + 2 * H, localStartDate: '', localEndDate: '' });
  }
  // สลับลำดับ (lib ต้องไม่พึ่งลำดับ)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const CASES: { tz: string; from: string; days: number }[] = [
  { tz: 'Asia/Bangkok', from: '2026-11-16', days: 14 },
  { tz: 'America/New_York', from: '2026-10-26', days: 14 }, // ถอยเวลา 2026-11-01
  { tz: 'America/New_York', from: '2027-03-08', days: 14 }, // เดินหน้า 2027-03-14
  { tz: 'Australia/Lord_Howe', from: '2026-09-28', days: 14 },
  { tz: 'Asia/Bangkok', from: '2028-02-20', days: 20 }, // ข้าม 29 ก.พ.
];
const WINDOWS: Omit<GroupWindow, 'tz'>[] = [
  { winStartMin: 480, winEndMin: 1320, minFreeMin: 240 },
  { winStartMin: 0, winEndMin: 1440, minFreeMin: 30 },
  { winStartMin: 600, winEndMin: 1080, minFreeMin: 120 },
];

describe('mergeBusyForFreeTime ≡ ไม่รวม (commonFreeTime)', () => {
  it('600 ชุดสุ่ม (5 tz/ช่วง × 3 หน้าต่าง × 40 seed): ผลเท่ากันทุกฟิลด์ · ชิ้นที่รวมแล้วไม่มากกว่าเดิม', () => {
    const members = ['u1', 'u2', 'u3'];
    let checked = 0;
    let before = 0;
    let after = 0;
    for (const c of CASES) {
      for (const w of WINDOWS) {
        for (let seed = 1; seed <= 40; seed++) {
          const r = rng(seed * 7919 + c.days);
          const blocks = randomBlocks(r, c.tz, c.from, c.days, [...members, 'outsider']);
          const merged = mergeBusyForFreeTime(blocks);
          const to = addDays(c.from, c.days - 1);
          const win: GroupWindow = { tz: c.tz, ...w };
          expect(comparable(commonFreeTime(win, members, merged, c.from, to)), `${c.tz} ${c.from} seed ${seed}`).toEqual(
            comparable(commonFreeTime(win, members, blocks, c.from, to)),
          );
          expect(merged.length).toBeLessThanOrEqual(blocks.length);
          before += blocks.length;
          after += merged.length;
          checked++;
        }
      }
    }
    expect(checked).toBe(600);
    expect(after).toBeLessThan(before);
  });

  it('ตัวอย่างคำนวณมือ: ชนขอบรวม · ทับรวม · แยกคน · all-day ติดกันรวม · ยาวศูนย์ทิ้ง · going รวมกับ busy', () => {
    const t = (id: string, userId: string, s: number, e: number): FreeTimeBusyInput => ({ id, userId, allDay: false, startAt: s, endAt: e, localStartDate: '', localEndDate: '' });
    const d = (id: string, userId: string, s: string, e: string): FreeTimeBusyInput => ({ id, userId, allDay: true, startAt: 0, endAt: 1, localStartDate: s, localEndDate: e });
    const merged = mergeBusyForFreeTime([
      t('b1', 'u1', 9 * H, 12 * H),
      t('g:0', 'u1', 12 * H, 13 * H), // ชนขอบ → รวม
      t('b2', 'u1', 10 * H, 11 * H), // ซ้อนใน
      t('b3', 'u1', 14 * H, 15 * H), // แยก
      t('b4', 'u2', 9 * H, 12 * H), // คนอื่น
      t('z', 'u2', 5 * H, 5 * H), // ยาวศูนย์
      d('a1', 'u1', '2026-11-16', '2026-11-17'),
      d('a2', 'u1', '2026-11-18', '2026-11-18'), // ติดกัน → รวม
      d('a3', 'u1', '2026-11-20', '2026-11-20'), // ห่าง 1 วัน → แยก
    ]);
    const shape = merged.map((m) => (m.allDay ? [m.userId, m.localStartDate, m.localEndDate] : [m.userId, m.startAt / H, m.endAt / H]));
    expect(shape).toEqual([
      ['u1', 9, 13],
      ['u1', 14, 15],
      ['u2', 9, 12],
      ['u1', '2026-11-16', '2026-11-18'],
      ['u1', '2026-11-20', '2026-11-20'],
    ]);
    expect(new Set(merged.map((m) => m.id)).size).toBe(merged.length);
  });

  it('กรณีจริงของ routine: ทำงาน 09–18 + เรียน 18–21 + ยิม 06–07 ของคนเดียว 5 วัน = 15 ชิ้น → 10 ชิ้น · ผลเท่าเดิม', () => {
    const tz = 'Asia/Bangkok';
    const blocks: FreeTimeBusyInput[] = [];
    for (let i = 0; i < 5; i++) {
      const day = addDays('2026-11-16', i);
      const at = (h: number) => startOfDay(day, tz) + h * H;
      blocks.push(
        { id: `w${i}`, userId: 'u1', allDay: false, startAt: at(9), endAt: at(18), localStartDate: day, localEndDate: day },
        { id: `c${i}`, userId: 'u1', allDay: false, startAt: at(18), endAt: at(21), localStartDate: day, localEndDate: day },
        { id: `g${i}`, userId: 'u1', allDay: false, startAt: at(6), endAt: at(7), localStartDate: day, localEndDate: day },
      );
    }
    const merged = mergeBusyForFreeTime(blocks);
    expect(merged).toHaveLength(10);
    const win: GroupWindow = { tz, winStartMin: 480, winEndMin: 1320, minFreeMin: 60 };
    expect(comparable(commonFreeTime(win, ['u1', 'u2'], merged, '2026-11-16', '2026-11-22'))).toEqual(
      comparable(commonFreeTime(win, ['u1', 'u2'], blocks, '2026-11-16', '2026-11-22')),
    );
  });
});
