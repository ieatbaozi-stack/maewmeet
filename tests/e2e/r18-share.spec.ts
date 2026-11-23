// R18 §S + C1 — แชร์นัดให้คนนอกกลุ่ม (ADR 0016) บนเบราว์เซอร์จริง · 375/390/768 (project) × th/en × สว่าง/มืด
//   เรื่องราวหลัก: สมาชิกเปิดนัด → "ชวนคนนอก" (sheet + ลิงก์) → คนนอก (บัญชีใหม่) เปิด /i/<token> ตอนยังไม่ login (เห็นแค่จำนวน ไม่มีชื่อสมาชิกคนอื่น)
//   → login แล้วกลับมาที่ลิงก์ (?next) → "เพิ่มนัดนี้" → หน้าแขก (ป้าย "แขก" · ไม่มีลิงก์กลุ่ม/แก้/ชวน/รายชื่อสมาชิก) → ตอบ RSVP
//   → สมาชิกเห็นแขกใน "แขกของนัดนี้" + "มากับ X" → นำแขกออก (ConfirmDialog 1 ขั้น · กดครั้งเดียวไม่ลบ) → แขกเปิดลิงก์เดิม = ใช้ไม่ได้
//   อีกเรื่อง: แขกออกเอง (ConfirmDialog) แล้วเข้าใหม่ด้วยลิงก์เดิมได้ · ปิดลิงก์ → ลิงก์ใช้ไม่ได้ · ?next ภายนอก (//evil.com) ไม่พาออกนอกแอป
//   C1: "ยกเลิกคำเชิญตรง" ต้องผ่าน ConfirmDialog (กดครั้งเดียวไม่ยกเลิก) · ส่วน busy/routine "วันนี้วันเดียว" อยู่ใน r6f-daily-busy / r14b-busy-routine
// สิทธิ์จริงตรวจที่เซิร์ฟเวอร์ — เทสต์ยิง API ตรง ๆ ยืนยันว่าแขกเรียก API สมาชิก/กลุ่มไม่ได้ (404) · helper API ใน support/* ใช้ maxRetries ของ Playwright (ไม่ซ่อน flake ด้วย retries ของเทสต์)
import type { BrowserContext, Page } from '@playwright/test';
import { call, createApptApi, daysAhead, makeScene, rsvpApi, type Scene } from './support/appt';
import { account } from './support/account';
import { expect, GOOD_PIN, pressPin, signupViaApi, test, uniqueUsername } from './support/auth';
import { setPrefs, watchConsole } from './support/fixtures';
import { checkLayout } from './support/groups';
import { msg, type Locale } from './support/messages';

const slot = (d: string, s = '10:00', e = '11:00') => ({ startDate: d, startTime: s, endDate: d, endTime: e });
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

type Device = { context: BrowserContext; page: Page };

/** บัญชีใหม่ที่ "ไม่ได้ล็อกอิน" ในเครื่องที่คืนให้ (สมัครผ่าน API ในเครื่องทิ้ง แล้วเปิดเครื่องใหม่ที่ไม่มี cookie) */
async function loggedOutGuest(newDevice: () => Promise<Device>, baseURL: string, locale: Locale, theme: 'light' | 'dark', label: string) {
  const maker = await newDevice();
  const username = uniqueUsername(label);
  const displayName = `${label} ${Math.random().toString(16).slice(2, 8)}`;
  await signupViaApi(maker.context.request, { username, displayName });
  const d = await newDevice();
  await setPrefs(d.context, baseURL, { locale, theme });
  return { ...d, username, displayName };
}

/** เข้าสู่ระบบผ่านหน้า /login ที่เปิดอยู่ (กรอก username + กดแป้น PIN) */
async function uiLogin(page: Page, locale: Locale, username: string): Promise<void> {
  await page.getByLabel(msg(locale, 'login.username'), { exact: true }).fill(username);
  await pressPin(page, locale, GOOD_PIN);
}

