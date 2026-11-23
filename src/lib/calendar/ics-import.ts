// Pure RFC 5545 .ics parser สำหรับนำเข้าเวลาไม่ว่าง (ICS_IMPORT_CONTRACT §1 I1–I5 · ADR 0017)
// pure: ใช้เฉพาะ temporal-polyfill และ lib ใน src/lib/calendar เท่านั้น — ไม่อ่านนาฬิกา (รับ nowMs) · ไม่แตะ DB/HTTP/env
// linear O(n) single-pass scanner ไม่มี backtracking regex กัน ReDoS · ไม่อ่าน DESCRIPTION/LOCATION/ATTENDEE/ORGANIZER/URL
import { Temporal } from 'temporal-polyfill';
import { normalizeBusyInput, type BusyInput, type BusyRow } from './busy';
import { DEFAULT_TZ, MAX_YEAR, MIN_YEAR, STEP_MINUTES, TIMED_MAX_DAYS, type DateISO, type EpochMs } from './constants';
import { addDays, compareDates } from './date';
import { isTooFarBack } from './limits';
import { isValidTimeZone, todayIn } from './zone';

export const ICS_IMPORT_MAX_BYTES = 512 * 1024;
export const ICS_IMPORT_MAX_LINES = 20_000;
export const ICS_IMPORT_MAX_EVENTS = 500;
export const ICS_IMPORT_WINDOW_OPTIONS = [30, 60, 90, 180] as const;
export type IcsImportWindowDays = (typeof ICS_IMPORT_WINDOW_OPTIONS)[number];
export const ICS_IMPORT_DEFAULT_WINDOW_DAYS: IcsImportWindowDays = 90;

const DEFAULT_MAX_BACKDATE_DAYS = 7;
const DEFAULT_MAX_SPAN_DAYS = 366;
const DEFAULT_TITLE_MAX = 80;

/** คีย์เหตุผลที่ข้ามรายการในหน้า preview (I4) */
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

const ALLOWED_PROPS = new Set(['SUMMARY', 'DTSTART', 'DTEND', 'DURATION', 'TRANSP', 'STATUS', 'RRULE']);

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

