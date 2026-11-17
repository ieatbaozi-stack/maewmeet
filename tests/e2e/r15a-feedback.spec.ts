// R15a (หน้าจอ) — ข้อเสนอแนะรอบ 15a ในเบราว์เซอร์จริง · 375/390/768 (ทุก project) × th/en × สว่าง/มืด
//   icon      ไอคอนกลุ่ม: admin + moderator ตั้งได้ผ่าน UI · สมาชิกอ่านอย่างเดียว (ไม่มีปุ่ม) และ PUT ตรง → 403 · คนนอก/ไม่ล็อกอินตั้งไม่ได้
//             เลือก "แมว" → เก็บ null · ไอคอนโผล่ที่หัวปฏิทิน/แผ่นสลับกลุ่ม/การ์ดกลุ่ม/หน้าหลัก ของสมาชิกอีกคน
//   skip      เว้นบางวัน: ชุดทั้งเดือน → เว้น 2 วันในการยืนยันครั้งเดียว → อีกบัญชีเห็นวันนั้นว่าง → เอากลับ 1 วัน → กลับมาไม่ว่าง
//             เพดาน 31 วัน (ช่องที่เหลือล็อก · API เกิน 31 → LIMIT_REACHED) · error ทุกแบบไม่ล้างวันที่เลือก
//   step3     ขั้น 3 "ดูวันว่างตรงกัน" เสร็จหลังเปิดดูแล้ว (localStorage) · /privacy มีข้อ busyStatus · manifest + ไอคอนแอป
// วันที่: ใช้วันสัมพัทธ์กับวันนี้ (Asia/Bangkok) ผ่าน support/busy.ts · ผู้ใช้ใหม่ต่อเทสต์ (rate limit routine 20 ต่อ 10 นาที)
import type { Page } from '@playwright/test';
import { expect, signupViaApi, test, uniqueUsername } from './support/auth';
import { call, createApptApi, daysAhead, makeScene, type Member } from './support/appt';
import { addDays, createBusyApi } from './support/busy';
import { openCalendar } from './support/calendar-ui';
import { setPrefs, settleAnimations, watchConsole } from './support/fixtures';
import { freeDay, mondayAhead, openFree, pickDay } from './support/free-ui';
import { api, checkLayout, go, setRoleApi, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';
import { E2E_BASE_URL } from './support/env';

const COMBOS: { loc: Locale; theme: Theme }[] = [
  { loc: 'th', theme: 'light' },
  { loc: 'en', theme: 'dark' },
];
const slot = (d: string) => ({ startDate: d, startTime: '10:00', endDate: d, endTime: '11:00' });
const toastOf = (p: Page) => p.getByTestId('cal-toast');

type GroupDto = { group: { icon: string | null } };
async function iconOf(m: Member, gid: string): Promise<string | null> {
  const r = await call<GroupDto>(m.context.request, 'GET', `/api/groups/${gid}`);
  expect(r.status, r.text).toBe(200);
  return r.json!.data!.group.icon;
}

/** เปิดแผ่นเลือกไอคอนจากหน้าตั้งค่ากลุ่ม แล้วเลือก key */
async function pickIcon(page: Page, gid: string, key: string) {
  await go(page, `/groups/${gid}/settings`);
  await page.getByTestId('group-icon-change').click();
  await expect(page.getByTestId('group-icon-picker')).toBeVisible();
  await page.getByTestId(`group-icon-option-${key}`).click();
  await expect(page.getByTestId(`group-icon-option-${key}`)).toHaveAttribute('aria-checked', 'true');
}

// ═════════════════════════════════════════════════════════════
// 1) ไอคอนกลุ่ม
// ═════════════════════════════════════════════════════════════
for (const { loc, theme } of COMBOS) {
  test(`R15a icon ${loc}/${theme}: admin+moderator ตั้งได้ · สมาชิกอ่านอย่างเดียว/PUT 403 · แมว=null · ไอคอนโผล่ทุกที่ให้สมาชิกอีกคน`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann', 'Mod', 'Mem'] });
    const [A, M, B] = scene.members as [Member, Member, Member];
    await setRoleApi(A.context.request, scene.gid, M.userId, 'moderator');
    const problems = [A, M, B].map((x) => watchConsole(x.page));
    const gid = scene.gid;
    expect(await iconOf(A, gid), 'ยังไม่ตั้ง = null').toBeNull();

    // ───── admin: ปุ่มบันทึกยังกดไม่ได้เมื่อไม่เปลี่ยน → เลือก badminton → บันทึก ─────
    await go(A.page, `/groups/${gid}/settings`);
    await expect(A.page.getByTestId('group-icon-current')).toHaveAttribute('data-icon', 'cat');
    await expect(A.page.getByTestId('group-icon-current')).toHaveText(T('groupSettings.icon.currentDefault'));
    await checkLayout(A.page, testInfo, 'r15a-icon-settings', loc, theme);
    await A.page.getByTestId('group-icon-change').click();
    await expect(A.page.getByTestId('group-icon-picker')).toBeVisible();
    await expect(A.page.getByTestId('group-icon-save')).toHaveAttribute('aria-disabled', 'true');
    await settleAnimations(A.page); // แผ่นเลื่อนขึ้นอยู่ — click({force}) ไม่รอให้นิ่ง
    await A.page.getByTestId('group-icon-save').click({ force: true });
    await expect(A.page.getByTestId('group-icon-unchanged')).toHaveText(T('groupSettings.icon.picker.unchanged'));
    expect(await iconOf(A, gid), 'กดบันทึกทั้งที่ไม่เปลี่ยน = ไม่ยิง API').toBeNull();
    await checkLayout(A.page, testInfo, 'r15a-icon-picker', loc, theme);
    await A.page.getByTestId('group-icon-option-badminton').click();
    await expect(A.page.getByTestId('group-icon-save')).not.toHaveAttribute('aria-disabled', 'true');
    await A.page.getByTestId('group-icon-save').click();
    await expect(A.page.getByTestId('group-icon-picker')).toHaveCount(0);
    await expect(A.page.getByText(T('groupSettings.icon.toast.saved'))).toBeVisible();
    await expect(A.page.getByTestId('group-icon-current')).toHaveAttribute('data-icon', 'badminton');
    expect(await iconOf(A, gid)).toBe('badminton');

    // ───── moderator: ตั้งได้เหมือนกัน ─────
    await pickIcon(M.page, gid, 'soccer');
    await M.page.getByTestId('group-icon-save').click();
    await expect(M.page.getByTestId('group-icon-picker')).toHaveCount(0);
    await expect(M.page.getByTestId('group-icon-current')).toHaveAttribute('data-icon', 'soccer');
    expect(await iconOf(A, gid)).toBe('soccer');

    // ───── สมาชิก: อ่านอย่างเดียว · PUT ตรง → 403 · ค่าไม่เปลี่ยน ─────
    await go(B.page, `/groups/${gid}/settings`);
    await expect(B.page.getByTestId('group-icon-viewonly')).toHaveText(T('groupSettings.icon.viewOnly'));
    await expect(B.page.getByTestId('group-icon-change')).toHaveCount(0);
    await expect(B.page.getByTestId('group-icon-current')).toHaveAttribute('data-icon', 'soccer');
    await checkLayout(B.page, testInfo, 'r15a-icon-viewonly', loc, theme);
    const forbidden = await call(B.context.request, 'PUT', `/api/groups/${gid}/icon`, { icon: 'coffee' });
    expect([forbidden.status, forbidden.json?.error?.code]).toEqual([403, 'FORBIDDEN']);
    expect(await iconOf(A, gid), 'สมาชิกตั้งไม่ได้').toBe('soccer');

    // ───── คนนอกกลุ่ม + ไม่ล็อกอิน ตั้งไม่ได้ ─────
    const outsider = await newDevice();
    await signupViaApi(outsider.context.request, { username: uniqueUsername('out') });
    const out = await call(outsider.context.request, 'PUT', `/api/groups/${gid}/icon`, { icon: 'coffee' });
    expect([403, 404], `คนนอก: ${out.text}`).toContain(out.status);
    const anon = await newDevice();
    const anonRes = await call(anon.context.request, 'PUT', `/api/groups/${gid}/icon`, { icon: 'coffee' });
    expect(anonRes.status).toBe(401);
    expect(await iconOf(A, gid)).toBe('soccer');

    // ───── ไอคอนโผล่ให้สมาชิกอีกคน: การ์ดกลุ่ม · หัวปฏิทิน · แผ่นสลับกลุ่ม · หน้าหลัก (นัดของกลุ่ม) ─────
    await createApptApi(A.context.request, gid, { title: `R15a นัด ${loc}`, ...slot(daysAhead(3)) });
    await go(B.page, '/groups');
    await expect(B.page.locator(`a[href="/groups/${gid}"] [data-icon="soccer"]`)).toBeVisible();
    await checkLayout(B.page, testInfo, 'r15a-icon-groups', loc, theme);
    await openCalendar(B.page, { gid, view: 'month' });
    await expect(B.page.getByTestId('cal-group-switch').locator('[data-icon="soccer"]')).toBeVisible();
    await B.page.getByTestId('cal-group-switch').click();
    await expect(B.page.getByTestId(`cal-group-option-${gid}`).locator('[data-icon="soccer"]')).toBeVisible();
    await checkLayout(B.page, testInfo, 'r15a-icon-switcher', loc, theme);
    await B.page.keyboard.press('Escape');
    await go(B.page, '/');
    await expect(B.page.locator('.gi-glyph[data-icon="soccer"]').first()).toBeVisible();

    // ───── เลือก "แมว" → เก็บ null (ไม่ใช่ 'cat') · ทุกที่กลับเป็นแมว ─────
    await pickIcon(A.page, gid, 'cat');
    await A.page.getByTestId('group-icon-save').click();
    await expect(A.page.getByTestId('group-icon-picker')).toHaveCount(0);
    await expect(A.page.getByTestId('group-icon-current')).toHaveAttribute('data-icon', 'cat');
    await expect(A.page.getByTestId('group-icon-current')).toHaveText(T('groupSettings.icon.currentDefault'));
    expect(await iconOf(B, gid), 'แมว = null').toBeNull();
    const catPut = await call(A.context.request, 'PUT', `/api/groups/${gid}/icon`, { icon: 'cat' });
    expect(catPut.status, 'API รับ "cat" แล้วเก็บเป็น null').toBe(200);
    expect(catPut.json!.data).toMatchObject({ icon: null });
    await openCalendar(B.page, { gid, view: 'month' });
    await expect(B.page.getByTestId('cal-group-switch').locator('[data-icon="cat"]')).toBeVisible();

    for (const p of problems) expect(p).toEqual([]);
  });
}

