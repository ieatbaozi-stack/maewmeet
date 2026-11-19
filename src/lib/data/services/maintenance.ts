// service: งานระบบ (cron) — ไม่ผ่าน RBAC เพราะไม่มี actor ผู้ใช้ · ด่านคือ CRON_SECRET ใน route wrapper (guard: 'cron')
// ARCHITECTURE §8 · ADR 0001 §3.1
import type { Db } from '@/db/client';
import { newId } from '@/lib/shared/id';
import { GROUP_PURGE_BATCH, purgeDeletedAtCutoff } from '../group-retention';
import { insertAuditLog } from '../repos/audit-log';
import { listGroupsDueForPurge, purgeGroupIfDue } from '../repos/group-purge';
import { maintenanceStatements, type MaintenanceTask } from '../repos/maintenance';
import { upsertHeartbeat, type HeartbeatSource } from '../repos/system-heartbeat';
import { heartbeatAgeHours, type HeartbeatAgeHours } from '../health';
import { inTx } from '../tx';

/** R17 G2: ผลการลบกลุ่มถาวรของรอบนี้ — groups = จำนวนกลุ่มที่ลบ · remaining = ยังมีกลุ่มถึงกำหนดค้าง (ไปรอบถัดไป) */
export type GroupPurgeResult = { groups: number; remaining: boolean };

export type DailyMaintenanceResult = {
  heartbeat: { source: 'vercel-cron'; lastAt: number };
  cleaned: Record<MaintenanceTask, number>;
  purgedGroups: GroupPurgeResult;
};

/**
 * R17 G2: ลบกลุ่มที่ลบ (soft) ครบ 30 วันแล้ว (นับตาม group-retention.ts รวม B2) ถาวร — ชุดละ GROUP_PURGE_BATCH กลุ่มต่อรอบ
 * ธุรกรรมเขียน (BEGIN IMMEDIATE) ต่อกลุ่ม: ตรวจเงื่อนไขซ้ำ → ลบลูก/แจ้งเตือน/คิว LINE → ลบแถวกลุ่ม → audit `group.purge` (id + จำนวนแถวเท่านั้น)
 * แข่งกับการกู้คืน: ฝั่งที่เขียนก่อนชนะ (กู้ก่อน = deleted_at เป็น NULL → ไม่ลบ) · รันซ้ำได้ (กลุ่มที่ลบแล้วไม่อยู่ในรายการอีก)
 */
export async function purgeExpiredGroups(db: Db, now: number): Promise<GroupPurgeResult> {
  const cutoff = purgeDeletedAtCutoff(now);
  if (cutoff === null) return { groups: 0, remaining: false };
  const due = await listGroupsDueForPurge(db, cutoff, GROUP_PURGE_BATCH + 1);
  let groups = 0;
  for (const groupId of due.slice(0, GROUP_PURGE_BATCH)) {
    const purged = await inTx(db, async (tx) => {
      const counts = await purgeGroupIfDue(tx, groupId, cutoff);
      if (!counts) return false;
      await insertAuditLog(tx, { id: newId(), actorId: null, action: 'group.purge', targetType: 'group', targetId: groupId, groupId, meta: counts }, now);
      return true;
    });
    if (purged) groups++;
  }
  return { groups, remaining: due.length > GROUP_PURGE_BATCH };
}

/**
 * งานรายวัน: 0) เขียน heartbeat ก่อน (แยก statement — ถ้าเก็บกวาดล้ม heartbeat ยังอยู่)
 * 1–3) เก็บกวาดใน batch เดียว (atomic) · 4) outbox = v1.x · 5) pepper fingerprint = R1 · 6) R17: ลบกลุ่มที่ครบ 30 วันถาวร
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
  // R17 G2: หลังเก็บกวาด (แยกธุรกรรมต่อกลุ่ม — ล้มกลางทางไม่ทำให้งานข้อ 1–3 หาย)
  const purgedGroups = await purgeExpiredGroups(db, now);
  return { heartbeat: { source: 'vercel-cron', lastAt: now }, cleaned, purgedGroups };
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
