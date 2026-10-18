// repo: system_heartbeat — keep-alive Turso (ADR 0001 §3.1) · query ล้วน ไม่รู้จัก actor
import { systemHeartbeat } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export const HEARTBEAT_SOURCES = ['vercel-cron', 'github-actions'] as const;
export type HeartbeatSource = (typeof HEARTBEAT_SOURCES)[number];

/** UPSERT — เป็น "การเขียน" เสมอ (ใช้เป็นสัญญาณ keep-alive) */
export async function upsertHeartbeat(db: DbOrTx, source: HeartbeatSource, at: number): Promise<void> {
  await db
    .insert(systemHeartbeat)
    .values({ source, lastAt: at })
    .onConflictDoUpdate({ target: systemHeartbeat.source, set: { lastAt: at } });
}

export async function listHeartbeats(db: DbOrTx): Promise<{ source: HeartbeatSource; lastAt: number }[]> {
  return db.select({ source: systemHeartbeat.source, lastAt: systemHeartbeat.lastAt }).from(systemHeartbeat);
}
