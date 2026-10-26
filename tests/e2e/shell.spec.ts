// R0-12 / R1 — shell ทุกแท็บ (ล็อกอินแล้ว) + login (ยังไม่ล็อกอิน) + 404 × th/en × light/dark บนทุก project (375/390/768)
// R1: แท็บทุกหน้าต้องล็อกอิน → สมัครผู้ใช้ใหม่ผ่าน API ต่อเทสต์ (ก่อน setPrefs ไม่ได้ — setPrefs ก่อน เพื่อให้ค่าภาษา/ธีมเข้า user)
// ต่อหน้า: สถานะ HTTP · <html lang/data-theme> ตาม cookie · h1 เป็นภาษาที่เลือก · ไม่มี horizontal scroll ·
// a/button/input ทุกตัว ≥ 44px · ไม่มี console error / CSP violation · ภาพหน้าจอเต็มหน้าเก็บเป็น artifact
import { expect, test } from './support/auth';
import { measureLayout, watchConsole } from './support/fixtures';
import { LOCALES, msg } from './support/messages';

type Shell = { name: string; path: string; status: number; h1: string; tab?: 'home' | 'calendar' | 'groups' | 'me'; signedIn?: boolean };

const PAGES: readonly Shell[] = [
  { name: 'หน้าหลัก', path: '/', status: 200, signedIn: true, h1: 'empty.homeNoGroup.title', tab: 'home' },
  { name: 'ปฏิทิน', path: '/calendar', status: 200, signedIn: true, h1: 'nav.calendar', tab: 'calendar' },
  { name: 'กลุ่ม', path: '/groups', status: 200, signedIn: true, h1: 'nav.groups', tab: 'groups' },
  { name: 'ฉัน', path: '/me', status: 200, signedIn: true, h1: 'nav.me', tab: 'me' },
  { name: 'เข้าสู่ระบบ', path: '/login', status: 200, h1: 'login.title' },
  { name: '404', path: '/no-such-page-r0', status: 404, h1: 'notFound.title' },
];
const THEMES = ['light', 'dark'] as const;

for (const p of PAGES) {
  test.describe(`${p.name} (${p.path})`, () => {
    for (const locale of LOCALES) {
      for (const theme of THEMES) {
        test(`${locale} · ${theme}`, async ({ world, openAs }, testInfo) => {
          // ล็อกอินด้วย cookie jar ของ worker (สร้างครั้งเดียว) — หน้า public/404 ใช้ jar ว่าง
          const { page } = await openAs(p.signedIn ? world.user : { cookies: [], origins: [] }, { locale, theme });
          // หน้า 404: เบราว์เซอร์รายงาน "Failed to load resource … 404" ของตัวเอกสารเอง — คาดไว้แล้ว
          const problems = watchConsole(
            page,
            (m) => p.status === 404 && m.type === 'error' && /status of 404/.test(m.text) && (m.url ?? '').endsWith(p.path),
          );

          const res = await page.goto(p.path, { waitUntil: 'networkidle' });
          expect(res?.status(), 'HTTP status').toBe(p.status);
          await page.evaluate(() => document.fonts.ready);

          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, p.h1));
          await expect(page.getByRole('main')).toBeVisible();

          if (p.tab) {
            const nav = page.getByRole('navigation', { name: msg(locale, 'nav.label') });
            await expect(nav.getByRole('link')).toHaveCount(4);
            await expect(nav.getByRole('link', { name: msg(locale, `nav.${p.tab}`), exact: true })).toHaveAttribute('aria-current', 'page');
            await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
          }

          const layout = await measureLayout(page);
          expect(layout.targetCount, 'มีปุ่ม/ลิงก์ให้วัด').toBeGreaterThan(0);
          expect(layout.scrollWidth, 'ไม่มี horizontal scroll (documentElement)').toBeLessThanOrEqual(layout.clientWidth);
          expect(layout.bodyScrollWidth, 'ไม่มี horizontal scroll (body)').toBeLessThanOrEqual(layout.clientWidth);
          expect(layout.smallTargets, 'a/button/input ทุกตัว ≥ 44×44 px').toEqual([]);

          const shot = testInfo.outputPath(`${p.path === '/' ? 'home' : p.path.slice(1)}-${locale}-${theme}-${testInfo.project.name}.png`);
          // ไฟล์ชื่ออ่านง่ายใน test-results/ (artifact ของ CI) — ไม่ attach ซ้ำเพื่อไม่ให้ artifact บวมเป็นสองเท่า
          await page.screenshot({ path: shot, fullPage: true, animations: 'disabled' });

          expect(problems, 'console error / CSP violation').toEqual([]);
        });
      }
    }
  });
}

test('แถบนำทางล่างพาไปทุกแท็บ และ aria-current ตามหน้า', async ({ world, openAs }) => {
  const { page } = await openAs(world.user, { locale: 'en', theme: 'light' });
  const problems = watchConsole(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: msg('en', 'nav.label') });
  for (const [tab, path] of [['calendar', '/calendar'], ['groups', '/groups'], ['me', '/me'], ['home', '/']] as const) {
    await nav.getByRole('link', { name: msg('en', `nav.${tab}`), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : path}$`));
    await expect(nav.getByRole('link', { name: msg('en', `nav.${tab}`), exact: true })).toHaveAttribute('aria-current', 'page');
  }
  expect(problems).toEqual([]);
});
