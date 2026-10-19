// ส่วนร่วมของ service ใน auth
import { z } from 'zod';
import { LOCALES, THEMES, LOCALE_COOKIE, THEME_COOKIE } from '@/lib/data/services/prefs';
import type { SessionWithUser } from '@/lib/data/repos/session';
import type { Actor } from '@/lib/rbac/types';
import { AppError } from '@/lib/shared/errors';
import { readCookie } from '../request';
import type { AuthCookie } from '../session';

export const pinField = z.string().max(32);
export const usernameField = z.string().min(1).max(64);

/** cookie ภาษา/ธีมจากบัญชี (ตั้งตอน login/signup — ARCHITECTURE §5) */
export function prefsCookies(u: Pick<SessionWithUser['user'], 'locale' | 'theme'>): AuthCookie[] {
  const maxAgeSec = 365 * 24 * 60 * 60;
  const mk = (name: string, value: string): AuthCookie => ({
    name,
    value,
    maxAgeSec,
    path: '/',
    sameSite: 'Lax',
    secure: true,
    httpOnly: true,
  });
  return [mk(LOCALE_COOKIE, u.locale), mk(THEME_COOKIE, u.theme)];
}

/** locale/theme จาก cookie ของผู้เยี่ยมชม (ค่านอกชุด = ไม่ใช้) — ใช้ตอนสมัคร */
export function prefsFromCookies(req: Request): { locale?: 'th' | 'en'; theme?: 'system' | 'light' | 'dark' } {
  const locale = readCookie(req, LOCALE_COOKIE);
  const theme = readCookie(req, THEME_COOKIE);
  return {
    ...((LOCALES as readonly string[]).includes(locale ?? '') ? { locale: locale as 'th' | 'en' } : {}),
    ...((THEMES as readonly string[]).includes(theme ?? '') ? { theme: theme as 'system' | 'light' | 'dark' } : {}),
  };
}

/** id ของผู้ใช้ (หลัง authorize() ผ่าน actor ของ action ที่ต้องล็อกอินเป็น user เสมอ — แปลงชนิดให้ compiler) */
export function userIdOf(actor: Actor): string {
  if (actor.kind !== 'user') throw new AppError('AUTH_REQUIRED');
  return actor.id;
}

/** การเขียนชนกันบน SQLite/libSQL (ธุรกรรมอื่นถือล็อกอยู่) — ผู้เรียกแปลงเป็น CONFLICT ให้ลองใหม่ได้ แทนที่จะเป็น 500 */
export function isSqliteBusy(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const o = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof o.code === 'string' && /^SQLITE_(BUSY|LOCKED)/.test(o.code)) return true;
    if (typeof o.message === 'string' && /SQLITE_(BUSY|LOCKED)|database is locked/i.test(o.message)) return true;
    cur = o.cause;
  }
  return false;
}