const tokenFromUrl = (url: string): string => {
  const token = new URL(url).pathname.split('/').pop() ?? '';
  expect(token, `token จากลิงก์ ${url}`).toMatch(TOKEN_RE);
  return token;
};

/** ฉาก: กลุ่ม 2 คน (เจ้าของนัด + คนที่ตอบ "ไป") + นัดหนึ่งนัด */
async function sharedScene(newDevice: () => Promise<Device>, baseURL: string, locale: Locale, theme: 'light' | 'dark'): Promise<{ scene: Scene; apptId: string; owner: Scene['members'][number]; bystander: Scene['members'][number] }> {
  const scene = await makeScene(newDevice, baseURL, { locale, theme, labels: ['Own', 'Bys'] });
  const [owner, bystander] = scene.members as [Scene['members'][number], Scene['members'][number]];
  const apptId = await createApptApi(owner.context.request, scene.gid, { title: `R18 กินข้าว ${Math.random().toString(36).slice(2, 6)}`, ...slot(daysAhead(6)), placeName: 'ร้านลับ ลาดพร้าว' });
  await rsvpApi(bystander.context.request, apptId, 'going');
  return { scene, apptId, owner, bystander };
}

const COMBOS = [
  { locale: 'th', theme: 'light' },
  { locale: 'en', theme: 'dark' },
] as const;

