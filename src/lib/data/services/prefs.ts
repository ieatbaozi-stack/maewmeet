// service: ตั้งค่าภาษา/ธีมเป็น cookie (ก่อนล็อกอิน / ระหว่าง must_change_pin) — R0_CONTRACT §3 · ADR 0008 · action `prefs.cookie.set`
// R15b §4: ล็อกอินอยู่ + ส่ง locale → บันทึก user.locale ด้วย (ป้ายในปฏิทิน/LINE ใช้ภาษาถูก) — saveAccountLocale · theme ยังเป็นคุกกี้อย่างเดียว
// R16 H2: ล็อกอินอยู่ → นับถัง prefs:update (60/10 นาที) ก่อนตั้งคุกกี้/เขียน DB — takePrefsSlot · ไม่ได้ล็อกอินไม่นับ
import { z } from 'zod';
import { takeResolvedSessionUser } from '@/lib/auth/session';
import { updateUserLocaleIfActive } from '@/lib/data/repos/user';
import { authorize } from '@/lib/rbac/can';
import { PREFS_RATE_LIMIT } from '@/lib/shared/limits';
import { takeUserSlot } from '../admin-input';
import type { DataCtx } from '../context';
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

/**
 * R15b §4: เรียกหลัง setPrefs (ด่าน prefs.cookie.set ผ่านแล้ว) — ไม่ได้ล็อกอิน / ไม่ส่ง locale / บัญชีไม่ active → ไม่แตะ DB
 * ค่าเท่าเดิม (จากแถวที่ session อ่านมาแล้วใน request นี้) → ไม่เขียน · ค่า locale ผ่าน zod enum มาแล้ว (th|en เท่านั้น)
 */
export async function saveAccountLocale(actor: Actor, input: PrefsInput, ctx: DataCtx): Promise<void> {
  authorize(actor, 'prefs.cookie.set', { type: 'none' });
  if (actor.kind !== 'user' || actor.status !== 'active' || input.locale === undefined) return;
  const cached = takeResolvedSessionUser(ctx.req);
  if (cached && cached.id === actor.id && cached.locale === input.locale) return;
  await updateUserLocaleIfActive(ctx.db, actor.id, input.locale, ctx.now);
}

/**
 * R16 H2 (security R15b Info 5): ผู้ใช้ที่ล็อกอินอยู่ — นับ 1 ครั้งต่อคำขอ (UPSERT อะตอมมิก) · เกิน → RATE_LIMITED + Retry-After (ยังไม่ตั้งคุกกี้/ไม่เขียน DB)
 * ไม่ได้ล็อกอิน (หน้า login/signup/forgot) ไม่นับ — ไม่มีตัวตนให้ผูกถัง และคำขอนั้นตั้งแค่คุกกี้ ไม่แตะ DB
 * เรียกหลัง setPrefs (ด่าน prefs.cookie.set ผ่านแล้ว) — คุกกี้ภาษา/ธีมเดิมของผู้ใช้ไม่ถูกแตะเมื่อโดน 429 (หน้ายังแสดงตามค่าเดิม)
 */
export async function takePrefsSlot(actor: Actor, ctx: DataCtx): Promise<void> {
  authorize(actor, 'prefs.cookie.set', { type: 'none' });
  if (actor.kind !== 'user') return;
  await takeUserSlot(ctx.db, PREFS_RATE_LIMIT, actor.id, ctx.now);
}
