// ตัวช่วยของ service หน้า admin / บัญชี (R5) — แปลง input ที่ผ่าน zod (รูปร่าง) เป็นค่าที่ใช้ query ได้ + limiter ต่อผู้ใช้
// ไม่แตะสิทธิ์: ผู้เรียก (service) authorize ก่อนเสมอ
import { z } from 'zod';
import type { Db } from '@/db/client';
import { reserveBucket } from '@/lib/data/repos/rate-limit-bucket';
import { escapeLike, type KeysetCursor } from '@/lib/data/repos/admin-users';
import { rateKey, type RateSpec } from '@/lib/auth/throttle';
import { AppError } from '@/lib/shared/errors';
import { ADMIN_QUERY_MAX } from '@/lib/shared/limits';
import { hasForbiddenChars } from '@/lib/shared/name-rules';
import { serialized } from './tx';

/** cursor = base64url(JSON {c: createdAt, i: id}) — รูปผิด/ค่าเพี้ยน → VALIDATION (ไม่เดา ไม่ข้ามไปหน้าแรก) */
export function encodeKeysetCursor(c: KeysetCursor): string {
  return Buffer.from(JSON.stringify({ c: c.createdAt, i: c.id }), 'utf8').toString('base64url');
}

export function decodeKeysetCursor(raw: string | undefined, field = 'cursor'): KeysetCursor | null {
  if (raw === undefined || raw === '') return null;
  let v: { c?: unknown; i?: unknown } | null = null;
  try {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(raw)) throw new Error('shape');
    v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { c?: unknown; i?: unknown } | null;
  } catch {
    v = null;
  }
  if (!v || typeof v !== 'object' || !Number.isSafeInteger(v.c) || (v.c as number) < 0 || typeof v.i !== 'string' || !z.uuid().safeParse(v.i).success) {
    throw new AppError('VALIDATION', { fields: { [field]: 'INVALID' } });
  }
  return { createdAt: v.c as number, id: v.i };
}

/** หน้าถัดไป: ขอมา limit+1 แถว → ตัดเหลือ limit แล้วสร้าง cursor จากแถวสุดท้าย */
export function page<T extends { createdAt: number; id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeKeysetCursor({ createdAt: last.createdAt, id: last.id }) : null };
}

export type SearchTerm = {
  /** สำหรับ username_normalized LIKE x% (NFKC + lowercase แล้ว escape) */
  usernamePrefix: string;
  /** สำหรับ display_name / ชื่อกลุ่ม LIKE %x% (NFC แล้ว escape) */
  contains: string;
};

/**
 * คำค้น q ของหน้า admin: ว่าง = ไม่กรอง · > ADMIN_QUERY_MAX ตัว (code point) → VALIDATION TOO_LONG ·
 * มีตัวควบคุม/bidi/zero-width → VALIDATION INVALID · `%` `_` `\` ถูก escape (ค้นตามตัวอักษร ไม่ใช่ wildcard)
 */
export function parseSearchTerm(raw: string | undefined): SearchTerm | null {
  if (raw === undefined) return null;
  const nfc = raw.normalize('NFC').trim();
  if (nfc === '') return null;
  if ([...nfc].length > ADMIN_QUERY_MAX || [...raw.normalize('NFKC').trim()].length > ADMIN_QUERY_MAX) {
    throw new AppError('VALIDATION', { fields: { q: 'TOO_LONG' } });
  }
  if (hasForbiddenChars(nfc)) throw new AppError('VALIDATION', { fields: { q: 'INVALID' } });
  return { usernamePrefix: escapeLike(raw.normalize('NFKC').trim().toLowerCase()), contains: escapeLike(nfc) };
}

/** จองช่อง limiter ต่อผู้ใช้ 1 ครั้ง (UPSERT อะตอมมิก) · เต็ม → RATE_LIMITED + Retry-After */
export async function takeUserSlot(db: Db, spec: RateSpec, userId: string, now: number): Promise<void> {
  const slot = await serialized(db, () => reserveBucket(db, rateKey(spec, userId), spec.windowMs, spec.limit, now));
  if (!slot.admitted) throw new AppError('RATE_LIMITED', undefined, { retryAfterSec: Math.max(1, Math.ceil((slot.windowEnd - now) / 1000)) });
}
