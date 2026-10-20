// ค่าคงที่ที่เป็นนิยามของเวลา (ไม่ใช่เพดานธุรกิจ — เพดานธุรกิจอยู่ที่ src/lib/shared/limits.ts)

export const DEFAULT_TZ = 'Asia/Bangkok';
/** ปีที่รับได้ (ADR 0004 §6) */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;
/** ความละเอียดเวลา busy (นาที) */
export const STEP_MINUTES = 30;
/** busy แบบมีเวลายาวสุด (วัน) — ADR 0004 §2 */
export const TIMED_MAX_DAYS = 62;
export const MINUTES_PER_DAY = 1440;
/** ISO: 1 = จันทร์ (boss 2026-10-16) — ทั้งสองภาษา ไม่อ่านจาก locale */
export const WEEK_START = 1;

/** วันที่ท้องถิ่นแบบ ค.ศ. 'YYYY-MM-DD' */
export type DateISO = string;
/** epoch milliseconds UTC */
export type EpochMs = number;
