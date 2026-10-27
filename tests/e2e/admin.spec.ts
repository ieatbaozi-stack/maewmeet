// R5-3 / R5-4 / R5-6 / R5-8 — หน้าผู้ดูแลระบบในเบราว์เซอร์จริง:
//   SA ระงับผู้ใช้ → ผู้ใช้เด้งออกทันที + login ถูกปฏิเสธ ACCOUNT_SUSPENDED → ยกเลิกระงับ → เข้าได้อีก · audit แสดงการกระทำ ·
//   ปลดล็อกผู้ใช้ที่ใส่ PIN ผิดจนล็อก · กลุ่ม: รายละเอียด (ไม่มี busy/นัด) → โอน admin → ลบกลุ่ม (ยืนยันใน Sheet) ·
//   guard: ผู้ใช้ทั่วไปเห็น 404 ทุกหน้าใต้ /admin · ไม่ล็อกอิน → /login
import { expect, GOOD_PIN, pressPin, signupViaApi, test, uniqueUsername } from './support/auth';
import { account, auditCount, findUserCard, lockAccount, loginApi, sessionCount, userIdByUsername } from './support/account';
import { createGroupApi, joinViaApiCode, membersApi } from './support/groups';
import { setPrefs, watchConsole } from './support/fixtures';
import { LOCALES, msg } from './support/messages';

const ADMIN_PAGES = ['/admin', '/admin/users', '/admin/groups', '/admin/audit', '/admin/groups/00000000-0000-4000-8000-000000000000'] as const;

test.describe('guard', () => {
  test('ไม่ล็อกอิน → /login ทุกหน้าใต้ /admin', async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale: 'en' });
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login$/);
    }
  });

  for (const locale of LOCALES) {
    test(`${locale}: ผู้ใช้ทั่วไปเห็นหน้า 404 ทุกหน้าใต้ /admin · API 403`, async ({ page, context, baseURL }) => {
      await setPrefs(context, baseURL!, { locale });
      await signupViaApi(context.request, { username: uniqueUsername() });
      for (const path of ADMIN_PAGES) {
        await page.goto(path, { waitUntil: 'networkidle' });
        await expect(page.getByRole('heading', { level: 1 }), path).toHaveText(msg(locale, 'notFound.title'));
      }
      await expect(page.getByText(msg(locale, 'admin.title'))).toHaveCount(0);
      for (const path of ['/api/admin/users', '/api/admin/groups', '/api/admin/audit']) {
        expect((await context.request.get(path)).status(), path).toBe(403);
      }
    });
  }
});

