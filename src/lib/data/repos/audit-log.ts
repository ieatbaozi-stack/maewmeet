// repo: audit_log — append-only · meta ห้ามมี PIN/token/โค้ด (ผู้เรียกรับผิดชอบเนื้อหา · repo ปฏิเสธคีย์ต้องห้ามเป็นด่านสุดท้าย)
import { and, desc, eq } from 'drizzle-orm';
import { auditLog } from '@/db/schema';
import type { DbOrTx } from '@/db/client';

export type AuditRow = typeof auditLog.$inferSelect;

export type NewAudit = {
  id: string;
  /** null = ระบบ */
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  groupId?: string | null;
  meta?: Record<string, unknown> | null;
};

const FORBIDDEN_META_KEY = /pin|token|hash|secret|pepper|code|password/i;

function assertSafeMeta(meta: unknown, depth = 0): void {
  if (meta === null || typeof meta !== 'object' || depth > 4) return;
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (FORBIDDEN_META_KEY.test(k)) throw new Error(`audit meta key not allowed: ${k}`);
    assertSafeMeta(v, depth + 1);
  }
}

export async function insertAuditLog(db: DbOrTx, input: NewAudit, now: number): Promise<void> {
  if (input.meta) assertSafeMeta(input.meta);
  await db.insert(auditLog).values({
    id: input.id,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    groupId: input.groupId ?? null,
    meta: input.meta ?? null,
    createdAt: now,
  });
}

export async function listAuditLog(
  db: DbOrTx,
  filter: { targetType?: string; targetId?: string; actorId?: string; limit?: number } = {},
): Promise<AuditRow[]> {
  const conds = [
    ...(filter.targetType ? [eq(auditLog.targetType, filter.targetType)] : []),
    ...(filter.targetId ? [eq(auditLog.targetId, filter.targetId)] : []),
    ...(filter.actorId ? [eq(auditLog.actorId, filter.actorId)] : []),
  ];
  return db
    .select()
    .from(auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 200));
}
