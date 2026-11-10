// R13 — สถานที่แบบวางลิงก์ (R13_CONTRACT §1.1 §1.2 · R13-1 R13-2 R13-3 R13-4): 375/390/768 (= project)
//   1) ฟอร์ม: ไม่มีปุ่มค้นหา/ชิป/แผงวาง · ช่องชื่อ+ช่องลิงก์เห็นทันที · มีปุ่ม Google/Apple Maps
//   2) บันทึกได้ 4 กรณี (ชื่ออย่างเดียว / ลิงก์อย่างเดียว / ทั้งสอง / ไม่มีเลย) · ลิงก์ผิด: ขึ้น error ตอน blur และตอนกดบันทึก (ไม่บันทึก)
//   3) UA iPhone = apple+google (Apple ก่อน) · UA Android = google อย่างเดียว · href ค้นหา encode ชื่อ (ไทย, &, #) · ไม่มี hydration error
//   4) หน้ารายละเอียด: ไม่มีภาพแผนที่ · 3 กรณี §1.2 (https → place-open · พิกัดอย่างเดียว → geo · ชื่ออย่างเดียว → map-app-*) · ปุ่ม ≥ 44px ข้อความไม่ล้นขอบปุ่ม
//   5) .ics (R13 §1.4): ป้ายตามภาษาบัญชีของผู้ดาวน์โหลด · URL = ลิงก์แผนที่เมื่อมี ไม่มี = ลิงก์นัด
//   6) นัดเก่า (พิกัดอย่างเดียว / ลิงก์ OSM) เปิดแก้แล้วบันทึกกลับ ค่าไม่หาย
// ทุกกรณีไม่มีการยิงเครือข่ายไปแผนที่ตอนโหลดหน้า — ปุ่มเป็นลิงก์ธรรมดา (ไม่คลิกตามไปภายนอกในเทสต์)
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/auth';
import { watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, go, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';
import { call, createApptApi, daysAhead, isHydration, makeScene, pickFormDate, type ApptApi } from './support/appt';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
} as const;

const COMBOS: { locale: Locale; theme: Theme }[] = [
  { locale: 'th', theme: 'light' },
  { locale: 'en', theme: 'dark' },
];

