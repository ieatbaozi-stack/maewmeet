// view-model ของมุมมอง "ว่างตรงกัน" (R4A, UX §8): สถานะช่องวัน (T24) · สรุปบนสุด/วันใกล้เคียง · ช่วงที่ยาวที่สุด · ป้ายต่อจากเมื่อวาน · รายการซ่อน · วันที่ผ่านแล้ว · ตัดช่วง 2000–2100
import { describe, expect, it } from 'vitest';
import { parseLocalDateTime } from '@/lib/calendar';
import { buildMonth, type MemberInfo, type SharedBusy } from '@/components/calendar/model';
import {
  classifyDay,
  clockOf,
  closestDay,
  dayBlockers,
  dayMap,
  defaultPanelDate,
  durationMsg,
  earliestAllFree,
  entryOf,
  fetchRange,
  isSelectable,
  longestSegment,
  nameParts,
  namesOf,
  nobodyLoggedBusy,
  planFromDate,
  urlDayParam,
  partialLevel,
  segmentMinutes,
  showsFraction,
  statusVariant,
  summarize,
  weekdayDate,
  type AvDay,
  type AvSegment,
} from '@/components/availability/model';

const TZ = 'Asia/Bangkok';
const at = (d: string, t: string) => parseLocalDateTime(d, t, TZ);
const seg = (d: string, s: string, e: string): AvSegment => ({ startAt: at(d, s), endAt: e === '24:00' ? at(d, '23:59') + 60_000 : at(d, e), start: s, end: e });
const day = (date: string, free: number, total: number, o: Partial<AvDay> = {}): AvDay => ({
  date,
  freeMembers: free,
  totalMembers: total,
  allFree: false,
  notFreeUserIds: [],
  segments: [],
  blockers: [],
  ...o,
});
const allFree = (date: string, total: number, segments: AvSegment[]): AvDay => day(date, total, total, { allFree: true, segments });
const M = (id: string, name: string, colorIndex = 0): MemberInfo => ({ userId: id, displayName: name, colorIndex });
const item = (id: string, userId: string, o: Partial<SharedBusy>): SharedBusy => ({
  id,
  userId,
  allDay: false,
  startAt: 0,
  endAt: 0,
  localStartDate: '2026-10-25',
  localEndDate: '2026-10-25',
  tz: TZ,
  ...o,
});

const TODAY = '2026-10-20';

describe('classifyDay — ลำดับ past → all → none → nocommon → partial', () => {
  it('past: วันที่ < วันนี้ เป็นกลาง ไม่ว่าข้อมูลเป็นอะไร (แม้ allFree)', () => {
    expect(classifyDay(allFree('2026-10-19', 3, [seg('2026-10-19', '08:00', '22:00')]), TODAY).state).toBe('past');
    expect(classifyDay(day('2026-10-01', 0, 3), TODAY).state).toBe('past');
  });
  it('วันนี้ไม่ใช่ past', () => {
    expect(classifyDay(day(TODAY, 2, 3), TODAY).state).toBe('partial');
  });
  it('all = allFree', () => {
    expect(classifyDay(allFree('2026-10-25', 6, [seg('2026-10-25', '16:00', '22:00')]), TODAY)).toEqual({ state: 'all', level: null });
  });
  it('T24: ว่างครบทุกคนแต่ allFree=false → nocommon (ไม่ใช่ all)', () => {
    const c = classifyDay(day('2026-10-26', 3, 3), TODAY);
    expect(c.state).toBe('nocommon');
    expect(showsFraction(c.state)).toBe(true); // ต้องมีตัวเลข n/n ต่างจาก all
    expect(showsFraction('all')).toBe(false);
    expect(statusVariant(day('2026-10-26', 3, 3))).toBe('nocommon');
  });
  it('none: ว่าง 0 → 0/Y', () => {
    expect(classifyDay(day('2026-10-24', 0, 6), TODAY).state).toBe('none');
    expect(statusVariant(day('2026-10-24', 0, 6))).toBe('none');
  });
  it('partial: ระดับ < 50% few · 50–74% low · ≥ 75% mid', () => {
    expect(partialLevel(2, 6)).toBe('few');
    expect(partialLevel(2, 5)).toBe('few'); // 40%
    expect(partialLevel(3, 6)).toBe('low'); // เท่ากับ 50% พอดี = low
    expect(partialLevel(4, 6)).toBe('low'); // 66%
    expect(partialLevel(3, 4)).toBe('mid'); // 75% พอดี = mid
    expect(partialLevel(5, 6)).toBe('mid');
    expect(classifyDay(day('2026-10-22', 4, 6), TODAY)).toEqual({ state: 'partial', level: 'low' });
  });
  it('คนเดียว 1/1 ที่ allFree=false → nocommon (ไม่ใช่ none/partial)', () => {
    expect(classifyDay(day('2026-10-22', 1, 1), TODAY).state).toBe('nocommon');
  });
  it('past กดไม่ได้ · ไม่มีข้อมูล (นอก 2000–2100) กดไม่ได้ · อื่นๆ กดได้', () => {
    expect(isSelectable(classifyDay(day('2026-10-19', 3, 3), TODAY))).toBe(false);
    expect(isSelectable(null)).toBe(false);
    for (const d of [allFree('2026-10-25', 2, [seg('2026-10-25', '08:00', '10:00')]), day('2026-10-26', 2, 2), day('2026-10-27', 0, 2), day('2026-10-28', 1, 2)]) {
      expect(isSelectable(classifyDay(d, TODAY))).toBe(true);
    }
  });
});

