# ADR 0008 — i18n (TH/EN) และธีม (system/light/dark)

- **Status**: Proposed (Architect, 2026-10-15)
- **เกี่ยวข้อง**: [PRD D14, D15, U14, U15, §7, §8 ข้อ 4.1](../prd/PRD.md) · [UI_DIRECTION](../design/UI_DIRECTION.md) (UX เป็นเจ้าของ tokens/ข้อความ) · [ADR 0004](0004-time-and-timezone.md) (format วันที่) · [ADR 0007](0007-notifications.md)
- **เจ้าของการ implement**: Front-end (`src/i18n/**`, กลไกสลับ) · UX (`messages/*.json` เนื้อหา, `src/styles/tokens*`) · Platform (`/api/prefs`, `user.locale/theme`)

## Context
D14: ไทย+อังกฤษ ดีฟอลต์ไทย สลับได้ จำค่าต่อผู้ใช้ · D15: ตามระบบ/สว่าง/มืด ดีฟอลต์ตามระบบ · PRD §5 (0008): ภาษาเก็บใน cookie/บัญชี ไม่ใส่ใน URL เพราะเป็นแอปหลังล็อกอิน · U15: ห้ามกระพริบธีมผิดตอนโหลด · U14: error จาก API เป็นรหัส UI แปล

## Decision

### 1. ไลบรารี: next-intl 4.14.x แบบ **ไม่มี i18n routing**
ยืนยันจากเอกสารทางการ ["App Router setup without i18n routing"](https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing): ไม่ต้องมี `[locale]` segment, ไม่ต้องมี middleware/proxy · ใช้ `src/i18n/request.ts` (ถูกค้นพบอัตโนมัติ) + `createNextIntlPlugin()` ใน `next.config.ts` · locale อ่านจาก cookie ภายใน `getRequestConfig` · ห่อ `NextIntlClientProvider` ที่ root layout · peerDependency รองรับ `next ^16` (ตรวจ npm 2026-10-15)

```ts
// src/i18n/request.ts — pseudo-code
export default getRequestConfig(async () => {
  const c = await cookies();                                   // Next 16: async
  const raw = c.get('mm_locale')?.value;
  const locale = raw === 'en' ? 'en' : 'th';                   // ดีฟอลต์ไทย (ไม่อ่าน Accept-Language — D14 "ครั้งแรกดีฟอลต์ไทย")
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default,
           timeZone: 'Asia/Bangkok', now: undefined };
});
```
- **แหล่งความจริงตอนเรนเดอร์ = cookie `mm_locale`** (ไม่ query DB ทุก request) · ค่าในบัญชี `user.locale` เป็นค่าถาวร:
  - สมัคร (U1) → `user.locale/theme` เริ่มจากค่า cookie ปัจจุบัน (ผู้ใช้ที่เลือก EN ก่อนสมัครได้บัญชี EN)
  - login สำเร็จ → เซิร์ฟเวอร์ตั้ง cookie `mm_locale`/`mm_theme` จาก `user.locale/theme` (ย้ายเครื่องแล้วค่าตามมา — U14 "ล็อกอินแล้วจำค่าในบัญชี")
  - ล็อกอินอยู่แล้วสลับ → `PATCH /api/me {locale|theme}` อัปเดต DB + ตั้ง cookie ใน response เดียวกัน
  - ยังไม่ล็อกอิน (หน้า login) → `POST /api/prefs {locale|theme}` ตั้งแค่ cookie (U14 "ยังไม่ล็อกอินจำในเบราว์เซอร์") · อนุญาตระหว่าง `must_change_pin` ด้วย (ADR 0003)
  - หลังเปลี่ยน → `router.refresh()` ให้ Server Component เรนเดอร์ใหม่
- cookie: `Path=/; Max-Age=1 ปี; SameSite=Lax; Secure` (ไม่ HttpOnly ก็ได้ แต่ไม่จำเป็นต้องอ่านจาก JS — ตั้งเป็น HttpOnly)
- `<html lang={locale}>` ตั้งจาก root layout
- ยืนยัน "ไม่ใส่ locale ใน URL" ถูกต้อง: ทุกหน้าเป็นหน้าหลังล็อกอิน/ไม่ต้องการ SEO หลายภาษา และ URL ที่แชร์ (เช่น ลิงก์นัด) ควรเปิดเป็นภาษาของ**ผู้เปิด** ไม่ใช่ผู้แชร์