for (const { locale, theme } of COMBOS) {
  test(`${locale} · ${theme}: ชวนคนนอก → ลิงก์ (ยังไม่ login เห็นแต่จำนวน) → login กลับมา → เป็นแขก → RSVP → สมาชิกเห็น "มากับ" → นำออก → ลิงก์ใช้ไม่ได้`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
    const { scene, apptId, owner, bystander } = await sharedScene(newDevice, baseURL!, locale, theme);
    const guest = await loggedOutGuest(newDevice, baseURL!, locale, theme, 'Gst');
    const ownerProblems = watchConsole(owner.page);
    const guestProblems = watchConsole(guest.page);

    // ───── 1) สมาชิกเปิดนัด → "ชวนคนนอก" → sheet + ลิงก์ ─────
    await owner.page.goto(`/appointments/${apptId}`, { waitUntil: 'networkidle' });
    await expect(owner.page.getByTestId('guests-empty')).toBeVisible();
    await owner.page.getByTestId('share-invite').click();
    const sheet = owner.page.getByTestId('share-sheet');
    await expect(sheet).toBeVisible();
    const url = owner.page.getByTestId('share-url');
    await expect(url).toHaveValue(/\/i\/[A-Za-z0-9_-]{22}$/);
    const link = await url.inputValue();
    const token = tokenFromUrl(link);
    await checkLayout(owner.page, testInfo, 'r18-share-sheet', locale, theme);
    // กดซ้ำได้ลิงก์เดิม (get-or-create)
    const again = await call<{ url: string; reused: boolean }>(owner.context.request, 'POST', `/api/appointments/${apptId}/share-link`, {});
    expect(again.status, again.text).toBe(200);
    expect(tokenFromUrl(again.json!.data!.url)).toBe(token);

    // ───── 2) คนนอกเปิดลิงก์ตอนยังไม่ login: เห็นการ์ด + จำนวน ไม่เห็นชื่อสมาชิกอื่น ─────
    await guest.page.goto(`/i/${token}`, { waitUntil: 'networkidle' });
    const landing = guest.page.getByTestId('share-landing');
    await expect(landing).toBeVisible();
    await expect(guest.page.getByTestId('share-title')).toContainText('R18 กินข้าว');
    await expect(guest.page.getByTestId('share-counts')).toBeVisible();
    await expect(guest.page.getByTestId('share-add')).toHaveCount(0);
    const landingText = (await guest.page.locator('body').innerText()) + (await guest.page.content());
    expect(landingText, 'หน้าลิงก์ต้องไม่มีชื่อสมาชิกคนอื่น').not.toContain(bystander.p.displayName);
    expect(landingText, 'หน้าลิงก์ต้องไม่มีลิงก์เข้ากลุ่ม').not.toContain(`/groups/${scene.gid}`);
    await checkLayout(guest.page, testInfo, 'r18-share-landing', locale, theme);

    // ───── 3) เข้าสู่ระบบแล้วกลับมาที่ลิงก์เดิม (?next) → "เพิ่มนัดนี้" ─────
    await expect(guest.page.getByTestId('share-login')).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/i/${token}`)}`);
    await guest.page.getByTestId('share-login').click();
    await expect(guest.page).toHaveURL(new RegExp(`/login\\?next=`));
    await uiLogin(guest.page, locale, guest.username);
    await expect(guest.page).toHaveURL(new RegExp(`/i/${token}$`));
    await expect(guest.page.getByTestId('share-add')).toBeVisible();
    await expect(guest.page.getByTestId('share-login')).toHaveCount(0);
    await guest.page.getByTestId('share-add').click();

    // ───── 4) หน้าแขก: ป้าย "แขก" · ไม่มีลิงก์กลุ่ม/แก้/ยกเลิก/ชวน/รายชื่อสมาชิก ─────
    await expect(guest.page).toHaveURL(new RegExp(`/appointments/${apptId}$`));
    // login ตั้งค่าภาษา/ธีมตามบัญชี (บัญชีใหม่ = ค่าเริ่มต้นของระบบ) → ตั้งคุกกี้ของเทสต์ใหม่แล้วโหลดซ้ำก่อนวัดเลย์เอาต์
    await setPrefs(guest.context, baseURL!, { locale, theme });
    await guest.page.reload({ waitUntil: 'networkidle' });
    const detail = guest.page.getByTestId('guest-detail');
    await expect(detail).toBeVisible();
    await expect(guest.page.getByTestId('guest-badge')).toBeVisible();
    await expect(guest.page.getByTestId('guest-counts')).toBeVisible();
    await expect(guest.page.getByTestId('guest-leave')).toBeVisible();
    await expect(guest.page.locator('a[href*="/groups/"]')).toHaveCount(0);
    for (const id of ['appt-edit', 'appt-edit-top', 'appt-cancel', 'share-invite', 'appt-guests', 'appt-who-going', 'appt-who-none']) {
      await expect(guest.page.getByTestId(id), `${id} ต้องไม่อยู่บนหน้าแขก`).toHaveCount(0);
    }
    expect(await guest.page.locator('body').innerText(), 'หน้าแขกต้องไม่มีชื่อสมาชิกอื่น').not.toContain(bystander.p.displayName);
    await checkLayout(guest.page, testInfo, 'r18-guest-detail', locale, theme);
    // เซิร์ฟเวอร์ตัดสิทธิ์จริง: แขกเรียก API ฝั่งสมาชิก/กลุ่มไม่ได้ (ไม่ใช่แค่ซ่อนปุ่ม)
    expect((await call(guest.context.request, 'GET', `/api/appointments/${apptId}`)).status, 'แขกอ่านนัดทางสมาชิกไม่ได้').toBe(404);
    expect((await call(guest.context.request, 'GET', `/api/groups/${scene.gid}`)).status, 'แขกอ่านกลุ่มไม่ได้').toBe(404);
    expect((await call(guest.context.request, 'POST', `/api/appointments/${apptId}/share-link`, {})).status, 'แขกสร้างลิงก์ต่อไม่ได้').toBe(404);
    expect((await call(guest.context.request, 'GET', `/api/appointments/${apptId}/guest`)).status, 'แขกอ่านทางแขกได้').toBe(200);

    // ───── 5) แขกตอบ "ไป" (ตอบ "ไป" ต้องยืนยันก่อน) ─────
    await guest.page.getByTestId('appt-rsvp-going').click();
    await guest.page.getByTestId('rsvp-confirm-ok').click();
    await expect(guest.page.getByTestId('appt-rsvp-going')).toHaveAttribute('aria-pressed', 'true');
    await expect(guest.page.getByTestId('guest-count-going')).toContainText('2'); // รวมสมาชิกที่ตอบไป 1 + แขกเอง 1 (เห็นแค่จำนวน)

    // ───── 6) สมาชิกเห็นแขก + "มากับ X" ─────
    await owner.page.goto(`/appointments/${apptId}`, { waitUntil: 'networkidle' });
    const list = owner.page.getByTestId('guests-list');
    await expect(list).toBeVisible();
    const row = list.getByTestId('guest-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(guest.displayName);
    await expect(row).toContainText(T('guests.with', { name: owner.p.displayName }));
    await checkLayout(owner.page, testInfo, 'r18-guests-list', locale, theme);

    // ───── 7) นำแขกออก: กดครั้งเดียวไม่ลบ · ยกเลิกแล้วยังอยู่ · ยืนยันแล้วหาย ─────
    await owner.page.getByTestId('guest-remove').click();
    const confirm = owner.page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    expect((await call(guest.context.request, 'GET', `/api/appointments/${apptId}/guest`)).status, 'กดครั้งเดียวต้องยังไม่นำออก').toBe(200);
    await confirm.getByRole('button', { name: T('common.cancel'), exact: true }).click();
    await expect(owner.page.getByRole('alertdialog')).toHaveCount(0);
    await expect(row).toHaveCount(1);
    await owner.page.getByTestId('guest-remove').click();
    await owner.page.getByRole('alertdialog').getByRole('button', { name: T('guests.removeConfirm.confirm'), exact: true }).click();
    await expect(owner.page.getByRole('alertdialog')).toHaveCount(0);
    await expect(owner.page.getByTestId('guests-empty')).toBeVisible();
    expect((await call(guest.context.request, 'GET', `/api/appointments/${apptId}/guest`)).status, 'นำออกแล้วแขกอ่านนัดไม่ได้').toBe(404);

    // ───── 8) แขกที่ถูกนำออก เปิดลิงก์เดิม = ใช้ไม่ได้ ─────
    await guest.page.goto(`/i/${token}`, { waitUntil: 'networkidle' });
    const status = guest.page.getByTestId('share-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-kind', 'invalid');
    await expect(guest.page.getByTestId('share-add')).toHaveCount(0);
    await checkLayout(guest.page, testInfo, 'r18-share-invalid', locale, theme);
    expect((await call(guest.context.request, 'POST', '/api/share/join', { token })).status, 'นำออกแล้วเข้าใหม่ด้วยลิงก์เดิมไม่ได้').toBeGreaterThanOrEqual(400);

    expect(ownerProblems, 'owner console').toEqual([]);
    expect(guestProblems.filter((p) => !/\b40[34]\b/.test(p.text)), 'guest console (ไม่นับ 403/404 ที่คาดไว้จากการยิง API ตรง)').toEqual([]);
  });
}

