// เพิ่มนัดลงปฏิทินในเครื่อง — R12_CONTRACT §5 (ไฟล์ .ics ตาม RFC 5545 + ลิงก์ Google Calendar แบบกรอกไว้ให้)
// pure: ไม่อ่านนาฬิกา (DTSTAMP รับ nowMs จากผู้เรียก) · ใช้จาก client ได้ (ไม่มี server-only)
// §6: รับเฉพาะช่องที่ออกนอกแอปได้ — ส่ง DTO ทั้งก้อนมาก็ไม่มีรายละเอียด/พิกัด/ชื่อกลุ่ม/ชื่อสมาชิกหลุดออกไป
import { Temporal } from 'temporal-polyfill';
import { MAX_YEAR, MIN_YEAR, type EpochMs } from './constants';
import { failIf } from './errors';

export type CalendarEventInput = {
  readonly id: string;
  readonly title: string;
  /** null หรือว่าง = ไม่มีบรรทัด LOCATION / ไม่มีช่อง location */
  readonly placeName: string | null;
  readonly startAt: EpochMs;
  readonly endAt: EpochMs;
  /** origin ของแอปแบบไม่มี / ท้าย เช่น https://maewmeet.example */
  readonly appOrigin: string;
};

export type GoogleCalendarInput = CalendarEventInput & {
  /** IANA timezone ของนัด (ช่อง ctz) */
  readonly tz: string;
};

/** ขอบเขตของ Temporal.Instant / Date (±10^8 วัน) */
const MAX_INSTANT_MS = 8.64e15;
const MAX_LINE_OCTETS = 75;
const CRLF = '\r\n';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** epoch ms → `YYYYMMDDTHHMMSSZ` (UTC · ปี ค.ศ. เสมอ) · ใช้ทั้งใน .ics และ `dates` ของลิงก์ Google */
export function toCalendarUtc(epochMs: EpochMs): string {
  failIf(!Number.isInteger(epochMs) || Math.abs(epochMs) > MAX_INSTANT_MS, 'INVALID_RANGE', undefined, 'epochMs must be an integer instant');
  const z = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO('UTC');
  failIf(z.year < MIN_YEAR || z.year > MAX_YEAR, 'DATE_OUT_OF_RANGE');
  return `${pad(z.year, 4)}${pad(z.month)}${pad(z.day)}T${pad(z.hour)}${pad(z.minute)}${pad(z.second)}Z`;
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

/** ไฟล์ .ics ของนัดหนึ่งนัด: UID คงที่ต่อนัด · CRLF ทุกบรรทัดรวมบรรทัดสุดท้าย · ไม่มี BOM · ไม่มี ORGANIZER/ATTENDEE/VALARM */
export function buildAppointmentIcs(event: CalendarEventInput, nowMs: EpochMs): string {
  const { id, title, placeName, startAt, endAt, appOrigin } = event;
  assertEventRange(startAt, endAt);
  const url = appointmentUrl(appOrigin, id);
  const location = placeName ? escapeIcsText(placeName) : '';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//maewmeet//Add to Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(id)}@maewmeet`,
    `DTSTAMP:${toCalendarUtc(nowMs)}`,
    `DTSTART:${toCalendarUtc(startAt)}`,
    `DTEND:${toCalendarUtc(endAt)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    ...(location ? [`LOCATION:${location}`] : []),
    `DESCRIPTION:${escapeIcsText(url)}`,
    `URL:${url}`,
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
  const { id, title, placeName, startAt, endAt, appOrigin, tz } = event;
  assertEventRange(startAt, endAt);
  const fields = [
    'action=TEMPLATE',
    `text=${encodeField(title)}`,
    `dates=${toCalendarUtc(startAt)}/${toCalendarUtc(endAt)}`,
    `ctz=${encodeField(tz)}`,
    ...(placeName ? [`location=${encodeField(placeName)}`] : []),
    `details=${encodeField(appointmentUrl(appOrigin, id))}`,
  ];
  return `https://calendar.google.com/calendar/render?${fields.join('&')}`;
}
