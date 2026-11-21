// token ของลิงก์ชวนนัด — R18 §S1 · ADR 0016 §3 (คู่กับ invite-code.ts)
//  - token ได้มาจาก id ของลิงก์แบบ deterministic (ไม่สุ่มแล้วเก็บ) เพื่อให้ "กดซ้ำได้ลิงก์เดิม" โดยไม่เก็บ token ดิบ:
//      token = base64url( HMAC-SHA256(K_tok, "share-link:" + id)[0..16) ) → 22 ตัว [A-Za-z0-9_-] = 128 บิต
//      K_tok = HKDF-SHA256(APP_SECRET, salt ว่าง, 'maewmeet/appointment-share-token/v1', 32)
//  - DB เก็บ token_hash = hex( HMAC-SHA256(K_hash, token) ) · K_hash = HKDF(APP_SECRET, 'maewmeet/appointment-share-hash/v1')
//  - ผู้ได้ dump ฐานอย่างเดียว (ไม่มี APP_SECRET) สร้าง token จาก id หรือย้อนจาก hash ไม่ได้ · เปลี่ยน APP_SECRET = ลิงก์ทั้งหมดใช้ไม่ได้
//  - ห้าม log / ใส่ token ใน audit / notification / error (ADR 0016 §3)
import { createHmac, hkdfSync } from 'node:crypto';

export const SHARE_TOKEN_LENGTH = 22;
const SHAPE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_INFO = 'maewmeet/appointment-share-token/v1';
const HASH_INFO = 'maewmeet/appointment-share-hash/v1';

const subkeys = new Map<string, Buffer>();
function subkey(appSecretB64: string, info: string): Buffer {
  const cacheKey = `${info}\u0000${appSecretB64}`;
  let k = subkeys.get(cacheKey);
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', Buffer.from(appSecretB64, 'base64'), Buffer.alloc(0), info, 32));
    subkeys.set(cacheKey, k);
  }
  return k;
}

/** token ของลิงก์ (สร้างซ้ำได้ทุกครั้งจาก id เดิม) */
export function shareTokenFor(linkId: string, appSecretB64: string): string {
  return createHmac('sha256', subkey(appSecretB64, TOKEN_INFO)).update(`share-link:${linkId}`, 'utf8').digest().subarray(0, 16).toString('base64url');
}

/** hash ที่เก็บใน appointment_share_link.token_hash (hex 64 ตัว) — รับ token ที่ผ่าน parseShareToken แล้วเท่านั้น */
export function hashShareToken(token: string, appSecretB64: string): string {
  return createHmac('sha256', subkey(appSecretB64, HASH_INFO)).update(token, 'utf8').digest('hex');
}

/** ตรงรูป 22 ตัว [A-Za-z0-9_-] → token · อื่น ๆ → null (ตัดสินก่อนแตะฐาน) */
export function parseShareToken(raw: unknown): string | null {
  return typeof raw === 'string' && SHAPE.test(raw) ? raw : null;
}

/** ลิงก์เต็มของหน้าเปิดลิงก์ `/i/<token>` */
export function shareUrlFor(appOrigin: string, token: string): string {
  return `${appOrigin.replace(/\/+$/, '')}/i/${token}`;
}
