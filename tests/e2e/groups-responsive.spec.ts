// R2-8 — ทุกหน้าใหม่ + sheet/dialog ของ R2 × (375/390/768 = project) × th/en × light/dark:
//   ไม่มี horizontal scroll · a/button/input ที่เห็นทุกตัว ≥ 44×44 · ไม่มี console error/CSP · หัวข้อ/ชื่อ dialog เป็นภาษาที่เลือก · ภาพหน้าจอเต็มหน้า → test-results/
// สถานะ: groups ว่าง (บัญชีใหม่) · groups รายการ+คำเชิญค้าง · หน้ากลุ่ม admin/member/solo · ตั้งค่า admin/moderator/member ·
//   sheet สร้างกลุ่ม / ใส่โค้ด (+ error) / โค้ดเชิญ / จัดการสมาชิก · dialog ยืนยัน: นำออก / โอน admin / เพิกถอนโค้ด / ลบกลุ่ม (+พิมพ์ชื่อ) / ออกจากกลุ่ม
// "โลก" ต่อ worker (cookie jar) สร้างครั้งเดียว — เทสต์ทั้งหมดไม่เปลี่ยนสถานะกลุ่มในโลก (ยกเว้นสร้างโค้ดใน sheet แล้วเพิกถอนคืนทันที)
// คอนทราสต์สี: ชุดสีสมาชิก/token ตรวจโดยเครื่องมือของ UX (ไม่ซ้ำที่นี่) · ข้อความ hard-code: tests/i18n/no-hardcoded-text.test.ts
import { randomInt } from 'node:crypto';
import type { APIRequestContext, Locator, Page, PlaywrightWorkerArgs, TestInfo } from '@playwright/test';
import { expect, promoteToSuperAdmin, randomIp, signupViaApi, test as authTest, type Jar } from './support/auth';
import { E2E_BASE_URL } from './support/env';
import { setPrefs, watchConsole } from './support/fixtures';
import { api, checkLayout, createGroupApi, go, joinViaApiCode, membersApi, person, setRoleApi, userIdOf, type Person, type Theme } from './support/groups';
import { LOCALES, msg, type Locale } from './support/messages';

const THEMES: readonly Theme[] = ['light', 'dark'];

type GroupsWorld = {
  gid: string;
  groupName: string;
  soloGid: string;
  admin: Jar;
  moderator: Jar;
  member: Jar;
  invitee: Jar; // อยู่ในกลุ่มของตัวเอง + มีคำเชิญตรงค้างจากกลุ่มหลัก
  people: { admin: Person; moderator: Person; member: Person; invitee: Person };
  hostGroupName: string;
};

