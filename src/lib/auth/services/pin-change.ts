// POST /api/auth/pin — ตั้ง PIN ใหม่หลัง reset (U3) และเปลี่ยน PIN (U13) · ADR 0002 §5
//  - must_change_pin=1: ไม่ต้องใส่ currentPin · ปกติ: ต้อง currentPin ถูก (นับเข้า login_throttle ของ username นี้เหมือน login)
//  - newPin ผ่านกติกา §2 (ห้าม 123456 และอีก 19 ตัว) · สำเร็จ: hash ด้วย pepper ปัจจุบัน, must_change_pin=0,
//    ลบ session อื่นทั้งหมด (เหลือเครื่องนี้), ยกเลิกคำขอ reset ที่ค้าง
import { z } from 'zod';
import { cancelPendingPinResetOfUser } from '@/lib/data/repos/pin-reset-request';
import { findUserById, setUserPin } from '@/lib/data/repos/user';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import type { AuthCtx } from '../context';
import { currentPepper, pepperOfVersion, requirePepper } from '../pepper';
import { hashPin, verifyDummy, verifyPin } from '../pin';
import { assertAcceptableNewPin, isPinFormat, normalizeUsername } from '../pin-rules';
import { readSessionId, revokeAllSessions, revokeOtherSessions } from '../session';
import {
  assertNotLocked,
  assertRateNotFull,
  clearFailures,
  countRate,
  failureOutcome,
  ipHashOf,
  RATE_LIMITS,
  usernameThrottleKey,
} from '../throttle';
import { pinField, userIdOf } from './shared';

export const changePinInputSchema = z
  .object({ newPin: pinField, newPinConfirm: pinField, currentPin: pinField.optional() })
  .strict();
export type ChangePinInput = z.output<typeof changePinInputSchema>;

export async function changePin(
  actor: Actor,
  input: ChangePinInput,
  ctx: AuthCtx,
): Promise<{ mustChangePin: false; otherSessionsRevoked: number }> {
  authorize(actor, 'self.pin.change', { type: 'none' });
  const userId = userIdOf(actor);
  const { db, now } = ctx;
  const pepperCtx = await requirePepper(db, now, ctx.pepperSource);

  assertAcceptableNewPin(input.newPin);
  if (input.newPin !== input.newPinConfirm) throw new AppError('PIN_MISMATCH');

  const me = await findUserById(db, userId);
  if (!me || me.status !== 'active') throw new AppError('AUTH_REQUIRED');

  if (!me.mustChangePin) {
    // U13: ต้องรู้ PIN เดิม — ผิดนับ throttle ของ username นี้ (กัน session ที่ถูกขโมยมาเดา PIN)
    if (input.currentPin === undefined) throw new AppError('VALIDATION', { fields: { currentPin: 'REQUIRED' } });
    if (!isPinFormat(input.currentPin)) throw new AppError('PIN_FORMAT');
    const key = usernameThrottleKey(normalizeUsername(me.username));
    const ipId = ipHashOf(ctx.req, ctx.appSecret);
    await assertRateNotFull(db, RATE_LIMITS.loginIp, ipId, now);
    await assertNotLocked(db, key, now);
    const pepper = me.pinHash ? pepperOfVersion(pepperCtx, me.pinPepperVersion) : null;
    if (me.pinHash && !pepper) throw new AppError('AUTH_MAINTENANCE');
    const ok = me.pinHash && pepper ? await verifyPin(input.currentPin, me.pinHash, pepper.secret) : await verifyDummy(input.currentPin);
    if (!ok) {
      await countRate(db, RATE_LIMITS.loginIp, ipId, now);
      throw await failureOutcome(db, key, now);
    }
    await clearFailures(db, key, now);
  }

  const cur = currentPepper(pepperCtx);
  const pinHash = await hashPin(input.newPin, cur);
  const keepSessionId = readSessionId(ctx.req);
  const revoked = await db.transaction(async (tx) => {
    await setUserPin(tx, userId, { pinHash, pinPepperVersion: cur.version, mustChangePin: false }, now);
    await cancelPendingPinResetOfUser(tx, userId, now);
    // ไม่มี cookie (เรียกด้วยวิธีอื่น) → ลบหมดทุกเครื่อง ปลอดภัยกว่าเหลือ session ที่ไม่รู้จัก
    return keepSessionId ? revokeOtherSessions(tx, userId, keepSessionId) : revokeAllSessions(tx, userId);
  });
  return { mustChangePin: false, otherSessionsRevoked: revoked };
}
