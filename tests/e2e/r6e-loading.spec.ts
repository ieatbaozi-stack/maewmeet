// R6E-10 — สัญญาณโหลด (E12)
//   นำทางช้า (หน่วง route) → แถบ progress ขึ้นภายใน ~150 ms + role=status ข้อความ sr-only · นำทางเร็ว → ไม่กระพริบ (ไม่เคยเป็น active)
//   ปุ่มที่กำลังส่ง: วงหมุน + aria-busy + disabled + ความกว้างคงที่ + กดซ้ำไม่ส่งซ้ำ
//   reduced-motion: วงหมุน/แถบ progress ไม่มี animation (แต่ยังเห็น) · transition ของ sheet ≤ 200 ms เฉพาะ transform/opacity
import type { Page } from '@playwright/test';
import { expect, test } from './support/auth';
import { addButton, openCalendar } from './support/calendar-ui';
import { watchConsole } from './support/fixtures';
import { go } from './support/groups';
import { msg, type Locale } from './support/messages';
import { daysAhead, isHydration, makeScene } from './support/appt';

const locale: Locale = 'th';
const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** เก็บลำดับค่า data-phase ของแถบนำทางไว้ใน window.__phases */
async function recordPhases(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __phases: string[] };
    w.__phases = [];
    const el = document.querySelector('[data-testid="nav-progress"]') as HTMLElement;
    w.__phases.push(el.dataset.phase ?? '');
    new MutationObserver(() => w.__phases.push(el.dataset.phase ?? '')).observe(el, { attributes: true, attributeFilter: ['data-phase'] });
  });
}
const phases = (page: Page) => page.evaluate(() => (window as unknown as { __phases: string[] }).__phases);