test.describe('เรื่องราว', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องราวเต็มรันที่ mobile-390 ตัวเดียว');
  });

  for (const locale of LOCALES) {
    test(`${locale}: SA ระงับผู้ใช้ → ผู้ใช้เด้งออก · login ถูกปฏิเสธ · audit แสดง · ยกเลิกระงับ → เข้าได้`, async ({ newDevice, baseURL }) => {
      test.setTimeout(120_000);
      const sa = await account(newDevice, baseURL!, { locale, admin: true });
      const user = await account(newDevice, baseURL!, { locale, label: 'Sus' });
      const userId = await userIdByUsername(user.username);
      const saProblems = watchConsole(sa.page);

      // ผู้ใช้กำลังใช้งานอยู่
      await user.page.goto('/me', { waitUntil: 'networkidle' });
      await expect(user.page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'me.title'));

      // SA: หน้าแรก → ผู้ใช้ → ค้นหา → ระงับ (Sheet บอกผลที่ตามมา)
      await sa.page.goto('/admin', { waitUntil: 'networkidle' });
      await expect(sa.page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'admin.title'));
      await sa.page.getByTestId('admin-hub-users').click();
      await expect(sa.page).toHaveURL(/\/admin\/users$/);
      let card = await findUserCard(sa.page, locale, user.username);
      await expect(card).toHaveAttribute('data-status', 'active');
      await card.getByRole('button', { name: msg(locale, 'adminUsers.suspendFor', { username: user.username }) }).click();
      const sheet = sa.page.getByRole('alertdialog');
      await expect(sheet.getByRole('heading', { name: msg(locale, 'adminUsers.suspendSheet.title', { username: user.username }) })).toBeVisible();
      await expect(sheet).toContainText(msg(locale, 'adminUsers.suspendSheet.body'));
      await expect(sheet.getByRole('button', { name: msg(locale, 'common.cancel'), exact: true })).toBeFocused();
      await sheet.getByRole('button', { name: msg(locale, 'adminUsers.suspendSheet.confirm'), exact: true }).click();
      await expect(sa.page.getByRole('status').filter({ hasText: msg(locale, 'adminUsers.suspended', { username: user.username }) })).toBeVisible();
      await expect(card).toHaveAttribute('data-status', 'suspended');
      expect(await sessionCount(userId)).toBe(0);

      // ผู้ใช้: หน้าถัดไปเด้งไป /login · login ด้วย PIN ถูก → ACCOUNT_SUSPENDED
      await user.page.reload();
      await expect(user.page).toHaveURL(/\/login$/);
      const loginProblems = watchConsole(user.page, (m) => /status of 401/.test(m.text));
      await user.page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(user.username);
      await pressPin(user.page, locale, GOOD_PIN);
      await expect(user.page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText(msg(locale, 'errors.ACCOUNT_SUSPENDED'));
      expect(loginProblems).toEqual([]);

      // audit: กรองด้วย action → แถวของการระงับ (ผู้ทำ = SA)
      await sa.page.goto('/admin/audit', { waitUntil: 'networkidle' });
      await sa.page.getByLabel(msg(locale, 'adminAudit.targetId'), { exact: true }).fill(userId);
      await sa.page.getByRole('button', { name: msg(locale, 'adminAudit.apply'), exact: true }).click();
      const row = sa.page.locator('[data-testid="audit-row"][data-action="admin.user.suspend"]');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(msg(locale, 'adminAudit.actions.admin_user_suspend'));
      await expect(row).toContainText(sa.username);
      await expect(row).toContainText(msg(locale, 'adminAudit.value', { value: 'suspended' }));

      // ยกเลิกระงับ → เข้าได้อีก
      card = await findUserCard(sa.page, locale, user.username);
      await card.getByRole('button', { name: msg(locale, 'adminUsers.unsuspendFor', { username: user.username }) }).click();
      await sa.page.getByRole('alertdialog').getByRole('button', { name: msg(locale, 'adminUsers.unsuspendSheet.confirm'), exact: true }).click();
      await expect(sa.page.getByRole('status').filter({ hasText: msg(locale, 'adminUsers.unsuspended', { username: user.username }) })).toBeVisible();
      expect((await loginApi(user.context.request, user.username, GOOD_PIN)).status).toBe(200);
      expect(await auditCount('admin.user.suspend', userId)).toBe(2);
      expect(saProblems).toEqual([]);
    });
  }

  test('th: SA ปลดล็อกผู้ใช้ที่ใส่ PIN ผิดจนล็อก → ผู้ใช้เข้าได้ทันที · มี audit', async ({ newDevice, baseURL }) => {
    const sa = await account(newDevice, baseURL!, { locale: 'th', admin: true });
    const user = await account(newDevice, baseURL!, { locale: 'th', label: 'Lck' });
    const userId = await userIdByUsername(user.username);
    const other = await newDevice();
    await lockAccount(other.context.request, user.username);
    expect((await loginApi(other.context.request, user.username, GOOD_PIN)).code).toBe('LOGIN_LOCKED');

    const card = await findUserCard(sa.page, 'th', user.username);
    await expect(card.locator('.admin-facts .is-warn')).toBeVisible();
    await card.getByRole('button', { name: msg('th', 'adminUsers.unlockFor', { username: user.username }) }).click();
    const sheet = sa.page.getByRole('alertdialog');
    await expect(sheet).toContainText(msg('th', 'adminUsers.unlockSheet.body'));
    await sheet.getByRole('button', { name: msg('th', 'adminUsers.unlockSheet.confirm'), exact: true }).click();
    await expect(sa.page.getByRole('status').filter({ hasText: msg('th', 'adminUsers.unlocked', { username: user.username }) })).toBeVisible();
    expect((await loginApi(other.context.request, user.username, GOOD_PIN)).status).toBe(200);
    expect(await auditCount('admin.user.unlock', userId)).toBe(1);

    // การ์ดของ SA เอง: ไม่มีปุ่มระงับ/ปลดล็อก (เซิร์ฟเวอร์ปฏิเสธอีกชั้น)
    const self = await findUserCard(sa.page, 'th', sa.username);
    await expect(self.getByRole('button')).toHaveCount(0);
  });

  for (const locale of LOCALES) {
    test(`${locale}: SA เปิดรายละเอียดกลุ่ม (ไม่มี busy/นัด) → โอน admin → ลบกลุ่ม · audit ครบ`, async ({ newDevice, baseURL }) => {
      test.setTimeout(120_000);
      const sa = await account(newDevice, baseURL!, { locale, admin: true });
      const owner = await account(newDevice, baseURL!, { locale, label: 'Own' });
      const friend = await account(newDevice, baseURL!, { locale, label: 'Frd' });
      const groupName = `R5 SA ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
      const gid = await createGroupApi(owner.context.request, groupName);
      await joinViaApiCode(owner.context.request, gid, friend.context.request);
      const problems = watchConsole(sa.page);

      await sa.page.goto('/admin/groups', { waitUntil: 'networkidle' });
      await sa.page.getByLabel(msg(locale, 'adminGroups.searchLabel'), { exact: true }).fill(groupName);
      await sa.page.getByRole('button', { name: msg(locale, 'admin.search'), exact: true }).click();
      await sa.page.getByRole('link', { name: msg(locale, 'adminGroups.openAria', { group: groupName }) }).click();
      await expect(sa.page).toHaveURL(new RegExp(`/admin/groups/${gid}$`));
      const detail = sa.page.getByTestId('admin-group-detail');
      await expect(detail).toContainText(groupName);
      await expect(detail).toHaveAttribute('data-deleted', 'false');
      await expect(sa.page.getByTestId('admin-group-members').locator('li')).toHaveCount(2);
      await expect(sa.page.getByText(msg(locale, 'adminGroup.privacyNote'))).toBeVisible();
      expect(await auditCount('admin.group.view', gid)).toBeGreaterThanOrEqual(1);

      // โอน admin ให้เพื่อน
      await sa.page.getByLabel(msg(locale, 'adminGroup.transfer.pick'), { exact: true }).selectOption({ label: `${friend.displayName} (${friend.username})` });
      await sa.page.getByTestId('admin-transfer').click();
      const tSheet = sa.page.getByRole('alertdialog');
      await expect(tSheet).toContainText(msg(locale, 'adminGroup.transfer.confirm.body', { name: friend.displayName }));
      await tSheet.getByRole('button', { name: msg(locale, 'adminGroup.transfer.confirm.confirm', { name: friend.displayName }), exact: true }).click();
      await expect(sa.page.getByRole('status').filter({ hasText: msg(locale, 'adminGroup.transfer.done', { name: friend.displayName }) })).toBeVisible();
      const roles = await membersApi(friend.context.request, gid);
      expect(roles.find((m) => m.displayName === friend.displayName)?.role).toBe('admin');
      expect(roles.find((m) => m.displayName === owner.displayName)?.role).toBe('moderator');

      // ลบกลุ่ม: ปุ่มยืนยันกดไม่ได้จนพิมพ์ชื่อตรง
      await sa.page.getByTestId('admin-delete-group').click();
      const dSheet = sa.page.getByRole('alertdialog');
      await expect(dSheet).toContainText(msg(locale, 'adminGroup.delete.confirm.body', { count: 2 }));
      const confirm = dSheet.getByRole('button', { name: msg(locale, 'adminGroup.delete.confirm.confirm'), exact: true });
      await expect(confirm).toBeDisabled();
      await dSheet.getByLabel(msg(locale, 'adminGroup.delete.confirm.typeLabel'), { exact: true }).fill(groupName);
      await confirm.click();
      await expect(sa.page.getByRole('status').filter({ hasText: msg(locale, 'adminGroup.delete.done', { group: groupName }) })).toBeVisible();
      await expect(sa.page.getByTestId('admin-group-detail')).toHaveAttribute('data-deleted', 'true');
      await expect(sa.page.getByTestId('admin-delete-group')).toHaveCount(0);
      expect(await auditCount('group.transferAdmin', gid)).toBe(1);
      expect(await auditCount('group.delete', gid)).toBe(1);

      // audit: กรองรหัสเป้าหมาย = กลุ่ม → เห็นการลบ (ป้ายภาษาคน)
      await sa.page.goto('/admin/audit', { waitUntil: 'networkidle' });
      await sa.page.getByLabel(msg(locale, 'adminAudit.targetId'), { exact: true }).fill(gid);
      await sa.page.getByRole('button', { name: msg(locale, 'adminAudit.apply'), exact: true }).click();
      await expect(sa.page.locator('[data-testid="audit-row"][data-action="group.delete"]')).toContainText(msg(locale, 'adminAudit.actions.group_delete'));
      expect(problems).toEqual([]);
    });
  }
});
