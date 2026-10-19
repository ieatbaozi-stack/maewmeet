// R1-5 — ทุกหน้าใหม่ของ R1 × (375/390/768 = project) × th/en × light/dark:
//   ไม่มี horizontal scroll · a/button/input ที่เห็นทุกตัว ≥ 44×44 · ไม่มี console error/CSP · ภาพหน้าจอเต็มหน้า → test-results/ (artifact ของ CI)
// หน้า: /login /signup /forgot /set-pin /admin/pin-resets /me — บางหน้ามีหลายสถานะ (signup 3 ขั้น, forgot ฟอร์ม/รอ/อนุมัติ, admin มีรายการ + sheet, me + sheet)
// สถานะที่ต้องมีบัญชี/คำขอ ใช้ cookie jar ที่สร้างครั้งเดียวต่อ worker (support/auth.ts `world`) — ไม่สมัคร/อนุมัติใหม่ทุกเทสต์
// ข้อความ hard-code: ตรวจโดย tests/i18n/no-hardcoded-text.test.ts (เทสต์เดิม) — ที่นี่ยืนยันว่าหัวข้อเป็นภาษาที่เลือก
import type { Page, TestInfo } from '@playwright/test';
import { alertOf, expect, GOOD_PIN, pressPin, test, uniqueUsername } from './support/auth';
import { measureLayout, setPrefs, watchConsole } from './support/fixtures';
import { LOCALES, msg, type Locale } from './support/messages';

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

