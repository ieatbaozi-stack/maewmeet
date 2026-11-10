// R12 §5 + R12.1 §1.4 + R13 §1.4 — ไฟล์ .ics และลิงก์ Google Calendar (R12-5..8, R12-10, R12.1-4..6, R13-5) · ค่าคาดหวังคำนวณมือ
import { describe, expect, it } from 'vitest';
import {
  buildAppointmentIcs,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  parseLocalDateTime,
  toCalendarUtc,
  type CalendarEventInput,
  type CalendarLinkLabels,
} from '@/lib/calendar';
import { calendarLinkLabels, localeFromCookie, resolveCalendarLocale } from '@/lib/data/calendar-labels';
import en from '../../messages/en.json';
import th from '../../messages/th.json';

const BKK = 'Asia/Bangkok';
const ORIGIN = 'https://maewmeet.test';
const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const NOW = Date.UTC(2026, 10, 10, 1, 2, 3);
const START = Date.UTC(2026, 10, 20, 12, 0, 0);
const END = Date.UTC(2026, 10, 20, 14, 0, 0);
/** R13 §1.4 ป้ายเขียนมือ (ตรงกับ messages ตรวจใน describe R13) */
const LABELS_TH: CalendarLinkLabels = { map: 'แผนที่', plan: 'ดูนัดในแมวเจอกัน' };
const LABELS_EN: CalendarLinkLabels = { map: 'Map', plan: 'See the plan in maewmeet' };

