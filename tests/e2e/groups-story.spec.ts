// R2-9 — เรื่องราวกลุ่มในเบราว์เซอร์จริง (ไทย/อังกฤษ) · รันที่ mobile-390 ตัวเดียว (ตรรกะไม่ขึ้นกับความกว้าง · เลย์เอาต์ทุกความกว้างอยู่ใน groups-responsive.spec.ts)
//
//  A สร้างกลุ่ม → A สร้างโค้ด (อ่านจาก sheet) → B ใส่โค้ดเข้ากลุ่ม (เครื่องอื่น) · โค้ดผิด → ข้อความ INVITE_INVALID
//  A ชวนตรง C ด้วย username → C รับที่แท็บกลุ่ม · B เห็นตั้งค่าแบบอ่านอย่างเดียวขณะเป็น member
//  A ตั้ง B เป็น moderator → A โอน admin ให้ B → A ออกจากกลุ่ม → A เห็นหน้า not-found ของกลุ่มเดิม
//  B (admin ใหม่) สร้างโค้ดที่ 2 แล้วเพิกถอน → D ใช้ไม่ได้ (INVITE_INVALID) → B ลบกลุ่ม → C เห็น not-found
//
// ข้อจำกัดที่ไม่ทดสอบในเบราว์เซอร์ (ทดสอบระดับ integration แล้ว):
//   - สมาชิกเต็ม 50 → LIMIT_REACHED (ข้อความ errors.LIMIT_REACHED{limit:members}): tests/groups/invite-code.test.ts · direct-invite.test.ts
//     (ต้องสร้างผู้ใช้ 50 คนผ่าน argon2 — ไม่คุ้มใน e2e) · ข้อความ 2 ภาษาครอบโดย tests/i18n + tests/ui/groups-errors.test.ts
//   - โค้ดหมดอายุ 7 วัน (ต้องจำลองนาฬิกา — next start ไม่มี hook): tests/groups/invite-code.test.ts
import type { Page } from '@playwright/test';
import { alertOf, expect, test } from './support/auth';
import { setPrefs, watchConsole } from './support/fixtures';
import { api, createGroupApi, go, joinViaApiCode, membersApi, person, setRoleApi, signup, userIdOf } from './support/groups';
import { LOCALES, msg, type Locale } from './support/messages';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องราวเต็มรันที่ mobile-390 ตัวเดียว');
});

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const button = (scope: Pick<Page, 'getByRole'>, name: string) => scope.getByRole('button', { name, exact: true });
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
// R8: แถวของสมาชิกที่ยังไม่ลง busy ต่อประโยค noBusyAria ท้าย aria-label → จับตามคำนำหน้า (ขึ้นต้น rowAria แล้วตามด้วย "." หรือจบ) ไม่ใช้ exact
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const memberRow = (page: Page, locale: Locale, displayName: string, role: 'admin' | 'moderator' | 'member') =>
  page.getByRole('group', { name: new RegExp(`^${escapeRe(msg(locale, 'group.members.rowAria', { name: displayName, role: msg(locale, `roles.${role}`) }))}(\\.|$)`) });
const manageBtn = (page: Page, locale: Locale, displayName: string) =>
  page.getByRole('button', { name: msg(locale, 'group.members.actionsAria', { name: displayName }), exact: true });
const gidOf = (page: Page) => /\/groups\/([0-9a-f-]{36})/.exec(page.url())![1]!;

async function expectNotFound(page: Page, locale: Locale, path: string) {
  await go(page, path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(h1(page)).toHaveText(msg(locale, 'notFound.title'));
}

/** สร้างโค้ดที่หน้าตั้งค่า → อ่านโค้ดเต็มจาก sheet → ปิด sheet (โค้ดไม่อยู่ในหน้าอีก) */
async function createCodeInUi(page: Page, locale: Locale): Promise<string> {
  await button(page, msg(locale, 'groupSettings.invite.code.create')).click();
  const sheet = page.getByRole('dialog', { name: msg(locale, 'groupSettings.invite.sheet.title'), exact: true });
  await expect(sheet.getByText(msg(locale, 'groupSettings.invite.sheet.onceTitle'))).toBeVisible();
  const code = (await sheet.getByTestId('invite-code').textContent())!.trim();
  expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/); // 31 ตัวอักษร ตัด 0 O 1 I L
  await button(sheet, msg(locale, 'groupSettings.invite.sheet.done')).click();
  await expect(sheet).toHaveCount(0);
  // ปิดแล้วโค้ดเต็มไม่อยู่ในหน้าอีก (เห็นแค่ 4 ตัวท้าย)
  await expect(page.locator('body')).not.toContainText(code);
  await expect(page.getByText(msg(locale, 'groupSettings.invite.code.hint', { hint: code.slice(-4) }))).toBeVisible();
  return code;
}

