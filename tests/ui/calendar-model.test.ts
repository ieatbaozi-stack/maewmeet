// view-model ของแท็บปฏิทิน (R3): จุดในช่องวัน · ตารางเดือน · ช่วงข้ามเที่ยงคืน · ป้ายเวลา · รายการของฉัน
import { describe, expect, it } from 'vitest';
import { parseLocalDateTime } from '@/lib/calendar';
import {
  buildMonth,
  busyUsersByDate,
  dayRows,
  dotLayout,
  groupMineByMonth,
  hhmm,
  isOngoing,
  joinNames,
  nearLimit,
  nowPercent,
  segmentLabel,
  segmentOn,
  segmentTitle,
  shiftMonth,
  spanOf,
  stripBox,
  whenPartsOfOwn,
  whenRef,
  type OwnBusy,
  type SharedBusy,
} from '@/components/calendar/model';

const TZ = 'Asia/Bangkok';
const at = (d: string, t: string) => parseLocalDateTime(d, t, TZ);
const timed = (id: string, userId: string, sd: string, st: string, ed: string, et: string, title?: string): SharedBusy => ({
  id,
  userId,
  allDay: false,
  startAt: at(sd, st),
  endAt: at(ed, et),
  localStartDate: sd,
  localEndDate: ed,
  tz: TZ,
  ...(title ? { title } : {}),
});
const allDay = (id: string, userId: string, sd: string, ed: string): SharedBusy => ({
  id,
  userId,
  allDay: true,
  startAt: at(sd, '00:00'),
  endAt: at(ed, '23:59'),
  localStartDate: sd,
  localEndDate: ed,
  tz: TZ,
});

describe('dotLayout — จุดสมาชิกต่อช่องวัน', () => {
  it('≤ 8 = จุดครบ ไม่มี +N', () => {
    for (const n of [0, 1, 7, 8]) expect(dotLayout(n)).toEqual({ shown: n, more: 0, wide: false });
  });
  it('9–15 = 6 จุด + (n−6)', () => {
    expect(dotLayout(9)).toEqual({ shown: 6, more: 3, wide: false });
    expect(dotLayout(15)).toEqual({ shown: 6, more: 9, wide: false });
  });
  it('≥ 16 = 5 จุด + (n−5) แบบกว้าง', () => {
    expect(dotLayout(16)).toEqual({ shown: 5, more: 11, wide: true });
  });
  it('ค่าติดลบ/ทศนิยม ไม่พัง', () => {
    expect(dotLayout(-3).shown).toBe(0);
    expect(dotLayout(2.9).shown).toBe(2);
  });
});

describe('buildMonth / shiftMonth', () => {
  it('ต.ค. 2569(2026) = 5 สัปดาห์ เริ่มจันทร์ 28 ก.ย. จบอาทิตย์ 1 พ.ย.', () => {
    const m = buildMonth(2026, 10, '2026-10-20');
    expect(m.weeks).toBe(5);
    expect(m.cells).toHaveLength(35);
    expect(m.from).toBe('2026-09-28');
    expect(m.to).toBe('2026-11-01');
    expect(m.cells[0]).toMatchObject({ date: '2026-09-28', outside: true });
    expect(m.cells.filter((c) => c.today).map((c) => c.date)).toEqual(['2026-10-20']);
    expect(m.cells.filter((c) => !c.outside)).toHaveLength(31);
  });
  it('ก.พ. 2027 = 4 สัปดาห์ · ส.ค. 2026 = 6 สัปดาห์ · ช่วงดึงข้อมูล ≤ 62 วัน', () => {
    expect(buildMonth(2027, 2, '2027-02-01').weeks).toBe(4);
    const aug = buildMonth(2026, 8, '2026-08-01');
    expect(aug.weeks).toBe(6);
    expect(aug.cells).toHaveLength(42);
  });
  it('ธ.ค. ข้ามปี: ช่องท้ายเป็น 1 ม.ค. ของปีถัดไป (นอกเดือน)', () => {
    const m = buildMonth(2026, 12, '2026-12-01');
    expect(m.to.startsWith('2027-01')).toBe(true);
    expect(m.cells[m.cells.length - 1]?.outside).toBe(true);
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
  });
});

