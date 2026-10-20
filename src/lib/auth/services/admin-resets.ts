// หน้า super admin: รายการคำขอ reset + อนุมัติ/ปฏิเสธ — U2, U12 · ADR 0002 §5–§6
//  - authorize('pinReset.list' | 'pinReset.decide') เป็นบรรทัดแรก (SA only — ผู้อื่น 403)
//  - decide: approve → pin_hash = NULL (PIN เดิมใช้ไม่ได้) + expires_at = now+24 ชม. + ล้าง login_throttle ของ user (S3) + notification + audit
//            approve คำขอของตัวเอง → 403 FORBIDDEN (S2)
//            reject → status=rejected + audit · ทั้งหมดใน transaction เดียว (audit ไม่ตกหล่น)
//  - meta ของ audit ใช้คีย์ decision/targetUserId (repo ปฏิเสธคีย์ที่ตรง pin|token|hash|secret|pepper|code|password)
import { z } from 'zod';
import { insertAuditLog } from '@/lib/data/repos/audit-log';
import { insertNotification } from '@/lib/data/repos/notification';
import {
  approvePinReset,
  findPinResetById,
  listPendingPinResets,
  rejectPinReset,
  type PinResetRow,
} from '@/lib/data/repos/pin-reset-request';
import { clearUserPinHash, findUserById } from '@/lib/data/repos/user';
import { resetLoginThrottle } from '@/lib/data/repos/login-throttle';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { AuthCtx } from '../context';
import { usernameThrottleKey } from '../throttle';
import { isSqliteBusy, userIdOf } from './shared';

export const listPinResetsQuerySchema = z.object({ status: z.enum(['pending']).default('pending') }).strict();
export const pinResetParamsSchema = z.object({ id: z.uuid() });

export type PinResetListItem = {
  id: string;
  username: string;
  displayName: string;
  requestedAt: number;
  pendingExpiresAt: number;
  /** ชนิดอุปกรณ์/เบราว์เซอร์แบบย่อ เช่น "iPhone · Safari" */
  device: string | null;
  /** รหัสประเทศ 2 ตัวอักษร */
  country: string | null;
};

export async function listPinResets(actor: Actor, ctx: AuthCtx): Promise<{ items: PinResetListItem[] }> {
  authorize(actor, 'pinReset.list', { type: 'none' });
  const rows = await listPendingPinResets(ctx.db, ctx.now);
  return {
    items: rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: sanitizeDisplayText(r.displayName),
      requestedAt: r.requestedAt,
      pendingExpiresAt: r.pendingExpiresAt,
      device: r.requesterUa,
      country: r.requesterCountry,
    })),
  };
}

export type PinResetDecision = { id: string; status: 'approved' | 'rejected'; expiresAt: number | null };

async function decide(
  actor: Actor,
  id: string,
  decision: 'approved' | 'rejected',
  ctx: AuthCtx,
): Promise<PinResetDecision> {
  const allow = authorize(actor, 'pinReset.decide', { type: 'none' });
  const actorId = userIdOf(actor);
  const { db, now } = ctx;

  // S2: อนุมัติคำขอของตัวเองไม่ได้ (SA ที่ลืม PIN ใช้สคริปต์ break-glass) · ปฏิเสธคำขอตัวเองทำได้ · ไม่เขียน audit (ไม่มีอะไรเปลี่ยน)
  if (decision === 'approved' && (await findPinResetById(db, id, now))?.userId === actorId) throw new AppError('FORBIDDEN');

  const run = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<PinResetRow | null> => {
    const next =
      decision === 'approved' ? await approvePinReset(tx, id, actorId, now) : await rejectPinReset(tx, id, actorId, now);
    if (!next) return null;
    if (decision === 'approved') {
      await clearUserPinHash(tx, next.userId, now); // PIN เดิมใช้ไม่ได้อีก ("PIN กลายเป็น 123456")
      // S3: อนุมัติ = ล้างตัวนับ/ล็อกของ username นี้ด้วย (ไม่งั้นเจ้าของบัญชีที่ถูกคนอื่นเดาจนล็อกเข้าด้วย 123456 ไม่ได้)
      const target = await findUserById(tx, next.userId);
      if (target) await resetLoginThrottle(tx, usernameThrottleKey(target.usernameNormalized), now);
      await insertNotification(
        tx,
        { id: newId(), userId: next.userId, kind: 'pin_reset.approved', params: { expiresAt: next.expiresAt } },
        now,
      );
    }
    if (allow.auditAsSuperAdmin) {
      await insertAuditLog(
        tx,
        {
          id: newId(),
          actorId,
          action: 'pinReset.decide',
          targetType: 'pin_reset',
          targetId: next.id,
          meta: { decision, targetUserId: next.userId },
        },
        now,
      );
    }
    return next;
  };
  // ธุรกรรมเดียว: สถานะ + pin_hash + notification + audit สำเร็จพร้อมกันหรือไม่สำเร็จเลย
  const row = await db.transaction(run).catch((e: unknown) => {
    // อีกคำขอกำลังตัดสินรายการเดียวกัน/เขียนชนกัน → 409 ให้ลองใหม่ (ธุรกรรมนี้ rollback ทั้งก้อน ไม่มีสถานะครึ่งทาง)
    throw isSqliteBusy(e) ? new AppError('CONFLICT') : e;
  });

  if (!row) {
    // ไม่ใช่ pending (ตัดสินไปแล้ว/หมดอายุ/ถูกยกเลิก) → 409 · ไม่มีรายการ → 404
    const existing = await findPinResetById(db, id, now);
    throw new AppError(existing ? 'CONFLICT' : 'NOT_FOUND');
  }
  return { id: row.id, status: decision, expiresAt: row.expiresAt };
}

export const approvePinResetRequest = (actor: Actor, id: string, ctx: AuthCtx) => decide(actor, id, 'approved', ctx);
export const rejectPinResetRequest = (actor: Actor, id: string, ctx: AuthCtx) => decide(actor, id, 'rejected', ctx);
