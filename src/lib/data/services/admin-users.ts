// service: หน้า super admin — ผู้ใช้ (U12 · R5_CONTRACT §2 ข้อ 3) · ทุกฟังก์ชัน authorize(admin.*) บรรทัดแรก (SA-only → ผู้อื่น 403)
//  - รายการ: ค้น username (prefix) / ชื่อที่แสดง (contains) · หน้าละ 30 · cursor (createdAt, id) · ไม่คืนบัญชีที่ลบแล้ว
//  - suspend: active → suspended + ลบ session ทั้งหมด (เด้งออกทันที) + audit ในธุรกรรมเดียว · ระงับตัวเอง/super admin คนอื่น → 403 FORBIDDEN
//    unsuspend: suspended → active + audit · ทั้งคู่ใช้ action admin.user.suspend · ทำซ้ำ = สำเร็จแบบ idempotent (changed: false, ไม่ audit)
//  - unlock: ล้าง login_throttle ของ username นั้น (ไม่แตะ PIN/สถานะ) + audit
//  - บัญชีที่ลบแล้ว/ไม่มี → 404 · ทุกการเขียนผ่าน limiter 60 ครั้ง/10 นาที/ผู้ใช้
import { z } from 'zod';
import { suspendUserGuarded, unsuspendUserGuarded, listUsersForAdmin } from '@/lib/data/repos/admin-users';
import { insertAuditLog } from '@/lib/data/repos/audit-log';
import { getLoginThrottle, lockRemainingSec, resetLoginThrottle } from '@/lib/data/repos/login-throttle';
import { deleteAllSessionsOfUser } from '@/lib/data/repos/session';
import { findUserById, type UserRow } from '@/lib/data/repos/user';
import { usernameThrottleKey } from '@/lib/auth/throttle';
import { authorize } from '@/lib/rbac/can';
import type { Actor, UserActor } from '@/lib/rbac/types';
import type { DbOrTx } from '@/db/client';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { ADMIN_PAGE_SIZE, ADMIN_RATE_LIMITS } from '@/lib/shared/limits';
import type { DataCtx } from '../context';
import { decodeKeysetCursor, page, parseSearchTerm, takeUserSlot } from '../admin-input';
import { toAdminUserDto, type AdminUserActionDto, type AdminUserDto } from '../serializers/admin';
import { inTx } from '../tx';
import { asUser } from './group-common';

export const adminUserListQuerySchema = z.object({ q: z.string().max(200).optional(), cursor: z.string().max(512).optional() }).strict();
export type AdminUserListQuery = z.output<typeof adminUserListQuerySchema>;
export const adminUserParamsSchema = z.object({ id: z.uuid() });

export async function listAdminUsers(actor: Actor, query: AdminUserListQuery, ctx: DataCtx): Promise<{ users: AdminUserDto[]; nextCursor: string | null }> {
  authorize(actor, 'admin.user.list', { type: 'none' });
  const term = parseSearchTerm(query.q);
  const cursor = decodeKeysetCursor(query.cursor);
  const rows = await listUsersForAdmin(ctx.db, {
    usernamePrefix: term?.usernamePrefix ?? null,
    nameContains: term?.contains ?? null,
    cursor,
    limit: ADMIN_PAGE_SIZE + 1,
    now: ctx.now,
  });
  const { items, nextCursor } = page(rows, ADMIN_PAGE_SIZE);
  return { users: items.map(toAdminUserDto), nextCursor };
}

/** เป้าหมายที่จัดการได้: มีอยู่และยังไม่ถูกลบ (ไม่งั้น 404 — ไม่แยก "ไม่มี" กับ "ลบแล้ว") */
async function liveTarget(db: DbOrTx, userId: string): Promise<UserRow> {
  const row = await findUserById(db, userId);
  if (!row || row.status === 'deleted') throw new AppError('NOT_FOUND');
  return row;
}

async function auditUser(tx: DbOrTx, me: UserActor, action: string, targetId: string, meta: Record<string, unknown>, now: number): Promise<void> {
  await insertAuditLog(tx, { id: newId(), actorId: me.id, action, targetType: 'user', targetId, meta: { ...meta, asSuperAdmin: true } }, now);
}

export async function suspendUser(actor: Actor, userId: string, ctx: DataCtx): Promise<{ user: AdminUserActionDto }> {
  authorize(actor, 'admin.user.suspend', { type: 'none' });
  const me = asUser(actor);
  const { db, now } = ctx;
  await takeUserSlot(db, ADMIN_RATE_LIMITS.write, me.id, now);
  return inTx(db, async (tx) => {
    const target = await liveTarget(tx, userId);
    // Auth & Access ตัดสิน (R5_CONTRACT §2 ข้อ 3): ระงับตัวเอง / super admin คนอื่น → 403 FORBIDDEN (เป็นการปฏิเสธเชิงนโยบาย ไม่ใช่สถานะชน)
    if (target.id === me.id || target.isAdmin) throw new AppError('FORBIDDEN');
    if (target.status === 'suspended') return { user: { id: target.id, status: 'suspended' as const, changed: false } };
    // UPDATE มีเงื่อนไข (active + is_admin = 0) — is_admin ถูกตั้งด้วย SQL ระหว่างทางก็ไม่ระงับ
    if (!(await suspendUserGuarded(tx, target.id, now))) throw new AppError('CONFLICT');
    await deleteAllSessionsOfUser(tx, target.id);
    await auditUser(tx, me, 'admin.user.suspend', target.id, { state: 'suspended' }, now);
    return { user: { id: target.id, status: 'suspended' as const, changed: true } };
  });
}

export async function unsuspendUser(actor: Actor, userId: string, ctx: DataCtx): Promise<{ user: AdminUserActionDto }> {
  authorize(actor, 'admin.user.suspend', { type: 'none' });
  const me = asUser(actor);
  const { db, now } = ctx;
  await takeUserSlot(db, ADMIN_RATE_LIMITS.write, me.id, now);
  return inTx(db, async (tx) => {
    const target = await liveTarget(tx, userId);
    if (target.status === 'active') return { user: { id: target.id, status: 'active' as const, changed: false } };
    if (!(await unsuspendUserGuarded(tx, target.id, now))) throw new AppError('CONFLICT');
    await auditUser(tx, me, 'admin.user.suspend', target.id, { state: 'active' }, now);
    return { user: { id: target.id, status: 'active' as const, changed: true } };
  });
}

export async function unlockUser(actor: Actor, userId: string, ctx: DataCtx): Promise<{ user: { id: string; wasLocked: boolean } }> {
  authorize(actor, 'admin.user.unlock', { type: 'none' });
  const me = asUser(actor);
  const { db, now } = ctx;
  await takeUserSlot(db, ADMIN_RATE_LIMITS.write, me.id, now);
  return inTx(db, async (tx) => {
    const target = await liveTarget(tx, userId);
    const key = usernameThrottleKey(target.usernameNormalized);
    const wasLocked = lockRemainingSec(await getLoginThrottle(tx, key), now) > 0;
    await resetLoginThrottle(tx, key, now);
    await auditUser(tx, me, 'admin.user.unlock', target.id, { wasLocked }, now);
    return { user: { id: target.id, wasLocked } };
  });
}
