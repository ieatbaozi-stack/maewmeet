// ค่าภาษา/ธีมฝั่ง UI — ADR 0008 · ต้องตรงกับ src/lib/data/services/prefs.ts (Platform) ที่ตั้ง cookie
// แยกไฟล์เพื่อไม่ให้ client bundle ดึง zod/rbac จาก service มาด้วย

export const LOCALES = ["th", "en"] as const;
export const THEMES = ["system", "light", "dark"] as const;
export type Locale = (typeof LOCALES)[number];
export type Theme = (typeof THEMES)[number];

export const DEFAULT_LOCALE: Locale = "th";
export const DEFAULT_THEME: Theme = "system";

export const LOCALE_COOKIE = "mm_locale";
export const THEME_COOKIE = "mm_theme";

/** ค่าอื่น/ไม่มี → th (ADR 0008 §1: ไม่อ่าน Accept-Language) */
export function parseLocale(raw: string | undefined): Locale {
  return raw === "en" ? "en" : DEFAULT_LOCALE;
}

/** ค่าอื่น/ไม่มี → system */
export function parseTheme(raw: string | undefined): Theme {
  return raw === "light" || raw === "dark" ? raw : DEFAULT_THEME;
}
