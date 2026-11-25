// Pure RFC 5545 .ics parser สำหรับนำเข้าเวลาไม่ว่าง (ICS_IMPORT_CONTRACT §1 I1–I5 · V1_2_CONTRACT §1–§2 · ADR 0017)
// pure: ใช้เฉพาะ temporal-polyfill และ lib ใน src/lib/calendar เท่านั้น — ไม่อ่านนาฬิกา (รับ nowMs) · ไม่แตะ DB/HTTP/env
// linear O(n) single-pass scanner ไม่มี backtracking regex กัน ReDoS · ไม่อ่าน DESCRIPTION/LOCATION/ATTENDEE/ORGANIZER/URL
// UID อ่านเฉพาะในหน่วยความจำเพื่อจับคู่ RECURRENCE-ID กับ master RRULE เท่านั้น — ห้ามส่งออก/เก็บ DB/log
import { Temporal } from 'temporal-polyfill';
import { normalizeBusyInput, type BusyInput, type BusyRow } from './busy';
import { DEFAULT_TZ, MAX_YEAR, MIN_YEAR, STEP_MINUTES, TIMED_MAX_DAYS, type DateISO, type EpochMs } from './constants';
import { addDays, compareDates } from './date';
import { isTooFarBack } from './limits';
import { isValidTimeZone, todayIn } from './zone';

export const ICS_IMPORT_MAX_BYTES = 512 * 1024;
export const ICS_IMPORT_MAX_LINES = 20_000;
export const ICS_IMPORT_MAX_EVENTS = 500;
export const ICS_IMPORT_MAX_OCCURRENCES_PER_EVENT = 200;
export const ICS_IMPORT_MAX_EXPANDED_ITEMS = 500;
export const ICS_IMPORT_WINDOW_OPTIONS = [30, 60, 90, 180] as const;
export type IcsImportWindowDays = (typeof ICS_IMPORT_WINDOW_OPTIONS)[number];
export const ICS_IMPORT_DEFAULT_WINDOW_DAYS: IcsImportWindowDays = 90;

const DEFAULT_MAX_BACKDATE_DAYS = 7;
const DEFAULT_MAX_SPAN_DAYS = 366;
const DEFAULT_TITLE_MAX = 80;

// เพดานกัน DoS ของการขยาย RRULE / EXDATE / UID (V1_2_CONTRACT R2, R4)
const MAX_RRULE_LENGTH = 512;
const MAX_EXDATES_PER_EVENT = 200;
const MAX_UID_LENGTH = 256;
const MAX_RRULE_COUNT = 10_000;
const MAX_RRULE_STEPS = 2_000;
// งบรวมระดับไฟล์ข้ามทุก VEVENT (security M1): กัน 500×MONTHLY+COUNT จากปี 1900 บล็อก CPU แต่ไม่ขวางไฟล์จริงปกติ
const MAX_TOTAL_RRULE_STEPS = 12_000;
const MAX_TOTAL_EVALUATED_DATES = 25_000;
const MAX_BYDAY_ITEMS = 35;
const MAX_BYMONTHDAY_ITEMS = 31;
const MAX_INTERVAL: Readonly<Record<'DAILY' | 'WEEKLY' | 'MONTHLY', number>> = {
  DAILY: 366,
  WEEKLY: 52,
  MONTHLY: 12,
};

/** คีย์เหตุผลที่ข้ามรายการในหน้า preview (I4 · V1_2_CONTRACT R3) */
export type IcsSkipCounts = {
  rrule: number;
  cancelled: number;
  transparent: number;
  past: number;
  tooFarAhead: number;
  tooLong: number;
  invalid: number;
};

/** รายการที่ผ่านกติกา normalizeBusyInput แล้ว พร้อมส่ง preview หรือบันทึก */
export interface ParsedIcsBusyItem {
  readonly kind: 'all_day' | 'timed';
  readonly startDate: DateISO;
  readonly endDate: DateISO;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly tz: string;
  readonly title: string | null;
  readonly rounded: boolean;
  readonly row: BusyRow;
}

export interface ParseIcsOptions {
  readonly nowMs: EpochMs;
  readonly defaultTz?: string;
  readonly windowDays?: number;
  readonly maxBytes?: number;
  readonly maxLines?: number;
  readonly maxEvents?: number;
  readonly maxOccurrencesPerEvent?: number;
  readonly maxItems?: number;
  readonly maxBackdateDays?: number;
  readonly maxSpanDays?: number;
  readonly maxTimedDays?: number;
  readonly titleMax?: number;
}

export type ParseIcsError =
  | { readonly ok: false; readonly error: 'TOO_LARGE'; readonly limit: 'bytes' | 'lines' | 'events'; readonly max: number }
  | { readonly ok: false; readonly error: 'INVALID'; readonly reason: 'BINARY' | 'NOT_ICS' };

export type ParseIcsSuccess = {
  readonly ok: true;
  readonly items: readonly ParsedIcsBusyItem[];
  readonly skipped: IcsSkipCounts;
  readonly totalEvents: number;
};

export type ParseIcsResult = ParseIcsSuccess | ParseIcsError;

// ตารางแมปชื่อเขตเวลา Windows ยอดนิยมจาก Outlook → IANA (ตาม CLDR windowsZones · ADR 0017 §2)
const WINDOWS_TO_IANA: Readonly<Record<string, string>> = {
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

const WINDOWS_TO_IANA_LOWER: ReadonlyMap<string, string> = new Map(
  Object.entries(WINDOWS_TO_IANA).map(([k, v]) => [k.toLowerCase(), v]),
);

// อนุญาตเฉพาะ property ที่ใช้จริง · ไม่รับ DESCRIPTION/LOCATION/ATTENDEE/ORGANIZER/URL
// UID ใช้จับคู่ RECURRENCE-ID ภายในหน่วยความจำเท่านั้น ไม่ส่งออก/ไม่เก็บ/ไม่ log
const ALLOWED_PROPS = new Set([
  'SUMMARY',
  'DTSTART',
  'DTEND',
  'DURATION',
  'TRANSP',
  'STATUS',
  'RRULE',
  'EXDATE',
  'RECURRENCE-ID',
  'UID',
]);

// กติกาตัวอักษรเดียวกับ src/lib/shared/name-rules.ts (sanitizeDisplayText + checkVisibleName)
const ZWJ = 0x200d;
const VS16 = 0xfe0f;
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Cn}\u115F\u1160\u17B4\u17B5\u3164\uFFA0\u2800\u034F]/u;
const ANY_SPACE = /\p{Zs}/u;
const PICTO = /^\p{Extended_Pictographic}$/u;
const MODIFIER = /^\p{Emoji_Modifier}$/u;
const MARK = /^\p{M}$/u;
const VISIBLE = /^[\p{L}\p{N}\p{S}\p{P}]$/u;
const MAX_MARKS_PER_BASE = 3;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

/** นับขนาด UTF-8 (ไบต์) และตรวจ null/binary control ในรอบเดียว (O(n)) */
function inspectRawInput(raw: string, maxBytes: number): 'OK' | 'TOO_LARGE' | 'BINARY' {
  let bytes = 0;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0 || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) {
      return 'BINARY';
    }
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < raw.length ? raw.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) return 'TOO_LARGE';
  }
  return 'OK';
}

/** แยกบรรทัด + RFC 5545 line unfolding (CRLF/LF/CR + ช่องว่าง/แท็บ) ในรอบเดียว O(n) */
function unfoldLines(raw: string, maxLines: number): { ok: true; lines: string[] } | { ok: false } {
  const start = raw.charCodeAt(0) === 0xfeff ? 1 : 0; // ตัด UTF-8 BOM นำหน้าถ้ามี
  const lines: string[] = [];
  let rawCount = 0;
  let lineStart = start;
  const len = raw.length;

  const pushRaw = (segment: string): boolean => {
    rawCount++;
    if (rawCount > maxLines) return false;
    if ((segment.startsWith(' ') || segment.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += segment.slice(1);
    } else {
      lines.push(segment);
    }
    return true;
  };

  for (let i = start; i < len; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x0d || c === 0x0a) {
      if (!pushRaw(raw.slice(lineStart, i))) return { ok: false };
      if (c === 0x0d && i + 1 < len && raw.charCodeAt(i + 1) === 0x0a) i++;
      lineStart = i + 1;
    }
  }
  if (lineStart < len) {
    if (!pushRaw(raw.slice(lineStart))) return { ok: false };
  }
  return { ok: true, lines };
}