test('th · light: แขกออกเองต้องยืนยัน (กดครั้งเดียวไม่ออก) แล้วเข้าใหม่ด้วยลิงก์เดิมได้', async ({ newDevice, baseURL }) => {
  test.setTimeout(180_000);
  const locale: Locale = 'th';
  const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
  const { apptId, owner } = await sharedScene(newDevice, baseURL!, locale, 'light');
  const made = await call<{ url: string }>(owner.context.request, 'POST', `/api/appointments/${apptId}/share-link`, {});
  expect(made.status, made.text).toBe(201);
  const token = tokenFromUrl(made.json!.data!.url);
  const g = await account(newDevice, baseURL!, { locale, theme: 'light', label: 'Gst' });
  const join = await call(g.context.request, 'POST', '/api/share/join', { token });
  expect(join.status, join.text).toBe(200);

  await g.page.goto(`/appointments/${apptId}`, { waitUntil: 'networkidle' });
  await expect(g.page.getByTestId('guest-detail')).toBeVisible();
  await g.page.getByTestId('guest-leave').click();
  const dlg = g.page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  expect((await call(g.context.request, 'GET', `/api/appointments/${apptId}/guest`)).status, 'กดครั้งเดียวต้องยังไม่ออก').toBe(200);
  await dlg.getByRole('button', { name: T('common.cancel'), exact: true }).click();
  await expect(g.page.getByRole('alertdialog')).toHaveCount(0);
  await expect(g.page.getByTestId('guest-detail')).toBeVisible();
  await g.page.getByTestId('guest-leave').click();
  await g.page.getByRole('alertdialog').getByRole('button', { name: T('guest.leave.confirm'), exact: true }).click();
  await expect.poll(async () => (await call(g.context.request, 'GET', `/api/appointments/${apptId}/guest`)).status, { message: 'ออกแล้วอ่านนัดทางแขกไม่ได้' }).toBe(404);

  // ลิงก์ยังใช้ได้ → เข้าใหม่
  await g.page.goto(`/i/${token}`, { waitUntil: 'networkidle' });
  await expect(g.page.getByTestId('share-landing')).toBeVisible();
  await g.page.getByTestId('share-add').click();
  await expect(g.page).toHaveURL(new RegExp(`/appointments/${apptId}$`));
  await expect(g.page.getByTestId('guest-detail')).toBeVisible();
  expect((await call(g.context.request, 'GET', `/api/appointments/${apptId}/guest`)).status, 'เข้าใหม่ได้').toBe(200);
});

