// session: cookie + token→SHA-256 + getActor — ADR 0002 §4
//  - cookie `__Host-mm_session` (prod; dev/test ใช้ `mm_session`) · HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=60 วัน
//  - DB เก็บเฉพาะ SHA-256(token) เป็น session.id · อ่าน session = JOIN เดียว ดึง status/is_admin/must_change_pin **สดทุก request**
//    (ไม่ cache สิทธิ์ใน cookie/instance — is_admin ตั้งด้วย SQL แล้วมีผลทันที และเรียกคืนก็ทันที)
import { getDb, type Db, type DbOrTx } from '@/db/client';
import type { GetActor } from '@/app/api/_lib/actor';
import {
  deleteAllSessionsOfUser,
  deleteOtherSessionsOfUser,
  deleteSession,
  findSessionWithUser,
  insertSession,
  insertSessionIfUserActive,
  SESSION_TTL_MS,
  touchSession,
  type SessionWithUser,
} from '@/lib/data/repos/session';
import type { Actor, UserActor } from '@/lib/rbac/types';
import { clock } from '@/lib/shared/clock';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import { readCookie } from './request';
import { newSessionToken, parseDeviceCookie, sha256Hex, type ParsedDeviceCookie } from './tokens';

export const SESSION_COOKIE_PROD = '__Host-mm_session';
export const SESSION_COOKIE_DEV = 'mm_session';
export const RESET_COOKIE_PROD = '__Host-mm_reset';
export const RESET_COOKIE_DEV = 'mm_reset';

export const SESSION_MAX_AGE_SEC = SESSION_TTL_MS / 1000;
export const RESET_COOKIE_MAX_AGE_SEC = 8 * 24 * 60 * 60;

/** ชื่อแบบ `__Host-` ใช้เมื่อ NODE_ENV=production (Vercel ทั้ง production/preview) · dev/test ใช้ชื่อสั้น (ADR 0002 §4) */
const isProd = (): boolean => process.env.NODE_ENV === 'production';
export const sessionCookieName = (): string => (isProd() ? SESSION_COOKIE_PROD : SESSION_COOKIE_DEV);
export const resetCookieName = (): string => (isProd() ? RESET_COOKIE_PROD : RESET_COOKIE_DEV);

/** รูปเดียวกับ CookieSpec ของ route wrapper (ใช้ผ่าน `reply({cookies})` ได้ตรง ๆ) */
export type AuthCookie = {
  name: string;
  value: string;
  maxAgeSec: number;
  path: '/';
  sameSite: 'Lax';
  secure: true;
  httpOnly: true;
};

const cookie = (name: string, value: string, maxAgeSec: number): AuthCookie => ({
  name,
  value,
  maxAgeSec,
  path: '/',
  sameSite: 'Lax',
  secure: true,
  httpOnly: true,
});

export const sessionCookie = (token: string, maxAgeSec = SESSION_MAX_AGE_SEC): AuthCookie =>
  cookie(sessionCookieName(), token, maxAgeSec);
export const clearSessionCookie = (): AuthCookie => cookie(sessionCookieName(), '', 0);
export const resetCookie = (token: string): AuthCookie => cookie(resetCookieName(), token, RESET_COOKIE_MAX_AGE_SEC);
export const clearResetCookie = (): AuthCookie => cookie(resetCookieName(), '', 0);

const TOKEN_SHAPE = /^[a-z2-7]{20,64}$/;

/** token ดิบจาก cookie (รูปไม่ถูก = null โดยไม่แตะ DB) */
export function readSessionToken(req: Request): string | null {
  const v = readCookie(req, sessionCookieName());
  return v && TOKEN_SHAPE.test(v) ? v : null;
}

/** session.id ของ request นี้ = SHA-256(token) · ไม่มี cookie = null */
export function readSessionId(req: Request): string | null {
  const token = readSessionToken(req);
  return token ? sha256Hex(token) : null;
}

/** คุกกี้ reset ของเครื่องนี้ (เซ็นด้วย APP_SECRET) — MAC/รูปผิด = null (ถือว่าไม่มีคุกกี้) */
export function readResetDevice(req: Request, appSecretB64: string): ParsedDeviceCookie | null {
  const v = readCookie(req, resetCookieName());
  return v ? parseDeviceCookie(v, appSecretB64) : null;
}

export type SessionIssue = { token: string; sessionId: string; expiresAt: number; cookie: AuthCookie };

/** สร้าง session ใหม่ (token สุ่ม 20 ไบต์) — คืน token ดิบ **ครั้งเดียว** สำหรับ Set-Cookie */
export async function issueSession(
  db: DbOrTx,
  userId: string,
  userAgent: string | null,
  now: number,
): Promise<SessionIssue> {
  const token = newSessionToken();
  const sessionId = sha256Hex(token);
  const row = await insertSession(db, { id: sessionId, userId, userAgent }, now);
  return { token, sessionId, expiresAt: row.expiresAt, cookie: sessionCookie(token) };
}

