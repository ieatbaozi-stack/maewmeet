// R6E — E1/E2 popup ยืนยัน "ไป" · E3 มุมมองวัน 375 ชื่อนัดยาว · E4 ปุ่ม RSVP 3 ปุ่มบรรทัดเดียว
//   R6E-1  ชนเกินเพดาน 5 รายการ → ข้อความต่อท้ายไม่มีตัวเลข (th/en)
//   R6E-2  ชนเฉพาะ busy ที่ลงเอง → ปุ่ม "ไปนัดนี้"/"Go anyway" · ชนนัด → "ไปทั้งสองนัด"/"Going to both"
//   R6E-3  มุมมองวัน: "นัด: <ชื่อ>" ชื่อยาวไม่มีช่องว่าง ไอคอนติดข้อความ เต็มความกว้าง ไม่ล้น (checkLayout + ภาพ)
//   R6E-4  RSVP 3 ปุ่มบรรทัดเดียว ≥ 44px · หน้านัด + หน้าหลัก · 375/390/768 × th/en × สว่าง/มืด
import type { Page } from '@playwright/test';
import { expect, test } from './support/auth';
import { createBusyApi } from './support/busy';
import { openCalendar } from './support/calendar-ui';
import { watchConsole } from './support/fixtures';
import { checkLayout, go, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';
import { createApptApi, daysAhead, isHydration, makeScene, rsvpApi, type Member } from './support/appt';

const slot = (d: string, s: string, e: string) => ({ startDate: d, startTime: s, endDate: d, endTime: e });
const COMBOS: { locale: Locale; theme: Theme }[] = [
  { locale: 'th', theme: 'light' },
  { locale: 'en', theme: 'dark' },
  { locale: 'en', theme: 'light' },
  { locale: 'th', theme: 'dark' },
];
const LONG_TITLE = `LongTitle${'x'.repeat(61)}`; // 70 ตัว ไม่เว้นวรรค
const dialog = (p: Page) => p.getByRole('dialog');

/** ปุ่ม RSVP ทุกปุ่มใน group: ข้อความ 1 บรรทัด · ไม่ถูกตัด · สูง ≥ 44 · ตัวอักษร ≥ 14 */
async function expectRsvpOneLine(p: Page, groupTestId: string, label: string): Promise<void> {
  const rows = await p.getByTestId(groupTestId).locator('button').evaluateAll((btns) =>
    btns.map((b) => {
      const span = b.querySelector('span:not(.spinner)') as HTMLElement;
      const cs = getComputedStyle(span);
      const lh = parseFloat(cs.lineHeight);
      const r = b.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(b).paddingLeft);
      return { text: span.textContent, h: span.getBoundingClientRect().height, lh, fs: parseFloat(cs.fontSize), btnH: r.height, clipped: b.scrollWidth > b.clientWidth + 1, ws: getComputedStyle(b).whiteSpace, pad };
    }),
  );
  expect(rows).toHaveLength(3);
  for (const r of rows) {
    expect(r.h, `${label}: "${r.text}" บรรทัดเดียว (สูง ${r.h} / line ${r.lh})`).toBeLessThanOrEqual(r.lh + 1);
    expect(r.clipped, `${label}: "${r.text}" ไม่ถูกตัด`).toBe(false);
    expect(r.btnH, `${label}: ปุ่ม "${r.text}" สูง ≥ 44`).toBeGreaterThanOrEqual(44);
    expect(r.fs, `${label}: ตัวอักษร ≥ 14`).toBeGreaterThanOrEqual(14);
    expect(r.pad, `${label}: padding แนวนอน ≤ 8`).toBeLessThanOrEqual(8);
    expect(r.ws).toBe('nowrap');
  }
}

