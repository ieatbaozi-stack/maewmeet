// ขอ reset PIN (ไม่ต้องล็อกอิน) + สถานะตาม cookie ของเครื่อง — U2 · ADR 0002 §5–§6
// หลักการ: ตอบเหมือนกันทุกกรณี (มี/ไม่มี username · โดนจำกัด · มีคำขอเปิดอยู่) รวม Set-Cookie ของ mm_reset
import { z } from 'zod';
import {
  createPendingPinReset,
  findLatestPinResetByDevice,
} from '@/lib/data/repos/pin-reset-request';
import { findUserByUsernameNormalized } from '@/lib/data/repos/user';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { newId } from '@/lib/shared/id';
import type { AuthCtx } from '../context';
import { normalizeUsername, USERNAME_MAX_INPUT } from '../pin-rules';
import { countryOf, summarizeUserAgent } from '../request';
import { readResetDeviceToken, resetCookie, type AuthCookie } from '../session';
import { newDeviceToken, sha256Hex } from '../tokens';
import { hitRate, ipHashOf, RATE_LIMITS } from '../throttle';

export const pinResetRequestSchema = z.object({ username: z.string().min(1).max(USERNAME_MAX_INPUT) }).strict();
export type PinResetRequestInput = z.output<typeof pinResetRequestSchema>;

export async function requestPinReset(
  actor: Actor,
  input: PinResetRequestInput,
  ctx: AuthCtx,
): Promise<{ accepted: true; cookies: AuthCookie[] }> {
  authorize(actor, 'auth.pinReset.request', { type: 'none' });
  const { db, now } = ctx;
  const usernameNormalized = normalizeUsername(input.username);

  // คุกกี้ผูกเครื่อง: ตั้งเสมอ แม้ไม่มี username นี้ · เครื่องที่มีอยู่แล้วใช้ token เดิม (กดซ้ำไม่ทำให้คำขอที่ค้างหลุดจากเครื่อง)
  const device = readResetDeviceToken(ctx.req) ?? newDeviceToken();
  const cookies = [resetCookie(device)];

  // นับทั้งสองถังทุกครั้ง (มีบัญชีหรือไม่ก็ตาม) — เกิน = เงียบ ไม่สร้างคำขอ แต่ตอบเหมือนเดิม
  const ip = await hitRate(db, RATE_LIMITS.resetIp, ipHashOf(ctx.req, ctx.appSecret), now);
  const perUser = await hitRate(db, RATE_LIMITS.resetUser, sha256Hex(usernameNormalized).slice(0, 32), now);
  if (ip.exceeded || perUser.exceeded) return { accepted: true, cookies };

  const user = await findUserByUsernameNormalized(db, usernameNormalized);
  if (user && user.status === 'active') {
    // มีคำขอเปิดอยู่แล้ว (partial unique) → null → ไม่สร้างแถวใหม่ (ตอบเหมือนเดิม)
    await createPendingPinReset(
      db,
      {
        id: newId(),
        userId: user.id,
        deviceTokenHash: sha256Hex(device),
        requesterUa: summarizeUserAgent(ctx.req.headers.get('user-agent')),
        requesterCountry: countryOf(ctx.req),
      },
      now,
    );
  }
  return { accepted: true, cookies };
}

export type PinResetStatus =
  | { status: 'none' }
  | { status: 'pending' }
  | { status: 'approved'; expiresAt: number }
  | { status: 'closed' };

/**
 * สถานะคำขอที่ผูกกับเครื่องนี้ (จาก cookie mm_reset) — ไม่รับ username จึงถามไล่ชื่อไม่ได้
 *  - ไม่มี cookie → none (ฝั่ง client รู้เองอยู่แล้วว่าไม่มี cookie)
 *  - มี cookie แต่ไม่มีแถว (username ไม่มีจริง / โดนจำกัด) → pending ตลอด ไม่รั่วข้อมูล
 */
export async function getPinResetStatus(actor: Actor, ctx: AuthCtx): Promise<PinResetStatus> {
  authorize(actor, 'auth.pinReset.status', { type: 'none' });
  const device = readResetDeviceToken(ctx.req);
  if (!device) return { status: 'none' };
  const row = await findLatestPinResetByDevice(ctx.db, sha256Hex(device), ctx.now);
  if (!row) return { status: 'pending' };
  if (row.status === 'pending') return { status: 'pending' };
  if (row.status === 'approved' && row.expiresAt !== null) return { status: 'approved', expiresAt: row.expiresAt };
  return { status: 'closed' };
}
