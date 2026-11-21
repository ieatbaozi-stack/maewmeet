// จองช่อง rate limit หลายถังแบบอะตอมมิกต่อถัง (rate_limit_bucket) — R18 §S (ADR 0016 §6 · H2)
//  1. precheckRates (อ่านอย่างเดียว ไม่เข้าคิว) — ถังใดเต็มอยู่แล้ว → 429 ทันทีโดยไม่ต่อคิว serialized
//  2. จองทีละถังตามลำดับ (UPSERT มีเพดาน) — ถังใดเต็ม → คืนถังที่จองไปแล้ว แล้ว RATE_LIMITED + Retry-After
//  คืนฟังก์ชันคืนช่องทั้งหมด (ใช้เมื่อคำขอไม่ควรนับ เช่น join สำเร็จ / เป็นสมาชิกอยู่แล้ว / เต็ม)
// ไม่แตะสิทธิ์: ผู้เรียก (service) authorize ก่อนเสมอ
import type { Db } from '@/db/client';
import { precheckRates, type RateCheck } from '@/lib/auth/throttle';
import { refundBucket, reserveBucket } from '@/lib/data/repos/rate-limit-bucket';
import { AppError } from '@/lib/shared/errors';
import { serialized } from './tx';

const limited = (windowEnd: number, now: number): AppError =>
  new AppError('RATE_LIMITED', undefined, { retryAfterSec: Math.max(1, Math.ceil((windowEnd - now) / 1000)) });

export async function takeSlots(db: Db, slots: readonly RateCheck[], now: number): Promise<() => Promise<void>> {
  await precheckRates(db, slots, now);
  const taken: RateCheck[] = [];
  const refund = (list: readonly RateCheck[]) =>
    serialized(db, async () => {
      for (const t of list) await refundBucket(db, t.key, t.spec.windowMs, now);
    });
  for (const slot of slots) {
    const r = await serialized(db, () => reserveBucket(db, slot.key, slot.spec.windowMs, slot.spec.limit, now));
    if (!r.admitted) {
      if (taken.length > 0) await refund(taken);
      throw limited(r.windowEnd, now);
    }
    taken.push(slot);
  }
  return () => refund(taken);
}