describe('ช่วงที่ยาวที่สุด / ระยะเวลา', () => {
  const s1 = seg('2026-10-25', '08:00', '10:00'); // 2 ชม.
  const s2 = seg('2026-10-25', '12:00', '14:00'); // 2 ชม.
  const s3 = seg('2026-10-25', '16:00', '22:00'); // 6 ชม.
  it('ยาวสุดชนะ', () => {
    expect(longestSegment([s1, s2, s3])).toBe(s3);
    expect(longestSegment([s3, s1])).toBe(s3);
  });
  it('เท่ากัน → ช่วงเช้ากว่า (ไม่ว่าลำดับใน array)', () => {
    expect(longestSegment([s2, s1])).toBe(s1);
    expect(longestSegment([s1, s2])).toBe(s1);
  });
  it('ว่าง → null', () => expect(longestSegment([])).toBeNull());
  it('segmentMinutes ใช้ instant (ชม. จริง)', () => {
    expect(segmentMinutes(s3)).toBe(360);
    expect(segmentMinutes({ startAt: at('2026-10-25', '09:00'), endAt: at('2026-10-25', '09:30') })).toBe(30);
  });
  it('durationMsg → busy.duration.*', () => {
    expect(durationMsg(30)).toEqual({ key: 'busy.duration.min', values: { minutes: 30 } });
    expect(durationMsg(120)).toEqual({ key: 'busy.duration.hour', values: { hours: 2 } });
    expect(durationMsg(150)).toEqual({ key: 'busy.duration.hourMin', values: { hours: 2, minutes: 30 } });
  });
  it('clockOf: 1440 → 24:00', () => {
    expect(clockOf(480)).toBe('08:00');
    expect(clockOf(1320)).toBe('22:00');
    expect(clockOf(1440)).toBe('24:00');
  });
});

