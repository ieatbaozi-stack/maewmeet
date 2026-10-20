// การแสดงผล — ADR 0004 §6: Intl เท่านั้น · ไทย = th-TH-u-ca-buddhist (พ.ศ.), อังกฤษ = en-GB · 24 ชม. · เลขอารบิก
import { Temporal } from 'temporal-polyfill';
import { CalendarError } from './errors';
import { assertTimeZone } from './zone';
import { toPlainDate } from './date';
import { DEFAULT_TZ, type DateISO, type EpochMs } from './constants';

export type CalendarLocale = 'th' | 'en';

/**
 * สไตล์การแสดง (ตัวอย่างเป็น 2026-10-15T03:30Z, Asia/Bangkok, th / en)
 * - datetime-full : วันพฤหัสบดีที่ 15 ตุลาคม พ.ศ. 2569 เวลา 10:30 / Thursday, 15 October 2026 at 10:30
 * - date-full     : วันพฤหัสบดีที่ 15 ตุลาคม พ.ศ. 2569 / Thursday, 15 October 2026
 * - date-long     : 15 ตุลาคม 2569 / 15 October 2026
 * - date-medium   : 15 ต.ค. 2569 / 15 Oct 2026
 * - date-short    : 15/10/2569 / 15/10/2026
 * - day-month     : 15 ต.ค. / 15 Oct
 * - month-year    : ตุลาคม พ.ศ. 2569 / October 2026
 * - weekday-short / weekday-long / month-long
 * - time          : 10:30 / 10:30   (เฉพาะ epoch ms)
 */
export type FormatStyle =
  | 'datetime-full'
  | 'date-full'
  | 'date-long'
  | 'date-medium'
  | 'date-short'
  | 'day-month'
  | 'month-year'
  | 'month-long'
  | 'weekday-short'
  | 'weekday-long'
  | 'time';

export interface FormatOptions {
  locale: CalendarLocale;
  style: FormatStyle;
  /** ใช้กับ epoch ms (ดีฟอลต์ Asia/Bangkok) · วันที่ล้วน ('YYYY-MM-DD') ไม่ผูก tz จึงไม่ใช้ */
  tz?: string;
}

const LOCALE_TAG: Record<CalendarLocale, string> = {
  th: 'th-TH-u-ca-buddhist-nu-latn',
  en: 'en-GB-u-nu-latn',
};

const OPTIONS: Record<FormatStyle, (l: CalendarLocale) => Intl.DateTimeFormatOptions> = {
  'datetime-full': () => ({ dateStyle: 'full', timeStyle: 'short' }),
  'date-full': () => ({ dateStyle: 'full' }),
  'date-long': () => ({ dateStyle: 'long' }),
  'date-medium': () => ({ dateStyle: 'medium' }),
  'date-short': () => ({ day: '2-digit', month: '2-digit', year: 'numeric' }),
  'day-month': () => ({ day: 'numeric', month: 'short' }),
  // ไทยต้องขอ era เองจึงได้ "พ.ศ." นำปี · อังกฤษไม่ใส่ "AD"
  'month-year': (l) => (l === 'th' ? { month: 'long', year: 'numeric', era: 'short' } : { month: 'long', year: 'numeric' }),
  'month-long': () => ({ month: 'long' }),
  'weekday-short': () => ({ weekday: 'short' }),
  'weekday-long': () => ({ weekday: 'long' }),
  time: () => ({ hour: '2-digit', minute: '2-digit' }),
};

const TIME_STYLES: ReadonlySet<FormatStyle> = new Set(['datetime-full', 'time']);

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: CalendarLocale, style: FormatStyle, timeZone: string): Intl.DateTimeFormat {
  const key = `${locale}|${style}|${timeZone}`;
  let f = cache.get(key);
  if (!f) {
    // hourCycle h23 ทั้งสองภาษา — ไม่มี AM/PM (U14)
    f = new Intl.DateTimeFormat(LOCALE_TAG[locale], { ...OPTIONS[style](locale), hourCycle: 'h23', timeZone });
    cache.set(key, f);
  }
  return f;
}

/**
 * จัดรูปแบบ instant (epoch ms, ตาม tz) หรือวันที่ลอย ('YYYY-MM-DD', ไม่ผูก tz)
 * วันที่ล้วนใช้กับสไตล์ที่มีเวลาไม่ได้ → INVALID_FORMAT
 */
export function format(value: EpochMs | DateISO, opts: FormatOptions): string {
  if (typeof value === 'string') {
    if (TIME_STYLES.has(opts.style)) throw new CalendarError('INVALID_FORMAT', undefined, `${opts.style} needs an instant`);
    // เที่ยงวันของ UTC ปลอดภัยจากการเลื่อนวัน แล้วอ่านกลับด้วย UTC
    const ms = toPlainDate(value).toZonedDateTime({ timeZone: 'UTC', plainTime: Temporal.PlainTime.from('12:00') }).epochMilliseconds;
    return formatter(opts.locale, opts.style, 'UTC').format(ms);
  }
  const tz = opts.tz ?? DEFAULT_TZ;
  assertTimeZone(tz);
  if (!Number.isFinite(value)) throw new CalendarError('INVALID_RANGE', undefined, 'epochMs must be finite');
  return formatter(opts.locale, opts.style, tz).format(value);
}

/** ชื่อวัน 7 ช่อง เรียงจากจันทร์ (WEEK_START) — ใช้ทำหัวตาราง · th narrow = จ อ พ พฤ ศ ส อา, en short = Mon … Sun */
export function weekdayLabels(locale: CalendarLocale, width: 'narrow' | 'short' | 'long' = 'short'): string[] {
  const f = new Intl.DateTimeFormat(LOCALE_TAG[locale], { weekday: width, timeZone: 'UTC' });
  // 2024-01-01 เป็นวันจันทร์
  return Array.from({ length: 7 }, (_, i) => f.format(Date.UTC(2024, 0, 1 + i, 12)));
}