const slot = (d: string) => ({ startDate: d, startTime: '19:00', endDate: d, endTime: '21:00' });
const NAME = 'ร้านหมูกระทะป้าแดง';
const TRICKY = 'ร้านป้าแดง & #1 100%';
const HTTPS_LINK = 'https://maps.app.goo.gl/abc123';
const OSM_LINK = 'https://www.openstreetmap.org/?mlat=13.7461&mlon=100.5347#map=17/13.7461/100.5347';
const gSearch = (name: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
const aSearch = (name: string) => `https://maps.apple.com/?q=${encodeURIComponent(name)}`;

type Detail = { placeName: string | null; lat: number | null; lng: number | null; mapUrl: string | null };
async function getAppt(page: Page, id: string): Promise<Detail> {
  const r = await call<{ appointment: Detail & ApptApi }>(page.request, 'GET', `/api/appointments/${id}`);
  expect(r.status, r.text).toBe(200);
  const a = r.json!.data!.appointment;
  return { placeName: a.placeName, lat: a.lat, lng: a.lng, mapUrl: a.mapUrl };
}

async function newGroup(page: Page): Promise<string> {
  return createGroupApi(page.request, `R13 ${Math.random().toString(36).slice(2, 8)}`);
}

async function openCreateForm(page: Page, gid: string): Promise<Locator> {
  await go(page, `/groups/${gid}/appointments`);
  await page.getByTestId('appt-list-create').click();
  const form = page.getByTestId('appt-form');
  await expect(form).toBeVisible();
  return form;
}

/** กรอกชื่อนัด + วัน แล้วกดบันทึก → รอถึงหน้ารายละเอียด คืน id */
async function fillAndSave(page: Page, title: string, locale: Locale): Promise<string> {
  await page.getByTestId('appt-title').fill(title);
  await pickFormDate(page, daysAhead(5), locale);
  await page.getByTestId('appt-submit').click();
  await page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
  return /\/appointments\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
}

test.describe('R13 ฟอร์ม', () => {
  for (const { locale, theme } of COMBOS) {
    test(`${locale}/${theme}: ไม่มีปุ่มค้นหา/ชิป/แผงวาง · ช่องชื่อและช่องลิงก์เห็นทันที · มีปุ่ม Google Maps · ไม่ล้น ปุ่ม ≥ 44px`, async ({ page, context, baseURL, user }, testInfo) => {
      void user;
      await context.addCookies([
        { name: 'mm_locale', value: locale, url: baseURL! },
        { name: 'mm_theme', value: theme, url: baseURL! },
      ]);
      const problems = watchConsole(page);
      const form = await openCreateForm(page, await newGroup(page));

      await expect(page.getByTestId('place-field')).toBeVisible();
      await expect(page.getByTestId('place-query')).toBeVisible();
      await expect(page.getByTestId('place-link')).toBeVisible();
      await expect(page.getByTestId('place-link-hint')).toContainText(msg(locale, 'places.link.hint'));
      await expect(page.getByTestId('place-link')).toHaveAttribute('placeholder', msg(locale, 'places.link.placeholder'));
      await expect(page.getByTestId('place-link')).toHaveAttribute('aria-describedby', /.+/);
      // ถูกลบแล้ว: ไม่มี testid ของค้นหา/ผลลัพธ์/ชิป/แผงวาง/ภาพแผนที่ และไม่มีปุ่มชื่อ "ค้นหา" ในช่องสถานที่
      for (const gone of ['place-search', 'place-results', 'place-result', 'place-too-short', 'place-none', 'place-error', 'place-rate', 'place-disabled', 'place-paste', 'place-paste-toggle', 'place-paste-input', 'place-paste-submit', 'place-chip', 'place-clear', 'place-map']) {
        await expect(form.getByTestId(gone), gone).toHaveCount(0);
      }
      await expect(page.getByTestId('place-field').getByRole('button')).toHaveCount(0);
      // ปุ่มแผนที่: ลิงก์ธรรมดา เปิดแท็บใหม่ ไม่ส่ง Referer (render แรก Google · Apple เพิ่มหลัง mount เฉพาะ Apple/Mac)
      const google = page.getByTestId('map-app-google');
      await expect(google).toBeVisible();
      await expect(google).toContainText(msg(locale, 'places.apps.google'));
      await expect(google).toHaveAttribute('target', '_blank');
      expect((await google.getAttribute('rel')) ?? '').toContain('noopener');
      expect((await google.getAttribute('rel')) ?? '').toContain('noreferrer');
      await expect(google).toHaveAttribute('href', 'https://www.google.com/maps'); // ชื่อว่าง = หน้าแรกของแผนที่ (ไม่ส่งอะไร)
      await expect(page.getByTestId('map-apps')).toHaveAttribute('role', 'group');
      await checkLayout(page, testInfo, 'r13-form', locale, theme);
      expect(problems).toEqual([]);
    });
  }

  test('บันทึกได้ 4 กรณี: ชื่ออย่างเดียว · ลิงก์อย่างเดียว · ทั้งสอง · ไม่มีเลย', async ({ page, user }) => {
    void user;
    test.setTimeout(120_000);
    const locale = 'th' as const;
    const problems = watchConsole(page);
    const gid = await newGroup(page);
    const cases: { label: string; name: string; link: string; want: Detail }[] = [
      { label: 'ชื่ออย่างเดียว', name: NAME, link: '', want: { placeName: NAME, lat: null, lng: null, mapUrl: null } },
      { label: 'ลิงก์อย่างเดียว', name: '', link: HTTPS_LINK, want: { placeName: null, lat: null, lng: null, mapUrl: HTTPS_LINK } },
      { label: 'ทั้งสอง', name: NAME, link: HTTPS_LINK, want: { placeName: NAME, lat: null, lng: null, mapUrl: HTTPS_LINK } },
      { label: 'ไม่มีเลย', name: '', link: '', want: { placeName: null, lat: null, lng: null, mapUrl: null } },
    ];
    for (const c of cases) {
      await openCreateForm(page, gid);
      if (c.name) await page.getByTestId('place-query').fill(c.name);
      if (c.link) await page.getByTestId('place-link').fill(c.link);
      const id = await fillAndSave(page, `R13 ${c.label}`, locale);
      expect(await getAppt(page, id), c.label).toEqual(c.want);
      // หน้ารายละเอียด: มีส่วนสถานที่เฉพาะเมื่อมีข้อมูล
      if (c.want.placeName || c.want.mapUrl) await expect(page.getByTestId('appt-place'), c.label).toBeVisible();
      else await expect(page.getByTestId('appt-place'), c.label).toHaveCount(0);
      await expect(page.getByTestId('place-map'), c.label).toHaveCount(0);
    }
    // ชื่อล้วน ๆ ไม่ใส่พิกัดให้เอง: ลิงก์ที่เป็นพิกัด → เก็บเป็น lat/lng
    await openCreateForm(page, gid);
    await page.getByTestId('place-query').fill(NAME);
    await page.getByTestId('place-link').fill('13.7563, 100.5018');
    const id = await fillAndSave(page, 'R13 พิกัด', locale);
    expect(await getAppt(page, id)).toEqual({ placeName: NAME, lat: 13.7563, lng: 100.5018, mapUrl: null });
    expect(problems).toEqual([]);
  });

  test('ลิงก์ผิด: error ขึ้นตอน blur และตอนกดบันทึก · ฟอร์มไม่ปิด ไม่สร้างนัด · แก้เป็นลิงก์ถูกแล้วบันทึกได้', async ({ page, user }) => {
    void user;
    test.setTimeout(90_000);
    const locale = 'th' as const;
    const gid = await newGroup(page);
    const form = await openCreateForm(page, gid);
    const link = page.getByTestId('place-link');

    // ระหว่างพิมพ์ยังไม่ขึ้น error (ไม่ขัดจังหวะการวาง) · ออกจากช่อง (blur) ขึ้น error
    await link.fill('http://maps.example.com/@13.7,100.5,15z');
    await expect(page.getByTestId('place-link-error')).toHaveCount(0);
    await link.blur();
    await expect(page.getByTestId('place-link-error')).toContainText(msg(locale, 'errors.INVALID_MAP_URL'));
    await expect(link).toHaveAttribute('aria-invalid', 'true');
    await expect(link).toHaveAttribute('aria-describedby', /.+ .+/); // error + hint

    // กดบันทึกทั้งที่ลิงก์ผิด → ไม่ส่ง · ฟอร์มค้าง · error ยังอยู่
    await page.getByTestId('appt-title').fill('R13 ลิงก์ผิด');
    await pickFormDate(page, daysAhead(5), locale);
    await page.getByTestId('appt-submit').click();
    await expect(page.getByTestId('place-link-error')).toContainText(msg(locale, 'errors.INVALID_MAP_URL'));
    await expect(form).toBeVisible();
    await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}\/appointments$/);
    const list = await call<{ appointments: ApptApi[] }>(page.request, 'GET', `/api/groups/${gid}/appointments?scope=upcoming&limit=5`);
    expect(list.json?.data?.appointments ?? []).toHaveLength(0);

    // พิกัดผิดช่วง
    await link.fill('999, 999');
    await link.blur();
    await expect(page.getByTestId('place-link-error')).toContainText(msg(locale, 'errors.INVALID_COORDINATES'));

    // แก้เป็นลิงก์ถูก → error หาย → บันทึกได้
    await link.fill(HTTPS_LINK);
    await link.blur();
    await expect(page.getByTestId('place-link-error')).toHaveCount(0);
    await page.getByTestId('appt-submit').click();
    await page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
    const id = /\/appointments\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
    expect((await getAppt(page, id)).mapUrl).toBe(HTTPS_LINK);
  });
});

