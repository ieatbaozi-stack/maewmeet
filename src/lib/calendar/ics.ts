// เพิ่มนัดลงปฏิทินในเครื่อง — R12_CONTRACT §5 + R12_1_CONTRACT §1.2, §1.4 + R13_CONTRACT §1.4 (ไฟล์ .ics ตาม RFC 5545 + ลิงก์ Google Calendar แบบกรอกไว้ให้)
// pure: ไม่อ่านนาฬิกา (DTSTAMP รับ nowMs จากผู้เรียก) · ใช้จาก client ได้ (ไม่มี server-only)
// §6: รับเฉพาะช่องที่ออกนอกแอปได้ — ส่ง DTO ทั้งก้อนมาก็ไม่มีรายละเอียด/lat/lng แยก/ชื่อกลุ่ม/ชื่อสมาชิกหลุดออกไป · ลิงก์แผนที่ (mapUrl) ส่งได้ และอาจมีพิกัดของสถานที่อยู่ในลิงก์
// R13 §1.4: ป้ายของลิงก์ใน DESCRIPTION / details รับเป็นพารามิเตอร์ `labels` จาก messages ตามภาษาผู้ใช้ — ไฟล์นี้ไม่มีข้อความ UI
import { Temporal } from 'temporal-polyfill';
import { MAX_YEAR, MIN_YEAR, type EpochMs } from './constants';
import { failIf } from './errors';
import { isValidTimeZone } from './zone';

/** ป้ายลิงก์ (R13 §1.4) จาก `appointments.calendar.labelMap` / `labelPlan` · ไม่มีโคลอน ไฟล์นี้ต่อ ": " เอง */
export type CalendarLinkLabels = {
  readonly map: string;
  readonly plan: string;
};

export type CalendarEventInput = {
  readonly id: string;
  readonly title: string;
  /** null หรือว่าง = ไม่มีบรรทัด LOCATION / ไม่มีช่อง location */
  readonly placeName: string | null;
  /** ลิงก์แผนที่ของนัด · ไม่ใช่ https = ไม่ใส่ */
  readonly mapUrl: string | null;
  readonly startAt: EpochMs;
  readonly endAt: EpochMs;
  /** IANA timezone ของนัด (TZID ของ .ics · ช่อง ctz ของลิงก์ Google) */
  readonly tz: string;
  /** origin ของแอปแบบไม่มี / ท้าย เช่น https://maewmeet.example */
  readonly appOrigin: string;
  /** ป้ายของลิงก์แผนที่และลิงก์นัด (บังคับส่ง) */
  readonly labels: CalendarLinkLabels;
};

/** mapUrl และ labels บังคับส่ง (mapUrl null = ไม่มี) เพื่อกันลืมส่งจาก UI */
export type GoogleCalendarInput = Omit<CalendarEventInput, 'mapUrl' | 'labels'> & {
  readonly mapUrl: string | null;
  readonly labels: CalendarLinkLabels;
};

/** ขอบเขตของ Temporal.Instant / Date (±10^8 วัน) */
const MAX_INSTANT_MS = 8.64e15;
const MAX_LINE_OCTETS = 75;
const CRLF = '\r\n';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function zoned(epochMs: EpochMs, tz: string): Temporal.ZonedDateTime {
  failIf(!Number.isInteger(epochMs) || Math.abs(epochMs) > MAX_INSTANT_MS, 'INVALID_RANGE', undefined, 'epochMs must be an integer instant');
  const z = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(tz);
  failIf(z.year < MIN_YEAR || z.year > MAX_YEAR, 'DATE_OUT_OF_RANGE');
  return z;
}

/** `YYYYMMDDTHHMMSS` ตามเวลาผนังของ z (ปี ค.ศ. เสมอ) */
const wallClock = (z: Temporal.ZonedDateTime): string =>
  `${pad(z.year, 4)}${pad(z.month)}${pad(z.day)}T${pad(z.hour)}${pad(z.minute)}${pad(z.second)}`;

/** epoch ms → `YYYYMMDDTHHMMSSZ` (UTC) · ใช้ใน DTSTAMP, `dates` ของลิงก์ Google และทางสำรองของ DTSTART/DTEND */
export function toCalendarUtc(epochMs: EpochMs): string {
  return `${wallClock(zoned(epochMs, 'UTC'))}Z`;
}