### 2. รูปแบบข้อความ
- `messages/th.json`, `messages/en.json` — namespace ตามหน้า/โดเมน (`home.*`, `calendar.*`, `errors.*`, `notifications.*`) · ICU MessageFormat (plural/select) · ภาษาอังกฤษเขียนธรรมชาติ ไม่แปลตรง (UX ตรวจ)
- วัน-เวลา **ไม่** format ผ่าน next-intl `format.dateTime` แต่ผ่าน `src/lib/calendar/format` (ADR 0004) เพื่อให้ พ.ศ./24 ชม. อยู่ที่เดียว
- ห้าม hard-code ข้อความ: ESLint (`i18next/no-literal-string` หรือ rule เทียบเท่าที่ Front-end เลือกใน R0) ใน `src/app/**`, `src/components/**` (ยกเว้น `src/app/api/**`)

### 3. Error ของ API เป็นรหัส (U14)
```json
HTTP 4xx/5xx
{ "error": { "code": "LOGIN_LOCKED", "params": { "retryAfterSec": 120 } } }
```
- `ErrorCode` เป็น union เดียวในโค้ด (ARCHITECTURE §6) · UI แปลด้วย `t('errors.' + code, params)` · รหัสที่ UI ไม่รู้จัก → `errors.UNKNOWN`
- API **ไม่ส่งข้อความภาษาคน** ใน error (ยกเว้น log ฝั่งเซิร์ฟเวอร์) · validation error ของ zod ถูกแปลงเป็น `{code:'VALIDATION', params:{fields:{name:'TOO_LONG'}}}`

### 4. ธีม: CSS variables + `data-theme` จาก cookie — **ไม่ต้องมี inline script**
- root layout อ่าน cookie `mm_theme` (`system|light|dark`, ไม่มี = `system`) แล้วเรนเดอร์ `<html data-theme="…">` มาจากเซิร์ฟเวอร์ → สีถูกตั้งแต่ไบต์แรกของ HTML
- โหมด `system` แก้ด้วย CSS ล้วน ไม่ต้องรู้ค่าเครื่องตอนเรนเดอร์:
  ```css
  :root, :root[data-theme="light"] { color-scheme: light; --bg: …; /* tokens light */ }
  :root[data-theme="dark"]          { color-scheme: dark;  --bg: …; /* tokens dark */ }
  @media (prefers-color-scheme: dark) {
    :root[data-theme="system"]      { color-scheme: dark;  --bg: …; /* tokens dark */ }
  }
  ```
  (UX วางค่าใน `src/styles/tokens.css`; ชุด dark เขียนครั้งเดียวด้วย custom property ชุดกลางหรือ `@custom-media`/build step เพื่อไม่ซ้ำ 2 ที่ — Front-end เลือกวิธีใน R0)
- `<meta name="theme-color">` 2 ตัวพร้อม `media="(prefers-color-scheme: …)"` สำหรับแถบเบราว์เซอร์มือถือ
- สลับธีม → ตั้ง `document.documentElement.dataset.theme` ทันที (ไม่รอ refresh) + บันทึกตามข้อ 1
- เงื่อนไขที่ทำให้ไม่กระพริบ: **ทุกหน้าเรนเดอร์แบบ dynamic** (อ่าน cookie) — `cacheComponents` ปิด (ADR 0001) และห้าม `export const dynamic = 'force-static'` ในหน้าที่มี layout นี้ · แผนที่ Leaflet ธีมมืดใช้ CSS filter บน tile layer หรือ tile แบบมืด (UX ตัดสิน; ต้องคง attribution อ่านออก)

### 5. ฟิลด์ข้อมูล
`user.locale TEXT NOT NULL DEFAULT 'th' CHECK IN ('th','en')` · `user.theme TEXT NOT NULL DEFAULT 'system' CHECK IN ('system','light','dark')` (ARCHITECTURE §3)

