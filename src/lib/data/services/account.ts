// service: บัญชีของฉัน — U13 · R5_CONTRACT §2 ข้อ 1–2
//  PATCH /api/me (self.update): ชื่อที่แสดงด้วยกติกาเดียวกับสมัคร (checkVisibleName 1–40) · 10 ครั้ง/วัน/ผู้ใช้ (นับเฉพาะที่เปลี่ยนจริง) · ไม่ audit
//  POST /api/me/delete (self.delete):
//    authorize (ด่านบัญชี + super admin → 403) → ถือ admin กลุ่มที่ยังอยู่ → 409 ADMIN_TRANSFER_REQUIRED {groups} (ยังไม่แตะ PIN/throttle) →
//    PIN ปัจจุบัน (จองช่อง IP + username ก่อน verify — ตัวนับชุดเดียวกับ login: ผิดนับ, ถูกล้าง) →
//    ธุรกรรมเดียว: UPDATE user มีเงื่อนไขในตัว (active + ไม่ใช่ SA + ไม่ถือ admin) เป็นคำสั่งแรก → ลบ/ปิดร่องรอย → audit user.delete
//    (โอน admin มาให้ระหว่างลบ: ฝั่งใดเขียนก่อนชนะ — ไม่มีกลุ่มไร้ admin และไม่มีสถานะครึ่งทาง)
import { z } from 'zod';
import { listLiveGroupsAdminedBy, markUserDeletedGuarded, purgeDeletedUserFootprint, updateDisplayName } from '@/lib/data/repos/account';
import { insertAuditLog } from '@/lib/data/repos/audit-log';
import { findUserById } from '@/lib/data/repos/user';
import type { AuthCtx } from '@/lib/auth/context';
import { pepperOfVersion, requirePepper } from '@/lib/auth/pepper';
import { verifyDummy, verifyPin } from '@/lib/auth/pin';
import { DISPLAY_NAME_MAX, isPinFormat } from '@/lib/auth/pin-rules';
import { clearSessionCookie, sessionUserDto, type AuthCookie, type SessionUserDto } from '@/lib/auth/session';
import { failedAttempt, reserveIpSlot, reserveUsernameSlot, succeededAttempt, usernameThrottleKey } from '@/lib/auth/throttle';
import { pinField } from '@/lib/auth/services/shared';
import { authorize, can } from '@/lib/rbac/can';
import { PolicyError } from '@/lib/rbac/errors';
import type { Actor } from '@/lib/rbac/types';
import type { DbOrTx } from '@/db/client';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { ACCOUNT_RATE_LIMITS } from '@/lib/shared/limits';
import { checkVisibleName, sanitizeDisplayText } from '@/lib/shared/name-rules';
import { takeUserSlot } from '../admin-input';
import { inTx, serialized } from '../tx';
import { asUser } from './group-common';

export const updateMeInputSchema = z.object({ displayName: z.string().min(1).max(200) }).strict();
export type UpdateMeInput = z.output<typeof updateMeInputSchema>;

export const deleteMeInputSchema = z.object({ pin: pinField }).strict();
export type DeleteMeInput = z.output<typeof deleteMeInputSchema>;

export async function updateMe(actor: Actor, input: UpdateMeInput, ctx: AuthCtx): Promise<{ user: SessionUserDto }> {
  authorize(actor, 'self.update', { type: 'none' });
  const me = asUser(actor);
  const { db, now } = ctx;
  const checked = checkVisibleName(input.displayName, { min: 1, max: DISPLAY_NAME_MAX });
  if (!checked.ok) throw new AppError('VALIDATION', { fields: { displayName: checked.reason } });

  const current = await findUserById(db, me.id);
  if (!current || current.status !== 'active') throw new AppError('AUTH_REQUIRED');
  if (current.displayName === checked.name) return { user: sessionUserDto(current) }; // ไม่เปลี่ยน — ไม่กินโควตา

  await takeUserSlot(db, ACCOUNT_RATE_LIMITS.rename, me.id, now);
  const updated = await inTx(db, (tx) => updateDisplayName(tx, me.id, checked.name, now));
  if (!updated) throw new AppError('AUTH_REQUIRED');
  return { user: sessionUserDto(updated) };
}

type AdminGroupRef = { id: string; name: string };

