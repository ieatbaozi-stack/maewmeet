// R8 — onboarding (R8_CONTRACT §2, เกณฑ์ R8-2 / R8-5 / R8-6): 375/390/768 (= project) × th/en × light/dark
//   1) การ์ดแนะนำหน้าหลัก: ผู้ใช้ใหม่เห็น → "เข้าใจแล้ว" → โหลดซ้ำไม่เห็น → /me "วิธีใช้งาน" ล้างธงแล้วการ์ดกลับมา
//   2) localStorage ใช้ไม่ได้ (getter โยน error) → การ์ดยังแสดง กดปิดได้ ไม่มี pageerror
//   3) แถบขั้นตอนหน้ากลุ่ม + ป้าย "ยังไม่ได้ลงวันไม่ว่าง" ตามข้อมูลจริง: solo → เพื่อนเข้า → ลง busy → สร้างนัด → ยุบ/ขยาย
// สเปกนี้ปิดการตั้งธง `mm_intro_seen` อัตโนมัติ (introSeen=false) — สเปกเก่าได้ธงนี้เป็นดีฟอลต์จาก support/auth.ts
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test as authTest } from './support/auth';
import { createApptApi, daysAhead } from './support/appt';
import { createBusyApi } from './support/busy';
import { setPrefs, watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, go, joinViaApiCode, person, signup, type Person, type Theme } from './support/groups';
import { LOCALES, msg } from './support/messages';

const THEMES: readonly Theme[] = ['light', 'dark'];
const test = authTest;
test.use({ introSeen: false });

const slot = (d: string) => ({ startDate: d, startTime: '10:00', endDate: d, endTime: '11:00' });
const stepState = (page: Page, id: string): Locator => page.locator(`[data-step="${id}"]`);
const memberRowOf = (page: Page, p: Person): Locator => page.locator('[role="group"]').filter({ hasText: p.displayName });
const noOverflow = async (page: Page, label: string) => {
  const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth, b: document.body.scrollWidth }));
  expect(w.s, `${label}: documentElement ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
  expect(w.b, `${label}: body ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
};