describe('สรุปบนสุด: วันแรกที่ว่างร่วม / ใกล้เคียงที่สุด (X37, X38)', () => {
  const week = [
    allFree('2026-10-18', 6, [seg('2026-10-18', '08:00', '22:00')]), // ผ่านไปแล้ว — ไม่นับ
    day('2026-10-20', 6, 6), // T24 วันนี้
    day('2026-10-21', 5, 6, { notFreeUserIds: ['p'] }),
    day('2026-10-22', 4, 6),
    allFree('2026-10-25', 6, [seg('2026-10-25', '08:00', '10:00'), seg('2026-10-25', '16:00', '22:00')]),
    allFree('2026-10-28', 6, [seg('2026-10-28', '08:00', '10:00')]),
  ];
  it('earliestAllFree ข้ามวันที่ผ่านแล้ว', () => {
    expect(earliestAllFree(week, TODAY)?.date).toBe('2026-10-25');
    expect(earliestAllFree(week, '2026-10-26')?.date).toBe('2026-10-28');
    expect(earliestAllFree(week, '2026-10-29')).toBeNull();
  });
  it('allFree วันนี้ → relativeDays 0', () => {
    const s = summarize([allFree(TODAY, 3, [seg(TODAY, '08:00', '22:00')])], TODAY);
    expect(s.kind === 'first' && s.relativeDays).toBe(0);
  });
  it('first: relativeDays + ช่วงที่ยาวสุด + จำนวนวันว่างร่วม (>= วันนี้)', () => {
    const s = summarize(week, TODAY);
    if (s.kind !== 'first') throw new Error('expected first');
    expect(s.day.date).toBe('2026-10-25');
    expect(s.relativeDays).toBe(5);
    expect(s.longest.start).toBe('16:00');
    expect(s.count).toBe(2); // 25 และ 28 (18 ผ่านแล้วไม่นับ)
  });
  it('none: ไม่มีวันว่างร่วม → วันใกล้เคียง (ว่างมากสุด เท่ากันเอาวันก่อน)', () => {
    const days = [day('2026-10-19', 6, 6), day('2026-10-21', 4, 6), day('2026-10-22', 5, 6, { notFreeUserIds: ['palm'] }), day('2026-10-23', 5, 6, { notFreeUserIds: ['oat'] })];
    expect(closestDay(days, TODAY)?.date).toBe('2026-10-22'); // 19 ผ่านแล้ว · 22 กับ 23 เท่ากัน เอา 22
    const s = summarize(days, TODAY);
    expect(s).toMatchObject({ kind: 'none', closestNoOverlap: false, closestBlockerIds: ['palm'] });
  });
  it('none: วันใกล้เคียงเป็น T24 (ทุกคนว่างแต่ไม่ตรง) → closestNoOverlap', () => {
    const s = summarize([day('2026-10-22', 4, 6), day('2026-10-23', 6, 6)], TODAY);
    expect(s).toMatchObject({ kind: 'none', closestNoOverlap: true });
    expect(s.kind === 'none' && s.closest?.date).toBe('2026-10-23');
  });
  it('ไม่มีใครว่างเลยทั้งช่วง → closest=null · ช่วงล้วนผ่านแล้ว → closest=null', () => {
    expect(closestDay([day('2026-10-22', 0, 3), day('2026-10-23', 0, 3)], TODAY)).toBeNull();
    expect(summarize([day('2026-10-01', 3, 3)], TODAY)).toMatchObject({ kind: 'none', closest: null });
    expect(summarize([], TODAY)).toMatchObject({ kind: 'none', closest: null, closestNoOverlap: false });
  });
  it('วันตั้งต้นของแผงขวา: วันแรกที่ว่างร่วม → ใกล้เคียง → วันแรกที่กดได้', () => {
    expect(defaultPanelDate(week, TODAY)).toBe('2026-10-25');
    expect(defaultPanelDate([day('2026-10-22', 3, 6), day('2026-10-23', 5, 6)], TODAY)).toBe('2026-10-23');
    expect(defaultPanelDate([day('2026-10-01', 3, 3), day('2026-10-22', 0, 3)], TODAY)).toBe('2026-10-22');
    expect(defaultPanelDate([day('2026-10-01', 3, 3)], TODAY)).toBeNull();
  });
  it('nobodyLoggedBusy: ทุกวันไม่มี blockers เท่านั้น', () => {
    expect(nobodyLoggedBusy([day('2026-10-22', 3, 3), day('2026-10-23', 3, 3)])).toBe(true);
    expect(nobodyLoggedBusy([day('2026-10-22', 3, 3), day('2026-10-23', 2, 3, { blockers: [{ userId: 'a', itemIdx: [] }] })])).toBe(false);
    expect(nobodyLoggedBusy([])).toBe(false);
  });
  it('dayMap ค้นหาตามวัน', () => {
    expect(dayMap(week).get('2026-10-28')?.freeMembers).toBe(6);
    expect(dayMap(week).has('2026-10-27')).toBe(false);
  });
});