const event = (over: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  id: ID,
  title: 'กินข้าว',
  placeName: 'สยาม',
  mapUrl: null,
  startAt: START,
  endAt: END,
  tz: BKK,
  appOrigin: ORIGIN,
  labels: LABELS_TH,
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
        'BEGIN:VTIMEZONE',
        'TZID:Asia/Bangkok',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0700',
        'TZOFFSETTO:+0700',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:appt-1@maewmeet',
        'DTSTAMP:20261110T010203Z',
        'DTSTART;TZID=Asia/Bangkok:20261120T190000',
        'DTEND;TZID=Asia/Bangkok:20261120T210000',
        'SUMMARY:กินข้าว',
        'LOCATION:สยาม',
        // R13: 12 + 16×3 + 2 = 62 octet แล้ว ASCII อีก 13 ตัว = 75 → พับ
        'DESCRIPTION:ดูนัดในแมวเจอกัน: https://maewm',
        ' eet.test/appointments/appt-1',
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

  it('ไม่มี ORGANIZER / ATTENDEE / VALARM / DURATION', () => {
    expect(buildAppointmentIcs(event(), NOW)).not.toMatch(/ORGANIZER|ATTENDEE|VALARM|DURATION/);
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
    const dto = { ...event(), description: 'SECRET-DESC', lat: 13.1234, lng: 100.5678, groupName: 'SECRET-GROUP', createdBy: { displayName: 'SECRET-NAME' } };
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
    const url = googleCalendarUrl({ ...input, title: 'Lunch', placeName: 'Siam', labels: LABELS_EN });
    expect(url).toBe(
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Lunch&dates=20261120T120000Z/20261120T140000Z&ctz=Asia%2FBangkok&location=Siam' +
        `&details=See%20the%20plan%20in%20maewmeet%3A%20https%3A%2F%2Fmaewmeet.test%2Fappointments%2F${ID}`,
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
    expect(q.get('details')).toBe(`ดูนัดในแมวเจอกัน: ${ORIGIN}/appointments/${ID}`);
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

describe('R13 §1.4 ลิงก์แผนที่ + ป้าย (แทน R12.1 §1.2)', () => {
  const MAP = 'https://www.openstreetmap.org/?mlat=13.74&mlon=100.53#map=17/13.74/100.53';
  const LINK = `${ORIGIN}/appointments/${ID}`;
  const google = (over: Partial<CalendarEventInput> = {}) => new URL(googleCalendarUrl(event(over))).searchParams;

  describe('ป้ายมาจาก messages ตามภาษา', () => {
    it('calendarLinkLabels ตรงคีย์ appointments.calendar.labelMap/labelPlan ของแต่ละภาษา', () => {
      expect(calendarLinkLabels('th')).toEqual({ map: th.appointments.calendar.labelMap, plan: th.appointments.calendar.labelPlan });
      expect(calendarLinkLabels('en')).toEqual({ map: en.appointments.calendar.labelMap, plan: en.appointments.calendar.labelPlan });
    });

    it('ค่าที่คาดหวังเขียนมือ (ux 29fa1e7): TH "แผนที่" / "ดูนัดในแมวเจอกัน" · EN "Map" / "See the plan in maewmeet" · ไม่มีโคลอนในคีย์', () => {
      expect(calendarLinkLabels('th')).toEqual(LABELS_TH);
      expect(calendarLinkLabels('en')).toEqual(LABELS_EN);
    });

    it.each([null, undefined])('ไม่มีภาษา (%j) = ไทย', (locale) => {
      expect(calendarLinkLabels(locale)).toEqual(LABELS_TH);
    });

    const req = (cookie?: string) => new Request('https://maewmeet.test/x', cookie === undefined ? {} : { headers: { cookie } });
    it.each([
      ['mm_locale=en', 'en'],
      ['a=1; mm_locale=th; b=2', 'th'],
      ['mm_locale=fr', null],
      ['mm_locale=EN', null],
      ['mm_locale=', null],
      ['other=en', null],
      [undefined, null],
    ] as const)('localeFromCookie(%j) = %j', (cookie, expected) => {
      expect(localeFromCookie(req(cookie))).toBe(expected);
    });

    it.each([
      ['en', 'th', 'en'],
      ['th', 'en', 'th'],
      [null, 'en', 'en'],
      [null, null, 'th'],
      [null, undefined, 'th'],
    ] as const)('resolveCalendarLocale(คุกกี้ %j, บัญชี %j) = %j', (cookie, account, expected) => {
      expect(resolveCalendarLocale(cookie, account)).toBe(expected);
    });
  });

  describe('R13-5 มี mapUrl https', () => {
    it('.ics TH: URL = ลิงก์แผนที่ · LOCATION = ชื่อสถานที่ · DESCRIPTION = แผนที่: <map>\\nดูนัดในแมวเจอกัน: <ลิงก์นัด>', () => {
      const ics = buildAppointmentIcs(event({ mapUrl: MAP }), NOW);
      expect(prop(ics, 'URL')).toBe(`URL:${MAP}`);
      expect(prop(ics, 'LOCATION')).toBe('LOCATION:สยาม');
      expect(prop(ics, 'DESCRIPTION')).toBe(`DESCRIPTION:แผนที่: ${MAP}\\nดูนัดในแมวเจอกัน: ${LINK}`);
    });

    it('.ics EN: ป้ายภาษาอังกฤษ', () => {
      const ics = buildAppointmentIcs(event({ mapUrl: MAP, labels: LABELS_EN }), NOW);
      expect(prop(ics, 'URL')).toBe(`URL:${MAP}`);
      expect(prop(ics, 'DESCRIPTION')).toBe(`DESCRIPTION:Map: ${MAP}\\nSee the plan in maewmeet: ${LINK}`);
    });

    it('.ics: จุลภาคและเซมิโคลอนในลิงก์ escape ใน DESCRIPTION เท่านั้น · URL (ชนิด URI) ไม่ escape', () => {
      const m = 'https://maps.example/@13.7,100.5;z=15';
      const ics = buildAppointmentIcs(event({ mapUrl: m }), NOW);
      expect(prop(ics, 'DESCRIPTION')).toBe(`DESCRIPTION:แผนที่: https://maps.example/@13.7\\,100.5\\;z=15\\nดูนัดในแมวเจอกัน: ${LINK}`);
      expect(prop(ics, 'URL')).toBe(`URL:${m}`);
    });

    it('Google TH/EN: details มีป้ายแบบเดียวกับ .ics · location = ชื่อสถานที่ · encode ทั้งก้อน', () => {
      expect(google({ mapUrl: MAP }).get('details')).toBe(`แผนที่: ${MAP}\nดูนัดในแมวเจอกัน: ${LINK}`);
      expect(google({ mapUrl: MAP, labels: LABELS_EN }).get('details')).toBe(`Map: ${MAP}\nSee the plan in maewmeet: ${LINK}`);
      expect(google({ mapUrl: MAP }).get('location')).toBe('สยาม');
      expect(googleCalendarUrl(event({ mapUrl: MAP }))).toContain('%0A');
    });

    it('ลิงก์ยาว 500 ตัว + ป้ายไทย: ทุกบรรทัด ≤ 75 octet · decode ได้ทีละบรรทัด · unfold ได้ค่าเดิม', () => {
      const long = `https://maps.example/${'a'.repeat(500 - 'https://maps.example/'.length)}`;
      expect(long).toHaveLength(500);
      const ics = buildAppointmentIcs(event({ mapUrl: long }), NOW);
      for (const l of decodedLines(ics)) {
        expect(l.octets, l.text).toBeLessThanOrEqual(75);
        expect(l.text).not.toContain('�');
      }
      expect(prop(ics, 'DESCRIPTION')).toBe(`DESCRIPTION:แผนที่: ${long}\\nดูนัดในแมวเจอกัน: ${LINK}`);
      expect(prop(ics, 'URL')).toBe(`URL:${long}`);
    });

    it('ป้ายยาวมาก (ไทย/อิโมจิ) ก็ fold ไม่ตัดกลางตัวอักษร และ unfold ได้ค่าเดิม', () => {
      const labels = { map: 'แผนที่😺'.repeat(20), plan: 'ดูนัด'.repeat(30) };
      const ics = buildAppointmentIcs(event({ mapUrl: MAP, labels }), NOW);
      for (const l of decodedLines(ics)) expect(l.octets, l.text).toBeLessThanOrEqual(75);
      expect(prop(ics, 'DESCRIPTION')).toBe(`DESCRIPTION:${labels.map}: ${MAP}\\n${labels.plan}: ${LINK}`);
    });

    it('scheme ตัวพิมพ์ใหญ่ใส่ได้ เหมือน map-model.ts', () => {
      const ics = buildAppointmentIcs(event({ mapUrl: 'HTTPS://maps.example/x' }), NOW);
      expect(prop(ics, 'DESCRIPTION')).toContain('แผนที่: HTTPS://maps.example/x');
      expect(prop(ics, 'URL')).toBe('URL:HTTPS://maps.example/x');
    });
  });

  describe('R13-5 ไม่มี mapUrl: URL = ลิงก์นัด · DESCRIPTION = บรรทัดลิงก์นัดบรรทัดเดียว (มีป้าย)', () => {
    // tz ที่ใช้ไม่ได้ทำให้เวลาเป็น UTC จึงเทียบได้ทั้งไฟล์ · บรรทัด DESCRIPTION ยาว 103 octet พับที่ 75 (คำนวณมือ: 12 + 16×3 + 2 = 62 แล้ว URL อีก 13 ตัว)
    const FILE = [
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
      'DESCRIPTION:ดูนัดในแมวเจอกัน: https://maewm',
      ' eet.test/appointments/appt-1',
      `URL:${ORIGIN}/appointments/appt-1`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    const GOOGLE_EN =
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Lunch&dates=20261120T120000Z/20261120T140000Z&ctz=Asia%2FBangkok&location=Siam' +
      `&details=See%20the%20plan%20in%20maewmeet%3A%20https%3A%2F%2Fmaewmeet.test%2Fappointments%2F${ID}`;

    it.each([null, ''])('.ics mapUrl = %j ตรงไฟล์คำนวณมือทุกไบต์', (mapUrl) => {
      expect(buildAppointmentIcs(event({ id: 'appt-1', mapUrl, tz: 'Not/AZone' }), NOW)).toBe(FILE);
    });

    it('.ics EN: DESCRIPTION ป้ายอังกฤษบรรทัดเดียว · URL = ลิงก์นัด', () => {
      const ics = buildAppointmentIcs(event({ labels: LABELS_EN }), NOW);
      expect(prop(ics, 'DESCRIPTION')).toBe(`DESCRIPTION:See the plan in maewmeet: ${LINK}`);
      expect(prop(ics, 'URL')).toBe(`URL:${LINK}`);
    });

    it.each([null, ''])('Google EN mapUrl = %j ตรงลิงก์คำนวณมือ', (mapUrl) => {
      expect(googleCalendarUrl(event({ title: 'Lunch', placeName: 'Siam', mapUrl, labels: LABELS_EN }))).toBe(GOOGLE_EN);
    });

    it('Google TH: details = ป้ายไทย + ลิงก์นัด', () => {
      expect(google().get('details')).toBe(`ดูนัดในแมวเจอกัน: ${LINK}`);
    });

    it('Google รับเฉพาะช่องของ GoogleCalendarInput (UI ปัจจุบัน)', () => {
      const e = event({ title: 'Lunch', placeName: 'Siam' });
      expect(
        googleCalendarUrl({ id: e.id, title: e.title, placeName: e.placeName, mapUrl: null, startAt: e.startAt, endAt: e.endAt, tz: e.tz, appOrigin: e.appOrigin, labels: LABELS_EN }),
      ).toBe(GOOGLE_EN);
    });
  });

  describe('R13-5 ค่าที่ไม่ปลอดภัย (กฎ R12.1 คงเดิม)', () => {
    it.each(['http://maps.example/x', 'javascript:alert(1)', 'data:text/html,x', 'geo:13.7,100.5', 'ftp://maps.example', ' https://maps.example/x', 'maps.example/x', 'http://x\r\nATTENDEE:mailto:a@b.test'])(
      'ไม่ใช่ https %j: ไม่ใส่ทั้ง DESCRIPTION และ URL · ไม่เกิดบรรทัดใหม่',
      (mapUrl) => {
        const ics = buildAppointmentIcs(event({ mapUrl }), NOW);
        expect(prop(ics, 'DESCRIPTION')).toBe(`DESCRIPTION:ดูนัดในแมวเจอกัน: ${LINK}`);
        expect(prop(ics, 'URL')).toBe(`URL:${LINK}`);
        expect(ics).not.toContain('ATTENDEE');
        expect(google({ mapUrl }).get('details')).toBe(`ดูนัดในแมวเจอกัน: ${LINK}`);
      },
    );

    it.each(['https://maps.example/x\r\nATTENDEE:mailto:a@b.test', 'https://maps.example/x\nATTENDEE:mailto:a@b.test', 'https://maps.example/x\rATTENDEE:mailto:a@b.test'])(
      'https ที่มีขึ้นบรรทัด %j: URL ใช้ลิงก์นัด · ไม่เกิดบรรทัดใหม่ · CR/LF ไม่เหลือในไฟล์',
      (mapUrl) => {
        const ics = buildAppointmentIcs(event({ mapUrl }), NOW);
        expect(lines(unfold(ics)).filter((l) => l.startsWith('ATTENDEE'))).toEqual([]);
        expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
        expect(prop(ics, 'URL')).toBe(`URL:${LINK}`);
      },
    );

    it.each(['https://maps.example/a b', 'https://maps.example/ร้าน', 'https://maps.example/a\\b', 'https://maps.example/a\u0000b', 'https://maps.example/a\u007fb'])(
      'https ที่ไม่ใช่ URI ASCII ปลอดภัย %j: URL ใช้ลิงก์นัด (DESCRIPTION ยังมีป้ายแผนที่ผ่าน escape)',
      (mapUrl) => {
        const ics = buildAppointmentIcs(event({ mapUrl }), NOW);
        expect(prop(ics, 'URL')).toBe(`URL:${LINK}`);
        expect(prop(ics, 'DESCRIPTION')).toMatch(/^DESCRIPTION:แผนที่: https:\/\/maps\.example\//);
      },
    );

    it('ป้ายที่มี \\ ; , และขึ้นบรรทัด ผ่าน escapeIcsText · ไม่เกิดบรรทัด/property ใหม่', () => {
      const labels = { map: 'M;a,p\\\r\nATTENDEE:mailto:a@b.test', plan: 'P\nX-EVIL:1' };
      const ics = buildAppointmentIcs(event({ mapUrl: MAP, labels }), NOW);
      expect(prop(ics, 'DESCRIPTION')).toBe(`DESCRIPTION:${escapeIcsText(`${labels.map}: ${MAP}\n${labels.plan}: ${LINK}`)}`);
      expect(lines(unfold(ics)).filter((l) => /^(ATTENDEE|X-EVIL)/.test(l))).toEqual([]);
      expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      expect(google({ mapUrl: MAP, labels }).get('details')).toBe(`${labels.map}: ${MAP}\n${labels.plan}: ${LINK}`);
    });
  });

  it('R12.1-5 / §6: ส่ง DTO ทั้งก้อนมา มีแค่ลิงก์แผนที่เพิ่ม ไม่มีรายละเอียด/lat/lng แยก/ชื่อกลุ่ม/ชื่อสมาชิก', () => {
    const dto = {
      ...event({ mapUrl: 'https://maps.example/place' }),
      description: 'SECRET-DESC',
      lat: 13.1234,
      lng: 100.5678,
      groupName: 'SECRET-GROUP',
      createdBy: { displayName: 'SECRET-NAME' },
      rsvp: { members: { going: [{ displayName: 'SECRET-NAME' }] } },
    };
    const ics = buildAppointmentIcs(dto, NOW);
    const url = googleCalendarUrl(dto);
    for (const out of [ics, url]) expect(out).not.toMatch(/SECRET|13\.1234|100\.5678/);
    expect(ics).not.toMatch(/^GEO/m);
    expect(ics).toContain('https://maps.example/place');
    expect([...new URL(url).searchParams.keys()].sort()).toEqual(['action', 'ctz', 'dates', 'details', 'location', 'text']);
  });

  describe('parser อิสระ (เขียนแยกจาก ics.ts: unfold → แยก name;params:value → unescape TEXT ตาม RFC 5545 §3.3.11)', () => {
    type Prop = { name: string; params: string; value: string };
    function parseIcs(text: string): Prop[] {
      expect(text.endsWith('\r\n')).toBe(true);
      const logical = text.slice(0, -2).replace(/\r\n[ \t]/g, '').split('\r\n');
      return logical.map((l) => {
        const colon = l.indexOf(':');
        expect(colon, l).toBeGreaterThan(0);
        const head = l.slice(0, colon);
        const semi = head.indexOf(';');
        return { name: semi < 0 ? head : head.slice(0, semi), params: semi < 0 ? '' : head.slice(semi + 1), value: l.slice(colon + 1) };
      });
    }
    const unescapeText = (v: string) => v.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

    it.each([
      ['TH', LABELS_TH],
      ['EN', LABELS_EN],
    ] as const)('%s: VEVENT มี URL/LOCATION/DESCRIPTION อย่างละหนึ่ง · ค่าที่ถอดได้ตรงตาม §1.4', (_n, labels) => {
      const m = 'https://maps.app.goo.gl/AbCdEf123?g_st=ic';
      const props = parseIcs(buildAppointmentIcs(event({ mapUrl: m, labels, placeName: 'ร้าน A, ชั้น 2; โซน B' }), NOW));
      const vevent = props.slice(
        props.findIndex((p) => p.name === 'BEGIN' && p.value === 'VEVENT'),
        props.findIndex((p) => p.name === 'END' && p.value === 'VEVENT'),
      );
      const one = (name: string) => {
        const found = vevent.filter((p) => p.name === name);
        expect(found, name).toHaveLength(1);
        return found[0]!;
      };
      expect(one('URL').value).toBe(m);
      expect(unescapeText(one('LOCATION').value)).toBe('ร้าน A, ชั้น 2; โซน B');
      expect(unescapeText(one('DESCRIPTION').value).split('\n')).toEqual([`${labels.map}: ${m}`, `${labels.plan}: ${LINK}`]);
    });
  });
});

describe('R12.1-6 §1.4 เวลาท้องถิ่น + VTIMEZONE', () => {
  const at = (tz: string, startAt: number, endAt: number) => buildAppointmentIcs(event({ tz, startAt, endAt }), NOW);
  const HOUR = 3_600_000;

  // คำนวณมือ: [tz, instant, เวลาผนังที่คาดหวัง, offset]
  const CASES: [string, number, string, string][] = [
    ['Asia/Bangkok', Date.UTC(2026, 10, 20, 12), '20261120T190000', '+0700'],
    ['Asia/Tokyo', Date.UTC(2026, 10, 20, 12), '20261120T210000', '+0900'],
    ['Asia/Kathmandu', Date.UTC(2026, 10, 20, 12), '20261120T174500', '+0545'],
    ['America/St_Johns', Date.UTC(2026, 10, 20, 12), '20261120T083000', '-0330'],
    ['Europe/London', Date.UTC(2026, 0, 15, 12), '20260115T120000', '+0000'],
    ['Europe/London', Date.UTC(2026, 6, 10, 12), '20260710T130000', '+0100'],
    ['America/New_York', Date.UTC(2026, 6, 10, 12), '20260710T080000', '-0400'],
    ['Etc/GMT+7', Date.UTC(2026, 10, 20, 12), '20261120T050000', '-0700'],
    ['America/Port-au-Prince', Date.UTC(2026, 0, 15, 12), '20260115T070000', '-0500'],
    ['UTC', Date.UTC(2026, 10, 20, 12), '20261120T120000', '+0000'],
    ['Asia/Bangkok', Date.UTC(2026, 11, 31, 17), '20270101T000000', '+0700'], // ข้ามปี
    ['Asia/Bangkok', Date.UTC(2028, 1, 28, 20), '20280229T030000', '+0700'], // 29 ก.พ.
  ];

  it.each(CASES)('%s %d → %s (%s)', (tz, startAt, wall, offset) => {
    const ics = at(tz, startAt, startAt + HOUR);
    expect(prop(ics, `DTSTART;TZID=${tz}`)).toBe(`DTSTART;TZID=${tz}:${wall}`);
    expect(ics).toContain(`TZID:${tz}\r\n`);
    expect(ics).toContain(`TZOFFSETFROM:${offset}\r\nTZOFFSETTO:${offset}\r\n`);
  });

  it.each(CASES)('ตีความกลับด้วยการคำนวณอิสระ (Date.UTC − offset) ได้ instant เดิม: %s %d', (tz, startAt) => {
    const endAt = startAt + 2 * HOUR;
    const text = lines(unfold(at(tz, startAt, endAt)));
    const value = (name: string) => text.find((l) => l.startsWith(name))!.split(':').pop()!;
    const offset = value('TZOFFSETTO');
    const sign = offset[0] === '-' ? -1 : 1;
    const offsetMs = sign * (Number(offset.slice(1, 3)) * HOUR + Number(offset.slice(3, 5)) * 60_000);
    const epoch = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15)) - offsetMs;
    expect(epoch(value('DTSTART;TZID'))).toBe(startAt);
    expect(epoch(value('DTEND;TZID'))).toBe(endAt);
  });

  it('โครงสร้าง: VTIMEZONE มาก่อน VEVENT · TZID ตรงกัน · offset เดียว ไม่มี RRULE/DAYLIGHT', () => {
    const ics = buildAppointmentIcs(event(), NOW);
    expect(ics.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'));
    expect(ics.match(/BEGIN:STANDARD/g)).toHaveLength(1);
    expect(ics).not.toMatch(/RRULE|DAYLIGHT/);
    const tzid = /\r\nTZID:(.+)\r\n/.exec(ics)![1];
    expect(/\r\nDTSTART;TZID=([^:]+):/.exec(ics)![1]).toBe(tzid);
    expect(/\r\nDTEND;TZID=([^:]+):/.exec(ics)![1]).toBe(tzid);
  });

  it('นัดข้ามเที่ยงคืนท้องถิ่น: 23:00 ถึง 01:00', () => {
    const ics = at(BKK, Date.UTC(2026, 10, 20, 16), Date.UTC(2026, 10, 20, 18));
    expect(prop(ics, 'DTSTART;TZID=Asia/Bangkok')).toBe('DTSTART;TZID=Asia/Bangkok:20261120T230000');
    expect(prop(ics, 'DTEND;TZID=Asia/Bangkok')).toBe('DTEND;TZID=Asia/Bangkok:20261121T010000');
  });

  const expectUtc = (ics: string, start: string, end: string) => {
    expect(prop(ics, 'DTSTART')).toBe(`DTSTART:${start}`);
    expect(prop(ics, 'DTEND')).toBe(`DTEND:${end}`);
    expect(ics).not.toMatch(/VTIMEZONE|TZID/);
  };

  it('คร่อม DST เข้า (New York 8 มี.ค. 2026 07:00Z) → UTC', () => {
    expectUtc(at('America/New_York', Date.UTC(2026, 2, 8, 6), Date.UTC(2026, 2, 8, 8)), '20260308T060000Z', '20260308T080000Z');
  });

  it('คร่อม DST ออก (London 25 ต.ค. 2026 01:00Z) → UTC', () => {
    expectUtc(at('Europe/London', Date.UTC(2026, 9, 25, 0), Date.UTC(2026, 9, 25, 2)), '20261025T000000Z', '20261025T020000Z');
  });

  it('เวลาซ้ำของ DST ครั้งที่สอง (01:30 EST) offset เท่ากันแต่ TZID จะอ่านผิด → UTC', () => {
    expectUtc(at('America/New_York', Date.UTC(2026, 10, 1, 6, 30), Date.UTC(2026, 10, 1, 7)), '20261101T063000Z', '20261101T070000Z');
  });

  it('เวลาซ้ำของ DST ครั้งแรก (01:30–01:45 EDT) ใช้ TZID ได้', () => {
    const ics = at('America/New_York', Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 10, 1, 5, 45));
    expect(prop(ics, 'DTSTART;TZID=America/New_York')).toBe('DTSTART;TZID=America/New_York:20261101T013000');
  });

  it.each(['Not/AZone', 'Asia/Bangkok\r\nATTENDEE:mailto:a@b.test', 'Asia/Bangkok\nATTENDEE:x', 'A;B=C', 'Asia/Bangkok:x', 'Asia/"Bangkok', '+07:00', ''])('TZID ที่ใช้ไม่ได้ %j → UTC ไม่แทรกบรรทัด', (tz) => {
    const ics = buildAppointmentIcs(event({ tz }), NOW);
    expectUtc(ics, '20261120T120000Z', '20261120T140000Z');
    expect(ics).not.toContain('ATTENDEE');
  });

  it('ลิงก์ Google ยังเป็น UTC + ctz ไม่เปลี่ยนเรื่องเวลา', () => {
    const q = new URL(googleCalendarUrl(event({ tz: 'Asia/Tokyo' }))).searchParams;
    expect(q.get('dates')).toBe('20261120T120000Z/20261120T140000Z');
    expect(q.get('ctz')).toBe('Asia/Tokyo');
  });

  it('fold ยังครบเมื่อมี TZID ยาว + ชื่อยาว', () => {
    const ics = buildAppointmentIcs(event({ tz: 'America/Argentina/ComodRivadavia', title: 'ก'.repeat(80) }), NOW);
    for (const l of decodedLines(ics)) expect(l.octets).toBeLessThanOrEqual(75);
  });
});
