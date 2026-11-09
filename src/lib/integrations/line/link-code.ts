// โค้ดเชื่อม LINE — R10 §2 · ADR 0011 §1: สุ่ม CSPRNG 8 ตัว (alphabet เดียวกับโค้ดเชิญ ~39.6 บิต) รูป MM-XXXX-XXXX ให้ต่างจากข้อความแชททั่วไป
// DB เก็บเฉพาะ HMAC-SHA256 ด้วย subkey ของ APP_SECRET (เหตุผลเดียวกับ invite-code.ts: ปริภูมิเล็ก ไล่ย้อนจาก dump ไม่ได้ถ้าไม่มีกุญแจ)
import { createHmac, hkdfSync } from 'node:crypto';
import { INVITE_CODE_ALPHABET } from '@/lib/data/invite-code';
import { randomString } from '@/lib/shared/id';

const SHAPE = new RegExp(`^MM-[${INVITE_CODE_ALPHABET}]{4}-[${INVITE_CODE_ALPHABET}]{4}$`);
const MAX_INPUT = 40;

export function generateLineLinkCode(): string {
  const r = randomString(8, INVITE_CODE_ALPHABET);
  return `MM-${r.slice(0, 4)}-${r.slice(4)}`;
}

/** ข้อความในแชท → โค้ดรูปมาตรฐาน หรือ null ถ้าไม่ใช่รูปโค้ด (webhook เงียบ) */
export function normalizeLineLinkCode(raw: string): string | null {
  if (raw.length > MAX_INPUT) return null;
  const s = raw.normalize('NFKC').trim().replace(/[‐-―−]/g, '-').toUpperCase();
  return SHAPE.test(s) ? s : null;
}

const subkeys = new Map<string, Buffer>();
function subkey(appSecretB64: string, info: string): Buffer {
  const id = `${info}|${appSecretB64}`;
  let k = subkeys.get(id);
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', Buffer.from(appSecretB64, 'base64'), Buffer.alloc(0), info, 32));
    subkeys.set(id, k);
  }
  return k;
}

export function hashLineLinkCode(normalized: string, appSecretB64: string): string {
  return createHmac('sha256', subkey(appSecretB64, 'maewmeet/line-link-code/v1')).update(normalized, 'utf8').digest('hex');
}

/** คีย์ rate limit ของบัญชี LINE — ไม่เก็บ LINE user id ดิบใน rate_limit_bucket */
export function lineUserRateId(lineUserId: string, appSecretB64: string): string {
  return createHmac('sha256', subkey(appSecretB64, 'maewmeet/line-rate-id/v1')).update(lineUserId, 'utf8').digest('hex');
}
