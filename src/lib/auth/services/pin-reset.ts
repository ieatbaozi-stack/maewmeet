// ขอ reset PIN (ไม่ต้องล็อกอิน) + สถานะตาม cookie ของเครื่อง — U2 · ADR 0002 §5–§6
// หลักการ: ตอบเหมือนกันทุกกรณี (มี/ไม่มี username · โดนจำกัด · มีคำขอเปิดอยู่) รวม Set-Cookie ของ mm_reset
import { z } from 'zod';
import {
  createPendingPinReset,
  expireDuePinResets,
  findLatestPinResetByDevice,
  findPinResetById,
  PIN_RESET_PENDING_TTL_MS,
} from '@/lib/data/repos/pin-reset-request';
import { findUserByUsernameNormalized } from '@/lib/data/repos/user';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { newId } from '@/lib/shared/id';
import type { AuthCtx } from '../context';
import { normalizeUsername, USERNAME_MAX_INPUT } from '../pin-rules';
import { countryOf, summarizeUserAgent } from '../request';
import { readResetDevice, resetCookie, type AuthCookie } from '../session';
import { newDeviceToken, sha256Hex, signDeviceCookie } from '../tokens';
import { hitRate, ipHashOf, ipRateSpec, RATE_LIMITS } from '../throttle';

export const pinResetRequestSchema = z.object({ username: z.string().min(1).max(USERNAME_MAX_INPUT) }).strict();
export type PinResetRequestInput = z.output<typeof pinResetRequestSchema>;

/** user สมมติ (ไม่มีจริง) — ให้งานฝั่ง DB ของบัญชีที่ไม่มีใกล้เคียงบัญชีจริง (expire UPDATE เดียวกัน) */
const GHOST_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function requestPinReset(
  actor: Actor,
  input: PinResetRequestInput,
  ctx: AuthCtx,
): Promise<{ accepted: true; cookies: AuthCookie[] }> {
  authorize(actor, 'auth.pinReset.request', { type: 'none' });
  const { db, now } = ctx;
  const usernameNormalized = normalizeUsername(input.username);

  // คุกกี้ผูกเครื่อง: ตั้งเสมอ แม้ไม่มี username นี้ · เครื่องที่มีอยู่แล้วใช้ token เดิม (กดซ้ำไม่ทำให้คำขอที่ค้างหลุดจากเครื่อง)
  // เซ็นเวลาออก = now ใหม่ทุกครั้ง (หน้าต่าง "pending 7 วัน" ของสถานะเริ่มนับจากคำขอล่าสุด — ทุกเครื่องเหมือนกัน · ดู getPinResetStatus)
  const token = readResetDevice(ctx.req, ctx.appSecret)?.token ?? newDeviceToken();
  const cookies = [resetCookie(signDeviceCookie(token, now, ctx.appSecret))];

  // นับทั้งสองถังทุกครั้ง (มีบัญชีหรือไม่ก็ตาม) — เกิน = เงียบ ไม่สร้างคำขอ แต่ตอบเหมือนเดิม
  const ip = await hitRate(db, ipRateSpec(RATE_LIMITS.resetIp, ctx.req), ipHashOf(ctx.req, ctx.appSecret), now);
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
        deviceTokenHash: sha256Hex(token),
        requesterUa: summarizeUserAgent(ctx.req.headers.get('user-agent')),
        requesterCountry: countryOf(ctx.req),
      },
      now,
    );
  } else {
    // ทำงานฝั่ง DB ให้ใกล้กัน: บัญชีจริงทำ expire UPDATE (+ INSERT) → บัญชีไม่มีทำ expire UPDATE แบบเดียวกัน
    // (INSERT ไม่เลียนแบบ — ห้ามสร้างแถวสำหรับบัญชีที่ไม่มี · ส่วนต่างเวลา 1 คำสั่งเขียน บันทึกใน ADR 0002 §5)
    await expireDuePinResets(db, now, { userId: GHOST_USER_ID });
  }
  return { accepted: true, cookies };
}

export type PinResetStatus =
  | { status: 'none' }
  | { status: 'pending' }
  | { status: 'approved'; expiresAt: number }
  | { status: 'closed' };

/**
 * สถานะคำขอที่ผูกกับเครื่องนี้ (จาก cookie mm_reset) — ไม่รับ username จึงถามไล่ชื่อไม่ได้ · ADR 0002 §5 (D2/S6)
 * แยกแค่ none | pending | approved | closed และต้อง "เหมือนกัน" ทุกเครื่องที่ขอ ไม่ว่า username มีจริงหรือไม่:
 *  - ไม่มีคุกกี้ (หรือ MAC ผิด) → none
 *  - approved เห็นเฉพาะเครื่องที่ผูกกับคำขอที่ approved และยังไม่หมดอายุ (นี่คือข้อมูลที่เจ้าของบัญชีต้องได้ — ผู้ถามไล่ชื่อไม่มีทางเห็น)
 *  - นอกนั้น = pending จนครบ 7 วันนับจากเวลาออกคุกกี้ (เซ็นอยู่ในคุกกี้เอง) แล้ว closed — ไม่ดูสถานะอื่นของแถวเลย
 *    (rejected / cancelled / expired / ไม่มีแถว = อ่านเหมือน ghost เป๊ะ จึงบอกไม่ได้ว่าบัญชีมีจริง)
 *  - คุกกี้รูป token ล้วน (สคริปต์ break-glass ออกให้) ไม่มีเวลาออก → ปิดเมื่อมีแถวที่ไม่ใช่ pending/approved (เครื่องนี้เป็นเครื่องจริงโดยนิยาม)
 * งาน DB เท่ากันทุกกรณี: query แถวล่าสุดของเครื่อง (+ expire ของแถวนั้น) เสมอ
 */
export async function getPinResetStatus(actor: Actor, ctx: AuthCtx): Promise<PinResetStatus> {
  authorize(actor, 'auth.pinReset.status', { type: 'none' });
  const device = readResetDevice(ctx.req, ctx.appSecret);
  if (!device) return { status: 'none' };
  const row = await findLatestPinResetByDevice(ctx.db, sha256Hex(device.token), ctx.now);
  if (!row) await findPinResetById(ctx.db, GHOST_USER_ID, ctx.now); // ไม่มีแถว (ghost) → ทำ expire+select เหมือนกรณีมีแถว
  if (row?.status === 'approved' && row.expiresAt !== null) return { status: 'approved', expiresAt: row.expiresAt };
  if (device.issuedAtMs === null) return row && row.status !== 'pending' ? { status: 'closed' } : { status: 'pending' };
  return ctx.now >= device.issuedAtMs + PIN_RESET_PENDING_TTL_MS ? { status: 'closed' } : { status: 'pending' };
}
