// R6C — ตั้ง "หน้าตาของฉันในกลุ่มนี้" (สี 1–10 + รูปทรง 1–10 แยกกัน ต่อกลุ่ม) + เก็บตก QA R6B (L2)
//   R6C-2/6 เลือกสี+รูปทรง → ตัวอย่างเปลี่ยน → ปฏิทินเดือน (จุดในช่อง + legend) / วัน / รายชื่อสมาชิก / RSVP เห็นค่าที่เลือก
//           "ใช้แบบอัตโนมัติ" กลับค่าเดิม · อีกสมาชิกเห็นค่าที่ตั้ง · กลุ่มอื่นของคนเดียวกันไม่เปลี่ยน
//   R6C-5   375/390/768 × (th·สว่าง | en·มืด): หน้าตั้งค่าไม่ล้นจอ · ตัวเลือก ≥ 44px · คีย์บอร์ด (Tab เข้ากลุ่ม + ลูกศรเปลี่ยนค่า)
//   R6C-7   L2: จอกว้าง (768) ปุ่มแถบบน appt-add-top/busy-add-top ซ่อนตอนกลุ่ม gone
// ข้อความทุกอย่างมาจาก messages/*.json ผ่าน msg() · วันที่สัมพัทธ์กับวันนี้ (Asia/Bangkok) ผ่าน support/appt daysAhead
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/auth';
import { createBusyApi } from './support/busy';
import { openCalendar } from './support/calendar-ui';
import { watchConsole } from './support/fixtures';
import { api, checkLayout, go, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';
import { call, createApptApi, daysAhead, isHydration, makeScene, rsvpApi, type Member, type Scene } from './support/appt';

const COMBOS: { locale: Locale; theme: Theme }[] = [
  { locale: 'th', theme: 'light' },
  { locale: 'en', theme: 'dark' },
];

type Look = { colorIndex: number; shapeIndex: number };
/** สี/รูปทรงที่ใช้แสดงของ `userId` ในกลุ่ม gid ตามที่ API ส่ง (0–9) */
async function lookOf(m: Member, gid: string, userId: string): Promise<Look> {
  const r = await api(m.context.request, 'GET', `/api/groups/${gid}`);
  expect(r.status, r.text).toBe(200);
  const rows = r.json!.data!.group.members as unknown as (Look & { userId: string })[];
  const row = rows.find((x) => x.userId === userId);
  expect(row, `พบสมาชิก ${userId} ในกลุ่ม ${gid}`).toBeTruthy();
  return { colorIndex: row!.colorIndex, shapeIndex: row!.shapeIndex };
}

/** ช่วงเลือก 1–10 ที่ไม่ซ้ำค่าเดิม (ไม่ให้เทสต์ผ่านเพราะค่าบังเอิญตรง) */
const otherSlot = (idx0: number, by: number): number => ((idx0 + by) % 10) + 1;

const appearance = (page: Page) => page.getByTestId('appearance-section');
const preview = (page: Page) => page.getByTestId('appearance-preview');
const status = (page: Page) => page.getByTestId('appearance-status');
/** radio ถูกซ่อนแบบ sr-only → คลิกที่ label ที่ครอบ (พฤติกรรมเดียวกับที่ผู้ใช้กดช่อง) */
const optionLabel = (page: Page, kind: 'color' | 'shape', n: number): Locator => page.locator('label').filter({ has: page.getByTestId(`appearance-${kind}-${n}`) });

async function openSettings(page: Page, gid: string): Promise<void> {
  await go(page, `/groups/${gid}/settings`);
  await expect(appearance(page)).toBeVisible();
}

async function expectLook(el: Locator, color: number, shape: number, what: string): Promise<void> {
  await expect(el, `${what}: data-color`).toHaveAttribute('data-color', String(color));
  await expect(el, `${what}: data-shape`).toHaveAttribute('data-shape', String(shape));
}

/** ตรวจเลย์เอาต์หน้าตั้งค่า: checkLayout (radio ซ่อนแบบ sr-only วัดที่ label ที่ครอบ — ดู measureLayout) + วัดช่อง/ปุ่มของ picker โดยตรง */
async function checkPickerLayout(page: Page, testInfo: import('@playwright/test').TestInfo, locale: Locale, theme: Theme): Promise<void> {
  await checkLayout(page, testInfo, 'r6c-settings', locale, theme);

  const cells = await page.locator('.appr-opt').evaluateAll((els) =>
    els.map((el) => {
      const c = el.querySelector('.appr-cell')!.getBoundingClientRect();
      const l = el.getBoundingClientRect();
      return { w: Math.round(c.width), h: Math.round(c.height), lw: Math.round(l.width), lh: Math.round(l.height), right: c.right, left: c.left };
    }),
  );
  expect(cells, 'มี 20 ช่อง (สี 10 + รูปทรง 10)').toHaveLength(20);
  const vw = page.viewportSize()!.width;
  for (const [i, c] of cells.entries()) {
    expect(c.w, `ช่อง ${i}: กว้าง ≥ 44`).toBeGreaterThanOrEqual(44);
    expect(c.h, `ช่อง ${i}: สูง ≥ 44`).toBeGreaterThanOrEqual(44);
    expect(c.lh, `ช่อง ${i}: label สูง ≥ 44`).toBeGreaterThanOrEqual(44);
    expect(c.left, `ช่อง ${i}: ไม่ล้นซ้าย`).toBeGreaterThanOrEqual(0);
    expect(c.right, `ช่อง ${i}: ไม่ล้นขวา`).toBeLessThanOrEqual(vw);
  }
  // ปุ่ม "ใช้แบบอัตโนมัติ" ≥ 44 (เมื่อ disabled ก็ต้องกดง่ายเมื่อเปิด)
  const auto = await page.getByTestId('appearance-auto').boundingBox();
  expect(auto!.height, 'ปุ่มอัตโนมัติสูง ≥ 44').toBeGreaterThanOrEqual(44);
}

// ───────── R6C-2 / R6C-6 ─────────
test('R6C-2/6: เลือกสี+รูปทรง → เห็นในปฏิทินเดือน/วัน, รายชื่อสมาชิก, RSVP · อีกคนเห็น · อัตโนมัติกลับค่าเดิม · กลุ่มอื่นไม่เปลี่ยน', async ({ newDevice, baseURL }) => {
  test.setTimeout(180_000);
  const locale: Locale = 'th';
  const scene = await makeScene(newDevice, baseURL!, { locale, theme: 'light', labels: ['Ann', 'Ben'] });
  const [a, b] = scene.members as [Member, Member];
  const problems = watchConsole(a.page);
  const problemsB = watchConsole(b.page);
  const gid = scene.gid;

  // กลุ่มที่สองของ A — ค่าต้องไม่เปลี่ยนเมื่อตั้งในกลุ่มแรก
  const other = await api(a.context.request, 'POST', '/api/groups', { name: `Other ${Date.now().toString(36)}` });
  expect(other.status, other.text).toBe(201);
  const otherGid = other.json!.data!.group.id;

  // ข้อมูลให้ปรากฏในที่ต่างๆ: busy ของ A (จุดในช่องเดือน) + นัดที่ A ตอบ "ไป" (RSVP)
  const D = daysAhead(6);
  await createBusyApi(a.context.request, { kind: 'all_day', startDate: D, endDate: D, title: 'r6c' });
  const apptId = await createApptApi(a.context.request, gid, { title: 'R6C นัด', startDate: D, startTime: '10:00', endDate: D, endTime: '11:00' });
  await rsvpApi(a.context.request, apptId, 'going');

  const baseG = await lookOf(a, gid, a.userId);
  const baseO = await lookOf(a, otherGid, a.userId);
  const color = otherSlot(baseG.colorIndex, 4); // slot 1–10 ≠ ค่าเดิม
  const shape = otherSlot(baseG.shapeIndex, 6);
  expect(color - 1).not.toBe(baseG.colorIndex);
  expect(shape - 1).not.toBe(baseG.shapeIndex);

  // ───── ก่อนตั้ง: ตัวอย่าง = ค่าอัตโนมัติ · ปุ่มอัตโนมัติ disabled ─────
  await openSettings(a.page, gid);
  await expectLook(preview(a.page), baseG.colorIndex + 1, baseG.shapeIndex + 1, 'ตัวอย่างก่อนตั้ง');
  await expect(a.page.getByTestId('appearance-auto')).toBeDisabled();
  await expect(a.page.getByTestId(`appearance-color-${baseG.colorIndex + 1}`)).toBeChecked();
  await expect(a.page.getByTestId(`appearance-shape-${baseG.shapeIndex + 1}`)).toBeChecked();

  // ───── เลือกสี แล้วรูปทรง (แยกกัน) ─────
  await optionLabel(a.page, 'color', color).click();
  await expect(status(a.page)).toHaveText(msg(locale, 'groupSettings.appearance.saved'));
  await expectLook(preview(a.page), color, baseG.shapeIndex + 1, 'เลือกสีอย่างเดียว → รูปทรงยังเดิม');
  await optionLabel(a.page, 'shape', shape).click();
  await expect(preview(a.page)).toHaveAttribute('data-shape', String(shape));
  await expectLook(preview(a.page), color, shape, 'ตัวอย่างหลังเลือกทั้งสอง');
  await expect(a.page.getByTestId(`appearance-color-${color}`)).toBeChecked();
  await expect(a.page.getByTestId(`appearance-shape-${shape}`)).toBeChecked();
  await expect(status(a.page)).toHaveText(msg(locale, 'groupSettings.appearance.saved'));
  await expect(a.page.getByTestId('appearance-auto')).toBeEnabled();

  // เซิร์ฟเวอร์จำค่า (API) · กลุ่มอื่นของ A ไม่เปลี่ยน
  expect(await lookOf(a, gid, a.userId)).toEqual({ colorIndex: color - 1, shapeIndex: shape - 1 });
  expect(await lookOf(a, otherGid, a.userId), 'กลุ่มอื่นไม่เปลี่ยน').toEqual(baseO);

  // โหลดหน้าใหม่ → ยังเป็นค่าที่ตั้ง
  await openSettings(a.page, gid);
  await expectLook(preview(a.page), color, shape, 'ตัวอย่างหลังโหลดใหม่');

  // ───── รายชื่อสมาชิก (หน้าตั้งค่ากลุ่มเดียวกัน) ─────
  const rowOf = (page: Page, m: Member, role: 'admin' | 'member') =>
    page.getByRole('group', { name: msg(locale, 'group.members.rowAria', { name: m.p.displayName, role: msg(locale, `roles.${role}`) }) });
  await expectLook(rowOf(a.page, a, 'admin').locator('.member-avatar'), color, shape, 'รายชื่อสมาชิก (ตัวเอง)');

  // ───── ปฏิทินเดือน: จุดในช่อง + legend ─────
  await openCalendar(a.page, { gid, view: 'month', date: D });
  await expectLook(a.page.getByTestId(`cal-cell-${D}`).locator('.member-dot'), color, shape, 'จุดในช่องเดือน');
  await expectLook(a.page.getByTestId(`cal-who-${a.userId}`).locator('.member-dot'), color, shape, 'legend เดือน');

  // ───── ปฏิทินวัน ─────
  await openCalendar(a.page, { gid, view: 'day', date: D });
  await expect(a.page.getByTestId('cal-day-panel')).toHaveAttribute('data-date', D);
  await expectLook(a.page.getByTestId(`cal-strip-${a.userId}`).locator('.member-avatar'), color, shape, 'แถบเวลาวัน (อวาตาร์)');
  await expectLook(a.page.getByTestId(`cal-person-${a.userId}`).locator('.member-avatar'), color, shape, 'รายชื่อวัน (คนที่ไม่ว่าง)');

  // ───── RSVP ในหน้านัด ─────
  await go(a.page, `/appointments/${apptId}`);
  await expect(a.page.getByTestId('appt-who-going')).toBeVisible();
  await expectLook(a.page.getByTestId('appt-who-going').locator('.member-avatar'), color, shape, 'RSVP ในนัด');

  // ───── อีกสมาชิก (B) เห็นค่าที่ A ตั้ง · ของ B เองไม่เปลี่ยน ─────
  const baseB = await lookOf(b, gid, b.userId);
  await openCalendar(b.page, { gid, view: 'month', date: D });
  await expectLook(b.page.getByTestId(`cal-who-${a.userId}`).locator('.member-dot'), color, shape, 'B เห็น A ใน legend');
  await expectLook(b.page.getByTestId(`cal-cell-${D}`).locator('.member-dot'), color, shape, 'B เห็นจุดของ A ในช่องเดือน');
  await expectLook(b.page.getByTestId(`cal-who-${b.userId}`).locator('.member-dot'), baseB.colorIndex + 1, baseB.shapeIndex + 1, 'B เห็นของตัวเองเท่าเดิม');
  await go(b.page, `/appointments/${apptId}`);
  await expectLook(b.page.getByTestId('appt-who-going').locator('.member-avatar'), color, shape, 'B เห็น A ใน RSVP');

  // ───── "ใช้แบบอัตโนมัติ" → กลับค่าเดิมทุกที่ ─────
  await openSettings(a.page, gid);
  await a.page.getByTestId('appearance-auto').click();
  await expect(status(a.page)).toHaveText(msg(locale, 'groupSettings.appearance.autoSaved'));
  await expectLook(preview(a.page), baseG.colorIndex + 1, baseG.shapeIndex + 1, 'ตัวอย่างหลังอัตโนมัติ');
  await expect(a.page.getByTestId('appearance-auto')).toBeDisabled();
  expect(await lookOf(a, gid, a.userId)).toEqual(baseG);
  expect(await lookOf(a, otherGid, a.userId), 'กลุ่มอื่นยังเท่าเดิม').toEqual(baseO);
  await openCalendar(a.page, { gid, view: 'month', date: D });
  await expectLook(a.page.getByTestId(`cal-who-${a.userId}`).locator('.member-dot'), baseG.colorIndex + 1, baseG.shapeIndex + 1, 'legend หลังอัตโนมัติ');
  await openCalendar(b.page, { gid, view: 'month', date: D });
  await expectLook(b.page.getByTestId(`cal-who-${a.userId}`).locator('.member-dot'), baseG.colorIndex + 1, baseG.shapeIndex + 1, 'B เห็น A กลับค่าเดิม');

  // ซ้ำกับคนอื่นได้: B ตั้งเป็นค่าเดียวกับที่ A เคยตั้ง → ไม่ถูกปฏิเสธ
  const dup = await call(b.context.request, 'PATCH', `/api/groups/${gid}/members/me/appearance`, { color, shape });
  expect(dup.status, dup.text).toBe(200);

  expect(problems.filter((p) => !isHydration(p)), 'console error (A)').toEqual([]);
  expect(problemsB.filter((p) => !isHydration(p)), 'console error (B)').toEqual([]);
});

// ───────── R6C-5: เลย์เอาต์ ─────────
for (const { locale, theme } of COMBOS) {
  test(`R6C-5 ${locale}/${theme}: หน้าตั้งค่า — ไม่ล้นจอ ตัวเลือก ≥44px ชื่อสี/รูปทรงอ่านได้`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, theme, labels: ['Ann'] });
    const a = scene.members[0]!;
    const problems = watchConsole(a.page);
    await openSettings(a.page, scene.gid);
    await checkPickerLayout(a.page, testInfo, locale, theme);

    // ชื่อสี/รูปทรง 10+10 เป็นข้อความที่อ่านได้ (aria-label ของ radio) และต่างกันทั้งหมด · ตัวอย่างมีชื่อ
    const names = await a.page.getByTestId(/^appearance-(color|shape)-\d+$/).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(names).toHaveLength(20);
    for (const kind of ['color', 'shape'] as const) {
      for (let n = 1; n <= 10; n++) {
        await expect(a.page.getByTestId(`appearance-${kind}-${n}`)).toHaveAccessibleName(msg(locale, 'groupSettings.appearance.optionAria', { name: msg(locale, `groupSettings.appearance.${kind}.${n}`) }));
      }
    }
    expect(new Set(names.slice(0, 10)).size, 'ชื่อสี 10 ชื่อไม่ซ้ำ').toBe(10);
    expect(new Set(names.slice(10)).size, 'ชื่อรูปทรง 10 ชื่อไม่ซ้ำ').toBe(10);
    await expect(a.page.getByRole('radiogroup')).toHaveCount(2);
    await expect(a.page.getByRole('radiogroup', { name: msg(locale, 'groupSettings.appearance.colorLabel') })).toBeVisible();
    await expect(a.page.getByRole('radiogroup', { name: msg(locale, 'groupSettings.appearance.shapeLabel') })).toBeVisible();
    await expect(preview(a.page)).toHaveRole('img');

    // ที่ 768 มี 10 ช่องต่อแถว · ที่แคบ 5 ช่อง x 2 แถว
    const rowsOfColor = await a.page.locator('.appr-grid').first().evaluate((el) => new Set([...el.querySelectorAll('.appr-cell')].map((c) => Math.round(c.getBoundingClientRect().top))).size);
    expect(rowsOfColor, 'จำนวนแถวของกริดสี').toBe((a.page.viewportSize()?.width ?? 0) >= 768 ? 1 : 2);

    for (const p of problems.filter(isHydration)) testInfo.annotations.push({ type: 'hydration', description: p.text.slice(0, 80) });
    expect(problems.filter((p) => !isHydration(p)), 'console error').toEqual([]);
  });
}

