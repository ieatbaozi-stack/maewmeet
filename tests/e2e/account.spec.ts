// R5-1 / R5-2 / R5-8 — บัญชีของฉันในเบราว์เซอร์จริง:
//   เปลี่ยนชื่อที่แสดง → เพื่อนในกลุ่มเห็นชื่อใหม่ · ลบบัญชี (ปกติ) → /login, เข้าใหม่ไม่ได้, นัดที่สร้างยังอยู่ ผู้สร้าง/แจ้งเตือนแสดง "บัญชีที่ถูกลบ" ·
//   ลบบัญชีตอนเป็นผู้ดูแลกลุ่ม → รายชื่อกลุ่ม + ลิงก์ไปตั้งค่า ไม่มีอะไรถูกลบ · PIN ผิด → ข้อความ ไม่ลบ · super admin ไม่มีปุ่มลบ
// เรื่องราวรันที่ mobile-390 ตัวเดียว (ตรรกะไม่ขึ้นกับความกว้าง) · เลย์เอาต์ทุกความกว้างอยู่ใน r5-layout.spec.ts
import { expect, GOOD_PIN, OTHER_PIN, test } from './support/auth';
import { account, deleteAccountInUi, loginApi, userById, userIdByUsername } from './support/account';
import { call, createApptApi, daysAhead } from './support/appt';
import { createGroupApi, joinViaApiCode } from './support/groups';
import { watchConsole } from './support/fixtures';
import { LOCALES, msg } from './support/messages';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องราวเต็มรันที่ mobile-390 ตัวเดียว');
});

const slot = (d: string, s = '10:00', e = '11:00') => ({ startDate: d, startTime: s, endDate: d, endTime: e });