for (const { locale, theme } of COMBOS) {
  test(`R6E-1..4 ${locale}/${theme}: popup เกิน 4 รายการ · ปุ่มตามชนิดที่ชน · วัน 375 ชื่อยาว · RSVP บรรทัดเดียว`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale, theme, labels: ['Ann', 'Ben'] });
    const [A, B] = scene.members as [Member, Member];
    const g = scene.gid;
    const D = daysAhead(9);
    const E = daysAhead(11);
    const F = daysAhead(13);
    const problems = [A, B].map((m) => watchConsole(m.page));
    const a = A.page;
    const check = (p: Page, label: string) => checkLayout(p, testInfo, label, locale, theme);

    // ───────── R6E-2: ชนเฉพาะ busy ที่ลงเอง → ปุ่มคำใหม่ ─────────
    const pBusy = await createApptApi(B.context.request, g, { title: 'R6E นัดชน busy', ...slot(D, '18:00', '20:00') });
    await createBusyApi(A.context.request, { kind: 'timed', startDate: D, startTime: '19:00', endDate: D, endTime: '21:00', title: 'ประชุม' });
    await go(a, `/appointments/${pBusy}`);
    await a.getByTestId('appt-rsvp-going').click();
    await expect(a.getByTestId('rsvp-conflicts').locator('li')).toHaveCount(1);
    await expect(a.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.conflictConfirmBusy'));
    await a.keyboard.press('Escape');
    await expect(dialog(a)).toHaveCount(0);

    // ───────── R6E-2: ชนนัด (มี busy ร่วม) → "ไปทั้งสองนัด" ─────────
    const pOther = await createApptApi(B.context.request, g, { title: 'R6E นัดแรก', ...slot(D, '19:30', '20:30') });
    await rsvpApi(A.context.request, pOther, 'going');
    await go(a, `/appointments/${pBusy}`);
    await a.getByTestId('appt-rsvp-going').click();
    await expect(a.getByTestId('rsvp-conflicts').locator('li')).toHaveCount(2);
    await expect(a.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.conflictConfirm'));
    await a.keyboard.press('Escape');
    await expect(dialog(a)).toHaveCount(0);

    // ───────── R6E-1: ชนเกิน 4 รายการ → ข้อความต่อท้ายไม่มีตัวเลข ─────────
    const pMany = await createApptApi(B.context.request, g, { title: 'R6E นัดชนเยอะ', ...slot(E, '10:00', '22:00') });
    for (let i = 0; i < 6; i++) {
      await createBusyApi(A.context.request, { kind: 'timed', startDate: E, startTime: `${11 + i}:00`, endDate: E, endTime: `${11 + i}:30`, title: `ลงไว้ ${i}` });
    }
    await go(a, `/appointments/${pMany}`);
    await a.getByTestId('appt-rsvp-going').click();
    await expect(a.getByTestId('rsvp-conflicts').locator('li')).toHaveCount(5);
    const more = a.locator('.rsvp-conflicts-more');
    await expect(more).toHaveText(T('appointments.goingConfirm.conflictMore'));
    expect(await more.innerText(), 'ไม่มีตัวเลข/เครื่องหมาย +').not.toMatch(/[0-9๐-๙+]/);
    await check(a, 'r6e-popup-many');
    await a.keyboard.press('Escape');
    await expect(dialog(a)).toHaveCount(0);

    // ───────── R6E-4: RSVP บรรทัดเดียว (หน้านัด + หน้าหลัก) ─────────
    await go(a, `/appointments/${pBusy}`);
    await expectRsvpOneLine(a, 'appt-rsvp-block', 'หน้านัด');
    await check(a, 'r6e-rsvp-detail');
    await go(a, '/');
    await expect(a.getByTestId('home-rsvp')).toBeVisible();
    await expectRsvpOneLine(a, 'home-rsvp', 'หน้าหลัก');
    await check(a, 'r6e-rsvp-home');

    // ───────── R6E-3: มุมมองวัน (ของ B) — ชื่อนัดยาวไม่มีช่องว่าง ─────────
    const pLong = await createApptApi(B.context.request, g, { title: LONG_TITLE, ...slot(F, '18:00', '20:00') });
    await rsvpApi(A.context.request, pLong, 'going');
    await rsvpApi(B.context.request, pLong, 'going');
    await openCalendar(B.page, { gid: g, view: 'day', date: F });
    await expect(B.page.getByTestId('cal-day-panel')).toHaveAttribute('data-date', F);
    const item = B.page.getByTestId('cal-item-appointment').first();
    await expect(item).toBeVisible();
    const m = await item.evaluate((el) => {
      const li = el.closest('li') as HTMLElement;
      const what = el.querySelector('.what') as HTMLElement;
      const icon = what.querySelector('.icon') as SVGElement;
      const text = what.querySelector('span') as HTMLElement;
      const vw = document.documentElement.clientWidth;
      const l = li.getBoundingClientRect();
      const i = icon.getBoundingClientRect();
      const t = text.getBoundingClientRect();
      const w = el.getBoundingClientRect();
      return { liW: l.width, itemW: w.width, itemRight: w.right, vw, iconRight: i.right, textLeft: t.left, textW: t.width, over: text.scrollWidth > text.clientWidth + 1 };
    });
    expect(m.itemRight, 'รายการไม่ล้นขวา').toBeLessThanOrEqual(m.vw);
    expect(m.itemW, 'รายการเต็มความกว้างแถว (ไม่ใช่คอลัมน์แคบ)').toBeGreaterThanOrEqual(m.liW * 0.85);
    expect(m.textLeft - m.iconRight, 'ไอคอนติดข้อความ').toBeLessThanOrEqual(12);
    expect(m.textW, 'ข้อความกว้างเกินครึ่งจอ').toBeGreaterThan(m.vw * 0.5);
    expect(m.over, 'ข้อความไม่ล้นกล่อง').toBe(false);
    await check(B.page, 'r6e-day-long-appt');
    await openCalendar(a, { gid: g, view: 'day', date: F });
    await check(a, 'r6e-day-long-appt-viewer');

    for (const [i, pr] of problems.entries()) {
      for (const x of pr.filter(isHydration)) testInfo.annotations.push({ type: 'hydration', description: `${i}: ${x.text.slice(0, 80)}` });
      expect(pr.filter((x) => !isHydration(x)), `console ของเครื่อง ${i}`).toEqual([]);
    }
  });
}
