// R4B-9 — เลย์เอาต์มือถือ/แท็บเล็ต: 375/390/768 × (th·สว่าง | en·มืด) · หน้าหลัก (การ์ด+หลายนัด/ว่าง/ไม่มีกลุ่ม) · ฟอร์มนัด (เตือนทับ/วางลิงก์/ชิป)
//   · รายละเอียด (ปกติ/ชื่อ+สถานที่ยาว/ยกเลิก/แผนที่โหลดไม่ได้) · รายการนัด · แจ้งเตือน
// ทุกหน้า: ไม่มี horizontal scroll · a/button/input ≥ 44×44 · ไม่มี console error · ปี พ.ศ. ในภาษาไทย · ชื่อ 40 ตัวไม่เว้นวรรค/ชื่อนัด 80/สถานที่ 120 ไม่ล้นจอ
import { expect, test, signupViaApi, uniqueUsername } from './support/auth';
import { buddhistYear, createBusyApi } from './support/busy';
import { watchConsole } from './support/fixtures';
import { checkLayout, go, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';
import { setPrefs } from './support/fixtures';
import { bellBadge, call, cancelApptApi, createApptApi, daysAhead, isHydration, makeScene, pickFormDate, stubTiles } from './support/appt';

const COMBOS: { locale: Locale; theme: Theme }[] = [
  { locale: 'th', theme: 'light' },
  { locale: 'en', theme: 'dark' },
];

const LONG_NAME = 'Abcdefghijklmnopqrstuvwxyz0123456789ABCD'; // 40 ตัว ไม่เว้นวรรค
const LONG_GROUP = `LongGroup${'x'.repeat(31)}`; // 40 ตัว
const LONG_TITLE = `LongTitle${'x'.repeat(71)}`; // 80 ตัว
const LONG_PLACE = `LongPlace${'y'.repeat(111)}`; // 120 ตัว
const slot = (d: string, s = '10:00', e = '11:00') => ({ startDate: d, startTime: s, endDate: d, endTime: e });

for (const { locale, theme } of COMBOS) {
  test(`${locale}/${theme}: หน้านัด/หน้าหลัก/แจ้งเตือน — ไม่ล้นจอ ปุ่ม ≥44px ไม่มี console error`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(200_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale, theme, labels: ['Ann', 'Ben'], displayNames: [LONG_NAME, undefined], groupName: LONG_GROUP });
    const [a, b] = scene.members as [typeof scene.members[0], typeof scene.members[0]];
    const gid = scene.gid;
    const problems = watchConsole(b.page);
    const check = (label: string) => checkLayout(b.page, testInfo, label, locale, theme);

    // ───── ข้อมูล ─────
    const D = daysAhead(20);
    await createBusyApi(a.context.request, { kind: 'timed', startDate: D, startTime: '10:00', endDate: D, endTime: '11:00', title: 'ซ้อมดนตรี' });
    const d3 = daysAhead(3);
    const nextId = await createApptApi(a.context.request, gid, { title: 'หมูกระทะวันเกิดต้นข้าว', ...slot(d3, '18:00', '21:00'), placeName: 'ป้าแดงหมูกระทะ ลาดพร้าว 71', lat: 13.8, lng: 100.6, description: 'เอาของขวัญมาด้วยนะ\nมีที่จอดรถ' });
    const longId = await createApptApi(a.context.request, gid, { title: LONG_TITLE, ...slot(daysAhead(5), '09:00', '12:30'), placeName: LONG_PLACE, lat: 13.75, lng: 100.5, description: 'ข'.repeat(300) });
    const linkId = await createApptApi(a.context.request, gid, { title: 'นัดที่มีแต่ลิงก์', ...slot(daysAhead(6)), mapUrl: 'https://maps.app.goo.gl/abc123' });
    await createApptApi(a.context.request, gid, { title: 'นัดข้ามคืน', startDate: daysAhead(7), startTime: '22:00', endDate: daysAhead(8), endTime: '02:00' });
    for (let i = 0; i < 6; i++) await createApptApi(a.context.request, gid, { title: `นัดที่ ${i + 1}`, ...slot(daysAhead(9 + i)) });
    // นัดที่ยกเลิกสร้าง/ยกเลิกโดย B (ชื่อสั้น) — กรณีชื่อผู้ยกเลิก 40 ตัวไม่เว้นวรรคแยกไว้ที่เทสต์ "แบนเนอร์ยกเลิก" ด้านล่าง
    const cancelId = await createApptApi(b.context.request, gid, { title: 'นัดที่ยกเลิก', ...slot(daysAhead(4)) });
    await cancelApptApi(b.context.request, cancelId);
    expect((await call(b.context.request, 'PUT', `/api/appointments/${nextId}/rsvp`, { response: 'going' })).status).toBe(200);
    expect((await call(a.context.request, 'PUT', `/api/appointments/${nextId}/rsvp`, { response: 'not_going' })).status).toBe(200); // R6A B1
    const year = locale === 'th' ? buddhistYear(d3.slice(0, 7)) : Number(d3.slice(0, 4));

    // ───── หน้าหลัก: การ์ดนัดถัดไป + นัดถัดๆ ไปหลายรายการ (+ ป้ายกระดิ่ง "9+") ─────
    await go(b.page, '/');
    await expect(b.page.getByTestId('home-next-card')).toContainText(String(year));
    await expect(b.page.getByTestId('home-row').first()).toBeVisible();
    expect(await b.page.getByTestId('home-row').count()).toBeGreaterThanOrEqual(5);
    // R6A B1: A ตอบไม่ไป → การ์ดของ B แสดง "ไม่ไป 1" · ไม่มีใครอาจไป → ไม่แสดง
    await expect(b.page.getByTestId('home-count-going')).toHaveText(T('appointments.rsvp.summary.going', { count: 1 }));
    await expect(b.page.getByTestId('home-count-not_going')).toHaveText(T('appointments.rsvp.summary.notGoing', { count: 1 }));
    await expect(b.page.getByTestId('home-count-maybe')).toHaveCount(0);
    // R6A F4: แถวชื่อ 80 ตัว (อีก 5 วัน) — ป้ายนับถอยหลังเห็นเต็ม ไม่ถูกตัด · aria ของแถวมีนับถอยหลังด้วย
    const longRow = b.page.locator(`[data-testid="home-row"][data-appt-id="${longId}"]`);
    const longCd = longRow.getByTestId('home-row-countdown');
    await expect(longCd).toHaveText(`· ${T('home.countdown.aria', { days: 5 })}`);
    await expect(longRow).toHaveAttribute('aria-label', new RegExp(T('home.countdown.aria', { days: 5 })));
    const fits = await longCd.evaluate((el) => {
      const row = el.closest('[data-testid="home-row"]')!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return el.scrollWidth <= el.clientWidth && r.right <= row.right && r.width > 0;
    });
    expect(fits, 'ป้ายนับถอยหลังอยู่ในแถวเต็ม ๆ').toBe(true);
    await expect(bellBadge(b.page)).toHaveText('9+');
    await check('home-many');

    // ───── รายการนัดของกลุ่ม (มีนัดยกเลิก + ชื่อยาว) ─────
    await go(b.page, `/groups/${gid}/appointments`);
    await expect(b.page.getByTestId('appt-row').filter({ has: b.page.getByTestId('appt-row-cancelled') })).toHaveCount(1);
    await check('list');
    await b.page.getByTestId('appt-tab-past').click();
    await expect(b.page.getByTestId('appt-list-empty')).toBeVisible();
    await check('list-past-empty');

    // ───── ฟอร์มสร้างนัด: เตือนนัดทับ (ชื่อ 40 ตัว) → แผงวางลิงก์ → ชิปสถานที่ ─────
    await b.page.getByTestId('appt-tab-upcoming').click();
    await b.page.getByTestId('appt-list-create').click();
    await expect(b.page.getByTestId('appt-form')).toBeVisible();
    await b.page.getByTestId('appt-title').fill(LONG_TITLE);
    await pickFormDate(b.page, D, locale);
    await b.page.getByTestId('appt-start-time').selectOption('10:00');
    await b.page.getByTestId('appt-end-time').selectOption('11:00');
    await expect(b.page.getByTestId('appt-overlap')).toHaveAttribute('data-state', 'warn');
    await expect(b.page.getByTestId('appt-overlap-person')).toContainText(LONG_NAME);
    await b.page.getByTestId('place-query').fill(LONG_PLACE);
    await b.page.getByTestId('place-paste-toggle').click();
    await check('form-warn-paste');
    await b.page.getByTestId('place-paste-input').fill('13.7563, 100.5018');
    await b.page.getByTestId('place-paste-submit').click();
    await expect(b.page.getByTestId('place-chip')).toBeVisible();
    await check('form-chip');
    await b.page.getByTestId('appt-form-cancel').click();
    await expect(b.page.getByTestId('appt-form')).toHaveCount(0);

    // ───── รายละเอียด: ปกติ · ชื่อ/สถานที่ยาว · มีแต่ลิงก์ · ยกเลิก ─────
    await go(b.page, `/appointments/${nextId}`);
    await expect(b.page.getByTestId('appt-band')).toContainText(String(year));
    await expect(b.page.getByTestId('place-map')).toBeVisible();
    await check('detail');
    await go(b.page, `/appointments/${longId}`);
    await expect(b.page.getByTestId('appt-detail-title')).toHaveText(LONG_TITLE);
    await check('detail-long');
    await go(b.page, `/appointments/${linkId}`);
    await expect(b.page.getByTestId('place-map')).toHaveCount(0);
    await expect(b.page.getByTestId('place-open')).toBeVisible();
    await check('detail-linkonly');
    await go(b.page, `/appointments/${cancelId}`);
    await expect(b.page.getByTestId('appt-cancelled-banner')).toBeVisible();
    await check('detail-cancelled');

    // ───── แจ้งเตือน (10 รายการยังไม่อ่าน) → อ่านทั้งหมด ─────
    await go(b.page, '/notifications');
    expect(await b.page.getByTestId('notif-row').count()).toBeGreaterThanOrEqual(9);
    await check('notifications');
    await b.page.getByTestId('notif-mark-all').click();
    await expect(b.page.getByTestId('notif-mark-all')).toHaveCount(0);
    await check('notifications-read');

    // ───── หน้าหลักของคนที่ไม่มีนัด (มีกลุ่ม) / ไม่มีกลุ่ม ─────
    const solo = await makeScene(newDevice, baseURL!, { locale, theme, labels: ['Solo'] });
    const sp = solo.members[0]!.page;
    const soloProblems = watchConsole(sp);
    await go(sp, '/');
    await expect(sp.getByTestId('home-empty')).toBeVisible();
    await checkLayout(sp, testInfo, 'home-empty', locale, theme);
    const nog = await newDevice();
    await setPrefs(nog.context, baseURL!, { locale, theme });
    await stubTiles(nog.context);
    await signupViaApi(nog.context.request, { username: uniqueUsername('nog') });
    const nogProblems = watchConsole(nog.page);
    await go(nog.page, '/');
    await expect(nog.page.getByTestId('home-nogroup')).toBeVisible();
    await checkLayout(nog.page, testInfo, 'home-nogroup', locale, theme);

    // hydration error (ICU Node vs Chromium) รายงานเป็นบั๊กแยกที่เทสต์ "hydration" ใน appt-validation.spec.ts — ที่นี่ไม่ให้บังสัญญาณเลย์เอาต์
    for (const p of [...problems, ...soloProblems, ...nogProblems].filter(isHydration)) testInfo.annotations.push({ type: 'hydration', description: p.text.slice(0, 80) });
    expect([...problems, ...soloProblems, ...nogProblems].filter((p) => !isHydration(p)), 'console error').toEqual([]);
    void T;
  });
}

