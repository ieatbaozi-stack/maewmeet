// token สุ่ม + SHA-256 — ADR 0002 §4 (session) · §5–6 (device token ของ reset)
// DB เก็บเฉพาะ SHA-256(token) — ไม่มีโค้ดใดเก็บ token ดิบ
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

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

// ───────── คุกกี้ผูกเครื่องของ reset (mm_reset) ─────────
// รูป `<token>.<issuedAtSec>.<mac>` · mac = HMAC-SHA256(subkey HKDF จาก APP_SECRET, "<token>.<issuedAtSec>") 32 hex
// เวลาออกคุกกี้อยู่ในคุกกี้เอง (เซ็นแล้ว ปลอมไม่ได้) → สถานะ "pending 7 วันแล้วปิด" คำนวณจากคุกกี้อย่างเดียวได้เหมือนกันทุกเครื่อง
// ไม่ว่ามี username นั้นจริงหรือไม่ (D2/S6) · รูปไม่มีจุด (`<token>` ล้วน) = รูปเดิม/สคริปต์ break-glass: ยอมรับ แต่ไม่มีเวลาออก
const deviceKeys = new Map<string, Buffer>();
function deviceSubkey(appSecretB64: string): Buffer {
  let key = deviceKeys.get(appSecretB64);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', Buffer.from(appSecretB64, 'base64'), Buffer.alloc(0), 'maewmeet/reset-device/v1', 32));
    deviceKeys.set(appSecretB64, key);
  }
  return key;
}
const deviceMac = (token: string, issuedAtSec: number, appSecretB64: string): string =>
  createHmac('sha256', deviceSubkey(appSecretB64)).update(`${token}.${issuedAtSec}`, 'utf8').digest('hex').slice(0, 32);

/** ค่าคุกกี้ที่เซ็นแล้ว (เวลาออก = issuedAtMs ปัดลงเป็นวินาที) */
export function signDeviceCookie(token: string, issuedAtMs: number, appSecretB64: string): string {
  const sec = Math.floor(issuedAtMs / 1000);
  return `${token}.${sec}.${deviceMac(token, sec, appSecretB64)}`;
}

export type ParsedDeviceCookie = { token: string; issuedAtMs: number | null };
const DEVICE_TOKEN_SHAPE = /^[a-z2-7]{20,64}$/;
const SIGNED_SHAPE = /^([a-z2-7]{20,64})\.(\d{1,12})\.([0-9a-f]{32})$/;

/** แยกคุกกี้ · MAC ผิด/รูปผิด = null · token ล้วน = issuedAtMs null */
export function parseDeviceCookie(value: string, appSecretB64: string): ParsedDeviceCookie | null {
  if (DEVICE_TOKEN_SHAPE.test(value)) return { token: value, issuedAtMs: null };
  const m = SIGNED_SHAPE.exec(value);
  if (!m) return null;
  const sec = Number(m[2]);
  if (!safeEqualHex(m[3]!, deviceMac(m[1]!, sec, appSecretB64))) return null;
  return { token: m[1]!, issuedAtMs: sec * 1000 };
}
