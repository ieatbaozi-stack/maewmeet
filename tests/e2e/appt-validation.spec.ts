// R4B-1/5/6/9 — ตรวจรับข้อมูล (API + UI) · เพดาน 100 นัด · a11y smoke · hydration · mobile-390 ตัวเดียว (th)
//
//  - เวลาเริ่มย้อนหลัง · ลิงก์ javascript:/http:/data: · ชื่อ >80 · พิกัดไม่คู่ · mass assignment · เกินเพดานต่อกลุ่ม (seed ด้วย SQL) · ยกเลิกคืนโควตา
//  - Nominatim: เซิร์ฟเวอร์ E2E ปิดค้นหา (PLACE_SEARCH_ENABLED=false) → ทดสอบ "ปิดชั่วคราว" + วางลิงก์/พิกัด เท่านั้น
import { expect, test } from './support/auth';
import { watchConsole } from './support/fixtures';
import { go } from './support/groups';
import { msg } from './support/messages';
import { addDays, todayBkk } from './support/busy';
import { apptIdFromUrl, bangkokHour, bell, bellBadge, call, countActiveAppointments, createApptApi, daysAhead, isHydration, makeScene, pickFormDate, seedActiveAppointments, type ApptApi } from './support/appt';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'รันที่ mobile-390 ตัวเดียว');
});

const locale = 'th' as const;
const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
const slot = (d: string, s = '10:00', e = '11:00') => ({ startDate: d, startTime: s, endDate: d, endTime: e });

