// R3-2/R3-8 ฝั่งหน้าจอ — ขีดจำกัด · ย้อนหลัง · "วันนี้" ตาม tz กลุ่ม · รันที่ mobile-390 ตัวเดียว
//   - ครบ 300 (seed ตรงใน DB ด้วย seedBusyBulk — ไม่ยิง API 300 ครั้ง) → ลงเพิ่มผ่านฟอร์ม → แถบ alert ข้อความ LIMIT_REACHED busyCount (ทั้ง 2 ภาษา)
//   - ย้อนหลัง: ตัวเลือกวันกันไว้ก่อน (วัน < วันนี้−7 เป็น aria-disabled กดไม่ได้) · ฝั่งเซิร์ฟเวอร์ตอบ LIMIT_REACHED busyBackdate ใน busy-api.spec.ts
//   - ปุ่ม "วันนี้" ใช้ tz ของกลุ่ม ไม่ใช่ tz ของเบราว์เซอร์ (เบราว์เซอร์อยู่คนละวันกับกรุงเทพ)
import { expect, newDeviceContext, test } from './support/auth';
import { addDays, addMonths, monthOf, seedBusyBulk, todayBkk } from './support/busy';
import { addButton, cell, monthGrid, openCalendar } from './support/calendar-ui';
import { setPrefs } from './support/fixtures';
import { createGroupApi, membersApi, person, signup, userIdOf } from './support/groups';
import { LOCALES, msg } from './support/messages';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'ตรรกะไม่ขึ้นกับความกว้าง');
});

for (const locale of LOCALES) {
  test(`${locale}: ครบ 300 → ลงเพิ่มได้แค่เห็นข้อความ LIMIT_REACHED · ของฉันเตือนใกล้เต็ม · ฟอร์มไม่หาย`, async ({ newDevice, baseURL }) => {
    const a = await newDevice();
    await setPrefs(a.context, baseURL!, { locale });
    const pa = person('Lim');
    await signup(a.context, pa);
    const gid = await createGroupApi(a.context.request, `Lim ${Date.now().toString(36)}`);
    await seedBusyBulk(userIdOf(await membersApi(a.context.request, gid), pa), 300);

    await openCalendar(a.page, { view: 'mine' });
    await expect(a.page.getByTestId('busy-mine-near')).toContainText(msg(locale, 'busy.mine.limitNear', { count: 300, max: 300 }));

    const day = addDays(todayBkk(), 2);
    await openCalendar(a.page, { gid, view: 'day', date: day });
    await addButton(a.page).click();
    const sheet = a.page.getByRole('dialog');
    const title = `ต้องไม่หาย ${locale}`;
    await sheet.getByTestId('busy-title').fill(title);
    await sheet.getByTestId('busy-submit').click();
    await expect(sheet.getByTestId('busy-error')).toContainText(msg(locale, 'errors.LIMIT_REACHED', { limit: 'busyCount', max: 300 }));
    await expect(sheet.getByTestId('busy-title')).toHaveValue(title); // ข้อมูลในฟอร์มไม่หาย
    await expect(sheet.getByTestId('busy-submit')).toBeEnabled();
  });
}

test('ย้อนหลัง: วันที่ < วันนี้−7 กดไม่ได้ (aria-disabled) · วันนี้−7 เลือกได้และบันทึกผ่าน', async ({ newDevice, baseURL }) => {
  const a = await newDevice();
  await setPrefs(a.context, baseURL!, { locale: 'th' });
  await signup(a.context, person('Bkd'));
  const gid = await createGroupApi(a.context.request, `Bkd ${Date.now().toString(36)}`);
  const today = todayBkk();
  const [tooOld, oldest] = [addDays(today, -8), addDays(today, -7)];

  await openCalendar(a.page, { gid, view: 'day', date: today });
  await addButton(a.page).click();
  const sheet = a.page.getByRole('dialog');
  await sheet.getByTestId('busy-date-toggle').click();
  const picker = sheet.getByTestId('busy-picker');
  // เดือนที่ตัวเลือกเปิดอยู่คือเดือนของวันนี้ — วันนี้−8/−7 อาจอยู่เดือนก่อน: ถอยเดือนจนเห็นช่องนั้น (ช่องนอกเดือนก็กดได้ จึงเห็นได้เลยถ้าอยู่ในตาราง)
  if ((await picker.getByTestId(`pk-${tooOld}`).count()) === 0) await picker.getByRole('button', { name: msg('th', 'calendar.nav.prevMonth') }).click();
  await expect(picker.getByTestId(`pk-${tooOld}`)).toHaveAttribute('aria-disabled', 'true');
  await expect(picker.getByTestId(`pk-${oldest}`)).not.toHaveAttribute('aria-disabled', 'true');
  await picker.getByTestId(`pk-${tooOld}`).click({ force: true }); // ไม่เลือก (Playwright ถือ aria-disabled ว่ากดไม่ได้ → force เพื่อพิสูจน์ว่าแอปไม่รับ)
  await expect(picker.getByTestId(`pk-${tooOld}`)).toHaveAttribute('aria-pressed', 'false');
  await picker.getByTestId(`pk-${oldest}`).click();
  await sheet.getByTestId('busy-submit').click();
  await expect(sheet).toHaveCount(0);
  await expect(a.page.getByTestId('cal-toast')).toContainText(msg('th', 'busy.toast.saved'));
});

test('ปุ่ม "วันนี้" ใช้ tz ของกลุ่ม (Asia/Bangkok) แม้เบราว์เซอร์อยู่คนละวัน', async ({ browser }, testInfo) => {
  // เบราว์เซอร์ที่ UTC−10 ช้ากว่ากรุงเทพ 17 ชม. → ก่อน 17:00 (กรุงเทพ) ยังเป็นเมื่อวาน · UTC+14 เร็ว 7 ชม. → หลัง 17:00 เป็นพรุ่งนี้ → วันที่ต่างกันเสมอ
  const bkkHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hourCycle: 'h23' }).format(Date.now()));
  const timezoneId = bkkHour < 17 ? 'Pacific/Honolulu' : 'Pacific/Kiritimati';
  const context = await newDeviceContext(browser, { ...testInfo.project.use, timezoneId });
  try {
    const page = await context.newPage();
    const pa = person('Tz');
    await signup(context, pa);
    await createGroupApi(context.request, `Tz ${Date.now().toString(36)}`);
    const browserToday = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now()));
    const today = todayBkk();
    expect(browserToday, 'เบราว์เซอร์ต้องอยู่คนละวันกับกรุงเทพ (ไม่งั้นเทสต์ไม่ได้พิสูจน์อะไร)').not.toBe(today);

    await openCalendar(page, { view: 'month', date: `${addMonths(monthOf(today), 2)}-10` });
    await expect(monthGrid(page).locator('[aria-current="date"]')).toHaveCount(0);
    await page.getByTestId('cal-today').click();
    await expect(cell(page, today)).toHaveAttribute('aria-current', 'date');
    await expect(monthGrid(page).locator('[aria-current="date"]')).toHaveCount(1);
  } finally {
    await context.close();
  }
});
