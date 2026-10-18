// service: งานระบบ (cron) — ไม่ผ่าน RBAC เพราะไม่มี actor ผู้ใช้ · ด่านคือ CRON_SECRET ใน route wrapper (guard: 'cron')
// ARCHITECTURE §8 · ADR 0001 §3.1
import type { Db } from '@/db/client';
import { maintenanceStatements, type MaintenanceTask } from '../repos/maintenance';
import { upsertHeartbeat, type HeartbeatSource } from '../repos/system-heartbeat';
import { heartbeatAgeHours, type HeartbeatAgeHours } from '../health';

export type DailyMaintenanceResult = {
  heartbeat: { source: 'vercel-cron'; lastAt: number };
  cleaned: Record<MaintenanceTask, number>;
};

/**
 * งานรายวัน: 0) เขียน heartbeat ก่อน (แยก statement — ถ้าเก็บกวาดล้ม heartbeat ยังอยู่)
 * 1–3) เก็บกวาดใน batch เดียว (atomic) · 4) outbox = v1.x · 5) pepper fingerprint = R1
 */
export async function runDailyMaintenance(db: Db, now: number): Promise<DailyMaintenanceResult> {
  await upsertHeartbeat(db, 'vercel-cron', now);

  const statements = maintenanceStatements(db, now);
  const names = Object.keys(statements) as MaintenanceTask[];
  const [first, ...rest] = names.map((n) => statements[n]);
  if (!first) throw new Error('no maintenance statements');
  const results = await db.batch([first, ...rest]);

  const cleaned = {} as Record<MaintenanceTask, number>;
  names.forEach((name, i) => {
    cleaned[name] = results[i]?.rowsAffected ?? 0;
  });
  return { heartbeat: { source: 'vercel-cron', lastAt: now }, cleaned };
}

export type HeartbeatResult = {
  source: HeartbeatSource;
  lastAt: number;
  heartbeatAgeHours: HeartbeatAgeHours;
};

/** keep-alive ชั้น 2 (GitHub Actions) — เขียนแล้วคืนอายุ heartbeat ทุก source (ARCHITECTURE §5) */
export async function recordHeartbeat(db: Db, source: HeartbeatSource, now: number): Promise<HeartbeatResult> {
  await upsertHeartbeat(db, source, now);
  return { source, lastAt: now, heartbeatAgeHours: await heartbeatAgeHours(db, now) };
}
