// หน้าเข้าสู่ระบบ R1 (จริง): แป้น PIN · ผิด → "เหลืออีก N ครั้ง" · ล็อก (R1-6) · เข้าสู่ระบบสำเร็จ · ลิงก์ไปสมัคร/ลืม PIN
// ผู้ใช้สร้างผ่าน API ต่อเทสต์ (IP สมมติแยกกัน — ดู support/auth.ts)
import { alertOf, expect, forceMustChangePin, GOOD_PIN, pressPin, signupViaApi, test, uniqueUsername } from './support/auth';
import { setPrefs, watchConsole } from './support/fixtures';
import { LOCALES, msg } from './support/messages';



for (const locale of LOCALES) {
  test(`${locale}: แป้น PIN แสดงความคืบหน้า · ลบทีละหลัก · ต้องมี username ก่อนแป้นจึงกดได้`, async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale });
    const problems = watchConsole(page);
    await page.goto('/login', { waitUntil: 'networkidle' });

    const keypad = page.getByRole('group', { name: msg(locale, 'login.keypad.label') });
    const progress = (n: number) => page.getByRole('img', { name: msg(locale, 'login.pinProgress', { count: n }) });
    const del = keypad.getByRole('button', { name: msg(locale, 'login.keypad.delete') });
    const hint = page.getByRole('status').filter({ hasText: msg(locale, 'login.pinHint') });

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'login.title'));
    await expect(hint).toBeVisible();
    await expect(progress(0)).toBeVisible();
    // ยังไม่ใส่ username → แป้นตัวเลขกดไม่ได้
    await expect(keypad.getByRole('button', { name: '1', exact: true })).toBeDisabled();

    await page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(uniqueUsername('nobody'));
    for (const [i, d] of ['1', '3', '5', '7', '9'].entries()) {
      await keypad.getByRole('button', { name: d, exact: true }).click();
      await expect(progress(i + 1)).toBeVisible();
    }
    await expect(page.getByText('13579')).toHaveCount(0); // ไม่แสดงตัวเลขที่กดบนหน้า
    for (let n = 4; n >= 0; n--) {
      await del.click();
      await expect(progress(n)).toBeVisible();
    }
    await expect(del).toBeDisabled();
    expect(problems).toEqual([]);
  });

  test(`${locale}: PIN ผิด → ข้อความ "เหลืออีก N ครั้ง" แล้วแป้นเคลียร์ · username ที่ไม่มีได้ข้อความเดียวกัน`, async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale });
    const u = uniqueUsername();
    await signupViaApi(context.request, { username: u });
    await context.clearCookies({ name: /mm_session$/ });
    await page.goto('/login', { waitUntil: 'networkidle' });

    const alert = alertOf(page);
    await page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(u);
    await pressPin(page, locale, '246813');
    await expect(alert).toHaveText(msg(locale, 'errors.INVALID_CREDENTIALS', { attemptsRemaining: 4 }));
    await expect(page.getByRole('img', { name: msg(locale, 'login.pinProgress', { count: 0 }) })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // username ที่ไม่มีอยู่จริง: ข้อความรูปเดียวกัน (ไม่เปิดเผยว่าบัญชีมีหรือไม่)
    await page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(uniqueUsername('ghost'));
    await pressPin(page, locale, '246813');
    await expect(alert).toHaveText(msg(locale, 'errors.INVALID_CREDENTIALS', { attemptsRemaining: 4 }));
  });

  test(`${locale}: ผิด 5 ครั้ง → แสดงข้อความล็อก "ลองใหม่ใน …" และแป้นกดไม่ได้ (ลืม PIN ยังกดได้)`, async ({ page, context, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'ล็อกเอาต์ทดสอบที่ viewport เดียวพอ — ตรรกะไม่ขึ้นกับความกว้าง');
    await setPrefs(context, baseURL!, { locale });
    const u = uniqueUsername();
    await signupViaApi(context.request, { username: u });
    await context.clearCookies({ name: /mm_session$/ });
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(u);

    const keypad = page.getByRole('group', { name: msg(locale, 'login.keypad.label') });
    const alert = alertOf(page);
    for (const left of [4, 3, 2, 1]) {
      await pressPin(page, locale, '246813');
      await expect(alert).toHaveText(msg(locale, 'errors.INVALID_CREDENTIALS', { attemptsRemaining: left }));
    }
    await expect(keypad.getByRole('button', { name: '1', exact: true })).toBeEnabled();
    await pressPin(page, locale, '246813'); // ครั้งที่ 5

    await expect(alert).toContainText(msg(locale, 'login.locked.title'));
    await expect(alert).toContainText(msg(locale, 'errors.LOGIN_LOCKED', { retryAfterMin: 1 }));
    await expect(alert).toContainText(msg(locale, 'login.locked.hint'));
    for (const d of ['0', '1', '5', '9']) await expect(keypad.getByRole('button', { name: d, exact: true })).toBeDisabled();
    await expect(keypad.getByRole('button', { name: msg(locale, 'login.keypad.delete') })).toBeDisabled();
    await expect(keypad.getByRole('link', { name: msg(locale, 'login.forgotPin') })).toBeEnabled();
    await expect(page).toHaveURL(/\/login$/);

    // ล็อกผูกกับ username: เปลี่ยนเป็นคนอื่น แป้นกลับมาใช้ได้
    await page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(uniqueUsername('other'));
    await expect(keypad.getByRole('button', { name: '1', exact: true })).toBeEnabled();
    await expect(page.getByText(msg(locale, 'login.locked.title'))).toHaveCount(0);
  });
}

test('เข้าสู่ระบบด้วย PIN ที่ถูก → หน้าหลัก · session อยู่ข้ามการรีโหลด · /login พากลับหน้าหลัก', async ({ page, context, baseURL }) => {
  await setPrefs(context, baseURL!, { locale: 'en' });
  const u = uniqueUsername();
  await signupViaApi(context.request, { username: u });
  await context.clearCookies({ name: /mm_session$/ });

  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.getByLabel(msg('en', 'login.username'), { exact: true }).fill(u.toUpperCase()); // ไม่สนตัวพิมพ์ (D2)
  await pressPin(page, 'en', GOOD_PIN);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: msg('en', 'nav.label') })).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/$/);
});

test('ผู้ใช้ที่ must_change_pin เข้าสู่ระบบแล้วถูกพาไป /set-pin', async ({ page, context, baseURL }) => {
  await setPrefs(context, baseURL!, { locale: 'th' });
  const u = uniqueUsername();
  await signupViaApi(context.request, { username: u });
  await context.clearCookies({ name: /mm_session$/ });
  await forceMustChangePin(u);
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.getByLabel(msg('th', 'login.username'), { exact: true }).fill(u);
  await pressPin(page, 'th', GOOD_PIN);
  await expect(page).toHaveURL(/\/set-pin$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('th', 'setPin.title'));
});

test('ลิงก์ ลืม PIN / สร้างบัญชี พาไป /forgot และ /signup', async ({ page, context, baseURL }) => {
  await setPrefs(context, baseURL!, { locale: 'en' });
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: msg('en', 'login.forgotPin') }).click();
  await expect(page).toHaveURL(/\/forgot$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'forgot.title'));
  await page.getByRole('link', { name: msg('en', 'forgot.backToLogin') }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: msg('en', 'login.createAccount') }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'signup.title'));
});