describe('blockers: ต่อจากเมื่อวาน/ต่อไปพรุ่งนี้ · ซ่อน = ไม่ว่าง · ลำดับ', () => {
  const D = '2026-10-25';
  const timed = (id: string, userId: string, sd: string, st: string, ed: string, et: string, extra: Partial<SharedBusy> = {}): SharedBusy =>
    item(id, userId, { startAt: at(sd, st), endAt: at(ed, et), localStartDate: sd, localEndDate: ed, ...extra });

  it('ภายในวันเดียว → range', () => {
    const e = entryOf(timed('1', 'a', D, '10:00', D, '12:00', { title: 'ตัดผม' }), D, TZ);
    expect(e).toMatchObject({ when: { key: 'calendar.day.range', values: { start: '10:00', end: '12:00' } }, title: 'ตัดผม', dayOf: null });
  });
  it('เริ่มเมื่อวาน → fromPrev ถึงเวลาจบ · ข้ามไปพรุ่งนี้ → toNext จากเวลาเริ่ม', () => {
    expect(entryOf(timed('2', 'a', '2026-10-24', '22:00', D, '02:00'), D, TZ)?.when).toEqual({ key: 'calendar.day.fromPrev', values: { end: '02:00' } });
    expect(entryOf(timed('3', 'a', D, '20:00', '2026-10-26', '03:00'), D, TZ)?.when).toEqual({ key: 'calendar.day.toNext', values: { start: '20:00' } });
    // ครอบทั้งวัน (เริ่มก่อน จบหลัง) = ทั้งวัน
    expect(entryOf(timed('4', 'a', '2026-10-24', '20:00', '2026-10-26', '03:00'), D, TZ)?.when.key).toBe('calendar.day.allDay');
  });
  it('คำนวณจากวันที่ท้องถิ่นใน tz กลุ่ม ไม่ใช่ UTC: 23:00 ไทย = 16:00Z วันเดียวกัน แต่ 02:00 ไทย = 19:00Z วันก่อน', () => {
    const it2 = timed('5', 'a', '2026-10-24', '23:00', D, '02:00');
    expect(entryOf(it2, D, TZ)?.when).toEqual({ key: 'calendar.day.fromPrev', values: { end: '02:00' } });
    expect(entryOf(it2, '2026-10-24', TZ)?.when).toEqual({ key: 'calendar.day.toNext', values: { start: '23:00' } });
  });
  it('ทั้งวันหลายวัน → วันที่ n จาก total', () => {
    const it3 = item('6', 'a', { allDay: true, localStartDate: '2026-10-24', localEndDate: '2026-10-26' });
    expect(entryOf(it3, D, TZ)).toMatchObject({ when: { key: 'calendar.day.allDay' }, dayOf: { key: 'calendar.day.dayOf', values: { n: 2, total: 3 } } });
    expect(entryOf(it3, '2026-10-27', TZ)).toBeNull();
  });
  it('รายการซ่อน/ไม่มี title → title = null (UI แสดง "ไม่ว่าง") · title ว่างก็เช่นกัน', () => {
    expect(entryOf(timed('7', 'a', D, '10:00', D, '11:00'), D, TZ)?.title).toBeNull();
    expect(entryOf(timed('8', 'a', D, '10:00', D, '11:00', { title: '' }), D, TZ)?.title).toBeNull();
  });

  const members = [M('me', 'ต้นข้าว'), M('palm', 'ปาล์ม', 1), M('mind', 'มายด์', 2), M('oat', 'โอ๊ต', 3)];
  it('นับว่าไม่ว่างขึ้นก่อน · ที่เหลือตามลำดับสมาชิก · ไม่มีรายการ → noBusy (ไม่ใช่ว่าง)', () => {
    const busy = [
      timed('a', 'me', D, '10:00', D, '12:00', { title: 'ตัดผม' }),
      timed('c', 'palm', D, '14:00', D, '16:00'),
      timed('b', 'palm', D, '08:00', D, '09:00'),
      item('e', 'oat', { allDay: true, localStartDate: D, localEndDate: D }),
    ];
    const d = day(D, 2, 4, {
      notFreeUserIds: ['palm', 'oat'],
      blockers: [
        { userId: 'me', itemIdx: [0] },
        { userId: 'palm', itemIdx: [1, 2] },
        { userId: 'oat', itemIdx: [3] },
      ],
    });
    const r = dayBlockers(d, members, TZ, busy);
    expect(r.rows.map((x) => [x.member.userId, x.flagged])).toEqual([['palm', true], ['oat', true], ['me', false]]);
    expect(r.rows[0]?.entries.map((e) => e.when.values)).toEqual([{ start: '08:00', end: '09:00' }, { start: '14:00', end: '16:00' }]); // เรียงตามเวลา
    expect(r.noBusy.map((m) => m.userId)).toEqual(['mind']);
  });
  it('flagged ที่ไม่มี blockers ก็ยังขึ้นแถว (กันข้อมูลไม่สอดคล้อง) · blockers ว่าง = noBusy ทั้งกลุ่ม', () => {
    expect(dayBlockers(day(D, 3, 4, { notFreeUserIds: ['palm'] }), members, TZ, []).rows.map((x) => x.member.userId)).toEqual(['palm']);
    const empty = dayBlockers(day(D, 4, 4), members, TZ, []);
    expect(empty.rows).toEqual([]);
    expect(empty.noBusy).toHaveLength(4);
  });
  it('รายการที่ไม่ตัดกับวันที่ (ข้อมูลเพี้ยน) ไม่ทำให้แถวพัง', () => {
    const busy = [timed('z', 'me', '2026-10-30', '10:00', '2026-10-30', '11:00')];
    const d = day(D, 3, 4, { blockers: [{ userId: 'me', itemIdx: [0] }] });
    expect(dayBlockers(d, members, TZ, busy).rows).toEqual([]);
  });
  it('ดัชนีนอกช่วง busy[] (ข้อมูลเพี้ยน) ถูกข้าม ไม่ throw', () => {
    const d = day(D, 3, 4, { blockers: [{ userId: 'me', itemIdx: [5, -1] }] });
    expect(dayBlockers(d, members, TZ, []).rows).toEqual([]);
  });
});

