// commonFreeTime — ADR 0005 fixtures T1–T24 · membersBlockedDuring (§4) · ช่วง ≤ 62 วัน · ประสิทธิภาพ · R4A-1, R4A-6
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  CalendarError,
  commonFreeTime,
  DEFAULT_TZ,
  membersBlockedDuring,
  overlapsRange,
  parseLocalDateTime,
  startOfDay,
  subtract,
  type FreeDay,
  type FreeTimeBusyInput,
  type GroupWindow,
} from '@/lib/calendar';

const FIX = join(process.cwd(), 'docs/adr/0005-fixtures');

interface FxBusy {
  u: string;
  k: 't' | 'd';
  s: string;
  e: string;
  tz?: string;
}
interface FxCase {
  id: string;
  note: string;
  gtz?: string;
  window?: [number, number];
  min?: number;
  members: string[];
  from: string;
  to: string;
  busy: FxBusy[];
}
interface FxDay {
  date: string;
  free: string;
  all_free: boolean;
  segments: string[];
}

const cases = JSON.parse(readFileSync(join(FIX, 'cases.json'), 'utf8')) as FxCase[];
const expected = JSON.parse(readFileSync(join(FIX, 'expected.json'), 'utf8')) as Record<string, FxDay[]>;

function toBusy(c: FxCase): FreeTimeBusyInput[] {
  const gtz = c.gtz ?? DEFAULT_TZ;
  return c.busy.map((b, i): FreeTimeBusyInput => {
    const tz = b.tz ?? gtz;
    if (b.k === 'd') {
      return {
        id: `${c.id}-${i}`,
        userId: b.u,
        allDay: true,
        startAt: startOfDay(b.s, tz),
        endAt: startOfDay(addDays(b.e, 1), tz),
        localStartDate: b.s,
        localEndDate: b.e,
      };
    }
    const [sd, st] = b.s.split('T') as [string, string];
    const [ed, et] = b.e.split('T') as [string, string];
    const startAt = parseLocalDateTime(sd, st, tz);
    const endAt = parseLocalDateTime(ed, et, tz);
    return { id: `${c.id}-${i}`, userId: b.u, allDay: false, startAt, endAt, localStartDate: sd, localEndDate: ed };
  });
}

function run(c: FxCase): FreeDay[] {
  const [winStartMin, winEndMin] = c.window ?? [480, 1320];
  const group: GroupWindow = { tz: c.gtz ?? DEFAULT_TZ, winStartMin, winEndMin, minFreeMin: c.min ?? 120 };
  return commonFreeTime(group, c.members, toBusy(c), c.from, c.to);
}

/** รูปแบบเดียวกับ expected.json */
function shape(days: FreeDay[]): FxDay[] {
  return days.map((d) => ({
    date: d.date,
    free: `${d.freeMembers}/${d.totalMembers}`,
    all_free: d.allFree,
    segments: d.segments.map((s) => `${s.start}-${s.end}(${(s.endAt - s.startAt) / 60_000})`),
  }));
}