async function expectStates(page: Page, want: Record<'invite' | 'busy' | 'free' | 'plan', 'done' | 'next' | 'todo'>) {
  for (const [id, s] of Object.entries(want)) await expect(stepState(page, id), `ขั้น ${id}`).toHaveAttribute('data-state', s);
  // มี "ขั้นถัดไป" ได้ขั้นเดียว และเป็น aria-current="step"
  const nexts = Object.values(want).filter((s) => s === 'next').length;
  await expect(page.locator('[data-testid="group-steps"] [aria-current="step"]')).toHaveCount(nexts);
}

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test.describe(`${locale} · ${theme}`, () => {
      test('การ์ดแนะนำ: เห็น → เข้าใจแล้ว → โหลดซ้ำไม่เห็น → /me วิธีใช้งาน → กลับมา', async ({ page, context, baseURL, user }, testInfo: TestInfo) => {
        void user; // fixture สมัคร + ล็อกอินให้แล้ว
        await setPrefs(context, baseURL!, { locale, theme });
        const problems = watchConsole(page);
        await go(page, '/');
        const card = page.getByTestId('home-intro');
        await expect(card).toBeVisible();
        await expect(card.getByRole('heading', { level: 2, name: msg(locale, 'onboarding.intro.title') })).toBeVisible();
        await expect(card.getByRole('list', { name: msg(locale, 'onboarding.intro.listAria') }).getByRole('listitem')).toHaveCount(4);
        for (const s of ['s1', 's2', 's3', 's4']) await expect(card.getByText(msg(locale, `onboarding.intro.${s}`), { exact: true })).toBeVisible();
        await checkLayout(page, testInfo, 'r8-home-intro', locale, theme);

        const dismiss = page.getByTestId('home-intro-dismiss');
        await expect(dismiss).toHaveText(msg(locale, 'onboarding.intro.dismiss'));
        await dismiss.click();
        await expect(card).toHaveCount(0);
        expect(await page.evaluate(() => window.localStorage.getItem('mm_intro_seen'))).toBe('1');

        // โหลดซ้ำ: รอให้หน้าพร้อม (h1 + networkidle) แล้วการ์ดต้องไม่ปรากฏ — ไม่ใช่แค่ "ยังไม่ hydrate"
        await go(page, '/');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByTestId('home-intro')).toHaveCount(0);

        // เปิดดูใหม่จาก /me
        await go(page, '/me');
        const howto = page.getByTestId('me-howto');
        await expect(howto).toContainText(msg(locale, 'me.howTo'));
        await expect(howto).toContainText(msg(locale, 'me.howToHint'));
        await howto.click();
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByTestId('home-intro')).toBeVisible();
        expect(await page.evaluate(() => window.localStorage.getItem('mm_intro_seen'))).toBeNull();
        await noOverflow(page, 'home หลังเปิดใหม่');
        expect(problems).toEqual([]);
      });

      test('แถบขั้นตอน + ป้ายสมาชิก: solo → เพื่อนเข้า → ลง busy → สร้างนัด → ยุบ/ขยาย → เพื่อนลง busy ป้ายหาย', async ({ newDevice, baseURL }, testInfo: TestInfo) => {
        test.setTimeout(180_000);
        const [a, b] = await Promise.all([newDevice(), newDevice()]);
        for (const x of [a, b]) await setPrefs(x.context, baseURL!, { locale, theme });
        const [pa, pb] = [person('Ann'), person('Ben')];
        await signup(a.context, pa);
        await signup(b.context, pb);
        const problems = [a, b].map((x) => watchConsole(x.page));
        const gid = await createGroupApi(a.context.request, `R8 ${locale} ${theme} ${Date.now().toString(36)}`);
        const steps = (p: Page) => p.getByTestId('group-steps');

        // ───── solo: ขั้น 1 เป็นขั้นถัดไป (soloBody) · ไม่มีป้ายสมาชิก · ไม่มีการ์ด solo เดิม ─────
        await go(a.page, `/groups/${gid}`);
        await expect(steps(a.page)).toBeVisible();
        await expect(steps(a.page)).toHaveAttribute('data-all-done', 'false');
        await expect(steps(a.page).getByRole('heading', { level: 2, name: msg(locale, 'group.steps.heading') })).toBeVisible();
        await expect(steps(a.page).getByText(msg(locale, 'group.steps.progress', { done: 0, total: 4 }))).toBeVisible();
        await expectStates(a.page, { invite: 'next', busy: 'todo', free: 'todo', plan: 'todo' });
        await expect(stepState(a.page, 'invite').getByText(msg(locale, 'group.steps.invite.soloBody'))).toBeVisible();
        await expect(a.page.getByRole('heading', { level: 2, name: msg(locale, 'group.solo.title') })).toHaveCount(0);
        await expect(a.page.getByTestId('group-step-cta-invite')).toHaveAttribute('href', `/groups/${gid}/settings#invite`);
        await expect(a.page.getByTestId('member-no-busy')).toHaveCount(0);
        await noOverflow(a.page, 'solo');
        await checkLayout(a.page, testInfo, 'r8-steps-solo', locale, theme);

        // ───── B เข้ากลุ่ม: ขั้น 1 เสร็จ → ขั้น 2 ถัดไป · A เห็นป้ายที่แถว B ไม่เห็นที่แถวตัวเอง ─────
        await joinViaApiCode(a.context.request, gid, b.context.request);
        await go(a.page, `/groups/${gid}`);
        await expectStates(a.page, { invite: 'done', busy: 'next', free: 'todo', plan: 'todo' });
        await expect(steps(a.page).getByText(msg(locale, 'group.steps.progress', { done: 1, total: 4 }))).toBeVisible();
        await expect(stepState(a.page, 'invite').getByText(msg(locale, 'group.steps.done'), { exact: true })).toBeVisible();
        await expect(a.page.getByTestId('group-step-cta-busy')).toBeVisible();
        const badge = (p: Page, who: Person) => memberRowOf(p, who).getByTestId('member-no-busy');
        await expect(memberRowOf(a.page, pb)).toBeVisible();
        await expect(badge(a.page, pb)).toHaveText(msg(locale, 'group.members.noBusyBadge'));
        await expect(memberRowOf(a.page, pb)).toHaveAttribute('aria-label', new RegExp(msg(locale, 'group.members.noBusyAria', { name: pb.displayName }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        await expect(badge(a.page, pa)).toHaveCount(0); // ไม่แสดงบนแถวตัวเอง
        await expect(a.page.getByTestId('member-no-busy')).toHaveCount(1);
        await noOverflow(a.page, 'สองคน');
        await checkLayout(a.page, testInfo, 'r8-steps-two', locale, theme);

        // B เห็นป้ายที่ A (A ยังไม่ลง) และไม่เห็นที่ตัวเอง
        await go(b.page, `/groups/${gid}`);
        await expect(badge(b.page, pa)).toBeVisible();
        await expect(badge(b.page, pb)).toHaveCount(0);

        // ───── A ลง busy: ขั้น 2 เสร็จ → ขั้น 3 ถัดไป · ป้ายของ B ยังอยู่ ─────
        await createBusyApi(a.context.request, { kind: 'all_day', startDate: daysAhead(2), endDate: daysAhead(2) });
        await go(a.page, `/groups/${gid}`);
        await expectStates(a.page, { invite: 'done', busy: 'done', free: 'next', plan: 'todo' });
        await expect(steps(a.page).getByText(msg(locale, 'group.steps.progress', { done: 2, total: 4 }))).toBeVisible();
        await expect(a.page.getByTestId('group-step-cta-free')).toHaveAttribute('href', `/calendar?g=${gid}&v=free`);
        await expect(badge(a.page, pb)).toBeVisible();
        await go(b.page, `/groups/${gid}`);
        await expect(memberRowOf(b.page, pa)).toBeVisible();
        await expect(badge(b.page, pa)).toHaveCount(0); // ตอนนี้ A ลงแล้ว

        // ───── สร้างนัด: ขั้น 4 เสร็จ → ครบ → ยุบเป็นแถบบาง ─────
        await createApptApi(a.context.request, gid, { title: `R8 นัด ${locale}`, ...slot(daysAhead(3)) });
        await go(a.page, `/groups/${gid}`);
        await expect(steps(a.page)).toHaveAttribute('data-all-done', 'true');
        await expect(steps(a.page).getByRole('heading', { level: 2, name: new RegExp(msg(locale, 'group.steps.allDone.title')) })).toBeVisible();
        await expect(steps(a.page).getByText(msg(locale, 'group.steps.allDone.body'))).toBeVisible();
        const toggle = a.page.getByTestId('group-steps-toggle');
        const list = a.page.getByTestId('group-steps-list');
        await expect(toggle).toHaveText(msg(locale, 'group.steps.allDone.show'));
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toHaveAttribute('aria-controls', (await list.getAttribute('id'))!);
        await expect(list).toBeHidden();
        await noOverflow(a.page, 'ครบ-ยุบ');
        await checkLayout(a.page, testInfo, 'r8-steps-alldone', locale, theme);

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(toggle).toHaveText(msg(locale, 'group.steps.allDone.hide'));
        await expect(list).toBeVisible();
        await expect(list.getByRole('listitem')).toHaveCount(4);
        await expectStates(a.page, { invite: 'done', busy: 'done', free: 'todo', plan: 'done' });
        await expect(a.page.locator('[data-testid="group-steps"] [aria-current="step"]')).toHaveCount(0);
        await noOverflow(a.page, 'ครบ-ขยาย');
        await checkLayout(a.page, testInfo, 'r8-steps-alldone-open', locale, theme);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(list).toBeHidden();

        // ───── B ลง busy: ป้ายที่แถว B หายไปจากมุมมอง A · ขั้น 2 ของ B เสร็จ ─────
        await createBusyApi(b.context.request, { kind: 'all_day', startDate: daysAhead(4), endDate: daysAhead(4) });
        await go(a.page, `/groups/${gid}`);
        await expect(memberRowOf(a.page, pb)).toBeVisible();
        await expect(a.page.getByTestId('member-no-busy')).toHaveCount(0);
        await go(b.page, `/groups/${gid}`);
        await expect(stepState(b.page, 'busy')).toHaveAttribute('data-state', 'done');

        for (const p of problems) expect(p).toEqual([]);
      });
    });
  }

  test(`${locale}: localStorage ใช้ไม่ได้ → การ์ดยังแสดง · กดปิดได้ · ไม่พัง`, async ({ page, context, baseURL, user }) => {
    void user;
    await setPrefs(context, baseURL!, { locale, theme: 'light' });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    const problems = watchConsole(page);
    await go(page, '/');
    const card = page.getByTestId('home-intro');
    await expect(card).toBeVisible();
    await page.getByTestId('home-intro-dismiss').click();
    await expect(card).toHaveCount(0);
    expect(problems).toEqual([]);
  });
}
