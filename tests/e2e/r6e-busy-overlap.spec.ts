// R6E-9 — ลง/แก้ busy ทับ busy เดิมของตัวเอง → popup ถามก่อนบันทึก
//   ทับ → popup แสดงรายการที่ทับ · "กลับไปแก้" = ไม่บันทึก ฟอร์มยังอยู่ค่าเดิม · "ลงซ้ำ" = บันทึก
//   ไม่ทับ / ชนขอบพอดี / แก้รายการเดิมโดยไม่ทับอื่น → ไม่มี popup · Esc = กลับไปแก้ · โฟกัสเริ่มที่ "กลับไปแก้" · โหลดเช็กล้ม → บันทึกได้
//   เกิน 4 รายการ → "และรายการอื่นอีก" ไม่มีตัวเลข · เลย์เอาต์ 375/390/768
import type { Page } from '@playwright/test';
import { expect, test } from './support/auth';
import { api, checkLayout, type Theme } from './support/groups';
import { createBusyApi } from './support/busy';
import { addButton, openCalendar, toast } from './support/calendar-ui';
import { settleAnimations, watchConsole } from './support/fixtures';
import { msg, type Locale } from './support/messages';
import { daysAhead, isHydration, makeScene } from './support/appt';

const locale: Locale = 'th';
const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
const dialogs = (p: Page) => p.getByRole('dialog');

async function listBusy(p: Page): Promise<{ id: string; title: string | null }[]> {
  const r = await api(p.context().request, 'GET', '/api/me/busy');
  return (JSON.parse(r.text) as { data: { busy: { id: string; title: string | null }[] } }).data.busy;
}

/** เปิดฟอร์มลงใหม่ของวัน D แบบ "ช่วงเวลา" แล้วกรอกเวลา/ชื่อ (ยังไม่กดบันทึก) */
async function openTimedForm(p: Page, gid: string, date: string, start: string, end: string, title: string): Promise<void> {
  await openCalendar(p, { gid, view: 'day', date });
  await expect(p.getByTestId('cal-day-panel')).toHaveAttribute('data-date', date);
  await addButton(p).click();
  const sheet = dialogs(p);
  await expect(sheet.getByTestId('busy-form')).toBeVisible();
  const ok = sheet.getByTestId('busy-notice-ok');
  if (await ok.isVisible()) await ok.click();
  await sheet.getByTestId('busy-type-timed').click();
  await sheet.getByTestId('busy-start-time').selectOption(start);
  await sheet.getByTestId('busy-end-time').selectOption(end);
  await sheet.getByTestId('busy-title').fill(title);
}

