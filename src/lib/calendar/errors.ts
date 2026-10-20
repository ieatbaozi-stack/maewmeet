// รหัสผิดพลาดของ lib เวลา — ADR 0004 §5 · R3_CONTRACT §2
// lib นี้ pure: ไม่ import DB/HTTP/env · ผู้เรียก (Platform) แปลงรหัสเป็น AppError/HTTP เอง

export const CALENDAR_ERROR_CODES = [
  'INVALID_RANGE', // end ≤ start (timed) / end < start (all-day) / ช่วงนาทีของ dayWindow ผิด
  'TIME_NOT_ON_STEP', // เวลาไม่ลงตัว 30 นาที
  'INVALID_DATE', // รูปแบบวันที่ผิด หรือวันที่ไม่มีจริง (เช่น 2025-02-29)
  'DATE_OUT_OF_RANGE', // ปีนอก 2000–2100 (กันการส่ง พ.ศ. มาผิด)
  'INVALID_LOCAL_TIME', // เวลาท้องถิ่นที่ไม่มีจริง (DST gap)
  'INVALID_TIME', // รูปแบบ HH:mm ผิด
  'INVALID_TZ', // ชื่อ IANA timezone ไม่ถูกต้อง
  'SPAN_TOO_LONG', // ช่วงยาวเกินเพดาน (เพดานส่งเป็นพารามิเตอร์)
  'TOO_FAR_BACK', // ลงย้อนหลังเกินเพดาน (เพดานส่งเป็นพารามิเตอร์)
  'INVALID_FORMAT', // format(): สไตล์ที่ต้องมีเวลา แต่ได้วันที่ล้วน
] as const;

export type CalendarErrorCode = (typeof CALENDAR_ERROR_CODES)[number];

export class CalendarError extends Error {
  readonly code: CalendarErrorCode;
  /** ชื่อฟิลด์ที่ผิด (ถ้าทราบ) เช่น 'startDate' — ใช้ชี้ช่องในฟอร์ม */
  readonly field: string | undefined;

  constructor(code: CalendarErrorCode, field?: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CalendarError';
    this.code = code;
    this.field = field;
  }
}

export function isCalendarError(e: unknown): e is CalendarError {
  return e instanceof CalendarError;
}

/** ห่อ RangeError ของ Temporal เป็นรหัสที่กำหนด */
export function failIf(cond: boolean, code: CalendarErrorCode, field?: string, detail?: string): void {
  if (cond) throw new CalendarError(code, field, detail);
}
