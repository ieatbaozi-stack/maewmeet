// repo: งานเก็บกวาดของ cron รายวัน — ARCHITECTURE §8 ข้อ 1–3 · ทุกคำสั่ง idempotent (รันซ้ำได้ผลเท่าเดิม)
// คืน statement ที่ยังไม่รัน เพื่อให้ service รวมเป็น batch เดียว (atomic บน libSQL/Turso)
import { and, eq, isNull, lt, lte, or } from 'drizzle-orm';
import {
  groupInvite,
  loginThrottle,
  notification,
  pinResetRequest,
  placeSearchCache,
  rateLimitBucket,
  session,
} from '@/db/schema';
import type { Db } from '@/db/client';
import { DAY_MS } from '@/lib/shared/clock';

export const RETENTION = {
  rateLimitBucketMs: 2 * DAY_MS, // §8.1
  loginThrottleIdleMs: 30 * DAY_MS, // §8.1
  notificationMs: 90 * DAY_MS, // §8.3
  placeSearchCacheMs: 30 * DAY_MS, // §8.3
} as const;

export function maintenanceStatements(db: Db, now: number) {
  return {
    // §8.1
    expiredSessions: db.delete(session).where(lte(session.expiresAt, now)),
    staleRateLimitBuckets: db
      .delete(rateLimitBucket)
      .where(lt(rateLimitBucket.windowStart, now - RETENTION.rateLimitBucketMs)),
    idleLoginThrottles: db
      .delete(loginThrottle)
      .where(
        and(
          or(isNull(loginThrottle.lockedUntil), lte(loginThrottle.lockedUntil, now)),
          lt(loginThrottle.updatedAt, now - RETENTION.loginThrottleIdleMs),
        ),
      ),
    // §8.2 (สำรอง — กลไกหลักคือตรวจ lazy ตอนอ่าน)
    expiredPendingPinResets: db
      .update(pinResetRequest)
      .set({ status: 'expired' })
      .where(and(eq(pinResetRequest.status, 'pending'), lte(pinResetRequest.pendingExpiresAt, now))),
    expiredApprovedPinResets: db
      .update(pinResetRequest)
      .set({ status: 'expired' })
      .where(and(eq(pinResetRequest.status, 'approved'), lte(pinResetRequest.expiresAt, now))),
    expiredInvites: db
      .update(groupInvite)
      .set({ status: 'expired' })
      .where(and(eq(groupInvite.status, 'active'), lte(groupInvite.expiresAt, now))),
    // §8.3
    oldNotifications: db.delete(notification).where(lt(notification.createdAt, now - RETENTION.notificationMs)),
    stalePlaceSearchCache: db
      .delete(placeSearchCache)
      .where(lt(placeSearchCache.fetchedAt, now - RETENTION.placeSearchCacheMs)),
  };
}

export type MaintenanceTask = keyof ReturnType<typeof maintenanceStatements>;
