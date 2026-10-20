// src/lib/calendar — ไลบรารีเวลากลางของแมวเจอกัน (ADR 0004). ห่อ temporal-polyfill ที่เดียวในโปรเจกต์
// pure: ไม่แตะ DB/HTTP/env · ไม่อ่านนาฬิกา — ทุกฟังก์ชันที่ขึ้นกับ "ตอนนี้" รับ nowMs (หรือ now) จากผู้เรียก (clock.now())
export {
  DEFAULT_TZ,
  MAX_YEAR,
  MIN_YEAR,
  MINUTES_PER_DAY,
  STEP_MINUTES,
  TIMED_MAX_DAYS,
  WEEK_START,
  type DateISO,
  type EpochMs,
} from './constants';
export { CALENDAR_ERROR_CODES, CalendarError, isCalendarError, type CalendarErrorCode } from './errors';
export {
  addDays,
  addMonths,
  compareDates,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  eachDate,
  isValidDate,
  monthGrid,
  startOfWeek,
} from './date';
export {
  dayWindow,
  daysUntil,
  isValidTimeZone,
  parseLocalDateTime,
  startOfDay,
  toLocal,
  todayIn,
} from './zone';
export {
  normalizeBusyInput,
  type AllDayBusyInput,
  type BusyInput,
  type BusyInputError,
  type BusyLimitOptions,
  type BusyRow,
  type NormalizeBusyOptions,
  type NormalizeBusyResult,
  type TimedBusyInput,
} from './busy';
export { earliestAllowedDate, exceedsMaxSpan, isTooFarBack, spanDays } from './limits';
export { format, weekdayLabels, type CalendarLocale, type FormatOptions, type FormatStyle } from './format';