// ───────── R6C-5: คีย์บอร์ด ─────────
test('R6C-5: คีย์บอร์ด — Tab เข้า radiogroup (จุดเดียวต่อกลุ่ม) แล้วลูกศรเปลี่ยนค่า · Home/End', async ({ newDevice, baseURL }) => {
  test.setTimeout(90_000);
  const locale: Locale = 'th';
  const scene = await makeScene(newDevice, baseURL!, { locale, theme: 'light', labels: ['Ann'] });
  const a = scene.members[0]!;
  const problems = watchConsole(a.page);
  await openSettings(a.page, scene.gid);
  const base = await lookOf(a, scene.gid, a.userId);
  const cur = base.colorIndex + 1;

  // Tab ไปจนโฟกัสอยู่ใน radiogroup สี — ต้องเป็น radio ที่เลือกอยู่ (roving: 1 จุดต่อกลุ่ม)
  const focusedTestId = () => a.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
  let landed = '';
  for (let i = 0; i < 60 && !/^appearance-color-/.test(landed); i++) {
    await a.page.keyboard.press('Tab');
    landed = await focusedTestId();
  }
  expect(landed, 'Tab เข้ากลุ่มสีที่ radio ที่เลือกอยู่').toBe(`appearance-color-${cur}`);

  // ลูกศรขวา → ช่องถัดไป (วนจาก 10 → 1) · บันทึกเมื่อเลือก
  const next = (cur % 10) + 1;
  await a.page.keyboard.press('ArrowRight');
  await expect(a.page.getByTestId(`appearance-color-${next}`)).toBeChecked();
  await expect(a.page.getByTestId(`appearance-color-${next}`)).toBeFocused();
  await expect(preview(a.page)).toHaveAttribute('data-color', String(next));
  await expect(status(a.page)).toHaveText(msg(locale, 'groupSettings.appearance.saved'));
  await expect.poll(async () => (await lookOf(a, scene.gid, a.userId)).colorIndex, { message: 'เซิร์ฟเวอร์รับค่าจากคีย์บอร์ด' }).toBe(next - 1);

  // ลูกศรซ้าย กลับมา
  await a.page.keyboard.press('ArrowLeft');
  await expect(a.page.getByTestId(`appearance-color-${cur}`)).toBeChecked();
  await expect(preview(a.page)).toHaveAttribute('data-color', String(cur));

  // Home/End ไปช่องแรก/ท้ายของกลุ่ม
  await expect(status(a.page)).toHaveText(msg(locale, 'groupSettings.appearance.saved'));
  await a.page.keyboard.press('End');
  await expect(a.page.getByTestId('appearance-color-10')).toBeChecked();
  await expect(preview(a.page)).toHaveAttribute('data-color', '10');
  await expect(a.page.getByTestId('appearance-auto')).toBeEnabled(); // รอจน PATCH จบก่อนกดต่อ (ห้ามส่งซ้อน)
  await a.page.keyboard.press('Home');
  await expect(a.page.getByTestId('appearance-color-1')).toBeChecked();
  await expect(preview(a.page)).toHaveAttribute('data-color', '1');

  // Tab ต่อ → ออกจากกลุ่มสี ไปกลุ่มรูปทรง (radio ที่เลือกอยู่ของกลุ่มนั้น) ไม่ต้องไล่ทีละช่อง
  await expect(a.page.getByTestId('appearance-auto')).toBeEnabled();
  await a.page.keyboard.press('Tab');
  expect(await focusedTestId(), 'Tab ถัดไปเข้ากลุ่มรูปทรง').toMatch(/^appearance-shape-\d+$/);
  await expect(a.page.getByTestId(/^appearance-shape-\d+$/).and(a.page.locator(':focus'))).toBeChecked();

  expect(problems.filter((p) => !isHydration(p)), 'console error').toEqual([]);
});

