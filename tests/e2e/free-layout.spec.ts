// R4A-7 / R4A-8 (a11y) — เลย์เอาต์ "ว่างตรงกัน" ที่ 375/390/768 · ไทย+สว่าง และ อังกฤษ+มืด
//  เดือน 4/5/6 สัปดาห์ · รายละเอียดวัน (sheet มือถือ / แผงขวา iPad) · ว่าง (กลุ่มคนเดียว) · แถบ "ไม่มีใครลง" · ชื่อยาว
//  ทุกมุมมอง: ไม่มี horizontal scroll · a/button/input ที่เห็น ≥ 44×44 · หัวตารางเริ่มจันทร์ · พ.ศ. (ไทย) · ข้อความมาจาก messages
//  a11y smoke: ช่อง "ว่างร่วม" มี aria-label ที่สื่อด้วยข้อความ (ไม่พึ่งสี) · roving tabindex = Tab หยุดช่องเดียว
import { expect, test } from './support/auth';
import { addDays, addMonths, buddhistYear, createBusyApi, isoWeekday, monthOf, nextMonthWithWeeks, todayBkk, weeksInMonthGrid } from './support/busy';
import { measureLayout, setPrefs, watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, joinViaApiCode, person, signup, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';
import { freeCell, freeDay, freeMonth, freeNobody, freeSolo, openFree } from './support/free-ui';

const COMBOS: readonly (readonly [Locale, Theme])[] = [
  ['th', 'light'],
  ['en', 'dark'],
];
const gridStart = (ym: string): string => addDays(`${ym}-01`, -isoWeekday(`${ym}-01`));

for (const [locale, theme] of COMBOS) {
  test(`${locale}/${theme}: ว่างตรงกัน เดือน 4/5/6 · วัน · solo · nobody — ไม่ล้นจอ ปุ่ม ≥ 44px หัวเริ่มจันทร์ · a11y`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const a = await newDevice();
    const b = await newDevice();
    await setPrefs(a.context, baseURL!, { locale, theme });
    const pa = person('Ann');
    const pb = { ...person('B'), displayName: `Longnamewithoutspaces${Date.now().toString(36)}xxxxxxxxxxxxx`.slice(0, 40) };
    await signup(a.context, pa);
    await signup(b.context, pb);
    const problems = watchConsole(a.page);
    const gid = await createGroupApi(a.context.request, `Free ${locale} ${Date.now().toString(36)}`);
    await joinViaApiCode(a.context.request, gid, b.context.request);
    const emptyGid = await createGroupApi(a.context.request, `Empty ${Date.now().toString(36)}`); // สมาชิก 2 คน (busy ผูกกับผู้ใช้ — ดูเดือนที่ไม่มี busy)
    await joinViaApiCode(a.context.request, emptyGid, b.context.request);
    const soloGid = await createGroupApi(b.context.request, `Solo ${Date.now().toString(36)}`);

    const today = todayBkk();
    const m5 = nextMonthWithWeeks(addMonths(monthOf(today), 1), 5);
    const m6 = nextMonthWithWeeks(addMonths(monthOf(today), 1), 6);
    const m4 = nextMonthWithWeeks(addMonths(monthOf(today), 1), 4);
    expect([weeksInMonthGrid(m4), weeksInMonthGrid(m5), weeksInMonthGrid(m6)]).toEqual([4, 5, 6]);
    const last6 = addDays(gridStart(m6), 6 * 7 - 1);
    // ข้อมูลให้เห็นครบสถานะ: 10 = ติดทั้งคู่ทั้งวัน (0/2) · 11 = B ติดทั้งวัน (1/2) · 12 = ว่างร่วม · ช่องนอกเดือนท้ายตาราง 6 สัปดาห์ = 1/2
    for (const [req, d] of [[a, `${m5}-10`], [b, `${m5}-10`], [b, `${m5}-11`], [b, last6], [a, `${m4}-28`]] as const) {
      await createBusyApi(req.context.request, { kind: 'all_day', startDate: d, endDate: d });
    }

    const check = async (label: string, shot = false) => {
      if (shot) return checkLayout(a.page, testInfo, `free-${label}`, locale, theme);
      await expect(a.page.locator('html')).toHaveAttribute('data-theme', theme);
      const l = await measureLayout(a.page);
      expect(l.targetCount, `${label}: มีปุ่ม/ลิงก์ให้วัด`).toBeGreaterThan(0);
      expect([l.scrollWidth <= l.clientWidth, l.bodyScrollWidth <= l.clientWidth], `${label}: ไม่มี horizontal scroll`).toEqual([true, true]);
      expect(l.smallTargets, `${label}: a/button/input ทุกตัว ≥ 44×44 px`).toEqual([]);
    };
    const monthCase = async (ym: string, weeks: 4 | 5 | 6, shot = false) => {
      await openFree(a.page, { gid, date: `${ym}-15` });
      await expect(freeMonth(a.page)).toHaveAttribute('data-weeks', String(weeks));
      await expect(freeMonth(a.page).locator('[data-testid^="free-cell-"]')).toHaveCount(weeks * 7);
      const heads = freeMonth(a.page).getByRole('columnheader');
      await expect(heads.first()).toContainText(msg(locale, 'calendar.dowLong.mon'));
      await expect(heads.last()).toContainText(msg(locale, 'calendar.dowLong.sun'));
      await check(`month-${weeks}wk`, shot);
    };

    await monthCase(m5, 5);
    if (locale === 'th') {
      await expect(a.page.getByTestId('cal-month-title')).toContainText(String(buddhistYear(m5)));
      await expect(a.page.getByTestId('cal-month-title')).not.toContainText(m5.slice(0, 4));
    }
    // aria-label สื่อสถานะด้วยข้อความ ไม่พึ่งสี
    const ariaOf = (date: string) => freeCell(a.page, date).getAttribute('aria-label');
    expect(await ariaOf(`${m5}-12`)).toContain(msg(locale, 'availability.cell.aria', { date: '', today: 'no', outside: 'no', state: 'all', free: 2, total: 2 }).replace(/^,\s*/, ''));
    expect(await ariaOf(`${m5}-10`)).toContain(msg(locale, 'availability.cell.aria', { date: '', today: 'no', outside: 'no', state: 'none', free: 0, total: 2 }).replace(/^,\s*/, ''));
    expect(await ariaOf(`${m5}-11`)).toContain(msg(locale, 'availability.cell.aria', { date: '', today: 'no', outside: 'no', state: 'partial', free: 1, total: 2 }).replace(/^,\s*/, ''));

    // roving tabindex: ช่องวันทั้งตารางมี tabindex=0 ช่องเดียว
    const cells = freeMonth(a.page).locator('[data-testid^="free-cell-"]');
    const tabbable = await cells.evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length);
    expect(tabbable, 'roving tabindex: Tab หยุดช่องเดียว').toBe(1);
    // ลูกศรขวาย้ายโฟกัสไปวันถัดไป และ Tab stop ยังมีช่องเดียว (ตามโฟกัส)
    const stop = cells.and(a.page.locator('[tabindex="0"]'));
    const stopDate = await stop.getAttribute('data-date');
    await stop.focus();
    await a.page.keyboard.press('ArrowRight');
    const moved = await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.date ?? null);
    expect(moved, 'ลูกศรขวาย้ายโฟกัสไปวันอื่น').not.toBe(stopDate);
    expect(await cells.evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length), 'ยังมี Tab stop ช่องเดียว').toBe(1);

    await monthCase(m6, 6, true);
    await expect(freeCell(a.page, last6)).toHaveAttribute('aria-label', /.+/); // ช่องนอกเดือนท้ายตารางยังมีสถานะ
    await monthCase(m4, 4);

    // รายละเอียดวัน: แตะวัน → sheet (มือถือ) หรือแผงขวา (768) — ชื่อยาวของ B ต้องไม่ดันจอ
    await openFree(a.page, { gid, date: `${m5}-11` });
    await freeCell(a.page, `${m5}-11`).click();
    await expect(freeDay(a.page)).toBeVisible();
    await expect(freeDay(a.page)).toContainText(pb.displayName);
    await check('day', true);

    // ไม่มีใครลง → แถบเตือน + ทุกวันว่างร่วม (busy เป็นของผู้ใช้ ไม่ใช่ของกลุ่ม → เลือกเดือนที่ห่างจากทุกเดือนที่ลงไว้)
    const quiet = addMonths([m4, m5, m6].sort().at(-1)!, 2);
    await openFree(a.page, { gid: emptyGid, date: `${quiet}-15` });
    await expect(freeNobody(a.page)).toBeVisible();
    await expect(freeNobody(a.page)).toContainText(msg(locale, 'availability.nobody.title'));
    await check('nobody', true);

    // กลุ่มคนเดียว (a ไม่ใช่สมาชิก → ใช้ b) — ซ่อนตาราง
    const bp = b.page;
    await setPrefs(b.context, baseURL!, { locale, theme });
    await openFree(bp, { gid: soloGid, date: `${m5}-15` });
    await expect(freeSolo(bp)).toBeVisible();
    await expect(freeMonth(bp)).toHaveCount(0);
    const l = await measureLayout(bp);
    expect([l.scrollWidth <= l.clientWidth, l.smallTargets], 'solo: ไม่ล้น/ปุ่ม ≥ 44').toEqual([true, []]);

    expect(problems).toEqual([]);
  });
}
