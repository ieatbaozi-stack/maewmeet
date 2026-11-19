// R17 G3/G4/G5 + A2 — กลุ่มที่ลบแล้วเก็บ 30 วัน super admin กู้คืนได้ (เบราว์เซอร์จริง · 375/390/768 × th/en × สว่าง/มืด):
//   SA ลบกลุ่ม (พิมพ์ชื่อผิดไม่ได้ · ข้อความกู้คืนได้ 30 วัน) → สมาชิกเข้าไม่ได้ → แถวที่ลบแสดง "ลบถาวรในอีก N วัน" + ปุ่มกู้คืน
//   → ยืนยัน → กลุ่มกลับมาให้สมาชิก (สมาชิก/บทบาทเดิม) + แจ้งเตือนในกระดิ่ง · คนที่ไม่ใช่ super admin กู้ไม่ได้ (API 403 · ไม่มีหน้า/ปุ่ม)
// "ลบมาแล้ว N วัน": ลบจริงผ่าน UI แล้วย้าย groups.deleted_at ใน DB ของเซิร์ฟเวอร์ E2E (ไม่มี hook ในโค้ดแอป)
// หมายเหตุ B2: ก่อน 2026-12-01 (Asia/Bangkok) กลุ่มที่ลบเก่าแค่ไหนก็นับ 30 วันจากวันเริ่มใช้ → เคส "ครบ 30 วัน/ลบถาวรแล้ว"
//   ทดสอบที่ vitest (นาฬิกาจำลอง) tests/platform/r17-group-retention.test.ts ไม่ใช่ที่นี่ (นาฬิกา E2E คือเวลาจริง)
import { expect, test } from './support/auth';
import { account, auditCount, backdateGroupDeletion, bangkokDaysUntil } from './support/account';
import { setPrefs, watchConsole } from './support/fixtures';
import { api, checkLayout, createGroupApi, joinViaApiCode, membersApi } from './support/groups';
import { LOCALES, msg } from './support/messages';

const COMBOS = [
  { locale: 'th', theme: 'light' },
  { locale: 'en', theme: 'dark' },
] as const;

