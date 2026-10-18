// POST /api/auth/login — U1, U2, U3 · ADR 0002 §3 (throttle) · §5 (123456) · §7 (pepper)
//
// ลำดับ (ตายตัว):
//   authorize → pepper ทั้งระบบ (AUTH_MAINTENANCE — ก่อนนับอะไรทั้งนั้น) → หา user (อ่านอย่างเดียว) →
//   pepper ของเวอร์ชันผู้ใช้นี้หาย? (AUTH_MAINTENANCE เฉพาะกลุ่มนั้น ไม่นับ) →
//   จอง IP (อะตอมมิก · เต็ม = RATE_LIMITED ไม่ verify) → [123456 + คำขอ approved + คุกกี้เครื่องตรง = ข้ามล็อก username (S3)] →
//   จอง username (อะตอมมิก · ล็อกอยู่ = LOGIN_LOCKED ไม่ verify ไม่นับ คืนช่อง IP — S1) →
//   verify เสมอ (ไม่มีผู้ใช้/ไม่มี pin_hash = verify หลอกให้เวลาเท่ากัน) → ผิด: ตอบจากแถวที่จอง (นับไปแล้วตอนจอง) · ถูก: คืนช่อง IP + ล้างตัวนับ + session
// ทุกกรณีที่ผิดตอบรหัสเดียว INVALID_CREDENTIALS + attemptsRemaining (username ไม่มี = PIN ผิด ทุกไบต์)
import { z } from 'zod';
import { findUserByUsernameNormalized, rehashUserPin, setMustChangePin, type UserRow } from '@/lib/data/repos/user';
import { insertNotification } from '@/lib/data/repos/notification';
import { cancelPendingPinResetOfUser, findUsableApprovedPinReset, markPinResetUsed, type PinResetRow } from '@/lib/data/repos/pin-reset-request';
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
  readResetDevice,
  sessionUserDto,
  type AuthCookie,
  type SessionIssue,
  type SessionUserDto,
} from '../session';
import { safeEqualHex, sha256Hex } from '../tokens';
import {
  failedAttempt,
  releaseIpSlot,
  reserveIpSlot,
  reserveUsernameSlot,
  succeededAttempt,
  usernameThrottleKey,
} from '../throttle';
import { isSqliteBusy, pinField, prefsCookies } from './shared';

/** user สมมติ (ไม่มีจริง) — ให้ query ของบัญชีที่ไม่มีทำงานเท่ากับบัญชีจริงบนเส้นทาง 123456 */
const GHOST_USER_ID = '00000000-0000-0000-0000-000000000000';

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

  // ── จองก่อน verify (S1): IP แล้ว username — ถูกปฏิเสธ = ไม่ verify เลย · ดู throttle.ts ──
  const throttleKey = usernameThrottleKey(usernameNormalized);
  let attempt = await reserveIpSlot(db, ctx.req, ctx.appSecret, throttleKey, now);

  // เส้นทาง 123456: คำขอ reset ที่อนุมัติ + คุกกี้เครื่องตรง = ปัจจัยยืนยัน → ข้ามล็อก username ได้ (S3) แต่ยังกินโควตา IP
  // บัญชีไม่มีจริงก็ทำงานเท่ากัน (query/expire เดียวกันกับ user สมมติ) — ตอบเหมือนกัน
  let resetRequest: PinResetRow | null = null;
  if (input.pin === RESET_PIN) {
    const found = await findUsableApprovedPinReset(db, live?.id ?? GHOST_USER_ID, now);
    const device = readResetDevice(ctx.req, ctx.appSecret);
    if (live && found && device && safeEqualHex(sha256Hex(device.token), found.deviceTokenHash)) resetRequest = found;
  }
  if (!resetRequest) attempt = await reserveUsernameSlot(attempt);

  // ── ตรวจ credential (ยังไม่มี side effect นอกจากที่จองไว้) ──
  let credential: Credential | null = null;
  if (resetRequest && live) {
    credential = { kind: 'reset', userId: live.id, requestId: resetRequest.id };
  } else if (input.pin === RESET_PIN) {
    await verifyDummy(input.pin); // เวลาตอบใกล้เคียงกรณี PIN ผิดทั่วไป
  } else if (live?.pinHash) {
    const pepper = pepperOfVersion(pepperCtx, live.pinPepperVersion)!;
    if (await verifyPin(input.pin, live.pinHash, pepper.secret)) credential = { kind: 'normal', userId: live.id };
  } else {
    await verifyDummy(input.pin);
  }

  if (!credential || !live) throw await failedAttempt(attempt);

  // credential ถูกต้อง: ระงับบัญชีบอกเฉพาะตอนนี้ (ไม่เปิดช่องไล่ชื่อ) · ผู้ถือ credential จริง → ไม่นับเป็นความผิด
  if (live.status === 'suspended') {
    await succeededAttempt(attempt);
    throw new AppError('ACCOUNT_SUSPENDED');
  }

  const cookies: AuthCookie[] = [];
  const cred: Credential = credential;

  let session: SessionIssue;
  if (cred.kind === 'reset') {
    // S7: ใช้ reset = ธุรกรรมเดียว (ยึดสิทธิ์ approved→used + must_change_pin + session + ล้างตัวนับ) — สำเร็จพร้อมกันหรือไม่เลย
    // ใช้ได้ครั้งเดียว: UPDATE … WHERE status='approved' AND now < expires_at RETURNING — คนแพ้ได้ null (ไม่เขียนอะไร)
    const issued = await db
      .transaction(async (tx) => {
        const used = await markPinResetUsed(tx, cred.requestId, now);
        if (!used) return null;
        await setMustChangePin(tx, live.id, true, now);
        await succeededAttempt(attempt, tx);
        return issueSession(tx, live.id, ctx.req.headers.get('user-agent'), now);
      })
      .catch(async (e: unknown) => {
        if (!isSqliteBusy(e)) throw e;
        // เขียนชนกัน: ธุรกรรม rollback ทั้งก้อน (ยังไม่ใช้คำขอ) → 409 ให้ลองใหม่ · คืนช่อง IP ที่จองไว้
        await releaseIpSlot(attempt).catch(() => undefined);
        throw new AppError('CONFLICT');
      });
    if (!issued) throw await failedAttempt(attempt);
    session = issued;
  } else {
    // ไม่ใช้ interactive transaction ในเส้นทางปกติ (ลดการชนกันของการเขียนพร้อมกัน)
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
    await succeededAttempt(attempt);
    session = await issueSession(db, live.id, ctx.req.headers.get('user-agent'), now);
  }

  cookies.push(session.cookie);
  if (cred.kind === 'reset') cookies.push(clearResetCookie());
  const fresh = (await findUserByUsernameNormalized(db, usernameNormalized)) ?? live;
  cookies.push(...prefsCookies(fresh));
  return { user: sessionUserDto(fresh), cookies };
}
