// security M1 / ICS_IMPORT_CONTRACT §7 S2 — TZID ยาว/อักขระแปลกต้องไม่ถึง isValidTimeZone — เจ้าของ: platform
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/calendar/zone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/calendar/zone')>();
  return { ...actual, isValidTimeZone: vi.fn(actual.isValidTimeZone) };
});

import { isValidTimeZone, parseLocalDateTime } from '@/lib/calendar/zone';
import { parseIcsToBusy, resolveIcsTimeZone } from '@/lib/calendar/ics-import';

const spy = vi.mocked(isValidTimeZone);
const NOW_MS = parseLocalDateTime('2026-11-23', '12:00', 'Asia/Bangkok');

const wrap = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Test//EN', body, 'END:VCALENDAR'].join('\r\n') + '\r\n';

const event = (tzid: string, title: string) =>
  [
    'BEGIN:VEVENT',
    `DTSTART;TZID="${tzid}":20261127T130000`,
    `DTEND;TZID="${tzid}":20261127T140000`,
    `SUMMARY:${title}`,
    'END:VEVENT',
  ].join('\r\n');

// ชื่อ Windows ทั้งหมดที่ตารางแมปใน ics-import.ts รองรับอยู่ (ต้องไม่หลุดเพราะตัวกรองอักขระ/ความยาว)
const WINDOWS_TZIDS: Record<string, string> = {
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Singapore Standard Time': 'Asia/Singapore',
  'Malay Peninsula Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'India Standard Time': 'Asia/Kolkata',
  'Myanmar Standard Time': 'Asia/Yangon',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Arabian Standard Time': 'Asia/Dubai',
  'West Asia Standard Time': 'Asia/Tashkent',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'W. Australia Standard Time': 'Australia/Perth',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'South Africa Standard Time': 'Africa/Johannesburg',
};

beforeEach(() => {
  spy.mockClear();
});

describe('S2 — resolveIcsTimeZone กรอง TZID ก่อนถึง validator', () => {
  const rejected: Array<[string, string]> = [
    ['ยาว 65 ตัว', 'A'.repeat(65)],
    ['ยาว 470+ ตัว (แบบรายงาน M1)', `Zz/req_1_${'q'.repeat(470)}`],
    ['IANA ถูกแต่ต่อท้ายจนเกิน 64', `Asia/Bangkok${'_'.repeat(60)}`],
    ['อักขระไทย', 'เอเชีย/กรุงเทพ'],
    ['emoji', 'Asia/😀'],
    ['null byte', 'Asia/Bangkok\u0000'],
    ['zero-width', 'Asia/Bang​kok'],
    ['เครื่องหมายคำพูด', 'Asia/"Bangkok"'],
    ['เซมิโคลอน/เท่ากับ', 'Asia/Bangkok;X=1'],
    ['โคลอน', 'Asia:Bangkok'],
    ['วงเล็บมุม', '<script>'],
  ];

  it.each(rejected)('%s → null และไม่เรียก isValidTimeZone', (_label, tzid) => {
    expect(resolveIcsTimeZone(tzid)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ยาวพอดี 64 ตัวในชุดอักขระ → ผ่านด่านไปถึง validator (ยังไม่รู้จัก = null)', () => {
    expect(resolveIcsTimeZone('A'.repeat(64))).toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it('IANA ทุกชื่อที่ runtime รองรับ + slash นำหน้า + ช่องว่างรอบยังผ่านเหมือนเดิม', () => {
    for (const tz of [...Intl.supportedValuesOf('timeZone'), 'UTC', 'Etc/GMT+7', 'Etc/GMT-14']) {
      expect(resolveIcsTimeZone(tz)).toBe(tz);
      expect(resolveIcsTimeZone(`/${tz}`)).toBe(tz);
      expect(resolveIcsTimeZone(`  ${tz}  `)).toBe(tz);
    }
  });

  it('Windows TZID ทุกชื่อในตารางแมปยังผ่าน (ตัวพิมพ์ตรงและตัวเล็ก)', () => {
    for (const [win, iana] of Object.entries(WINDOWS_TZIDS)) {
      expect(resolveIcsTimeZone(win)).toBe(iana);
      expect(resolveIcsTimeZone(win.toLowerCase())).toBe(iana);
    }
  });
});

describe('S2 — ผลใน parser เหมือน TZID ไม่รู้จัก (ข้ามเป็น invalid)', () => {
  it('500 VEVENT ที่มี TZID ยาวไม่ซ้ำ → ไม่มีสตริงยาวเกิน 64 ถึง validator และนับ invalid ทั้งหมด', () => {
    const body = Array.from({ length: 500 }, (_, i) => event(`Zz/req_${i}_${'q'.repeat(400)}`, `E${i}`)).join('\r\n');
    const r = parseIcsToBusy(wrap(body), { nowMs: NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(0);
    expect(r.skipped.invalid).toBe(500);
    for (const [arg] of spy.mock.calls) expect(typeof arg === 'string' ? arg.length : 0).toBeLessThanOrEqual(64);
  });

  it('TZID ยาว/แปลก ให้ผลเดียวกับ TZID ไม่รู้จักที่ผ่านด่าน (Mars/Olympus)', () => {
    const parse = (tzid: string) =>
      parseIcsToBusy(wrap([event('Asia/Tokyo', 'Ok'), event(tzid, 'Bad')].join('\r\n')), { nowMs: NOW_MS });
    const baseline = parse('Mars/Olympus');
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    expect(baseline.skipped.invalid).toBe(1);
    expect(baseline.items.map((x) => x.title)).toEqual(['Ok']);
    for (const tzid of ['X'.repeat(200), 'Asia/😀', 'เอเชีย/กรุงเทพ']) {
      expect(parse(tzid)).toEqual(baseline);
    }
  });
});