for (const { locale, theme } of COMBOS) {
  test(`${locale} · ${theme}: SA ลบกลุ่ม → แถวที่ลบมีวันนับถอยหลัง → กู้คืน → สมาชิกได้กลุ่มคืน + แจ้งเตือน · ไม่ใช่ SA กู้ไม่ได้`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const sa = await account(newDevice, baseURL!, { locale, theme, admin: true });
    const owner = await account(newDevice, baseURL!, { locale, theme, label: 'Own' });
    const friend = await account(newDevice, baseURL!, { locale, theme, label: 'Frd' });
    const groupName = `R17 ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
    const gid = await createGroupApi(owner.context.request, groupName);
    await joinViaApiCode(owner.context.request, gid, friend.context.request);
    const p = sa.page;
    const problems = watchConsole(p);
    const friendProblems = watchConsole(friend.page);

    // ── ลบกลุ่ม (A2 + G4): ปุ่มยืนยันกดไม่ได้จนพิมพ์ชื่อตรง · ข้อความบอกกู้คืนได้ 30 วัน
    await p.goto(`/admin/groups/${gid}`, { waitUntil: 'networkidle' });
    await expect(p.getByTestId('admin-group-detail')).toHaveAttribute('data-deleted', 'false');
    await expect(p.getByTestId('admin-group-purge')).toHaveCount(0);
    await expect(p.getByTestId('admin-restore-group')).toHaveCount(0);
    await p.getByTestId('admin-delete-group').click();
    const dSheet = p.getByRole('alertdialog');
    await expect(dSheet).toContainText(msg(locale, 'adminGroup.delete.confirm.body', { count: 2 }));
    await expect(dSheet).toContainText(msg(locale, 'adminGroup.delete.confirm.typeHint', { group: groupName }));
    const confirm = dSheet.getByRole('button', { name: msg(locale, 'adminGroup.delete.confirm.confirm'), exact: true });
    await expect(dSheet.getByRole('button', { name: msg(locale, 'common.cancel'), exact: true })).toBeFocused();
    await expect(confirm).toBeDisabled();
    const typed = dSheet.getByLabel(msg(locale, 'adminGroup.delete.confirm.typeLabel'), { exact: true });
    await typed.fill(`${groupName}x`);
    await expect(confirm).toBeDisabled();
    await typed.fill(groupName.slice(0, -1));
    await expect(confirm).toBeDisabled();
    await checkLayout(p, testInfo, 'r17-admin-group-delete', locale, theme);
    expect((await api(friend.context.request, 'GET', `/api/groups/${gid}`)).status, 'ยังไม่ได้ลบ → สมาชิกยังเข้าได้').toBe(200);
    await typed.fill(groupName);
    await confirm.click();
    await expect(p.getByRole('status').filter({ hasText: msg(locale, 'adminGroup.delete.done', { group: groupName }) })).toBeVisible();
    await expect(p.getByTestId('admin-group-detail')).toHaveAttribute('data-deleted', 'true');
    expect(await auditCount('group.delete', gid)).toBe(1);
    expect((await api(friend.context.request, 'GET', `/api/groups/${gid}`)).status, 'ลบแล้ว → สมาชิกเข้าไม่ได้').toBe(404);

    // ลบมาแล้ว 20 วัน → หน้ารายละเอียดมีวันนับถอยหลัง + ปุ่มกู้คืน
    await backdateGroupDeletion(gid, 20);
    const view = await api(sa.context.request, 'GET', `/api/admin/groups/${gid}`);
    const g = (view.json as unknown as { data: { group: { purgeAt: number; restorable: boolean; restoreBlockedReason: string | null } } }).data.group;
    expect(g).toMatchObject({ restorable: true, restoreBlockedReason: null });
    const days = bangkokDaysUntil(g.purgeAt);
    expect(days).toBeGreaterThanOrEqual(0);
    await p.goto(`/admin/groups/${gid}`, { waitUntil: 'networkidle' });
    await expect(p.getByTestId('admin-group-detail')).toHaveAttribute('data-deleted', 'true');
    await expect(p.getByTestId('admin-group-purge')).toHaveAttribute('data-days', String(days));
    await expect(p.getByTestId('admin-group-purge')).toContainText(msg(locale, 'adminGroup.purgeIn', { days }));
    await expect(p.getByTestId('admin-restore-group')).toBeVisible();
    await expect(p.getByTestId('admin-delete-group')).toHaveCount(0);
    await checkLayout(p, testInfo, 'r17-admin-group-deleted', locale, theme);

    // ── รายการ: กรอง "ลบแล้ว" → แถวมีวันนับถอยหลัง + ปุ่มกู้คืน (นอกลิงก์) → ยืนยัน
    await p.goto('/admin/groups', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: msg(locale, 'adminGroups.status.deleted'), exact: true }).click();
    await p.getByLabel(msg(locale, 'adminGroups.searchLabel'), { exact: true }).fill(groupName);
    await p.getByRole('button', { name: msg(locale, 'admin.search'), exact: true }).click();
    const row = p.getByRole('link', { name: msg(locale, 'adminGroups.openAria', { group: groupName }) });
    await expect(row).toHaveAttribute('data-deleted', 'true');
    await expect(row.getByTestId('admin-group-purge')).toHaveAttribute('data-days', String(days));
    await expect(row.getByTestId('admin-group-purge')).toContainText(msg(locale, 'adminGroups.purgeIn', { days }));
    const restoreBtn = p.getByTestId('admin-group-restore');
    await expect(restoreBtn).toHaveCount(1);
    await expect(restoreBtn).toHaveAccessibleName(msg(locale, 'adminGroups.restoreAria', { group: groupName }));
    await checkLayout(p, testInfo, 'r17-admin-groups-deleted', locale, theme);
    await restoreBtn.click();
    const rSheet = p.getByRole('alertdialog');
    await expect(rSheet).toContainText(msg(locale, 'adminGroup.restore.confirm.title', { group: groupName }));
    await expect(rSheet).toContainText(msg(locale, 'adminGroup.restore.confirm.body'));
    await checkLayout(p, testInfo, 'r17-admin-group-restore-sheet', locale, theme);
    // ยกเลิก = ไม่มีอะไรเปลี่ยน
    await rSheet.getByRole('button', { name: msg(locale, 'common.cancel'), exact: true }).click();
    await expect(rSheet).toHaveCount(0);
    expect(await auditCount('group.restore', gid)).toBe(0);
    expect((await api(friend.context.request, 'GET', `/api/groups/${gid}`)).status).toBe(404);
    await restoreBtn.click();
    await p.getByRole('alertdialog').getByRole('button', { name: msg(locale, 'adminGroup.restore.confirm.confirm'), exact: true }).click();
    await expect(p.getByTestId('admin-groups-toast')).toHaveText(msg(locale, 'adminGroup.restore.done', { group: groupName }));
    await expect(p.getByRole('alertdialog')).toHaveCount(0);
    expect(await auditCount('group.restore', gid)).toBe(1);

    // กลุ่มกลับมาให้สมาชิก (สมาชิก/บทบาทเดิมครบ) + ไม่อยู่ในตัวกรอง "ลบแล้ว" อีก
    expect((await api(friend.context.request, 'GET', `/api/groups/${gid}`)).status).toBe(200);
    const members = await membersApi(friend.context.request, gid);
    expect(members.map((m) => m.displayName).sort()).toEqual([owner.displayName, friend.displayName].sort());
    expect(members.find((m) => m.displayName === owner.displayName)?.role).toBe('admin');
    await expect(p.getByTestId('admin-group-restore')).toHaveCount(0);

    // G5: สมาชิกได้แจ้งเตือนในกระดิ่ง (ไม่มีชื่อ SA) → กดไปที่กลุ่ม
    await friend.page.goto('/notifications', { waitUntil: 'networkidle' });
    const notif = friend.page.getByTestId('notif-row').filter({ hasText: msg(locale, 'notifications.group.restored', { groupName: `⁨${groupName}⁩` }) });
    await expect(notif).toHaveCount(1);
    await expect(notif).not.toContainText(sa.username);
    await notif.click();
    await expect(friend.page).toHaveURL(new RegExp(`/groups/${gid}`));

    // ไม่ใช่ super admin (admin กลุ่ม/สมาชิก): API 403 · หน้า /admin เป็น 404 · ไม่ลงบันทึกกู้คืนเพิ่ม
    for (const who of [owner, friend]) {
      expect((await api(who.context.request, 'POST', `/api/admin/groups/${gid}/restore`)).status, 'non-SA restore').toBe(403);
      await who.page.goto('/admin/groups', { waitUntil: 'networkidle' });
      await expect(who.page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'notFound.title'));
      await expect(who.page.getByTestId('admin-group-restore')).toHaveCount(0);
    }
    expect(await auditCount('group.restore', gid)).toBe(1);

    expect(problems).toEqual([]);
    // หน้า /admin ของ non-SA เป็น 404 โดยตั้งใจ (คอนโซลมี 403/404 ของ fetch)
    expect(friendProblems.filter((m) => !/status of 40[34]/.test(m.text))).toEqual([]);
  });
}

for (const locale of LOCALES) {
  test(`${locale}: ไม่ได้ล็อกอิน / คนนอก / อดีต admin ที่ไม่ใช่ SA กู้กลุ่มที่ลบไม่ได้ (API) · กลุ่มยังซ่อนอยู่`, async ({ newDevice, context, baseURL }) => {
    const owner = await account(newDevice, baseURL!, { locale, label: 'Own' });
    const outsider = await account(newDevice, baseURL!, { locale, label: 'Out' });
    const gid = await createGroupApi(owner.context.request, `R17 g ${Date.now().toString(36)}`);
    expect((await api(owner.context.request, 'DELETE', `/api/groups/${gid}`)).status).toBe(200);
    await setPrefs(context, baseURL!, { locale });
    expect((await api(context.request, 'POST', `/api/admin/groups/${gid}/restore`)).status, 'anonymous').toBe(401);
    expect((await api(outsider.context.request, 'POST', `/api/admin/groups/${gid}/restore`)).status, 'non-member non-SA').toBe(403);
    expect((await api(owner.context.request, 'POST', `/api/admin/groups/${gid}/restore`)).status, 'former admin non-SA').toBe(403);
    expect((await api(owner.context.request, 'GET', `/api/groups/${gid}`)).status, 'ยังลบอยู่').toBe(404);
    expect(await auditCount('group.restore', gid)).toBe(0);
  });
}
