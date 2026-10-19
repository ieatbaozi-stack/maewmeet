// R0-10 — ธีมจากเซิร์ฟเวอร์ (ไม่มีกระพริบ) · system ตาม prefers-color-scheme · สลับแล้วคงอยู่หลังรีโหลด
import { expect, signupViaApi, test, uniqueUsername } from './support/auth';
import { setPrefs, watchConsole, type Theme } from './support/fixtures';
import { msg } from './support/messages';

test.describe('HTML แรกจากเซิร์ฟเวอร์ (ไม่ต้องรอ JS)', () => {
  for (const [cookie, want] of [
    ['dark', 'dark'],
    ['light', 'light'],
    ['system', 'system'],
    [undefined, 'system'],
    ['purple', 'system'],
  ] as const) {
    test(`cookie mm_theme=${cookie ?? '(ไม่มี)'} → <html data-theme="${want}">`, async ({ request }) => {
      const res = await request.get('/', { headers: cookie ? { cookie: `mm_theme=${cookie}` } : {} });
      expect(res.status()).toBe(200);
      const html = await res.text();
      const tag = html.match(/<html\b[^>]*>/)?.[0] ?? '';
      expect(tag).toContain(`data-theme="${want}"`);
    });
  }

  test('ปิด JavaScript: cookie dark → data-theme="dark" และพื้นหลังเป็นธีมมืด', async ({ browser, baseURL }) => {
    const bgOf = async (opts: { theme?: Theme; scheme: 'light' | 'dark' }) => {
      const ctx = await browser.newContext({ javaScriptEnabled: false, colorScheme: opts.scheme });
      if (opts.theme) await setPrefs(ctx, baseURL!, { theme: opts.theme });
      const page = await ctx.newPage();
      await page.goto('/login');
      const r = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.body).backgroundColor,
      }));
      await ctx.close();
      return r;
    };
    const dark = await bgOf({ theme: 'dark', scheme: 'light' });
    const light = await bgOf({ theme: 'light', scheme: 'dark' });
    expect(dark.theme).toBe('dark');
    expect(light.theme).toBe('light');
    expect(dark.bg).not.toBe(light.bg);
    // ค่า cookie ชนะค่าของเครื่อง: dark บนเครื่องสว่าง = dark บนเครื่องมืด
    expect((await bgOf({ theme: 'dark', scheme: 'dark' })).bg).toBe(dark.bg);
  });
});

test.describe('system ตาม colorScheme ที่ emulate', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`ไม่มี cookie + colorScheme=${scheme} → สีพื้นเท่ากับธีม ${scheme}`, async ({ browser, baseURL }) => {
      const bg = async (theme: Theme | undefined) => {
        const ctx = await browser.newContext({ colorScheme: scheme });
        if (theme) await setPrefs(ctx, baseURL!, { theme });
        const page = await ctx.newPage();
        await page.goto('/login');
        const v = await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
        await ctx.close();
        return v;
      };
      const [systemTheme, systemBg] = await bg(undefined);
      const [, explicitBg] = await bg(scheme);
      const [, otherBg] = await bg(scheme === 'light' ? 'dark' : 'light');
      expect(systemTheme).toBe('system');
      expect(systemBg).toBe(explicitBg);
      expect(systemBg).not.toBe(otherBg);
    });
  }
});

test.describe('สลับธีม/ภาษาแล้วคงอยู่หลังรีโหลด', () => {
  test('หน้า "ฉัน": มืด + English → รีโหลดแล้วยังเป็น en/dark → กลับเป็น ตามเครื่อง + ไทย', async ({ page, context }) => {
    const problems = watchConsole(page);
    await signupViaApi(context.request, { username: uniqueUsername() }); // R1: /me ต้องล็อกอิน
    await page.goto('/me', { waitUntil: 'networkidle' });
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'th');
    await expect(html).toHaveAttribute('data-theme', 'system');

    const prefsSaved = () => page.waitForResponse((r) => r.url().endsWith('/api/prefs') && r.request().method() === 'POST');

    let saved = prefsSaved();
    await page.getByRole('button', { name: msg('th', 'prefs.themeDark'), exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark'); // ทันที ไม่รอรีโหลด
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole('button', { name: msg('th', 'prefs.themeDark'), exact: true })).toHaveAttribute('aria-pressed', 'true');

    saved = prefsSaved();
    await page.getByRole('button', { name: msg('th', 'prefs.languageEn'), exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'nav.me'));

    await page.reload({ waitUntil: 'networkidle' });
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: msg('en', 'prefs.themeDark'), exact: true })).toHaveAttribute('aria-pressed', 'true');

    const cookies = Object.fromEntries((await context.cookies()).map((c) => [c.name, c]));
    expect(cookies.mm_theme?.value).toBe('dark');
    expect(cookies.mm_locale?.value).toBe('en');
    expect(cookies.mm_theme?.httpOnly).toBe(true);
    expect(cookies.mm_theme?.sameSite).toBe('Lax');

    saved = prefsSaved();
    await page.getByRole('button', { name: msg('en', 'prefs.themeSystem'), exact: true }).click();
    expect((await saved).status()).toBe(200);
    saved = prefsSaved();
    await page.getByRole('button', { name: msg('en', 'prefs.languageTh'), exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(html).toHaveAttribute('lang', 'th');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(html).toHaveAttribute('lang', 'th');
    await expect(html).toHaveAttribute('data-theme', 'system');
    expect(problems).toEqual([]);
  });

  test('หน้าเข้าสู่ระบบ: EN + ปุ่มสลับธีม (เครื่องสว่าง → มืด) → รีโหลดแล้วคงอยู่', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    const problems = watchConsole(page);
    await page.goto('/login', { waitUntil: 'networkidle' });
    const html = page.locator('html');

    const langGroup = page.getByRole('group', { name: msg('th', 'prefs.languageLabel') });
    let saved = page.waitForResponse((r) => r.url().endsWith('/api/prefs'));
    await langGroup.getByRole('button', { name: msg('th', 'prefs.languageShortEn'), exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'login.title'));

    saved = page.waitForResponse((r) => r.url().endsWith('/api/prefs'));
    await page.getByRole('button', { name: msg('en', 'prefs.toggleTheme') }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    expect((await saved).status()).toBe(200);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // กดอีกครั้ง → สว่าง
    saved = page.waitForResponse((r) => r.url().endsWith('/api/prefs'));
    await page.getByRole('button', { name: msg('en', 'prefs.toggleTheme') }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect((await saved).status()).toBe(200);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(problems).toEqual([]);
    await ctx.close();
  });
});
