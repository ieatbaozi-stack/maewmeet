// token สุ่ม + SHA-256 — ADR 0002 §4 (session) · §5–6 (device token ของ reset)
// DB เก็บเฉพาะ SHA-256(token) — ไม่มีโค้ดใดเก็บ token ดิบ
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** base32 (RFC 4648 ตัวพิมพ์เล็ก ไม่มี padding) — 20 ไบต์ = 32 ตัวอักษร */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export const SESSION_TOKEN_BYTES = 20;
export const DEVICE_TOKEN_BYTES = 32;

/** token ของ session cookie: สุ่ม 20 ไบต์ (160 บิต) เป็น base32 */
export function newSessionToken(): string {
  return base32(randomBytes(SESSION_TOKEN_BYTES));
}

/** token ผูกเครื่องของคำขอ reset: สุ่ม 32 ไบต์ เป็น base32 */
export function newDeviceToken(): string {
  return base32(randomBytes(DEVICE_TOKEN_BYTES));
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** เทียบ hex สองค่าแบบ constant-time (ยาวไม่เท่า = false โดยไม่รั่วตำแหน่งที่ต่าง) */
export function safeEqualHex(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
