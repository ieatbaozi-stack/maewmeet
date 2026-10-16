// POST /api/prefs — {locale?, theme?} → cookie mm_locale / mm_theme (1 ปี, SameSite=Lax, Secure) · R0_CONTRACT §3
// ค่านอกชุด → VALIDATION (wrapper) · HttpOnly ตาม ADR 0008 §1 (เซิร์ฟเวอร์อ่านใน root layout/i18n request — JS ไม่ต้องอ่าน)
import { PREFS_COOKIE_MAX_AGE_SEC, prefsInputSchema, setPrefs } from '@/lib/data/services/prefs';
import { reply, route } from '../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/prefs',
  input: prefsInputSchema,
  handler: ({ actor, input }) => {
    const { applied, cookies } = setPrefs(actor, input);
    return reply(applied, {
      cookies: cookies.map((c) => ({
        ...c,
        path: '/',
        maxAgeSec: PREFS_COOKIE_MAX_AGE_SEC,
        sameSite: 'Lax' as const,
        secure: true,
        httpOnly: true,
      })),
    });
  },
});
