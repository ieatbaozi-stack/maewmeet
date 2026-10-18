// โค้ดเชิญ — R2_CONTRACT §2 · ARCHITECTURE §5 (U5 ข)
//  - สุ่ม 8 ตัวจาก alphabet 31 ตัว (ตัด 0 O 1 I L) ด้วย CSPRNG + rejection sampling (randomString) = ~39.6 บิต · แสดงเป็น XXXX-XXXX
//  - DB เก็บเฉพาะ hash: HMAC-SHA256 ด้วย subkey ของ APP_SECRET (HKDF info 'maewmeet/invite-code/v1') — ไม่ใช่ SHA-256 ล้วน
//    เหตุผล: ปริภูมิโค้ด 31^8 ≈ 8.5×10^11 เล็กพอที่ SHA-256 ล้วนจะถูกไล่ย้อนนอกระบบได้ในไม่กี่นาทีด้วย GPU ถ้าฐานรั่ว ·
//    HMAC ที่มีกุญแจนอกฐานทำให้ผู้ที่ได้เฉพาะ dump ของ DB ไล่ย้อนไม่ได้ · ค่าใช้จ่าย: เปลี่ยน APP_SECRET = โค้ดที่ค้างใช้ไม่ได้
//    (อายุโค้ดแค่ 7 วัน และ OPERATIONS ถือ APP_SECRET เป็นค่าคงที่ — ผู้สร้างสร้างโค้ดใหม่ได้)
//  - code_hint = 4 ตัวท้าย (ไม่มีขีด) เห็นเฉพาะผู้ที่ invite.list ให้เห็นแถวนั้น (ผู้สร้าง/admin/mod/SA)
//  - normalize ก่อน hash: NFKC → ตัดช่องว่าง/ขีดทุกชนิด → ตัวพิมพ์ใหญ่ → ต้องตรงรูป 8 ตัวใน alphabet ไม่งั้น "ไม่ใช่โค้ด" (null)
import { createHmac, hkdfSync } from 'node:crypto';
import { randomString } from '@/lib/shared/id';

export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 ตัว: A–Z ตัด I L O + 2–9
export const INVITE_CODE_LENGTH = 8;
const SHAPE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** โค้ดใหม่ในรูปมาตรฐาน 8 ตัวติดกัน (ยังไม่ใส่ขีด) */
export function generateInviteCode(): string {
  return randomString(INVITE_CODE_LENGTH, INVITE_CODE_ALPHABET);
}

/** XXXX-XXXX สำหรับแสดง/แชร์ */
export function formatInviteCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/** ตัวอักษรที่นับเป็นช่องว่าง/ขีดคั่น: ช่องว่างทุกชนิด, ขีดทุกแบบ (ASCII - และ U+2010–2015, U+2212), ตัวขนาดศูนย์ */
const SEPARATORS = /[\s­​-‍⁠﻿\-‐-―−]+/gu;

/** รับสิ่งที่ผู้ใช้พิมพ์ → โค้ด 8 ตัวรูปมาตรฐาน หรือ null ถ้าไม่ใช่รูปโค้ด */
export function normalizeInviteCode(raw: string): string | null {
  const s = raw.normalize('NFKC').replace(SEPARATORS, '').toUpperCase();
  return SHAPE.test(s) ? s : null;
}

export const inviteCodeHint = (normalized: string): string => normalized.slice(-4);

const subkeys = new Map<string, Buffer>();
function subkey(appSecretB64: string): Buffer {
  let k = subkeys.get(appSecretB64);
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', Buffer.from(appSecretB64, 'base64'), Buffer.alloc(0), 'maewmeet/invite-code/v1', 32));
    subkeys.set(appSecretB64, k);
  }
  return k;
}

/** hash ที่เก็บใน group_invite.code_hash (hex 64 ตัว) — รับโค้ดที่ normalize แล้วเท่านั้น */
export function hashInviteCode(normalized: string, appSecretB64: string): string {
  return createHmac('sha256', subkey(appSecretB64)).update(normalized, 'utf8').digest('hex');
}