/** TZOFFSETFROM/TO: `+HHMM` · มีวินาทีเฉพาะเมื่อไม่ลงตัว · ศูนย์เป็น `+0000` เสมอ (RFC 5545 ห้าม -0000) */
function icsOffset(offsetNs: number): string {
  const total = Math.abs(offsetNs) / 1e9;
  const seconds = total % 60;
  return `${offsetNs < 0 ? '-' : '+'}${pad(Math.floor(total / 3600))}${pad(Math.floor(total / 60) % 60)}${seconds ? pad(seconds) : ''}`;
}

/** ชื่อ IANA ที่ใช้จริงได้ และมีแต่อักขระที่อยู่ในค่า parameter ได้โดยไม่ต้องครอบ (กันแทรกบรรทัด/parameter ผ่าน TZID) */
const isSafeTzid = (tz: string): boolean => /^[A-Za-z0-9_+/-]+$/.test(tz) && isValidTimeZone(tz);

/** เวลาผนังนี้ชี้กลับมาที่ instant เดิม: ช่วงที่นาฬิกาย้อน (DST fold) ผู้อ่าน TZID จะตีความเป็นครั้งแรกตาม RFC 5545 ครั้งที่สองจึงอ่านผิด */
const isFirstOccurrence = (z: Temporal.ZonedDateTime): boolean =>
  z.toPlainDateTime().toZonedDateTime(z.timeZoneId, { disambiguation: 'earlier' }).epochMilliseconds === z.epochMilliseconds;

type IcsTimes = { readonly timezone: readonly string[]; readonly start: string; readonly end: string };

/**
 * §1.4: เวลาท้องถิ่น + VTIMEZONE ที่มี offset เดียว · ใช้ UTC แบบเดิมเมื่อ TZID ใช้ไม่ได้, offset ตอนเริ่มกับตอนจบต่างกัน (คร่อม DST)
 * หรือเวลาตกในช่วงซ้ำของ DST · VTIMEZONE ครอบเฉพาะนัดนี้ (RFC 5545 อนุญาต) จึงไม่ต้องมีกฎ DST
 */