/** แปลง TZID → IANA ที่ isValidTimeZone ยอมรับ (รองรับ Windows TZID จาก Outlook · ไม่รู้จัก = null) */
export function resolveIcsTimeZone(rawTzid: string): string | null {
  const cleaned = rawTzid.trim();
  if (!cleaned) return null;
  if (isValidTimeZone(cleaned)) return cleaned;
  if (cleaned.startsWith('/')) {
    const stripped = cleaned.slice(1);
    if (isValidTimeZone(stripped)) return stripped;
  }
  const win = WINDOWS_TO_IANA[cleaned] ?? WINDOWS_TO_IANA_LOWER.get(cleaned.toLowerCase());
  if (win && isValidTimeZone(win)) return win;
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
  | { readonly kind: 'date'; readonly date: DateISO; readonly year: number }
  | { readonly kind: 'datetime'; readonly epochMs: EpochMs; readonly year: number };

function parseDateToken(val: string): { kind: 'date'; date: DateISO; year: number } | null {
  if (val.length !== 8 || !isDigits(val)) return null;
  const year = Number(val.slice(0, 4));
  const month = Number(val.slice(4, 6));
  const day = Number(val.slice(6, 8));
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  try {
    const d = Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' });
    return { kind: 'date', date: d.toString(), year };
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
    return { kind: 'datetime', epochMs: pdt.toZonedDateTime('UTC').epochMilliseconds, year };
  }

  const rawTzid = prop.params.TZID;
  if (rawTzid !== undefined) {
    const resolved = resolveIcsTimeZone(rawTzid);
    if (!resolved) return null;
    return {
      kind: 'datetime',
      epochMs: pdt.toZonedDateTime(resolved, { disambiguation: 'compatible' }).epochMilliseconds,
      year,
    };
  }

  // Floating time → defaultTz
  return {
    kind: 'datetime',
    epochMs: pdt.toZonedDateTime(defaultTz, { disambiguation: 'compatible' }).epochMilliseconds,
    year,
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

type EventOutcome =
  | { readonly status: 'ok'; readonly item: ParsedIcsBusyItem }
  | { readonly status: 'skip'; readonly reason: keyof IcsSkipCounts };

function processRawEvent(
  ev: RawEvent,
  ctx: {
    nowMs: EpochMs;
    defaultTz: string;
    today: DateISO;
    maxAheadDate: DateISO;
    maxBackdateDays: number;
    maxSpanDays: number;
    maxTimedDays: number;
    titleMax: number;
  },
): EventOutcome {
  // ลำดับการกรอง (ADR 0017 §2 ข้อ 5): cancelled → transparent → rrule → invalid → past → tooFarAhead → tooLong
  if (ev.status?.value.trim().toUpperCase() === 'CANCELLED') return { status: 'skip', reason: 'cancelled' };
  if (ev.transp?.value.trim().toUpperCase() === 'TRANSPARENT') return { status: 'skip', reason: 'transparent' };
  if (ev.rrule !== undefined && ev.rrule.value.trim() !== '') return { status: 'skip', reason: 'rrule' };
  if (!ev.dtstart) return { status: 'skip', reason: 'invalid' };

  const start = parseDateTimeToken(ev.dtstart, ctx.defaultTz);
  if (!start) return { status: 'skip', reason: 'invalid' };

  const title = sanitizeIcsSummary(ev.summary?.value, ctx.titleMax);

  if (start.kind === 'date') {
    let endDate: DateISO;
    if (ev.dtend) {
      const end = parseDateTimeToken(ev.dtend, ctx.defaultTz);
      if (!end || end.kind !== 'date') return { status: 'skip', reason: 'invalid' };
      // RFC 5545 DTEND ของ VALUE=DATE เป็น exclusive → ลบ 1 วันเป็น inclusive
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

    // ช่วงวันที่ก่อน/หลังขอบเขต (รวมปีนอก 2000–2100)
    const endYear = Number(endDate.slice(0, 4));
    if (endYear < MIN_YEAR) return { status: 'skip', reason: 'past' };
    if (start.year > MAX_YEAR) return { status: 'skip', reason: 'tooFarAhead' };
    if (isTooFarBack(endDate, ctx.nowMs, ctx.defaultTz, ctx.maxBackdateDays)) return { status: 'skip', reason: 'past' };
    if (compareDates(start.date, ctx.maxAheadDate) > 0) return { status: 'skip', reason: 'tooFarAhead' };
    if (start.year < MIN_YEAR || endYear > MAX_YEAR) return { status: 'skip', reason: 'tooLong' };

    const input: BusyInput = { kind: 'all_day', startDate: start.date, endDate, tz: ctx.defaultTz };
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

  // timed event
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
    // ไม่มีทั้ง DTEND และ DURATION สำหรับ timed → 0 นาที → ข้าม
    return { status: 'skip', reason: 'invalid' };
  }

  if (endMs <= start.epochMs) return { status: 'skip', reason: 'invalid' };

  // แปลงเป็นเวลาท้องถิ่นใน defaultTz แล้วปัดออก (outward rounding) เป็นครึ่งชั่วโมง (I3)
  const startZ = Temporal.Instant.fromEpochMilliseconds(start.epochMs).toZonedDateTimeISO(ctx.defaultTz);
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
  const ctx = {
    nowMs: options.nowMs,
    defaultTz,
    today,
    maxAheadDate,
    maxBackdateDays,
    maxSpanDays,
    maxTimedDays,
    titleMax,
  };

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

  let seenCalendar = false;
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
          const outcome = processRawEvent(current, ctx);
          if (outcome.status === 'ok') items.push(outcome.item);
          else skipped[outcome.reason]++;
          inEvent = false;
          current = null;
        }
      } else if (inCalendar) {
        if (nestedDepth > 0) {
          nestedDepth--;
        } else if (comp === 'VCALENDAR') {
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
          current.rrule = entry;
          break;
      }
    }
  }

  if (!seenCalendar) return { ok: false, error: 'INVALID', reason: 'NOT_ICS' };

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