// ═════════════════════════════════════════════════════════════
// 2) เว้นบางวัน
// ═════════════════════════════════════════════════════════════
const skipDay = (p: Page, d: string) => p.getByTestId(`skip-day-${d}`);

/** ชุดทุกวัน 6 สัปดาห์เริ่มจันทร์ถัดไป — ทั้งวัน (allDay) */
async function makeRoutine(m: Member): Promise<{ id: string; mon: string; end: string }> {
  const mon = mondayAhead(2);
  const body = { rangeKind: 'weeks', fromWeek: mon, toWeek: addDays(mon, 35), weekdays: [1, 2, 3, 4, 5, 6, 7], allDay: true, title: 'ทำงาน', note: null, hideDetail: false };
  const r = await api(m.context.request, 'POST', '/api/me/busy-routines', body);
  expect(r.status, `POST routine: ${r.text}`).toBe(201);
  const id = (JSON.parse(r.text) as { data: { routine: { id: string } } }).data.routine.id;
  return { id, mon, end: addDays(mon, 41) };
}

async function openSkipSheet(page: Page, gid: string, id: string) {
  await openCalendar(page, { gid, view: 'mine' });
  await page.getByTestId(`routine-skip-${id}`).click();
  await expect(page.getByTestId('skip-sheet')).toBeVisible();
}

