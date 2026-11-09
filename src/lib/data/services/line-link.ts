// service: เชื่อมบัญชี LINE จาก /me — R10 §2 · ทุกฟังก์ชัน authorize ก่อน (ใช้ self.read / self.update: เป็นของตัวเองเสมอ userId มาจาก session)
//  - โค้ดดิบส่งกลับครั้งเดียวตอนสร้าง · DB เก็บ HMAC · ไม่มีการส่ง LINE user id ออก API
import { findPendingLineLinkExpiry, replaceLineLinkCode, unlinkLineOfUser } from '@/lib/data/repos/line';
import { findUserById } from '@/lib/data/repos/user';
import { LINE_ADD_FRIEND_URL, lineConfig } from '@/lib/integrations/line/config';
import { generateLineLinkCode, hashLineLinkCode } from '@/lib/integrations/line/link-code';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { getEnv } from '@/lib/shared/env';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { LINE_LINK_CODE_TTL_MS, LINE_LINK_RATE_LIMITS } from '@/lib/shared/limits';
import { takeUserSlot } from '../admin-input';
import type { DataCtx } from '../context';
import { inTx } from '../tx';
import { asUser } from './group-common';

export type LineStatusDto = {
  /** false = ไม่มี env LINE → `/me` ซ่อนส่วนนี้ */
  available: boolean;
  /** ลิงก์เพิ่มเพื่อน OA · null เมื่อ available = false */
  addFriendUrl: string | null;
  linked: boolean;
  /** เวลาหมดอายุของโค้ดที่ยังใช้ได้ (ไม่มีตัวโค้ด) · null = ไม่มีโค้ดค้าง */
  pendingExpiresAt: number | null;
};

export type LineLinkCodeDto = { code: string; expiresAt: number };

const channelAvailable = (): boolean => lineConfig(getEnv()) !== null;

export async function getMyLineStatus(actor: Actor, ctx: DataCtx): Promise<LineStatusDto> {
  authorize(actor, 'self.read', { type: 'none' });
  const me = asUser(actor);
  const row = await findUserById(ctx.db, me.id);
  if (!row || row.status !== 'active') throw new AppError('AUTH_REQUIRED');
  const available = channelAvailable();
  const linked = row.lineUserId !== null;
  return {
    available,
    addFriendUrl: available ? LINE_ADD_FRIEND_URL : null,
    linked,
    pendingExpiresAt: linked ? null : await findPendingLineLinkExpiry(ctx.db, me.id, ctx.now),
  };
}

export async function createMyLineCode(actor: Actor, ctx: DataCtx): Promise<LineLinkCodeDto> {
  authorize(actor, 'self.update', { type: 'none' });
  const me = asUser(actor);
  const { db, now, appSecret } = ctx;
  if (!channelAvailable()) throw new AppError('FEATURE_DISABLED');
  const row = await findUserById(db, me.id);
  if (!row || row.status !== 'active') throw new AppError('AUTH_REQUIRED');
  if (row.lineUserId !== null) throw new AppError('CONFLICT');
  await takeUserSlot(db, LINE_LINK_RATE_LIMITS.create, me.id, now);
  const code = generateLineLinkCode();
  const expiresAt = now + LINE_LINK_CODE_TTL_MS;
  await inTx(db, (tx) => replaceLineLinkCode(tx, { id: newId(), userId: me.id, codeHash: hashLineLinkCode(code, appSecret), expiresAt }, now));
  return { code, expiresAt };
}

export async function unlinkMyLine(actor: Actor, ctx: DataCtx): Promise<{ linked: false }> {
  authorize(actor, 'self.update', { type: 'none' });
  const me = asUser(actor);
  await inTx(ctx.db, (tx) => unlinkLineOfUser(tx, me.id, ctx.now));
  return { linked: false };
}
