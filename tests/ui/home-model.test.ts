// view-model ของหน้าหลัก (R4B U11): เลือกป้ายนับถอยหลัง · แยกนัดถัดไป/ที่เหลือ · จัดรูปวัน-เวลาใน tz นัด · สถานที่/ลิงก์ปลอดภัย
import { describe, expect, it } from 'vitest';
import { daysUntil, parseLocalDateTime } from '@/lib/calendar';
import { weekdayShort } from '@/components/shell/weekday';
import {
  HOME_LIMIT,
  countdownKind,
  dateBox,
  longDateLabel,
  maybeTruncated,
  placeView,
  rowCountdown,
  rsvpCountItems,
  shortDateLabel,
  splitHome,
  timeRange,
  type HomeAppointment,
} from '@/components/home/model';

const TZ = 'Asia/Bangkok';
const at = (d: string, t: string, tz = TZ) => parseLocalDateTime(d, t, tz);
const appt = (id: string, over: Partial<HomeAppointment> = {}): HomeAppointment => ({
  id,
  groupId: 'g1',
  groupName: 'กลุ่ม',
  title: `นัด ${id}`,
  placeName: null,
  lat: null,
  lng: null,
  mapUrl: null,
  startAt: at('2026-10-24', '18:00'),
  endAt: at('2026-10-24', '21:00'),
  tz: TZ,
  localDate: '2026-10-24',
  status: 'active',
  isPast: false,
  daysUntil: 4,
  rsvp: { counts: { going: 1, maybe: 0, not_going: 0, noResponse: 2 }, mine: null },
  ...over,
});

describe('countdownKind — เลือกป้ายบนแถบการ์ด', () => {
  const a = appt('a');
  it('อีก N วัน เมื่อ ≥ 2', () => {
    expect(countdownKind({ ...a, daysUntil: 4 }, at('2026-10-20', '18:00'))).toBe('days');
    expect(countdownKind({ ...a, daysUntil: 2 }, a.startAt - 1)).toBe('days');
  });
  it('พรุ่งนี้ = 1 · วันนี้ = 0', () => {
    expect(countdownKind({ ...a, daysUntil: 1 }, a.startAt - 86_400_000)).toBe('tomorrow');
    expect(countdownKind({ ...a, daysUntil: 0 }, a.startAt - 3_600_000)).toBe('today');
  });
  it('กำลังจัดอยู่ (start ≤ now < end) มาก่อนวัน แม้ daysUntil ติดลบ (นัดหลายวัน)', () => {
    const trip = appt('t', { startAt: at('2026-10-30', '15:00'), endAt: at('2026-11-02', '11:00'), daysUntil: -1 });
    expect(countdownKind(trip, at('2026-10-31', '10:00'))).toBe('ongoing');
    expect(countdownKind({ ...a, daysUntil: 0 }, a.startAt)).toBe('ongoing'); // ขอบเริ่ม
    expect(countdownKind({ ...a, daysUntil: 0 }, a.endAt)).toBe('today'); // ขอบจบ = จบแล้ว
  });
  it('daysUntil ติดลบที่ไม่ได้กำลังจัด (ขอบเวลา) → วันนี้ ไม่ใช่ "อีก -1 วัน"', () => {
    expect(countdownKind({ ...a, daysUntil: -1 }, a.endAt + 1)).toBe('today');
  });
});

describe('splitHome — นัดถัดไป + ที่เหลือ', () => {
  it('เรียงตามเวลาเริ่ม ข้ามกลุ่ม · ตัวแรกเป็นการ์ด', () => {
    const late = appt('late', { startAt: at('2026-11-01', '10:00') });
    const early = appt('early', { startAt: at('2026-10-21', '09:00') });
    const mid = appt('mid', { startAt: at('2026-10-25', '09:00'), groupId: 'g2' });
    const r = splitHome([late, mid, early]);
    expect(r.next?.id).toBe('early');
    expect(r.later.map((a) => a.id)).toEqual(['mid', 'late']);
  });
  it('ไม่รวมนัดยกเลิก/ผ่านแล้วเป็นการ์ดถัดไป (กรองซ้ำแม้ API กรองให้แล้ว)', () => {
    const r = splitHome([appt('c', { status: 'cancelled', startAt: at('2026-10-21', '09:00') }), appt('p', { isPast: true, startAt: at('2026-10-21', '10:00') }), appt('ok')]);
    expect(r.next?.id).toBe('ok');
    expect(r.later).toEqual([]);
  });
  it('ว่าง/มีแต่ยกเลิก → ไม่มีการ์ด', () => {
    expect(splitHome([]).next).toBeNull();
    expect(splitHome([appt('c', { status: 'cancelled' })]).next).toBeNull();
  });
  it('เวลาเริ่มเท่ากัน: เรียงตาม id (คงที่)', () => {
    const r = splitHome([appt('b'), appt('a')]);
    expect(r.next?.id).toBe('a');
  });
});