test.describe('R6E-9 ลงซ้ำ', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องเล่ารันที่ mobile-390 ตัวเดียว (เลย์เอาต์แยกด้านล่าง)');
  });

  test('R6E-9: ทับ/ไม่ทับ/ชนขอบ/แก้รายการเดิม/Esc/โหลดเช็กล้ม', async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann'] });
    const A = scene.members[0]!;
    const a = A.page;
    const problems = watchConsole(a);
    const D = daysAhead(20);
    await createBusyApi(A.context.request, { kind: 'timed', startDate: D, startTime: '10:00', endDate: D, endTime: '12:00', title: 'ประชุมเดิม' });
    const submit = () => dialogs(a).getByTestId('busy-submit');
    const overlap = () => a.getByTestId('busy-overlap');

    // 1) ทับ → popup แสดงรายการ · โฟกัสเริ่มที่ "กลับไปแก้"
    await openTimedForm(a, scene.gid, D, '11:00', '13:00', 'ลงซ้ำ 1');
    await submit().click();
    await expect(overlap()).toBeVisible();
    await expect(a.getByTestId('busy-overlap-item')).toHaveCount(1);
    await expect(a.getByTestId('busy-overlap-item')).toContainText('ประชุมเดิม');
    await expect(a.getByTestId('busy-overlap-item')).toContainText('10:00');
    await expect(a.getByTestId('busy-overlap-back')).toBeFocused();
    await expect(a.getByTestId('busy-overlap-back')).toHaveText(T('busy.form.overlap.back'));
    await expect(a.getByTestId('busy-overlap-confirm')).toHaveText(T('busy.form.overlap.confirm'));
    await checkLayout(a, testInfo, 'r6e-overlap-popup', locale, 'light');

    // 2) กลับไปแก้ = ไม่บันทึก ฟอร์มคงค่า
    await a.getByTestId('busy-overlap-back').click();
    await expect(overlap()).toHaveCount(0);
    await expect(dialogs(a).getByTestId('busy-form')).toBeVisible();
    await expect(dialogs(a).getByTestId('busy-title')).toHaveValue('ลงซ้ำ 1');
    await expect(dialogs(a).getByTestId('busy-start-time')).toHaveValue('11:00');
    expect(await listBusy(a), 'ยังมีรายการเดียว').toHaveLength(1);

    // 3) Esc ที่ popup = กลับไปแก้ (ไม่บันทึก ฟอร์มยังอยู่)
    await submit().click();
    await expect(overlap()).toBeVisible();
    await a.keyboard.press('Escape');
    await expect(overlap()).toHaveCount(0);
    await expect(dialogs(a).getByTestId('busy-form')).toBeVisible();
    expect(await listBusy(a)).toHaveLength(1);

    // 4) ลงซ้ำ = บันทึก
    await submit().click();
    await a.getByTestId('busy-overlap-confirm').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toast(a)).toContainText(T('busy.toast.saved'));
    expect(await listBusy(a)).toHaveLength(2);

    // 5) ชนขอบพอดี (จบ 10:00 · เริ่ม 13:00 ตรงกับปลายของรายการที่ลงซ้ำ) → ไม่มี popup บันทึกเลย
    await openTimedForm(a, scene.gid, D, '08:00', '10:00', 'ขอบก่อน');
    await submit().click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toast(a)).toContainText(T('busy.toast.saved'));
    await openTimedForm(a, scene.gid, D, '13:00', '14:00', 'ขอบหลัง');
    await submit().click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect.poll(async () => (await listBusy(a)).length).toBe(4);

    // 6) ไม่ทับเลย → ไม่มี popup
    await openTimedForm(a, scene.gid, D, '16:00', '17:00', 'ไม่ทับ');
    await submit().click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect.poll(async () => (await listBusy(a)).length).toBe(5);

    // 7) แก้รายการเดิมที่ไม่ทับอื่น (เปลี่ยนแค่ชื่อ) → ไม่มี popup
    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    const lone = (await listBusy(a)).find((b) => b.title === 'ไม่ทับ')!;
    await a.getByTestId(`busy-row-${lone.id}`).click();
    await expect(dialogs(a).getByTestId('busy-form')).toBeVisible();
    await dialogs(a).getByTestId('busy-title').fill('ไม่ทับ แก้ชื่อ');
    await submit().click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect.poll(async () => (await listBusy(a)).some((b) => b.title === 'ไม่ทับ แก้ชื่อ')).toBe(true);

    // 8) แก้ให้ไปทับรายการอื่น → popup · ไม่นับตัวเอง
    await a.getByTestId(`busy-row-${lone.id}`).click();
    await dialogs(a).getByTestId('busy-start-time').selectOption('11:00');
    await dialogs(a).getByTestId('busy-end-time').selectOption('11:30');
    await submit().click();
    await expect(overlap()).toBeVisible();
    await expect(overlap()).not.toContainText('ไม่ทับ แก้ชื่อ');
    await a.getByTestId('busy-overlap-back').click();
    await expect(submit()).toBeFocused(); // กลับไปแก้: โฟกัสกลับที่ปุ่มบันทึกในฟอร์ม
    await a.keyboard.press('Escape');
    await expect(dialogs(a)).toHaveCount(0);

    // 9) เกิน 4 รายการ → ท้ายรายการ "และรายการอื่นอีก" ไม่มีตัวเลข
    const D2 = daysAhead(25);
    for (let i = 0; i < 5; i++) await createBusyApi(A.context.request, { kind: 'timed', startDate: D2, startTime: `${String(9 + i).padStart(2, "0")}:00`, endDate: D2, endTime: `${String(9 + i).padStart(2, "0")}:30`, title: `เยอะ ${i}` });
    await openTimedForm(a, scene.gid, D2, '08:00', '20:00', 'ครอบหมด');
    await submit().click();
    await expect(a.getByTestId('busy-overlap-item')).toHaveCount(4);
    const more = a.getByTestId('busy-overlap-more');
    await expect(more).toHaveText(T('busy.form.overlap.more'));
    expect(await more.innerText()).not.toMatch(/[0-9๐-๙+]/);
    await a.getByTestId('busy-overlap-back').click();
    await expect(submit()).toBeFocused(); // กลับไปแก้: โฟกัสกลับที่ปุ่มบันทึกในฟอร์ม
    await a.keyboard.press('Escape');
    await expect(dialogs(a)).toHaveCount(0);

    // 10) ทั้งวันทับช่วงเวลาในวันเดียวกัน (เทียบตามวันท้องถิ่น) → popup
    await openCalendar(a, { gid: scene.gid, view: 'day', date: D });
    await addButton(a).click();
    await dialogs(a).getByTestId('busy-title').fill('ทั้งวัน');
    await submit().click();
    await expect(overlap()).toBeVisible();
    await a.getByTestId('busy-overlap-back').click();
    await expect(submit()).toBeFocused(); // กลับไปแก้: โฟกัสกลับที่ปุ่มบันทึกในฟอร์ม
    await a.keyboard.press('Escape');
    await expect(dialogs(a)).toHaveCount(0);

    // 11) โหลดเช็กล้ม → บันทึกตามเดิม ไม่บล็อก
    const isCheck = (u: URL) => u.pathname === '/api/me/busy' && u.search !== '';
    await a.route(isCheck, (route) => route.abort('failed'));
    await openTimedForm(a, scene.gid, D, '11:00', '11:30', 'เช็กล้ม');
    await submit().click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toast(a)).toContainText(T('busy.toast.saved'));
    await a.unroute(isCheck);
    await expect.poll(async () => (await listBusy(a)).some((b) => b.title === 'เช็กล้ม')).toBe(true);

    expect(problems.filter((x) => !isHydration(x)).filter((x) => !/ERR_FAILED|Failed to load resource/.test(x.text)), 'console').toEqual([]);
  });
});