type PropEntry = {
  readonly value: string;
  readonly params: Readonly<Record<string, string>>;
};

type RawEvent = {
  summary?: PropEntry;
  dtstart?: PropEntry;
  dtend?: PropEntry;
  duration?: PropEntry;
  transp?: PropEntry;
  status?: PropEntry;
  rrule?: PropEntry;
  multipleRrules?: boolean;
  exdates?: PropEntry[];
  recurrenceId?: PropEntry;
  uid?: string;
};

/** แยกบรรทัด property ของ RFC 5545 แบบ linear (รองรับ ; และ : ภายในเครื่องหมายคำพูด "...") */
function parsePropertyLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  let inQuote = false;
  let colonIdx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charCodeAt(i);
    if (ch === 0x22) {
      inQuote = !inQuote;
    } else if (ch === 0x3a && !inQuote) {
      colonIdx = i;
      break;
    }
  }
  if (colonIdx <= 0) return null;

  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);

  // แยก left ด้วย ';' นอก quote
  const parts: string[] = [];
  let partStart = 0;
  inQuote = false;
  for (let i = 0; i < left.length; i++) {
    const ch = left.charCodeAt(i);
    if (ch === 0x22) {
      inQuote = !inQuote;
    } else if (ch === 0x3b && !inQuote) {
      parts.push(left.slice(partStart, i));
      partStart = i + 1;
    }
  }
  parts.push(left.slice(partStart));

  const name = parts[0]!.trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!;
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    const k = p.slice(0, eq).trim().toUpperCase();
    let v = p.slice(eq + 1).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      v = v.slice(1, -1);
    }
    params[k] = v;
  }
  return { name, params, value };
}

/** RFC 5545 TEXT unescape แบบ single-pass: \\ \, \; \n \N */
export function unescapeIcsText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[++i]!;
      if (next === 'n' || next === 'N') out += ' ';
      else if (next === '\\' || next === ',' || next === ';') out += next;
      else out += next;
    } else {
      out += ch;
    }
  }
  return out;
}

const isPicto = (cp: string | undefined): boolean => cp !== undefined && PICTO.test(cp);

function joinerPositionsInEmoji(cps: readonly string[]): Set<number> {
  const ok = new Set<number>();
  for (let i = 0; i < cps.length; i++) {
    if (cps[i]!.codePointAt(0) !== ZWJ) continue;
    let j = i - 1;
    while (j >= 0 && (cps[j]!.codePointAt(0) === VS16 || MODIFIER.test(cps[j]!))) j--;
    if (isPicto(cps[j]) && isPicto(cps[i + 1])) ok.add(i);
  }
  return ok;
}

/** ล้าง + ตัดชื่อจาก SUMMARY ให้ผ่านกติกา parseBusyTitle (I5) · ไม่ผ่า surrogate pair · ว่าง = null */
export function sanitizeIcsSummary(raw: string | undefined, maxCodePoints = DEFAULT_TITLE_MAX): string | null {
  if (!raw) return null;
  const unescaped = unescapeIcsText(raw).normalize('NFC');
  const cps = [...unescaped];
  const joiners = joinerPositionsInEmoji(cps);
  const cleaned: string[] = [];
  let marks = 0;

  for (let i = 0; i < cps.length; i++) {
    let c = cps[i]!;
    if (joiners.has(i)) {
      marks = 0;
      cleaned.push(c);
      continue;
    }
    if (FORBIDDEN.test(c)) continue;
    if (ANY_SPACE.test(c)) c = ' ';
    if (c === ' ') {
      if (cleaned.length === 0 || cleaned[cleaned.length - 1] === ' ') continue;
      marks = 0;
    } else if (MARK.test(c)) {
      const prev = cleaned[cleaned.length - 1];
      if (prev === undefined || prev === ' ' || ++marks > MAX_MARKS_PER_BASE) continue;
    } else {
      marks = 0;
    }
    cleaned.push(c);
  }
  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === ' ') cleaned.pop();

  const truncated = cleaned.length > maxCodePoints ? cleaned.slice(0, maxCodePoints) : cleaned;
  // กัน ZWJ ลอยท้ายหลังตัดความยาว
  while (truncated.length > 0 && (truncated[truncated.length - 1] === ' ' || truncated[truncated.length - 1]!.codePointAt(0) === ZWJ)) {
    truncated.pop();
  }
  if (truncated.length === 0) return null;

  const hasVisible = truncated.some((c) => VISIBLE.test(c) || isPicto(c));
  if (!hasVisible) return null;
  return truncated.join('');
}

// TZID ที่ยาวเกินหรือมีอักขระนอกชุดที่ชื่อ IANA/Windows ใช้ → ไม่รู้จักทันที ไม่ส่งถึง validator (security M1)
const MAX_TZID_LENGTH = 64;
const TZID_CHARS = /^[A-Za-z0-9 _+\-/.(),]+$/;

/** แปลง TZID → IANA ที่ isValidTimeZone ยอมรับ (รองรับ Windows TZID จาก Outlook · ไม่รู้จัก = null) */
export function resolveIcsTimeZone(rawTzid: string): string | null {
  const cleaned: string = rawTzid.trim();
  if (!cleaned) return null;
  if (cleaned.length > MAX_TZID_LENGTH || !TZID_CHARS.test(cleaned)) return null;
  if (isValidTimeZone(cleaned as unknown)) return cleaned;
  if (cleaned.startsWith('/')) {
    const stripped = cleaned.slice(1);
    if (isValidTimeZone(stripped as unknown)) return stripped;
  }
  const win = WINDOWS_TO_IANA[cleaned] ?? WINDOWS_TO_IANA_LOWER.get(cleaned.toLowerCase());
  if (win && isValidTimeZone(win as unknown)) return win;
  return null;
}

const isDigits = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return false;
  }
  return s.length > 0;
};

type ParsedDateValue =
  | { readonly kind: 'date'; readonly date: DateISO; readonly year: number; readonly plainDate: Temporal.PlainDate }
  | {
      readonly kind: 'datetime';
      readonly epochMs: EpochMs;
      readonly year: number;
      readonly plainDateTime: Temporal.PlainDateTime;
      readonly eventTz: string;
    };

function parseDateToken(val: string): Extract<ParsedDateValue, { kind: 'date' }> | null {
  if (val.length !== 8 || !isDigits(val)) return null;
  const year = Number(val.slice(0, 4));
  const month = Number(val.slice(4, 6));
  const day = Number(val.slice(6, 8));
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  try {
    const plainDate = Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' });
    return { kind: 'date', date: plainDate.toString(), year, plainDate };
  } catch {
    return null;
  }
}