async function check(page: Page, testInfo: TestInfo, label: string, locale: Locale, theme: Theme): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const layout = await measureLayout(page);
  expect(layout.targetCount, `${label}: มีปุ่ม/ลิงก์ให้วัด`).toBeGreaterThan(0);
  expect(layout.scrollWidth, `${label}: ไม่มี horizontal scroll (documentElement)`).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.bodyScrollWidth, `${label}: ไม่มี horizontal scroll (body)`).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.smallTargets, `${label}: a/button/input ทุกตัว ≥ 44×44 px`).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath(`${label}-${locale}-${theme}-${testInfo.project.name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

const h1 = (page: Page, text: string) => expect(page.getByRole('heading', { level: 1 })).toHaveText(text);
/** 401 ของ /api/auth/login ตอนลองรหัสผิดเป็นสิ่งที่คาดไว้ */
const expected401 = (m: { text: string; url?: string }) => /status of 401/.test(m.text) && (m.url ?? '').endsWith('/api/auth/login');

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    const prefs = { locale, theme } as const;

    test.describe(`${locale} · ${theme}`, () => {
      test('/login (+ สถานะ PIN ผิด)', async ({ page, context, baseURL }, testInfo) => {
        await setPrefs(context, baseURL!, prefs);
        const problems = watchConsole(page, expected401);
        await page.goto('/login', { waitUntil: 'networkidle' });
        await h1(page, msg(locale, 'login.title'));
        await check(page, testInfo, 'login', locale, theme);
        if (locale === 'th' || theme === 'light') {
          // ข้อความ error ไม่ดันเลย์เอาต์ (ทำเฉพาะ 2 จาก 4 ชุด — มี argon2 verify จริง)
          await page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(uniqueUsername('nobody'));
          await pressPin(page, locale, '246813');
          await expect(alertOf(page)).toBeVisible();
          await check(page, testInfo, 'login-error', locale, theme);
        }
        expect(problems).toEqual([]);
      });

      test('/signup ทั้ง 3 ขั้น', async ({ page, context, baseURL }, testInfo) => {
        await setPrefs(context, baseURL!, prefs);
        const problems = watchConsole(page);
        await page.goto('/signup', { waitUntil: 'networkidle' });
        await h1(page, msg(locale, 'signup.title'));
        await check(page, testInfo, 'signup-1', locale, theme);
        await page.getByLabel(msg(locale, 'signup.username'), { exact: true }).fill(uniqueUsername());
        await page.getByLabel(msg(locale, 'signup.displayName'), { exact: true }).fill('Layout Tester');
        await page.getByRole('button', { name: msg(locale, 'login.next') }).click();
        await expect(page.getByText(msg(locale, 'signup.stepOf', { current: 2, total: 3 }))).toBeVisible();
        await check(page, testInfo, 'signup-2', locale, theme);
        await pressPin(page, locale, GOOD_PIN);
        await expect(page.getByText(msg(locale, 'signup.stepOf', { current: 3, total: 3 }))).toBeVisible();
        await check(page, testInfo, 'signup-3', locale, theme);
        expect(problems).toEqual([]);
      });

      test('/forgot ฟอร์ม', async ({ page, context, baseURL }, testInfo) => {
        await setPrefs(context, baseURL!, prefs);
        const problems = watchConsole(page);
        await page.goto('/forgot', { waitUntil: 'networkidle' });
        await h1(page, msg(locale, 'forgot.title'));
        await check(page, testInfo, 'forgot', locale, theme);
        expect(problems).toEqual([]);
      });

      test('/forgot + /login เมื่อคำขอรออนุมัติ', async ({ world, openAs }, testInfo) => {
        const { page } = await openAs(world.resetPending, prefs);
        const problems = watchConsole(page);
        await page.goto('/forgot', { waitUntil: 'networkidle' });
        await h1(page, msg(locale, 'forgot.pending.title'));
        await check(page, testInfo, 'forgot-pending', locale, theme);
        await page.goto('/login', { waitUntil: 'networkidle' });
        await expect(page.getByRole('status').filter({ hasText: msg(locale, 'login.resetBanner.pending') })).toBeVisible();
        await check(page, testInfo, 'login-banner-pending', locale, theme);
        expect(problems).toEqual([]);
      });

      test('/forgot + /login เมื่ออนุมัติแล้ว (แบนเนอร์ 123456)', async ({ world, openAs }, testInfo) => {
        const { page } = await openAs(world.resetApproved, prefs);
        const problems = watchConsole(page);
        await page.goto('/forgot', { waitUntil: 'networkidle' });
        await h1(page, msg(locale, 'forgot.approved.title'));
        await check(page, testInfo, 'forgot-approved', locale, theme);
        await page.goto('/login', { waitUntil: 'networkidle' });
        await expect(page.getByRole('status').filter({ hasText: /123456/ })).toBeVisible();
        await check(page, testInfo, 'login-banner-approved', locale, theme);
        expect(problems).toEqual([]);
      });

      test('/set-pin (ขั้นใส่ PIN ใหม่ + ขั้นยืนยัน)', async ({ world, openAs }, testInfo) => {
        const { page } = await openAs(world.mustChange, prefs);
        const problems = watchConsole(page);
        await page.goto('/set-pin', { waitUntil: 'networkidle' });
        await h1(page, msg(locale, 'setPin.title'));
        await check(page, testInfo, 'set-pin', locale, theme);
        await pressPin(page, locale, '246813');
        await expect(page.getByRole('img', { name: msg(locale, 'login.pinProgress', { count: 0 }) })).toBeVisible();
        await check(page, testInfo, 'set-pin-confirm', locale, theme);
        expect(problems).toEqual([]);
      });

      test('/admin/pin-resets (มีรายการ + sheet อนุมัติ)', async ({ world, openAs }, testInfo) => {
        const { page } = await openAs(world.admin, prefs);
        const problems = watchConsole(page);
        await page.goto('/admin/pin-resets', { waitUntil: 'networkidle' });
        await h1(page, msg(locale, 'adminResets.title'));
        await expect(page.getByText(world.pendingUsername, { exact: true })).toBeVisible();
        await check(page, testInfo, 'admin-pin-resets', locale, theme);
        await page.getByRole('button', { name: msg(locale, 'adminResets.approveFor', { username: world.pendingUsername }) }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await check(page, testInfo, 'admin-pin-resets-sheet', locale, theme);
        expect(problems).toEqual([]);
      });

      test('/me (ผู้ใช้ทั่วไป + sheet เปลี่ยน PIN)', async ({ world, openAs }, testInfo) => {
        const { page } = await openAs(world.user, prefs);
        const problems = watchConsole(page);
        await page.goto('/me', { waitUntil: 'networkidle' });
        await h1(page, msg(locale, 'me.title'));
        await check(page, testInfo, 'me', locale, theme);
        await page.getByRole('button', { name: msg(locale, 'me.changePin'), exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await check(page, testInfo, 'me-change-pin-sheet', locale, theme);
        expect(problems).toEqual([]);
      });

      test('/me (super admin: มีส่วนผู้ดูแลระบบ)', async ({ world, openAs }, testInfo) => {
        const { page } = await openAs(world.admin, prefs);
        const problems = watchConsole(page);
        await page.goto('/me', { waitUntil: 'networkidle' });
        await h1(page, msg(locale, 'me.title'));
        await expect(page.getByRole('link', { name: new RegExp(msg(locale, 'me.adminResets')) })).toBeVisible();
        await check(page, testInfo, 'me-admin', locale, theme);
        expect(problems).toEqual([]);
      });
    });
  }
}
