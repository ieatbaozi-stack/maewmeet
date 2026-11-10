// R12 — เพิ่มนัดลงปฏิทินในเครื่อง (R12_CONTRACT §4 §5 · R12-1 R12-11 R12-12 R12-13): 375/390/768 (= project) × th/en × light/dark
//   1) ปุ่มแสดงเฉพาะตอบ "ไป" (ผ่าน UI จริง) · ไม่แสดง อาจไป/ไม่ไป/ยังไม่ตอบ/ยกเลิก
//   2) sheet: oneTime เห็นก่อนกด · ทั้งสองตัวเลือก · ข้อความตรงของจริง · ไม่ล้นแนวนอน · ปุ่ม ≥ 44px
//   3) .ics ตอบ 200 text/calendar จาก session จริง (ทั้งผ่านลิงก์ใน sheet และดาวน์โหลดจริง) · ไม่ล็อกอิน 401 / 303
//   4) UA iPhone / iPadOS / Android / LINE เปลี่ยนโหมด sheet ตาม §4.2 §4.4
// นัด "จบแล้ว" (isPast) สร้างผ่าน API ไม่ได้ (เวลาเริ่มต้องอยู่ในอนาคต) และ E2E ไม่มีนาฬิกาจำลอง → ครอบที่ Vitest (tests/ui/add-to-calendar.test.ts, tests/calendar/ics-route.test.ts)
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './support/auth';
import { cancelApptApi, createApptApi, daysAhead, rsvpApi } from './support/appt';
import { setPrefs, watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, go, type Theme } from './support/groups';
import { LOCALES, msg, type Locale } from './support/messages';

const THEMES: readonly Theme[] = ['light', 'dark'];
const slot = (d: string) => ({ startDate: d, startTime: '19:00', endDate: d, endTime: '21:00' });
// ชื่อ/สถานที่ยาวสุดที่ระบบยอมรับ (ชื่อ ≤ 80, สถานที่ ≤ 120) ไม่มีช่องว่างให้ตัดบรรทัด — ทดสอบการล้น
const LONG_TITLE = `Title${'x'.repeat(75)}`;
const LONG_PLACE = `Place${'y'.repeat(115)}`;

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ ส่ง UA เป็น Macintosh → แยกจาก Mac ด้วย maxTouchPoints
  ipados: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.5.0',
  lineAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Line/14.5.0',
} as const;

const noOverflow = async (page: Page, label: string) => {
  const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth, b: document.body.scrollWidth }));
  expect(w.s, `${label}: documentElement ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
  expect(w.b, `${label}: body ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
};

/** กลุ่ม + นัดอีก 1 นัด (ผู้ใช้ปัจจุบันเป็นผู้สร้าง/สมาชิก) · คืน id */
async function seed(page: Page, gid: string, over: Record<string, unknown> = {}): Promise<string> {
  return createApptApi(page.request, gid, { title: 'นัดกินข้าว R12', ...slot(daysAhead(5)), placeName: 'สยามพารากอน', ...over });
}

/** นัด + ตอบ "ไป" ผ่าน API แล้วเปิดหน้า · เปิด sheet คืน locator */
async function openSheetFor(page: Page, context: Parameters<typeof setPrefs>[0], baseURL: string, locale: Locale, theme: Theme, over: Record<string, unknown> = {}) {
  await setPrefs(context, baseURL, { locale, theme });
  const gid = await createGroupApi(page.request, `R12 ${Math.random().toString(36).slice(2, 7)}`);
  const id = await seed(page, gid, over);
  await rsvpApi(page.request, id, 'going');
  await go(page, `/appointments/${id}`);
  await page.getByTestId('appt-add-calendar').click();
  const sheet = page.getByTestId('cal-add-sheet');
  await expect(sheet).toBeVisible();
  return { gid, id, sheet };
}

