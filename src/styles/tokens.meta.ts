/**
 * ค่าสีที่ต้องใช้นอก CSS (ใช้ CSS var ไม่ได้) — เจ้าของ: UX & Brand
 * - `<meta name="theme-color">` 2 ตัวตาม ADR 0008 §4 (แถบเบราว์เซอร์มือถือ)
 * ต้องเท่ากับ `--bg` ของแต่ละธีมใน tokens.css — docs/design/tools/contrast.mjs ตรวจให้ (exit 1 ถ้าไม่ตรง)
 *
 * ตัวอย่างใน root layout (Front-end):
 *   export const viewport: Viewport = { themeColor: [
 *     { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
 *     { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark } ] };
 */
export const THEME_COLOR = {
  light: '#FAF8F5',
  dark: '#17161C',
} as const;
