// service: หน้า super admin — audit log (U12 · R5_CONTRACT §2 ข้อ 3) · action admin.audit.view (SA-only)
//  - ใหม่→เก่า keyset (createdAt, id) · limit ≤ 100 (ดีฟอลต์ 50) · before = cursor · กรอง actor/action/targetType/targetId (เท่ากันพอดี)
//  - แต่ละแถว: meta ผ่าน whitelist ต่อ action (serializers/admin.ts)
//  - การเปิดดูเขียน `admin.audit.view` ไม่เกิน 1 แถว/10 นาที/ผู้ใช้ (คำสั่งเดียวมีเงื่อนไข — ไม่บวมจากการรีเฟรช/เลื่อนหน้า)
import { z } from 'zod';
import { insertAuditViewThrottled, listAuditForAdmin, type AuditFilter } from '@/lib/data/repos/admin-audit';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { newId } from '@/lib/shared/id';
import { AUDIT_LIST_DEFAULT, AUDIT_LIST_MAX, AUDIT_VIEW_LOG_INTERVAL_MS } from '@/lib/shared/limits';
import type { DataCtx } from '../context';
import { decodeKeysetCursor, page } from '../admin-input';
import { toAuditRowDto, type AuditRowDto } from '../serializers/admin';
import { inTx } from '../tx';
import { asUser } from './group-common';
import { parseLimit } from './appointments';

/** ค่าว่าง ('') = ไม่กรอง (ฟอร์มส่งช่องว่างมาได้) */
const optional = <T extends z.ZodType>(s: T) => z.union([z.literal(''), s]).optional();

export const auditListQuerySchema = z
  .object({
    actor: optional(z.uuid()),
    action: optional(z.string().regex(/^[A-Za-z][A-Za-z.]{0,63}$/)),
    targetType: optional(z.string().regex(/^[a-z][a-z_]{0,31}$/)),
    targetId: optional(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)),
    before: z.string().max(512).optional(),
    limit: z.string().max(8).optional(),
  })
  .strict();
export type AuditListQuery = z.output<typeof auditListQuerySchema>;

const val = (v: string | undefined): string | undefined => (v === undefined || v === '' ? undefined : v);

export async function listAudit(actor: Actor, query: AuditListQuery, ctx: DataCtx): Promise<{ entries: AuditRowDto[]; nextCursor: string | null }> {
  authorize(actor, 'admin.audit.view', { type: 'none' });
  const me = asUser(actor);
  const limit = parseLimit(query.limit, AUDIT_LIST_DEFAULT, AUDIT_LIST_MAX);
  const cursor = decodeKeysetCursor(query.before, 'before');
  const filter: AuditFilter = {
    actorId: val(query.actor),
    action: val(query.action),
    targetType: val(query.targetType),
    targetId: val(query.targetId),
  };
  const filtered = Object.values(filter).some((v) => v !== undefined) || cursor !== null;
  const { now } = ctx;
  const rows = await inTx(ctx.db, async (tx) => {
    await insertAuditViewThrottled(tx, { id: newId(), actorId: me.id, filtered, intervalMs: AUDIT_VIEW_LOG_INTERVAL_MS }, now);
    return listAuditForAdmin(tx, { filter, cursor, limit: limit + 1 });
  });
  const { items, nextCursor } = page(rows, limit);
  return { entries: items.map(toAuditRowDto), nextCursor };
}