const T = (locale: Locale, key: string) => msg(locale, `appointments.calendar.${key}`);

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test.describe(`${locale} · ${theme}`, () => {
      test('R12-1: ปุ่มแสดงเฉพาะตอบ "ไป" (ผ่าน UI) · ยังไม่ตอบ/อาจไป/ไม่ไป/ยกเลิก ไม่แสดง', async ({ page, context, baseURL, user }) => {
        void user;
        await setPrefs(context, baseURL!, { locale, theme });
        const problems = watchConsole(page);
        const gid = await createGroupApi(page.request, `R12 btn ${Math.random().toString(36).slice(2, 7)}`);
        const id = await seed(page, gid);
        const btn = page.getByTestId('appt-add-calendar');
        await go(page, `/appointments/${id}`);
        await expect(page.getByTestId('appt-rsvp-section')).toBeVisible();
        await expect(btn, 'ยังไม่ตอบ').toHaveCount(0);

        // ตอบ "อาจไป" (ไม่ต้องยืนยัน) → ไม่มีปุ่ม
        await page.getByTestId('appt-rsvp-maybe').click();
        await expect(page.getByTestId('appt-rsvp-maybe')).toHaveAttribute('aria-pressed', 'true');
        await expect(btn, 'อาจไป').toHaveCount(0);

        // เป็น "ไป" ต้องยืนยัน → ปุ่มโผล่หลังบันทึกเสร็จ
        await page.getByTestId('appt-rsvp-going').click();
        await page.getByTestId('rsvp-confirm-ok').click();
        await expect(page.getByTestId('appt-rsvp-going')).toHaveAttribute('aria-pressed', 'true');
        await expect(btn, 'ไป').toBeVisible();
        await expect(btn).toContainText(T(locale, 'add'));

        // จาก "ไป" เป็น "ไม่ไป" ต้องยืนยัน → ปุ่มหาย
        await page.getByTestId('appt-rsvp-not_going').click();
        await page.getByTestId('rsvp-confirm-ok').click();
        await expect(page.getByTestId('appt-rsvp-not_going')).toHaveAttribute('aria-pressed', 'true');
        await expect(btn, 'ไม่ไป').toHaveCount(0);

        // ยกเลิกนัด (หลังเคยตอบ "ไป") → ไม่มีปุ่ม แม้โหลดหน้าใหม่
        await rsvpApi(page.request, id, 'going');
        await go(page, `/appointments/${id}`);
        await expect(btn).toBeVisible();
        await cancelApptApi(page.request, id);
        await go(page, `/appointments/${id}`);
        await expect(page.getByTestId('appt-cancelled-banner')).toBeVisible();
        await expect(btn, 'ยกเลิกแล้ว').toHaveCount(0);
        expect(problems).toEqual([]);
      });

      test('R12-12/13: sheet — oneTime เห็นก่อนกด · ทั้งสองตัวเลือก · ข้อความตรงของจริง · ไม่ล้น · ปุ่ม ≥ 44px (ชื่อ/สถานที่ยาวสุด)', async ({ page, context, baseURL, user }, testInfo: TestInfo) => {
        void user;
        const problems = watchConsole(page);
        const { id, sheet } = await openSheetFor(page, context, baseURL!, locale, theme, { title: LONG_TITLE, placeName: LONG_PLACE });
        await expect(page.getByRole('dialog')).toBeVisible();

        await expect(page.getByRole('dialog')).toContainText(T(locale, 'sheetTitle'));
        const once = page.getByTestId('cal-add-onetime');
        await expect(once).toBeVisible();
        await expect(once).toContainText(T(locale, 'oneTime'));
        // ต้องไม่เห็นเฉพาะหลังกด: ไม่มีขั้นตอนอื่นระหว่างเปิด sheet กับเห็นข้อความ
        await expect(sheet.getByTestId('cal-add-ics')).toContainText(T(locale, 'device'));
        await expect(sheet.getByTestId('cal-add-google')).toContainText(T(locale, 'google'));
        await expect(sheet.getByTestId('cal-add-google-note')).toContainText(T(locale, 'googleNote'));
        await expect(sheet.getByTestId('cal-add-line-hint')).toHaveCount(0);
        await expect(sheet.getByTestId('cal-add-line-open')).toHaveCount(0);

        // ลิงก์ .ics เป็น <a href> ธรรมดา ชี้ route จริง · ลิงก์ Google เปิดแท็บใหม่ ไม่ส่ง Referer
        await expect(sheet.getByTestId('cal-add-ics')).toHaveAttribute('href', `/api/appointments/${id}/calendar.ics`);
        const google = sheet.getByTestId('cal-add-google');
        await expect(google).toHaveAttribute('target', '_blank');
        const rel = (await google.getAttribute('rel')) ?? '';
        expect(rel).toContain('noopener');
        expect(rel).toContain('noreferrer');
        const gUrl = new URL((await google.getAttribute('href'))!);
        expect(gUrl.origin + gUrl.pathname).toBe('https://calendar.google.com/calendar/render');
        expect(gUrl.searchParams.get('action')).toBe('TEMPLATE');
        expect(gUrl.searchParams.get('text')).toBe(LONG_TITLE);
        expect(gUrl.searchParams.get('location')).toBe(LONG_PLACE);
        expect(gUrl.searchParams.get('ctz')).toBe('Asia/Bangkok');
        // 19:00–21:00 กรุงเทพ = 12:00–14:00 UTC
        expect(gUrl.searchParams.get('dates')).toMatch(/^\d{8}T120000Z\/\d{8}T140000Z$/);

        await noOverflow(page, `sheet ${locale}/${theme}`);
        await checkLayout(page, testInfo, 'r12-add-to-calendar-sheet', locale, theme);
        // ปิดแล้วกลับหน้านัดโดยไม่มีอะไรหลุด
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await noOverflow(page, `หน้านัดหลังปิด sheet ${locale}/${theme}`);
        expect(problems).toEqual([]);
      });

      test('R12-13: หน้านัดที่มีปุ่ม (ชื่อ/สถานที่ยาวสุด) ไม่ล้นแนวนอน ปุ่ม ≥ 44px', async ({ page, context, baseURL, user }, testInfo: TestInfo) => {
        void user;
        await setPrefs(context, baseURL!, { locale, theme });
        const gid = await createGroupApi(page.request, `R12 pg ${Math.random().toString(36).slice(2, 7)}`);
        const id = await seed(page, gid, { title: LONG_TITLE, placeName: LONG_PLACE });
        await rsvpApi(page.request, id, 'going');
        await go(page, `/appointments/${id}`);
        await expect(page.getByTestId('appt-add-calendar')).toBeVisible();
        await checkLayout(page, testInfo, 'r12-add-to-calendar-page', locale, theme);
      });

      test('R12-2/4: .ics ตอบ 200 text/calendar จาก session จริง · ดาวน์โหลดจริงได้ชื่อไฟล์คงที่ · ไม่ล็อกอิน 401 / 303', async ({ page, context, baseURL, user, playwright }) => {
        void user;
        const { id, sheet } = await openSheetFor(page, context, baseURL!, locale, theme);
        const href = (await sheet.getByTestId('cal-add-ics').getAttribute('href'))!;

        // ผ่าน session ของเบราว์เซอร์ (คุกกี้เดียวกับที่กดจริง)
        const res = await page.request.get(href);
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toBe('text/calendar; charset=utf-8');
        expect(res.headers()['content-disposition']).toBe('attachment; filename="maewmeet-plan.ics"');
        expect(res.headers()['cache-control']).toBe('private, no-store');
        const body = await res.text();
        expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
        expect(body).toContain(`UID:${id}@maewmeet\r\n`);
        expect(body).toMatch(/\r\nDTSTART:\d{8}T120000Z\r\n/); // 19:00 กรุงเทพ
        expect(body).toMatch(/\r\nDTEND:\d{8}T140000Z\r\n/);
        expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);

        // กดลิงก์จริง → เบราว์เซอร์ดาวน์โหลด (attachment) ไม่ออกจากหน้า
        const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByTestId('cal-add-ics').click()]);
        expect(download.suggestedFilename()).toBe('maewmeet-plan.ics');
        await expect(page).toHaveURL(new RegExp(`/appointments/${id}$`));

        // ไม่ล็อกอิน: เรียกแบบ API = 401 · เปิดจากลิงก์ = 303 ไปหน้านัด (ไม่เห็น JSON ดิบ)
        const anon = await playwright.request.newContext({ baseURL: baseURL! });
        try {
          const api = await anon.get(href, { maxRedirects: 0 });
          expect(api.status()).toBe(401);
          expect(await api.text()).not.toContain('BEGIN:VCALENDAR');
          const nav = await anon.get(href, { maxRedirects: 0, headers: { 'sec-fetch-mode': 'navigate' } });
          expect(nav.status()).toBe(303);
          expect(nav.headers()['location']).toBe(`/appointments/${id}`);
        } finally {
          await anon.dispose();
        }
      });
    });
  }
}

