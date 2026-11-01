// R6B — ปฏิทิน: แท็บ "ว่างตรงกัน" เด่น (F3ข) + ปุ่มลอย "+ สร้างนัด" ข้าง "+ ลงวันไม่ว่าง" (F3ค)
//   R6B-1 แท็บ free มี data-emphasis + ไอคอน · ยังไม่เลือก = สีต่างจากแท็บอื่น · เลือกแล้ว = aria-pressed + สไตล์ "เลือกแล้ว" เดียวกับแท็บอื่น
//   R6B-2 ปุ่มสร้างนัด (มือถือ: appt-add-fab · ≥48em: appt-add-top) → ฟอร์มของกลุ่มที่เลือกอยู่ → สร้างจริง → หน้ารายละเอียด + API ยืนยัน
//   R6B-3 375/390/768 × (th·สว่าง | en·มืด): checkLayout · appt-add-fab ไม่ทับ busy-add · เลื่อนลงสุดแล้วเนื้อหา/hint ไม่อยู่ใต้ปุ่มลอย · มุมมอง month/free/day/mine
// ข้อความทุกอย่างมาจาก messages/*.json ผ่าน msg() · วันที่สัมพัทธ์กับวันนี้ (Asia/Bangkok) ผ่าน support/appt daysAhead
import type { Page } from '@playwright/test';
import { expect, test } from './support/auth';
import { createBusyApi } from './support/busy';
import { openCalendar, type CalView } from './support/calendar-ui';
import { measureLayout, watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';
import { apptIdFromUrl, call, daysAhead, isHydration, makeScene, pickFormDate, type ApptApi } from './support/appt';

const COMBOS: { locale: Locale; theme: Theme }[] = [
  { locale: 'th', theme: 'light' },
  { locale: 'en', theme: 'dark' },
];

const VIEWS: readonly CalView[] = ['month', 'free', 'day', 'mine'];
const isWide = (page: Page): boolean => (page.viewportSize()?.width ?? 0) >= 768;
/** ปุ่มสร้างนัดที่ควรเห็นตามความกว้างจอ */
const apptButton = (page: Page) => page.getByTestId(isWide(page) ? 'appt-add-top' : 'appt-add-fab');
const busyButton = (page: Page) => page.getByTestId(isWide(page) ? 'busy-add-top' : 'busy-add');

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** เปิดมุมมองแล้วรอจนปุ่มสร้างนัด/ลงวันไม่ว่างขึ้น (แสดงหลังโหลดข้อมูลเสร็จ — showFab) */
async function openView(page: Page, gid: string, view: CalView, date?: string): Promise<void> {
  await openCalendar(page, { gid, view, date });
  await expect(page.getByTestId(`cal-view-${view}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(apptButton(page)).toBeVisible();
  await expect(busyButton(page)).toBeVisible();
}

/** เลื่อนทุกตัวเลื่อน (เอกสาร + บรรพบุรุษของ .cal-main) ลงสุด */
async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const se = document.scrollingElement;
    if (se) se.scrollTop = se.scrollHeight;
    for (let el = document.querySelector('.cal-main')?.parentElement; el; el = el.parentElement) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(100); // ให้ scroll/layout นิ่ง (ไม่มี smooth scroll ใน e2e)
}

/** กล่องข้อความ/ปุ่มที่เห็นใน .cal-main ที่ทับกับปุ่มลอย (หลังเลื่อนลงสุด) — ต้องว่าง */
async function contentUnderFab(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fabs = [...document.querySelectorAll<HTMLElement>('[data-testid="fab-row"] > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const hit: string[] = [];
    const main = document.querySelector('.cal-main');
    if (!main) return ['ไม่พบ .cal-main'];
    for (const el of main.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, li, a[href], button, input, select, [role="gridcell"]')) {
      if (el.closest('[role="dialog"]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // sr-only
      for (const f of fabs) {
        if (r.left < f.right && f.left < r.right && r.top < f.bottom && f.top < r.bottom) {
          hit.push(`<${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.top)}–${Math.round(r.bottom)} vs fab ${Math.round(f.top)}`);
          break;
        }
      }
    }
    return hit;
  });
}

// ───────── R6B-1 ─────────
test('R6B-1: แท็บว่างตรงกันเด่น (ไอคอน + สีเน้น) · เลือกแล้วใช้สไตล์เลือกแล้วเหมือนแท็บอื่น', async ({ newDevice, baseURL }) => {
  test.setTimeout(90_000);
  const locale: Locale = 'th';
  const scene = await makeScene(newDevice, baseURL!, { locale, theme: 'light', labels: ['Ann', 'Ben'] });
  const page = scene.members[0]!.page;
  const problems = watchConsole(page);
  await openCalendar(page, { gid: scene.gid, view: 'month' });

  const tab = (v: CalView) => page.getByTestId(`cal-view-${v}`);
  const bg = (v: CalView) => tab(v).evaluate((el) => getComputedStyle(el).backgroundColor);
  const fg = (v: CalView) => tab(v).evaluate((el) => getComputedStyle(el).color);

  // ลำดับ/ข้อความเดิม
  for (const [i, v] of VIEWS.entries()) {
    await expect(page.locator('.cal-views > button').nth(i)).toHaveAttribute('data-testid', `cal-view-${v}`);
    await expect(tab(v)).toHaveText(msg(locale, `calendar.view.${v}`));
  }
  await expect(tab('free')).toHaveAttribute('data-emphasis', 'true');
  await expect(tab('free').locator('svg')).toHaveCount(1);
  for (const v of ['month', 'day', 'mine'] as const) {
    await expect(tab(v)).not.toHaveAttribute('data-emphasis');
    await expect(tab(v).locator('svg')).toHaveCount(0);
  }

  // month เลือกอยู่ → จำสไตล์ "เลือกแล้ว" และ "ยังไม่เลือก" ของแท็บธรรมดา
  await expect(tab('month')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab('free')).toHaveAttribute('aria-pressed', 'false');
  const selBg = await bg('month');
  const selFg = await fg('month');
  const plainBg = await bg('day');
  const freeIdleBg = await bg('free');
  expect(freeIdleBg, 'ยังไม่เลือก: แท็บว่างตรงกันสีพื้นต่างจากแท็บธรรมดา').not.toBe(plainBg);
  expect(freeIdleBg, 'ยังไม่เลือก: แท็บว่างตรงกันไม่ดูเหมือนแท็บที่เลือกอยู่').not.toBe(selBg);

  // เลือก free → aria-pressed + สไตล์เดียวกับแท็บที่เลือกอยู่ · month กลับเป็นแบบธรรมดา
  await tab('free').click();
  await expect(tab('free')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab('month')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => bg('free'), { message: 'เลือกแล้ว: พื้นเหมือนแท็บอื่นที่เลือก' }).toBe(selBg);
  await expect.poll(() => fg('free'), { message: 'เลือกแล้ว: สีตัวอักษรเหมือนแท็บอื่นที่เลือก' }).toBe(selFg);
  await expect.poll(() => bg('month')).toBe(plainBg);

  // ไปแท็บอื่น → free กลับเป็นสีเน้น
  await tab('day').click();
  await expect(tab('day')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => bg('day')).toBe(selBg);
  await expect.poll(() => bg('free')).toBe(freeIdleBg);

  expect(problems.filter((p) => !isHydration(p)), 'console error').toEqual([]);
});

// ───────── R6B-2 ─────────
test('R6B-2: ปุ่มสร้างนัดบนปฏิทิน → ฟอร์มของกลุ่มที่เลือกอยู่ → สร้างได้จริง', async ({ newDevice, baseURL }) => {
  test.setTimeout(120_000);
  const locale: Locale = 'th';
  const scene = await makeScene(newDevice, baseURL!, { locale, theme: 'light', labels: ['Ann', 'Ben'] });
  const a = scene.members[0]!;
  const problems = watchConsole(a.page);
  // กลุ่มที่สองของ A — ปุ่มต้องผูกกับกลุ่มที่เลือกอยู่ (?g) ไม่ใช่กลุ่มอื่น
  const otherName = `Other ${Date.now().toString(36)}`;
  await createGroupApi(a.context.request, otherName);

  await openView(a.page, scene.gid, 'month');
  const btn = apptButton(a.page);
  await expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(btn).toHaveAccessibleName(msg(locale, 'appointments.create'));
  if (!isWide(a.page)) {
    await expect(a.page.getByTestId('appt-add-top')).toBeHidden();
    await expect(a.page.getByTestId('fab-row').getByTestId('appt-add-fab')).toBeVisible();
  } else {
    await expect(a.page.getByTestId('appt-add-fab')).toBeHidden();
  }

  // เปิดจากมุมมอง free แล้วยกเลิก (ฟอร์มเปิดได้จากทุกมุมมองที่ปุ่มแสดง)
  await openView(a.page, scene.gid, 'free');
  await apptButton(a.page).click();
  const form = a.page.getByTestId('appt-form');
  await expect(form).toBeVisible();
  await expect(form).toContainText(msg(locale, 'appointments.form.inGroup', { group: scene.groupName }));
  await a.page.getByTestId('appt-form-cancel').click();
  await expect(form).toHaveCount(0);

  // สร้างจริงจากมุมมองเดือน
  await openView(a.page, scene.gid, 'month');
  await apptButton(a.page).click();
  await expect(form).toBeVisible();
  await expect(a.page.getByRole('dialog')).toBeVisible();
  await expect(form).toContainText(msg(locale, 'appointments.form.inGroup', { group: scene.groupName }));
  await expect(form).not.toContainText(otherName);
  const title = `R6B นัด ${Math.random().toString(16).slice(2, 7)}`;
  const date = daysAhead(10);
  await a.page.getByTestId('appt-title').fill(title);
  await pickFormDate(a.page, date, locale);
  await a.page.getByTestId('appt-start-time').selectOption('10:00');
  await a.page.getByTestId('appt-end-time').selectOption('11:00');
  await a.page.getByTestId('appt-submit').click();
  await a.page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
  const id = apptIdFromUrl(a.page);
  await expect(a.page.getByTestId('appt-detail-title')).toHaveText(title);

  const r = await call<{ appointment: ApptApi & { groupId: string; title: string } }>(a.context.request, 'GET', `/api/appointments/${id}`);
  expect(r.status, r.text).toBe(200);
  expect(r.json?.data?.appointment.groupId).toBe(scene.gid);
  expect(r.json?.data?.appointment.title).toBe(title);
  expect(r.json?.data?.appointment.status).toBe('active');
  // สมาชิกอีกคนเห็นนัดในรายการของกลุ่ม (API)
  const list = await call<{ appointments: { id: string }[] }>(scene.members[1]!.context.request, 'GET', `/api/groups/${scene.gid}/appointments`);
  expect(list.status, list.text).toBe(200);
  expect(list.json?.data?.appointments.map((x) => x.id)).toContain(id);

  expect(problems.filter((p) => !isHydration(p)), 'console error').toEqual([]);
});

// ───────── R6B-3 ─────────
for (const { locale, theme } of COMBOS) {
  test(`R6B-3 ${locale}/${theme}: month/free/day/mine — ไม่ล้นจอ ปุ่ม ≥44px ปุ่มลอยไม่ทับกัน ไม่ทับเนื้อหา/hint`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, theme, labels: ['Ann', 'Ben'] });
    const [a, b] = scene.members as [typeof scene.members[0], typeof scene.members[0]];
    const page = a.page;
    const problems = watchConsole(page);
    const D = daysAhead(5);
    // ข้อมูล: A มี busy (มุมมอง "ของฉัน" แสดงปุ่มเมื่อมีรายการ) + B ติดวันเดียวกัน
    await createBusyApi(a.context.request, { kind: 'all_day', startDate: D, endDate: D, title: 'r6b' });
    await createBusyApi(b.context.request, { kind: 'timed', startDate: D, startTime: '09:00', endDate: D, endTime: '12:00', title: 'r6b-b' });

    for (const view of VIEWS) {
      await openView(page, scene.gid, view, D);
      const appt = apptButton(page);
      const busy = busyButton(page);
      await expect(appt).toHaveAccessibleName(msg(locale, 'appointments.create'));
      await expect(busy).toContainText(msg(locale, 'busy.add'));
      await checkLayout(page, testInfo, `r6b-${view}`, locale, theme);

      const [ab, bb] = [await appt.boundingBox(), await busy.boundingBox()];
      expect(ab && bb, `${view}: วัดกล่องปุ่มได้`).toBeTruthy();
      expect(intersects(ab!, bb!), `${view}: ปุ่มสร้างนัดไม่ทับปุ่มลงวันไม่ว่าง ${JSON.stringify([ab, bb])}`).toBe(false);
      for (const box of [ab!, bb!]) {
        expect(box.height, `${view}: ปุ่มสูง ≥ 44`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${view}: ปุ่มกว้าง ≥ 44`).toBeGreaterThanOrEqual(44);
        expect(box.x, `${view}: ปุ่มไม่ล้นซ้าย`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${view}: ปุ่มไม่ล้นขวา`).toBeLessThanOrEqual(page.viewportSize()!.width);
      }
      // ข้อความในปุ่มไม่ถูกตัด (ellipsis) ที่ 375 ขึ้นไป
      for (const btn of [appt, busy]) {
        const clipped = await btn.locator('span').first().evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(clipped, `${view}: ข้อความในปุ่มไม่ถูกตัด`).toBe(false);
      }

      if (!isWide(page)) {
        // สองปุ่มเรียงแนวนอนในแถวเดียว (สร้างนัดอยู่ซ้าย ลงวันไม่ว่างชิดขวา)
        expect(Math.abs(ab!.y + ab!.height / 2 - (bb!.y + bb!.height / 2)), `${view}: อยู่แถวเดียวกัน`).toBeLessThanOrEqual(2);
        expect(ab!.x + ab!.width, `${view}: สร้างนัดอยู่ซ้ายของลงวันไม่ว่าง`).toBeLessThanOrEqual(bb!.x);
        await scrollToBottom(page);
        if (view === 'month') {
          const hint = page.getByText(msg(locale, 'calendar.busyLegend.hint'), { exact: true });
          await expect(hint).toBeVisible();
          const hb = await hint.boundingBox();
          for (const f of [await appt.boundingBox(), await busy.boundingBox()]) {
            expect(intersects(hb!, f!), `month: hint ไม่อยู่ใต้ปุ่มลอย hint=${JSON.stringify(hb)} fab=${JSON.stringify(f)}`).toBe(false);
          }
          expect(hb!.y + hb!.height, 'month: hint อยู่เหนือแถวปุ่มลอย').toBeLessThanOrEqual((await page.getByTestId('fab-row').boundingBox())!.y);
        }
        expect(await contentUnderFab(page), `${view}: เลื่อนลงสุดแล้วไม่มีเนื้อหาอยู่ใต้ปุ่มลอย`).toEqual([]);
      } else {
        await expect(page.getByTestId('fab-row')).toBeHidden();
      }
    }

    for (const p of problems.filter(isHydration)) testInfo.annotations.push({ type: 'hydration', description: p.text.slice(0, 80) });
    expect(problems.filter((p) => !isHydration(p)), 'console error').toEqual([]);
  });
}

// ───────── R6B-3 (เสริม): จอแคบกว่า 375 — ปุ่มสร้างนัดเหลือไอคอน ชื่อปุ่มยังอ่านได้ ─────────
test('R6B-3 จอ 360: ปุ่มสร้างนัดเหลือไอคอน (ชื่อปุ่มยังอยู่) · ไม่ทับกัน ไม่ล้นจอ', async ({ newDevice, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-375', 'ครั้งเดียวพอ — ตั้ง viewport 360 เอง');
  test.setTimeout(90_000);
  for (const { locale, theme } of COMBOS) {
    const scene = await makeScene(newDevice, baseURL!, { locale, theme, labels: ['Ann', 'Ben'] });
    const page = scene.members[0]!.page;
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await openView(page, scene.gid, 'month');
    const appt = page.getByTestId('appt-add-fab');
    await expect(appt).toHaveAccessibleName(msg(locale, 'appointments.create'));
    const textBox = await appt.locator('span').first().boundingBox();
    expect((textBox?.width ?? 0) <= 1, 'ข้อความของปุ่มสร้างนัดซ่อนแบบ sr-only').toBe(true);
    await expect(page.getByTestId('busy-add')).toContainText(msg(locale, 'busy.add'));
    const [ab, bb] = [await appt.boundingBox(), await page.getByTestId('busy-add').boundingBox()];
    expect(intersects(ab!, bb!)).toBe(false);
    // 360 อยู่นอกเมทริกซ์ R0-12 (375/390/768): ช่องวันในตารางเดือนแคบเหลือ 43px เป็นข้อจำกัดเดิมของตาราง (ไม่ใช่ R6B)
    // → ที่นี่ตรวจเฉพาะ horizontal scroll + ขนาดปุ่มลอยทั้งสอง
    const l = await measureLayout(page);
    expect([l.scrollWidth <= l.clientWidth, l.bodyScrollWidth <= l.clientWidth], '360: ไม่มี horizontal scroll').toEqual([true, true]);
    for (const box of [ab!, bb!]) expect(Math.min(box.width, box.height), '360: ปุ่มลอย ≥ 44px').toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`r6b-360-month-${locale}-${theme}.png`), fullPage: true, animations: 'disabled' });
    await scrollToBottom(page);
    expect(await contentUnderFab(page), '360: เลื่อนลงสุดแล้วไม่มีเนื้อหาอยู่ใต้ปุ่มลอย').toEqual([]);
    expect(problems.filter((p) => !isHydration(p)), 'console error').toEqual([]);
  }
});
