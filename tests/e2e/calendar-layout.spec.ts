// R3-7 / R3-8 / R3-9 — เลย์เอาต์ปฏิทิน + sheet ลงวันไม่ว่าง ที่ 375/390/768 · ไทย+สว่าง และ อังกฤษ+มืด (สุ่มคู่ให้ครบทั้งสองภาษาและสองธีมโดยไม่คูณ 4)
//   (ชุด 2×2 เต็มของหน้าเดิมอยู่ใน responsive.spec.ts/groups-responsive.spec.ts · คู่สีสมาชิกในโหมดมืดครอบโดย `npm run contrast`)
//
// ทุกมุมมองต้อง: ไม่มี horizontal scroll · a/button/input ที่เห็น ≥ 44×44 (รวมช่องวันในตารางเดือน) · หัวตารางเริ่มจันทร์ · ชื่อสมาชิกยาวไม่ดันจอ
// เดือน 4/5/6 สัปดาห์เลือกจากปฏิทินจริงเทียบกับวันนี้ (ไม่ hard-code ปี) · 6 สัปดาห์มี busy ที่ช่องนอกเดือนท้ายตารางด้วย (X25)
import { expect, test } from './support/auth';
import { addDays, addMonths, createBusyApi, isoWeekday, monthOf, nextMonthWithWeeks, todayBkk, weeksInMonthGrid } from './support/busy';
import { addButton, cell, monthGrid, openCalendar } from './support/calendar-ui';
import { measureLayout, setPrefs, watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, joinViaApiCode, person, signup, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';

const COMBOS: readonly (readonly [Locale, Theme])[] = [
  ['th', 'light'],
  ['en', 'dark'],
];

/** วันแรกของตารางเดือน (จันทร์ที่ตรงหรือก่อนวันที่ 1) */
const gridStart = (ym: string): string => addDays(`${ym}-01`, -isoWeekday(`${ym}-01`));

for (const [locale, theme] of COMBOS) {
  test(`${locale}/${theme}: เดือน 4/5/6 สัปดาห์ · มุมมองวัน · ของฉัน · ฟอร์ม · ตัวเลือกกลุ่ม — ไม่ล้นจอ ปุ่ม ≥ 44px หัวเริ่มจันทร์`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const a = await newDevice();
    const b = await newDevice();
    await setPrefs(a.context, baseURL!, { locale, theme });
    const pa = person('Ann');
    const pb = { ...person('B'), displayName: `Longnamewithoutspaces${Date.now().toString(36)}xxxxxxxxxxxxx`.slice(0, 40) };
    await signup(a.context, pa);
    await signup(b.context, pb);
    const problems = watchConsole(a.page);
    const gid = await createGroupApi(a.context.request, `Layout ${locale} ${Date.now().toString(36)}`);
    await createGroupApi(a.context.request, `Second ${Date.now().toString(36)}`); // สองกลุ่ม → ตัวเลือกกลุ่มมีให้ดู
    await joinViaApiCode(a.context.request, gid, b.context.request);

    const today = todayBkk();
    const m5 = nextMonthWithWeeks(addMonths(monthOf(today), 1), 5);
    const m6 = nextMonthWithWeeks(addMonths(monthOf(today), 1), 6);
    const m4 = nextMonthWithWeeks(addMonths(monthOf(today), 1), 4);
    expect([weeksInMonthGrid(m4), weeksInMonthGrid(m5), weeksInMonthGrid(m6)]).toEqual([4, 5, 6]);
    const last6 = addDays(gridStart(m6), 6 * 7 - 1); // ช่องสุดท้ายของตาราง 6 สัปดาห์ (นอกเดือน)
    // ข้อมูล: A และ B ติดวันเดียวกัน + ช่องนอกเดือน + ข้ามเดือน
    for (const [req, day] of [[a, `${m5}-10`], [b, `${m5}-10`], [a, last6], [b, last6], [a, `${m4}-28`]] as const) {
      await createBusyApi(req.context.request, { kind: 'all_day', startDate: day, endDate: day, title: 'e2e' });
    }
    await createBusyApi(a.context.request, { kind: 'timed', startDate: `${m5}-10`, startTime: '22:00', endDate: `${m5}-11`, endTime: '06:00', title: 'night' });

    /** ภาพหน้าจอเต็มหน้าแพง (DPR 3) — ถ่ายเฉพาะมุมมองหลัก ที่เหลือวัดเลย์เอาต์อย่างเดียว */
    const check = async (label: string, shot = false) => {
      if (shot) return checkLayout(a.page, testInfo, label, locale, theme);
      await expect(a.page.locator('html')).toHaveAttribute('data-theme', theme);
      const l = await measureLayout(a.page);
      expect(l.targetCount, `${label}: มีปุ่ม/ลิงก์ให้วัด`).toBeGreaterThan(0);
      expect([l.scrollWidth <= l.clientWidth, l.bodyScrollWidth <= l.clientWidth], `${label}: ไม่มี horizontal scroll`).toEqual([true, true]);
      expect(l.smallTargets, `${label}: a/button/input ทุกตัว ≥ 44×44 px`).toEqual([]);
    };
    const monthCase = async (ym: string, weeks: 4 | 5 | 6, shot = false) => {
      await openCalendar(a.page, { gid, view: 'month', date: `${ym}-15` });
      await expect(monthGrid(a.page)).toHaveAttribute('data-weeks', String(weeks));
      await expect(monthGrid(a.page).locator('[data-testid^="cal-cell-"]')).toHaveCount(weeks * 7);
      const heads = monthGrid(a.page).getByRole('columnheader');
      await expect(heads.first()).toContainText(msg(locale, 'calendar.dowLong.mon'));
      await expect(heads.last()).toContainText(msg(locale, 'calendar.dowLong.sun'));
      await check(`month-${weeks}wk`, shot);
    };

    await monthCase(m5, 5);
    await expect(cell(a.page, `${m5}-10`)).toHaveAttribute('data-count', '2');
    await expect(cell(a.page, `${m5}-10`).locator('.member-dot')).toHaveCount(2);
    await monthCase(m6, 6, true);
    await expect(cell(a.page, last6)).toHaveAttribute('data-count', '2'); // ช่องนอกเดือนมีจุดสีเต็ม (X25)
    await expect(cell(a.page, last6)).toHaveClass(/is-outside/);
    await monthCase(m4, 4);

    await openCalendar(a.page, { gid, view: 'day', date: `${m5}-10` });
    await expect(a.page.getByTestId('cal-day-panel')).toHaveAttribute('data-date', `${m5}-10`);
    await expect(a.page.getByTestId('cal-item')).toHaveCount(3); // A ทั้งวัน + A ข้ามเที่ยงคืน + B ทั้งวัน
    await check('day', true);

    await openCalendar(a.page, { view: 'mine' });
    await expect(a.page.getByTestId('busy-mine-list')).toBeVisible();
    await check('mine');

    // ฟอร์ม: ช่วงเวลา (มีสรุปข้ามเที่ยงคืน) และตัวเลือกวัน (หลายวัน) เปิดอยู่
    await openCalendar(a.page, { gid, view: 'day', date: `${m5}-10` });
    await addButton(a.page).click();
    const sheet = a.page.getByRole('dialog');
    await sheet.getByTestId('busy-type-timed').click();
    await sheet.getByTestId('busy-start-time').selectOption('22:00');
    await sheet.getByTestId('busy-end-time').selectOption('06:00');
    await expect(sheet.getByTestId('busy-summary')).toContainText(msg(locale, 'busy.form.overnight'));
    await check('form-timed', true);
    await sheet.getByTestId('busy-type-multi').click();
    await expect(sheet.getByTestId('busy-picker')).toBeVisible();
    await check('form-multi-picker');
    await a.page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    await openCalendar(a.page, { gid, view: 'month', date: `${m5}-15` });
    await a.page.getByTestId('cal-group-switch').click();
    await expect(a.page.getByTestId('cal-group-list')).toBeVisible();
    await check('group-switch');

    expect(problems).toEqual([]);
  });
}