## Alternatives considered
| ทางเลือก | ทำไมไม่เลือก |
|---|---|
| next-intl แบบมี routing (`/th/...`, `/en/...`) | ไม่จำเป็นสำหรับแอปหลังล็อกอิน, ลิงก์ที่แชร์จะบังคับภาษาผู้แชร์, เพิ่ม proxy/middleware |
| react-i18next / i18next | ทำงานกับ RSC ได้แต่ต้องประกอบเองมากกว่า next-intl ซึ่งออกแบบมาสำหรับ App Router + Server Components โดยตรง |
| Lingui | ต้องมีขั้น extract/compile ข้อความ เพิ่มขั้นตอนให้ UX ที่แก้ JSON ตรง |
| next-themes 0.4.6 | ใช้ inline script อ่าน localStorage ก่อน paint — ใช้ได้ แต่เราอ่าน cookie ฝั่งเซิร์ฟเวอร์อยู่แล้ว จึงไม่ต้องมี script, ไม่ต้องใช้ `suppressHydrationWarning`, และไม่พึ่ง localStorage (release ล่าสุด 2025-03) |
| inline `<script>` ตั้ง `data-theme` จาก `matchMedia` | กันกระพริบได้ แต่ต้องผ่อน CSP (`'unsafe-inline'`/nonce) — วิธี CSS media query ไม่ต้อง |
| เก็บภาษาเฉพาะใน DB แล้ว query ทุก request | เพิ่ม row read ทุกหน้า และหน้า login (ไม่มี user) ยังต้องใช้ cookie อยู่ดี |

## Consequences
- + ไม่มี JS ก่อน paint, ไม่มี hydration mismatch เรื่องธีม, CSP เข้มได้
- + ภาษาเดียวกันทั้ง Server/Client Component
- − ทุกหน้าเป็น dynamic (ยอมรับ — แอปหลังล็อกอิน)
- − cookie กับ DB อาจต่างกันชั่วคราวถ้าผู้ใช้เปลี่ยนจากอีกเครื่อง (ซิงก์ใหม่ตอน login ครั้งถัดไป) — ยอมรับ

## Test requirements (อ้าง PRD U14, U15, §8 ข้อ 4.1)
1. U14 ครั้งแรก (ไม่มี cookie) → `<html lang="th">` และข้อความไทย แม้ `Accept-Language: en`
2. U14 หน้า login สลับเป็น EN → cookie `mm_locale=en` → reload ได้อังกฤษ · login แล้ว `user.locale` ไม่ถูกเขียนทับด้วย cookie ถ้าบัญชีตั้ง `th` ไว้ — ค่าในบัญชีชนะ (ตั้ง cookie ตามบัญชี)
3. U14 ล็อกอินแล้วสลับ → DB + cookie เปลี่ยนใน response เดียว · เครื่องใหม่ login แล้วได้ภาษาตามบัญชี
4. U14 คีย์ครบ: เทสต์เทียบชุดคีย์ (flatten) ของ `th.json` กับ `en.json` ต้องเท่ากัน · ทุก `ErrorCode` และ `NotificationKind` มีคีย์ทั้งสองไฟล์ (วนจาก union)
5. U14 ไม่มี hard-code: lint rule ล้มเมื่อใส่ข้อความดิบในคอมโพเนนต์ (มี fixture ด้านลบ)
6. U14 error เป็นรหัส: ทุก response 4xx ของ API ตรง schema `{error:{code, params?}}` และไม่มีฟิลด์ `message` (เทสต์วนทุก route ใน manifest ด้วย request ผิด)
7. U15 ไม่กระพริบ: Playwright `colorScheme: 'dark'` + ไม่มี cookie → HTML response แรก (ก่อนรัน JS: `javaScriptEnabled: false`) มี `data-theme="system"` และ computed `--bg` = ค่า dark · cookie `mm_theme=light` + ระบบมืด → ค่า light ตั้งแต่ HTML แรก
8. U15 จำค่า: เหมือนข้อ 2–3 สำหรับธีม
9. PRD §8 ข้อ 4.1: ภาพหน้าจอ 3 หน้าหลักครบ 4 ชุด (TH/EN × light/dark) ด้วย Playwright อัตโนมัติ · E2E flow หลักผ่านทั้งสองภาษา
