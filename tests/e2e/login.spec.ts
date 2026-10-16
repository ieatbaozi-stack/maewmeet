// หน้าเข้าสู่ระบบ R0 (หน้าแสดง): แป้น PIN 6 หลัก → login.notYet · ปุ่มลบ · ปุ่มเต็มแล้วกดไม่ได้
import { expect, setPrefs, test, watchConsole } from './support/fixtures';
import { LOCALES, msg } from './support/messages';

for (const locale of LOCALES) {
  test(`${locale}: กดครบ 6 หลัก → ข้อความ login.notYet · ลบได้ทีละหลัก`, async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale });
    const problems = watchConsole(page);
    await page.goto('/login', { waitUntil: 'networkidle' });

    const keypad = page.getByRole('group', { name: msg(locale, 'login.keypad.label') });
    const status = page.getByRole('status').filter({ hasText: new RegExp(`${reEscape(msg(locale, 'login.pinHint'))}|${reEscape(msg(locale, 'login.notYet'))}`) });
    const progress = (n: number) => page.getByRole('img', { name: msg(locale, 'login.pinProgress', { count: n }) });
    const del = keypad.getByRole('button', { name: msg(locale, 'login.keypad.delete') });

    await expect(page.getByLabel(msg(locale, 'login.username'))).toBeVisible();
    await expect(status).toHaveText(msg(locale, 'login.pinHint'));
    await expect(progress(0)).toBeVisible();
    await expect(del).toBeDisabled();

    for (const [i, d] of ['1', '2', '3', '4', '5'].entries()) {
      await keypad.getByRole('button', { name: d, exact: true }).click();
      await expect(progress(i + 1)).toBeVisible();
      await expect(status).toHaveText(msg(locale, 'login.pinHint'));
    }
    await keypad.getByRole('button', { name: '0', exact: true }).click();
    await expect(progress(6)).toBeVisible();
    await expect(status).toHaveText(msg(locale, 'login.notYet'));
    // เต็มแล้ว: แป้นตัวเลขกดไม่ได้ และตัวเลขที่กดไม่ถูกแสดงบนหน้า
    for (const d of ['0', '1', '9']) await expect(keypad.getByRole('button', { name: d, exact: true })).toBeDisabled();
    await expect(page.getByText('123450')).toHaveCount(0);

    await del.click();
    await expect(progress(5)).toBeVisible();
    await expect(status).toHaveText(msg(locale, 'login.pinHint'));
    await expect(keypad.getByRole('button', { name: '7', exact: true })).toBeEnabled();
    for (let n = 4; n >= 0; n--) {
      await del.click();
      await expect(progress(n)).toBeVisible();
    }
    await expect(del).toBeDisabled();
    expect(problems).toEqual([]);
  });
}

test('ลืม PIN / สร้างบัญชี → login.notYet (R1 ยังไม่เปิด)', async ({ page, context, baseURL }) => {
  await setPrefs(context, baseURL!, { locale: 'en' });
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: msg('en', 'login.forgotPin') }).click();
  await expect(page.getByRole('status').filter({ hasText: msg('en', 'login.notYet') })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: msg('en', 'login.createAccount') }).click();
  await expect(page.getByRole('status').filter({ hasText: msg('en', 'login.notYet') })).toBeVisible();
});

function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