/** 409 พร้อมรายชื่อกลุ่มที่ต้องโอนก่อน (ชื่อผ่าน sanitize) — ตัดสินด้วย can() ตัวเดียวกับ authorize */
function transferRequired(actor: Actor, groups: AdminGroupRef[]): void {
  const d = can(actor, 'self.delete', { type: 'self', holdsGroupAdmin: groups.length > 0 });
  if (d.allow) return;
  if (d.code === 'ADMIN_TRANSFER_REQUIRED') {
    throw new AppError('ADMIN_TRANSFER_REQUIRED', { groups: groups.map((g) => ({ id: g.id, name: sanitizeDisplayText(g.name) })) });
  }
  throw new PolicyError(d.code, 'self.delete');
}

/** UPDATE ที่มีเงื่อนไขไม่ได้แถว — วินิจฉัยใหม่ภายในธุรกรรม (ยังไม่มีอะไรถูกเขียน → rollback ไม่เสียอะไร) */
async function whyDeleteRejected(tx: DbOrTx, actor: Actor, userId: string): Promise<Error> {
  const row = await findUserById(tx, userId);
  if (!row || row.status !== 'active') return new AppError('AUTH_REQUIRED');
  if (row.isAdmin) return new AppError('FORBIDDEN');
  try {
    transferRequired(actor, await listLiveGroupsAdminedBy(tx, userId));
  } catch (e) {
    return e as Error;
  }
  return new AppError('CONFLICT');
}

export async function deleteMe(actor: Actor, input: DeleteMeInput, ctx: AuthCtx): Promise<{ deleted: true; cookies: AuthCookie[] }> {
  // ด่านบัญชี (anonymous / suspended / must_change_pin) + super admin → 403 · กฎ D8 ตัดสินต่อด้วยข้อมูลจริงด้านล่าง
  authorize(actor, 'self.delete', { type: 'self', holdsGroupAdmin: false });
  const me = asUser(actor);
  const { db, now } = ctx;

  transferRequired(actor, await listLiveGroupsAdminedBy(db, me.id));

  const pepperCtx = await requirePepper(db, now, ctx.pepperSource);
  if (!isPinFormat(input.pin)) throw new AppError('PIN_FORMAT');
  const row = await findUserById(db, me.id);
  if (!row || row.status !== 'active') throw new AppError('AUTH_REQUIRED');
  const pepper = row.pinHash ? pepperOfVersion(pepperCtx, row.pinPepperVersion) : null;
  if (row.pinHash && !pepper) throw new AppError('AUTH_MAINTENANCE'); // ก่อนจอง — ไม่นับ (เหมือน login / เปลี่ยน PIN)

  // กัน session ที่ถูกขโมยเดา PIN: ตัวนับเดียวกับ login (ล็อกแล้ว = LOGIN_LOCKED ไม่ verify)
  const throttleKey = usernameThrottleKey(row.usernameNormalized);
  // การเขียนตัวนับผ่านคิวเดียวกับธุรกรรมอื่นใน process (serialized) — ไม่ชนล็อกกับธุรกรรมที่กำลังเขียนอยู่ (เช่น โอน admin พร้อมกัน)
  const attempt = await serialized(db, async () => reserveUsernameSlot(await reserveIpSlot(db, ctx.req, ctx.appSecret, throttleKey, now)));
  const ok = row.pinHash && pepper ? await verifyPin(input.pin, row.pinHash, pepper.secret) : await verifyDummy(input.pin);
  if (!ok) throw await serialized(db, () => failedAttempt(attempt));
  await serialized(db, () => succeededAttempt(attempt));

  await inTx(db, async (tx) => {
    if (!(await markUserDeletedGuarded(tx, me.id, now))) throw await whyDeleteRejected(tx, actor, me.id);
    await purgeDeletedUserFootprint(tx, { userId: me.id, loginThrottleKey: throttleKey }, now);
    // meta ไม่มีชื่อ/username/PIN (R5_CONTRACT §2 ข้อ 2)
    await insertAuditLog(tx, { id: newId(), actorId: me.id, action: 'user.delete', targetType: 'user', targetId: me.id, meta: null }, now);
  });
  return { deleted: true, cookies: [clearSessionCookie()] };
}
