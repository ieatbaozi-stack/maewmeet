// service: หน้า super admin — กลุ่ม (U12 · R5_CONTRACT §2 ข้อ 3)
//  - รายการ (admin.group.list): ชื่อ contains · status active|deleted|all · หน้าละ 30 · ไม่ audit
//  - รายละเอียด (admin.group.view): ชื่อ, tz, สมาชิก (username, ชื่อ, role, เวลาเข้า), จำนวนนัดที่ยังเปิด · ไม่มี busy/รายละเอียดนัด/ตำแหน่ง/หมายเหตุ
//    เขียน audit `admin.group.view` ไม่เกิน 1 แถว/(ผู้ใช้, กลุ่ม)/10 นาที (ในธุรกรรมเดียวกับการอ่าน — Sec L4) · ไม่พบ → 404 (ไม่ audit)
//  - โอน admin / ลบกลุ่ม ใช้ endpoint กลุ่มเดิม (ไม่สร้างซ้ำ)
import { z } from 'zod';
import { findGroupForAdmin, listGroupsForAdmin, listMembersForAdmin } from '@/lib/data/repos/admin-groups';
import { insertGroupViewThrottled } from '@/lib/data/repos/admin-audit';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { ADMIN_PAGE_SIZE, AUDIT_VIEW_LOG_INTERVAL_MS } from '@/lib/shared/limits';
import type { DataCtx } from '../context';
import { decodeKeysetCursor, page, parseSearchTerm } from '../admin-input';
import { toAdminGroupDetailDto, toAdminGroupDto, type AdminGroupDetailDto, type AdminGroupDto } from '../serializers/admin';
import { inTx } from '../tx';
import { asUser } from './group-common';

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
  return { groups: items.map(toAdminGroupDto), nextCursor };
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
    return { group: toAdminGroupDetailDto(g, members) };
  });
}
