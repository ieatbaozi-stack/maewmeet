// R5-9 / R8-1 — /privacy: เข้าได้โดยไม่ล็อกอิน · TH/EN · ลิงก์จากหน้าเข้าสู่ระบบและแท็บ ฉัน · ข้อความเตือนเขียนให้ผู้ใช้อ่าน (ไม่มีเรื่อง "เจ้าของแอปต้องรับรอง") · "อัปเดตล่าสุด" แทน "ร่างล่าสุด"
// ข้อความตรงกับพฤติกรรมจริง: ตรวจโดย QA ทีละข้อ (R5_CONTRACT §5) — ที่นี่ยืนยันว่าทุกหัวข้อแสดงครบและตัวเลขสำคัญ (90 วัน) อยู่ในหน้า
import { expect, signupViaApi, test, uniqueUsername } from './support/auth';
import { setPrefs, watchConsole } from './support/fixtures';
import { LOCALES, msg } from './support/messages';

const SECTIONS = ['collect', 'see', 'places', 'retention', 'delete', 'contact'] as const;

for (const locale of LOCALES) {
  test(`${locale}: ไม่ล็อกอิน — ลิงก์จาก /login → /privacy (200) · ครบทุกหัวข้อ · กลับไป /login`, async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale });
    const problems = watchConsole(page);
    const direct = await page.goto('/privacy', { waitUntil: 'networkidle' });
    expect(direct?.status()).toBe(200);
    await expect(page).toHaveURL(/\/privacy$/);

    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: msg(locale, 'login.privacy'), exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'privacy.title'));
    await expect(page.getByTestId('privacy-draft')).toHaveText(msg(locale, 'privacy.draft'));
    // R8-1: ไม่มีถ้อยคำเดิมเรื่องเจ้าของแอปต้องรับรอง/ร่างโดยทีม · มี "อัปเดตล่าสุด"/"Last updated"
    const bodyText = await page.locator('main').innerText();
    expect(bodyText).not.toMatch(/เจ้าของแอป|ต้องรับรอง|ร่างโดยทีม|ร่างล่าสุด|app owner|must (be )?(review|approv|certif)|drafted by|last drafted/i);
    await expect(page.getByText(msg(locale, 'privacy.updated'))).toBeVisible();
    expect(msg(locale, 'privacy.updated')).toMatch(locale === 'th' ? /^อัปเดตล่าสุด/ : /^Last updated/);
    for (const s of SECTIONS) await expect(page.getByRole('heading', { level: 2, name: msg(locale, `privacy.${s}.title`) })).toBeVisible();
    await expect(page.getByText(msg(locale, 'privacy.retention.busy'))).toBeVisible();
    await expect(page.getByText(msg(locale, 'privacy.places.links'))).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);

    await page.getByTestId('privacy-back').click();
    await expect(page).toHaveURL(/\/login$/);
    expect(problems).toEqual([]);
  });
}

test('en: ล็อกอินอยู่ — แท็บ ฉัน → ความเป็นส่วนตัว → กลับไป /me', async ({ page, context, baseURL }) => {
  await setPrefs(context, baseURL!, { locale: 'en' });
  await signupViaApi(context.request, { username: uniqueUsername() });
  await page.goto('/me', { waitUntil: 'networkidle' });
  await page.getByTestId('me-privacy').click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'privacy.title'));
  await page.getByTestId('privacy-back').click();
  await expect(page).toHaveURL(/\/me$/);
});