// ───────── R12-11: โหมดของ sheet ตาม user agent (§4.2 §4.4) · ลำดับในหน้าจริงต้องตรง data-mode ─────────
const order = async (page: Page): Promise<string[]> =>
  page.getByTestId('cal-add-sheet').locator('[data-testid="cal-add-ics"], [data-testid="cal-add-google"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test.describe(`UA · ${locale} · ${theme}`, () => {
      test.describe('iPhone', () => {
        test.use({ userAgent: UA.iphone });
        test('.ics ก่อน Google · ทั้งสองยังอยู่', async ({ page, context, baseURL, user }) => {
          void user;
          const { sheet } = await openSheetFor(page, context, baseURL!, locale, theme);
          await expect(sheet).toHaveAttribute('data-mode', 'ics');
          expect(await order(page)).toEqual(['cal-add-ics', 'cal-add-google']);
        });
      });

      test.describe('iPadOS (UA เป็น Macintosh + maxTouchPoints > 1)', () => {
        test.use({ userAgent: UA.ipados });
        test('.ics ก่อน Google', async ({ page, context, baseURL, user }) => {
          void user;
          await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5, configurable: true }));
          const { sheet } = await openSheetFor(page, context, baseURL!, locale, theme);
          await expect(sheet).toHaveAttribute('data-mode', 'ics');
          expect(await order(page)).toEqual(['cal-add-ics', 'cal-add-google']);
        });
        test('Macintosh ที่ไม่มีจอสัมผัส = Google ก่อน (ไม่ใช่ iPad)', async ({ page, context, baseURL, user }) => {
          void user;
          await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 0, configurable: true }));
          const { sheet } = await openSheetFor(page, context, baseURL!, locale, theme);
          await expect(sheet).toHaveAttribute('data-mode', 'google');
          expect(await order(page)).toEqual(['cal-add-google', 'cal-add-ics']);
        });
      });

      test.describe('Android', () => {
        test.use({ userAgent: UA.android });
        test('Google ก่อน .ics · ทั้งสองยังอยู่', async ({ page, context, baseURL, user }) => {
          void user;
          const { sheet } = await openSheetFor(page, context, baseURL!, locale, theme);
          await expect(sheet).toHaveAttribute('data-mode', 'google');
          expect(await order(page)).toEqual(['cal-add-google', 'cal-add-ics']);
        });
      });

      for (const [name, ua] of [['LINE iOS', UA.lineIos], ['LINE Android', UA.lineAndroid]] as const) {
        test.describe(name, () => {
          test.use({ userAgent: ua });
          test('§4.4: ไม่แสดง 2 ตัวเลือก · แสดง oneTime + lineHint + ปุ่มเปิดเบราว์เซอร์ · ไม่ล้น ปุ่ม ≥ 44px', async ({ page, context, baseURL, user }, testInfo: TestInfo) => {
            void user;
            const problems = watchConsole(page);
            const { id, sheet } = await openSheetFor(page, context, baseURL!, locale, theme);
            await expect(sheet).toHaveAttribute('data-mode', 'line');
            await expect(page.getByTestId('cal-add-onetime')).toContainText(T(locale, 'oneTime'));
            await expect(page.getByTestId('cal-add-line-hint')).toContainText(T(locale, 'lineHint'));
            const open = page.getByTestId('cal-add-line-open');
            await expect(open).toContainText(T(locale, 'lineOpen'));
            await expect(open).toHaveAttribute('href', `/appointments/${id}?openExternalBrowser=1`);
            await expect(sheet.getByTestId('cal-add-ics')).toHaveCount(0);
            await expect(sheet.getByTestId('cal-add-google')).toHaveCount(0);
            await expect(sheet.getByTestId('cal-add-google-note')).toHaveCount(0);
            await noOverflow(page, `${name} sheet`);
            await checkLayout(page, testInfo, `r12-add-to-calendar-line`, locale, theme);
            expect(problems).toEqual([]);
          });
        });
      }
    });
  }
}