test.describe('R13 ปุ่มแผนที่ตามเครื่อง (ฟอร์ม)', () => {
  test.describe('iPhone', () => {
    test.use({ userAgent: UA.iphone });
    test('Apple Maps + Google Maps (Apple ก่อน) · href ค้นหา encode ชื่อไทย/&/# · ไม่มี hydration error', async ({ page, user }) => {
      void user;
      const problems = watchConsole(page);
      await openCreateForm(page, await newGroup(page));
      const apps = page.getByTestId('map-apps');
      await expect(apps).toHaveAttribute('data-apps', 'apple,google'); // auto-wait: Apple โผล่หลัง mount
      expect(await apps.locator('[data-testid^="map-app-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(['map-app-apple', 'map-app-google']);
      // ชื่อว่าง = หน้าแรกของแผนที่
      await expect(page.getByTestId('map-app-apple')).toHaveAttribute('href', 'https://maps.apple.com/');
      await expect(page.getByTestId('map-app-google')).toHaveAttribute('href', 'https://www.google.com/maps');
      // พิมพ์ชื่อ → href ค้นหา encode ครบ
      await page.getByTestId('place-query').fill(NAME);
      await expect(page.getByTestId('map-app-google')).toHaveAttribute('href', gSearch(NAME));
      await expect(page.getByTestId('map-app-apple')).toHaveAttribute('href', aSearch(NAME));
      expect(await page.getByTestId('map-app-google').getAttribute('href')).toContain(encodeURIComponent('ร้าน'));
      await page.getByTestId('place-query').fill(`  ${TRICKY}  `);
      const g = (await page.getByTestId('map-app-google').getAttribute('href'))!;
      const a = (await page.getByTestId('map-app-apple').getAttribute('href'))!;
      expect(g).toBe(gSearch(TRICKY)); // trim แล้ว encode: & → %26, # → %23, % → %25
      expect(a).toBe(aSearch(TRICKY));
      for (const h of [g, a]) {
        expect(h).toContain('%26');
        expect(h).toContain('%23');
        expect(new URL(h).searchParams.get(h.startsWith('https://maps.apple') ? 'q' : 'query')).toBe(TRICKY);
      }
      for (const app of ['apple', 'google']) {
        const btn = page.getByTestId(`map-app-${app}`);
        await expect(btn).toHaveAttribute('target', '_blank');
        expect((await btn.getAttribute('rel')) ?? '').toContain('noopener');
      }
      expect(problems.filter(isHydration)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });

  test.describe('Android', () => {
    test.use({ userAgent: UA.android });
    test('Google Maps ปุ่มเดียว (ไม่มี Apple) · href ค้นหา encode ชื่อ · ไม่มี hydration error', async ({ page, user }) => {
      void user;
      const problems = watchConsole(page);
      await openCreateForm(page, await newGroup(page));
      await expect(page.getByTestId('map-app-google')).toBeVisible();
      await page.getByTestId('place-query').fill(NAME);
      await expect(page.getByTestId('map-app-google')).toHaveAttribute('href', gSearch(NAME));
      // รอให้ client snapshot ทำงานแล้ว (Apple ไม่โผล่) — ยืนยันซ้ำหลังพิมพ์ ไม่ใช่แค่ render แรก
      await expect(page.getByTestId('map-apps')).toHaveAttribute('data-apps', 'google');
      await expect(page.getByTestId('map-app-apple')).toHaveCount(0);
      expect(problems.filter(isHydration)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
});

test.describe('R13 หน้ารายละเอียด', () => {
  for (const { locale, theme } of COMBOS) {
    test(`${locale}/${theme}: 3 กรณี §1.2 · ไม่มีภาพแผนที่ · ปุ่ม ≥ 44px ข้อความไม่ล้นขอบปุ่ม`, async ({ page, context, baseURL, user }, testInfo) => {
      void user;
      test.setTimeout(120_000);
      await context.addCookies([
        { name: 'mm_locale', value: locale, url: baseURL! },
        { name: 'mm_theme', value: theme, url: baseURL! },
      ]);
      const problems = watchConsole(page);
      const narrow = page.viewportSize()!.width <= 390;
      const gid = await newGroup(page);
      const httpsId = await createApptApi(page.request, gid, { title: 'R13 ลิงก์ https', ...slot(daysAhead(3)), placeName: NAME, mapUrl: HTTPS_LINK });
      const longHost = 'https://www.a-very-long-subdomain-for-the-map-host.example-maps-service.com/place/abc?x=1';
      const longId = await createApptApi(page.request, gid, { title: 'R13 โฮสต์ยาว', ...slot(daysAhead(4)), placeName: NAME, mapUrl: longHost });
      const geoId = await createApptApi(page.request, gid, { title: 'R13 พิกัดอย่างเดียว', ...slot(daysAhead(5)), placeName: NAME, lat: 13.75, lng: 100.5 });
      const nameId = await createApptApi(page.request, gid, { title: 'R13 ชื่ออย่างเดียว', ...slot(daysAhead(6)), placeName: TRICKY });

      // 1) มีลิงก์ https → ปุ่ม place-open (https, แท็บใหม่) · ไม่มีภาพแผนที่ · ไม่มีปุ่มค้นหา
      await go(page, `/appointments/${httpsId}`);
      const open = page.getByTestId('place-open');
      await expect(open).toHaveAttribute('data-kind', 'https');
      await expect(open).toHaveAttribute('href', HTTPS_LINK);
      await expect(open).toHaveAttribute('target', '_blank');
      expect((await open.getAttribute('rel')) ?? '').toContain('noopener');
      await expect(page.getByTestId('place-map')).toHaveCount(0);
      await expect(page.getByTestId('map-apps')).toHaveCount(0);
      await expect(page.getByTestId('appt-place-name')).toContainText(NAME);
      await expect(open).toContainText('maps.app.goo.gl');
      await expectButtonFits(open, 'https', { singleLine: narrow });
      await checkLayout(page, testInfo, 'r13-detail-https', locale, theme);

      // 1b) โฮสต์ยาว: ข้อความไม่ล้นขอบปุ่ม ไม่ทำให้หน้ากว้างเกิน
      await go(page, `/appointments/${longId}`);
      await expect(page.getByTestId('place-open')).toHaveAttribute('data-kind', 'https');
      await expectButtonFits(page.getByTestId('place-open'), 'โฮสต์ยาว', { singleLine: false });
      await checkLayout(page, testInfo, 'r13-detail-longhost', locale, theme);

      // 2) พิกัดอย่างเดียว → geo:
      await go(page, `/appointments/${geoId}`);
      await expect(page.getByTestId('place-open')).toHaveAttribute('data-kind', 'geo');
      await expect(page.getByTestId('place-open')).toHaveAttribute('href', /^geo:13\.75,100\.5\?q=13\.75,100\.5/);
      await expect(page.getByTestId('place-open')).not.toHaveAttribute('target', '_blank');
      await expect(page.getByTestId('place-open')).toContainText(msg(locale, 'places.open'));
      await expect(page.getByTestId('place-map')).toHaveCount(0);
      await expect(page.getByTestId('map-apps')).toHaveCount(0);
      await expectButtonFits(page.getByTestId('place-open'), 'geo', { singleLine: narrow });
      await checkLayout(page, testInfo, 'r13-detail-geo', locale, theme);

      // 3) ชื่ออย่างเดียว → ปุ่มค้นหาใน Google (Apple เฉพาะเครื่อง Apple) ไม่มี place-open
      await go(page, `/appointments/${nameId}`);
      await expect(page.getByTestId('place-open')).toHaveCount(0);
      await expect(page.getByTestId('place-map')).toHaveCount(0);
      const g = page.getByTestId('map-app-google');
      await expect(g).toBeVisible();
      await expect(g).toHaveAttribute('href', gSearch(TRICKY));
      await expect(g).toContainText(msg(locale, 'places.find.google'));
      await expect(page.getByTestId('map-apps')).toHaveAttribute('data-apps', 'google'); // Chromium ปกติ (ไม่ใช่เครื่อง Apple)
      await expect(page.getByTestId('map-app-apple')).toHaveCount(0);
      await expectButtonFits(g, 'find google', { singleLine: false });
      await checkLayout(page, testInfo, 'r13-detail-name', locale, theme);

      expect(problems.filter((p) => !isHydration(p))).toEqual([]);
      expect(problems.filter(isHydration)).toEqual([]);
    });
  }

  test.describe('iPhone', () => {
    test.use({ userAgent: UA.iphone });
    test('ชื่ออย่างเดียว: ปุ่ม Apple Maps + Google Maps ในการ์ดรายละเอียด · href encode · ไม่มี hydration error', async ({ page, user }) => {
      void user;
      const problems = watchConsole(page);
      const gid = await newGroup(page);
      const id = await createApptApi(page.request, gid, { title: 'R13 iPhone', ...slot(daysAhead(3)), placeName: TRICKY });
      await go(page, `/appointments/${id}`);
      await expect(page.getByTestId('map-apps')).toHaveAttribute('data-apps', 'apple,google');
      await expect(page.getByTestId('map-app-apple')).toHaveAttribute('href', aSearch(TRICKY));
      await expect(page.getByTestId('map-app-google')).toHaveAttribute('href', gSearch(TRICKY));
      await expect(page.getByTestId('map-app-apple')).toContainText(msg('th', 'places.find.apple'));
      await expect(page.getByTestId('place-open')).toHaveCount(0);
      expect(problems.filter(isHydration)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
});

/**
 * ปุ่ม place-open / map-app-*: สูง ≥ 44px · ข้อความอยู่ในขอบปุ่มมี padding ซ้ายขวา ≥ 8px (ไม่ชิดขอบ) · ไม่ล้นจากปุ่ม
 * singleLine: ข้อความต้องอยู่บรรทัดเดียว (ใช้ที่ 375/390 กับโฮสต์ปกติ — ที่ 768 การ์ดกว้างครึ่งเดียว และโฮสต์ยาวมาก ๆ ขึ้นบรรทัดใหม่ได้ ขอแค่ไม่ชิดขอบ/ไม่ล้น)
 */
async function expectButtonFits(btn: Locator, label: string, opts: { singleLine: boolean }): Promise<void> {
  const m = await btn.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const span = el.querySelector('span');
    const s = span ? span.getBoundingClientRect() : b;
    const lh = parseFloat(getComputedStyle(span ?? el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4;
    return { h: b.height, left: s.left - b.left, right: b.right - s.right, textH: s.height, lh, overflow: span ? span.scrollWidth > span.clientWidth + 1 : false, docW: document.documentElement.scrollWidth, winW: document.documentElement.clientWidth, bRight: b.right };
  });
  expect(m.h, `${label}: ปุ่มสูง ≥ 44px`).toBeGreaterThanOrEqual(44);
  expect(m.left, `${label}: ข้อความไม่ชิดขอบซ้ายปุ่ม`).toBeGreaterThanOrEqual(8);
  expect(m.right, `${label}: ข้อความไม่ชิดขอบขวาปุ่ม`).toBeGreaterThanOrEqual(8);
  if (opts.singleLine) expect(m.textH, `${label}: ข้อความอยู่บรรทัดเดียว`).toBeLessThan(m.lh * 1.6);
  expect(m.overflow, `${label}: ข้อความไม่ถูกตัดล้น (scrollWidth)`).toBe(false);
  expect(m.docW, `${label}: หน้าไม่ล้นแนวนอน`).toBeLessThanOrEqual(m.winW);
  expect(m.bRight, `${label}: ปุ่มอยู่ในจอ`).toBeLessThanOrEqual(m.winW);
}

test.describe('R13 นัดเก่า: เปิดแก้แล้วบันทึกกลับ ค่าไม่หาย', () => {
  test('พิกัดอย่างเดียว (ไม่มี mapUrl): ช่องลิงก์แสดงเป็น lat,lng · แก้แค่ชื่อนัด → lat/lng/ชื่อสถานที่ยังเหมือนเดิม', async ({ page, user }) => {
    void user;
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    const gid = await newGroup(page);
    const id = await createApptApi(page.request, gid, { title: 'R13 นัดเก่า พิกัด', ...slot(daysAhead(4)), placeName: 'ร้านเก่า', lat: 13.7563, lng: 100.5018 });
    await go(page, `/appointments/${id}`);
    await page.getByTestId('appt-edit').click();
    await expect(page.getByTestId('appt-form')).toBeVisible();
    await expect(page.getByTestId('place-query')).toHaveValue('ร้านเก่า');
    await expect(page.getByTestId('place-link')).toHaveValue('13.7563,100.5018');
    await expect(page.getByTestId('place-link-error')).toHaveCount(0);
    await page.getByTestId('appt-title').fill('R13 นัดเก่า พิกัด (แก้)');
    await page.getByTestId('appt-submit').click();
    await expect(page.getByTestId('appt-form')).toHaveCount(0);
    await expect(page.getByTestId('appt-detail-title')).toHaveText('R13 นัดเก่า พิกัด (แก้)');
    expect(await getAppt(page, id)).toEqual({ placeName: 'ร้านเก่า', lat: 13.7563, lng: 100.5018, mapUrl: null });
    await expect(page.getByTestId('place-open')).toHaveAttribute('data-kind', 'geo');
    expect(problems).toEqual([]);
  });

  test('ลิงก์ OSM เดิม (นัดก่อน R13): เปิดแก้แล้วบันทึกชื่อใหม่ → mapUrl และพิกัดเดิมไม่หาย · ยังเปิดเป็น https', async ({ page, user }) => {
    void user;
    test.setTimeout(90_000);
    const gid = await newGroup(page);
    const id = await createApptApi(page.request, gid, { title: 'R13 นัดเก่า OSM', ...slot(daysAhead(4)), placeName: 'ร้านเก่า OSM', mapUrl: OSM_LINK });
    const before = await getAppt(page, id);
    expect(before.mapUrl).toBe(OSM_LINK);
    await go(page, `/appointments/${id}`);
    await expect(page.getByTestId('place-open')).toHaveAttribute('data-kind', 'https');
    await page.getByTestId('appt-edit').click();
    await expect(page.getByTestId('place-link')).toHaveValue(OSM_LINK);
    await page.getByTestId('place-query').fill('ร้านเก่า OSM (ชื่อใหม่)');
    await page.getByTestId('appt-submit').click();
    await expect(page.getByTestId('appt-form')).toHaveCount(0);
    expect(await getAppt(page, id)).toEqual({ ...before, placeName: 'ร้านเก่า OSM (ชื่อใหม่)' });
    await expect(page.getByTestId('appt-place-name')).toContainText('ร้านเก่า OSM (ชื่อใหม่)');
  });

  test('แก้เอาลิงก์ออก → ล้างค่า; แก้เอาชื่อออก → ชื่อสถานที่ว่าง ลิงก์ยังอยู่', async ({ page, user }) => {
    void user;
    test.setTimeout(90_000);
    const gid = await newGroup(page);
    const id = await createApptApi(page.request, gid, { title: 'R13 ล้างค่า', ...slot(daysAhead(4)), placeName: NAME, mapUrl: HTTPS_LINK });
    await go(page, `/appointments/${id}`);
    await page.getByTestId('appt-edit').click();
    await page.getByTestId('place-query').fill('');
    await page.getByTestId('appt-submit').click();
    await expect(page.getByTestId('appt-form')).toHaveCount(0);
    expect(await getAppt(page, id)).toEqual({ placeName: null, lat: null, lng: null, mapUrl: HTTPS_LINK });
    await page.getByTestId('appt-edit').click();
    await page.getByTestId('place-link').fill('');
    await page.getByTestId('appt-submit').click();
    await expect(page.getByTestId('appt-form')).toHaveCount(0);
    expect(await getAppt(page, id)).toEqual({ placeName: null, lat: null, lng: null, mapUrl: null });
    await expect(page.getByTestId('appt-place')).toHaveCount(0);
  });
});

test.describe('R13 .ics: ป้ายตามภาษาของผู้ดาวน์โหลด · URL = ลิงก์แผนที่ (มี) / ลิงก์นัด (ไม่มี)', () => {
  for (const locale of ['th', 'en'] as const) {
    test(`${locale}: DESCRIPTION มีป้ายสองบรรทัด + URL=mapUrl · ไม่มีลิงก์แผนที่ = บรรทัดเดียวมีป้าย + URL=ลิงก์นัด`, async ({ newDevice, baseURL }) => {
      test.setTimeout(90_000);
      // บัญชีสมัครหลังตั้งคุกกี้ภาษา → user.locale = locale (ป้ายใน .ics ตามภาษาบัญชี)
      const { gid, members } = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann'] });
      const a = members[0]!;
      const mapLabel = msg(locale, 'appointments.calendar.labelMap');
      const planLabel = msg(locale, 'appointments.calendar.labelPlan');
      const withMap = await createApptApi(a.context.request, gid, { title: 'R13 ics แผนที่', ...slot(daysAhead(5)), placeName: NAME, mapUrl: OSM_LINK });
      const noMap = await createApptApi(a.context.request, gid, { title: 'R13 ics ไม่มีแผนที่', ...slot(daysAhead(6)), placeName: NAME });
      const ics = async (id: string): Promise<string[]> => {
        const res = await a.context.request.get(`/api/appointments/${id}/calendar.ics`);
        expect(res.status()).toBe(200);
        return (await res.text()).replace(/\r\n /g, '').split('\r\n');
      };
      const line = (rows: string[], p: string) => rows.find((l) => l.startsWith(p))!;

      const m = await ics(withMap);
      expect(line(m, 'URL:')).toBe(`URL:${OSM_LINK}`);
      // ในไฟล์ .ics ขึ้นบรรทัดใหม่ใน DESCRIPTION เป็นตัวอักษร "\n" (backslash + n) ตาม RFC 5545
      expect(line(m, 'DESCRIPTION:')).toBe(`DESCRIPTION:${mapLabel}: ${OSM_LINK}\\n${planLabel}: ${new URL(baseURL!).origin}/appointments/${withMap}`);
      expect(line(m, 'LOCATION:')).toBe(`LOCATION:${NAME}`);

      const n = await ics(noMap);
      const planUrl = `${new URL(baseURL!).origin}/appointments/${noMap}`;
      expect(line(n, 'URL:')).toBe(`URL:${planUrl}`);
      expect(line(n, 'DESCRIPTION:')).toBe(`DESCRIPTION:${planLabel}: ${planUrl}`);
    });
  }
});
