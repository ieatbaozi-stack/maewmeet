// POST /api/auth/signup — U1 · ADR 0002 §2–§3
// ลำดับ: authorize → pepper (AUTH_MAINTENANCE ก่อนนับอะไร) → ตรวจรูปแบบ (ไม่นับ) → rate limit IP 5/ชม. → hash → insert → session
import { z } from 'zod';
import { findUserById, insertUser } from '@/lib/data/repos/user';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { checkDisplayName } from '@/lib/shared/name-rules';
import type { AuthCtx } from '../context';
import { assertAcceptableNewPin, DISPLAY_NAME_MAX, parseNewUsername, USERNAME_MAX_INPUT } from '../pin-rules';
import { currentPepper, requirePepper } from '../pepper';
import { hashPin } from '../pin';
import { issueSession, sessionUserDto, type AuthCookie, type SessionUserDto } from '../session';
import { hitRateOrThrow, ipHashOf, ipRateSpec, RATE_LIMITS } from '../throttle';
import { pinField, prefsCookies, prefsFromCookies } from './shared';

export const signupInputSchema = z
  .object({
    username: z.string().min(1).max(USERNAME_MAX_INPUT),
    displayName: z.string().min(1).max(200),
    pin: pinField,
    pinConfirm: pinField,
  })
  .strict();
export type SignupInput = z.output<typeof signupInputSchema>;

export type SignupResult = { user: SessionUserDto; cookies: AuthCookie[] };

export async function signup(actor: Actor, input: SignupInput, ctx: AuthCtx): Promise<SignupResult> {
  authorize(actor, 'auth.signup', { type: 'none' });
  const { db, now } = ctx;
  const pepperCtx = await requirePepper(db, now, ctx.pepperSource);

  const { username, usernameNormalized } = parseNewUsername(input.username);
  // กติกาตัวอักษรเดียวกับชื่อกลุ่ม (bidi/zero-width/ตัวมองไม่เห็น/ตัวควบคุม/เครื่องหมายผสมเกิน → INVALID)
  const checked = checkDisplayName(input.displayName, { min: 1, max: DISPLAY_NAME_MAX }); // + ห้ามป้ายของระบบ (R5 Sec L5)
  if (!checked.ok) throw new AppError('VALIDATION', { fields: { displayName: checked.reason } });
  const displayName = checked.name;
  assertAcceptableNewPin(input.pin);
  if (input.pin !== input.pinConfirm) throw new AppError('PIN_MISMATCH');

  await hitRateOrThrow(db, ipRateSpec(RATE_LIMITS.signupIp, ctx.req), ipHashOf(ctx.req, ctx.appSecret), now);

  const pepper = currentPepper(pepperCtx);
  const pinHash = await hashPin(input.pin, pepper);
  const id = newId();
  const created = await insertUser(
    db,
    {
      id,
      username,
      usernameNormalized,
      displayName,
      pinHash,
      pinPepperVersion: pepper.version,
      ...prefsFromCookies(ctx.req),
    },
    now,
  );
  if (!created) throw new AppError('USERNAME_TAKEN');

  const session = await issueSession(db, created.id, ctx.req.headers.get('user-agent'), now);
  const row = (await findUserById(db, created.id)) ?? created;
  return {
    user: sessionUserDto(row),
    cookies: [session.cookie, ...prefsCookies(row)],
  };
}
