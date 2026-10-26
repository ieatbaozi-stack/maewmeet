// R4B-11 — เรื่องเล่า "สร้างนัดจากวันว่างตรงกัน → แจ้งเตือน → RSVP → หน้าหลัก → ยกเลิก → ออกกลุ่ม" · mobile-390 ตัวเดียว (th)
//
//  A (admin) B C ในกลุ่ม · วัน X = จันทร์ในอนาคต (สัมพัทธ์กับวันนี้)
//  B ลงช่วงติด 10–11 แบบซ่อน (title+note canary) → ช่วงว่างร่วม 08–10 · 11–22
//  A: ว่างตรงกัน → วัน X → แตะช่วง 08–10 (เติมฟอร์มให้) → ขยับเวลาจบ 10:30 → คำเตือนนัดทับระบุ B ("ไม่ว่าง") → ใส่สถานที่ด้วยพิกัดที่วาง → สร้าง
//  B, C ได้แจ้งเตือนคนละ 1 (A ไม่ได้) → B ตอบไป / C อาจไป → นับอัปเดต → หน้าหลัก B มีการ์ด "อีก N วัน" + จำนวนคนไป
//  A แก้ชื่อ → A ยกเลิก → B เห็นแบนเนอร์ยกเลิก · หน้าหลักไม่ใช่ "นัดถัดไป" · รายการกลุ่มขีดฆ่า · RSVP ปิด → C ออกกลุ่ม → C ไม่เห็นนัด (404) ไม่เห็นแจ้งเตือน
import { expect, test } from './support/auth';
import { canary, createBusyApi, recordResponses, todayBkk, buddhistYear } from './support/busy';
import { pageDump } from './support/calendar-ui';
import { watchConsole } from './support/fixtures';
import { go } from './support/groups';
import { msg } from './support/messages';
import { freeCreate, mondayAhead, openFree, pickDay } from './support/free-ui';
import { isHydration, apptIdFromUrl, bell, bellBadge, call, daysBetween, makeScene, type ApptApi } from './support/appt';
import { signupViaApi, uniqueUsername } from './support/auth';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องเล่าเต็มรันที่ mobile-390 ตัวเดียว');
});

const locale = 'th' as const;
const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);

