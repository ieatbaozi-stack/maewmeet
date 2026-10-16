// id และ token สุ่มที่ปลอดภัย — ใช้ CSPRNG ของ node:crypto เท่านั้น (ห้าม Math.random)
// id ของแถวทุกตาราง = UUIDv4 สร้างในแอป (ARCHITECTURE §3)
import { randomBytes, randomUUID } from 'node:crypto';

/** UUIDv4 สำหรับ primary key */
export function newId(): string {
  return randomUUID();
}

/** token สุ่ม base64url (ไม่มี padding) — ค่าเริ่มต้น 32 ไบต์ = 256 บิต (session/device token ฯลฯ) */
export function randomToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16) {
    throw new RangeError('randomToken: bytes must be an integer >= 16');
  }
  return randomBytes(bytes).toString('base64url');
}

/**
 * สตริงสุ่มจาก alphabet ที่กำหนด แบบไม่เอนเอียง (rejection sampling)
 * ใช้กับโค้ดเชิญ (ARCHITECTURE §5: alphabet 31 ตัว ตัด 0 O 1 I L) — รูปแบบ XXXX-XXXX ให้ service ประกอบเอง
 */
export function randomString(length: number, alphabet: string): string {
  if (!Number.isInteger(length) || length < 1) throw new RangeError('randomString: invalid length');
  if (alphabet.length < 2 || alphabet.length > 256) throw new RangeError('randomString: invalid alphabet');
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (const b of buf) {
      if (b < limit) {
        out += alphabet[b % alphabet.length];
        if (out.length === length) break;
      }
    }
  }
  return out;
}
