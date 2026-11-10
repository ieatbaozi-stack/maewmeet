// R12-1 (ปุ่มแสดงเมื่อไหร่) · R12-11 (ลำดับตัวเลือกตาม UA + LINE) · R12-12 (ไม่ hard-code, คีย์ครบ) — sheet ใช้ portal จึงตรวจผ่านโมเดลล้วน + ซอร์ส
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calendarIcsHref, calendarOpenExternalHref, calendarSheetMode, showAddToCalendar } from '@/components/appointments/model';
import { googleCalendarUrl } from '@/lib/calendar';

const base = (over: { mine?: 'going' | 'maybe' | 'not_going' | null; status?: 'active' | 'cancelled'; isPast?: boolean }) =>
  ({ status: over.status ?? 'active', isPast: over.isPast ?? false, rsvp: { mine: over.mine === undefined ? 'going' : over.mine } }) as unknown as Parameters<typeof showAddToCalendar>[0];

describe('R12-1 showAddToCalendar', () => {
  it('ตอบ "ไป" + นัด active + ยังไม่จบ + บันทึกเสร็จ = แสดง', () => {
    expect(showAddToCalendar(base({}), false)).toBe(true);
  });
  it('ระหว่างบันทึก = ไม่แสดง', () => {
    expect(showAddToCalendar(base({}), true)).toBe(false);
  });
  it.each(['maybe', 'not_going', null] as const)('คำตอบ %s = ไม่แสดง', (mine) => {
    expect(showAddToCalendar(base({ mine }), false)).toBe(false);
  });
  it('ยกเลิกแล้ว / จบแล้ว = ไม่แสดง', () => {
    expect(showAddToCalendar(base({ status: 'cancelled' }), false)).toBe(false);
    expect(showAddToCalendar(base({ isPast: true }), false)).toBe(false);
  });
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const LINE_IOS = `${IPHONE} Line/14.5.0`;
const LINE_ANDROID = `${ANDROID} Line/14.5.0`;

describe('R12-11 calendarSheetMode', () => {
  it('iPhone / iPad (UA เก่า) = .ics ก่อน', () => {
    expect(calendarSheetMode(IPHONE, 5)).toEqual({ kind: 'options', order: ['ics', 'google'] });
    expect(calendarSheetMode(IPAD_OLD, 5)).toEqual({ kind: 'options', order: ['ics', 'google'] });
  });
  it('iPadOS (UA เป็น Macintosh + maxTouchPoints > 1) = .ics ก่อน · Mac จริง (ไม่มีจอสัมผัส) = Google ก่อน', () => {
    expect(calendarSheetMode(MAC_UA, 5)).toEqual({ kind: 'options', order: ['ics', 'google'] });
    expect(calendarSheetMode(MAC_UA, 2)).toEqual({ kind: 'options', order: ['ics', 'google'] });
    expect(calendarSheetMode(MAC_UA, 1)).toEqual({ kind: 'options', order: ['google', 'ics'] });
    expect(calendarSheetMode(MAC_UA, 0)).toEqual({ kind: 'options', order: ['google', 'ics'] });
  });
  it('Android และอื่น ๆ = Google ก่อน · ทั้งสองตัวเลือกยังอยู่เสมอ', () => {
    for (const ua of [ANDROID, WINDOWS, '']) {
      const m = calendarSheetMode(ua, 0);
      expect(m).toEqual({ kind: 'options', order: ['google', 'ics'] });
    }
  });
  it('UA มีโทเคน Line/ = โหมด LINE ไม่ว่าอุปกรณ์ใด (ไม่แสดง 2 ตัวเลือก)', () => {
    expect(calendarSheetMode(LINE_IOS, 5)).toEqual({ kind: 'line' });
    expect(calendarSheetMode(LINE_ANDROID, 5)).toEqual({ kind: 'line' });
  });
  it('คำที่แค่ลงท้ายด้วย line/ (เช่น Airline/) ไม่ใช่ LINE', () => {
    expect(calendarSheetMode(`${ANDROID} Airline/1.0`, 0).kind).toBe('options');
  });
});

describe('ลิงก์ของ sheet', () => {
  it('.ics และลิงก์ออกจาก LINE ตรง contract §4.2/§4.4', () => {
    expect(calendarIcsHref('abc')).toBe('/api/appointments/abc/calendar.ics');
    expect(calendarOpenExternalHref('abc')).toBe('/appointments/abc?openExternalBrowser=1');
  });
  it('ลิงก์ Google ไม่มีรายละเอียดนัด (ส่งเฉพาะลิงก์นัดใน details)', () => {
    const url = new URL(googleCalendarUrl({ id: 'a1', title: 'กินข้าว, เย็น;นี้', placeName: 'ร้าน', mapUrl: null, startAt: Date.UTC(2026, 10, 12, 12), endAt: Date.UTC(2026, 10, 12, 14), tz: 'Asia/Bangkok', appOrigin: 'https://x.example' }));
    expect(url.searchParams.get('details')).toBe('https://x.example/appointments/a1');
    expect(url.searchParams.get('text')).toBe('กินข้าว, เย็น;นี้');
  });
  it('R12.1: มี mapUrl → details = ลิงก์แผนที่ ขึ้นบรรทัดใหม่ แล้วลิงก์นัด · mapUrl เป็น null → มีแค่ลิงก์นัด', () => {
    const ev = { id: 'a1', title: 'x', placeName: 'ร้าน', startAt: Date.UTC(2026, 10, 12, 12), endAt: Date.UTC(2026, 10, 12, 14), tz: 'Asia/Bangkok', appOrigin: 'https://x.example' };
    const map = 'https://www.openstreetmap.org/?mlat=1&mlon=2';
    expect(new URL(googleCalendarUrl({ ...ev, mapUrl: map })).searchParams.get('details')).toBe(`${map}\nhttps://x.example/appointments/a1`);
    expect(new URL(googleCalendarUrl({ ...ev, mapUrl: null })).searchParams.get('details')).toBe('https://x.example/appointments/a1');
  });
});

describe('R12-12 ซอร์สของ sheet / ปุ่ม', () => {
  const sheet = readFileSync('src/components/appointments/AddToCalendarSheet.tsx', 'utf8');
  const detail = readFileSync('src/components/appointments/AppointmentDetail.tsx', 'utf8');
  it('ลิงก์ธรรมดา: ไม่ใช้ next/link, fetch, Blob · Google เปิดแท็บใหม่แบบ noopener noreferrer', () => {
    expect(sheet).not.toMatch(/next\/link|fetch\(|Blob/);
    expect(sheet).toContain('target="_blank"');
    expect(sheet).toContain('rel="noopener noreferrer"');
    expect(sheet).not.toMatch(/description/i);
  });
  it('ข้อความทุกอย่างมาจากคีย์ appointments.calendar.* ที่มีครบ TH/EN', () => {
    const keys = ['add', 'sheetTitle', 'device', 'google', 'oneTime', 'googleNote', 'lineHint', 'lineOpen'];
    for (const loc of ['th', 'en']) {
      const m = JSON.parse(readFileSync(`messages/${loc}.json`, 'utf8')) as { appointments: { calendar: Record<string, string> } };
      for (const k of keys) expect(m.appointments.calendar[k], `${loc}.${k}`).toBeTruthy();
    }
    for (const k of ['sheetTitle', 'device', 'google', 'oneTime', 'googleNote', 'lineHint', 'lineOpen']) expect(sheet).toContain(`t("${k}")`);
    expect(detail).toContain('t("appointments.calendar.add")');
  });
});