// ───────── เลย์เอาต์ popup ทุกขนาดจอ × th/en × สว่าง/มืด ─────────
for (const { loc, theme } of [
  { loc: 'th' as Locale, theme: 'light' as Theme },
  { loc: 'en' as Locale, theme: 'dark' as Theme },
]) {
  test(`R6E-9 เลย์เอาต์ ${loc}/${theme}: popup ลงซ้ำ ไม่ล้นจอ ปุ่ม ≥ 44px`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann'] });
    const A = scene.members[0]!;
    const a = A.page;
    const D = daysAhead(20);
    for (let i = 0; i < 5; i++) await createBusyApi(A.context.request, { kind: 'timed', startDate: D, startTime: `${String(9 + i).padStart(2, "0")}:00`, endDate: D, endTime: `${String(9 + i).padStart(2, "0")}:30`, title: `LongBusy${'z'.repeat(70)}${i}` });
    await openCalendar(a, { gid: scene.gid, view: 'day', date: D });
    await addButton(a).click();
    const sheet = a.getByRole('dialog');
    const ok = sheet.getByTestId('busy-notice-ok');
    if (await ok.isVisible()) await ok.click();
    await sheet.getByTestId('busy-type-timed').click();
    await sheet.getByTestId('busy-start-time').selectOption('08:00');
    await sheet.getByTestId('busy-end-time').selectOption('20:00');
    await sheet.getByTestId('busy-submit').click();
    await expect(a.getByTestId('busy-overlap')).toBeVisible();
    await settleAnimations(a); // รอ transition เปิด dialog จบ
    const r = await a.getByRole('alertdialog').evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, sw: el.scrollWidth, cw: el.clientWidth, vw: document.documentElement.clientWidth, vh: window.innerHeight };
    });
    expect(r.l).toBeGreaterThanOrEqual(0);
    expect(r.r).toBeLessThanOrEqual(r.vw);
    expect(r.b).toBeLessThanOrEqual(r.vh + 1);
    expect(r.sw).toBeLessThanOrEqual(r.cw);
    for (const id of ['busy-overlap-back', 'busy-overlap-confirm']) {
      const bb = (await a.getByTestId(id).boundingBox())!;
      expect(bb.height, `${id} ≥ 44`).toBeGreaterThanOrEqual(44);
      expect(bb.x + bb.width).toBeLessThanOrEqual(r.vw);
    }
    const rows = await a.getByTestId('busy-overlap-item').evaluateAll((els) => els.map((e) => e.scrollWidth > e.clientWidth + 1));
    expect(rows.every((x) => !x), 'แถวรายการไม่ล้น').toBe(true);
    await checkLayout(a, testInfo, 'r6e-overlap-popup-long', loc, theme);
  });
}
