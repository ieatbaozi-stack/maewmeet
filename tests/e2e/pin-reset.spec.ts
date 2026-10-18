// R1-2 / ADR 0002 ข้อ 18 — เรื่องราว reset PIN ในเบราว์เซอร์จริง:
//   B ขอ reset ที่ /forgot → A (super admin) อนุมัติที่ /admin/pin-resets → B ใช้ 123456 บนเครื่องเดิม → /set-pin →
//   123456 ตั้งเป็น PIN ใหม่ไม่ได้ → PIN ใหม่ที่ถูกต้องเข้าแอป · เครื่องอื่นใช้ 123456 ไม่ได้
// เกิน 24 ชม. (นาฬิกาจำลอง): next start เป็นโปรเซสแยก ไม่มี hook ปรับ clock → ทดสอบที่ระดับ integration:
//   tests/auth/pin-reset-login.test.ts "เลื่อน 24 ชม.+1 วินาที → ผิดและ expired (ไม่พึ่ง cron)"
// รันที่ viewport เดียว (mobile-390) — ตรรกะไม่ขึ้นกับความกว้าง · เลย์เอาต์ทุกความกว้างอยู่ใน responsive.spec.ts
import { alertOf, approveInAdminUi, createPendingReset, expect, GOOD_PIN, newSuperAdmin, OTHER_PIN, pressPin, RESET_PIN, signupViaApi, test, uniqueUsername, userRow } from './support/auth';
import { setPrefs, watchConsole } from './support/fixtures';
import { LOCALES, msg, type Locale } from './support/messages';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องราวเต็มรันที่ mobile-390 ตัวเดียว');
});

for (const locale of LOCALES) {
  test(`${locale}: ขอ reset → admin อนุมัติ → 123456 เครื่องเดิม → /set-pin → 123456 ใช้ไม่ได้ → PIN ใหม่เข้าแอป`, async ({ newDevice, baseURL }) => {
    const b = await newDevice();
    const a = await newDevice();
    await setPrefs(b.context, baseURL!, { locale });
    await setPrefs(a.context, baseURL!, { locale });
    // 401 ของ /api/auth/login ในขั้นลองรหัสผิดเป็นสิ่งที่คาดไว้
    const problems = watchConsole(b.page, (m) => /status of 401/.test(m.text) && (m.url ?? '').endsWith('/api/auth/login'));

    // B มีบัญชีอยู่แล้ว (ลืม PIN → ไม่ได้ล็อกอิน)
    const bob = uniqueUsername('bob');
    await signupViaApi(b.context.request, { username: bob, pin: GOOD_PIN });
    await b.context.clearCookies({ name: /mm_session$/ });

    // 1) B ขอ reset ที่ /forgot
    await b.page.goto('/login', { waitUntil: 'networkidle' });
    await b.page.getByRole('link', { name: msg(locale, 'login.forgotPin') }).click();
    await expect(b.page).toHaveURL(/\/forgot$/);
    await b.page.getByLabel(msg(locale, 'forgot.username'), { exact: true }).fill(bob);
    await b.page.getByRole('button', { name: msg(locale, 'forgot.submit') }).click();
    await expect(b.page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'forgot.pending.title'));

    // ระหว่างรอ: banner "รออนุมัติ" ที่ /login
    await b.page.goto('/login', { waitUntil: 'networkidle' });
    await expect(b.page.getByRole('status').filter({ hasText: msg(locale, 'login.resetBanner.pending') })).toBeVisible();

    // 2) A = super admin (is_admin ตั้งด้วย SQL) อนุมัติ
    await newSuperAdmin(a.context);
    await approveInAdminUi(a.page, locale, bob);
    await expect(a.page.getByText(bob, { exact: true })).toHaveCount(0); // ออกจากรายการรอแล้ว

    // 3) B เครื่องเดิม: banner "อนุมัติแล้ว" + 123456 เข้าได้ → /set-pin
    await b.page.goto('/login', { waitUntil: 'networkidle' });
    await expect(b.page.getByRole('status').filter({ hasText: /123456/ })).toBeVisible();
    await b.page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(bob);
    await pressPin(b.page, locale, RESET_PIN);
    await expect(b.page).toHaveURL(/\/set-pin$/);
    await expect(b.page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'setPin.title'));
    expect((await userRow(bob))?.must_change_pin).toBe(1);

    // ยังเข้าแอปไม่ได้ก่อนตั้ง PIN
    await b.page.goto('/');
    await expect(b.page).toHaveURL(/\/set-pin$/);

    // 4) 123456 ตั้งเป็น PIN ใหม่ไม่ได้ (อยู่ในกลุ่มต้องห้าม) → ยังอยู่ที่ /set-pin
    await pressPin(b.page, locale, RESET_PIN);
    await expect(alertOf(b.page)).toHaveText(msg(locale, 'errors.PIN_TOO_WEAK'));
    await expect(b.page).toHaveURL(/\/set-pin$/);
    expect((await userRow(bob))?.must_change_pin).toBe(1);

    // 5) PIN ใหม่ที่ถูกต้อง (ใส่ + ยืนยัน) → บันทึก → เข้าแอป
    await pressPin(b.page, locale, OTHER_PIN);
    await pressPin(b.page, locale, OTHER_PIN);
    await expect(b.page.getByRole('status').filter({ hasText: msg(locale, 'setPin.done') })).toBeVisible();
    await b.page.getByRole('link', { name: msg(locale, 'nav.home') }).click();
    await expect(b.page).toHaveURL(/\/$/);
    await expect(b.page.getByRole('navigation', { name: msg(locale, 'nav.label') })).toBeVisible();
    expect((await userRow(bob))?.must_change_pin).toBe(0);
    await b.page.goto('/set-pin');
    await expect(b.page).toHaveURL(/\/$/);

    // 6) ออกจากระบบ: 123456 และ PIN เก่าใช้ไม่ได้อีก · PIN ใหม่ใช้ได้
    await b.page.goto('/me', { waitUntil: 'networkidle' });
    await b.page.getByRole('button', { name: msg(locale, 'me.logout'), exact: true }).click();
    await expect(b.page).toHaveURL(/\/login$/);
    const alert = alertOf(b.page);
    await b.page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(bob);
    await pressPin(b.page, locale, RESET_PIN);
    await expect(alert).toHaveText(msg(locale, 'errors.INVALID_CREDENTIALS', { attemptsRemaining: 4 }));
    await pressPin(b.page, locale, GOOD_PIN);
    await expect(alert).toHaveText(msg(locale, 'errors.INVALID_CREDENTIALS', { attemptsRemaining: 3 }));
    await pressPin(b.page, locale, OTHER_PIN);
    await expect(b.page).toHaveURL(/\/$/);
    expect(problems).toEqual([]);
  });
}