test('th · light: สมาชิกปิดลิงก์ (ยืนยัน 1 ขั้น) → คนใหม่เปิดลิงก์เห็น "ใช้ไม่ได้"', async ({ newDevice, baseURL }) => {
  test.setTimeout(180_000);
  const locale: Locale = 'th';
  const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
  const { apptId, owner } = await sharedScene(newDevice, baseURL!, locale, 'light');
  await owner.page.goto(`/appointments/${apptId}`, { waitUntil: 'networkidle' });
  await owner.page.getByTestId('share-invite').click();
  await expect(owner.page.getByTestId('share-url')).toHaveValue(/\/i\/[A-Za-z0-9_-]{22}$/);
  const token = tokenFromUrl(await owner.page.getByTestId('share-url').inputValue());

  const before = await account(newDevice, baseURL!, { locale, theme: 'light', label: 'Gs1' });
  await before.page.goto(`/i/${token}`, { waitUntil: 'networkidle' });
  await expect(before.page.getByTestId('share-landing')).toBeVisible(); // ยังใช้ได้

  await owner.page.getByTestId('share-revoke-mine').click();
  const dlg = owner.page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  const probe = await account(newDevice, baseURL!, { locale, theme: 'light', label: 'Gs2' });
  expect((await call(probe.context.request, 'POST', '/api/share/join', { token })).status, 'กดครั้งเดียวต้องยังไม่ปิดลิงก์').toBe(200);
  await dlg.getByRole('button', { name: T('share.revoke.confirm'), exact: true }).click();
  await expect(owner.page.getByTestId('share-sheet')).toHaveCount(0); // ปิดลิงก์ของฉัน → sheet ปิดเอง

  const after = await account(newDevice, baseURL!, { locale, theme: 'light', label: 'Gs3' });
  await after.page.goto(`/i/${token}`, { waitUntil: 'networkidle' });
  await expect(after.page.getByTestId('share-status')).toHaveAttribute('data-kind', 'invalid');
  expect((await call(after.context.request, 'POST', '/api/share/join', { token })).status, 'ลิงก์ที่ปิดแล้วเข้าไม่ได้').toBeGreaterThanOrEqual(400);
});