describe('spanOf / segmentOn — ช่วงข้ามเที่ยงคืน เดือน ปี', () => {
  it('timed ข้ามคืน: วันแรกตัดท้าย วันถัดไปตัดต้น', () => {
    const span = spanOf(timed('a', 'u1', '2026-10-23', '20:00', '2026-10-24', '02:00'), TZ);
    expect(segmentOn(span, '2026-10-23')).toMatchObject({ from: 1200, to: 1440, cutStart: false, cutEnd: true });
    expect(segmentOn(span, '2026-10-24')).toMatchObject({ from: 0, to: 120, cutStart: true, cutEnd: false });
    expect(segmentOn(span, '2026-10-22')).toBeNull();
    expect(segmentOn(span, '2026-10-25')).toBeNull();
  });
  it('จบเที่ยงคืนพอดี = วันสุดท้ายคือวันก่อนหน้า (ถึง 24:00)', () => {
    const span = spanOf(timed('a', 'u1', '2026-10-23', '20:00', '2026-10-24', '00:00'), TZ);
    expect(span.lastDate).toBe('2026-10-23');
    expect(segmentOn(span, '2026-10-23')).toMatchObject({ from: 1200, to: 1440, cutEnd: false });
    expect(segmentOn(span, '2026-10-24')).toBeNull();
  });
  it('ข้ามเดือนและข้ามปี', () => {
    const span = spanOf(timed('a', 'u1', '2026-12-31', '22:00', '2027-01-01', '03:00'), TZ);
    expect(segmentOn(span, '2026-12-31')?.cutEnd).toBe(true);
    expect(segmentOn(span, '2027-01-01')).toMatchObject({ from: 0, to: 180, cutStart: true });
  });
  it('ทั้งวันหลายวัน: dayN/dayTotal', () => {
    const span = spanOf(allDay('a', 'u1', '2026-10-29', '2026-10-31'), TZ);
    expect(segmentOn(span, '2026-10-30')).toMatchObject({ dayN: 2, dayTotal: 3, from: 0, to: 1440 });
  });
});

describe('busyUsersByDate / dayRows / stripBox', () => {
  const spans = [
    spanOf(allDay('a', 'u1', '2026-10-29', '2026-11-02'), TZ),
    spanOf(timed('b', 'u2', '2026-10-30', '09:00', '2026-10-30', '10:00'), TZ),
    spanOf(timed('c', 'u1', '2026-10-30', '08:00', '2026-10-30', '08:30'), TZ),
  ];
  it('คนเดียวกันหลายรายการ นับครั้งเดียวต่อวัน และตัดตามช่วง [from,to]', () => {
    const map = busyUsersByDate(spans, '2026-10-30', '2026-10-31');
    expect([...map.keys()]).toEqual(['2026-10-30', '2026-10-31']);
    expect([...(map.get('2026-10-30') ?? [])].sort()).toEqual(['u1', 'u2']);
    expect([...(map.get('2026-10-31') ?? [])]).toEqual(['u1']);
  });
  it('dayRows คงลำดับสมาชิก · segments เรียงตามเวลาเริ่ม · คนไม่ติด = ว่างเปล่า', () => {
    const members = [
      { userId: 'u1', displayName: 'A', colorIndex: 0 },
      { userId: 'u2', displayName: 'B', colorIndex: 1 },
      { userId: 'u3', displayName: 'C', colorIndex: 2 },
    ];
    const rows = dayRows(members, spans, '2026-10-30');
    expect(rows.map((r) => r.member.userId)).toEqual(['u1', 'u2', 'u3']);
    expect(rows[0]?.segments.map((s) => s.item.id)).toEqual(['a', 'c']);
    expect(rows[2]?.segments).toEqual([]);
  });
  it('stripBox / nowPercent / hhmm', () => {
    expect(stripBox({ from: 0, to: 1440 })).toEqual({ start: '0.00%', width: '100.00%' });
    expect(stripBox({ from: 720, to: 1080 })).toEqual({ start: '50.00%', width: '25.00%' });
    expect(nowPercent(2000)).toBe('100.00%');
    expect(hhmm(0)).toBe('00:00');
    expect(hhmm(570)).toBe('09:30');
    expect(hhmm(1440)).toBe('24:00');
  });
});

describe('segmentLabel / segmentTitle — ซ่อนหรือไม่มี title = "ไม่ว่าง"', () => {
  const span = spanOf(timed('a', 'u1', '2026-10-23', '20:00', '2026-10-24', '02:00'), TZ);
  it('ป้ายเวลา', () => {
    expect(segmentLabel(segmentOn(span, '2026-10-23')!).ref).toEqual({ key: 'calendar.day.toNext', values: { start: '20:00' } });
    expect(segmentLabel(segmentOn(span, '2026-10-24')!).ref).toEqual({ key: 'calendar.day.fromPrev', values: { end: '02:00' } });
    const one = spanOf(timed('b', 'u1', '2026-10-23', '09:00', '2026-10-23', '10:30'), TZ);
    expect(segmentLabel(segmentOn(one, '2026-10-23')!).ref).toEqual({ key: 'calendar.day.range', values: { start: '09:00', end: '10:30' } });
    const mid = spanOf(timed('c', 'u1', '2026-10-22', '20:00', '2026-10-25', '02:00'), TZ);
    expect(segmentLabel(segmentOn(mid, '2026-10-23')!).ref.key).toBe('calendar.day.allDay');
  });
  it('ทั้งวันหลายวันมีป้าย "วันที่ n จาก m"', () => {
    const sp = spanOf(allDay('a', 'u1', '2026-10-29', '2026-10-31'), TZ);
    expect(segmentLabel(segmentOn(sp, '2026-10-30')!).dayOf).toEqual({ key: 'calendar.day.dayOf', values: { n: 2, total: 3 } });
    const single = spanOf(allDay('b', 'u1', '2026-10-29', '2026-10-29'), TZ);
    expect(segmentLabel(segmentOn(single, '2026-10-29')!).dayOf).toBeNull();
  });
  it('title ว่าง/ไม่มี → null', () => {
    expect(segmentTitle(segmentOn(span, '2026-10-23')!)).toBeNull();
    const t = spanOf(timed('d', 'u1', '2026-10-23', '09:00', '2026-10-23', '10:00', 'ซ้อมดนตรี'), TZ);
    expect(segmentTitle(segmentOn(t, '2026-10-23')!)).toBe('ซ้อมดนตรี');
  });
});