// ───────── R6C-7 L2: ปุ่มแถบบนจอกว้างซ่อนตอนกลุ่ม gone ─────────
test('R6C-7 L2: จอกว้าง — appt-add-top/busy-add-top เห็นตอนปกติ แล้วซ่อนตอนกลุ่ม gone', async ({ newDevice, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet-768', 'ปุ่มแถบบนแสดงที่ ≥ 48em (768) เท่านั้น');
  test.setTimeout(90_000);
  const locale: Locale = 'th';
  const scene: Scene = await makeScene(newDevice, baseURL!, { locale, theme: 'light', labels: ['Ann', 'Ben'] });
  const b = scene.members[1]!;
  // 404 ของ API ปฏิทินหลังออกจากกลุ่มเป็นสิ่งที่คาดไว้ (เบราว์เซอร์ log เป็น console error) — กรองเฉพาะ URL นั้น ที่เหลือต้องว่าง
  const problems = watchConsole(b.page, (m) => /404/.test(m.text) && (m.url ?? '').includes(`/api/groups/${scene.gid}/calendar`));

  await openCalendar(b.page, { gid: scene.gid, view: 'month' });
  await expect(b.page.getByTestId('appt-add-top')).toBeVisible();
  await expect(b.page.getByTestId('busy-add-top')).toBeVisible();

  // B ออกจากกลุ่มขณะเปิดปฏิทินค้างอยู่ → เลื่อนเดือน = gone
  expect((await api(b.context.request, 'POST', `/api/groups/${scene.gid}/leave`)).status).toBe(200);
  await b.page.getByTestId('cal-next').click();
  await expect(b.page.getByTestId('cal-gone')).toBeVisible();
  await expect(b.page.getByTestId('appt-add-top')).toHaveCount(0);
  await expect(b.page.getByTestId('busy-add-top')).toHaveCount(0);
  await expect(b.page.getByTestId('appt-add-fab')).toHaveCount(0);

  expect(problems.filter((p) => !isHydration(p)), 'console error').toEqual([]);
});
