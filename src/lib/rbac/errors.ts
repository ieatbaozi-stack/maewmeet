import { AppError } from '@/lib/shared/errors';
import type { Action } from './actions';
import type { PolicyErrorCode, PolicyStatus } from './types';

/** HTTP status ต่อรหัส — ARCHITECTURE §2 (PolicyError → HTTP) · เทสต์ยืนยันว่าตรงกับ ERROR_HTTP_STATUS ของ Platform */
export const POLICY_STATUS = {
  AUTH_REQUIRED: 401,
  ACCOUNT_SUSPENDED: 401,
  PIN_CHANGE_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ADMIN_TRANSFER_REQUIRED: 409,
} as const satisfies Record<PolicyErrorCode, PolicyStatus>;

/**
 * ถูก throw โดย `authorize()` เมื่อ `can()` ปฏิเสธ
 * extends `AppError` (src/lib/shared/errors.ts) → route wrapper แปลงเป็น `{error:{code}}` + status ได้ทันที
 * message = code (ตามกติกา AppError: ไม่มีข้อความภาษาคน/ข้อมูลลับ) · `action` ไว้ให้ log ฝั่งเซิร์ฟเวอร์
 */
export class PolicyError extends AppError {
  declare readonly code: PolicyErrorCode;
  declare readonly status: PolicyStatus;
  readonly action: Action;

  constructor(code: PolicyErrorCode, action: Action) {
    super(code, undefined, { status: POLICY_STATUS[code] });
    this.name = 'PolicyError';
    this.action = action;
  }
}

export const isPolicyError = (e: unknown): e is PolicyError => e instanceof PolicyError;

/**
 * service ส่ง resource ผิดชนิดให้ action (บั๊กของโปรแกรม ไม่ใช่การปฏิเสธสิทธิ์) — fail closed ด้วยการ throw
 * ไม่ใช่ AppError → route wrapper ตอบ 500 `UNKNOWN`
 */
export class RbacMisuseError extends Error {
  constructor(action: Action, resourceType: string) {
    super(`rbac misuse: action ${action} does not accept resource type "${resourceType}"`);
    this.name = 'RbacMisuseError';
  }
}