test('th: A สร้างนัดจากวันว่างร่วม → B,C ได้แจ้งเตือน → RSVP → หน้าหลัก → แก้/ยกเลิก → C ออกกลุ่ม', async ({ newDevice, baseURL }) => {
  test.setTimeout(240_000);
  const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann', 'Ben', 'Cat'] });
  const [a, b, c] = scene.members as [typeof scene.members[0], typeof scene.members[0], typeof scene.members[0]];
  const gid = scene.gid;
  const problems = [a, b, c].map((x) =>
    watchConsole(x.page, (m) => (/status of (4\d\d)/.test(m.text) && (/\/api\//.test(m.url ?? '') || /\/appointments\//.test(m.url ?? ''))) || (/status of 503/.test(m.text) && /\/api\/places\/search/.test(m.url ?? ''))), // 503 = ค้นหาสถานที่ปิดอยู่ (คาดไว้)
  );

  const errUrls: string[] = [];
  for (const [i, x] of [a, b, c].entries()) x.page.on('pageerror', (e) => errUrls.push(`${i}:${x.page.url()} ${e.message.slice(0, 40)}`));
  const X = mondayAhead(14);
  const [CN, CT] = [canary('note'), canary('title')];
  await createBusyApi(b.context.request, { kind: 'timed', startDate: X, startTime: '10:00', endDate: X, endTime: '11:00', title: CT, note: CN, hideDetail: true });

  // ───── 1) A: ว่างตรงกัน → วัน X → ช่วง 08–10 → ฟอร์มเติมให้ ─────
  const seenA = recordResponses(a.page);
  await openFree(a.page, { gid, date: X });
  await pickDay(a.page, X);
  await expect(freeCreate(a.page)).toBeVisible();
  await a.page.getByTestId('free-segment').first().click();
  await expect(a.page.getByTestId('appt-form')).toBeVisible();
  await expect(a.page.getByTestId('appt-prefilled')).toBeVisible();
  await expect(a.page.getByTestId('appt-start-time')).toHaveValue('08:00');
  await expect(a.page.getByTestId('appt-end-time')).toHaveValue('10:00');
  await expect(a.page.getByTestId('appt-notify-line')).toContainText(T('appointments.form.notifyLine', { count: 2 }));

  // ช่วง 08–10 ไม่ทับ B → ขยับเวลาจบเป็น 10:30 → ทับ B (ซ่อนรายการ = "ไม่ว่าง")
  await expect(a.page.getByTestId('appt-overlap')).toHaveAttribute('data-state', 'clear');
  await a.page.getByTestId('appt-end-time').selectOption('10:30');
  const ov = a.page.getByTestId('appt-overlap');
  await expect(ov).toHaveAttribute('data-state', 'warn');
  await expect(a.page.getByTestId('appt-overlap-person')).toHaveCount(1);
  await expect(a.page.getByTestId('appt-overlap-person')).toContainText(b.p.displayName);
  await expect(a.page.getByTestId('appt-overlap-person')).toContainText(T('calendar.day.busyPlain'));
  await expect(ov).not.toContainText(c.p.displayName);
  await expect(ov).not.toContainText(CT);
  await expect(ov).not.toContainText(CN);
  await expect(a.page.getByTestId('appt-submit')).toBeEnabled(); // ไม่บล็อก

  // ───── 2) ชื่อ + สถานที่: ค้นหาปิดอยู่ → วางพิกัด ─────
  const title = `หมูกระทะ ${Math.random().toString(16).slice(2, 7)}`;
  await a.page.getByTestId('appt-title').fill(title);
  await a.page.getByTestId('place-query').fill('ร้านหมูกระทะป้าแดง');
  await a.page.getByTestId('place-search').click();
  await expect(a.page.getByTestId('place-disabled')).toContainText(T('places.search.disabled'));
  await expect(a.page.getByTestId('place-paste')).toBeVisible(); // เปิดแผงวางให้เอง
  await a.page.getByTestId('place-paste-input').fill('13.7563, 100.5018');
  await a.page.getByTestId('place-paste-submit').click();
  await expect(a.page.getByTestId('place-chip-name')).toContainText('ร้านหมูกระทะป้าแดง');
  await expect(a.page.getByTestId('place-chip-sub')).toContainText('13.7563');
  await a.page.getByTestId('appt-submit').click();
  await a.page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
  const id = apptIdFromUrl(a.page);

  // ───── 3) หน้ารายละเอียดของ A ─────
  await expect(a.page.getByTestId('appt-detail-title')).toHaveText(title);
  await expect(a.page.getByTestId('appt-place-name')).toContainText('ร้านหมูกระทะป้าแดง');
  await expect(a.page.getByTestId('place-map')).toBeVisible();
  await expect(a.page.getByTestId('appt-band')).toContainText(String(buddhistYear(X.slice(0, 7)))); // พ.ศ.
  await expect(a.page.getByTestId('appt-when')).toContainText('08:00');
  await expect(a.page.getByTestId('appt-edit')).toBeVisible();
  await expect(a.page.getByTestId('appt-cancel')).toBeVisible();
  const N = daysBetween(todayBkk(), X);
  await expect(a.page.getByLabel(T('home.countdown.aria', { days: N }))).toBeVisible(); // "อีก N วัน" (aria-label ของตัวนับ)
  await expect(a.page.getByTestId('appt-band')).toContainText(new RegExp(`${T('home.countdown.before', { days: N })}\\s*${N}\\s*${T('home.countdown.after', { days: N })}`));
  await seenA.settled();
  for (const s of [CN, CT]) {
    expect(await pageDump(a.page), `DOM ของ A ต้องไม่มี ${s}`).not.toContain(s);
    expect(seenA.texts.filter((t) => t.includes(s)).length, `response ของ A ต้องไม่มี ${s}`).toBe(0);
  }
  // A ไม่ได้แจ้งเตือนของนัดตัวเอง
  await go(a.page, '/');
  await expect(bell(a.page)).toHaveAttribute('aria-label', T('notifications.bell.aria', { count: 0 }));
  await expect(bellBadge(a.page)).toHaveCount(0);

  // ───── 4) B: กระดิ่ง 1 → รายการแจ้งเตือน → เปิดนัด ─────
  const seenB = recordResponses(b.page);
  await go(b.page, '/');
  await expect(bellBadge(b.page)).toHaveText('1');
  await expect(b.page.getByRole('link', { name: T('notifications.bell.aria', { count: 1 }) })).toBeVisible();
  await bell(b.page).click();
  await expect(b.page).toHaveURL(/\/notifications$/);
  await expect(b.page.getByTestId('notif-row')).toHaveCount(1);
  await expect(b.page.getByTestId('notif-row')).toHaveAttribute('data-unread', 'true');
  await expect(b.page.getByTestId('notif-row')).toContainText(title);
  await expect(b.page.getByTestId('notif-row')).toContainText(scene.groupName);
  await b.page.getByTestId('notif-row').click();
  await expect(b.page).toHaveURL(new RegExp(`/appointments/${id}$`));
  await expect(b.page.getByTestId('appt-detail-title')).toHaveText(title);
  // สมาชิกทั่วไป: ไม่มีปุ่มแก้/ยกเลิก
  await expect(b.page.getByTestId('appt-edit')).toHaveCount(0);
  await expect(b.page.getByTestId('appt-edit-top')).toHaveCount(0);
  await expect(b.page.getByTestId('appt-cancel')).toHaveCount(0);
  await expect(b.page.getByTestId('appt-no-permission')).toBeVisible();
  // B ตอบ "ไป"
  const goingBtn = b.page.getByTestId('appt-rsvp-going');
  await expect(goingBtn).toHaveAttribute('aria-pressed', 'false');
  await goingBtn.click();
  await expect(goingBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(b.page.getByTestId('appt-rsvp-maybe')).toHaveAttribute('aria-pressed', 'false');
  await expect(b.page.getByTestId('appt-rsvp-saved')).toContainText(T('appointments.rsvp.saved', { answer: '' }).trim().replace(/:$/, ''));
  await expect(b.page.getByTestId('appt-rsvp-counts')).toContainText(T('appointments.rsvp.summary.going', { count: 1 }));
  await seenB.settled();
  for (const s of [CN, CT]) expect(seenB.texts.filter((t) => t.includes(s)).length, `response ของ B ต้องไม่มี ${s} (ของตัวเองซ่อนจากผู้อื่น แต่ B เองก็ไม่ควรได้ใน response ของนัด)`).toBe(0);

  // ───── 5) C: กระดิ่ง 1 (เปิดนัดจาก URL ตรง ๆ คงแจ้งเตือนไว้ไม่อ่าน) → อาจไป ─────
  await go(c.page, '/');
  await expect(bellBadge(c.page)).toHaveText('1');
  await go(c.page, `/appointments/${id}`);
  await c.page.getByTestId('appt-rsvp-maybe').click();
  await expect(c.page.getByTestId('appt-rsvp-maybe')).toHaveAttribute('aria-pressed', 'true');
  await expect(c.page.getByTestId('appt-rsvp-saved')).toBeVisible();

  // ───── 6) A เห็นจำนวนอัปเดต · B หน้าหลักมีการ์ดนัดถัดไป ─────
  await go(a.page, `/appointments/${id}`);
  const counts = a.page.getByTestId('appt-rsvp-counts');
  await expect(counts).toContainText(T('appointments.rsvp.summary.going', { count: 1 }));
  await expect(counts).toContainText(T('appointments.rsvp.summary.maybe', { count: 1 }));
  await expect(counts).toContainText(T('appointments.rsvp.summary.noReply', { count: 1 }));
  await go(b.page, '/');
  const card = b.page.getByTestId('home-next-card');
  await expect(card).toContainText(title);
  await expect(card).toContainText(scene.groupName);
  await expect(b.page.getByTestId('home-countdown')).toContainText(T('home.countdown.aria', { days: N }));
  await expect(b.page.getByTestId('home-countdown')).toContainText(String(N));
  await expect(card).toContainText(String(buddhistYear(X.slice(0, 7))));
  await expect(b.page.getByTestId('home-count-going')).toContainText(T('appointments.rsvp.summary.going', { count: 1 }));
  await expect(b.page.getByTestId('home-rsvp-going')).toHaveAttribute('aria-pressed', 'true');
  await expect(bellBadge(b.page)).toHaveCount(0); // อ่านแล้วตอนเปิดแถว

  // ───── 7) สิทธิ์ฝั่งเซิร์ฟเวอร์: สมาชิกทั่วไปแก้ไม่ได้ (403) · คนนอก 404 ─────
  const patchB = await call(b.context.request, 'PATCH', `/api/appointments/${id}`, { title: 'hacked' });
  expect(patchB.status, patchB.text).toBe(403);
  const cancelB = await call(b.context.request, 'POST', `/api/appointments/${id}/cancel`, {});
  expect(cancelB.status, cancelB.text).toBe(403);
  const d = await newDevice();
  await signupViaApi(d.context.request, { username: uniqueUsername('out'), displayName: 'Outsider' });
  for (const [m, path, body] of [
    ['GET', `/api/appointments/${id}`, undefined],
    ['PATCH', `/api/appointments/${id}`, { title: 'x' }],
    ['POST', `/api/appointments/${id}/cancel`, {}],
    ['PUT', `/api/appointments/${id}/rsvp`, { response: 'going' }],
  ] as const) {
    const r = await call(d.context.request, m, path, body);
    expect(r.status, `${m} ${path} โดยคนนอก: ${r.text}`).toBe(404);
  }
  await d.page.goto(`/appointments/${id}`); // สถานะ HTTP ของหน้า not-found ที่สตรีมอาจเป็น 200 — ตรวจที่เนื้อหา + API 404 ด้านบน
  await expect(d.page.getByTestId('appt-gone')).toBeVisible();
  expect(await d.page.content()).not.toContain(title);
  const mine = await call<{ title: string }>(a.context.request, 'GET', `/api/appointments/${id}`);
  expect(mine.text).not.toContain('hacked');

  // ───── 8) A แก้ชื่อ (ฟอร์มแก้ไข) ─────
  const title2 = `${title} (เลื่อน)`;
  await a.page.getByTestId('appt-edit').click();
  await expect(a.page.getByTestId('appt-edit-note')).toBeVisible();
  await expect(a.page.getByTestId('appt-title')).toHaveValue(title);
  await a.page.getByTestId('appt-title').fill(title2);
  await a.page.getByTestId('appt-submit').click();
  await expect(a.page.getByTestId('appt-form')).toHaveCount(0);
  await expect(a.page.getByTestId('appt-detail-title')).toHaveText(title2);
  await go(b.page, `/appointments/${id}`);
  await expect(b.page.getByTestId('appt-detail-title')).toHaveText(title2);

  // ───── 9) A ยกเลิก → แบนเนอร์ ─────
  await a.page.getByTestId('appt-cancel').click();
  await expect(a.page.getByRole('alertdialog')).toBeVisible();
  await a.page.getByTestId('appt-cancel-confirm').click();
  await expect(a.page.getByTestId('appt-cancelled-banner')).toBeVisible();
  await expect(a.page.getByTestId('appt-cancelled-banner')).toContainText(a.p.displayName);
  await expect(a.page.getByTestId('appt-rsvp-section')).toHaveCount(0);

  // ───── 10) B: แบนเนอร์ยกเลิก · หน้าหลักไม่ใช่นัดถัดไป · รายการกลุ่มขีดฆ่า · RSVP ปิด ─────
  await go(b.page, `/appointments/${id}`);
  await expect(b.page.getByTestId('appt-cancelled-banner')).toBeVisible();
  await expect(b.page.getByTestId('appt-detail')).toHaveAttribute('data-status', 'cancelled');
  await expect(b.page.getByTestId('appt-rsvp-section')).toHaveCount(0);
  await go(b.page, '/');
  await expect(b.page.getByTestId('home-next-card')).toHaveCount(0);
  await expect(b.page.getByTestId('home-empty')).toBeVisible();
  await go(b.page, `/groups/${gid}/appointments`);
  const row = b.page.getByTestId('appt-row').filter({ hasText: title2 });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-status', 'cancelled');
  await expect(row.getByTestId('appt-row-cancelled')).toBeVisible(); // ป้ายข้อความ ไม่พึ่งสีอย่างเดียว
  expect(await row.locator('.appt-row-title').evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('line-through');
  const rsvpClosed = await call(b.context.request, 'PUT', `/api/appointments/${id}/rsvp`, { response: 'not_going' });
  expect(rsvpClosed.status, rsvpClosed.text).toBeGreaterThanOrEqual(400);
  expect(rsvpClosed.json?.error?.code).toBe('APPOINTMENT_CANCELLED');
  const after = await call(a.context.request, 'PATCH', `/api/appointments/${id}`, { title: 'หลังยกเลิก' });
  expect(after.status, after.text).toBeGreaterThanOrEqual(400);

  // ───── 11) C ออกกลุ่ม → ไม่เห็นนัด/แจ้งเตือน ─────
  expect((await call(c.context.request, 'POST', `/api/groups/${gid}/leave`)).status).toBe(200);
  await c.page.goto(`/appointments/${id}`);
  await expect(c.page.getByTestId('appt-gone')).toBeVisible();
  await go(c.page, '/');
  await expect(c.page.getByTestId('home-nogroup')).toBeVisible();
  await expect(bellBadge(c.page)).toHaveCount(0);
  await go(c.page, '/notifications');
  await expect(c.page.getByTestId('notif-empty')).toBeVisible();
  const apiC = await call(c.context.request, 'GET', '/api/me/notifications');
  expect(apiC.text).not.toContain(title);
  expect((await call(c.context.request, 'GET', `/api/appointments/${id}`)).status).toBe(404);
  // นับ RSVP ของ C หายไปจากนัด (B ยังเห็นได้ผ่าน API)
  const viaB = await call<{ appointment: ApptApi }>(b.context.request, 'GET', `/api/appointments/${id}`);
  expect(viaB.json?.data?.appointment.rsvp.counts.maybe).toBe(0);

  for (const [i, p] of problems.entries()) expect(p.filter((x) => !isHydration(x)), `console ของเครื่อง ${i} · ${errUrls.join(' | ')}`).toEqual([]);
});
