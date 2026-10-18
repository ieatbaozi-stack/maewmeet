// สมัครบัญชีบนหน้าจอ (3 ขั้น) — ตรวจฝั่ง client + ผลจากเซิร์ฟเวอร์ · รันที่ mobile-390 ตัวเดียว
import { alertOf, expect, GOOD_PIN, OTHER_PIN, pressPin, RESET_PIN, signupViaApi, test, uniqueUsername, userRow } from './support/auth';
import { setPrefs, watchConsole } from './support/fixtures';
import { LOCALES, msg } from './support/messages';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'รันที่ mobile-390 ตัวเดียว');
});

for (const locale of LOCALES) {
  test(`${locale}: สมัคร 3 ขั้น — PIN ต้องห้าม/ไม่ตรงถูกปฏิเสธ · สำเร็จแล้วเข้าหน้าหลักและเข้าสู่ระบบซ้ำได้`, async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale });
    const problems = watchConsole(page);
    const u = uniqueUsername();
    await page.goto('/signup', { waitUntil: 'networkidle' });
    await expect(page.getByText(msg(locale, 'signup.stepOf', { current: 1, total: 3 }))).toBeVisible();

    // ขั้น 1: username ผิดรูปแบบ
    const name = page.getByLabel(msg(locale, 'signup.username'), { exact: true });
    await name.fill('ab');
    await page.getByLabel(msg(locale, 'signup.displayName'), { exact: true }).fill('Tester');
    await page.getByRole('button', { name: msg(locale, 'login.next') }).click();
    await expect(alertOf(page)).toHaveText(msg(locale, 'errors.USERNAME_FORMAT'));
    await name.fill(u);
    await page.getByRole('button', { name: msg(locale, 'login.next') }).click();

    // ขั้น 2: PIN ต้องห้าม (123456) ถูกปฏิเสธ แล้วใส่ PIN ที่ใช้ได้
    await expect(page.getByText(msg(locale, 'signup.stepOf', { current: 2, total: 3 }))).toBeVisible();
    await pressPin(page, locale, RESET_PIN);
    await expect(alertOf(page)).toHaveText(msg(locale, 'errors.PIN_TOO_WEAK'));
    await pressPin(page, locale, GOOD_PIN);

    // ขั้น 3: ยืนยันไม่ตรง → กลับขั้น 2
    await expect(page.getByText(msg(locale, 'signup.stepOf', { current: 3, total: 3 }))).toBeVisible();
    await pressPin(page, locale, OTHER_PIN);
    await expect(alertOf(page)).toHaveText(msg(locale, 'errors.PIN_MISMATCH'));
    await expect(page.getByText(msg(locale, 'signup.stepOf', { current: 2, total: 3 }))).toBeVisible();
    await pressPin(page, locale, GOOD_PIN);
    await pressPin(page, locale, GOOD_PIN);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('navigation', { name: msg(locale, 'nav.label') })).toBeVisible();
    expect((await userRow(u))?.is_admin).toBe(0);
    expect(problems).toEqual([]);

    // ออกแล้วเข้าสู่ระบบด้วย PIN ที่ตั้ง
    await page.goto('/me', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: msg(locale, 'me.logout'), exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(u);
    await pressPin(page, locale, GOOD_PIN);
    await expect(page).toHaveURL(/\/$/);
  });
}

test('username ซ้ำ (ไม่สนตัวพิมพ์) → USERNAME_TAKEN และกลับไปขั้น 1', async ({ page, context, baseURL }) => {
  const locale = 'en';
  await setPrefs(context, baseURL!, { locale });
  const u = uniqueUsername();
  await signupViaApi(context.request, { username: u });
  await context.clearCookies({ name: /mm_session$/ });
  await page.goto('/signup', { waitUntil: 'networkidle' });
  await page.getByLabel(msg(locale, 'signup.username'), { exact: true }).fill(u.toUpperCase());
  await page.getByLabel(msg(locale, 'signup.displayName'), { exact: true }).fill('Dup');
  await page.getByRole('button', { name: msg(locale, 'login.next') }).click();
  await pressPin(page, locale, GOOD_PIN);
  await pressPin(page, locale, GOOD_PIN);
  await expect(alertOf(page)).toHaveText(msg(locale, 'errors.USERNAME_TAKEN'));
  await expect(page.getByText(msg(locale, 'signup.stepOf', { current: 1, total: 3 }))).toBeVisible();
});
