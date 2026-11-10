// R12 §5 — ไฟล์ .ics และลิงก์ Google Calendar (R12-5, R12-6, R12-7, R12-8, R12-10) · ค่าคาดหวังคำนวณมือ
import { describe, expect, it } from 'vitest';
import {
  buildAppointmentIcs,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  parseLocalDateTime,
  toCalendarUtc,
  type CalendarEventInput,
} from '@/lib/calendar';

const BKK = 'Asia/Bangkok';
const ORIGIN = 'https://maewmeet.test';
const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const NOW = Date.UTC(2026, 10, 10, 1, 2, 3);
const START = Date.UTC(2026, 10, 20, 12, 0, 0);
const END = Date.UTC(2026, 10, 20, 14, 0, 0);

const event = (over: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  id: ID,
  title: 'กินข้าว',
  placeName: 'สยาม',
  startAt: START,
  endAt: END,
  appOrigin: ORIGIN,
  ...over,
});

const lines = (ics: string) => ics.split('\r\n').slice(0, -1);
/** RFC 5545 §3.1: ลบ CRLF + ช่องว่าง */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const prop = (ics: string, name: string) => lines(unfold(ics)).find((l) => l.startsWith(`${name}:`));

/** แยกตามไบต์ CRLF แล้ว decode แบบ fatal — ตัดกลางตัวอักษร UTF-8 จะโยน */
function decodedLines(ics: string): { octets: number; text: string }[] {
  const bytes = Buffer.from(ics, 'utf8');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const out: { octets: number; text: string }[] = [];
  let from = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      const chunk = bytes.subarray(from, i);
      out.push({ octets: chunk.length, text: decoder.decode(chunk) });
      from = i + 2;
    }
  }
  expect(from, 'ไฟล์ต้องจบด้วย CRLF').toBe(bytes.length);
  return out;
}

describe('R12-5 เวลา UTC', () => {
  it('19:00–21:00 Asia/Bangkok = 120000Z–140000Z', () => {
    expect(toCalendarUtc(parseLocalDateTime('2026-11-20', '19:00', BKK))).toBe('20261120T120000Z');
    expect(toCalendarUtc(parseLocalDateTime('2026-11-20', '21:00', BKK))).toBe('20261120T140000Z');
  });

  it('ข้ามเที่ยงคืน UTC: 06:00 กรุงเทพฯ วันที่ 1 มี.ค. = 23:00Z ของวันก่อน', () => {
    expect(toCalendarUtc(parseLocalDateTime('2026-03-01', '06:00', BKK))).toBe('20260228T230000Z');
  });

  it('ข้ามปี: เที่ยงคืน 1 ม.ค. กรุงเทพฯ = 17:00Z ของ 31 ธ.ค.', () => {
    expect(toCalendarUtc(parseLocalDateTime('2027-01-01', '00:00', BKK))).toBe('20261231T170000Z');
  });

  it('29 ก.พ. ปีอธิกสุรทิน ทั้งฝั่งท้องถิ่นและฝั่ง UTC', () => {
    expect(toCalendarUtc(parseLocalDateTime('2024-02-29', '12:00', BKK))).toBe('20240229T050000Z');
    expect(toCalendarUtc(parseLocalDateTime('2028-03-01', '03:00', BKK))).toBe('20280229T200000Z');
  });

  it('ปี ค.ศ. เสมอ ไม่มี พ.ศ.', () => {
    const out = toCalendarUtc(parseLocalDateTime('2026-11-20', '19:00', BKK));
    expect(out).toMatch(/^2026\d{4}T\d{6}Z$/);
    expect(out).not.toContain('2569');
  });

  it('เติมศูนย์ทุกช่อง · ตัดมิลลิวินาที', () => {
    expect(toCalendarUtc(Date.UTC(2026, 0, 2, 3, 4, 5, 999))).toBe('20260102T030405Z');
  });

  it('ค่าที่ไม่ใช่ instant หรือปีนอกช่วง → CalendarError', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, 9e15]) {
      expect(() => toCalendarUtc(bad), String(bad)).toThrowError(expect.objectContaining({ code: 'INVALID_RANGE' }));
    }
    expect(() => toCalendarUtc(Date.UTC(1999, 11, 31))).toThrowError(expect.objectContaining({ code: 'DATE_OUT_OF_RANGE' }));
    expect(() => toCalendarUtc(Date.UTC(2569, 0, 1))).toThrowError(expect.objectContaining({ code: 'DATE_OUT_OF_RANGE' }));
  });
});