test('th · light: ?next ภายนอก (//evil.com) ไม่พาออกนอกแอป · ?next ของลิงก์ชวนเท่านั้นที่กลับไป', async ({ newDevice, baseURL }) => {
  test.setTimeout(120_000);
  const locale: Locale = 'th';
  const origin = new URL(baseURL!).origin;
  const u = await loggedOutGuest(newDevice, baseURL!, locale, 'light', 'Nxt');
  await u.page.goto('/login?next=//evil.com', { waitUntil: 'networkidle' });
  await uiLogin(u.page, locale, u.username);
  await u.page.waitForURL((url) => url.pathname !== '/login');
  expect(new URL(u.page.url()).origin, 'ต้องอยู่ในแอปเดิม').toBe(origin);
  expect(new URL(u.page.url()).hostname).not.toContain('evil');

  // path ในแอปที่ไม่ใช่ลิงก์ชวน (allowlist แบบตรงรูป) ก็ไม่ถูกเด้งไป
  const v = await loggedOutGuest(newDevice, baseURL!, locale, 'light', 'Nx2');
  await v.page.goto(`/login?next=${encodeURIComponent('/admin/users')}`, { waitUntil: 'networkidle' });
  await uiLogin(v.page, locale, v.username);
  await v.page.waitForURL((url) => url.pathname !== '/login');
  expect(new URL(v.page.url()).pathname, 'next ที่ไม่ใช่ /i/<token> ต้องตกกลับหน้าหลัก').not.toContain('/admin');
});

test('th · light: C1 ยกเลิกคำเชิญตรง ต้องผ่าน ConfirmDialog (กดครั้งเดียวไม่ยกเลิก) · ยกเลิกแล้วคำเชิญยังอยู่', async ({ newDevice, baseURL }) => {
  test.setTimeout(180_000);
  const locale: Locale = 'th';
  const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
  const scene = await makeScene(newDevice, baseURL!, { locale, theme: 'light', labels: ['Adm'] });
  const admin = scene.members[0]!;
  const invitee = await account(newDevice, baseURL!, { locale, theme: 'light', label: 'Inv' });

  await admin.page.goto(`/groups/${scene.gid}/settings`, { waitUntil: 'networkidle' });
  await admin.page.getByLabel(T('groupSettings.invite.direct.label'), { exact: true }).fill(invitee.username);
  await admin.page.getByRole('button', { name: T('groupSettings.invite.direct.submit'), exact: true }).click();
  const cancel = admin.page.getByTestId('direct-invite-cancel');
  await expect(cancel).toHaveCount(1);

  const pending = async () => (await call<{ items?: unknown[] }>(invitee.context.request, 'GET', '/api/me/invites')).text;
  const before = await pending();
  expect(before, 'ผู้ถูกเชิญเห็นคำเชิญ').toContain(scene.gid);

  await cancel.click();
  const dlg = admin.page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  expect(await pending(), 'กดครั้งเดียวต้องยังไม่ยกเลิก').toContain(scene.gid);
  await expect(admin.page.getByTestId('direct-invite-cancel')).toHaveCount(1);
  await dlg.getByRole('button', { name: T('common.cancel'), exact: true }).click();
  await expect(admin.page.getByRole('alertdialog')).toHaveCount(0);
  expect(await pending(), 'ยกเลิกใน dialog แล้วคำเชิญยังอยู่').toContain(scene.gid);

  await admin.page.getByTestId('direct-invite-cancel').click();
  await admin.page.getByRole('alertdialog').getByRole('button', { name: T('groupSettings.invite.direct.confirm.confirm'), exact: true }).click();
  await expect(admin.page.getByRole('alertdialog')).toHaveCount(0);
  await expect(admin.page.getByTestId('direct-invite-cancel')).toHaveCount(0);
  await expect.poll(pending, { message: 'ยืนยันแล้วคำเชิญหาย' }).not.toContain(scene.gid);
});
