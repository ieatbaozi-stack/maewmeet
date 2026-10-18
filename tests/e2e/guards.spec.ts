// guard ของหน้า (R1_CONTRACT §2): ยังไม่ล็อกอิน → /login · must_change_pin → /set-pin · ล็อกอินแล้วไม่เห็นหน้า public ·
// ไม่ใช่ super admin เปิด /admin/pin-resets → หน้า 404
// หมายเหตุ: guard เป็น redirect() ใน server component ใต้ loading.tsx (streaming) → HTTP status ของเอกสารเป็น 200 แล้ว
//   เบราว์เซอร์ถูกพาไปด้วย client redirect — จึงยืนยันด้วย URL ปลายทาง/เนื้อหา ไม่ใช่ status (ดู Handoff: known deviation)
import { expect, forceMustChangePin, newSuperAdmin, promoteToSuperAdmin, signupViaApi, test, uniqueUsername } from './support/auth';
import { setPrefs, watchConsole } from './support/fixtures';
import { msg } from './support/messages';

const PROTECTED = ['/', '/calendar', '/groups', '/me', '/admin/pin-resets'] as const;

test.describe('ยังไม่ล็อกอิน', () => {
  for (const path of [...PROTECTED, '/set-pin']) {
    test(`${path} → /login`, async ({ page, context, baseURL }) => {
      await setPrefs(context, baseURL!, { locale: 'en' });
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'login.title'));
    });
  }

  test('หน้า public เปิดได้: /login /signup /forgot', async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale: 'en' });
    for (const [path, key] of [['/login', 'login.title'], ['/signup', 'signup.title'], ['/forgot', 'forgot.title']] as const) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', key));
    }
  });
});

test.describe('ล็อกอินแล้ว', () => {
  test('/login /signup /forgot → หน้าหลัก', async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale: 'en' });
    await signupViaApi(context.request, { username: uniqueUsername() });
    for (const path of ['/login', '/signup', '/forgot']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test('/set-pin เมื่อไม่ได้ติด must_change_pin → หน้าหลัก', async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale: 'en' });
    await signupViaApi(context.request, { username: uniqueUsername() });
    await page.goto('/set-pin');
    await expect(page).toHaveURL(/\/$/);
  });

  test('ออกจากระบบจากแท็บ ฉัน → /login และหน้าที่ต้องล็อกอินเด้งกลับ', async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale: 'en' });
    await signupViaApi(context.request, { username: uniqueUsername() });
    await page.goto('/me', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: msg('en', 'me.logout'), exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/me');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('must_change_pin', () => {
  test('ทุกหน้าในแอปและหน้า public → /set-pin · /set-pin แสดงได้ · ออกจากระบบได้', async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale: 'en' });
    const problems = watchConsole(page);
    const u = uniqueUsername();
    await signupViaApi(context.request, { username: u });
    await forceMustChangePin(u);

    for (const path of [...PROTECTED, '/login', '/signup', '/forgot']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/set-pin$/);
    }
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'setPin.title'));
    // ไม่มีแถบนำทางล่างในหน้านี้ (UX: ออกได้ทางเดียวคือออกจากระบบ)
    await expect(page.getByRole('navigation', { name: msg('en', 'nav.label') })).toHaveCount(0);

    await page.getByRole('button', { name: msg('en', 'setPin.signOut') }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(problems).toEqual([]);
  });
});

test.describe('/admin/pin-resets', () => {
  for (const locale of ['th', 'en'] as const) {
    test(`${locale}: ผู้ใช้ทั่วไปเห็นหน้า 404 (ไม่เปิดเผยว่ามีหน้านี้)`, async ({ page, context, baseURL }, testInfo) => {
      await setPrefs(context, baseURL!, { locale });
      await signupViaApi(context.request, { username: uniqueUsername() });
      const res = await page.goto('/admin/pin-resets', { waitUntil: 'networkidle' });
      await expect(page).toHaveURL(/\/admin\/pin-resets$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'notFound.title'));
      await expect(page.getByText(msg(locale, 'adminResets.title'))).toHaveCount(0);
      // บันทึก status จริงไว้ในรายงาน (Front-end: streaming loading.tsx ทำให้เป็น 200) — ไม่ assert ค่าใดค่าหนึ่ง
      testInfo.annotations.push({ type: 'http-status', description: String(res?.status()) });
    });
  }

  test('ผู้ใช้ทั่วไปเรียก API รายการ reset ตรง ๆ → 403 (สิทธิ์จริงอยู่ที่ API)', async ({ context }) => {
    await signupViaApi(context.request, { username: uniqueUsername() });
    const res = await context.request.get('/api/auth/admin/pin-resets?status=pending');
    expect(res.status()).toBe(403);
  });

  test('super admin (ตั้ง is_admin ด้วย SQL) เห็นหน้า ทันที · แท็บ ฉัน มีลิงก์ผู้ดูแล', async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale: 'en' });
    const u = uniqueUsername();
    await signupViaApi(context.request, { username: u });
    await page.goto('/me', { waitUntil: 'networkidle' });
    await expect(page.getByRole('link', { name: new RegExp(msg('en', 'me.adminResets')) })).toHaveCount(0);

    await promoteToSuperAdmin(u);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('link', { name: new RegExp(msg('en', 'me.adminResets')) }).click();
    await expect(page).toHaveURL(/\/admin\/pin-resets$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'adminResets.title'));
  });

  test('super admin ที่สร้างด้วย fixture เปิดหน้าได้ (th)', async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale: 'th' });
    await newSuperAdmin(context);
    await page.goto('/admin/pin-resets', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('th', 'adminResets.title'));
  });
});