describe('รายชื่อ (กติกาชื่อ UX §8.5)', () => {
  it('≤ 3 → ทั้งหมด · > 3 → 3 ชื่อแรก + จำนวนที่เหลือ', () => {
    expect(nameParts(['ก'])).toEqual({ shown: ['ก'], more: 0 });
    expect(nameParts(['ก', 'ข', 'ค'])).toEqual({ shown: ['ก', 'ข', 'ค'], more: 0 });
    expect(nameParts(['ก', 'ข', 'ค', 'ง', 'จ'])).toEqual({ shown: ['ก', 'ข', 'ค'], more: 2 });
    expect(nameParts([])).toEqual({ shown: [], more: 0 });
  });
  it('namesOf เรียงตามลำดับสมาชิก ไม่ใช่ลำดับ id ที่ส่งมา', () => {
    const ms = [M('1', 'ก'), M('2', 'ข'), M('3', 'ค')];
    expect(namesOf(['3', '1'], ms)).toEqual(['ก', 'ค']);
  });
});

describe('วันที่', () => {
  it('weekdayDate ประกอบวันในสัปดาห์ + วัน เดือน จากไลบรารี (พ.ศ. ไม่เกี่ยว — ไม่มีปี)', () => {
    expect(weekdayDate('2026-10-25', 'en', 'long')).toBe('Sunday 25 Oct');
    expect(weekdayDate('2026-10-25', 'en', 'short')).toBe('Sun 25 Oct');
    expect(weekdayDate('2026-10-25', 'th', 'long')).toMatch(/^วันอาทิตย์ 25 ต\.ค\.$/);
  });
  it('fetchRange ตัด 2000-01 / 2100-12 ที่ตารางเดือนล้นปี (API รับ 2000–2100)', () => {
    const jan2000 = buildMonth(2000, 1, TODAY);
    expect(jan2000.from < '2000-01-01').toBe(true);
    expect(fetchRange(jan2000.from, jan2000.to).from).toBe('2000-01-01');
    const dec2100 = buildMonth(2100, 12, TODAY);
    expect(dec2100.to > '2100-12-31').toBe(true);
    expect(fetchRange(dec2100.from, dec2100.to).to).toBe('2100-12-31');
    const oct = buildMonth(2026, 10, TODAY);
    expect(fetchRange(oct.from, oct.to)).toEqual({ from: oct.from, to: oct.to });
  });
});