test('API: ตรวจรับข้อมูลนัด (ย้อนหลัง · ลิงก์อันตราย · ชื่อยาว · พิกัด · mass assignment)', async ({ newDevice, baseURL }) => {
  const { gid, members } = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann', 'Ben'] });
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const post = (body: Record<string, unknown>) => call<{ appointment: ApptApi }>(a.context.request, 'POST', `/api/groups/${gid}/appointments`, { title: 'ok', ...slot(daysAhead(10)), ...body });
  const bad = async (label: string, body: Record<string, unknown>, code?: string) => {
    const r = await post(body);
    expect(r.status, `${label}: ${r.text}`).toBe(400);
    if (code) expect(r.json?.error?.code, `${label}: ${r.text}`).toBe(code);
    return r;
  };

  const past = await bad('เมื่อวาน', slot(addDays(todayBkk(), -1)), 'VALIDATION');
  expect(past.text).toContain('IN_PAST');
  for (const u of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://maps.example.com/@13.7,100.5,15z', 'ftp://x.example.com/a', 'https://']) {
    await bad(`mapUrl ${u}`, { mapUrl: u }, 'INVALID_MAP_URL');
  }
  await bad('lat เดี่ยว', { lat: 13.7 });
  await bad('lng เดี่ยว', { lng: 100.5 });
  await bad('lat เกินช่วง', { lat: 91, lng: 100 });
  await bad('ชื่อว่าง', { title: '   ' });
  await bad('ชื่อ 81 ตัว', { title: 'ก'.repeat(81) });
  await bad('คำอธิบาย 1001 ตัว', { description: 'x'.repeat(1001) });
  await bad('เวลาไม่ตรงขั้น 30 นาที', slot(daysAhead(10), '10:15', '11:00'));
  await bad('เริ่ม=จบ', slot(daysAhead(10), '10:00', '10:00'));
  const span = await post({ startDate: daysAhead(10), startTime: '10:00', endDate: daysAhead(80), endTime: '10:00' });
  expect(span.status, span.text).toBeGreaterThanOrEqual(400);
  for (const extra of [{ groupId: 'x' }, { createdBy: b.userId }, { status: 'cancelled' }, { tz: 'UTC' }, { id: 'x' }]) {
    const r = await post(extra);
    expect(r.status, `mass assignment ${JSON.stringify(extra)}: ${r.text}`).toBe(400);
  }
  const okId = await createApptApi(a.context.request, gid, { title: 'ข'.repeat(80), ...slot(daysAhead(10)), placeName: 'ร้าน', lat: 13.7563, lng: 100.5018, mapUrl: 'https://maps.app.goo.gl/abc123' });
  const got = await call<{ appointment: { createdBy: { userId: string }; title: string; mapUrl: string } }>(b.context.request, 'GET', `/api/appointments/${okId}`);
  expect(got.status).toBe(200);
  expect(got.json?.data?.appointment.createdBy.userId).toBe(a.userId);
  expect([...got.json!.data!.appointment.title]).toHaveLength(80);
  expect(got.json?.data?.appointment.mapUrl).toMatch(/^https:\/\//);
  if (bangkokHour() >= 3) {
    const r = await post(slot(todayBkk(), '00:00', '00:30'));
    expect(r.status, 'ย้อนหลังเกิน 1 ชม. (00:00 วันนี้) ต้องถูกปฏิเสธ').toBe(400);
  }
});

test('UI: ฟอร์มนัด — ชื่อตัดที่ 80 · ลิงก์ javascript:/http: ถูกปฏิเสธในแผงวาง · พิกัดผิด · ลิงก์ https เก็บได้ · เริ่มย้อนหลัง', async ({ newDevice, baseURL }) => {
  test.setTimeout(120_000);
  const { gid, members } = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann', 'Ben'] });
  const a = members[0]!;
  const problems = watchConsole(a.page, (m) => (/status of (4\d\d)/.test(m.text) && /\/api\//.test(m.url ?? '')) || (/status of 503/.test(m.text) && /\/api\/places\/search/.test(m.url ?? '')));
  await go(a.page, `/groups/${gid}/appointments`);
  await a.page.getByTestId('appt-list-create').click();
  const form = a.page.getByTestId('appt-form');
  await expect(form).toBeVisible();

  await a.page.getByTestId('appt-title').fill('ก'.repeat(100));
  expect([...(await a.page.getByTestId('appt-title').inputValue())]).toHaveLength(80);
  await expect(form).toContainText('80/80');

  await a.page.getByTestId('place-paste-toggle').click();
  const input = a.page.getByTestId('place-paste-input');
  for (const u of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'http://www.google.com/maps/@13.7,100.5,15z', 'ไม่ใช่ลิงก์']) {
    await input.fill(u);
    await a.page.getByTestId('place-paste-submit').click();
    await expect(a.page.getByTestId('place-paste-error'), u).toContainText(T('errors.INVALID_MAP_URL'));
    await expect(a.page.getByTestId('place-chip')).toHaveCount(0);
  }
  await input.fill('999, 999');
  await a.page.getByTestId('place-paste-submit').click();
  await expect(a.page.getByTestId('place-paste-error')).toContainText(T('errors.INVALID_COORDINATES'));
  await input.fill('https://maps.app.goo.gl/abc123');
  await expect(a.page.getByTestId('place-paste-error')).toHaveCount(0);
  await a.page.getByTestId('place-paste-submit').click();
  await expect(a.page.getByTestId('place-chip')).toBeVisible();
  await expect(a.page.getByTestId('place-chip-sub')).toContainText('maps.app.goo.gl');
  await a.page.getByTestId('place-clear').click();
  await expect(a.page.getByTestId('place-chip')).toHaveCount(0);

  await a.page.getByTestId('place-query').fill('ก');
  await a.page.getByTestId('place-search').click();
  await expect(a.page.getByTestId('place-too-short')).toBeVisible();

  await a.page.getByTestId('appt-title').fill('');
  await a.page.getByTestId('appt-submit').click();
  await expect(a.page.getByTestId('appt-title-error')).toBeVisible();
  await expect(a.page.getByTestId('appt-date-error')).toBeVisible();
  await expect(form).toBeVisible();

  if (bangkokHour() >= 3) {
    await a.page.getByTestId('appt-title').fill('ย้อนหลัง');
    await pickFormDate(a.page, todayBkk(), locale);
    await a.page.getByTestId('appt-start-time').selectOption('00:00');
    await a.page.getByTestId('appt-end-time').selectOption('00:30');
    await a.page.getByTestId('appt-submit').click();
    await expect(form.locator('[role="alert"]').filter({ hasText: T('appointments.form.error.start.past', { hours: 1 }) })).toBeVisible();
    expect(await countActiveAppointments(gid)).toBe(0);
  }
  expect(problems.filter((p) => !isHydration(p))).toEqual([]);
});

test('เพดาน 100 นัดต่อกลุ่ม: เตือนใกล้เต็ม · เต็มแล้วสร้างไม่ได้ (UI+API) · ยกเลิกคืนโควตา', async ({ newDevice, baseURL }) => {
  test.setTimeout(180_000);
  const { gid, members } = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann', 'Ben'] });
  const [a, b] = members as [typeof members[0], typeof members[0]];
  await seedActiveAppointments(gid, a.userId, 100);
  expect(await countActiveAppointments(gid)).toBe(100);

  await go(b.page, `/groups/${gid}/appointments`);
  for (let i = 0; i < 6 && (await b.page.getByTestId('appt-load-more').count()) > 0; i++) {
    const before = await b.page.getByTestId('appt-row').count();
    await b.page.getByTestId('appt-load-more').click();
    await expect.poll(() => b.page.getByTestId('appt-row').count()).toBeGreaterThan(before);
  }
  await expect(b.page.getByTestId('appt-load-more')).toHaveCount(0);
  await expect(b.page.getByTestId('appt-row')).toHaveCount(100);
  await expect(b.page.getByTestId('appt-list-count')).toContainText(T('appointments.list.count', { count: 100 }));
  await expect(b.page.getByTestId('appt-list-limit-near')).toContainText(T('appointments.list.limitNear', { count: 100, max: 100 }));

  const full = await call(a.context.request, 'POST', `/api/groups/${gid}/appointments`, { title: 'ที่ 101', ...slot(daysAhead(5)) });
  expect(full.status, full.text).toBeGreaterThanOrEqual(400);
  expect(full.json?.error?.code).toBe('LIMIT_REACHED');

  await go(a.page, `/groups/${gid}/appointments`);
  await a.page.getByTestId('appt-list-create').click();
  await a.page.getByTestId('appt-title').fill('ที่ 101');
  await pickFormDate(a.page, daysAhead(5), locale);
  await a.page.getByTestId('appt-submit').click();
  await expect(a.page.getByTestId('appt-form-error')).toContainText(T('errors.LIMIT_REACHED', { limit: 'appointments', max: 100 }));
  await expect(a.page.getByTestId('appt-form')).toBeVisible();

  const list = await call<{ appointments: ApptApi[] }>(a.context.request, 'GET', `/api/groups/${gid}/appointments?scope=upcoming&limit=1`);
  const first = list.json!.data!.appointments[0]!.id;
  expect((await call(a.context.request, 'POST', `/api/appointments/${first}/cancel`, {})).status).toBe(200);
  await a.page.getByTestId('appt-submit').click();
  await a.page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
  expect(apptIdFromUrl(a.page)).toBeTruthy();
  expect(await countActiveAppointments(gid)).toBe(100);
});

test('a11y smoke: RSVP แสดงสถานะที่เลือกเป็นข้อความ/aria · กระดิ่งมีชื่อและจำนวน · โฟกัสกลับหลังปิด sheet', async ({ newDevice, baseURL }) => {
  test.setTimeout(120_000);
  const { gid, members } = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann', 'Ben'] });
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const id = await createApptApi(a.context.request, gid, { title: 'a11y นัด', ...slot(daysAhead(12)) });

  await go(b.page, `/appointments/${id}`);
  const group = b.page.getByRole('group', { name: T('appointments.rsvp.question') });
  await expect(group.getByRole('button')).toHaveCount(3);
  for (const ans of ['going', 'maybe', 'not_going'] as const) {
    const btn = b.page.getByTestId(`appt-rsvp-${ans}`);
    await expect(btn).toHaveAccessibleName(T(`appointments.rsvp.answer.${ans}`));
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  }
  await b.page.getByTestId('appt-rsvp-maybe').click();
  const pressed = b.page.locator('[data-testid^="appt-rsvp-"][aria-pressed="true"]');
  await expect(pressed).toHaveCount(1);
  await expect(pressed).toHaveAttribute('data-answer', 'maybe');
  await expect(b.page.getByTestId('appt-rsvp-saved')).toBeVisible();
  await b.page.getByTestId('appt-rsvp-not_going').click();
  await expect(pressed).toHaveCount(1);
  await expect(pressed).toHaveAttribute('data-answer', 'not_going');

  await go(b.page, '/');
  const bellLink = b.page.getByRole('link', { name: T('notifications.bell.aria', { count: 1 }) });
  await expect(bellLink).toBeVisible();
  await expect(bellLink).toHaveAttribute('href', '/notifications');
  await expect(bellBadge(b.page)).toHaveAttribute('aria-hidden', 'true');
  await go(a.page, '/');
  await expect(bell(a.page)).toHaveAttribute('aria-label', T('notifications.bell.aria', { count: 0 }));

  await go(a.page, `/groups/${gid}/appointments`);
  const opener = a.page.getByTestId('appt-list-create');
  await opener.click();
  const dlg = a.page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await expect(a.page.getByTestId('appt-title')).toBeFocused();
  await a.page.getByTestId('appt-form-cancel').click();
  await expect(dlg).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dlg).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(opener).toBeFocused();

  await go(a.page, `/appointments/${id}`);
  await a.page.getByTestId('appt-edit').click();
  await expect(a.page.getByRole('dialog')).toBeVisible();
  await a.page.getByTestId('appt-form-cancel').click();
  await expect(a.page.getByTestId('appt-edit')).toBeFocused();
  const cancelBtn = a.page.getByTestId('appt-cancel');
  await cancelBtn.click();
  await expect(a.page.getByRole('alertdialog')).toBeVisible();
  await expect(a.page.getByTestId('appt-cancel-keep')).toBeFocused();
  await a.page.getByTestId('appt-cancel-keep').click();
  await expect(a.page.getByRole('alertdialog')).toHaveCount(0);
  await expect(cancelBtn).toBeFocused();
});

test('hydration: หน้าหลัก/รายละเอียด/รายการนัด/แจ้งเตือน ต้องไม่มี React hydration error (#418)', async ({ newDevice, baseURL }) => {
  test.setTimeout(120_000);
  const { gid, members } = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann', 'Ben'] });
  const [a, b] = members as [typeof members[0], typeof members[0]];
  const id = await createApptApi(a.context.request, gid, { title: 'hydration นัด', ...slot(daysAhead(9)), placeName: 'ร้าน', lat: 13.75, lng: 100.5 });
  await createApptApi(a.context.request, gid, { title: 'นัดข้ามคืน', startDate: daysAhead(10), startTime: '22:00', endDate: daysAhead(11), endTime: '02:00' });
  const cancelled = await createApptApi(a.context.request, gid, { title: 'นัดที่ยกเลิก', ...slot(daysAhead(11)) });
  await call(a.context.request, 'POST', `/api/appointments/${cancelled}/cancel`, {});
  const problems = watchConsole(b.page);
  const seen: string[] = [];
  for (const [name, path] of [
    ['home', '/'],
    ['detail', `/appointments/${id}`],
    ['group list', `/groups/${gid}/appointments`],
    ['notifications', '/notifications'],
  ] as const) {
    const from = problems.length;
    await go(b.page, path);
    await b.page.waitForTimeout(300);
    for (const p of problems.slice(from).filter(isHydration)) seen.push(`${name} (${path}): ${p.text.slice(0, 60)}`);
  }
  expect(seen, 'hydration error ตามหน้า').toEqual([]);
});
