// lockout ต่อ username + rate limit ต่อ IP — ADR 0002 §3 (เก็บใน Turso ไม่มี Redis)
//  - login_throttle: key = 'u:' + username_normalized (พิมพ์มาอย่างไรก็ตาม ไม่ว่ามีบัญชีหรือไม่)
//  - rate_limit_bucket: fixed window · IP ถูก HMAC ด้วย subkey ของ APP_SECRET (HKDF) ก่อนเป็นคีย์ · IPv6 ใช้ /64
import { createHmac, hkdfSync } from 'node:crypto';
import type { DbOrTx } from '@/db/client';
import { lockRemainingSec, reserveLoginAttempt, resetLoginThrottle, type LoginThrottleRow } from '@/lib/data/repos/login-throttle';
import { hitBucket, refundBucket, reserveBucket } from '@/lib/data/repos/rate-limit-bucket';
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

/**
 * ผู้เรียกที่ระบุ IP ไม่ได้ (ไม่เชื่อ header — ดู clientIp) ทุกคนใช้ถัง 'unknown' ร่วมกัน → เพดานคูณด้วยค่านี้ เพื่อไม่ให้ทั้งระบบล็อกกันเอง
 * (dev/e2e/self-host ตรง ๆ) · ยังเป็นเพดานจริง: ผู้โจมตีถูกจำกัดรวมที่ limit × factor ต่อหน้าต่าง · ชั้นที่กัน brute-force จริงคือ lockout ต่อ username
 */
export const UNKNOWN_CALLER_LIMIT_FACTOR = 50;

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

/** spec ที่ปรับเพดานตามผู้เรียก: ระบุ IP ไม่ได้ → ถังร่วม 'unknown' เพดานสูงขึ้น (UNKNOWN_CALLER_LIMIT_FACTOR) */
export function ipRateSpec(spec: RateSpec, req: Request): RateSpec {
  return callerId(clientIp(req)) === 'unknown' ? { ...spec, limit: spec.limit * UNKNOWN_CALLER_LIMIT_FACTOR } : spec;
}

/** นับ 1 ครั้งแล้วคืนว่าเกินหรือไม่ (ครั้งที่ limit+1 เป็นต้นไปเกิน) — signup/reset (นับทุกครั้ง) */
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

// ───────── จองความพยายามล็อกอินแบบอะตอมมิก (S1) ─────────
// ไม่มี check-then-act: ทั้ง IP และ username "จอง" ก่อน verify ด้วย UPSERT เดียวที่ตัดสินในคำสั่งเดียวกัน
// ถูกปฏิเสธ (เต็ม/ล็อก) → ไม่ verify · verify ได้สูงสุดเท่าจำนวนช่องที่จองได้ ไม่ว่าจะมีคำขอขนานกี่ตัว

export const loginLocked = (retryAfterSec: number): AppError =>
  new AppError('LOGIN_LOCKED', { retryAfterSec }, { retryAfterSec });

export type LoginAttempt = {
  readonly db: DbOrTx;
  readonly now: number;
  readonly ipSpec: RateSpec;
  readonly ipId: string;
  readonly userKey: string;
  /** แถว login_throttle หลังจองครั้งนี้ · null = ไม่ได้จอง username (เส้นทาง reset-device ที่ข้ามล็อก) */
  readonly row: LoginThrottleRow | null;
};

/** ขั้น 1: จองช่อง IP — เต็ม → RATE_LIMITED (ยังไม่ verify · ไม่แตะ username) */
export async function reserveIpSlot(db: DbOrTx, req: Request, appSecret: string, userKey: string, now: number): Promise<LoginAttempt> {
  const ipSpec = ipRateSpec(RATE_LIMITS.loginIp, req);
  const ipId = ipHashOf(req, appSecret);
  const slot = await reserveBucket(db, rateKey(ipSpec, ipId), ipSpec.windowMs, ipSpec.limit, now);
  if (!slot.admitted) throw limited(slot.windowEnd, now);
  return { db, now, ipSpec, ipId, userKey, row: null };
}

/** คืนช่อง IP ที่จองไว้ (ผู้เรียกที่ไม่ verify / ล้มก่อนตัดสิน) */
export async function releaseIpSlot(a: LoginAttempt): Promise<void> {
  await refundBucket(a.db, rateKey(a.ipSpec, a.ipId), a.ipSpec.windowMs, a.now);
}

/**
 * ขั้น 2: จอง username — ล็อกอยู่ → คืนช่อง IP แล้วโยน LOGIN_LOCKED (ระหว่างล็อกไม่นับทั้งสองถัง ไม่ verify)
 * ผ่าน → คืน attempt ที่มีแถวหลังนับ (ครั้งนี้ถูกนับเป็น "ผิด" ไว้ก่อนแล้ว จนกว่าจะสำเร็จ → succeededAttempt)
 */
export async function reserveUsernameSlot(a: LoginAttempt): Promise<LoginAttempt> {
  let r;
  try {
    r = await reserveLoginAttempt(a.db, a.userKey, a.now, lockMsFor);
  } catch (e) {
    await releaseIpSlot(a).catch(() => undefined);
    throw e;
  }
  if (!r.admitted) {
    await releaseIpSlot(a);
    throw loginLocked(Math.max(1, Math.ceil((r.lockedUntil - a.now) / 1000)));
  }
  return { ...a, row: r.row };
}

/** ผิด: ตอบจากแถวที่จองไว้ (ครบเกณฑ์ → LOGIN_LOCKED · ไม่งั้น INVALID_CREDENTIALS + attemptsRemaining) — ไม่เขียนเพิ่ม (ถูกนับตอนจองแล้ว) */
export async function failedAttempt(a: LoginAttempt): Promise<AppError> {
  let row = a.row;
  if (!row) {
    // เส้นทาง reset ที่ยึดสิทธิ์ไม่สำเร็จ (แพ้การแข่ง) → นับเป็นความผิดตอนนี้
    const r = await reserveLoginAttempt(a.db, a.userKey, a.now, lockMsFor);
    if (!r.admitted) return loginLocked(Math.max(1, Math.ceil((r.lockedUntil - a.now) / 1000)));
    row = r.row;
  }
  const sec = lockRemainingSec(row, a.now);
  if (sec > 0) return loginLocked(sec);
  return new AppError('INVALID_CREDENTIALS', { attemptsRemaining: Math.max(0, LOCK_STARTS_AT_FAILURE - row.failures) });
}

/** สำเร็จ: คืนช่อง IP ที่จองไว้ (นับเฉพาะครั้งที่ผิด) + ล้างตัวนับ/ล็อกของ username */
export async function succeededAttempt(a: LoginAttempt, exec: DbOrTx = a.db): Promise<void> {
  await refundBucket(exec, rateKey(a.ipSpec, a.ipId), a.ipSpec.windowMs, a.now);
  await resetLoginThrottle(exec, a.userKey, a.now);
}