const test = authTest.extend<Record<never, never>, { gworld: GroupsWorld }>({
  gworld: [
    async ({ playwright }, provide) => {
      let last: unknown;
      for (let i = 0; i < 4; i++) {
        try {
          await provide(await buildGroupsWorld(playwright));
          return;
        } catch (e) {
          last = e;
          await new Promise((r) => setTimeout(r, 500 + randomInt(0, 1500)));
        }
      }
      throw last;
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});

async function buildGroupsWorld(playwright: PlaywrightWorkerArgs['playwright']): Promise<GroupsWorld> {
  const open: APIRequestContext[] = [];
  const mk = async (p: Person): Promise<APIRequestContext> => {
    const c = await playwright.request.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: { 'x-real-ip': randomIp() } });
    open.push(c);
    await signupViaApi(c, { username: p.username, displayName: p.displayName });
    return c;
  };
  try {
    // ชื่อกลุ่มยาวใกล้เพดาน 40 ตัว (มีขีดให้ตัดบรรทัดได้) เพื่อกดดันเลย์เอาต์
    const groupName = 'Badminton-Saturday-Crew-Bangkok-Friends'.slice(0, 40);
    const people = { admin: person('Ann'), moderator: person('Ben'), member: { username: person('x').username, displayName: 'สมชาย ใจดีมาก' }, invitee: person('Pim') };
    const extras = [person('Dee'), person('Eve'), person('Fay')];
    const admin = await mk(people.admin);
    const moderator = await mk(people.moderator);
    const member = await mk(people.member);
    const invitee = await mk(people.invitee);
    const gid = await createGroupApi(admin, groupName);
    for (const c of [moderator, member]) await joinViaApiCode(admin, gid, c);
    for (const p of extras) await joinViaApiCode(admin, gid, await mk(p)); // สมาชิก 6 คน: หลายช่องสี/ตัวอักษรย่อ
    const members = await membersApi(admin, gid);
    await setRoleApi(admin, gid, userIdOf(members, people.moderator), 'moderator');
    // โค้ดที่ยังใช้ได้ 2 อัน (admin + moderator สร้าง) และคำเชิญตรงค้าง 1 อัน
    expect((await api(admin, 'POST', `/api/groups/${gid}/invites/code`)).status).toBe(201);
    expect((await api(moderator, 'POST', `/api/groups/${gid}/invites/code`)).status).toBe(201);
    const pending = person('Quin');
    await mk(pending);
    expect((await api(admin, 'POST', `/api/groups/${gid}/invites/direct`, { username: pending.username })).status).toBe(201);
    // invitee: มีกลุ่มของตัวเอง (รายการกลุ่มไม่ว่าง) + คำเชิญตรงจากกลุ่มหลัก
    const hostGroupName = 'Pim’s weekend hikes';
    await createGroupApi(invitee, hostGroupName);
    expect((await api(admin, 'POST', `/api/groups/${gid}/invites/direct`, { username: people.invitee.username })).status).toBe(201);
    const soloGid = await createGroupApi(admin, 'Solo plans');
    return {
      gid,
      groupName,
      soloGid,
      admin: await admin.storageState(),
      moderator: await moderator.storageState(),
      member: await member.storageState(),
      invitee: await invitee.storageState(),
      people,
      hostGroupName,
    };
  } finally {
    await Promise.all(open.map((c) => c.dispose()));
  }
}

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const button = (scope: Pick<Page, 'getByRole'> | Locator, name: string) => scope.getByRole('button', { name, exact: true });
const manageBtn = (page: Page, locale: Locale, displayName: string) =>
  page.getByRole('button', { name: msg(locale, 'group.members.actionsAria', { name: displayName }), exact: true });

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    const prefs = { locale, theme } as const;

    test.describe(`groups · ${locale} · ${theme}`, () => {
      const check = (page: Page, testInfo: TestInfo, label: string) => checkLayout(page, testInfo, label, locale, theme);

      test('/groups ว่าง + sheet สร้างกลุ่ม + sheet ใส่โค้ด (+ error โค้ดผิด)', async ({ context, baseURL, page, user }, testInfo) => {
        void user; // ผู้ใช้ใหม่ที่ล็อกอินแล้วและยังไม่มีกลุ่ม
        await setPrefs(context, baseURL!, prefs);
        const problems = watchConsole(page, (m) => /status of 4\d\d/.test(m.text) && /\/api\/invites\/redeem$/.test(m.url ?? ''));
        await go(page, '/groups');
        await expect(h1(page)).toHaveText(msg(locale, 'nav.groups'));
        await expect(page.getByRole('heading', { level: 2, name: msg(locale, 'empty.groups.title') })).toBeVisible();
        await check(page, testInfo, 'groups-empty');

        await button(page, msg(locale, 'groups.create')).click();
        const create = page.getByRole('dialog', { name: msg(locale, 'groups.createSheet.title'), exact: true });
        await expect(create).toBeVisible();
        await check(page, testInfo, 'groups-create-sheet');
        await create.getByLabel(msg(locale, 'groups.createSheet.name'), { exact: true }).fill('Badminton-Saturday-Crew-Bangkok-Friends');
        await check(page, testInfo, 'groups-create-sheet-filled');
        await button(create, msg(locale, 'common.cancel')).click();
        await expect(create).toHaveCount(0);

        await button(page, msg(locale, 'empty.groups.joinCode')).click();
        const join = page.getByRole('dialog', { name: msg(locale, 'groups.join.title'), exact: true });
        await expect(join).toBeVisible();
        await check(page, testInfo, 'groups-join-sheet');
        await join.getByLabel(msg(locale, 'groups.join.label'), { exact: true }).fill('ZZZZ-ZZZZ');
        await button(join, msg(locale, 'groups.join.submit')).click();
        await expect(join.getByRole('alert').filter({ hasText: msg(locale, 'errors.INVITE_INVALID') })).toBeVisible();
        await check(page, testInfo, 'groups-join-sheet-error');
        expect(problems).toEqual([]);
      });

      test('/groups รายการ + คำเชิญตรงที่ค้าง', async ({ gworld, openAs }, testInfo) => {
        const { page } = await openAs(gworld.invitee, prefs);
        const problems = watchConsole(page);
        await go(page, '/groups');
        await expect(h1(page)).toHaveText(msg(locale, 'nav.groups'));
        await expect(page.getByRole('heading', { level: 2, name: msg(locale, 'groups.invites.title') })).toBeVisible();
        await expect(page.getByText(msg(locale, 'groups.invites.item', { inviter: gworld.people.admin.displayName, group: gworld.groupName }))).toBeVisible();
        await expect(page.getByRole('link', { name: msg(locale, 'groups.openAria', { name: gworld.hostGroupName, count: 1 }), exact: true })).toBeVisible();
        await check(page, testInfo, 'groups-list-invite');
        expect(problems).toEqual([]);
      });

      test('หน้ากลุ่ม: admin (หลายสมาชิก) · solo · member', async ({ gworld, openAs }, testInfo) => {
        const adm = await openAs(gworld.admin, prefs);
        const problems = watchConsole(adm.page);
        await go(adm.page, `/groups/${gworld.gid}`);
        await expect(h1(adm.page)).toHaveText(gworld.groupName);
        await expect(adm.page.getByText(msg(locale, 'group.yourRole', { role: 'admin' }))).toBeVisible();
        await expect(adm.page.getByRole('heading', { level: 2, name: msg(locale, 'group.members.title') })).toBeVisible();
        await expect(adm.page.getByRole('heading', { level: 2, name: msg(locale, 'group.calendarSoon.title') })).toBeVisible();
        await check(adm.page, testInfo, 'group-home-admin');

        await go(adm.page, `/groups/${gworld.soloGid}`);
        await expect(adm.page.getByRole('heading', { level: 2, name: msg(locale, 'group.solo.title') })).toBeVisible();
        await check(adm.page, testInfo, 'group-home-solo');

        const mem = await openAs(gworld.member, prefs);
        const memProblems = watchConsole(mem.page);
        await go(mem.page, `/groups/${gworld.gid}`);
        await expect(h1(mem.page)).toHaveText(gworld.groupName);
        await expect(mem.page.getByText(msg(locale, 'group.yourRole', { role: 'member' }))).toBeVisible();
        await check(mem.page, testInfo, 'group-home-member');
        expect(problems).toEqual([]);
        expect(memProblems).toEqual([]);
      });

      test('ตั้งค่ากลุ่ม: admin · sheet จัดการสมาชิก · dialog นำออก/โอน admin/ลบกลุ่ม', async ({ gworld, openAs }, testInfo) => {
        const { page } = await openAs(gworld.admin, prefs);
        const problems = watchConsole(page);
        const { people } = gworld;
        await go(page, `/groups/${gworld.gid}/settings`);
        await expect(h1(page)).toHaveText(msg(locale, 'groupSettings.title'));
        await expect(page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.transfer.title'), exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.delete.title'), exact: true })).toBeVisible();
        await expect(page.getByText(msg(locale, 'groupSettings.invite.direct.waiting', { username: people.invitee.displayName }))).toBeVisible();
        await expect(page.getByText(msg(locale, 'groupSettings.leave.adminBlocked'))).toBeVisible(); // admin ออกเองไม่ได้ (D8)
        await expect(button(page, msg(locale, 'groupSettings.leave.cta'))).toBeDisabled();
        await check(page, testInfo, 'settings-admin');

        // sheet จัดการสมาชิก (member ที่ไม่ใช่ moderator → มีทั้งตั้ง moderator / โอน / นำออก)
        await manageBtn(page, locale, people.member.displayName).click();
        const manage = page.getByRole('dialog', { name: msg(locale, 'groupSettings.members.manageTitle', { name: people.member.displayName }), exact: true });
        await expect(button(manage, msg(locale, 'groupSettings.members.makeModerator'))).toBeVisible();
        await check(page, testInfo, 'member-actions-sheet');

        await button(manage, msg(locale, 'groupSettings.members.remove')).click();
        const remove = page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.members.removeConfirm.title', { name: people.member.displayName }), exact: true });
        await expect(remove).toBeVisible();
        await check(page, testInfo, 'confirm-remove-member');
        await button(remove, msg(locale, 'common.cancel')).click();
        await expect(remove).toHaveCount(0);

        // sheet จัดการ moderator (ตั้งกลับเป็นสมาชิก) — ป้ายบทบาท/ข้อความช่วย
        await manageBtn(page, locale, people.moderator.displayName).click();
        const manageMod = page.getByRole('dialog', { name: msg(locale, 'groupSettings.members.manageTitle', { name: people.moderator.displayName }), exact: true });
        await expect(button(manageMod, msg(locale, 'groupSettings.members.makeMember'))).toBeVisible();
        await check(page, testInfo, 'member-actions-sheet-moderator');
        await button(manageMod, msg(locale, 'common.cancel')).click();

        // dialog โอน admin (เลือกผู้รับจาก select ในหน้า)
        await page.getByLabel(msg(locale, 'groupSettings.transfer.pick'), { exact: true }).selectOption({ label: people.moderator.displayName });
        await button(page, msg(locale, 'groupSettings.transfer.cta')).click();
        const transfer = page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.transfer.confirm.title', { name: people.moderator.displayName }), exact: true });
        await expect(transfer).toBeVisible();
        await check(page, testInfo, 'confirm-transfer-admin');
        await button(transfer, msg(locale, 'common.cancel')).click();
        await expect(transfer).toHaveCount(0);

        // dialog ลบกลุ่ม: ว่าง → พิมพ์ผิด/ถูก (ปุ่มยืนยันปิด→เปิด)
        await button(page, msg(locale, 'groupSettings.delete.cta')).click();
        const del = page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.delete.confirm.title', { group: gworld.groupName }), exact: true });
        await expect(del).toBeVisible();
        await expect(button(del, msg(locale, 'groupSettings.delete.confirm.confirm'))).toBeDisabled();
        await check(page, testInfo, 'confirm-delete-group');
        await del.getByLabel(msg(locale, 'groupSettings.delete.confirm.typeLabel'), { exact: true }).fill(gworld.groupName);
        await expect(button(del, msg(locale, 'groupSettings.delete.confirm.confirm'))).toBeEnabled();
        await check(page, testInfo, 'confirm-delete-group-typed');
        await button(del, msg(locale, 'common.cancel')).click();
        await expect(del).toHaveCount(0);
        expect(problems).toEqual([]);
      });

      test('sheet โค้ดเชิญ (โค้ดเต็มครั้งเดียว) + dialog เพิกถอนโค้ด', async ({ gworld, openAs }, testInfo) => {
        const { page, context } = await openAs(gworld.admin, prefs);
        // Web Share API ไม่มีใน Chromium ของเดสก์ท็อป → ปุ่มแชร์ซ่อน (ตรวจเฉพาะที่แสดงจริง) · คลิปบอร์ดไม่ถูกแตะ
        const problems = watchConsole(page);
        await go(page, `/groups/${gworld.gid}/settings`);
        await button(page, msg(locale, 'groupSettings.invite.code.create')).click();
        const sheet = page.getByRole('dialog', { name: msg(locale, 'groupSettings.invite.sheet.title'), exact: true });
        await expect(sheet.getByText(msg(locale, 'groupSettings.invite.sheet.onceTitle'))).toBeVisible();
        const code = (await sheet.getByTestId('invite-code').textContent())!.trim();
        const hint = code.slice(-4);
        try {
          await check(page, testInfo, 'invite-code-sheet');
          await button(sheet, msg(locale, 'groupSettings.invite.sheet.done')).click();
          await expect(sheet).toHaveCount(0);

          await page.getByRole('button', { name: msg(locale, 'groupSettings.invite.code.revokeAria', { hint }), exact: true }).click();
          const revoke = page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.invite.code.revokeConfirm.title', { hint }), exact: true });
          await expect(revoke).toBeVisible();
          await check(page, testInfo, 'confirm-revoke-code');
          // เพิกถอนจริง (คืนโควตา 20 โค้ดของกลุ่มในโลก) — เป็นส่วนของการตรวจว่า dialog ใช้งานได้
          await button(revoke, msg(locale, 'groupSettings.invite.code.revokeConfirm.confirm')).click();
          await expect(page.getByRole('status').filter({ hasText: msg(locale, 'groupSettings.invite.code.revoked') })).toBeVisible();
        } finally {
          // กันโค้ดค้างถ้าเทสต์ล้มกลางทาง
          const list = await api(context.request, 'GET', `/api/groups/${gworld.gid}/invites`);
          for (const inv of list.json?.data?.invites ?? []) {
            if (inv.codeHint === hint) await api(context.request, 'DELETE', `/api/groups/${gworld.gid}/invites/${inv.id}`);
          }
        }
        await check(page, testInfo, 'settings-admin-after-revoke');
        expect(problems).toEqual([]);
      });

      test('ตั้งค่ากลุ่ม: moderator (แก้ชื่อได้ · จัดการเฉพาะ member) · sheet นำออก', async ({ gworld, openAs }, testInfo) => {
        const { page } = await openAs(gworld.moderator, prefs);
        const problems = watchConsole(page);
        const { people } = gworld;
        await go(page, `/groups/${gworld.gid}/settings`);
        await expect(h1(page)).toHaveText(msg(locale, 'groupSettings.title'));
        await expect(page.getByText(msg(locale, 'group.yourRole', { role: 'moderator' }))).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: msg(locale, 'groupSettings.delete.title'), exact: true })).toHaveCount(0);
        await check(page, testInfo, 'settings-moderator');
        await manageBtn(page, locale, people.member.displayName).click();
        const manage = page.getByRole('dialog', { name: msg(locale, 'groupSettings.members.manageTitle', { name: people.member.displayName }), exact: true });
        await expect(button(manage, msg(locale, 'groupSettings.members.remove'))).toBeVisible();
        await expect(button(manage, msg(locale, 'groupSettings.members.makeModerator'))).toHaveCount(0);
        await check(page, testInfo, 'member-actions-sheet-moderator-view');
        expect(problems).toEqual([]);
      });

      test('ตั้งค่ากลุ่ม: member (อ่านอย่างเดียว) + dialog ออกจากกลุ่ม', async ({ gworld, openAs }, testInfo) => {
        const { page } = await openAs(gworld.member, prefs);
        const problems = watchConsole(page);
        await go(page, `/groups/${gworld.gid}/settings`);
        await expect(h1(page)).toHaveText(msg(locale, 'groupSettings.title'));
        await expect(page.getByText(msg(locale, 'groupSettings.memberNote'))).toBeVisible();
        await check(page, testInfo, 'settings-member');
        await button(page, msg(locale, 'groupSettings.leave.cta')).click();
        const leave = page.getByRole('alertdialog', { name: msg(locale, 'groupSettings.leave.confirm.title', { group: gworld.groupName }), exact: true });
        await expect(leave).toBeVisible();
        await check(page, testInfo, 'confirm-leave-group');
        await button(leave, msg(locale, 'common.cancel')).click();
        expect(problems).toEqual([]);
      });

      // SEC#5: ชื่อกลุ่มยาวสุด 40 ตัวที่ไม่มีช่องว่างให้ตัดบรรทัด (กว้างสุด: W, M · ตัวเลข · ไทยติดกัน) ต้องไม่ดันหน้าจนเลื่อนแนวนอน
      test('ชื่อกลุ่มยาวไม่มีช่องว่าง (W×40 · M×40 · 8×40 · ไทยติดกัน) → ไม่เลื่อนแนวนอนที่ /groups (รายการ+การ์ดคำเชิญ), หน้ากลุ่ม, ตั้งค่า', async ({ context, baseURL, page, user, playwright }, testInfo) => {
        await setPrefs(context, baseURL!, prefs);
        const longNames = ['W'.repeat(40), 'M'.repeat(40), '8'.repeat(40), 'สวัสดีชาวโลกสวัสดีชาวโลกสวัสดีชาวโลก'];
        const gids: string[] = [];
        for (const name of longNames) gids.push(await createGroupApi(context.request, name));
        // การ์ดคำเชิญตรง: อีกคนสร้างกลุ่มชื่อยาวแล้วชวนผู้ใช้นี้
        const inviter = await playwright.request.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: { 'x-real-ip': randomIp() } });
        try {
          const host = person('Hostel');
          await signupViaApi(inviter, { username: host.username, displayName: host.displayName });
          await createGroupApi(inviter, 'W'.repeat(40));
          const g = await createGroupApi(inviter, 'M'.repeat(40));
          expect((await api(inviter, 'POST', `/api/groups/${g}/invites/direct`, { username: user.username })).status).toBe(201);
        } finally {
          await inviter.dispose();
        }
        const problems = watchConsole(page);
        await go(page, '/groups');
        await expect(page.getByRole('heading', { level: 2, name: msg(locale, 'groups.invites.title') })).toBeVisible();
        await check(page, testInfo, 'long-names-groups');
        for (const [i, gid] of gids.entries()) {
          await go(page, `/groups/${gid}`);
          await expect(h1(page)).toHaveText(longNames[i]!);
          await check(page, testInfo, `long-names-group-${i}`);
          await go(page, `/groups/${gid}/settings`);
          await check(page, testInfo, `long-names-settings-${i}`);
        }
        expect(problems).toEqual([]);
      });

      // QA D6: super admin ที่ไม่ได้เป็นสมาชิกต้องไม่ถูกบอกว่า "เป็นผู้ดูแล" ของกลุ่ม (เดิม myRole ?? 'admin') · ไม่ล็อกอินเปิดหน้ากลุ่ม → /login
      test('super admin นอกกลุ่ม: ไม่มีป้ายบทบาท (ไม่ใช่ admin ของกลุ่ม) ทั้งหน้ากลุ่มและตั้งค่า · ไม่ล็อกอิน → /login', async ({ gworld, context, baseURL, page, user, browser }, testInfo) => {
        await setPrefs(context, baseURL!, prefs);
        await promoteToSuperAdmin(user.username);
        const problems = watchConsole(page);
        const roleLabels = (['admin', 'moderator', 'member'] as const).map((role) => msg(locale, 'group.yourRole', { role }));
        for (const path of [`/groups/${gworld.gid}`, `/groups/${gworld.gid}/settings`]) {
          await go(page, path);
          await expect(page.getByRole('main')).toBeVisible();
          for (const label of roleLabels) await expect(page.getByText(label)).toHaveCount(0);
        }
        await check(page, testInfo, 'group-home-superadmin-outside');
        expect(problems).toEqual([]);

        const anon = await browser.newContext({ baseURL: baseURL! });
        try {
          const p = await anon.newPage();
          await p.goto(`/groups/${gworld.gid}`);
          await expect(p).toHaveURL(/\/login$/);
        } finally {
          await anon.close();
        }
      });

      test('not-found ของกลุ่ม (คนนอก: ผู้ใช้ใหม่ที่ไม่ได้อยู่ในกลุ่ม)', async ({ gworld, context, baseURL, page, user }, testInfo) => {
        void user;
        await setPrefs(context, baseURL!, prefs);
        const problems = watchConsole(page);
        await go(page, `/groups/${gworld.gid}`);
        await expect(h1(page)).toHaveText(msg(locale, 'notFound.title'));
        await check(page, testInfo, 'group-not-found');
        await go(page, `/groups/${gworld.gid}/settings`);
        await expect(h1(page)).toHaveText(msg(locale, 'notFound.title'));
        expect(problems).toEqual([]);
      });
    });
  }
}