for (const locale of LOCALES) {
  test(`${locale}: เปลี่ยนชื่อที่แสดง → เพื่อนในกลุ่มเห็นชื่อใหม่ · ชื่อว่างถูกปฏิเสธ`, async ({ newDevice, baseURL }) => {
    const owner = await account(newDevice, baseURL!, { locale, label: 'Own' });
    const me = await account(newDevice, baseURL!, { locale, label: 'Me' });
    const gid = await createGroupApi(owner.context.request, `R5 rename ${Date.now().toString(36)}`);
    await joinViaApiCode(owner.context.request, gid, me.context.request);
    const problems = watchConsole(me.page, (m) => /status of 400/.test(m.text) && (m.url ?? '').endsWith('/api/me'));

    await me.page.goto('/me', { waitUntil: 'networkidle' });
    await me.page.getByTestId('me-rename').click();
    const sheet = me.page.getByRole('dialog', { name: msg(locale, 'account.rename.title') });
    const field = sheet.getByLabel(msg(locale, 'account.rename.label'), { exact: true });
    await expect(field).toHaveValue(me.displayName);

    // ว่าง → ข้อความใต้ช่อง (ไม่ส่ง)
    await field.fill('   ');
    await sheet.getByRole('button', { name: msg(locale, 'account.rename.save') }).click();
    await expect(sheet.getByRole('alert')).toHaveText(msg(locale, 'account.rename.invalid', { reason: 'TOO_SHORT', max: 40 }));

    const newName = `${locale === 'th' ? 'แมวส้ม' : 'Ginger'} ${Math.random().toString(16).slice(2, 6)}`;
    await field.fill(newName);
    await sheet.getByRole('button', { name: msg(locale, 'account.rename.save') }).click();
    await expect(me.page.getByRole('status').filter({ hasText: msg(locale, 'account.rename.done') })).toBeVisible();
    await expect(me.page.locator('.account-name')).toHaveText(newName);

    // เพื่อนเห็นชื่อใหม่ในรายชื่อสมาชิกทันที (join จาก user.display_name)
    await owner.page.goto(`/groups/${gid}`, { waitUntil: 'networkidle' });
    await expect(owner.page.getByText(newName, { exact: true }).first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test(`${locale}: ลบบัญชี → /login · เข้าใหม่ไม่ได้ · นัดที่สร้างยังอยู่ (ผู้สร้างเป็นบัญชีที่ถูกลบ) · แจ้งเตือนของเพื่อนแสดงบัญชีที่ถูกลบ`, async ({ newDevice, baseURL }) => {
    test.setTimeout(120_000);
    const owner = await account(newDevice, baseURL!, { locale, label: 'Own' });
    const me = await account(newDevice, baseURL!, { locale, label: 'Del' });
    const gid = await createGroupApi(owner.context.request, `R5 del ${Date.now().toString(36)}`);
    // ชวนตรง → รับ (เพื่อนได้แจ้งเตือน "… ตอบรับคำเชิญ" ที่อ้างชื่อเรา)
    const inv = await call<{ invite: { id: string } }>(owner.context.request, 'POST', `/api/groups/${gid}/invites/direct`, { username: me.username });
    expect(inv.status, inv.text).toBe(201);
    const acc = await call(me.context.request, 'POST', `/api/me/invites/${inv.json!.data!.invite.id}/accept`);
    expect(acc.status, acc.text).toBe(200);
    const apptId = await createApptApi(me.context.request, gid, { title: 'R5 นัดของคนที่ลบบัญชี', ...slot(daysAhead(4)) });
    const myId = await userIdByUsername(me.username);
    const problems = watchConsole(me.page);

    // PIN ผิดก่อน: ข้อความผิด ไม่ลบ
    await deleteAccountInUi(me.page, locale, OTHER_PIN);
    await expect(me.page.getByRole('alertdialog').getByRole('alert')).toContainText(msg(locale, 'errors.INVALID_CREDENTIALS', { attemptsRemaining: 4 }));
    expect((await userById(myId))?.status).toBe('active');
    await me.page.getByRole('alertdialog').getByRole('button', { name: msg(locale, 'common.cancel'), exact: true }).click();

    // PIN ถูก → /login
    await deleteAccountInUi(me.page, locale, GOOD_PIN);
    await expect(me.page).toHaveURL(/\/login$/);
    const row = await userById(myId);
    expect(row?.status).toBe('deleted');
    expect(row?.display_name).toBe('');
    expect(row?.pin_hash).toBeNull();
    // session เดิมใช้ไม่ได้ · เข้าใหม่ด้วยชื่อ/PIN เดิมไม่ได้ (ตอบเหมือนชื่อผิด)
    await me.page.goto('/me');
    await expect(me.page).toHaveURL(/\/login$/);
    expect((await loginApi(me.context.request, me.username, GOOD_PIN)).code).toBe('INVALID_CREDENTIALS');

    // เพื่อน: นัดยังอยู่ ผู้สร้างแสดงเป็นอดีตสมาชิก/บัญชีที่ถูกลบ
    await owner.page.goto(`/appointments/${apptId}`, { waitUntil: 'networkidle' });
    await expect(owner.page.getByTestId('appt-detail')).toBeVisible();
    const gonePrefix = msg(locale, 'appointments.detail.createdByGone', { date: '@@' }).split('@@')[0]!.trim();
    await expect(owner.page.getByText(gonePrefix, { exact: false })).toBeVisible();
    // แจ้งเตือน "ตอบรับคำเชิญ" ของเพื่อนแสดง "บัญชีที่ถูกลบ"
    await owner.page.goto('/notifications', { waitUntil: 'networkidle' });
    await expect(owner.page.getByTestId('notif-list')).toContainText(msg(locale, 'account.deletedName'));
    expect(problems.filter((p) => !/status of 401/.test(p.text))).toEqual([]);
  });

  test(`${locale}: ลบบัญชีตอนเป็นผู้ดูแลกลุ่ม → รายชื่อกลุ่ม + ลิงก์ไปตั้งค่า · ไม่มีอะไรถูกลบ`, async ({ newDevice, baseURL }) => {
    const me = await account(newDevice, baseURL!, { locale, label: 'Adm' });
    const groupName = `R5 admin ${Date.now().toString(36)}`;
    const gid = await createGroupApi(me.context.request, groupName);
    const myId = await userIdByUsername(me.username);
    const problems = watchConsole(me.page, (m) => /status of 409/.test(m.text));

    await deleteAccountInUi(me.page, locale, GOOD_PIN);
    const sheet = me.page.getByRole('alertdialog');
    await expect(sheet.getByRole('heading', { name: msg(locale, 'account.delete.transferTitle') })).toBeVisible();
    await expect(sheet.getByTestId('delete-transfer')).toContainText(msg(locale, 'account.delete.transferBody'));
    const link = sheet.getByRole('link', { name: msg(locale, 'account.delete.transferLink', { group: groupName }) });
    await expect(link).toHaveAttribute('href', `/groups/${gid}/settings`);
    expect((await userById(myId))?.status).toBe('active');
    await link.click();
    await expect(me.page).toHaveURL(new RegExp(`/groups/${gid}/settings$`));
    expect(problems).toEqual([]);
  });
}

test('th: super admin ไม่มีปุ่มลบบัญชี (เห็นเหตุผลแทน) · API ตอบ 403', async ({ newDevice, baseURL }) => {
  const sa = await account(newDevice, baseURL!, { locale: 'th', admin: true });
  await sa.page.goto('/me', { waitUntil: 'networkidle' });
  await expect(sa.page.getByTestId('me-delete')).toHaveCount(0);
  await expect(sa.page.getByTestId('me-delete-sa')).toHaveText(msg('th', 'account.delete.superAdmin'));
  const r = await call(sa.context.request, 'POST', '/api/me/delete', { pin: GOOD_PIN });
  expect(r.status).toBe(403);
});