describe('maybeTruncated — moreNote', () => {
  it('ครบเพดานพอดีหรือเกิน = อาจมีต่อ', () => {
    expect(maybeTruncated(HOME_LIMIT)).toBe(true);
    expect(maybeTruncated(HOME_LIMIT - 1)).toBe(false);
    expect(maybeTruncated(0)).toBe(false);
  });
});

describe('จัดรูปวัน-เวลาใน tz ของนัด', () => {
  const a = appt('x');
  it('แถบวัน: ไทยใช้ พ.ศ. · อังกฤษ ค.ศ.', () => {
    expect(longDateLabel(a, 'th')).toBe('วันเสาร์ 24 ต.ค. 2569');
    expect(longDateLabel(a, 'en')).toBe('Saturday 24 Oct 2026');
  });
  it('แถวสั้น', () => {
    expect(shortDateLabel(a, 'en')).toBe('Sat 24 Oct');
    expect(shortDateLabel(a, 'th')).toBe('เสาร์ 24 ต.ค.');
  });
  it('วันตาม tz ของนัด ไม่ใช่ tz ของเครื่อง: 23:30 ก่อนเที่ยงคืนที่โตเกียว', () => {
    const tokyo = appt('t', { tz: 'Asia/Tokyo', startAt: at('2026-10-24', '23:30', 'Asia/Tokyo'), endAt: at('2026-10-25', '01:00', 'Asia/Tokyo') });
    expect(dateBox(tokyo)).toEqual({ day: 24, date: '2026-10-24' });
    expect(shortDateLabel(tokyo, 'en')).toBe('Sat 24 Oct');
  });
  it('ช่วงเวลาวันเดียวกัน', () => {
    expect(timeRange(a, 'th')).toEqual({ kind: 'same', text: '18:00–21:00' });
  });
  it('ข้ามเที่ยงคืน → overnight (แสดงวันจบเมื่อต่างวันท้องถิ่นเท่านั้น)', () => {
    const night = appt('n', { startAt: at('2026-10-31', '15:00'), endAt: at('2026-11-01', '11:00') });
    expect(timeRange(night, 'en')).toEqual({ kind: 'overnight', start: '15:00', end: '11:00' });
    // ข้ามปี
    const nye = appt('y', { startAt: at('2026-12-31', '22:00'), endAt: at('2027-01-01', '02:00') });
    expect(timeRange(nye, 'en').kind).toBe('overnight');
  });
  it('หลายวัน → ระบุวันที่จบ', () => {
    const trip = appt('m', { startAt: at('2026-10-30', '15:00'), endAt: at('2026-11-02', '11:00') });
    expect(timeRange(trip, 'en')).toEqual({ kind: 'multi', text: '15:00 – 2 Nov 11:00' });
  });
  it('tz ที่ไม่รู้จักไม่ทำให้พัง (ใช้ Asia/Bangkok)', () => {
    expect(() => longDateLabel({ ...a, tz: 'Mars/Base' }, 'en')).not.toThrow();
  });
});

describe('placeView — สถานที่และลิงก์ที่ปลอดภัย', () => {
  const base = { placeName: null, lat: null, lng: null, mapUrl: null };
  it('ไม่มีอะไรเลย → null', () => {
    expect(placeView(base)).toBeNull();
    expect(placeView({ ...base, placeName: '   ' })).toBeNull();
  });
  it('ชื่อล้วน → ไม่มีลิงก์', () => {
    expect(placeView({ ...base, placeName: 'ร้านป้าแดง' })).toMatchObject({ label: 'ร้านป้าแดง', href: null, linkOnly: false });
  });
  it('พิกัด → ลิงก์ OSM https', () => {
    const v = placeView({ ...base, placeName: 'X', lat: 13.8, lng: 100.6 });
    expect(v?.href).toBe('https://www.openstreetmap.org/?mlat=13.8&mlon=100.6#map=17/13.8/100.6');
  });
  it('มี mapUrl https → ใช้ลิงก์นั้นก่อนพิกัด', () => {
    const v = placeView({ ...base, placeName: 'X', lat: 1, lng: 2, mapUrl: 'https://maps.example.com/p?q=1' });
    expect(v?.href).toBe('https://maps.example.com/p?q=1');
    expect(v?.host).toBe('maps.example.com');
  });
  it('มีแต่ลิงก์ → แสดงโฮสต์ (linkOnly)', () => {
    expect(placeView({ ...base, mapUrl: 'https://maps.app.goo.gl/abc' })).toMatchObject({ label: 'maps.app.goo.gl', linkOnly: true });
  });
  it.each(['javascript:alert(1)', 'data:text/html,hi', 'http://insecure.example.com', 'ftp://x.example.com', '//evil.example.com', 'https://'])('ปฏิเสธลิงก์อันตราย %s', (u) => {
    expect(placeView({ ...base, mapUrl: u })).toBeNull();
    expect(placeView({ ...base, placeName: 'X', mapUrl: u })?.href).toBeNull();
  });
  it('พิกัดนอกช่วง/ไม่ครบคู่ไม่สร้างลิงก์', () => {
    expect(placeView({ ...base, placeName: 'X', lat: 91, lng: 0 })?.href).toBeNull();
    expect(placeView({ ...base, placeName: 'X', lat: 10, lng: null })?.href).toBeNull();
  });
});

