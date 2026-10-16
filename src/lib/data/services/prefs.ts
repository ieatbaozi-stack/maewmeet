// service: ตั้งค่าภาษา/ธีมเป็น cookie (ก่อนล็อกอิน / ระหว่าง must_change_pin) — R0_CONTRACT §3 · ADR 0008 · action `prefs.cookie.set`
// R1: ถ้า actor ล็อกอินอยู่ ให้บันทึกลง user.locale/theme ด้วย (ตอนนี้ยังไม่มี session)
import { z } from 'zod';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';

export const LOCALES = ['th', 'en'] as const;
export const THEMES = ['system', 'light', 'dark'] as const;
export type Locale = (typeof LOCALES)[number];
export type Theme = (typeof THEMES)[number];

export const LOCALE_COOKIE = 'mm_locale';
export const THEME_COOKIE = 'mm_theme';
export const PREFS_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60; // 1 ปี

export const prefsInputSchema = z
  .object({
    locale: z.enum(LOCALES).optional(),
    theme: z.enum(THEMES).optional(),
  })
  .strict()
  .refine((v) => v.locale !== undefined || v.theme !== undefined, { path: ['_'], message: 'EMPTY' });

export type PrefsInput = z.output<typeof prefsInputSchema>;

export type PrefsCookie = { name: typeof LOCALE_COOKIE | typeof THEME_COOKIE; value: string };

export function setPrefs(actor: Actor, input: PrefsInput): { applied: PrefsInput; cookies: PrefsCookie[] } {
  authorize(actor, 'prefs.cookie.set', { type: 'none' });
  const cookies: PrefsCookie[] = [];
  if (input.locale) cookies.push({ name: LOCALE_COOKIE, value: input.locale });
  if (input.theme) cookies.push({ name: THEME_COOKIE, value: input.theme });
  return { applied: input, cookies };
}