test('แผนที่โหลดไม่ได้ (tile ล้ม): หน้ารายละเอียดยังใช้งานได้ มีข้อความและปุ่มเปิดแอปแผนที่ · ไม่ล้นจอ', async ({ newDevice, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const locale = 'th' as const;
  const scene = await makeScene(newDevice, baseURL!, { locale, theme: 'light', labels: ['Ann', 'Ben'] });
  const [a, b] = scene.members as [typeof scene.members[0], typeof scene.members[0]];
  const id = await createApptApi(a.context.request, scene.gid, { title: 'แผนที่ล้ม', ...slot(daysAhead(4)), placeName: 'ร้านทดสอบ', lat: 13.75, lng: 100.5 });
  await b.context.unrouteAll();
  await stubTiles(b.context, { fail: true });
  const problems = watchConsole(b.page, (m) => /ERR_FAILED|Failed to load resource/.test(m.text)); // tile ที่ถูกดักให้ล้ม = ที่คาดไว้
  await go(b.page, `/appointments/${id}`);
  await expect(b.page.getByTestId('place-map')).toHaveAttribute('data-status', 'failed', { timeout: 15_000 });
  await expect(b.page.getByTestId('place-map-failed')).toContainText(msg(locale, 'places.map.failed.title'));
  await expect(b.page.getByTestId('place-open')).toBeVisible();
  await expect(b.page.getByTestId('place-open')).toHaveAttribute('href', /^geo:13\.75,100\.5/); // พิกัดอย่างเดียว = geo: เปิดแอปแผนที่ของเครื่อง (ไม่ใช่ลิงก์เว็บ)
  await checkLayout(b.page, testInfo, 'detail-map-failed', locale, 'light');
  await expect(b.page.getByTestId('appt-rsvp-going')).toBeEnabled(); // ส่วนอื่นยังใช้งานได้
  await b.page.getByTestId('appt-rsvp-going').click();
  await expect(b.page.getByTestId('appt-rsvp-going')).toHaveAttribute('aria-pressed', 'true');
  expect(problems.filter((p) => !isHydration(p))).toEqual([]);
});

test('แบนเนอร์ยกเลิก: ชื่อผู้ยกเลิก 40 ตัวไม่เว้นวรรค ต้องไม่ล้นจอ', async ({ newDevice, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const locale = 'th' as const;
  const scene = await makeScene(newDevice, baseURL!, { locale, theme: 'light', labels: ['Ann', 'Ben'], displayNames: [LONG_NAME, undefined] });
  const [a, b] = scene.members as [typeof scene.members[0], typeof scene.members[0]];
  const id = await createApptApi(a.context.request, scene.gid, { title: 'ยกเลิกโดยชื่อยาว', ...slot(daysAhead(4)) });
  await cancelApptApi(a.context.request, id);
  await go(b.page, `/appointments/${id}`);
  await expect(b.page.getByTestId('appt-cancelled-banner')).toContainText(LONG_NAME);
  await checkLayout(b.page, testInfo, 'detail-cancelled-longname', locale, 'light');
});