function parseDateTimeToken(prop: PropEntry, defaultTz: string): ParsedDateValue | null {
  const val = prop.value.trim();
  const valueParam = prop.params.VALUE?.toUpperCase();

  if (valueParam === 'DATE' || (val.length === 8 && isDigits(val))) {
    return parseDateToken(val);
  }

  // รูปแบบ YYYYMMDDTHHMMSS หรือ YYYYMMDDTHHMMSSZ
  const isUtc = val.endsWith('Z') || val.endsWith('z');
  const core = isUtc ? val.slice(0, -1) : val;
  if (core.length !== 15 || core[8] !== 'T') return null;
  const datePart = core.slice(0, 8);
  const timePart = core.slice(9, 15);
  if (!isDigits(datePart) || !isDigits(timePart)) return null;

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6));
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  const rawSecond = Number(timePart.slice(4, 6));
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || rawSecond > 60) return null;
  const second = rawSecond === 60 ? 59 : rawSecond;

  let pdt: Temporal.PlainDateTime;
  try {
    pdt = Temporal.PlainDateTime.from({ year, month, day, hour, minute, second }, { overflow: 'reject' });
  } catch {
    return null;
  }

  if (isUtc) {
    return {
      kind: 'datetime',
      epochMs: pdt.toZonedDateTime('UTC').epochMilliseconds,
      year,
      plainDateTime: pdt,
      eventTz: 'UTC',
    };
  }

  const rawTzid = prop.params.TZID;
  if (rawTzid !== undefined) {
    const resolved = resolveIcsTimeZone(rawTzid);
    if (!resolved) return null;
    return {
      kind: 'datetime',
      epochMs: pdt.toZonedDateTime(resolved, { disambiguation: 'compatible' }).epochMilliseconds,
      year,
      plainDateTime: pdt,
      eventTz: resolved,
    };
  }

  // Floating time → defaultTz
  return {
    kind: 'datetime',
    epochMs: pdt.toZonedDateTime(defaultTz, { disambiguation: 'compatible' }).epochMilliseconds,
    year,
    plainDateTime: pdt,
    eventTz: defaultTz,
  };
}

/** แปลง RFC 5545 DURATION (เฉพาะค่าบวก P[nW][nD][T[nH][nM][nS]]) แบบ linear */
function parseDuration(raw: string): { days: number; seconds: number } | null {
  let s = raw.trim().toUpperCase();
  if (s.startsWith('+')) s = s.slice(1);
  if (!s.startsWith('P') || s.length < 2) return null;

  let i = 1;
  let inTime = false;
  let days = 0;
  let seconds = 0;
  let sawAny = false;
  const MAX_DAYS = 10_000;
  const MAX_SECONDS = MAX_DAYS * 86_400;

  while (i < s.length) {
    if (s[i] === 'T') {
      if (inTime) return null;
      inTime = true;
      i++;
      continue;
    }
    const numStart = i;
    while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
    if (i === numStart || i >= s.length) return null;
    const n = Number(s.slice(numStart, i));
    if (!Number.isSafeInteger(n) || n > MAX_SECONDS) return null;
    const unit = s[i++]!;
    sawAny = true;

    if (!inTime) {
      if (unit === 'W') days += n * 7;
      else if (unit === 'D') days += n;
      else return null;
      if (days > MAX_DAYS) return null;
    } else {
      if (unit === 'H') seconds += n * 3600;
      else if (unit === 'M') seconds += n * 60;
      else if (unit === 'S') seconds += n;
      else return null;
      if (seconds > MAX_SECONDS) return null;
    }
  }
  return sawAny ? { days, seconds } : null;
}

const formatDateOf = (z: Temporal.ZonedDateTime): DateISO => `${pad4(z.year)}-${pad2(z.month)}-${pad2(z.day)}`;
const formatTimeOf = (z: Temporal.ZonedDateTime): string => `${pad2(z.hour)}:${pad2(z.minute)}`;

// ───────── RRULE + EXDATE / RECURRENCE-ID (V1_2_CONTRACT §1 R1–R4 · ADR 0017 §6) ─────────

const WEEKDAY_TO_ISO: Readonly<Record<string, number>> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

const BYDAY_RE = /^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/;
const BYMONTHDAY_RE = /^[+-]?(?:[1-9]|[12]\d|3[01])$/;
const RRULE_ALLOWED_KEYS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'WKST']);

type MonthlyByDaySpec = { readonly ordinal?: number; readonly dow: number };

type ParsedRrule = {
  readonly freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  readonly interval: number;
  readonly count?: number;
  readonly untilDate?: Temporal.PlainDate;
  readonly untilMs?: EpochMs;
  readonly wkst: number;
  readonly weeklyDays?: readonly number[];
  readonly monthlyByDay?: readonly MonthlyByDaySpec[];
  readonly monthlyDays?: readonly number[];
};

function parseRrule(
  raw: string,
  startKind: 'date' | 'datetime',
  eventTz: string,
  defaultTz: string,
): ParsedRrule | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_RRULE_LENGTH) return null;

  const rawParts = trimmed.split(';');
  if (rawParts.length > 0 && rawParts[rawParts.length - 1] === '') rawParts.pop();
  if (rawParts.length === 0) return null;

  const kv: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const part of rawParts) {
    if (!part) return null;
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const k = part.slice(0, eq).trim().toUpperCase();
    const v = part.slice(eq + 1).trim().toUpperCase();
    if (!k || !v || !RRULE_ALLOWED_KEYS.has(k) || k in kv) return null;
    kv[k] = v;
  }

  const freqRaw = kv.FREQ;
  if (freqRaw !== 'DAILY' && freqRaw !== 'WEEKLY' && freqRaw !== 'MONTHLY') return null;
  const freq = freqRaw;

  let interval = 1;
  if (kv.INTERVAL !== undefined) {
    if (kv.INTERVAL.length > 4 || !isDigits(kv.INTERVAL)) return null;
    interval = Number(kv.INTERVAL);
    if (!Number.isSafeInteger(interval) || interval < 1 || interval > MAX_INTERVAL[freq]) return null;
  }

  // RFC 5545 §3.3.10 ห้ามมี COUNT และ UNTIL พร้อมกัน
  if (kv.COUNT !== undefined && kv.UNTIL !== undefined) return null;

  let count: number | undefined;
  if (kv.COUNT !== undefined) {
    if (kv.COUNT.length > 6 || !isDigits(kv.COUNT)) return null;
    count = Number(kv.COUNT);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_RRULE_COUNT) return null;
  }

  let untilDate: Temporal.PlainDate | undefined;
  let untilMs: EpochMs | undefined;
  if (kv.UNTIL !== undefined) {
    const parsedUntil = parseDateTimeToken({ value: kv.UNTIL, params: Object.create(null) as Record<string, string> }, defaultTz);
    if (!parsedUntil) return null;
    if (startKind === 'date') {
      if (parsedUntil.kind === 'date') {
        untilDate = parsedUntil.plainDate;
      } else {
        untilDate = Temporal.Instant.fromEpochMilliseconds(parsedUntil.epochMs).toZonedDateTimeISO(defaultTz).toPlainDate();
      }
    } else if (parsedUntil.kind === 'datetime') {
      untilMs = parsedUntil.epochMs;
      // เผื่อ ±1 วันจากความต่างโซนเวลาของ eventTz กับ UTC แล้วค่อยตรวจ exact occStartMs <= untilMs
      untilDate = Temporal.Instant.fromEpochMilliseconds(parsedUntil.epochMs)
        .toZonedDateTimeISO(eventTz)
        .toPlainDate()
        .add({ days: 1 });
    } else {
      untilDate = parsedUntil.plainDate;
    }
  }

  let wkst = 1; // MO
  if (kv.WKST !== undefined) {
    const w = WEEKDAY_TO_ISO[kv.WKST];
    if (w === undefined) return null;
    wkst = w;
  }

  if (kv.BYDAY !== undefined && kv.BYMONTHDAY !== undefined) return null;

  let weeklyDays: number[] | undefined;
  let monthlyByDay: MonthlyByDaySpec[] | undefined;
  if (kv.BYDAY !== undefined) {
    if (freq === 'DAILY') return null;
    const tokens = kv.BYDAY.split(',');
    if (tokens.length === 0 || tokens.length > MAX_BYDAY_ITEMS) return null;

    if (freq === 'WEEKLY') {
      const set = new Set<number>();
      for (const tok of tokens) {
        const m = BYDAY_RE.exec(tok);
        if (!m || m[1] !== undefined) return null;
        set.add(WEEKDAY_TO_ISO[m[2]!]!);
      }
      weeklyDays = [...set].sort((a, b) => a - b);
    } else {
      const specs: MonthlyByDaySpec[] = [];
      const seen = new Set<string>();
      for (const tok of tokens) {
        const m = BYDAY_RE.exec(tok);
        if (!m) return null;
        const ordinal = m[1] !== undefined ? Number(m[1]) : undefined;
        const dow = WEEKDAY_TO_ISO[m[2]!]!;
        const key = `${ordinal ?? ''}:${dow}`;
        if (seen.has(key)) continue;
        seen.add(key);
        specs.push(ordinal !== undefined ? { ordinal, dow } : { dow });
      }
      monthlyByDay = specs;
    }
  }

  let monthlyDays: number[] | undefined;
  if (kv.BYMONTHDAY !== undefined) {
    if (freq !== 'MONTHLY') return null;
    const tokens = kv.BYMONTHDAY.split(',');
    if (tokens.length === 0 || tokens.length > MAX_BYMONTHDAY_ITEMS) return null;
    const set = new Set<number>();
    for (const tok of tokens) {
      if (!BYMONTHDAY_RE.test(tok)) return null;
      const n = Number(tok);
      if (n === 0 || n < -31 || n > 31) return null;
      set.add(n);
    }
    monthlyDays = [...set];
  }

  return {
    freq,
    interval,
    ...(count !== undefined ? { count } : {}),
    ...(untilDate !== undefined ? { untilDate } : {}),
    ...(untilMs !== undefined ? { untilMs } : {}),
    wkst,
    ...(weeklyDays !== undefined ? { weeklyDays } : {}),
    ...(monthlyByDay !== undefined ? { monthlyByDay } : {}),
    ...(monthlyDays !== undefined ? { monthlyDays } : {}),
  };
}