function icsTimes(startAt: EpochMs, endAt: EpochMs, tz: string): IcsTimes {
  const utc: IcsTimes = { timezone: [], start: `DTSTART:${toCalendarUtc(startAt)}`, end: `DTEND:${toCalendarUtc(endAt)}` };
  if (!isSafeTzid(tz)) return utc;
  const start = zoned(startAt, tz);
  const end = zoned(endAt, tz);
  if (start.offsetNanoseconds !== end.offsetNanoseconds || !isFirstOccurrence(start) || !isFirstOccurrence(end)) return utc;
  const offset = icsOffset(start.offsetNanoseconds);
  return {
    timezone: [
      'BEGIN:VTIMEZONE',
      `TZID:${tz}`,
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      `TZOFFSETFROM:${offset}`,
      `TZOFFSETTO:${offset}`,
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    start: `DTSTART;TZID=${tz}:${wallClock(start)}`,
    end: `DTEND;TZID=${tz}:${wallClock(end)}`,
  };
}

function assertEventRange(startAt: EpochMs, endAt: EpochMs): void {
  failIf(endAt <= startAt, 'INVALID_RANGE', 'endAt');
}

/**
 * ค่า TEXT ของ RFC 5545: `\` ก่อน แล้ว `;` `,` และขึ้นบรรทัดทุกแบบ → `\n` · ตัวควบคุมอื่นตัดทิ้ง · `:` ไม่ escape
 * ขึ้นบรรทัดจริงจึงไม่เหลือในค่า (กัน `\r\nATTENDEE:x` แทรกบรรทัดใหม่) · surrogate เดี่ยวตัดทิ้ง (ไม่กลายเป็น U+FFFD ตอน encode)
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\p{Cc}\p{Cs}]/gu, '');
}

function utf8Octets(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/** พับบรรทัดที่เกิน 75 octet ของ UTF-8 (รวมช่องว่างนำหน้าบรรทัดต่อ) ด้วย CRLF + ช่องว่าง · ตัดระหว่าง code point เท่านั้น */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let used = 0;
  for (const ch of line) {
    const size = utf8Octets(ch.codePointAt(0)!);
    if (used + size > MAX_LINE_OCTETS) {
      parts.push(current);
      current = ' ';
      used = 1;
    }
    current += ch;
    used += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

const appointmentUrl = (appOrigin: string, id: string): string => `${appOrigin}/appointments/${id}`;

/** ตรวจ scheme ซ้ำแบบ map-model.ts แม้เซิร์ฟเวอร์ตรวจตอนบันทึกแล้ว */
const isHttpsMapUrl = (mapUrl: string | null | undefined): mapUrl is string => !!mapUrl && /^https:\/\//i.test(mapUrl);

/**
 * ค่า `URL` เป็นชนิด URI (ไม่ผ่าน escapeIcsText) จึงรับเฉพาะ ASCII ที่พิมพ์ได้ ไม่มีช่องว่าง/ตัวควบคุม/backslash
 * (ค่าที่ parseMapUrl บันทึกเป็นแบบนี้อยู่แล้ว) · ไม่ผ่าน = ใช้ลิงก์นัดแทน กันแทรกบรรทัด/parameter จากแถวเก่าใน DB
 */
const isSafeUriValue = (value: string): boolean => /^[\x21-\x5b\x5d-\x7e]+$/.test(value);

/**
 * R13 §1.4: `<ป้ายแผนที่>: <ลิงก์แผนที่>` ขึ้นบรรทัด `<ป้ายนัด>: <ลิงก์นัด>` · ไม่มีลิงก์แผนที่ https = บรรทัดลิงก์นัดบรรทัดเดียว (มีป้าย)
 * ป้ายเป็นข้อความธรรมดา: .ics ผ่าน escapeIcsText ทั้งก้อน · Google ผ่าน encodeURIComponent ทั้งก้อน
 */
function detailsText(mapUrl: string | null | undefined, link: string, labels: CalendarLinkLabels): string {
  const plan = `${labels.plan}: ${link}`;
  return isHttpsMapUrl(mapUrl) ? `${labels.map}: ${mapUrl}\n${plan}` : plan;
}

/**
 * ไฟล์ .ics ของนัดหนึ่งนัด: UID คงที่ต่อนัด · CRLF ทุกบรรทัดรวมบรรทัดสุดท้าย · ไม่มี BOM · ไม่มี ORGANIZER/ATTENDEE/VALARM
 * R13 §1.4: `URL` = ลิงก์แผนที่ถ้าเป็น https (และเป็น URI ที่ปลอดภัย) ไม่งั้นลิงก์นัด · LOCATION = ชื่อสถานที่ · DESCRIPTION มีป้าย
 */
export function buildAppointmentIcs(event: CalendarEventInput, nowMs: EpochMs): string {
  const { id, title, placeName, mapUrl, startAt, endAt, tz, appOrigin, labels } = event;
  assertEventRange(startAt, endAt);
  const times = icsTimes(startAt, endAt, tz);
  const url = appointmentUrl(appOrigin, id);
  const urlValue = isHttpsMapUrl(mapUrl) && isSafeUriValue(mapUrl) ? mapUrl : url;
  const location = placeName ? escapeIcsText(placeName) : '';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//maewmeet//Add to Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...times.timezone,
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(id)}@maewmeet`,
    `DTSTAMP:${toCalendarUtc(nowMs)}`,
    times.start,
    times.end,
    `SUMMARY:${escapeIcsText(title)}`,
    ...(location ? [`LOCATION:${location}`] : []),
    `DESCRIPTION:${escapeIcsText(detailsText(mapUrl, url, labels))}`,
    `URL:${urlValue}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/** surrogate เดี่ยวทำให้ encodeURIComponent โยน URIError */
const encodeField = (value: string): string => encodeURIComponent(value.replace(/\p{Cs}/gu, ''));

/** ลิงก์ Google Calendar แบบกรอกไว้ให้ (§5) · ทุกค่า encodeURIComponent ยกเว้น `/` คั่นใน `dates` · เรียกจาก client ได้ */
export function googleCalendarUrl(event: GoogleCalendarInput): string {
  const { id, title, placeName, mapUrl, startAt, endAt, appOrigin, tz, labels } = event;
  assertEventRange(startAt, endAt);
  const fields = [
    'action=TEMPLATE',
    `text=${encodeField(title)}`,
    `dates=${toCalendarUtc(startAt)}/${toCalendarUtc(endAt)}`,
    `ctz=${encodeField(tz)}`,
    ...(placeName ? [`location=${encodeField(placeName)}`] : []),
    `details=${encodeField(detailsText(mapUrl, appointmentUrl(appOrigin, id), labels))}`,
  ];
  return `https://calendar.google.com/calendar/render?${fields.join('&')}`;
}