describe('ADR 0005 fixtures T1–T24 (cases.json vs expected.json)', () => {
  it('fixture ครบ 26 เคส (T1–T24 + T15a/b/c) และมี expected ครบทุกเคส', () => {
    expect(cases).toHaveLength(26);
    expect(cases.map((c) => c.id)).toEqual(expect.arrayContaining(['T1', 'T15a', 'T15b', 'T15c', 'T24']));
    expect(Object.keys(expected).sort()).toEqual(cases.map((c) => c.id).sort());
  });

  it.each(cases.map((c) => [c.id, c.note, c] as const))('%s: %s', (_id, _note, c) => {
    expect(shape(run(c))).toEqual(expected[c.id]);
  });

  it('oracle.py (Python zoneinfo) ให้ค่าตรง expected.json และตรงกับ lib ทุกเคส', () => {
    const r = spawnSync('python3', ['-I', join(FIX, 'oracle.py'), join(FIX, 'cases.json')], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const oracle = JSON.parse(r.stdout) as Record<string, FxDay[]>;
    expect(oracle).toEqual(expected);
    for (const c of cases) expect(shape(run(c))).toEqual(oracle[c.id]);
  });

  it('segments: instant สอดคล้องกับ HH:MM และ 24:00 เฉพาะปลายหน้าต่างเที่ยงคืนถัดไป (T5, T22)', () => {
    const t5 = run(cases.find((c) => c.id === 'T5')!);
    expect(t5[1]!.segments[0]).toMatchObject({ start: '02:00', end: '24:00' });
    expect(t5[1]!.segments[0]!.endAt).toBe(startOfDay('2025-01-02', DEFAULT_TZ));
    const t22 = run(cases.find((c) => c.id === 'T22')!);
    expect(t22[0]!.segments).toHaveLength(1);
    expect(t22[0]!.segments[0]).toMatchObject({ start: '03:00', end: '24:00' });
    // ช่วง 00:00–00:30 (30 นาที) ถูกทิ้ง และวันยาว 23 ชม.
    expect(t22[0]!.segments[0]!.endAt - t22[0]!.segments[0]!.startAt).toBe(21 * 3_600_000);
  });
});

describe('blockers / freeMemberIds (ข้อมูลดิบ ไม่กรอง)', () => {
  const c = (id: string) => cases.find((x) => x.id === id)!;

  it('T1: B ติด all-day → blocker; A มี busy แต่ยังเหลือช่วง ≥ ขั้นต่ำ = ว่าง (2/3)', () => {
    const [d] = run(c('T1'));
    expect(d!.freeMemberIds).toEqual(['A', 'C']);
    expect(d!.blockers).toHaveLength(1);
    expect(d!.blockers[0]!.userId).toBe('B');
    expect(d!.blockers[0]!.blocks).toEqual([expect.objectContaining({ id: 'T1-1', allDay: true, userId: 'B' })]);
  });

  it('T24: ทุกคนว่างรายคนแต่ไม่ว่างร่วม → ไม่มี blockers, allFree=false', () => {
    const [d] = run(c('T24'));
    expect(d).toMatchObject({ freeMembers: 3, totalMembers: 3, allFree: false, segments: [], blockers: [] });
  });

  it('T13: A ติดเพราะเหลือช่วงสั้นกว่าขั้นต่ำ → A เป็น blocker ด้วย timed block', () => {
    const [d] = run(c('T13'));
    expect(d!.blockers).toHaveLength(1);
    expect(d!.blockers[0]).toMatchObject({ userId: 'A' });
  });

  it('T16: super admin (ไม่ใช่สมาชิก) ไม่ปรากฏใน blockers/นับ', () => {
    const [d] = run(c('T16'));
    expect(d!.blockers).toEqual([]);
    expect(d!.totalMembers).toBe(3);
  });

  it('สมาชิกซ้ำใน members ถูกนับครั้งเดียว · busy zero-length ไม่เป็น blocker', () => {
    const group: GroupWindow = { tz: DEFAULT_TZ, winStartMin: 480, winEndMin: 1320, minFreeMin: 120 };
    const t = parseLocalDateTime('2026-05-05', '12:00', DEFAULT_TZ);
    const busy: FreeTimeBusyInput[] = [
      { id: 'z', userId: 'A', allDay: false, startAt: t, endAt: t, localStartDate: '2026-05-05', localEndDate: '2026-05-05' },
    ];
    const [d] = commonFreeTime(group, ['A', 'A', 'B'], busy, '2026-05-05', '2026-05-05');
    expect(d).toMatchObject({ totalMembers: 2, freeMembers: 2, allFree: true, blockers: [] });
  });
});

describe('subtract / overlapsRange', () => {
  it('subtract: ไม่เรียง/ซ้อน/นอกหน้าต่าง/ยาวศูนย์', () => {
    expect(
      subtract(100, 200, [
        { start: 150, end: 160 },
        { start: 120, end: 155 },
        { start: 50, end: 110 },
        { start: 180, end: 180 },
        { start: 190, end: 400 },
        { start: 500, end: 600 },
      ]),
    ).toEqual([{ start: 110, end: 120 }, { start: 160, end: 190 }]);
    expect(subtract(0, 10, [])).toEqual([{ start: 0, end: 10 }]);
    expect(subtract(0, 10, [{ start: -5, end: 15 }])).toEqual([]);
  });

  it('overlapsRange: ครึ่งเปิด — แตะขอบไม่ทับ', () => {
    expect(overlapsRange(0, 10, 10, 20)).toBe(false);
    expect(overlapsRange(10, 20, 0, 10)).toBe(false);
    expect(overlapsRange(0, 11, 10, 20)).toBe(true);
    expect(overlapsRange(0, 100, 10, 20)).toBe(true);
  });
});

describe('membersBlockedDuring (ADR 0005 §4 / U10.1)', () => {
  const at = (d: string, t: string, tz = DEFAULT_TZ) => parseLocalDateTime(d, t, tz);
  const timed = (id: string, userId: string, d: string, s: string, e: string, tz = DEFAULT_TZ): FreeTimeBusyInput => ({
    id,
    userId,
    allDay: false,
    startAt: at(d, s, tz),
    endAt: at(d, e, tz),
    localStartDate: d,
    localEndDate: d,
  });
  const allDay = (id: string, userId: string, s: string, e: string): FreeTimeBusyInput => ({
    id,
    userId,
    allDay: true,
    startAt: startOfDay(s, DEFAULT_TZ),
    endAt: startOfDay(addDays(e, 1), DEFAULT_TZ),
    localStartDate: s,
    localEndDate: e,
  });
  const ids = (r: ReturnType<typeof membersBlockedDuring>) => r.map((x) => x.userId);
  const D = '2026-11-02';

  it('นัด 11:00–13:00 กับ busy A 10:00–12:00 → A', () => {
    const r = membersBlockedDuring(at(D, '11:00'), at(D, '13:00'), DEFAULT_TZ, ['A', 'B', 'C'], [timed('a', 'A', D, '10:00', '12:00')]);
    expect(ids(r)).toEqual(['A']);
    expect(r[0]!.blocks.map((b) => b.id)).toEqual(['a']);
  });

  it('นัดวันที่ B ติดทั้งวัน → B', () => {
    expect(ids(membersBlockedDuring(at(D, '11:00'), at(D, '13:00'), DEFAULT_TZ, ['A', 'B', 'C'], [allDay('b', 'B', D, D)]))).toEqual(['B']);
  });

  it('นัด 12:00–14:00 กับ busy A ที่จบ 12:00 → ไม่เตือน', () => {
    expect(membersBlockedDuring(at(D, '12:00'), at(D, '14:00'), DEFAULT_TZ, ['A', 'B', 'C'], [timed('a', 'A', D, '10:00', '12:00')])).toEqual([]);
    // และ busy ที่เริ่มตอนนัดจบพอดี
    expect(membersBlockedDuring(at(D, '10:00'), at(D, '12:00'), DEFAULT_TZ, ['A'], [timed('a', 'A', D, '12:00', '13:00')])).toEqual([]);
  });

  it('นัดข้ามเที่ยงคืน: all-day ของวันที่สองก็นับ · นัดจบเที่ยงคืนพอดีไม่แตะวันถัดไป', () => {
    const next = '2026-11-03';
    const appt = [at(D, '22:00'), at(next, '01:00')] as const;
    expect(ids(membersBlockedDuring(appt[0], appt[1], DEFAULT_TZ, ['A', 'B'], [allDay('x', 'B', next, next)]))).toEqual(['B']);
    expect(membersBlockedDuring(at(D, '22:00'), at(next, '00:00'), DEFAULT_TZ, ['A', 'B'], [allDay('x', 'B', next, next)])).toEqual([]);
  });

  it('all-day หลายวันที่ครอบนัดบางส่วน · คนนอก members ถูกเมิน · ลำดับตาม members · รวมหลาย block ต่อคน', () => {
    const blocks = [
      allDay('m', 'C', '2026-10-30', '2026-11-02'),
      timed('t1', 'A', D, '09:00', '11:30'),
      timed('t2', 'A', D, '12:30', '15:00'),
      timed('s', 'S', D, '09:00', '18:00'),
    ];
    const r = membersBlockedDuring(at(D, '11:00'), at(D, '13:00'), DEFAULT_TZ, ['C', 'A', 'B'], blocks);
    expect(ids(r)).toEqual(['C', 'A']);
    expect(r[1]!.blocks.map((b) => b.id)).toEqual(['t1', 't2']);
  });

  it('วันท้องถิ่นตาม tz ที่ส่งเข้ามา (นัด 01:00 ICT = 18:00Z วันก่อน)', () => {
    const start = at('2026-11-03', '01:00');
    const end = at('2026-11-03', '02:00');
    // all-day ของวันที่ 11-02 ไม่ทับในมุม Bangkok แต่ทับในมุม UTC
    expect(membersBlockedDuring(start, end, 'Asia/Bangkok', ['A'], [allDay('x', 'A', '2026-11-02', '2026-11-02')])).toEqual([]);
    expect(ids(membersBlockedDuring(start, end, 'UTC', ['A'], [allDay('x', 'A', '2026-11-02', '2026-11-02')]))).toEqual(['A']);
  });

  it('endAt ≤ startAt → INVALID_RANGE', () => {
    expect(() => membersBlockedDuring(5, 5, DEFAULT_TZ, [], [])).toThrowError(expect.objectContaining({ code: 'INVALID_RANGE' }));
  });
});

describe('ช่วงวันที่ ≤ 62 วัน', () => {
  const group: GroupWindow = { tz: DEFAULT_TZ, winStartMin: 480, winEndMin: 1320, minFreeMin: 120 };

  it('62 วันผ่าน · 63 วันถูกปฏิเสธด้วย SPAN_TOO_LONG field=to', () => {
    expect(commonFreeTime(group, ['A'], [], '2026-01-01', '2026-03-03')).toHaveLength(62);
    let err: unknown;
    try {
      commonFreeTime(group, ['A'], [], '2026-01-01', '2026-03-04');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CalendarError);
    expect(err).toMatchObject({ code: 'SPAN_TOO_LONG', field: 'to' });
  });

  it('from > to, วันที่ผิดรูป, ปีนอกช่วง, window ผิด, tz ผิด → ปฏิเสธ', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as CalendarError).code;
      }
      return 'NONE';
    };
    expect(code(() => commonFreeTime(group, [], [], '2026-02-02', '2026-02-01'))).toBe('INVALID_RANGE');
    expect(code(() => commonFreeTime(group, [], [], '2026-02-30', '2026-03-01'))).toBe('INVALID_DATE');
    expect(code(() => commonFreeTime(group, [], [], '2569-02-01', '2569-02-02'))).toBe('DATE_OUT_OF_RANGE');
    expect(code(() => commonFreeTime({ ...group, winStartMin: 600, winEndMin: 600 }, [], [], '2026-02-01', '2026-02-01'))).toBe('INVALID_RANGE');
    expect(code(() => commonFreeTime({ ...group, tz: 'Mars/Base' }, [], [], '2026-02-01', '2026-02-01'))).toBe('INVALID_TZ');
  });

  it('ไม่มีสมาชิก → วันละ 0/0, allFree ตามหน้าต่าง (ไม่มี blockers)', () => {
    const [d] = commonFreeTime(group, [], [], '2026-02-01', '2026-02-01');
    expect(d).toMatchObject({ freeMembers: 0, totalMembers: 0, blockers: [] });
  });
});