type ExclusionSet = {
  /** วันที่จาก VALUE=DATE — ตัดทั้ง all_day และ timed ที่เริ่มวันท้องถิ่นนั้น (ใน eventTz) */
  readonly dates: Set<DateISO>;
  /** epochMs จาก datetime — ตัด timed ที่เริ่มตรง instant เดียวกัน */
  readonly epochs: Set<EpochMs>;
  /** วันจาก datetime — เผื่อ all_day ที่มี EXDATE/RECURRENCE-ID แบบ datetime */
  readonly dateFromDateTime: Set<DateISO>;
};

function createExclusionSet(): ExclusionSet {
  return { dates: new Set(), epochs: new Set(), dateFromDateTime: new Set() };
}

function addExclusion(set: ExclusionSet, parsed: ParsedDateValue): void {
  if (parsed.kind === 'date') {
    set.dates.add(parsed.date);
  } else {
    set.epochs.add(parsed.epochMs);
    set.dateFromDateTime.add(parsed.plainDateTime.toPlainDate().toString());
  }
}

function parseExdates(entries: readonly PropEntry[] | undefined, defaultTz: string, target: ExclusionSet): boolean {
  if (!entries || entries.length === 0) return true;
  let total = 0;
  for (const entry of entries) {
    const tokens = entry.value.split(',');
    for (const rawTok of tokens) {
      const tok = rawTok.trim();
      if (!tok) continue;
      total++;
      if (total > MAX_EXDATES_PER_EVENT) return false;
      const parsed = parseDateTimeToken({ value: tok, params: entry.params }, defaultTz);
      if (parsed) addExclusion(target, parsed);
    }
  }
  return true;
}

function weekStartOf(d: Temporal.PlainDate, wkst: number): Temporal.PlainDate {
  const shift = (d.dayOfWeek - wkst + 7) % 7;
  return shift === 0 ? d : d.subtract({ days: shift });
}

const DAYS_IN_COMMON_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function gregorianDaysInMonth(year: number, month: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return month === 2 && isLeap ? 29 : DAYS_IN_COMMON_MONTH[month]!;
}

/** จำนวนบิตที่เปิดใน bitmask 31 บิต (วัน 1..31) */
function popcount31(n: number): number {
  let x = n;
  let c = 0;
  while (x !== 0) {
    x &= x - 1;
    c++;
  }
  return c;
}

/**
 * คืน bitmask (บิต day-1 สำหรับวัน 1..dim) ของวันที่ตรงกติกา MONTHLY ในเดือนหนึ่ง
 * ใช้เลขคณิตล้วนแทนการสร้าง Temporal.PlainDate ทีละวันในเดือนอดีต (security M1)
 */
function monthlyDayMask(dim: number, firstDow: number, dtstartDay: number, rule: ParsedRrule): number {
  let mask = 0;

  if (rule.monthlyByDay) {
    for (const spec of rule.monthlyByDay) {
      const firstMatch = 1 + ((spec.dow - firstDow + 7) % 7);
      if (spec.ordinal === undefined) {
        for (let d = firstMatch; d <= dim; d += 7) {
          mask |= 1 << (d - 1);
        }
      } else if (spec.ordinal > 0) {
        const d = firstMatch + (spec.ordinal - 1) * 7;
        if (d <= dim) mask |= 1 << (d - 1);
      } else {
        // จำนวนครั้งที่ dow นี้เกิดในเดือน: floor((dim - firstMatch) / 7) + 1 (firstMatch <= 7 <= dim เสมอ)
        const count = Math.floor((dim - firstMatch) / 7) + 1;
        const idx = count + spec.ordinal;
        if (idx >= 0) {
          const d = firstMatch + idx * 7;
          mask |= 1 << (d - 1);
        }
      }
    }
  } else {
    const targets = rule.monthlyDays ?? [dtstartDay];
    for (const md of targets) {
      const d = md > 0 ? md : dim + 1 + md;
      if (d >= 1 && d <= dim) mask |= 1 << (d - 1);
    }
  }

  return mask;
}

type RruleExpandResult =
  | { readonly ok: true; readonly dates: Temporal.PlainDate[] }
  | { readonly ok: false; readonly reason: 'UNSUPPORTED' | 'TOO_LARGE' };

function consumeRruleStep(ctx: ParseCtx): boolean {
  return ++ctx.rruleStepsUsed <= MAX_TOTAL_RRULE_STEPS;
}

function consumeEvaluatedDates(ctx: ParseCtx, count: number): boolean {
  ctx.rruleEvaluatedDates += count;
  return ctx.rruleEvaluatedDates <= MAX_TOTAL_EVALUATED_DATES;
}