describe('รูปไฟล์', () => {
  it('ตรงตัวอย่างคำนวณมือทุกบรรทัด', () => {
    expect(buildAppointmentIcs(event({ id: 'appt-1' }), NOW)).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//maewmeet//Add to Calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:appt-1@maewmeet',
        'DTSTAMP:20261110T010203Z',
        'DTSTART:20261120T120000Z',
        'DTEND:20261120T140000Z',
        'SUMMARY:กินข้าว',
        'LOCATION:สยาม',
        `DESCRIPTION:${ORIGIN}/appointments/appt-1`,
        `URL:${ORIGIN}/appointments/appt-1`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it.each([null, ''])('placeName = %j → ไม่มีบรรทัด LOCATION', (placeName) => {
    expect(buildAppointmentIcs(event({ placeName }), NOW)).not.toMatch(/^LOCATION/m);
  });

  it('สถานที่ที่เหลือแต่ตัวควบคุม → ไม่มีบรรทัด LOCATION ว่าง', () => {
    expect(buildAppointmentIcs(event({ placeName: '\u0001\u0002' }), NOW)).not.toMatch(/^LOCATION/m);
  });

  it('ไม่มี ORGANIZER / ATTENDEE / VALARM / VTIMEZONE / TZID / DURATION', () => {
    expect(buildAppointmentIcs(event(), NOW)).not.toMatch(/ORGANIZER|ATTENDEE|VALARM|VTIMEZONE|TZID|DURATION/);
  });

  it('เริ่ม=จบ หรือจบก่อนเริ่ม → INVALID_RANGE ทั้งไฟล์และลิงก์', () => {
    const bad = [event({ endAt: START }), event({ endAt: START - 1 })];
    for (const e of bad) {
      expect(() => buildAppointmentIcs(e, NOW)).toThrowError(expect.objectContaining({ code: 'INVALID_RANGE' }));
      expect(() => googleCalendarUrl({ ...e, tz: BKK })).toThrowError(expect.objectContaining({ code: 'INVALID_RANGE' }));
    }
  });

  it('DTSTAMP มาจาก now ที่ผู้เรียกส่ง ไม่อ่านนาฬิกาเอง', () => {
    expect(prop(buildAppointmentIcs(event(), Date.UTC(2030, 0, 1)), 'DTSTAMP')).toBe('DTSTAMP:20300101T000000Z');
  });

  it('§6: ส่ง DTO ทั้งก้อนมาก็ไม่มีรายละเอียด/พิกัด/ชื่อกลุ่ม/ชื่อสมาชิกในไฟล์', () => {
    const dto = { ...event(), description: 'SECRET-DESC', lat: 13.1234, lng: 100.5678, mapUrl: 'https://map.example/SECRET', groupName: 'SECRET-GROUP', createdBy: { displayName: 'SECRET-NAME' } };
    const ics = buildAppointmentIcs(dto, NOW);
    expect(ics).not.toMatch(/SECRET|13\.1234|100\.5678/);
  });
});

describe('R12-6 UID', () => {
  it('นัดเดิม: เหมือนกันทุกครั้ง แม้เวลา ชื่อ และโดเมนเปลี่ยน', () => {
    const a = prop(buildAppointmentIcs(event(), NOW), 'UID');
    const b = prop(buildAppointmentIcs(event({ title: 'ชื่อใหม่', startAt: START + 3_600_000, endAt: END + 3_600_000, appOrigin: 'https://other.example' }), NOW + 86_400_000), 'UID');
    expect(a).toBe(`UID:${ID}@maewmeet`);
    expect(b).toBe(a);
  });

  it('คนละนัด: ต่างกัน', () => {
    expect(prop(buildAppointmentIcs(event({ id: 'other-id' }), NOW), 'UID')).not.toBe(prop(buildAppointmentIcs(event(), NOW), 'UID'));
  });
});

describe('R12-7 escape', () => {
  it.each([
    ['ทับ', 'a\\b', 'a\\\\b'],
    ['เซมิโคลอน', 'a;b', 'a\\;b'],
    ['จุลภาค', 'a,b', 'a\\,b'],
    ['ทวิภาคไม่ escape', 'a:b', 'a:b'],
    ['CRLF', 'a\r\nb', 'a\\nb'],
    ['CR', 'a\rb', 'a\\nb'],
    ['LF', 'a\nb', 'a\\nb'],
    ['ทับตามด้วย n ไม่กลายเป็นขึ้นบรรทัด', 'a\\nb', 'a\\\\nb'],
    ['ทั้งหมดรวมกัน', '\\;,:\r\n', '\\\\\\;\\,:\\n'],
    ['ตัวควบคุมอื่นตัดทิ้ง', 'a\u0000b\u0007c\u0009d\u001be\u007ff\u0085g', 'abcdefg'],
    ['ภาษาไทยไม่เปลี่ยน', 'นัด กินข้าว', 'นัด กินข้าว'],
  ])('%s', (_name, input, expected) => {
    expect(escapeIcsText(input)).toBe(expected);
  });

  it.each(['x\r\nATTENDEE:mailto:a@b.test', 'x\nATTENDEE:mailto:a@b.test', 'x\rATTENDEE:mailto:a@b.test'])('ชื่อนัด %j ไม่เกิดบรรทัดใหม่', (title) => {
    const ics = buildAppointmentIcs(event({ title, placeName: title }), NOW);
    expect(lines(unfold(ics)).filter((l) => l.startsWith('ATTENDEE'))).toEqual([]);
    expect(prop(ics, 'SUMMARY')).toBe('SUMMARY:x\\nATTENDEE:mailto:a@b.test');
    expect(prop(ics, 'LOCATION')).toBe('LOCATION:x\\nATTENDEE:mailto:a@b.test');
  });

  it('ไม่มี CR หรือ LF เดี่ยวในไฟล์', () => {
    const ics = buildAppointmentIcs(event({ title: 'a\rb\nc\r\nd' }), NOW);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
});

describe('R12-8 fold', () => {
  const thai80 = 'ก'.repeat(80);
  const longPlace = 'สยามพารากอน ชั้น 5, โซน; A\\B '.repeat(12);

  it('ชื่อไทย 80 ตัว + สถานที่ยาว: ทุกบรรทัด ≤ 75 octet · decode ทีละบรรทัดได้ ไม่มี U+FFFD · unfold ได้ค่าเดิม', () => {
    const ics = buildAppointmentIcs(event({ title: thai80, placeName: longPlace }), NOW);
    const decoded = decodedLines(ics);
    expect(decoded.length).toBeGreaterThan(17);
    for (const l of decoded) {
      expect(l.octets, l.text).toBeLessThanOrEqual(75);
      expect(l.text).not.toContain('\uFFFD');
    }
    expect(prop(ics, 'SUMMARY')).toBe(`SUMMARY:${thai80}`);
    expect(prop(ics, 'LOCATION')).toBe(`LOCATION:${escapeIcsText(longPlace)}`);
  });

  it('ทุกจุดเริ่ม: ASCII นำหน้า 0–8 ตัว + ไทย/อิโมจิ ไม่ตัดกลางตัวอักษร และ unfold ได้ค่าเดิม', () => {
    for (let pad = 0; pad <= 8; pad++) {
      const title = 'x'.repeat(pad) + 'ก😺é'.repeat(40);
      const ics = buildAppointmentIcs(event({ title }), NOW);
      for (const l of decodedLines(ics)) expect(l.octets).toBeLessThanOrEqual(75);
      expect(prop(ics, 'SUMMARY')).toBe(`SUMMARY:${title}`);
    }
  });

  it('ขอบ: 75 octet ไม่พับ · 76 พับ · บรรทัดต่อนับช่องว่างด้วย', () => {
    expect(foldIcsLine('a'.repeat(75))).toBe('a'.repeat(75));
    expect(foldIcsLine('a'.repeat(76))).toBe(`${'a'.repeat(75)}\r\n a`);
    expect(foldIcsLine('a'.repeat(75 + 74 + 1))).toBe(`${'a'.repeat(75)}\r\n ${'a'.repeat(74)}\r\n a`);
  });

  it('ไทย 3 octet: 25 ตัวพอดี 75 ไม่พับ · ตัวที่ 26 ขึ้นบรรทัดใหม่', () => {
    expect(foldIcsLine('ก'.repeat(25))).toBe('ก'.repeat(25));
    expect(foldIcsLine('ก'.repeat(26))).toBe(`${'ก'.repeat(25)}\r\n ก`);
  });

  it('อิโมจิ 4 octet ไม่ถูกแยก surrogate', () => {
    const folded = foldIcsLine(`${'a'.repeat(73)}😺`);
    expect(folded).toBe(`${'a'.repeat(73)}\r\n 😺`);
  });

  it('CRLF ทุกบรรทัดรวมบรรทัดสุดท้าย · ไม่มี BOM', () => {
    const ics = buildAppointmentIcs(event({ title: thai80 }), NOW);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('\r\n\r\n')).toBe(false);
    expect(Buffer.from(ics, 'utf8').subarray(0, 3).toString('latin1')).toBe('BEG');
  });
});

describe('R12-10 ลิงก์ Google Calendar', () => {
  const input = { ...event(), tz: BKK };
  const parse = (u: string) => new URL(u).searchParams;

  it('ตรงตัวอย่างคำนวณมือ', () => {
    const url = googleCalendarUrl({ ...input, title: 'Lunch', placeName: 'Siam' });
    expect(url).toBe(
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Lunch&dates=20261120T120000Z/20261120T140000Z&ctz=Asia%2FBangkok&location=Siam' +
        `&details=https%3A%2F%2Fmaewmeet.test%2Fappointments%2F${ID}`,
    );
  });

  it('decode แล้วได้ค่าตรง: ไทย + อักขระพิเศษ', () => {
    const title = 'นัด "A&B" = 100% + #1?/ก,ข;ค\\ง';
    const placeName = 'ร้าน & คาเฟ่ / ชั้น 2?';
    const q = parse(googleCalendarUrl({ ...input, title, placeName }));
    expect(q.get('action')).toBe('TEMPLATE');
    expect(q.get('text')).toBe(title);
    expect(q.get('location')).toBe(placeName);
    expect(q.get('dates')).toBe('20261120T120000Z/20261120T140000Z');
    expect(q.get('ctz')).toBe(BKK);
    expect(q.get('details')).toBe(`${ORIGIN}/appointments/${ID}`);
  });

  it('ช่องว่างและ + encode ถูกต้อง ไม่หายตอน decode', () => {
    const url = googleCalendarUrl({ ...input, title: 'a b+c' });
    expect(url).toContain('text=a%20b%2Bc');
    expect(parse(url).get('text')).toBe('a b+c');
  });

  it('`/` คั่นใน dates ไม่ถูก encode', () => {
    expect(googleCalendarUrl(input)).toContain('&dates=20261120T120000Z/20261120T140000Z&');
  });

  it.each([null, ''])('placeName = %j → ไม่มีช่อง location', (placeName) => {
    expect(parse(googleCalendarUrl({ ...input, placeName })).has('location')).toBe(false);
  });

  it('§6: ส่ง DTO ทั้งก้อนมาก็มีเฉพาะช่องที่กำหนด ไม่มีรายละเอียด/พิกัด/ชื่อกลุ่ม/ชื่อสมาชิก', () => {
    const dto = {
      ...input,
      description: 'SECRET-DESC',
      lat: 13.1234,
      lng: 100.5678,
      mapUrl: 'https://map.example/SECRET',
      groupName: 'SECRET-GROUP',
      rsvp: { members: { going: [{ displayName: 'SECRET-NAME' }] } },
    };
    const url = googleCalendarUrl(dto);
    expect(url).not.toMatch(/SECRET|13\.1234|100\.5678/);
    expect([...parse(url).keys()].sort()).toEqual(['action', 'ctz', 'dates', 'details', 'location', 'text']);
  });

  it('surrogate เดี่ยวไม่ทำให้ลิงก์พัง', () => {
    expect(parse(googleCalendarUrl({ ...input, title: 'a\uD800b' })).get('text')).toBe('ab');
  });
});
