// R5-8 — ทุกหน้าใหม่ของ R5 × (375/390/768 = project) × th/en × light/dark:
//   ไม่มี horizontal scroll · a/button/input ที่เห็น ≥ 44×44 · ไม่มี console error/CSP · ภาพหน้าจอเต็มหน้า → test-results/
// หน้า/สถานะ: /admin · /admin/users (+ Sheet ระงับ) · /admin/groups · /admin/groups/[gid] (+ Sheet ลบกลุ่ม) · /admin/audit ·
//   /me (+ Sheet เปลี่ยนชื่อ, Sheet ลบบัญชี ทั้งขั้นอธิบายและขั้น PIN) · /privacy (ไม่ล็อกอิน)
import { expect, test } from './support/auth';
import { account } from './support/account';
import { setPrefs, watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, joinViaApiCode } from './support/groups';
import { LOCALES, msg } from './support/messages';

const THEMES = ['light', 'dark'] as const;

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test(`${locale} · ${theme}: หน้าผู้ดูแลระบบ + บัญชี + /privacy`, async ({ newDevice, page, context, baseURL }, testInfo) => {
      test.setTimeout(180_000);
      const sa = await account(newDevice, baseURL!, { locale, theme, admin: true });
      const member = await account(newDevice, baseURL!, { locale, theme, label: 'Lay' });
      // ชื่อกลุ่มยาว + ชื่อคนยาว (ทดสอบการตัดบรรทัดในการ์ด)
      const groupName = locale === 'th' ? `ก๊วนเที่ยวทะเลช่วงปีใหม่กับเพื่อนสมัยมัธยม ${Date.now().toString(36)}` : `Long weekend beach trip with school friends ${Date.now().toString(36)}`;
      const gid = await createGroupApi(member.context.request, groupName.slice(0, 40));
      await joinViaApiCode(member.context.request, gid, sa.context.request);
      const p = sa.page;
      const problems = watchConsole(p);

      await p.goto('/admin', { waitUntil: 'networkidle' });
      await expect(p.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'admin.title'));
      await checkLayout(p, testInfo, 'r5-admin', locale, theme);

      await p.goto('/admin/users', { waitUntil: 'networkidle' });
      await expect(p.getByTestId('admin-users')).toBeVisible();
      await checkLayout(p, testInfo, 'r5-admin-users', locale, theme);
      await p.getByLabel(msg(locale, 'adminUsers.searchLabel'), { exact: true }).fill(member.username);
      await p.getByRole('button', { name: msg(locale, 'admin.search'), exact: true }).click();
      await p.getByRole('button', { name: msg(locale, 'adminUsers.suspendFor', { username: member.username }) }).click();
      await expect(p.getByRole('alertdialog')).toBeVisible();
      await checkLayout(p, testInfo, 'r5-admin-users-suspend', locale, theme);
      await p.keyboard.press('Escape');

      await p.goto('/admin/groups', { waitUntil: 'networkidle' });
      await expect(p.getByTestId('admin-groups')).toBeVisible();
      await checkLayout(p, testInfo, 'r5-admin-groups', locale, theme);

      await p.goto(`/admin/groups/${gid}`, { waitUntil: 'networkidle' });
      await expect(p.getByTestId('admin-group-detail')).toBeVisible();
      await checkLayout(p, testInfo, 'r5-admin-group', locale, theme);
      await p.getByTestId('admin-delete-group').click();
      await expect(p.getByRole('alertdialog')).toBeVisible();
      await checkLayout(p, testInfo, 'r5-admin-group-delete', locale, theme);
      await p.keyboard.press('Escape');

      await p.goto('/admin/audit', { waitUntil: 'networkidle' });
      await expect(p.getByTestId('admin-audit')).toBeVisible();
      await checkLayout(p, testInfo, 'r5-admin-audit', locale, theme);

      // แท็บ ฉัน ของผู้ใช้ทั่วไป + sheet
      const m = member.page;
      const mProblems = watchConsole(m);
      await m.goto('/me', { waitUntil: 'networkidle' });
      await checkLayout(m, testInfo, 'r5-me', locale, theme);
      await m.getByTestId('me-rename').click();
      await expect(m.getByRole('dialog')).toBeVisible();
      await checkLayout(m, testInfo, 'r5-me-rename', locale, theme);
      await m.keyboard.press('Escape');
      await m.getByTestId('me-delete').click();
      await expect(m.getByTestId('delete-info')).toBeVisible();
      await checkLayout(m, testInfo, 'r5-me-delete', locale, theme);
      await m.getByTestId('delete-continue').click();
      await expect(m.getByTestId('delete-pin')).toBeVisible();
      await checkLayout(m, testInfo, 'r5-me-delete-pin', locale, theme);

      // /privacy ไม่ล็อกอิน (page ของเทสต์ = เครื่องที่ไม่มี session)
      await setPrefs(context, baseURL!, { locale, theme });
      const pProblems = watchConsole(page);
      await page.goto('/privacy', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'privacy.title'));
      await checkLayout(page, testInfo, 'r5-privacy', locale, theme);

      expect(problems).toEqual([]);
      expect(mProblems).toEqual([]);
      expect(pProblems).toEqual([]);
    });
  }
}
