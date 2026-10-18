// lockout ต่อ username + rate limit ต่อ IP — ADR 0002 §3 (เก็บใน Turso ไม่มี Redis)
//  - login_throttle: key = 'u:' + username_normalized (พิมพ์มาอย่างไรก็ตาม ไม่ว่ามีบัญชีหรือไม่)
//  - rate_limit_bucket: fixed window · IP ถูก HMAC ด้วย subkey ของ APP_SECRET (HKDF) ก่อนเป็นคีย์ · IPv6 ใช้ /64
import { createHmac, hkdfSync } from 'node:crypto';
import type { DbOrTx } from '@/db/client';
import { getLoginThrottle, lockRemainingSec, recordLoginFailure, resetLoginThrottle } from '@/lib/data/repos/login-throttle';
import { hitBucket, peekBucket } from '@/lib/data/repos/rate-limit-bucket';
import { HOUR_MS, MINUTE_MS } from '@/lib/shared/clock';
import { AppError } from '@/lib/shared/errors';
import { callerId, clientIp } from './request';

/** ผิดติดกันถึงครั้งที่เท่านี้จึงเริ่มล็อก (1–4 ไม่ล็อก) */
export const LOCK_STARTS_AT_FAILURE = 5;
export const LOCK_MAX_MS = 24 * HOUR_MS;

/** ครั้งที่ f ≥ 5 ล็อก min(2^(f−5) นาที, 24 ชม.) = 1, 2, 4, … 1024 นาที แล้วคงที่ 24 ชม. · f < 5 → 0 */
export function lockMsFor(failures: number): number {
  if (!Number.isFinite(failures) || failures < LOCK_STARTS_AT_FAILURE) return 0;
  const exp = Math.min(failures - LOCK_STARTS_AT_FAILURE, 20); // 2^20 นาที ≫ 24 ชม. — กัน overflow
  return Math.min(2 ** exp * MINUTE_MS, LOCK_MAX_MS);
}

export const usernameThrottleKey = (usernameNormalized: string): string => `u:${usernameNormalized}`;

export type RateSpec = { readonly prefix: string; readonly limit: number; readonly windowMs: number };

/** ตาราง ADR 0002 §3 */
export const RATE_LIMITS = {
  loginIp: { prefix: 'login:ip', limit: 20, windowMs: 15 * MINUTE_MS },
  signupIp: { prefix: 'signup:ip', limit: 5, windowMs: HOUR_MS },
  resetIp: { prefix: 'reset:ip', limit: 3, windowMs: HOUR_MS },
  resetUser: { prefix: 'reset:u', limit: 3, windowMs: 24 * HOUR_MS },
} as const satisfies Record<string, RateSpec>;

const subkeys = new Map<string, Buffer>();

/** subkey สำหรับ HMAC ของ IP — HKDF-SHA256 จาก APP_SECRET (แยกจากการใช้งานอื่นด้วย info) */
function ipSubkey(appSecretB64: string): Buffer {
  let key = subkeys.get(appSecretB64);
  if (!key) {
    key = Buffer.from(
      hkdfSync('sha256', Buffer.from(appSecretB64, 'base64'), Buffer.alloc(0), 'maewmeet/rate-limit-ip/v1', 32),
    );
    subkeys.set(appSecretB64, key);
  }
  return key;
}

/** HMAC ของผู้เรียก (IP/IPv6 /64) — ไม่เก็บ IP ดิบ */
export function ipHashOf(req: Request, appSecretB64: string): string {
  return createHmac('sha256', ipSubkey(appSecretB64)).update(callerId(clientIp(req)), 'utf8').digest('hex').slice(0, 32);
}

export const rateKey = (spec: RateSpec, id: string): string => `${spec.prefix}:${id}`;

const limited = (windowEnd: number, now: number): AppError =>
  new AppError('RATE_LIMITED', undefined, { retryAfterSec: Math.max(1, Math.ceil((windowEnd - now) / 1000)) });

/** นับ 1 ครั้งแล้วคืนว่าเกินหรือไม่ (ครั้งที่ limit+1 เป็นต้นไปเกิน) */
export async function hitRate(
  db: DbOrTx,
  spec: RateSpec,
  id: string,
  now: number,
): Promise<{ exceeded: boolean; retryAfterSec: number }> {
  const hit = await hitBucket(db, rateKey(spec, id), spec.windowMs, now);
  return { exceeded: hit.count > spec.limit, retryAfterSec: Math.max(1, Math.ceil((hit.windowEnd - now) / 1000)) };
}

/** นับแล้วโยน RATE_LIMITED ถ้าเกิน */
export async function hitRateOrThrow(db: DbOrTx, spec: RateSpec, id: string, now: number): Promise<void> {
  const r = await hitRate(db, spec, id, now);
  if (r.exceeded) throw new AppError('RATE_LIMITED', undefined, { retryAfterSec: r.retryAfterSec });
}

/** ตรวจโดยไม่นับ (login: นับเฉพาะครั้งที่ผิด) — เต็มแล้วโยน RATE_LIMITED */
export async function assertRateNotFull(db: DbOrTx, spec: RateSpec, id: string, now: number): Promise<void> {
  const p = await peekBucket(db, rateKey(spec, id), spec.windowMs, now);
  if (p.count >= spec.limit) throw limited(p.windowEnd, now);
}

export async function countRate(db: DbOrTx, spec: RateSpec, id: string, now: number): Promise<void> {
  await hitBucket(db, rateKey(spec, id), spec.windowMs, now);
}

// ───────── lockout ต่อ username ─────────

export const loginLocked = (retryAfterSec: number): AppError =>
  new AppError('LOGIN_LOCKED', { retryAfterSec }, { retryAfterSec });

/** ล็อกอยู่ไหม → โยน LOGIN_LOCKED (ไม่นับ ไม่ verify) */
export async function assertNotLocked(db: DbOrTx, key: string, now: number): Promise<void> {
  const sec = lockRemainingSec(await getLoginThrottle(db, key), now);
  if (sec > 0) throw loginLocked(sec);
}

/**
 * บันทึกผิด 1 ครั้งแล้วคืน error ที่ต้องตอบ: ครบเกณฑ์ล็อก → LOGIN_LOCKED(retryAfterSec) · ไม่งั้น INVALID_CREDENTIALS(attemptsRemaining)
 * (เรียกเฉพาะตอน "ไม่ได้ล็อกอยู่" — ระหว่างล็อกไม่นับเพิ่ม ตามข้อตัดสินของ Lead)
 */
export async function failureOutcome(db: DbOrTx, key: string, now: number): Promise<AppError> {
  const row = await recordLoginFailure(db, key, now, lockMsFor);
  const sec = lockRemainingSec(row, now);
  if (sec > 0) return loginLocked(sec);
  return new AppError('INVALID_CREDENTIALS', { attemptsRemaining: Math.max(0, LOCK_STARTS_AT_FAILURE - row.failures) });
}

export async function clearFailures(db: DbOrTx, key: string, now: number): Promise<void> {
  await resetLoginThrottle(db, key, now);
}