test('เครื่องอื่น (browser context ใหม่) ใช้ 123456 ไม่ได้ แม้อนุมัติแล้ว · เครื่องที่ขอยังเข้าได้', async ({ newDevice, baseURL }) => {
  const locale: Locale = 'en';
  const requester = await newDevice();
  const other = await newDevice();
  const admin = await newDevice();
  for (const d of [requester, other, admin]) await setPrefs(d.context, baseURL!, { locale });

  const carol = uniqueUsername('carol');
  await createPendingReset(requester.context, carol);
  await newSuperAdmin(admin.context);
  await approveInAdminUi(admin.page, locale, carol);

  // เครื่องอื่น: ไม่มี cookie ผูกเครื่อง → ผิด (ข้อความเดียวกับ PIN ผิดทั่วไป — ไม่บอกว่าถูกอนุมัติอยู่)
  await other.page.goto('/login', { waitUntil: 'networkidle' });
  await expect(other.page.getByRole('status').filter({ hasText: /123456/ })).toHaveCount(0);
  await other.page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(carol);
  await pressPin(other.page, locale, RESET_PIN);
  await expect(alertOf(other.page)).toHaveText(msg(locale, 'errors.INVALID_CREDENTIALS', { attemptsRemaining: 4 }));
  await expect(other.page).toHaveURL(/\/login$/);
  expect((await userRow(carol))?.must_change_pin).toBe(0);
  await other.page.goto('/');
  await expect(other.page).toHaveURL(/\/login$/);

  // เครื่องที่ขอ ยังใช้ได้ (คำขอไม่ถูกใช้ไปโดยความพยายามของเครื่องอื่น)
  await requester.page.goto('/login', { waitUntil: 'networkidle' });
  await requester.page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(carol);
  await pressPin(requester.page, locale, RESET_PIN);
  await expect(requester.page).toHaveURL(/\/set-pin$/);
});

test('ใช้ 123456 ซ้ำไม่ได้: หลังตั้ง PIN ใหม่แล้ว 123456 บนเครื่องเดิมถูกปฏิเสธ · cookie ผูกเครื่องถูกล้าง (/forgot กลับเป็นฟอร์ม)', async ({ newDevice, baseURL }) => {
  const locale: Locale = 'en';
  const requester = await newDevice();
  const admin = await newDevice();
  for (const d of [requester, admin]) await setPrefs(d.context, baseURL!, { locale });
  const dave = uniqueUsername('dave');
  await createPendingReset(requester.context, dave);
  await newSuperAdmin(admin.context);
  await approveInAdminUi(admin.page, locale, dave);

  await requester.page.goto('/login', { waitUntil: 'networkidle' });
  await requester.page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(dave);
  await pressPin(requester.page, locale, RESET_PIN);
  await expect(requester.page).toHaveURL(/\/set-pin$/);
  await pressPin(requester.page, locale, OTHER_PIN);
  await pressPin(requester.page, locale, OTHER_PIN);
  await expect(requester.page.getByRole('status').filter({ hasText: msg(locale, 'setPin.done') })).toBeVisible();
  await requester.context.clearCookies({ name: /mm_session$/ });

  await requester.page.goto('/login', { waitUntil: 'networkidle' });
  await requester.page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(dave);
  await pressPin(requester.page, locale, RESET_PIN);
  await expect(alertOf(requester.page)).toContainText(/./);
  await expect(requester.page).toHaveURL(/\/login$/);

  await expect(requester.page.getByRole('status').filter({ hasText: /123456/ })).toHaveCount(0);
  await requester.page.goto('/forgot', { waitUntil: 'networkidle' });
  // cookie mm_reset ถูกล้างตอนใช้ 123456 (login.ts) → ไม่มี banner "อนุมัติแล้ว" ค้าง และ /forgot ให้ขอใหม่ได้
  await expect(requester.page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'forgot.title'));
});