/** เลื่อนเดือนในแผ่นจนเห็นวันนั้น แล้วแตะ */
async function tapSkipDay(page: Page, d: string) {
  for (let i = 0; i < 4 && !(await skipDay(page, d).isVisible()); i++) await page.getByTestId('skip-next').click();
  await expect(skipDay(page, d)).toBeVisible();
  await skipDay(page, d).click();
}

async function busyDates(m: Member, from: string, to: string): Promise<string[]> {
  const r = await api(m.context.request, 'GET', `/api/me/busy?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  return (JSON.parse(r.text) as { data: { busy: { localStartDate: string; routineId?: string | null }[] } }).data.busy.filter((x) => x.routineId).map((x) => x.localStartDate);
}

for (const { loc, theme } of COMBOS) {
  test(`R15a skip ${loc}/${theme}: ชุดทั้งเดือน → เว้น 2 วันครั้งเดียว → อีกบัญชีเห็นว่าง → เอากลับ 1 วัน → กลับมาไม่ว่าง`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann', 'Bob'] });
    const [A, B] = scene.members as [Member, Member];
    const problems = [A, B].map((x) => watchConsole(x.page));
    const routine = await makeRoutine(A);
    const [d1, d2, d3] = [addDays(routine.mon, 1), addDays(routine.mon, 2), addDays(routine.mon, 3)];
    const allFree = T('availability.day.status.all');
    expect(await busyDates(A, routine.mon, routine.end)).toEqual(expect.arrayContaining([d1, d2, d3]));

    // ก่อนเว้น: อีกบัญชีเห็น d1/d2 ไม่ว่าง
    await openFree(B.page, { gid: scene.gid, date: d1 });
    await pickDay(B.page, d1);
    await expect(freeDay(B.page)).not.toContainText(allFree);

    // ───── เว้น 2 วัน ในการยืนยันครั้งเดียว ─────
    await openSkipSheet(A.page, scene.gid, routine.id);
    await expect(A.page.getByTestId('skip-count')).toHaveText(T('busy.routine.skip.count', { count: 0 }));
    await expect(A.page.getByTestId('skip-confirm')).toHaveAttribute('aria-disabled', 'true');
    await checkLayout(A.page, testInfo, 'r15a-skip-sheet', loc, theme);
    await tapSkipDay(A.page, d1);
    await tapSkipDay(A.page, d2);
    await expect(A.page.getByTestId('skip-count')).toHaveText(T('busy.routine.skip.count', { count: 2 }));
    await expect(skipDay(A.page, d1)).toHaveAttribute('aria-pressed', 'true');
    await expect(A.page.getByTestId('skip-confirm')).toHaveText(T('busy.routine.skip.confirm', { count: 2 }));
    await checkLayout(A.page, testInfo, 'r15a-skip-picked', loc, theme);
    const reqs: string[] = [];
    A.page.on('request', (r) => {
      if (r.url().includes('/skips')) reqs.push(`${r.method()} ${r.postData() ?? ''}`);
    });
    await A.page.getByTestId('skip-confirm').click();
    await expect(A.page.getByRole('dialog')).toHaveCount(0);
    await expect(toastOf(A.page)).toContainText(T('busy.routine.skip.toast.skipped', { count: 2 }));
    expect(reqs, 'ยืนยันครั้งเดียว = คำขอเดียว').toEqual([`POST ${JSON.stringify({ add: [d1, d2] })}`]);
    await expect(A.page.getByTestId(`routine-skip-chip-${routine.id}`)).toContainText(T('busy.routine.skip.chip', { count: 2 }));
    const after = await busyDates(A, routine.mon, routine.end);
    expect(after).not.toContain(d1);
    expect(after).not.toContain(d2);
    expect(after).toContain(d3);

    // อีกบัญชี: d1/d2 ว่างแล้ว · d3 ยังไม่ว่าง
    await openFree(B.page, { gid: scene.gid, date: d1 });
    await pickDay(B.page, d1);
    await expect(freeDay(B.page)).toContainText(allFree);
    await pickDay(B.page, d2);
    await expect(freeDay(B.page)).toContainText(allFree);
    await pickDay(B.page, d3);
    await expect(freeDay(B.page)).not.toContainText(allFree);

    // ───── เอากลับ 1 วัน ─────
    await openSkipSheet(A.page, scene.gid, routine.id);
    await A.page.getByTestId('skip-mode-restore').click();
    await expect(A.page.getByTestId('skip-sheet')).toHaveAttribute('data-mode', 'restore');
    await expect(A.page.getByTestId('skip-mode-restore')).toHaveText(T('busy.routine.skip.mode.restore', { count: 2 }));
    await expect(skipDay(A.page, d1)).toHaveAttribute('data-state', 'restorable');
    await expect(A.page.getByTestId('skip-restore-note')).toHaveText(T('busy.routine.skip.restoreNote'));
    await checkLayout(A.page, testInfo, 'r15a-skip-restore', loc, theme);
    await tapSkipDay(A.page, d1);
    await expect(A.page.getByTestId('skip-confirm')).toHaveText(T('busy.routine.skip.confirmRestore', { count: 1 }));
    await A.page.getByTestId('skip-confirm').click();
    await expect(A.page.getByRole('dialog')).toHaveCount(0);
    await expect(toastOf(A.page)).toContainText(T('busy.routine.skip.toast.restored', { count: 1 }));
    const back = await busyDates(A, routine.mon, routine.end);
    expect(back).toContain(d1);
    expect(back).not.toContain(d2);
    await expect(A.page.getByTestId(`routine-skip-chip-${routine.id}`)).toContainText(T('busy.routine.skip.chip', { count: 1 }));
    await openFree(B.page, { gid: scene.gid, date: d1 });
    await pickDay(B.page, d1);
    await expect(freeDay(B.page)).not.toContainText(allFree); // กลับมาไม่ว่าง
    await pickDay(B.page, d2);
    await expect(freeDay(B.page)).toContainText(allFree); // ยังเว้นอยู่

    for (const p of problems) expect(p).toEqual([]);
  });
}

test('R15a skip: เพดาน 31 วัน — ช่องที่เหลือล็อกก่อนกด · ส่งได้ 31 พอดี · API เกิน 31 = LIMIT_REACHED', async ({ newDevice, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const loc: Locale = 'th';
  const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
  const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme: 'light', labels: ['Ann'] });
  const A = scene.members[0]!;
  const problems = watchConsole(A.page);
  const routine = await makeRoutine(A);
  const days = Array.from({ length: 33 }, (_, i) => addDays(routine.mon, i));

  // API: 32 วัน → 400 LIMIT_REACHED skipDays (ไม่เปลี่ยนอะไร) · 31 วันผ่าน
  const over = await call(A.context.request, 'POST', `/api/me/busy-routines/${routine.id}/skips`, { add: days.slice(0, 32) });
  expect([over.status, over.json?.error?.code]).toEqual([400, 'LIMIT_REACHED']);
  expect(await busyDates(A, routine.mon, routine.end)).toEqual(expect.arrayContaining(days.slice(0, 32)));

  await openSkipSheet(A.page, scene.gid, routine.id);
  for (const d of days.slice(0, 31)) await tapSkipDay(A.page, d);
  await expect(A.page.getByTestId('skip-count')).toHaveText(T('busy.routine.skip.count', { count: 31 }));
  await expect(A.page.getByTestId('skip-limit')).toHaveText(T('busy.routine.skip.limit', { max: 31 }));
  const extra = days[31]!;
  await skipDay(A.page, extra).click({ force: true }); // ล็อกอยู่ (aria-disabled — Playwright รอ enabled ไม่มีวันมา) — แตะแล้วไม่เกิดอะไร
  await expect(skipDay(A.page, extra)).toHaveAttribute('aria-disabled', 'true');
  await expect(skipDay(A.page, extra)).not.toHaveAttribute('aria-pressed', 'true');
  await expect(A.page.getByTestId('skip-count')).toHaveText(T('busy.routine.skip.count', { count: 31 }));
  await checkLayout(A.page, testInfo, 'r15a-skip-limit', loc, 'light');
  await A.page.getByTestId('skip-confirm').click();
  await expect(A.page.getByRole('dialog')).toHaveCount(0);
  await expect(toastOf(A.page)).toContainText(T('busy.routine.skip.toast.skipped', { count: 31 }));
  const left = await busyDates(A, routine.mon, routine.end);
  expect(left).toContain(extra);
  expect(left).not.toContain(days[0]!);
  expect(problems).toEqual([]);
});

test.describe('R15a skip: error ทุกแบบ → ข้อความตรงชนิด · ไม่ล้างวันที่เลือก · ลองใหม่สำเร็จ', () => {
  for (const { loc } of COMBOS) {
    test(`${loc}`, async ({ newDevice, baseURL }) => {
      test.setTimeout(300_000);
      const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
      const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme: 'light', labels: ['Ann'] });
      const A = scene.members[0]!;
      const problems = watchConsole(A.page, (m) => /status of (400|404|429|500)|Failed to load resource|net::ERR_FAILED/.test(m.text));
      const routine = await makeRoutine(A);
      const [d1, d2] = [addDays(routine.mon, 1), addDays(routine.mon, 2)];
      const glob = '**/api/me/busy-routines/*/skips';
      const json = (status: number, error: unknown, headers: Record<string, string> = {}) => ({ status, headers, contentType: 'application/json', body: JSON.stringify({ error }) });
      const alertText = () => A.page.getByTestId('skip-error');

      await openSkipSheet(A.page, scene.gid, routine.id);
      await tapSkipDay(A.page, d1);
      await tapSkipDay(A.page, d2);

      const check = async (label: string, handler: (route: import('@playwright/test').Route) => Promise<void>, expected: string) => {
        await A.page.route(glob, handler);
        await A.page.getByTestId('skip-confirm').click();
        await expect(alertText(), label).toHaveText(expected);
        await expect(A.page.getByTestId('skip-count'), `${label}: วันที่เลือกยังอยู่`).toHaveText(T('busy.routine.skip.count', { count: 2 }));
        await expect(skipDay(A.page, d1)).toHaveAttribute('aria-pressed', 'true');
        await A.page.unroute(glob);
      };
      await check('VALIDATION → stale', (r) => r.fulfill(json(400, { code: 'VALIDATION', params: { fields: { dates: {} } } })), T('busy.routine.skip.error.stale'));
      await check('RATE_LIMITED → rate', (r) => r.fulfill(json(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '60' })), T('busy.routine.skip.error.rate'));
      await check('500 → generic', (r) => r.fulfill(json(500, { code: 'INTERNAL' })), T('busy.routine.skip.error.generic'));
      await check('network → generic', (r) => r.abort('failed'), T('busy.routine.skip.error.generic'));
      await check('LIMIT_REACHED skipDays', (r) => r.fulfill(json(400, { code: 'LIMIT_REACHED', params: { limit: 'skipDays', max: 31 } })), T('errors.LIMIT_REACHED', { limit: 'skipDays', max: 31 }));
      await check('LIMIT_REACHED routineRows', (r) => r.fulfill(json(409, { code: 'LIMIT_REACHED', params: { limit: 'routineRows', max: 1500 } })), T('busy.routine.skip.error.rows', { max: 1500 }));

      // ไม่มี mock แล้ว → ลองใหม่สำเร็จด้วยวันเดิม (error ไม่ล้างค่าที่เลือก)
      await A.page.getByTestId('skip-confirm').click();
      await expect(A.page.getByRole('dialog')).toHaveCount(0);
      await expect(toastOf(A.page)).toContainText(T('busy.routine.skip.toast.skipped', { count: 2 }));
      expect(await busyDates(A, routine.mon, routine.end)).not.toContain(d1);

      // 404 (ชุดหายไป) → แผ่นปิด ไม่ค้าง
      await openSkipSheet(A.page, scene.gid, routine.id);
      await tapSkipDay(A.page, addDays(routine.mon, 4));
      await A.page.route(glob, (r) => r.fulfill(json(404, { code: 'NOT_FOUND' })));
      await A.page.getByTestId('skip-confirm').click();
      await expect(A.page.getByRole('dialog')).toHaveCount(0);
      await A.page.unroute(glob);
      expect(problems).toEqual([]);
    });
  }
});

// ═════════════════════════════════════════════════════════════
// 3) ขั้น 3 · privacy · manifest
// ═════════════════════════════════════════════════════════════
for (const { loc, theme } of COMBOS) {
  test(`R15a step3 ${loc}/${theme}: ขั้น "ว่างตรงกัน" เสร็จหลังเปิดดู (ค้างข้ามรีโหลด · ผูกกับกลุ่มนี้)`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann', 'Bob'] });
    const [A] = scene.members as [Member, Member];
    const problems = watchConsole(A.page);
    await createBusyApi(A.context.request, { kind: 'all_day', startDate: daysAhead(2), endDate: daysAhead(2) });
    const step = (id: string) => A.page.locator(`[data-step="${id}"]`);

    await go(A.page, `/groups/${scene.gid}`);
    await expect(step('free')).toHaveAttribute('data-state', 'next');
    await expect(A.page.getByTestId('group-step-cta-free-done')).toHaveCount(0);
    await expect(A.page.getByTestId('group-steps').getByText(T('group.steps.progress', { done: 2, total: 4 }))).toBeVisible();

    await openFree(A.page, { gid: scene.gid });
    await expect(A.page.getByTestId('free-month')).toBeVisible();

    await go(A.page, `/groups/${scene.gid}`);
    await expect(step('free')).toHaveAttribute('data-state', 'done');
    await expect(step('plan')).toHaveAttribute('data-state', 'next');
    await expect(A.page.getByTestId('group-steps').getByText(T('group.steps.progress', { done: 3, total: 4 }))).toBeVisible();
    await expect(A.page.getByTestId('group-step-cta-free-done')).toHaveText(T('group.steps.free.ctaDone'));
    await checkLayout(A.page, testInfo, 'r15a-step3-done', loc, theme);
    await A.page.reload({ waitUntil: 'networkidle' });
    await expect(step('free')).toHaveAttribute('data-state', 'done');

    // กลุ่มอื่นของคนเดียวกัน: ยังไม่ถือว่าเคยดู
    const other = await call<{ group: { id: string } }>(A.context.request, 'POST', '/api/groups', { name: `R15a other ${Date.now().toString(36)}` });
    expect(other.status, other.text).toBe(201);
    const [ogid] = [other.json!.data!.group.id];
    await go(A.page, `/groups/${ogid}`);
    await expect(A.page.locator('[data-step="free"]')).not.toHaveAttribute('data-state', 'done');
    expect(problems).toEqual([]);
  });

  test(`R15a privacy ${loc}/${theme}: /privacy มีข้อ busyStatus ในหมวด "ใครเห็นอะไร"`, async ({ page, context, baseURL }, testInfo) => {
    await setPrefs(context, baseURL!, { locale: loc, theme });
    const problems = watchConsole(page);
    await go(page, '/privacy');
    await expect(page.getByText(msg(loc, 'privacy.see.busyStatus'), { exact: true })).toBeVisible();
    await checkLayout(page, testInfo, 'r15a-privacy', loc, theme);
    expect(problems).toEqual([]);
  });
}

test('R15a manifest: /manifest.webmanifest ครบฟิลด์ · ไอคอนโหลดได้ · <head> ผูก manifest + apple-touch-icon', async ({ page, request, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'ไฟล์สถิตเหมือนกันทุกจอ — รันที่ mobile-390 ตัวเดียว');
  const problems = watchConsole(page);
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/json/);
  const m = (await res.json()) as {
    id: string; name: string; short_name: string; description: string; lang: string; start_url: string; scope: string; display: string;
    background_color: string; theme_color: string; icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };
  expect(m).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', lang: 'th' });
  expect(m.name.length).toBeGreaterThan(0);
  expect(m.short_name.length).toBeGreaterThan(0);
  expect(m.description.length).toBeGreaterThan(0);
  expect(m.background_color).toMatch(/^#[0-9a-f]{3,8}$/i);
  expect(m.theme_color).toMatch(/^#[0-9a-f]{3,8}$/i);
  const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`).sort();
  expect(sizes).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
  expect(m.icons.every((i) => !/\s/.test(i.purpose ?? ''))).toBe(true); // ห้าม "any maskable" รวมกัน
  for (const i of m.icons) {
    const r = await request.get(i.src);
    expect(r.status(), i.src).toBe(200);
    expect(r.headers()['content-type'], i.src).toContain('image/png');
    expect((await r.body()).length, i.src).toBeGreaterThan(200);
  }
  // <head> ของหน้า public
  await go(page, '/login');
  const manifestHref = await page.locator('head link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');
  const apple = await page.locator('head link[rel="apple-touch-icon"]').first().getAttribute('href');
  expect(apple).toBeTruthy();
  const ar = await request.get(new URL(apple!, baseURL ?? E2E_BASE_URL).toString());
  expect(ar.status()).toBe(200);
  expect(ar.headers()['content-type']).toContain('image/png');
  expect(problems).toEqual([]);
});