describe('weekdayShort — ผลเหมือนกันทุกเอนจิน (กัน hydration mismatch)', () => {
  it('ไทยใช้ชื่อเต็มตัดคำว่า "วัน" · อังกฤษ short', () => {
    expect(weekdayShort('2026-10-24', { locale: 'th' })).toBe('เสาร์');
    expect(weekdayShort('2026-10-22', { locale: 'th' })).toBe('พฤหัสบดี');
    expect(weekdayShort('2026-10-24', { locale: 'en' })).toBe('Sat');
  });
  it('instant + tz: 23:30 UTC ของวันเสาร์ = วันอาทิตย์ที่กรุงเทพ', () => {
    const ms = Date.UTC(2026, 9, 24, 23, 30);
    expect(weekdayShort(ms, { locale: 'en', tz: 'Asia/Bangkok' })).toBe('Sun');
    expect(weekdayShort(ms, { locale: 'en', tz: 'UTC' })).toBe('Sat');
  });
});

describe('rowCountdown — ป้ายท้ายชื่อในรายการนัดถัดๆ ไป (R6A F4)', () => {
  const a = appt('a'); // 2026-10-24 18:00–21:00 Asia/Bangkok
  const label = (nowMs: number, x: HomeAppointment = a) => rowCountdown({ ...x, daysUntil: daysUntil(nowMs, x.startAt, x.tz) }, nowMs);

  it('อีก N วัน / พรุ่งนี้ / วันนี้ จาก daysUntil ของ lib กลาง', () => {
    expect(label(at('2026-10-20', '09:00'))).toEqual({ kind: 'days', days: 4 });
    expect(label(at('2026-10-23', '18:00'))).toEqual({ kind: 'tomorrow', days: 1 });
    expect(label(at('2026-10-24', '08:00'))).toEqual({ kind: 'today', days: 0 });
  });
  it('ขอบเที่ยงคืนเวลาไทย: 23:59 วันก่อน = พรุ่งนี้ · 00:00 = วันนี้ (ไม่ใช่เที่ยงคืน UTC)', () => {
    expect(label(at('2026-10-23', '23:59'))).toEqual({ kind: 'tomorrow', days: 1 });
    expect(label(at('2026-10-24', '00:00'))).toEqual({ kind: 'today', days: 0 });
    // 06:59 ไทย = 23:59 UTC วันก่อน — ต้องยังเป็นวันนี้ตามเวลาไทย
    expect(label(at('2026-10-24', '06:59'))).toEqual({ kind: 'today', days: 0 });
  });
  it('กำลังจัดอยู่ มาก่อนวันเสมอ · days = 0', () => {
    expect(label(at('2026-10-24', '19:00'))).toEqual({ kind: 'ongoing', days: 0 });
  });
  it('นัดข้ามคืนที่เริ่มแล้ว (ต่อถึงพรุ่งนี้) = กำลังจัดอยู่', () => {
    const night = appt('n', { startAt: at('2026-10-24', '22:00'), endAt: at('2026-10-25', '02:00') });
    expect(label(at('2026-10-25', '01:00'), night)).toEqual({ kind: 'ongoing', days: 0 });
    expect(label(at('2026-10-24', '21:00'), night)).toEqual({ kind: 'today', days: 0 });
  });
  it('daysUntil ติดลบที่ไม่ได้กำลังจัด → วันนี้ (ไม่ขึ้น "อีก -1 วัน")', () => {
    expect(rowCountdown({ ...a, daysUntil: -1 }, a.endAt + 1)).toEqual({ kind: 'today', days: 0 });
  });
});

describe('rsvpCountItems — ชิปจำนวนบนการ์ด (R6A B1)', () => {
  const c = (going: number, maybe: number, not_going: number, noResponse: number) => ({ going, maybe, not_going, noResponse });
  it('ไม่ไป > 0 → แสดง "ไม่ไป" · ลำดับ ไป → อาจไป → ไม่ไป → ยังไม่ตอบ (ตรงหน้ารายละเอียด)', () => {
    expect(rsvpCountItems(c(2, 1, 3, 4))).toEqual([
      { answer: 'going', count: 2 },
      { answer: 'maybe', count: 1 },
      { answer: 'not_going', count: 3 },
      { answer: 'none', count: 4 },
    ]);
  });
  it('ค่า 0 ซ่อน ยกเว้น "ไป" ที่แสดงเสมอ', () => {
    expect(rsvpCountItems(c(0, 0, 0, 0))).toEqual([{ answer: 'going', count: 0 }]);
    expect(rsvpCountItems(c(1, 0, 1, 0)).map((x) => x.answer)).toEqual(['going', 'not_going']);
  });
});