function advanceMonthsWithDow(
  year: number,
  month: number,
  firstDow: number,
  interval: number,
): { year: number; month: number; firstDow: number } {
  let deltaDays = 0;
  let y = year;
  let m = month;
  for (let i = 0; i < interval; i++) {
    deltaDays += gregorianDaysInMonth(y, m);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return { year: y, month: m, firstDow: ((firstDow - 1 + deltaDays) % 7) + 1 };
}

function expandDailyDates(
  dtstartDate: Temporal.PlainDate,
  rule: ParsedRrule,
  earliestStartDate: Temporal.PlainDate,
  hardEndDate: Temporal.PlainDate,
  maxCandidates: number,
  ctx: ParseCtx,
): RruleExpandResult {
  const diffDays = dtstartDate.until(earliestStartDate, { largestUnit: 'days' }).days;
  const startK = diffDays > 0 ? Math.floor(diffDays / rule.interval) : 0;
  if (rule.count !== undefined && startK >= rule.count) {
    return { ok: true, dates: [] };
  }

  const out: Temporal.PlainDate[] = [];
  let steps = 0;
  for (let k = startK; ; k++) {
    if (rule.count !== undefined && k >= rule.count) break;
    if (++steps > MAX_RRULE_STEPS) return { ok: false, reason: 'UNSUPPORTED' };
    if (!consumeRruleStep(ctx)) return { ok: false, reason: 'TOO_LARGE' };
    if (!consumeEvaluatedDates(ctx, 1)) return { ok: false, reason: 'TOO_LARGE' };
    const occ = dtstartDate.add({ days: k * rule.interval });
    if (occ.year > MAX_YEAR + 1 || Temporal.PlainDate.compare(occ, hardEndDate) > 0) break;
    if (Temporal.PlainDate.compare(occ, earliestStartDate) >= 0) {
      out.push(occ);
      if (out.length > maxCandidates) return { ok: false, reason: 'TOO_LARGE' };
    }
  }
  return { ok: true, dates: out };
}

function expandWeeklyDates(
  dtstartDate: Temporal.PlainDate,
  rule: ParsedRrule,
  earliestStartDate: Temporal.PlainDate,
  hardEndDate: Temporal.PlainDate,
  maxCandidates: number,
  ctx: ParseCtx,
): RruleExpandResult {
  const days = rule.weeklyDays ?? [dtstartDate.dayOfWeek];
  const offsets = days.map((dow) => (dow - rule.wkst + 7) % 7).sort((a, b) => a - b);
  const ws0 = weekStartOf(dtstartDate, rule.wkst);

  // จำนวน instance ที่เกิดจริงในสัปดาห์แรก (w = 0) ที่ >= dtstartDate
  let firstWeekCount = 0;
  for (const off of offsets) {
    if (Temporal.PlainDate.compare(ws0.add({ days: off }), dtstartDate) >= 0) firstWeekCount++;
  }

  const wsEarliest = weekStartOf(earliestStartDate, rule.wkst);
  const diffWeeks = Math.floor(ws0.until(wsEarliest, { largestUnit: 'days' }).days / 7);
  const startW = diffWeeks > 0 ? Math.floor(diffWeeks / rule.interval) : 0;
  let emitted = startW === 0 ? 0 : firstWeekCount + (startW - 1) * offsets.length;
  if (rule.count !== undefined && emitted >= rule.count) {
    return { ok: true, dates: [] };
  }

  const out: Temporal.PlainDate[] = [];
  let steps = 0;
  for (let w = startW; ; w++) {
    if (++steps > MAX_RRULE_STEPS) return { ok: false, reason: 'UNSUPPORTED' };
    if (!consumeRruleStep(ctx)) return { ok: false, reason: 'TOO_LARGE' };
    const ws = ws0.add({ days: w * rule.interval * 7 });
    if (ws.year > MAX_YEAR + 1 || Temporal.PlainDate.compare(ws, hardEndDate) > 0) break;
    for (const off of offsets) {
      if (rule.count !== undefined && emitted >= rule.count) return { ok: true, dates: out };
      if (!consumeEvaluatedDates(ctx, 1)) return { ok: false, reason: 'TOO_LARGE' };
      const occ = ws.add({ days: off });
      if (w === 0 && Temporal.PlainDate.compare(occ, dtstartDate) < 0) continue;
      if (occ.year > MAX_YEAR + 1 || Temporal.PlainDate.compare(occ, hardEndDate) > 0) return { ok: true, dates: out };
      emitted++;
      if (Temporal.PlainDate.compare(occ, earliestStartDate) >= 0) {
        out.push(occ);
        if (out.length > maxCandidates) return { ok: false, reason: 'TOO_LARGE' };
      }
    }
  }
  return { ok: true, dates: out };
}

function expandMonthlyDates(
  dtstartDate: Temporal.PlainDate,
  rule: ParsedRrule,
  earliestStartDate: Temporal.PlainDate,
  hardEndDate: Temporal.PlainDate,
  maxCandidates: number,
  ctx: ParseCtx,
): RruleExpandResult {
  const diffMonths = (earliestStartDate.year - dtstartDate.year) * 12 + (earliestStartDate.month - dtstartDate.month);
  // ถ้ามี COUNT ต้องนับจากเดือนแรกเพราะบางเดือนไม่มีวันที่ 31 หรือสัปดาห์ที่ 5
  const startM = rule.count === undefined && diffMonths > 0 ? Math.floor(diffMonths / rule.interval) : 0;
  const baseAbsMonth = dtstartDate.year * 12 + (dtstartDate.month - 1);
  const startAbsMonth = baseAbsMonth + startM * rule.interval;
  let year = Math.floor(startAbsMonth / 12);
  let month = (startAbsMonth % 12) + 1;
  if (year > MAX_YEAR + 1) return { ok: true, dates: [] };

  // ยึด dayOfWeek ของวันที่ 1 เดือนเริ่มต้นจาก Temporal ครั้งเดียว แล้วเลื่อนด้วยจำนวนวันในแต่ละเดือน
  let firstDow = Temporal.PlainDate.from({ year, month, day: 1 }).dayOfWeek;
  const fastSkipCutoff =
    Temporal.PlainDate.compare(earliestStartDate, hardEndDate) <= 0 ? earliestStartDate : hardEndDate;

  const out: Temporal.PlainDate[] = [];
  let steps = 0;
  let emitted = 0;

  for (let m = startM; ; m++) {
    if (++steps > MAX_RRULE_STEPS) return { ok: false, reason: 'UNSUPPORTED' };
    if (!consumeRruleStep(ctx)) return { ok: false, reason: 'TOO_LARGE' };
    if (year > MAX_YEAR + 1) break;
    if (year > hardEndDate.year || (year === hardEndDate.year && month > hardEndDate.month)) break;

    const isStrictlyBeforeCutoff =
      year < fastSkipCutoff.year || (year === fastSkipCutoff.year && month < fastSkipCutoff.month);

    if (!isStrictlyBeforeCutoff || rule.count !== undefined) {
      const dim = gregorianDaysInMonth(year, month);
      const minDay = year === dtstartDate.year && month === dtstartDate.month ? dtstartDate.day : 1;
      let mask = monthlyDayMask(dim, firstDow, dtstartDate.day, rule);
      if (minDay > 1) mask &= ~((1 << (minDay - 1)) - 1);

      if (isStrictlyBeforeCutoff) {
        const countInMonth = popcount31(mask);
        if (countInMonth > 0) {
          const needed = Math.min(countInMonth, rule.count! - emitted);
          if (!consumeEvaluatedDates(ctx, needed)) return { ok: false, reason: 'TOO_LARGE' };
          emitted += needed;
          if (emitted >= rule.count!) return { ok: true, dates: out };
        }
      } else if (mask !== 0) {
        for (let day = minDay; day <= dim; day++) {
          if ((mask & (1 << (day - 1))) === 0) continue;
          if (!consumeEvaluatedDates(ctx, 1)) return { ok: false, reason: 'TOO_LARGE' };
          const occ = Temporal.PlainDate.from({ year, month, day });
          if (occ.year > MAX_YEAR + 1 || Temporal.PlainDate.compare(occ, hardEndDate) > 0) {
            return { ok: true, dates: out };
          }
          emitted++;
          if (Temporal.PlainDate.compare(occ, earliestStartDate) >= 0) {
            out.push(occ);
            if (out.length > maxCandidates) return { ok: false, reason: 'TOO_LARGE' };
          }
          if (rule.count !== undefined && emitted >= rule.count) {
            return { ok: true, dates: out };
          }
        }
      }
    }

    ({ year, month, firstDow } = advanceMonthsWithDow(year, month, firstDow, rule.interval));
  }
  return { ok: true, dates: out };
}

/**
 * แตกวันที่ของผู้สมัครจาก RRULE ในช่วง [earliestStartDate, hardEndDate] แบบ O(1) fast-forward
 * และจำกัดจำนวน step/วันประเมินทั้งต่อ VEVENT และรวมระดับไฟล์ (security M1) + จำนวนผู้สมัครสูงสุด (maxCandidates)
 */
function expandRruleDates(
  dtstartDate: Temporal.PlainDate,
  rule: ParsedRrule,
  earliestStartDate: Temporal.PlainDate,
  latestStartDate: Temporal.PlainDate,
  maxCandidates: number,
  ctx: ParseCtx,
): RruleExpandResult {
  const hardEndDate =
    rule.untilDate !== undefined && Temporal.PlainDate.compare(rule.untilDate, latestStartDate) < 0
      ? rule.untilDate
      : latestStartDate;

  if (Temporal.PlainDate.compare(dtstartDate, hardEndDate) > 0) {
    return { ok: true, dates: [] };
  }

  if (rule.freq === 'DAILY') {
    return expandDailyDates(dtstartDate, rule, earliestStartDate, hardEndDate, maxCandidates, ctx);
  }
  if (rule.freq === 'WEEKLY') {
    return expandWeeklyDates(dtstartDate, rule, earliestStartDate, hardEndDate, maxCandidates, ctx);
  }
  return expandMonthlyDates(dtstartDate, rule, earliestStartDate, hardEndDate, maxCandidates, ctx);
}

// ───────── แปลง 1 occurrence (all-day / timed) เป็น ParsedIcsBusyItem ─────────

type ParseCtx = {
  readonly nowMs: EpochMs;
  readonly defaultTz: string;
  readonly today: DateISO;
  readonly maxAheadDate: DateISO;
  readonly maxBackdateDays: number;
  readonly maxSpanDays: number;
  readonly maxTimedDays: number;
  readonly titleMax: number;
  readonly maxOccurrencesPerEvent: number;
  readonly maxItems: number;
  rruleStepsUsed: number;
  rruleEvaluatedDates: number;
};

type SingleOutcome =
  | { readonly status: 'ok'; readonly item: ParsedIcsBusyItem }
  | { readonly status: 'skip'; readonly reason: keyof IcsSkipCounts };

function buildAllDayItem(startDate: DateISO, endDate: DateISO, title: string | null, ctx: ParseCtx): SingleOutcome {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  if (endYear < MIN_YEAR) return { status: 'skip', reason: 'past' };
  if (startYear > MAX_YEAR) return { status: 'skip', reason: 'tooFarAhead' };
  if (isTooFarBack(endDate, ctx.nowMs, ctx.defaultTz, ctx.maxBackdateDays)) return { status: 'skip', reason: 'past' };
  if (compareDates(startDate, ctx.maxAheadDate) > 0) return { status: 'skip', reason: 'tooFarAhead' };
  if (startYear < MIN_YEAR || endYear > MAX_YEAR) return { status: 'skip', reason: 'tooLong' };

  const input: BusyInput = { kind: 'all_day', startDate, endDate, tz: ctx.defaultTz };
  const norm = normalizeBusyInput(input, {
    now: ctx.nowMs,
    maxSpanDays: ctx.maxSpanDays,
    maxBackdateDays: ctx.maxBackdateDays,
    maxTimedDays: ctx.maxTimedDays,
  });
  if (!norm.ok) {
    if (norm.error.code === 'SPAN_TOO_LONG') return { status: 'skip', reason: 'tooLong' };
    if (norm.error.code === 'TOO_FAR_BACK') return { status: 'skip', reason: 'past' };
    return { status: 'skip', reason: 'invalid' };
  }
  return {
    status: 'ok',
    item: {
      kind: 'all_day',
      startDate: norm.value.localStartDate,
      endDate: norm.value.localEndDate,
      tz: norm.value.tz,
      title,
      rounded: false,
      row: norm.value,
    },
  };
}

function buildTimedItem(startMs: EpochMs, endMs: EpochMs, title: string | null, ctx: ParseCtx): SingleOutcome {
  if (endMs <= startMs) return { status: 'skip', reason: 'invalid' };

  // แปลงเป็นเวลาท้องถิ่นใน defaultTz แล้วปัดออก (outward rounding) เป็นครึ่งชั่วโมง (I3)
  const startZ = Temporal.Instant.fromEpochMilliseconds(startMs).toZonedDateTimeISO(ctx.defaultTz);
  const endZ = Temporal.Instant.fromEpochMilliseconds(endMs).toZonedDateTimeISO(ctx.defaultTz);

  const startRemSec = (startZ.minute % STEP_MINUTES) * 60 + startZ.second;
  const endRemSec = (endZ.minute % STEP_MINUTES) * 60 + endZ.second;
  const rounded = startRemSec > 0 || endRemSec > 0;

  const rStartZ = startRemSec > 0 ? startZ.subtract({ seconds: startRemSec }) : startZ;
  const rEndZ = endRemSec > 0 ? endZ.add({ seconds: STEP_MINUTES * 60 - endRemSec }) : endZ;

  // คำนวณวันท้องถิ่นต้น/ปลาย (endAt - 1 ms เหมือน busy.ts) เพื่อตรวจ past/tooFarAhead ก่อน normalize
  const localStartDate = formatDateOf(rStartZ);
  const localEndZ = Temporal.Instant.fromEpochMilliseconds(rEndZ.epochMilliseconds - 1).toZonedDateTimeISO(ctx.defaultTz);
  const localEndDate = formatDateOf(localEndZ);

  if (localEndZ.year < MIN_YEAR) return { status: 'skip', reason: 'past' };
  if (rStartZ.year > MAX_YEAR) return { status: 'skip', reason: 'tooFarAhead' };
  if (isTooFarBack(localEndDate, ctx.nowMs, ctx.defaultTz, ctx.maxBackdateDays)) return { status: 'skip', reason: 'past' };
  if (compareDates(localStartDate, ctx.maxAheadDate) > 0) return { status: 'skip', reason: 'tooFarAhead' };
  if (rStartZ.year < MIN_YEAR || rEndZ.year > MAX_YEAR) return { status: 'skip', reason: 'tooLong' };

  const startDate = formatDateOf(rStartZ);
  const startTime = formatTimeOf(rStartZ);
  const endDate = formatDateOf(rEndZ);
  const endTime = formatTimeOf(rEndZ);

  const input: BusyInput = { kind: 'timed', startDate, startTime, endDate, endTime, tz: ctx.defaultTz };
  const norm = normalizeBusyInput(input, {
    now: ctx.nowMs,
    maxSpanDays: ctx.maxSpanDays,
    maxBackdateDays: ctx.maxBackdateDays,
    maxTimedDays: ctx.maxTimedDays,
  });
  if (!norm.ok) {
    if (norm.error.code === 'SPAN_TOO_LONG') return { status: 'skip', reason: 'tooLong' };
    if (norm.error.code === 'TOO_FAR_BACK') return { status: 'skip', reason: 'past' };
    return { status: 'skip', reason: 'invalid' };
  }
  return {
    status: 'ok',
    item: {
      kind: 'timed',
      startDate,
      startTime,
      endDate,
      endTime,
      tz: norm.value.tz,
      title,
      rounded,
      row: norm.value,
    },
  };
}

type EventProcessOutcome =
  | { readonly status: 'ok'; readonly items: readonly ParsedIcsBusyItem[] }
  | { readonly status: 'skip'; readonly reason: keyof IcsSkipCounts }
  | { readonly status: 'none' }
  | { readonly status: 'too_large' };

function processRawEvent(
  ev: RawEvent,
  ctx: ParseCtx,
  overridesByUid: ReadonlyMap<string, ExclusionSet>,
  remainingItemBudget: number,
): EventProcessOutcome {
  // ลำดับการกรอง: cancelled → transparent → (multiple RRULE / RECURRENCE-ID+RRULE) → dtstart → ...
  if (ev.status?.value.trim().toUpperCase() === 'CANCELLED') return { status: 'skip', reason: 'cancelled' };
  if (ev.transp?.value.trim().toUpperCase() === 'TRANSPARENT') return { status: 'skip', reason: 'transparent' };

  const hasRrule = ev.rrule !== undefined && ev.rrule.value.trim() !== '';
  if (ev.multipleRrules || (hasRrule && ev.recurrenceId !== undefined)) {
    return { status: 'skip', reason: 'rrule' };
  }

  if (!ev.dtstart) return { status: 'skip', reason: 'invalid' };
  const start = parseDateTimeToken(ev.dtstart, ctx.defaultTz);
  if (!start) return { status: 'skip', reason: 'invalid' };

  const title = sanitizeIcsSummary(ev.summary?.value, ctx.titleMax);

  // คำนวณความยาว (all_day = spanDays, timed = durationMs)
  let allDaySpanDays = 0;
  let timedDurationMs = 0;
  if (start.kind === 'date') {
    let endDate: DateISO;
    if (ev.dtend) {
      const end = parseDateTimeToken(ev.dtend, ctx.defaultTz);
      if (!end || end.kind !== 'date') return { status: 'skip', reason: 'invalid' };
      const inclusive = addDays(end.date, -1);
      if (compareDates(inclusive, start.date) < 0) return { status: 'skip', reason: 'invalid' };
      endDate = inclusive;
    } else if (ev.duration) {
      const dur = parseDuration(ev.duration.value);
      if (!dur || dur.days < 1 || dur.seconds !== 0) return { status: 'skip', reason: 'invalid' };
      endDate = addDays(start.date, dur.days - 1);
    } else {
      endDate = start.date;
    }
    if (!hasRrule) {
      const single = buildAllDayItem(start.date, endDate, title, ctx);
      return single.status === 'ok' ? { status: 'ok', items: [single.item] } : single;
    }
    allDaySpanDays = start.plainDate.until(Temporal.PlainDate.from(endDate), { largestUnit: 'days' }).days;
    if (allDaySpanDays + 1 > ctx.maxSpanDays) return { status: 'skip', reason: 'tooLong' };
  } else {
    let endMs: EpochMs;
    if (ev.dtend) {
      const end = parseDateTimeToken(ev.dtend, ctx.defaultTz);
      if (!end || end.kind !== 'datetime') return { status: 'skip', reason: 'invalid' };
      endMs = end.epochMs;
    } else if (ev.duration) {
      const dur = parseDuration(ev.duration.value);
      if (!dur) return { status: 'skip', reason: 'invalid' };
      const deltaMs = (dur.days * 86_400 + dur.seconds) * 1000;
      if (deltaMs <= 0) return { status: 'skip', reason: 'invalid' };
      endMs = start.epochMs + deltaMs;
    } else {
      return { status: 'skip', reason: 'invalid' };
    }
    if (endMs <= start.epochMs) return { status: 'skip', reason: 'invalid' };
    if (!hasRrule) {
      const single = buildTimedItem(start.epochMs, endMs, title, ctx);
      return single.status === 'ok' ? { status: 'ok', items: [single.item] } : single;
    }
    timedDurationMs = endMs - start.epochMs;
    if (timedDurationMs > ctx.maxTimedDays * 86_400_000) return { status: 'skip', reason: 'tooLong' };
  }

  // ── กรณีมี RRULE (V1_2_CONTRACT §1 R1–R4) ──
  const eventTz = start.kind === 'datetime' ? start.eventTz : ctx.defaultTz;
  const rule = parseRrule(ev.rrule!.value, start.kind, eventTz, ctx.defaultTz);
  if (!rule) return { status: 'skip', reason: 'rrule' };

  const exclusions = createExclusionSet();
  if (!parseExdates(ev.exdates, ctx.defaultTz, exclusions)) {
    return { status: 'skip', reason: 'rrule' };
  }
  const uidOverrides = ev.uid ? overridesByUid.get(ev.uid) : undefined;

  const dtstartPlainDate = start.kind === 'date' ? start.plainDate : start.plainDateTime.toPlainDate();
  const spanPadDays =
    start.kind === 'date' ? allDaySpanDays + 1 : Math.ceil(timedDurationMs / 86_400_000) + 2;
  const todayPlain = Temporal.PlainDate.from(ctx.today);
  const maxAheadPlain = Temporal.PlainDate.from(ctx.maxAheadDate);
  const earliestStartDate = todayPlain.subtract({ days: ctx.maxBackdateDays + spanPadDays });
  const latestStartDate = maxAheadPlain.add({ days: 2 });

  const perEventCap = Math.min(ctx.maxOccurrencesPerEvent, remainingItemBudget);
  // เผื่อ candidate สำหรับวันที่จะโดนตัดด้วย EXDATE/RECURRENCE-ID หรือขอบเขตวัน
  const maxCandidates = Math.max(perEventCap, ctx.maxOccurrencesPerEvent) + MAX_EXDATES_PER_EVENT + 16;

  const expanded = expandRruleDates(dtstartPlainDate, rule, earliestStartDate, latestStartDate, maxCandidates, ctx);
  if (!expanded.ok) {
    return expanded.reason === 'TOO_LARGE' ? { status: 'too_large' } : { status: 'skip', reason: 'rrule' };
  }

  const emittedItems: ParsedIcsBusyItem[] = [];
  let sawExcluded = false;
  let sawPast = false;
  let sawFuture = false;
  let sawTooLong = false;
  let sawInvalid = false;

  const startPlainTime = start.kind === 'datetime' ? start.plainDateTime.toPlainTime() : null;

  for (const occDate of expanded.dates) {
    const occDateStr: DateISO = occDate.toString();

    if (start.kind === 'date') {
      const isExcluded =
        exclusions.dates.has(occDateStr) ||
        exclusions.dateFromDateTime.has(occDateStr) ||
        (uidOverrides !== undefined &&
          (uidOverrides.dates.has(occDateStr) || uidOverrides.dateFromDateTime.has(occDateStr)));
      if (isExcluded) {
        sawExcluded = true;
        continue;
      }
      const occEndDate = allDaySpanDays === 0 ? occDateStr : addDays(occDateStr, allDaySpanDays);
      const res = buildAllDayItem(occDateStr, occEndDate, title, ctx);
      if (res.status === 'ok') {
        if (emittedItems.length >= perEventCap) return { status: 'too_large' };
        emittedItems.push(res.item);
      } else if (res.reason === 'past') sawPast = true;
      else if (res.reason === 'tooFarAhead') sawFuture = true;
      else if (res.reason === 'tooLong') sawTooLong = true;
      else sawInvalid = true;
    } else {
      const occStartMs = occDate
        .toPlainDateTime(startPlainTime!)
        .toZonedDateTime(start.eventTz, { disambiguation: 'compatible' }).epochMilliseconds;
      if (rule.untilMs !== undefined && occStartMs > rule.untilMs) break;

      const isExcluded =
        exclusions.epochs.has(occStartMs) ||
        exclusions.dates.has(occDateStr) ||
        (uidOverrides !== undefined &&
          (uidOverrides.epochs.has(occStartMs) || uidOverrides.dates.has(occDateStr)));
      if (isExcluded) {
        sawExcluded = true;
        continue;
      }

      const res = buildTimedItem(occStartMs, occStartMs + timedDurationMs, title, ctx);
      if (res.status === 'ok') {
        if (emittedItems.length >= perEventCap) return { status: 'too_large' };
        emittedItems.push(res.item);
      } else if (res.reason === 'past') sawPast = true;
      else if (res.reason === 'tooFarAhead') sawFuture = true;
      else if (res.reason === 'tooLong') sawTooLong = true;
      else sawInvalid = true;
    }
  }

  if (emittedItems.length > 0) return { status: 'ok', items: emittedItems };
  if (sawTooLong) return { status: 'skip', reason: 'tooLong' };
  if (sawInvalid) return { status: 'skip', reason: 'invalid' };
  if (sawExcluded) return { status: 'none' };
  if (Temporal.PlainDate.compare(dtstartPlainDate, maxAheadPlain) > 0 || (sawFuture && !sawPast)) {
    return { status: 'skip', reason: 'tooFarAhead' };
  }
  return { status: 'skip', reason: 'past' };
}

/**
 * แปลงข้อความไฟล์ `.ics` เป็นรายการ busy ที่ผ่านกติกา maewmeet + สรุปเหตุผลที่ข้าม
 * pure: รับ nowMs + options · ไม่โยน exception สำหรับอินพุตผิดรูป (คืน ParseIcsResult)
 */
export function parseIcsToBusy(raw: string, options: ParseIcsOptions): ParseIcsResult {
  const defaultTz = options.defaultTz ?? DEFAULT_TZ;
  if (!isValidTimeZone(defaultTz)) {
    throw new RangeError(`parseIcsToBusy: invalid defaultTz "${defaultTz}"`);
  }
  const maxBytes = options.maxBytes ?? ICS_IMPORT_MAX_BYTES;
  const maxLines = options.maxLines ?? ICS_IMPORT_MAX_LINES;
  const maxEvents = options.maxEvents ?? ICS_IMPORT_MAX_EVENTS;
  const maxOccurrencesPerEvent = options.maxOccurrencesPerEvent ?? ICS_IMPORT_MAX_OCCURRENCES_PER_EVENT;
  const maxItems = options.maxItems ?? ICS_IMPORT_MAX_EXPANDED_ITEMS;
  const windowDays = options.windowDays ?? ICS_IMPORT_DEFAULT_WINDOW_DAYS;
  const maxBackdateDays = options.maxBackdateDays ?? DEFAULT_MAX_BACKDATE_DAYS;
  const maxSpanDays = options.maxSpanDays ?? DEFAULT_MAX_SPAN_DAYS;
  const maxTimedDays = options.maxTimedDays ?? TIMED_MAX_DAYS;
  const titleMax = options.titleMax ?? DEFAULT_TITLE_MAX;

  const check = inspectRawInput(raw, maxBytes);
  if (check === 'TOO_LARGE') return { ok: false, error: 'TOO_LARGE', limit: 'bytes', max: maxBytes };
  if (check === 'BINARY') return { ok: false, error: 'INVALID', reason: 'BINARY' };

  const unfolded = unfoldLines(raw, maxLines);
  if (!unfolded.ok) return { ok: false, error: 'TOO_LARGE', limit: 'lines', max: maxLines };

  const today = todayIn(defaultTz, options.nowMs);
  const maxAheadDate = addDays(today, windowDays);
  const ctx: ParseCtx = {
    nowMs: options.nowMs,
    defaultTz,
    today,
    maxAheadDate,
    maxBackdateDays,
    maxSpanDays,
    maxTimedDays,
    titleMax,
    maxOccurrencesPerEvent,
    maxItems,
    rruleStepsUsed: 0,
    rruleEvaluatedDates: 0,
  };

  // เฟส 1: สแกนโครงสร้าง VCALENDAR / VEVENT แบบ single-pass (บังคับ END:VCALENDAR ปิดครบ · V1_2_CONTRACT H1)
  const rawEvents: RawEvent[] = [];
  let seenCalendar = false;
  let seenEndCalendar = false;
  let inCalendar = false;
  let inEvent = false;
  let nestedDepth = 0;
  let totalEvents = 0;
  let current: RawEvent | null = null;

  for (const line of unfolded.lines) {
    if (line === '') continue;
    const prop = parsePropertyLine(line);
    if (!prop) continue;

    if (prop.name === 'BEGIN') {
      const comp = prop.value.trim().toUpperCase();
      if (!inCalendar) {
        if (comp === 'VCALENDAR') {
          seenCalendar = true;
          inCalendar = true;
          nestedDepth = 0;
        }
      } else if (!inEvent) {
        if (nestedDepth === 0 && comp === 'VEVENT') {
          totalEvents++;
          if (totalEvents > maxEvents) {
            return { ok: false, error: 'TOO_LARGE', limit: 'events', max: maxEvents };
          }
          inEvent = true;
          current = {};
        } else {
          nestedDepth++;
        }
      } else {
        // ภายใน VEVENT เช่น BEGIN:VALARM → ข้าม property ด้านในทั้งหมด
        nestedDepth++;
      }
      continue;
    }

    if (prop.name === 'END') {
      const comp = prop.value.trim().toUpperCase();
      if (inEvent) {
        if (nestedDepth > 0) {
          nestedDepth--;
        } else if (comp === 'VEVENT' && current) {
          rawEvents.push(current);
          inEvent = false;
          current = null;
        }
      } else if (inCalendar) {
        if (nestedDepth > 0) {
          nestedDepth--;
        } else if (comp === 'VCALENDAR') {
          seenEndCalendar = true;
          inCalendar = false;
        }
      }
      continue;
    }

    if (inEvent && nestedDepth === 0 && current && ALLOWED_PROPS.has(prop.name)) {
      const entry: PropEntry = { value: prop.value, params: prop.params };
      switch (prop.name) {
        case 'SUMMARY':
          current.summary = entry;
          break;
        case 'DTSTART':
          current.dtstart = entry;
          break;
        case 'DTEND':
          current.dtend = entry;
          break;
        case 'DURATION':
          current.duration = entry;
          break;
        case 'TRANSP':
          current.transp = entry;
          break;
        case 'STATUS':
          current.status = entry;
          break;
        case 'RRULE':
          if (current.rrule !== undefined) current.multipleRrules = true;
          current.rrule = entry;
          break;
        case 'EXDATE':
          (current.exdates ??= []).push(entry);
          break;
        case 'RECURRENCE-ID':
          current.recurrenceId = entry;
          break;
        case 'UID': {
          const u = prop.value.trim();
          if (u.length > 0 && u.length <= MAX_UID_LENGTH) current.uid = u;
          break;
        }
      }
    }
  }

  // บังคับต้องเปิดและปิด VCALENDAR ครบและไม่มี VEVENT/component ค้างเปิด (QA #6 / H1)
  if (!seenCalendar || !seenEndCalendar || inCalendar || inEvent) {
    return { ok: false, error: 'INVALID', reason: 'NOT_ICS' };
  }

  // เฟส 2: รวม RECURRENCE-ID ต่อ UID (รวมตัวที่ STATUS:CANCELLED ด้วย เพื่อตัด instance เดิมออกจาก master RRULE)
  // UID อยู่แค่ในตัวแปร local นี้ ไม่ส่งออก/ไม่เก็บ/ไม่ log
  const overridesByUid = new Map<string, ExclusionSet>();
  const overrideCounts = new Map<string, number>();
  for (const ev of rawEvents) {
    if (!ev.uid || !ev.recurrenceId) continue;
    const count = overrideCounts.get(ev.uid) ?? 0;
    if (count >= MAX_EXDATES_PER_EVENT) continue;
    const parsedRec = parseDateTimeToken(ev.recurrenceId, defaultTz);
    if (!parsedRec) continue;
    let set = overridesByUid.get(ev.uid);
    if (!set) {
      set = createExclusionSet();
      overridesByUid.set(ev.uid, set);
    }
    addExclusion(set, parsedRec);
    overrideCounts.set(ev.uid, count + 1);
  }

  // เฟส 3: แปลง VEVENT ทั้งหมด (รวมขยาย RRULE ใต้เพดาน maxItems)
  const skipped: IcsSkipCounts = {
    rrule: 0,
    cancelled: 0,
    transparent: 0,
    past: 0,
    tooFarAhead: 0,
    tooLong: 0,
    invalid: 0,
  };
  const items: ParsedIcsBusyItem[] = [];

  for (const ev of rawEvents) {
    const remaining = maxItems - items.length;
    const outcome = processRawEvent(ev, ctx, overridesByUid, remaining);
    if (outcome.status === 'too_large') {
      return { ok: false, error: 'TOO_LARGE', limit: 'events', max: maxItems };
    }
    if (outcome.status === 'ok') {
      for (const it of outcome.items) items.push(it);
      if (items.length > maxItems) {
        return { ok: false, error: 'TOO_LARGE', limit: 'events', max: maxItems };
      }
    } else if (outcome.status === 'skip') {
      skipped[outcome.reason]++;
    }
  }

  items.sort(
    (a, b) =>
      a.row.startAt - b.row.startAt ||
      a.row.endAt - b.row.endAt ||
      (a.row.allDay === b.row.allDay ? 0 : a.row.allDay ? -1 : 1) ||
      (a.title ?? '').localeCompare(b.title ?? ''),
  );

  return { ok: true, items, skipped, totalEvents };
}

/** คีย์กันซ้ำ (ADR 0017 §3 / B4): เวลาตรงกันเป๊ะ (allDay, startAt, endAt, localStartDate, localEndDate) */
export function busyDedupeKey(row: Pick<BusyRow, 'allDay' | 'startAt' | 'endAt' | 'localStartDate' | 'localEndDate'>): string {
  return `${row.allDay ? 1 : 0}|${row.startAt}|${row.endAt}|${row.localStartDate}|${row.localEndDate}`;
}