test.describe('R6E-10 โหลดลื่น', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'รันที่ mobile-390 ตัวเดียว');
  });

  test('R6E-10: นำทางช้า = เห็น progress · นำทางเร็ว = ไม่กระพริบ', async ({ newDevice, baseURL }) => {
    test.setTimeout(120_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann'] });
    const a = scene.members[0]!.page;
    const problems = watchConsole(a);
    await go(a, '/');
    await expect(a.getByTestId('nav-progress')).toHaveAttribute('data-phase', 'idle');
    await expect(a.getByTestId('nav-progress')).toHaveAttribute('role', 'status');
    const nav = a.getByRole('navigation', { name: T('nav.label') });

    // เร็ว: เซิร์ฟเวอร์จริงอาจใช้เกิน 150 ms จึงยกค่าหน่วง (--loading-delay) เป็น 5 วินาทีชั่วคราว — นำทางที่จบก่อนถึงเวลาหน่วงต้องไม่แสดงแถบเลย
    await a.addStyleTag({ content: ':root { --loading-delay: 5000ms; }' });
    await a.route((u) => u.pathname === '/groups', async (route) => {
      await sleep(40);
      await route.continue();
    });
    await recordPhases(a);
    await nav.getByRole('link', { name: T('nav.groups'), exact: true }).click();
    await expect(a).toHaveURL(/\/groups$/);
    await a.waitForTimeout(500);
    expect(await phases(a), 'นำทางเร็วไม่แสดงแถบ').not.toContain('active');
    await a.unroute((u) => u.pathname === '/groups');
    await a.evaluate(() => {
      for (const el of document.querySelectorAll('style')) if (el.textContent?.includes('--loading-delay: 5000ms')) el.remove();
    });

    // ช้า (หน่วง 1500 ms) → active ภายใน ~150 ms (+เผื่อ) แล้วจบเป็น idle
    await a.route((u) => u.pathname === '/calendar', async (route) => {
      await sleep(1500);
      await route.continue();
    });
    await recordPhases(a);
    const t0 = Date.now();
    await nav.getByRole('link', { name: T('nav.calendar'), exact: true }).click();
    await expect(a.getByTestId('nav-progress')).toHaveAttribute('data-phase', 'active', { timeout: 900 });
    expect(Date.now() - t0, 'แถบขึ้นเร็วพอ (ไม่ช้าเกิน ~0.9 วินาที)').toBeLessThan(900);
    await expect(a.getByTestId('nav-progress')).toContainText(T('common.navLoading'));
    const during = await a.getByTestId('nav-progress').locator('.nav-progress-bar').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { h: r.height, top: r.top, animation: cs.animationName, vw: document.documentElement.clientWidth, w: r.width };
    });
    expect(during.top).toBe(0);
    expect(during.h).toBeGreaterThan(0);
    expect(during.animation).not.toBe('none');
    await expect(a).toHaveURL(/\/calendar/, { timeout: 8000 });
    await expect(a.getByTestId('nav-progress')).toHaveAttribute('data-phase', 'idle', { timeout: 4000 });
    expect(await phases(a)).toEqual(expect.arrayContaining(['active', 'done', 'idle']));
    await expect(a.getByTestId('nav-progress')).not.toContainText(T('common.navLoading'));
    await a.unroute((u) => u.pathname === '/calendar');

    expect(problems.filter((x) => !isHydration(x)), 'console').toEqual([]);
  });

  test('R6E-10: ปุ่มส่งมีวงหมุน + aria-busy · กดซ้ำไม่ส่งซ้ำ · ความกว้างคงที่', async ({ newDevice, baseURL }) => {
    test.setTimeout(120_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann'] });
    const a = scene.members[0]!.page;
    const D = daysAhead(14);
    await openCalendar(a, { gid: scene.gid, view: 'day', date: D });
    await addButton(a).click();
    const sheet = a.getByRole('dialog');
    const ok = sheet.getByTestId('busy-notice-ok');
    if (await ok.isVisible()) await ok.click();
    const btn = sheet.getByTestId('busy-submit');
    const before = (await btn.boundingBox())!;
    let posts = 0;
    await a.route((u) => u.pathname === '/api/me/busy', async (route) => {
      if (route.request().method() === 'POST') {
        posts++;
        await sleep(1500);
      }
      await route.continue();
    });
    await btn.click();
    await expect(btn).toHaveAttribute('aria-busy', 'true');
    await expect(btn).toBeDisabled();
    await expect(btn.locator('.spinner')).toHaveCount(1);
    await expect(btn).toContainText(T('busy.form.saving'));
    const during = (await btn.boundingBox())!;
    expect(Math.abs(during.width - before.width), 'ความกว้างปุ่มคงที่').toBeLessThanOrEqual(1);
    expect(Math.abs(during.height - before.height), 'ความสูงปุ่มคงที่').toBeLessThanOrEqual(1);
    const anim = await btn.locator('.spinner').evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).not.toBe('none');
    await btn.click({ force: true, trial: false }).catch(() => undefined);
    await expect(sheet).toHaveCount(0, { timeout: 8000 });
    expect(posts, 'ส่งครั้งเดียว').toBe(1);
  });

  test('R6E-10: reduced-motion — ไม่มี animation แต่ยังเห็นสัญญาณ', async ({ newDevice, baseURL }) => {
    test.setTimeout(120_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann'] });
    const a = scene.members[0]!.page;
    await a.emulateMedia({ reducedMotion: 'reduce' });
    await go(a, '/');
    const nav = a.getByRole('navigation', { name: T('nav.label') });
    await a.route((u) => u.pathname === '/calendar', async (route) => {
      await sleep(1500);
      await route.continue();
    });
    await nav.getByRole('link', { name: T('nav.calendar'), exact: true }).click();
    await expect(a.getByTestId('nav-progress')).toHaveAttribute('data-phase', 'active', { timeout: 900 });
    const bar = await a.getByTestId('nav-progress').locator('.nav-progress-bar').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { animation: cs.animationName, opacity: cs.opacity, w: el.getBoundingClientRect().width, vw: document.documentElement.clientWidth };
    });
    expect(bar.animation, 'แถบไม่เคลื่อนไหว').toBe('none');
    expect(Number(bar.opacity), 'ยังเห็น (opacity 0.6)').toBeGreaterThan(0.5);
    expect(bar.w, 'เต็มความกว้างนิ่ง').toBeGreaterThanOrEqual(bar.vw - 1);
    await expect(a).toHaveURL(/\/calendar/, { timeout: 8000 });
    await a.unroute((u) => u.pathname === '/calendar');

    // วงหมุนในปุ่ม: ไม่หมุน (ครึ่งวงนิ่ง)
    await a.route((u) => u.pathname === '/api/me/busy', async (route) => {
      if (route.request().method() === 'POST') await sleep(1500);
      await route.continue();
    });
    await openCalendar(a, { gid: scene.gid, view: 'day', date: daysAhead(14) });
    await addButton(a).click();
    const sheet = a.getByRole('dialog');
    const ok = sheet.getByTestId('busy-notice-ok');
    if (await ok.isVisible()) await ok.click();
    const btn = sheet.getByTestId('busy-submit');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-busy', 'true');
    const sp = await btn.locator('.spinner').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { animation: cs.animationName, w: el.getBoundingClientRect().width };
    });
    expect(sp.animation, 'วงหมุนไม่หมุน').toBe('none');
    expect(sp.w).toBeGreaterThan(0);
    await expect(btn).toContainText(T('busy.form.saving'));

    // transition ปิดเป็น 0 (token --dur* = 0)
    await expect(sheet).toHaveCount(0, { timeout: 8000 });
    const dur = await a.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dur-fast').trim());
    expect(dur).toMatch(/^0(ms|s)$/);
  });

  test('R6E-10: sheet เปิด/ปิดใช้ transform/opacity ≤ 200 ms', async ({ newDevice, baseURL }) => {
    test.setTimeout(120_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann'] });
    const a = scene.members[0]!.page;
    await openCalendar(a, { gid: scene.gid, view: 'day', date: daysAhead(14) });
    await addButton(a).click();
    const sheet = a.getByRole('dialog');
    await expect(sheet).toBeVisible();
    const css = await sheet.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, dur: cs.animationDuration };
    });
    expect(css.name).toMatch(/sheet-in/);
    expect(parseFloat(css.dur) * (css.dur.endsWith('ms') ? 1 : 1000)).toBeLessThanOrEqual(200);
    await a.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });
});
