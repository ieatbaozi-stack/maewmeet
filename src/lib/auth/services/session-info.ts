// logout · logout-all · GET session — U1, U13 (ARCHITECTURE §5)
import type { Db } from '@/db/client';
import { findUserById } from '@/lib/data/repos/user';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import type { AuthCtx } from '../context';
import { userIdOf } from './shared';
import {
  clearSessionCookie,
  logoutSession,
  readSessionId,
  revokeAllSessions,
  sessionUserDto,
  takeRenewedSessionCookie,
  type AuthCookie,
  type SessionUserDto,
} from '../session';

/** POST /api/auth/logout — ลบ session ปัจจุบัน (idempotent) · ใช้ได้ระหว่าง must_change_pin */
export async function logout(actor: Actor, ctx: AuthCtx): Promise<{ cookies: AuthCookie[] }> {
  authorize(actor, 'auth.logout', { type: 'none' });
  const sessionId = readSessionId(ctx.req);
  if (sessionId) await logoutSession(ctx.db, sessionId);
  return { cookies: [clearSessionCookie()] };
}

/** POST /api/auth/logout-all — ลบทุก session ของตัวเอง (รวมเครื่องนี้) */
export async function logoutAll(actor: Actor, ctx: AuthCtx): Promise<{ revoked: number; cookies: AuthCookie[] }> {
  authorize(actor, 'self.session.revokeAll', { type: 'none' });
  const userId = userIdOf(actor);
  const revoked = await revokeAllSessions(ctx.db, userId);
  return { revoked, cookies: [clearSessionCookie()] };
}

/** GET /api/auth/session — ข้อมูลผู้ใช้ปัจจุบัน (อ่านสดจาก DB) · ส่งคุกกี้ session ใหม่ถ้าเพิ่งต่ออายุ */
export async function getSessionInfo(
  actor: Actor,
  ctx: AuthCtx,
): Promise<{ user: SessionUserDto; cookies: AuthCookie[] }> {
  authorize(actor, 'self.read', { type: 'none' });
  const userId = userIdOf(actor);
  const row = await loadUser(ctx.db, userId);
  const renewed = takeRenewedSessionCookie(ctx.req);
  return { user: sessionUserDto(row), cookies: renewed ? [renewed] : [] };
}

async function loadUser(db: Db, userId: string) {
  const row = await findUserById(db, userId);
  if (!row) throw new AppError('AUTH_REQUIRED');
  return row;
}
