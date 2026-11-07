// R7 G1 — กลุ่มใหม่ที่สร้างจาก UI ได้ "ว่างอย่างน้อย" 4 ชม. (240 นาที) และช่วง 08:00–22:00 ที่หน้าตั้งค่ากลุ่ม
import { expect, test } from './support/auth';
import { setPrefs } from './support/fixtures';
import { go, person, signup } from './support/groups';
import { msg } from './support/messages';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'ตรรกะไม่ขึ้นกับความกว้าง รันที่ mobile-390 ตัวเดียว');
});

test('th: สร้างกลุ่มใหม่จาก UI → ตั้งค่ากลุ่มแสดง ว่างอย่างน้อย 4 ชม. · 08:00–22:00', async ({ newDevice, baseURL }) => {
  const a = await newDevice();
  await setPrefs(a.context, baseURL!, { locale: 'th' });
  await signup(a.context, person('Ann'));
  const name = `R7 ${Date.now().toString(36)}`;

  await go(a.page, '/groups');
  await a.page.getByRole('button', { name: msg('th', 'groups.create'), exact: true }).click();
  const sheet = a.page.getByRole('dialog', { name: msg('th', 'groups.createSheet.title'), exact: true });
  await sheet.getByLabel(msg('th', 'groups.createSheet.name'), { exact: true }).fill(name);
  await sheet.getByRole('button', { name: msg('th', 'groups.createSheet.submit'), exact: true }).click();
  await expect(a.page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);
  const gid = /\/groups\/([0-9a-f-]{36})/.exec(a.page.url())![1]!;

  await go(a.page, `/groups/${gid}/settings`);
  const win = a.page.locator('section.set-sec', { has: a.page.getByRole('heading', { name: msg('th', 'groupSettings.window.title'), exact: true }) });
  await expect(win.getByLabel(msg('th', 'groupSettings.window.start'))).toHaveValue('480');
  await expect(win.getByLabel(msg('th', 'groupSettings.window.end'))).toHaveValue('1320');
  const min = win.getByLabel(msg('th', 'groupSettings.window.min'));
  await expect(min).toHaveValue('240');
  await expect(min.locator('option:checked')).toHaveText(msg('th', 'groupSettings.window.durationHour', { hours: 4 }));
  await expect(win.getByText(msg('th', 'groupSettings.window.summary', { start: '08:00', end: '22:00', duration: msg('th', 'groupSettings.window.durationHour', { hours: 4 }) }))).toBeVisible();
});
