// repo: place_search_cache + ตัวกั้นอัตรากลางของ proxy Nominatim (ADR 0001) — query ล้วน
//  - cache: คีย์ = query ที่ normalize แล้ว (+ภาษา) · เก็บ 30 วัน (cron ลบ) · ผลที่เก็บผ่านการ sanitize แล้วเท่านั้น (service)
//  - throttle: ช่องห่างขั้นต่ำระหว่างการเรียก Nominatim ทั้งระบบ (1 req/s) ด้วย UPSERT เดียวมีเงื่อนไข (ไม่มี read-then-write) ใช้แถวใน rate_limit_bucket
//    (window_start = เวลาที่เรียกครั้งล่าสุด) — ไม่ใช่ fixed window จึงไม่มีช่วงขอบที่ยิงติดกัน 2 ครั้งภายในไม่กี่ ms
import { eq, sql } from 'drizzle-orm';
import { placeSearchCache, rateLimitBucket } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export type PlaceResult = { name: string; lat: number; lng: number; osmUrl: string };

/** ผลในแคชที่ยังไม่หมดอายุ (fetched_at > now − ttl) · ไม่มี/หมดอายุ = null */
export async function findFreshPlaceCache(db: DbOrTx, key: string, now: number, ttlMs: number): Promise<unknown | null> {
  const rows = await db
    .select({ results: placeSearchCache.results, fetchedAt: placeSearchCache.fetchedAt })
    .from(placeSearchCache)
    .where(eq(placeSearchCache.queryNormalized, key))
    .limit(1);
  const r = rows[0];
  return r && r.fetchedAt > now - ttlMs ? r.results : null;
}

export async function putPlaceCache(db: DbOrTx, key: string, results: readonly PlaceResult[], now: number): Promise<void> {
  await db
    .insert(placeSearchCache)
    .values({ queryNormalized: key, results: [...results], fetchedAt: now })
    .onConflictDoUpdate({ target: placeSearchCache.queryNormalized, set: { results: [...results], fetchedAt: now } });
}

/**
 * จองสิทธิ์เรียกต้นทาง 1 ครั้ง: สำเร็จเมื่อไม่มีการเรียกภายใน `gapMs` ก่อนหน้า (นับจากเวลาที่บันทึกไว้) — คำสั่งเดียวอะตอมมิก
 * คืน { admitted, retryAfterMs }
 */
export async function reserveCallSlot(db: DbOrTx, key: string, gapMs: number, now: number): Promise<{ admitted: boolean; retryAfterMs: number }> {
  const rows = await db
    .insert(rateLimitBucket)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitBucket.key,
      set: { windowStart: sql`excluded.window_start`, count: sql`1` },
      setWhere: sql`${rateLimitBucket.windowStart} <= excluded.window_start - ${gapMs}`,
    })
    .returning({ windowStart: rateLimitBucket.windowStart });
  if (rows.length > 0) return { admitted: true, retryAfterMs: 0 };
  const cur = await db.select({ windowStart: rateLimitBucket.windowStart }).from(rateLimitBucket).where(eq(rateLimitBucket.key, key)).limit(1);
  const last = cur[0]?.windowStart ?? now;
  return { admitted: false, retryAfterMs: Math.max(1, last + gapMs - now) };
}