/** เหมือน issueSession แต่สร้างเฉพาะเมื่อบัญชียัง active (เงื่อนไขในคำสั่ง INSERT เดียว) · ไม่ active → null (R5 L1/L2) */
export async function issueSessionIfActive(db: DbOrTx, userId: string, userAgent: string | null, now: number): Promise<SessionIssue | null> {
  const token = newSessionToken();
  const sessionId = sha256Hex(token);
  const row = await insertSessionIfUserActive(db, { id: sessionId, userId, userAgent }, now);
  return row ? { token, sessionId, expiresAt: row.expiresAt, cookie: sessionCookie(token) } : null;
}

export const logoutSession = deleteSession;
export const revokeAllSessions = deleteAllSessionsOfUser;
export const revokeOtherSessions = deleteOtherSessionsOfUser;

const ANONYMOUS: Actor = Object.freeze({ kind: 'anonymous' });

export function actorOf(u: SessionWithUser['user']): UserActor {
  return { kind: 'user', id: u.id, isSuperAdmin: u.isAdmin, status: u.status, mustChangePin: u.mustChangePin };
}

// sliding: getActor ต่ออายุแถวใน DB แต่ตั้ง Set-Cookie เองไม่ได้ → เก็บคุกกี้ใหม่ไว้ให้ endpoint ของ auth แนบ (ดู Handoff Q)
const renewed = new WeakMap<Request, AuthCookie>();

/** คุกกี้ session ที่ต้องส่งซ้ำเพราะต่ออายุใน request นี้ (ถ้ามี) */
export function takeRenewedSessionCookie(req: Request): AuthCookie | null {
  return renewed.get(req) ?? null;
}

/** ผลการอ่าน session หนึ่งครั้ง: actor + ข้อมูลผู้ใช้จาก JOIN เดียวกัน (ไม่มี hash/token) · anonymous → user = null */
export type ResolvedSession = {
  readonly actor: Actor;
  readonly user: SessionWithUser['user'] | null;
};

const ANONYMOUS_SESSION: ResolvedSession = Object.freeze({ actor: ANONYMOUS, user: null });

// ผู้ใช้ที่อ่านแล้วใน request นี้ — ผูกกับวัตถุ Request (WeakMap: หายไปพร้อม request · ไม่ข้าม request/ผู้ใช้)
// ให้ service ใน request เดียวกัน (GET /api/auth/session) ไม่ต้อง findUserById ซ้ำหลัง JOIN
const resolvedUsers = new WeakMap<Request, SessionWithUser['user']>();

/** ข้อมูลผู้ใช้ที่ resolveSession/getActor อ่านแล้วกับ Request ตัวนี้ (ถ้ามี) */
export function takeResolvedSessionUser(req: Request): SessionWithUser['user'] | null {
  return resolvedUsers.get(req) ?? null;
}

/**
 * อ่าน session หนึ่งครั้ง: cookie → SHA-256 → findSessionWithUser (JOIN เดียว ข้อมูลสด) → touchSession ≤ 1 ครั้ง
 * ไม่มี/หมดอายุ/รูปผิด/ถูกเพิกถอน/บัญชีถูกลบ → anonymous (ไม่โยน) · ไม่แตะ DB ถ้าไม่มี cookie · ฐานล่ม → โยนต่อ
 * ไม่ memo เอง: API เรียกผ่าน getActor ครั้งเดียวต่อ route · หน้า RSC ใช้ getRequestSession (React.cache ต่อ request — ./page-session)
 */
export async function resolveSession(req: Request): Promise<ResolvedSession> {
  const token = readSessionToken(req);
  if (!token) return ANONYMOUS_SESSION;
  const db: Db = getDb();
  const now = clock.now();
  const found = await findSessionWithUser(db, sha256Hex(token), now);
  if (!found) return ANONYMOUS_SESSION;
  try {
    const touched = await touchSession(db, found.session, now);
    if (touched && touched.expiresAt !== found.session.expiresAt) renewed.set(req, sessionCookie(token));
  } catch {
    // การต่ออายุ/บันทึก last_seen ล้มเหลวไม่ควรทำให้ request ที่ถูกต้องล้ม
  }
  resolvedUsers.set(req, found.user);
  return { actor: actorOf(found.user), user: found.user };
}

/**
 * ตัวหา actor ของ route wrapper (สัญญา GetActor — ดู src/app/api/_lib/actor.ts)
 * ไม่มี/หมดอายุ/รูปผิด → anonymous (ไม่โยน) · พบ → UserActor จาก DB สด · ไม่แตะ DB ถ้าไม่มี cookie
 */
export const getActor: GetActor = async (req) => (await resolveSession(req)).actor;

/** ข้อมูลผู้ใช้ที่ส่งออกจาก GET /api/auth/session, login, signup (ARCHITECTURE §5) — ไม่มี hash/token */
export type SessionUserDto = {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  mustChangePin: boolean;
  locale: 'th' | 'en';
  theme: 'system' | 'light' | 'dark';
};

export function sessionUserDto(u: SessionWithUser['user']): SessionUserDto {
  return {
    id: u.id,
    username: u.username,
    displayName: sanitizeDisplayText(u.displayName),
    isAdmin: u.isAdmin,
    mustChangePin: u.mustChangePin,
    locale: u.locale,
    theme: u.theme,
  };
}
