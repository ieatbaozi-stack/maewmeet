// POST /api/auth/login — U1, U2, U3 · ADR 0002 §3 (throttle) · §5 (123456) · §7 (pepper)
//
// ลำดับ (ตายตัว):
//   authorize → pepper ทั้งระบบ (AUTH_MAINTENANCE — ก่อนนับอะไรทั้งนั้น) → หา user (อ่านอย่างเดียว) →
//   pepper ของเวอร์ชันผู้ใช้นี้หาย? (AUTH_MAINTENANCE เฉพาะกลุ่มนั้น ไม่นับ) → IP bucket (นับเฉพาะที่ผิด) →
//   username ล็อกอยู่? (LOGIN_LOCKED — PIN ถูกก็ไม่ให้เข้า · ไม่ verify · ไม่นับเพิ่ม) →
//   verify เสมอ (ไม่มีผู้ใช้/ไม่มี pin_hash = verify หลอกให้เวลาเท่ากัน) → ผิด: นับ + ตอบ · ถูก: เปลี่ยนสถานะ + session
// ทุกกรณีที่ผิดตอบรหัสเดียว INVALID_CREDENTIALS + attemptsRemaining (username ไม่มี = PIN ผิด ทุกไบต์)
import { z } from 'zod';
import { findUserByUsernameNormalized, rehashUserPin, setMustChangePin, type UserRow } from '@/lib/data/repos/user';
import { insertNotification } from '@/lib/data/repos/notification';
import { cancelPendingPinResetOfUser, findUsableApprovedPinReset, markPinResetUsed } from '@/lib/data/repos/pin-reset-request';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import type { AuthCtx } from '../context';
import { currentPepper, pepperOfVersion, requirePepper } from '../pepper';
import { hashPin, verifyDummy, verifyPin } from '../pin';
import { isPinFormat, normalizeUsername, RESET_PIN, USERNAME_MAX_INPUT } from '../pin-rules';
import {
  clearResetCookie,
  issueSession,
  readResetDeviceToken,
  sessionUserDto,
  type AuthCookie,
  type SessionUserDto,
} from '../session';
import { safeEqualHex, sha256Hex } from '../tokens';
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
import { pinField, prefsCookies } from './shared';

export const loginInputSchema = z
  .object({ username: z.string().min(1).max(USERNAME_MAX_INPUT), pin: pinField })
  .strict();
export type LoginInput = z.output<typeof loginInputSchema>;

export type LoginResult = { user: SessionUserDto; cookies: AuthCookie[] };

type Credential =
  | { kind: 'normal'; userId: string }
  | { kind: 'reset'; userId: string; requestId: string };

export async function login(actor: Actor, input: LoginInput, ctx: AuthCtx): Promise<LoginResult> {
  authorize(actor, 'auth.login', { type: 'none' });
  const { db, now } = ctx;
  const pepperCtx = await requirePepper(db, now, ctx.pepperSource);

  // PIN ที่ไม่ใช่ 6 หลักไม่มีทางถูก — ปฏิเสธโดยไม่ verify/ไม่นับ (ไม่เกี่ยวกับว่ามีบัญชีหรือไม่)
  if (!isPinFormat(input.pin)) throw new AppError('PIN_FORMAT');

  const usernameNormalized = normalizeUsername(input.username);
  const user = await findUserByUsernameNormalized(db, usernameNormalized);
  const live: UserRow | null = user && user.status !== 'deleted' ? user : null;

  if (live?.pinHash && !pepperOfVersion(pepperCtx, live.pinPepperVersion)) {
    // pepper ของเวอร์ชันที่ผู้ใช้นี้ถูก hash หายจาก env → ไม่นับผิด (ADR 0002 §7.2 แถวสุดท้าย)
    throw new AppError('AUTH_MAINTENANCE');
  }

  const ipId = ipHashOf(ctx.req, ctx.appSecret);
  await assertRateNotFull(db, RATE_LIMITS.loginIp, ipId, now);
  const throttleKey = usernameThrottleKey(usernameNormalized);
  await assertNotLocked(db, throttleKey, now);

  // ── ตรวจ credential (ยังไม่มี side effect) ──
  let credential: Credential | null = null;
  if (input.pin === RESET_PIN) {
    const req = live ? await findUsableApprovedPinReset(db, live.id, now) : null;
    const device = readResetDeviceToken(ctx.req);
    if (live && req && device && safeEqualHex(sha256Hex(device), req.deviceTokenHash)) {
      credential = { kind: 'reset', userId: live.id, requestId: req.id };
    } else {
      await verifyDummy(input.pin); // เวลาตอบใกล้เคียงกรณี PIN ผิดทั่วไป
    }
  } else if (live?.pinHash) {
    const pepper = pepperOfVersion(pepperCtx, live.pinPepperVersion)!;
    if (await verifyPin(input.pin, live.pinHash, pepper.secret)) credential = { kind: 'normal', userId: live.id };
  } else {
    await verifyDummy(input.pin);
  }

  if (!credential || !live) {
    await countRate(db, RATE_LIMITS.loginIp, ipId, now);
    throw await failureOutcome(db, throttleKey, now);
  }

  // credential ถูกต้อง: ระงับบัญชีบอกเฉพาะตอนนี้ (ไม่เปิดช่องไล่ชื่อ)
  if (live.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED');

  const cookies: AuthCookie[] = [];
  const cred: Credential = credential;

  // ไม่ใช้ interactive transaction ใน login (ลดการชนกันของการเขียนพร้อมกัน): ขั้น "ยึดสิทธิ์" เป็น UPDATE อะตอมมิกเดียว
  if (cred.kind === 'reset') {
    // ใช้ได้ครั้งเดียว: approved → used (UPDATE … WHERE status='approved' AND now < expires_at RETURNING) — คนแพ้ได้ null
    const used = await markPinResetUsed(db, cred.requestId, now);
    if (!used) {
      await countRate(db, RATE_LIMITS.loginIp, ipId, now);
      throw await failureOutcome(db, throttleKey, now);
    }
    await setMustChangePin(db, live.id, true, now);
  } else {
    const pepper = pepperOfVersion(pepperCtx, live.pinPepperVersion)!;
    if (pepper.version !== pepperCtx.currentVersion && live.pinHash) {
      // §7.3: login สำเร็จด้วยเวอร์ชันเก่า → rehash ด้วยเวอร์ชันปัจจุบันใน request เดียวกัน (เขียนเมื่อ hash เดิมยังไม่ถูกเปลี่ยน)
      const cur = currentPepper(pepperCtx);
      const next = await hashPin(input.pin, cur);
      await rehashUserPin(db, live.id, live.pinHash, { pinHash: next, pinPepperVersion: cur.version }, now);
    }
    // PIN เดิมถูก ระหว่างมีคำขอ pending → ยกเลิก + แจ้ง (U2 AC)
    const cancelled = await cancelPendingPinResetOfUser(db, live.id, now);
    if (cancelled) {
      await insertNotification(db, { id: newId(), userId: live.id, kind: 'pin_reset.cancelled_by_login' }, now);
    }
  }
  await clearFailures(db, throttleKey, now);
  const session = await issueSession(db, live.id, ctx.req.headers.get('user-agent'), now);

  cookies.push(session.cookie);
  if (cred.kind === 'reset') cookies.push(clearResetCookie());
  const fresh = (await findUserByUsernameNormalized(db, usernameNormalized)) ?? live;
  cookies.push(...prefsCookies(fresh));
  return { user: sessionUserDto(fresh), cookies };
}