describe('L1: d= ใน URL เขียนเฉพาะเมื่อผู้ใช้เลือกวันเอง (มุมมอง free)', () => {
  it('free + ยังไม่เลือก → null (ไม่ปักวัน) · เลือกแล้ว → วันที่เลือก · มุมมองอื่น → selected เสมอ', () => {
    expect(urlDayParam('free', null, '2026-10-20')).toBeNull();
    expect(urlDayParam('free', '2026-10-25', '2026-10-20')).toBe('2026-10-25');
    expect(urlDayParam('month', null, '2026-10-20')).toBe('2026-10-20');
    expect(urlDayParam('day', null, '2026-10-21')).toBe('2026-10-21');
  });
});

describe('L2: วันนี้เลยหน้าต่างแล้ว → วางแผนเริ่มพรุ่งนี้', () => {
  const g = { tz: TZ, windowEndMin: 22 * 60 };
  it('ก่อนปลายหน้าต่าง = วันนี้ · ตั้งแต่ปลายหน้าต่าง = พรุ่งนี้', () => {
    expect(planFromDate(TODAY, at(TODAY, '21:59'), g)).toBe(TODAY);
    expect(planFromDate(TODAY, at(TODAY, '22:00'), g)).toBe('2026-10-21');
    expect(planFromDate(TODAY, at(TODAY, '23:30'), g)).toBe('2026-10-21');
  });
  it('หน้าต่างจบ 24:00 ไม่มีวันเลย · today ไม่ตรงวันท้องถิ่นของ nowMs = ไม่ปรับ', () => {
    expect(planFromDate(TODAY, at(TODAY, '23:59'), { tz: TZ, windowEndMin: 1440 })).toBe(TODAY);
    expect(planFromDate('2026-10-19', at(TODAY, '23:00'), g)).toBe('2026-10-19');
  });
  it('ใช้ tz กลุ่ม ไม่ใช่ UTC: 22:30 ไทย = 15:30Z', () => {
    expect(planFromDate(TODAY, at(TODAY, '22:30'), { tz: TZ, windowEndMin: 22 * 60 })).toBe('2026-10-21');
  });
  it('วันนี้ถูกจัดเป็น past เมื่อใช้ planFrom เป็น today (เป็นกลาง ไม่ใช่ ว่างร่วม) · summary เริ่มพรุ่งนี้', () => {
    const from = planFromDate(TODAY, at(TODAY, '23:00'), g);
    const days = [allFree(TODAY, 3, [seg(TODAY, '08:00', '22:00')]), allFree('2026-10-22', 3, [seg('2026-10-22', '08:00', '12:00')])];
    expect(classifyDay(days[0]!, from).state).toBe('past');
    const s = summarize(days, from);
    expect(s.kind === 'first' && s.day.date).toBe('2026-10-22');
  });
});