describe('whenRef — ข้อความ "เมื่อไร"', () => {
  it('ทั้งวันวันเดียว / หลายวัน', () => {
    expect(whenRef({ allDay: true, startDate: '2026-11-07', endDate: '2026-11-07' }, 'en').key).toBe('busy.when.allDay');
    const r = whenRef({ allDay: true, startDate: '2026-10-29', endDate: '2026-10-31' }, 'en');
    expect(r.key).toBe('busy.when.days');
    expect(r.values.count).toBe(3);
  });
  it('ช่วงเวลา: วันเดียว · ข้ามคืน · จบเที่ยงคืนพอดี = 24:00', () => {
    expect(whenRef({ allDay: false, startDate: '2026-10-20', endDate: '2026-10-20', startTime: '19:00', endTime: '21:00' }, 'en').key).toBe('busy.when.timed');
    expect(whenRef({ allDay: false, startDate: '2026-10-23', endDate: '2026-10-24', startTime: '20:00', endTime: '02:00' }, 'en').key).toBe('busy.when.timedSpan');
    const mid = whenRef({ allDay: false, startDate: '2026-10-23', endDate: '2026-10-24', startTime: '20:00', endTime: '00:00' }, 'en');
    expect(mid.key).toBe('busy.when.timed');
    expect(mid.values.end).toBe('24:00');
  });
  it('whenPartsOfOwn อ่านเวลาใน tz ของรายการ', () => {
    const own: OwnBusy = { id: 'x', allDay: false, startAt: at('2026-10-20', '19:00'), endAt: at('2026-10-20', '21:00'), localStartDate: '2026-10-20', localEndDate: '2026-10-20', tz: TZ, title: null, note: null, hidden: false };
    expect(whenPartsOfOwn(own)).toMatchObject({ startDate: '2026-10-20', startTime: '19:00', endTime: '21:00' });
  });
});

describe('รายการของฉัน', () => {
  const own = (id: string, sd: string, st: string, ed: string, et: string): OwnBusy => ({
    id, allDay: false, startAt: at(sd, st), endAt: at(ed, et), localStartDate: sd, localEndDate: ed, tz: TZ, title: null, note: null, hidden: false,
  });
  it('groupMineByMonth เรียงตามเวลาเริ่ม แล้วแยกเดือน', () => {
    const g = groupMineByMonth([own('c', '2026-11-07', '09:00', '2026-11-07', '10:00'), own('a', '2026-10-20', '19:00', '2026-10-20', '21:00'), own('b', '2026-10-23', '20:00', '2026-10-24', '02:00')]);
    expect(g.map((x) => x.month)).toEqual(['2026-10-01', '2026-11-01']);
    expect(g[0]?.items.map((i) => i.id)).toEqual(['a', 'b']);
  });
  it('isOngoing เป็นช่วงปิด-เปิด · nearLimit ≥ 90%', () => {
    const it = { startAt: 100, endAt: 200 };
    expect(isOngoing(it, 100)).toBe(true);
    expect(isOngoing(it, 200)).toBe(false);
    expect(isOngoing(it, 99)).toBe(false);
    expect(nearLimit(269, 300)).toBe(false);
    expect(nearLimit(270, 300)).toBe(true);
    expect(nearLimit(5, 0)).toBe(false);
  });
});

describe('joinNames — ตัวคั่นแน่นอนทั้ง Node/เบราว์เซอร์', () => {
  it('ไทย ไม่ใช้จุลภาค', () => {
    expect(joinNames(['ก', 'ข', 'ค'], 'และ', 'th')).toBe('ก ข และค');
    expect(joinNames(['ก', 'ข'], 'และ', 'th')).toBe('ก และข');
  });
  it('อังกฤษ', () => {
    expect(joinNames(['A', 'B', 'C'], 'and', 'en')).toBe('A, B and C');
    expect(joinNames(['A'], 'and', 'en')).toBe('A');
    expect(joinNames([], 'and', 'en')).toBe('');
  });
});
