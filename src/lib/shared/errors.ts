// ErrorCode union เดียวของทั้งระบบ — ARCHITECTURE §6 · ADR 0008 §3
// UI แปลด้วย t('errors.' + code, params) — API ไม่ส่งข้อความภาษาคน
// เพิ่มรหัสใหม่ = เพิ่มใน ERROR_CODES + ERROR_HTTP_STATUS (compiler บังคับ) + คีย์ errors.<CODE> ใน messages/*.json (เทสต์ R0-9)

export const ERROR_CODES = [
  // ทั่วไป
  'VALIDATION',
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'RATE_LIMITED',
  'FEATURE_DISABLED',
  'UNKNOWN',
  // auth
  'AUTH_MAINTENANCE',
  'AUTH_REQUIRED',
  'ACCOUNT_SUSPENDED',
  'PIN_CHANGE_REQUIRED',
  'INVALID_CREDENTIALS',
  'LOGIN_LOCKED',
  'USERNAME_TAKEN',
  'USERNAME_FORMAT',
  'PIN_FORMAT',
  'PIN_MISMATCH',
  'PIN_TOO_WEAK',
  'CSRF_REJECTED',
  // กลุ่ม/คำเชิญ
  'ADMIN_TRANSFER_REQUIRED',
  'INVITE_INVALID',
  'ALREADY_MEMBER',
  'USER_NOT_FOUND',
  'LIMIT_REACHED',
  // เวลา
  'INVALID_RANGE',
  'INVALID_DATE',
  'INVALID_LOCAL_TIME',
  'TIME_NOT_ON_STEP',
  'DATE_OUT_OF_RANGE',
  'RANGE_TOO_LARGE',
  'INVALID_TIMEZONE',
  'INVALID_WINDOW',
  // นัด
  'INVALID_MAP_URL',
  'INVALID_COORDINATES',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_PAST',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * ErrorCode → HTTP status
 * ค่าที่ ARCHITECTURE §2 กำหนดตรงตัว: AUTH_REQUIRED/ACCOUNT_SUSPENDED 401 · PIN_CHANGE_REQUIRED/FORBIDDEN 403 ·
 * NOT_FOUND 404 · ADMIN_TRANSFER_REQUIRED/CONFLICT 409 · RATE_LIMITED/LOGIN_LOCKED 429 · AUTH_MAINTENANCE 503 (§6)
 * ที่เหลือ Platform เลือกตามความหมาย HTTP (บันทึกใน Handoff R0)
 */
export const ERROR_HTTP_STATUS = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  FEATURE_DISABLED: 503,
  UNKNOWN: 500,

  AUTH_MAINTENANCE: 503,
  AUTH_REQUIRED: 401,
  ACCOUNT_SUSPENDED: 401,
  PIN_CHANGE_REQUIRED: 403,
  INVALID_CREDENTIALS: 401,
  LOGIN_LOCKED: 429,
  USERNAME_TAKEN: 409,
  USERNAME_FORMAT: 400,
  PIN_FORMAT: 400,
  PIN_MISMATCH: 400,
  PIN_TOO_WEAK: 400,
  CSRF_REJECTED: 403,

  ADMIN_TRANSFER_REQUIRED: 409,
  INVITE_INVALID: 400,
  ALREADY_MEMBER: 409, // ปกติใช้เป็นธงในผลสำเร็จ (ARCHITECTURE §6) — status นี้ใช้เฉพาะถ้ามีใครโยนเป็น error
  USER_NOT_FOUND: 404,
  LIMIT_REACHED: 409, // R2: เพดานกลุ่มต่อผู้ใช้ (10) / สมาชิกต่อกลุ่ม (50) / โค้ดเชิญที่ใช้ได้พร้อมกัน (20) — params: { limit: 'groups' | 'members' | 'codes' | 'appointments' | 'appointmentsPerDay' | 'appointmentSpan' ..., max }

  INVALID_RANGE: 400,
  INVALID_DATE: 400,
  INVALID_LOCAL_TIME: 400,
  TIME_NOT_ON_STEP: 400,
  DATE_OUT_OF_RANGE: 400,
  RANGE_TOO_LARGE: 400,
  INVALID_TIMEZONE: 400,
  INVALID_WINDOW: 400,

  INVALID_MAP_URL: 400,
  INVALID_COORDINATES: 400,
  APPOINTMENT_CANCELLED: 409, // แก้/ตอบนัดที่ยกเลิกแล้ว
  APPOINTMENT_PAST: 409, // ตอบ (RSVP) นัดที่จบไปแล้ว
} as const satisfies Record<ErrorCode, number>;

export function httpStatusOf(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** ค่าที่ใส่ใน params ได้ — ต้องเป็น JSON ล้วน และห้ามมีความลับ (PIN/token/hash/โค้ดเชิญ) */
export type ErrorParams = Readonly<Record<string, unknown>>;

/**
 * error ที่ตั้งใจส่งถึงผู้ใช้ — route wrapper แปลงเป็น `{error:{code, params}}` + status ตาม ERROR_HTTP_STATUS
 * `retryAfterSec` → header `Retry-After` (RATE_LIMITED / LOGIN_LOCKED — ARCHITECTURE §2)
 * ไม่มี message ภาษาคน: Error.message = code เท่านั้น (กันข้อความรั่วไปที่ log/response)
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly params: ErrorParams | undefined;
  readonly status: number;
  readonly retryAfterSec: number | undefined;

  constructor(code: ErrorCode, params?: ErrorParams, options?: { retryAfterSec?: number; status?: number }) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.params = params;
    this.status = options?.status ?? httpStatusOf(code);
    this.retryAfterSec = options?.retryAfterSec;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** รูปแบบ body ของ error ตาม ADR 0008 §3 */
export type ErrorBody = { error: { code: ErrorCode; params?: ErrorParams } };

export function errorBody(code: ErrorCode, params?: ErrorParams): ErrorBody {
  return params === undefined ? { error: { code } } : { error: { code, params } };
}