async function joinWithCode(page: Page, locale: Locale, code: string, opener: 'empty' | 'list') {
  await go(page, '/groups');
  await button(page, msg(locale, opener === 'empty' ? 'empty.groups.joinCode' : 'groups.join.cta')).click();
  const sheet = page.getByRole('dialog', { name: msg(locale, 'groups.join.title'), exact: true });
  await sheet.getByLabel(msg(locale, 'groups.join.label'), { exact: true }).fill(code);
  await button(sheet, msg(locale, 'groups.join.submit')).click();
  return sheet;
}

for (const locale of LOCALES) {
  test(`${locale}: สร้างกลุ่ม → โค้ด → B เข้า · ชวนตรง C · moderator → โอน admin → A ออก → เพิกถอนโค้ด → D เข้าไม่ได้ → ลบกลุ่ม`, async ({ newDevice, baseURL }) => {
    test.setTimeout(180_000);
    const [a, b, c, d] = await Promise.all([newDevice(), newDevice(), newDevice(), newDevice()]);
    for (const x of [a, b, c, d]) await setPrefs(x.context, baseURL!, { locale });
    const [pa, pb, pc, pd] = [person('Ann'), person('Ben'), person('Cat'), person('Dan')];
    for (const [x, p] of [[a, pa], [b, pb], [c, pc], [d, pd]] as const) await signup(x.context, p);
    // ข้อความ 4xx จาก fetch (โค้ดผิด 404/…) เป็นสิ่งที่คาดไว้ในเรื่องนี้ — ที่เหลือ (pageerror, CSP, error อื่น) ต้องไม่มี
    const expectedApiFail = (m: { text: string; url?: string }) => /status of (4\d\d)/.test(m.text) && /\/api\//.test(m.url ?? '');
    const problems = [a, b, c, d].map((x) => watchConsole(x.page, expectedApiFail));
    const groupName = `Story ${locale} ${Date.now().toString(36)}`;

    // ───── 1) A สร้างกลุ่มจากแท็บกลุ่ม (สถานะว่าง) ─────
    await go(a.page, '/groups');
    await expect(h1(a.page)).toHaveText(msg(locale, 'nav.groups'));
    await expect(a.page.getByRole('heading', { level: 2, name: msg(locale, 'empty.groups.title') })).toBeVisible();
    await button(a.page, msg(locale, 'groups.create')).click();
    const createSheet = a.page.getByRole('dialog', { name: msg(locale, 'groups.createSheet.title'), exact: true });
    await createSheet.getByLabel(msg(locale, 'groups.createSheet.name'), { exact: true }).fill(groupName);
    await button(createSheet, msg(locale, 'groups.createSheet.submit')).click();
    await expect(a.page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);
    const gid = gidOf(a.page);
    await expect(h1(a.page)).toHaveText(groupName);
    await expect(status(a.page, msg(locale, 'groups.createSheet.created', { name: groupName }))).toBeVisible();
    await expect(a.page.getByText(msg(locale, 'group.yourRole', { role: 'admin' }))).toBeVisible();
    // R8: แถบขั้นตอนแทนการ์ด solo — ขั้น 1 เป็นขั้นถัดไป ใช้ soloBody
    await expect(a.page.getByTestId('group-steps')).toBeVisible();
    await expect(a.page.locator('[data-step="invite"]')).toHaveAttribute('data-state', 'next');
    await expect(a.page.getByText(msg(locale, 'group.steps.invite.soloBody'))).toBeVisible();
    await expect(memberRow(a.page, locale, pa.displayName, 'admin')).toBeVisible();

    // ───── 2) A สร้างโค้ดที่ตั้งค่ากลุ่ม ─────
    await a.page.getByRole('link', { name: msg(locale, 'group.settings'), exact: true }).click();
    await expect(a.page).toHaveURL(/\/settings$/);
    await expect(h1(a.page)).toHaveText(msg(locale, 'groupSettings.title'));
    await a.page.waitForLoadState('networkidle');
    const code = await createCodeInUi(a.page, locale);

    // ───── 3) โค้ดผิด → INVITE_INVALID (D) · แล้ว B ใส่โค้ดจริงเข้ากลุ่ม ─────
    let sheet = await joinWithCode(d.page, locale, 'ZZZZ-ZZZZ', 'empty');
    await expect(alertOf(d.page).filter({ hasText: msg(locale, 'errors.INVITE_INVALID') })).toBeVisible();
    await expect(sheet).toBeVisible(); // ยังอยู่ใน sheet — ไม่ถูกพาออก
    const wrongCodeText = (await alertOf(d.page).filter({ hasText: msg(locale, 'errors.INVITE_INVALID') }).first().innerText()).trim();
    await expect(d.page).toHaveURL(/\/groups$/);

    sheet = await joinWithCode(b.page, locale, code, 'empty');
    await expect(b.page).toHaveURL(new RegExp(`/groups/${gid}$`));
    await expect(h1(b.page)).toHaveText(groupName);
    await expect(status(b.page, msg(locale, 'groups.join.joined', { name: groupName }))).toBeVisible();
    await expect(b.page.getByText(msg(locale, 'group.yourRole', { role: 'member' }))).toBeVisible();
    await expect(memberRow(b.page, locale, pb.displayName, 'member')).toBeVisible();
    await expect(memberRow(b.page, locale, pa.displayName, 'admin')).toBeVisible();

    // B ใช้โค้ดซ้ำ (เป็นสมาชิกอยู่แล้ว) → เข้าหน้ากลุ่มพร้อมข้อความ "อยู่แล้ว" ไม่สร้างแถวซ้ำ
    await joinWithCode(b.page, locale, code, 'list');
    await expect(b.page).toHaveURL(new RegExp(`/groups/${gid}$`));
    await expect(status(b.page, msg(locale, 'groups.join.already', { name: groupName }))).toBeVisible();
    expect((await membersApi(a.context.request, gid)).length).toBe(2);

    // ───── 4) B (member): ตั้งค่าแบบอ่านอย่างเดียว ─────
    await go(b.page, `/groups/${gid}/settings`);
    await expect(b.page.getByText(msg(locale, 'groupSettings.memberNote'))).toBeVisible();
    await expect(b.page.getByRole('textbox', { name: msg(locale, 'groupSettings.name.label'), exact: true })).toHaveCount(0); // ไม่มีช่องแก้ชื่อ
    await expect(b.page.getByText(groupName, { exact: true }).first()).toBeVisible(); // เห็นชื่อเป็นข้อความ
    await expect(button(b.page, msg(locale, 'common.save'))).toHaveCount(0);
    await expect(b.page.locator('select')).toHaveCount(0); // ช่วงเวลาว่างเป็นข้อความอ่านอย่างเดียว ไม่มีตัวเลือก
    await expect(b.page.locator('ul.m-rows button')).toHaveCount(0); // ไม่มีปุ่มจัดการสมาชิกสักแถว
    await expect(b.page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.transfer.title'), exact: true })).toHaveCount(0);
    await expect(b.page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.delete.title'), exact: true })).toHaveCount(0);
    // ยังชวนเพื่อนได้และออกได้ (member): ส่วนชวน + ปุ่มออกมี; เห็นเฉพาะโค้ดของตัวเอง (ข้อความ mineOnly)
    await expect(b.page.getByText(msg(locale, 'groupSettings.invite.mineOnly'))).toBeVisible();
    await expect(button(b.page, msg(locale, 'groupSettings.leave.cta'))).toBeEnabled();
    // เซิร์ฟเวอร์ตรวจซ้ำ: member แก้ชื่อ/ตั้งบทบาท/ลบ ตรง ๆ ไม่ได้ (403) — ไม่ใช่แค่ซ่อนปุ่ม
    const aId = userIdOf(await membersApi(a.context.request, gid), pa);
    expect((await api(b.context.request, 'PATCH', `/api/groups/${gid}`, { name: 'hijack' })).status).toBe(403);
    expect((await api(b.context.request, 'DELETE', `/api/groups/${gid}`)).status).toBe(403);
    expect((await api(b.context.request, 'DELETE', `/api/groups/${gid}/members/${aId}`)).status).toBe(403);
    expect((await api(b.context.request, 'POST', `/api/groups/${gid}/transfer-admin`, { toUserId: aId })).status).toBe(403);

    // ───── 5) A ชวนตรง C ด้วย username → C รับที่แท็บกลุ่ม ─────
    await go(a.page, `/groups/${gid}/settings`);
    await a.page.getByLabel(msg(locale, 'groupSettings.invite.direct.label'), { exact: true }).fill('no_such_user_zz');
    await button(a.page, msg(locale, 'groupSettings.invite.direct.submit')).click();
    await expect(alertOf(a.page).filter({ hasText: msg(locale, 'errors.USER_NOT_FOUND') })).toBeVisible();
    await a.page.getByLabel(msg(locale, 'groupSettings.invite.direct.label'), { exact: true }).fill(pc.username);
    await button(a.page, msg(locale, 'groupSettings.invite.direct.submit')).click();
    await expect(status(a.page, msg(locale, 'groupSettings.invite.direct.sent', { username: pc.username }))).toBeVisible();
    await expect(a.page.getByText(msg(locale, 'groupSettings.invite.direct.waiting', { username: pc.displayName }))).toBeVisible();

    await go(c.page, '/groups');
    await expect(c.page.getByText(msg(locale, 'groups.invites.item', { inviter: pa.displayName, group: groupName }))).toBeVisible();
    await button(c.page, msg(locale, 'groups.invites.acceptAria', { group: groupName })).click();
    await expect(status(c.page, msg(locale, 'groups.invites.accepted', { group: groupName }))).toBeVisible();
    await c.page.getByRole('link', { name: msg(locale, 'groups.openAria', { name: groupName, count: 3 }), exact: true }).click();
    await expect(c.page).toHaveURL(new RegExp(`/groups/${gid}$`));
    await expect(memberRow(c.page, locale, pc.displayName, 'member')).toBeVisible();
    expect((await membersApi(a.context.request, gid)).map((m) => m.role).sort()).toEqual(['admin', 'member', 'member']);

    // ───── 6) A ตั้ง B เป็น moderator ผ่านชีตจัดการสมาชิก ─────
    await go(a.page, `/groups/${gid}/settings`);
    await expect(a.page.getByText(msg(locale, 'groupSettings.invite.direct.waiting', { username: pc.displayName }))).toHaveCount(0); // C รับแล้ว ไม่ค้าง
    await manageBtn(a.page, locale, pb.displayName).click();
    const manage = a.page.getByRole('dialog', { name: msg(locale, 'groupSettings.members.manageTitle', { name: pb.displayName }), exact: true });
    await expect(button(manage, msg(locale, 'groupSettings.members.transfer'))).toBeVisible();
    await expect(button(manage, msg(locale, 'groupSettings.members.remove'))).toBeVisible();
    await button(manage, msg(locale, 'groupSettings.members.makeModerator')).click();
    await expect(status(a.page, msg(locale, 'groupSettings.members.roleChanged', { role: 'moderator', name: pb.displayName }))).toBeVisible();
    await expect(memberRow(a.page, locale, pb.displayName, 'moderator')).toBeVisible();
    // บน A ไม่มีปุ่มจัดการของตัวเอง; B เห็นสิทธิ์ใหม่ทันทีหลังโหลด: แก้ชื่อได้ (ช่องแก้ไขโผล่) แต่ไม่มีส่วนโอน/ลบ
    await expect(manageBtn(a.page, locale, pa.displayName)).toHaveCount(0);
    await go(b.page, `/groups/${gid}/settings`);
    await expect(b.page.getByRole('textbox', { name: msg(locale, 'groupSettings.name.label'), exact: true })).toBeVisible();
    await expect(b.page.getByText(msg(locale, 'groupSettings.memberNote'))).toHaveCount(0);
    await expect(b.page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.delete.title'), exact: true })).toHaveCount(0);
    await expect(manageBtn(b.page, locale, pa.displayName)).toHaveCount(0); // moderator ไม่มีปุ่มจัดการ admin
    await expect(manageBtn(b.page, locale, pc.displayName)).toBeVisible(); // แต่จัดการ member ได้ (ลบ)

    // ───── 7) A โอน admin ให้ B → A กลายเป็น moderator ─────
    await a.page.getByLabel(msg(locale, 'groupSettings.transfer.pick'), { exact: true }).selectOption({ label: pb.displayName });
    await button(a.page, msg(locale, 'groupSettings.transfer.cta')).click();
    const confirmTransfer = a.page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.transfer.confirm.title', { name: pb.displayName }), exact: true });
    await expect(confirmTransfer.getByText(msg(locale, 'groupSettings.transfer.confirm.body', { name: pb.displayName }))).toBeVisible();
    await button(confirmTransfer, msg(locale, 'groupSettings.transfer.confirm.confirm', { name: pb.displayName })).click();
    await expect(status(a.page, msg(locale, 'groupSettings.transfer.done', { name: pb.displayName }))).toBeVisible();
    await expect(memberRow(a.page, locale, pa.displayName, 'moderator')).toBeVisible();
    await expect(memberRow(a.page, locale, pb.displayName, 'admin')).toBeVisible();
    await expect(a.page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.transfer.title'), exact: true })).toHaveCount(0); // ส่วนโอน/ลบหายตาม role ใหม่
    await expect(a.page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.delete.title'), exact: true })).toHaveCount(0);
    expect((await membersApi(b.context.request, gid)).filter((m) => m.role === 'admin').map((m) => m.displayName)).toEqual([pb.displayName]); // admin เหลือคนเดียว
    // admin เก่า (ตอนนี้ moderator) โอน/ลบกลุ่มตรง ๆ ไม่ได้
    expect((await api(a.context.request, 'DELETE', `/api/groups/${gid}`)).status).toBe(403);

    // ───── 8) A ออกจากกลุ่ม → กลับแท็บกลุ่มว่าง → URL เดิมเป็น not-found ─────
    await button(a.page, msg(locale, 'groupSettings.leave.cta')).click();
    const confirmLeave = a.page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.leave.confirm.title', { group: groupName }), exact: true });
    await button(confirmLeave, msg(locale, 'groupSettings.leave.confirm.confirm')).click();
    await expect(a.page).toHaveURL(/\/groups$/);
    await expect(status(a.page, msg(locale, 'groupSettings.leave.done', { group: groupName }))).toBeVisible();
    await expect(a.page.getByRole('heading', { level: 2, name: msg(locale, 'empty.groups.title') })).toBeVisible();
    await expectNotFound(a.page, locale, `/groups/${gid}`);
    await expectNotFound(a.page, locale, `/groups/${gid}/settings`);
    expect((await api(a.context.request, 'GET', `/api/groups/${gid}`)).status).toBe(404);

    // ───── 9) B (admin ใหม่) สร้างโค้ดที่ 2 แล้วเพิกถอน → D ใช้ไม่ได้ ─────
    await go(b.page, `/groups/${gid}/settings`);
    await expect(b.page.getByText(msg(locale, 'groupSettings.invite.code.body'))).toBeVisible(); // admin เห็นโค้ดของทุกคน
    const code2 = await createCodeInUi(b.page, locale);
    const hint2 = code2.slice(-4);
    await b.page.getByRole('button', { name: msg(locale, 'groupSettings.invite.code.revokeAria', { hint: hint2 }), exact: true }).click();
    const confirmRevoke = b.page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.invite.code.revokeConfirm.title', { hint: hint2 }), exact: true });
    await button(confirmRevoke, msg(locale, 'groupSettings.invite.code.revokeConfirm.confirm')).click();
    await expect(status(b.page, msg(locale, 'groupSettings.invite.code.revoked'))).toBeVisible();
    await expect(b.page.getByText(msg(locale, 'groupSettings.invite.code.hint', { hint: hint2 }))).toHaveCount(0);

    sheet = await joinWithCode(d.page, locale, code2, 'empty');
    await expect(alertOf(d.page).filter({ hasText: msg(locale, 'errors.INVITE_INVALID') })).toBeVisible();
    await expect(d.page).toHaveURL(/\/groups$/);
    expect((await membersApi(b.context.request, gid)).some((m) => m.displayName === pd.displayName)).toBe(false);
    // ข้อความของโค้ดที่เพิกถอน ต้องเหมือนโค้ดผิดทุกตัวอักษร (ไม่ให้เดาได้ว่าเคยมี)
    const revokedText = (await alertOf(d.page).filter({ hasText: msg(locale, 'errors.INVITE_INVALID') }).first().innerText()).trim();
    expect(revokedText).toBe(wrongCodeText);

    // ───── 10) B ลบกลุ่ม (ต้องพิมพ์ชื่อให้ตรง) → สมาชิกเห็น not-found ─────
    await button(b.page, msg(locale, 'groupSettings.delete.cta')).click();
    const confirmDelete = b.page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.delete.confirm.title', { group: groupName }), exact: true });
    const deleteBtn = button(confirmDelete, msg(locale, 'groupSettings.delete.confirm.confirm'));
    await expect(deleteBtn).toBeDisabled();
    await confirmDelete.getByLabel(msg(locale, 'groupSettings.delete.confirm.typeLabel'), { exact: true }).fill(`${groupName} x`);
    await expect(deleteBtn).toBeDisabled();
    await confirmDelete.getByLabel(msg(locale, 'groupSettings.delete.confirm.typeLabel'), { exact: true }).fill(groupName);
    await expect(deleteBtn).toBeEnabled();
    await deleteBtn.click();
    await expect(b.page).toHaveURL(/\/groups$/);
    await expect(status(b.page, msg(locale, 'groupSettings.delete.done', { group: groupName }))).toBeVisible();
    await expect(b.page.getByRole('heading', { level: 2, name: msg(locale, 'empty.groups.title') })).toBeVisible();

    // C (สมาชิกตอนถูกลบ) เห็น not-found ทั้งหน้ากลุ่ม/ตั้งค่า · รายการกลุ่มว่าง · API 404 · โค้ดที่ 1 ก็ใช้ไม่ได้แล้ว
    await expectNotFound(c.page, locale, `/groups/${gid}`);
    await expectNotFound(c.page, locale, `/groups/${gid}/settings`);
    await go(c.page, '/groups');
    await expect(c.page.getByRole('heading', { level: 2, name: msg(locale, 'empty.groups.title') })).toBeVisible();
    expect((await api(c.context.request, 'GET', `/api/groups/${gid}`)).status).toBe(404);
    await joinWithCode(d.page, locale, code, 'empty');
    await expect(alertOf(d.page).filter({ hasText: msg(locale, 'errors.INVITE_INVALID') })).toBeVisible();

    for (const p of problems) expect(p).toEqual([]);
  });
}

test('moderator ลบ/ตั้งบทบาท admin หรือ moderator ไม่ได้: UI ซ่อนปุ่ม + API 403 (และข้อมูลไม่เปลี่ยน)', async ({ newDevice, baseURL }) => {
  const locale: Locale = 'en';
  const [a, b, c, d] = await Promise.all([newDevice(), newDevice(), newDevice(), newDevice()]);
  for (const x of [a, b, c, d]) await setPrefs(x.context, baseURL!, { locale });
  const [pa, pb, pc, pd] = [person('Ann'), person('Ben'), person('Cat'), person('Dan')];
  for (const [x, p] of [[a, pa], [b, pb], [c, pc], [d, pd]] as const) await signup(x.context, p);
  const gid = await createGroupApi(a.context.request, `Mods ${Date.now().toString(36)}`);
  for (const x of [b, c, d]) await joinViaApiCode(a.context.request, gid, x.context.request);
  let members = await membersApi(a.context.request, gid);
  const [idA, idB, idC, idD] = [pa, pb, pc, pd].map((p) => userIdOf(members, p)) as [string, string, string, string];
  await setRoleApi(a.context.request, gid, idB, 'moderator');
  await setRoleApi(a.context.request, gid, idC, 'moderator');
  const before = JSON.stringify((await membersApi(a.context.request, gid)).map((m) => [m.userId, m.role]).sort());

  // UI: B (moderator) — แถว A (admin) และ C (moderator) ไม่มีปุ่มจัดการ · แถว D (member) มี และชีตมีแค่ "นำออก"
  await go(b.page, `/groups/${gid}/settings`);
  await expect(memberRow(b.page, locale, pa.displayName, 'admin')).toBeVisible();
  await expect(memberRow(b.page, locale, pc.displayName, 'moderator')).toBeVisible();
  await expect(manageBtn(b.page, locale, pa.displayName)).toHaveCount(0);
  await expect(manageBtn(b.page, locale, pc.displayName)).toHaveCount(0);
  await expect(manageBtn(b.page, locale, pb.displayName)).toHaveCount(0); // ตัวเอง
  await manageBtn(b.page, locale, pd.displayName).click();
  const sheet = b.page.getByRole('dialog', { name: msg(locale, 'groupSettings.members.manageTitle', { name: pd.displayName }), exact: true });
  await expect(button(sheet, msg(locale, 'groupSettings.members.remove'))).toBeVisible();
  await expect(button(sheet, msg(locale, 'groupSettings.members.makeModerator'))).toHaveCount(0);
  await expect(button(sheet, msg(locale, 'groupSettings.members.transfer'))).toHaveCount(0);
  await button(sheet, msg(locale, 'common.cancel')).click();
  // ไม่มีส่วนโอน admin / ลบกลุ่ม
  await expect(b.page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.transfer.title'), exact: true })).toHaveCount(0);
  await expect(b.page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.delete.title'), exact: true })).toHaveCount(0);

  // API: ลบ admin/moderator → 403 · ตั้ง/ถอดบทบาท → 403 · โอน/ลบกลุ่ม → 403
  const rb = b.context.request;
  expect((await api(rb, 'DELETE', `/api/groups/${gid}/members/${idA}`)).status).toBe(403);
  expect((await api(rb, 'DELETE', `/api/groups/${gid}/members/${idC}`)).status).toBe(403);
  expect((await api(rb, 'PATCH', `/api/groups/${gid}/members/${idD}`, { role: 'moderator' })).status).toBe(403);
  expect((await api(rb, 'PATCH', `/api/groups/${gid}/members/${idC}`, { role: 'member' })).status).toBe(403);
  expect((await api(rb, 'POST', `/api/groups/${gid}/transfer-admin`, { toUserId: idB })).status).toBe(403);
  expect((await api(rb, 'DELETE', `/api/groups/${gid}`)).status).toBe(403);
  expect(JSON.stringify((await membersApi(a.context.request, gid)).map((m) => [m.userId, m.role]).sort())).toBe(before);

  // และ moderator ลบ member ได้จริงผ่าน UI (ขอบเขตสิทธิ์ที่ถูกต้อง ไม่ใช่ปฏิเสธทุกอย่าง)
  await manageBtn(b.page, locale, pd.displayName).click();
  await button(b.page.getByRole('dialog', { name: msg(locale, 'groupSettings.members.manageTitle', { name: pd.displayName }), exact: true }), msg(locale, 'groupSettings.members.remove')).click();
  const confirm = b.page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.members.removeConfirm.title', { name: pd.displayName }), exact: true });
  await button(confirm, msg(locale, 'groupSettings.members.removeConfirm.confirm')).click();
  await expect(status(b.page, msg(locale, 'groupSettings.members.removed', { name: pd.displayName }))).toBeVisible();
  members = await membersApi(a.context.request, gid);
  expect(members.some((m) => m.userId === idD)).toBe(false);
  // D ที่ถูกนำออก เห็น not-found ทันที
  await expectNotFound(d.page, locale, `/groups/${gid}`);
});