describe('ประสิทธิภาพ (R4A-6): 50 คน × 62 วัน × ~20 busy ต่อคน', () => {
  it('คำนวณ < 200 ms', () => {
    let a = 12345;
    const rand = () => {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
      return a / 4294967296;
    };
    const group: GroupWindow = { tz: DEFAULT_TZ, winStartMin: 480, winEndMin: 1320, minFreeMin: 120 };
    const from = '2026-11-01';
    const to = addDays(from, 61);
    const base = startOfDay(from, DEFAULT_TZ);
    const members = Array.from({ length: 50 }, (_, i) => `u${i}`);
    const busy: FreeTimeBusyInput[] = [];
    for (const u of members) {
      for (let k = 0; k < 20; k++) {
        const startAt = base + Math.floor(rand() * 62 * 48) * 1_800_000;
        const endAt = startAt + (1 + Math.floor(rand() * 8)) * 1_800_000;
        busy.push({ id: `${u}-${k}`, userId: u, allDay: false, startAt, endAt, localStartDate: from, localEndDate: from });
      }
    }
    commonFreeTime(group, members, busy, from, to); // warm-up (JIT, tz cache)
    const t0 = performance.now();
    const out = commonFreeTime(group, members, busy, from, to);
    const ms = performance.now() - t0;
    console.log(`commonFreeTime 50 members x 62 days x 20 busy = ${ms.toFixed(1)} ms (${busy.length} blocks)`);
    expect(out).toHaveLength(62);
    expect(ms).toBeLessThan(200);
  });
});
