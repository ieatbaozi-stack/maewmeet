// service: หน้า super admin — กลุ่ม (U12 · R5_CONTRACT §2 ข้อ 3)
//  - รายการ (admin.group.list): ชื่อ contains · status active|deleted|all · หน้าละ 30 · ไม่ audit
//  - รายละเอียด (admin.group.view): ชื่อ, tz, สมาชิก (username, ชื่อ, role, เวลาเข้า), จำนวนนัดที่ยังเปิด · ไม่มี busy/รายละเอียดนัด/ตำแหน่ง/หมายเหตุ
//    เขียน audit `admin.group.view` ไม่เกิน 1 แถว/(ผู้ใช้, กลุ่ม)/10 นาที (ในธุรกรรมเดียวกับการอ่าน — Sec L4) · ไม่พบ → 404 (ไม่ audit)
//  - โอน admin / ลบกลุ่ม ใช้ endpoint กลุ่มเดิม (ไม่สร้างซ้ำ)
//  - R17 G1 กู้คืน (admin.group.restore · SA เท่านั้น): limiter เขียนของ admin → UPDATE มีเงื่อนไขคำสั่งเดียว → audit group.restore + แจ้งสมาชิก (G5) ในธุรกรรมเดียว
//    รายการ/รายละเอียดคืน purgeAt / restorable / restoreBlockedReason ที่คำนวณที่เซิร์ฟเวอร์ (group-retention.ts)
import { z } from 'zod';
import { findGroupForAdmin, listActiveMemberIds, listGroupsForAdmin, listMembersForAdmin, restoreGroupGuarded } from '@/lib/data/repos/admin-groups';
import { insertGroupViewThrottled } from '@/lib/data/repos/admin-audit';
import { notify } from '@/lib/data/notifications/notify';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { ADMIN_PAGE_SIZE, ADMIN_RATE_LIMITS, AUDIT_VIEW_LOG_INTERVAL_MS } from '@/lib/shared/limits';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { DataCtx } from '../context';
import { decodeKeysetCursor, page, parseSearchTerm, takeUserSlot } from '../admin-input';
import { GROUP_RETENTION_MS, GROUP_RETENTION_START_MS } from '../group-retention';
import { groupRetentionDto, toAdminGroupDetailDto, toAdminGroupDto, type AdminGroupDetailDto, type AdminGroupDto } from '../serializers/admin';
import { inTx } from '../tx';
import { asUser, audit } from './group-common';

export const adminGroupListQuerySchema = z
  .object({ q: z.string().max(200).optional(), status: z.enum(['active', 'deleted', 'all']).optional(), cursor: z.string().max(512).optional() })
  .strict();
export type AdminGroupListQuery = z.output<typeof adminGroupListQuerySchema>;
export const adminGroupParamsSchema = z.object({ gid: z.uuid() });

export async function listAdminGroups(actor: Actor, query: AdminGroupListQuery, ctx: DataCtx): Promise<{ groups: AdminGroupDto[]; nextCursor: string | null }> {
  authorize(actor, 'admin.group.list', { type: 'none' });
  const term = parseSearchTerm(query.q);
  const cursor = decodeKeysetCursor(query.cursor);
  const rows = await listGroupsForAdmin(ctx.db, { nameContains: term?.contains ?? null, status: query.status ?? 'active', cursor, limit: ADMIN_PAGE_SIZE + 1 });
  const { items, nextCursor } = page(rows, ADMIN_PAGE_SIZE);
  return { groups: items.map((r) => toAdminGroupDto(r, ctx.now)), nextCursor };
}

export async function getAdminGroup(actor: Actor, groupId: string, ctx: DataCtx): Promise<{ group: AdminGroupDetailDto }> {
  authorize(actor, 'admin.group.view', { type: 'none' });
  const me = asUser(actor);
  const { now } = ctx;
  return inTx(ctx.db, async (tx) => {
    const g = await findGroupForAdmin(tx, groupId, now);
    if (!g) throw new AppError('NOT_FOUND');
    const members = await listMembersForAdmin(tx, groupId);
    // ไม่เกิน 1 แถว/(ผู้ใช้, กลุ่ม)/10 นาที — คำสั่งเดียว (Security R5 L4)
    await insertGroupViewThrottled(tx, { id: newId(), actorId: me.id, groupId, intervalMs: AUDIT_VIEW_LOG_INTERVAL_MS }, now);
    return { group: toAdminGroupDetailDto(g, members, now) };
  });
}

/** ผล POST /api/admin/groups/:gid/restore · changed false = กลุ่มไม่ได้ลบอยู่แล้ว (กดซ้ำ/มีคนกู้ไปก่อน) — ไม่ audit ไม่แจ้ง */
export type RestoreGroupResult = { group: { id: string; restored: true; changed: boolean } };

/**
 * R17 G1: super admin กู้คืนกลุ่มที่ลบ
 *  - ไม่ใช่ SA → authorize โยน FORBIDDEN (403 แบบเดียวกับ route /api/admin/* อื่น) ก่อนแตะอะไร
 *  - ไม่มีกลุ่ม / ลบถาวรแล้ว → 404 NOT_FOUND
 *  - ยังไม่ลบ → 200 changed:false
 *  - เกินเวลา (cron ยังไม่ได้ลบ) → 409 CONFLICT {reason:'RETENTION_EXPIRED'} · ไม่มี admin ที่บัญชี active → 409 CONFLICT {reason:'NO_ACTIVE_ADMIN'}
 */
export async function restoreAdminGroup(actor: Actor, groupId: string, ctx: DataCtx): Promise<RestoreGroupResult> {
  const allow = authorize(actor, 'admin.group.restore', { type: 'none' });
  const me = asUser(actor);
  const { db, now } = ctx;
  await takeUserSlot(db, ADMIN_RATE_LIMITS.write, me.id, now);
  return inTx(db, async (tx) => {
    const restored = await restoreGroupGuarded(tx, { groupId, retentionStartMs: GROUP_RETENTION_START_MS, retentionMs: GROUP_RETENTION_MS }, now);
    if (!restored) {
      // วินิจฉัยในธุรกรรมเดียวกัน (ยังไม่มีอะไรถูกเขียน)
      const g = await findGroupForAdmin(tx, groupId, now);
      if (!g) throw new AppError('NOT_FOUND');
      if (g.deletedAt === null) return { group: { id: groupId, restored: true as const, changed: false } };
      const reason = groupRetentionDto(g.deletedAt, g.hasActiveAdmin, now).restoreBlockedReason;
      // reason null ไม่ควรเกิด (คำสั่งเดียวกันในธุรกรรมเขียน) — ถ้าเกิดตอบ CONFLICT เปล่า (ลองใหม่ได้)
      throw new AppError('CONFLICT', reason ? { reason } : undefined);
    }
    await audit(tx, me, allow, { action: 'group.restore', targetType: 'group', targetId: groupId, groupId }, now);
    // G5 (B3): สมาชิกที่บัญชี active ทุกคน ยกเว้นผู้กระทำ · กระดิ่งเท่านั้น · ไม่มีชื่อ SA (R16 H4)
    const recipients = (await listActiveMemberIds(tx, groupId)).filter((u) => u !== me.id);
    await notify(tx, { userIds: recipients, kind: 'group.restored', params: { groupId, groupName: sanitizeDisplayText(restored.name), actorSystemAdmin: true } }, now);
    return { group: { id: groupId, restored: true as const, changed: true } };
  });
}
