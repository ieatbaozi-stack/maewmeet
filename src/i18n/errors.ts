// แปลง error ของ API `{error:{code, params}}` → คีย์ `errors.<CODE>` + ค่าที่ส่งเข้า t() (ADR 0008 §3)
// ใช้: const { key, values } = apiErrorMessage(json); t(key, values)  (t = useTranslations() ไม่มี namespace)
import { isErrorCode, type ErrorCode } from "@/lib/shared/errors";

export type MessageValues = Record<string, string | number>;

export interface ApiErrorMessage {
  code: ErrorCode;
  key: `errors.${ErrorCode}`;
  values: MessageValues;
}

/** LOGIN_LOCKED: API ส่งวินาที แต่ข้อความเป็นนาที — max(1, ceil(sec/60)) (Lead ตัดสิน · UX.md §4) */
export function retryAfterMinutes(retryAfterSec: unknown): number {
  const sec = typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec) ? retryAfterSec : 0;
  return Math.max(1, Math.ceil(sec / 60));
}

/** รับ body ใดๆ (JSON ที่ parse แล้ว หรือ undefined เมื่อ parse ไม่ได้) · รหัสที่ไม่รู้จัก → UNKNOWN */
export function apiErrorMessage(body: unknown): ApiErrorMessage {
  const err =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: { code?: unknown; params?: unknown } }).error
      : undefined;
  const code: ErrorCode = isErrorCode(err?.code) ? err.code : "UNKNOWN";
  const params =
    typeof err?.params === "object" && err.params !== null ? (err.params as Record<string, unknown>) : {};

  const values: MessageValues = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) values[name] = value;
  }
  if (code === "LOGIN_LOCKED") values.retryAfterMin = retryAfterMinutes(params.retryAfterSec);
  if (code === "INVALID_CREDENTIALS" && typeof values.attemptsRemaining !== "number") values.attemptsRemaining = 0;

  return { code, key: `errors.${code}`, values };
}
