// R4A-9 / R4A-3 / R4A-4 — เรื่องเล่า "ว่างตรงกัน" ในเบราว์เซอร์จริง · รันที่ mobile-390 ตัวเดียว (เลย์เอาต์ทุกความกว้างอยู่ใน free-layout.spec.ts)
//
//  A (admin) B C ในกลุ่ม · สัปดาห์ที่เริ่มจันทร์ในอนาคต (วันที่สัมพัทธ์กับวันนี้ — ไม่มี hook นาฬิกา)
//   X (จ.)  A ติด 10–12, B ติด 14–16            → "ว่างร่วม" ช่วง 08–10 · 12–14 · 16–22
//   Y (อ.)  B ติดทั้งวัน                         → ว่าง 2/3 · ไม่ว่าง: B
//   W (พ.)  B ติด 10–12 แบบซ่อน (title+note canary) → blockers เห็นแค่ "ไม่ว่าง" · canary ไม่อยู่ใน DOM/response
//   Z (พฤ.) T24: A 08–15, B 15–22              → ว่าง 3/3 แต่ "ไม่ตรงกัน" (กรอบประ ไม่ใช่ว่างร่วม)
//  admin เปลี่ยนหน้าต่าง (ตั้งค่ากลุ่ม) → ผลเปลี่ยน · C ออกกลุ่ม → นับ 2 คนทันทีหลังโหลดใหม่ · กลุ่มคนเดียว · สิทธิ์ลิงก์ปรับช่วงเวลา · ปุ่มสร้างนัดเปิดใช้งาน
import { expect, test } from './support/auth';
import { addDays, canary, createBusyApi, monthOf, recordResponses } from './support/busy';
import { pageDump } from './support/calendar-ui';
import { watchConsole, setPrefs } from './support/fixtures';
import { api, createGroupApi, joinViaApiCode, membersApi, person, signup } from './support/groups';
import { msg } from './support/messages';
import { availabilityApi, freeCell, freeCreate, freeDay, freeMonth, freeSolo, mondayAhead, openFree, pickDay, closeSheet } from './support/free-ui';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องเล่าเต็มรันที่ mobile-390 ตัวเดียว');
});

const locale = 'th' as const;
const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
/** PATCH หน้าต่าง (idempotent) — ลองใหม่ถ้า keep-alive socket ถูกตัด (ECONNRESET เป็นครั้งคราวหลังเงียบนาน) */
async function patchWindow(req: Parameters<typeof api>[0], gid: string, body: object, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await api(req, 'PATCH', `/api/groups/${gid}`, body);
    } catch (e) {
      if (i >= tries || !/ECONNRESET|socket hang up/.test(String(e))) throw e;
    }
  }
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** aria-label ของช่อง: ลงท้ายด้วยข้อความสถานะ (date/today/outside นำหน้า) */
const stateTail = (state: 'all' | 'nocommon' | 'none' | 'partial', free: number, total: number) =>
  new RegExp(`${esc(T('availability.cell.aria', { date: '', today: 'no', outside: 'no', state, free, total }).replace(/^, /, ', '))}$`);

test('th: A,B,C → ว่างร่วม/2 จาก 3/ซ่อน/T24 · เปลี่ยนหน้าต่าง · C ออก · คนเดียว · สิทธิ์ลิงก์ · สร้างนัดเปิดใช้งาน', async ({ newDevice, baseURL }) => {
  test.setTimeout(240_000);
  const [a, b, c] = await Promise.all([newDevice(), newDevice(), newDevice()]);
  for (const x of [a, b, c]) await setPrefs(x.context, baseURL!, { locale });
  const [pa, pb, pc] = [person('Ann'), person('Ben'), person('Cat')];
  await signup(a.context, pa);
  await signup(b.context, pb);
  await signup(c.context, pc);
  const problems = [a, b, c].map((x) => watchConsole(x.page, (m) => /status of (4\d\d)/.test(m.text) && /\/api\//.test(m.url ?? '')));

  const gid = await createGroupApi(a.context.request, `Free ${Date.now().toString(36)}`);
  await joinViaApiCode(a.context.request, gid, b.context.request);
  await joinViaApiCode(a.context.request, gid, c.context.request);

  // ───── ข้อมูล: จันทร์ในอนาคต ─────
  const X = mondayAhead(14);
  const [Y, W, Z] = [1, 2, 3].map((n) => addDays(X, n)) as [string, string, string];
  const [CN, CT] = [canary('note'), canary('title')];
  const timed = (req: typeof a, d: string, s: string, e: string, extra: object = {}) =>
    createBusyApi(req.context.request, { kind: 'timed', startDate: d, startTime: s, endDate: d, endTime: e, ...extra });
  await timed(a, X, '10:00', '12:00');
  await timed(b, X, '14:00', '16:00');
  await createBusyApi(b.context.request, { kind: 'all_day', startDate: Y, endDate: Y });
  await timed(b, W, '10:00', '12:00', { title: CT, note: CN, hideDetail: true });
  await timed(a, Z, '08:00', '15:00');
  await timed(b, Z, '15:00', '22:00');

  // ───── 1) B ดูมุมมองว่างตรงกัน ─────
  const seen = recordResponses(b.page);
  await openFree(b.page, { gid, date: X });
  await expect(freeMonth(b.page)).toBeVisible();
  await expect(freeCell(b.page, X)).toHaveAttribute('aria-label', stateTail('all', 3, 3)); // ว่างร่วม — ไม่พึ่งสี
  await expect(freeCell(b.page, Y)).toHaveAttribute('aria-label', stateTail('partial', 2, 3));
  await expect(freeCell(b.page, Z)).toHaveAttribute('aria-label', stateTail('nocommon', 3, 3)); // T24
  await expect(freeCell(b.page, Z)).toContainText(T('availability.cell.fraction', { free: 3, total: 3 })); // 3/3 มีตัวเลข
  await expect(freeCell(b.page, X)).not.toContainText('3/3'); // ว่างร่วม = เครื่องหมาย ไม่มีตัวเลข
  await expect(freeCell(b.page, Y)).toContainText(T('availability.cell.fraction', { free: 2, total: 3 }));

  // T24 ต้องดูต่างจากว่างร่วมที่รูปทรง (คลาส/แอตทริบิวต์สถานะต่างกัน) ไม่ใช่แค่สี
  const [clsX, clsZ] = await Promise.all([freeCell(b.page, X).getAttribute('class'), freeCell(b.page, Z).getAttribute('class')]);
  expect(clsX).not.toEqual(clsZ);

  // ───── 2) รายละเอียดวัน X: ช่วงว่างร่วม 3 ช่วง ─────
  await pickDay(b.page, X);
  await expect(freeDay(b.page)).toBeVisible();
  await expect(freeDay(b.page)).toContainText(T('availability.day.status.all'));
  const seg = (s: string, e: string) => T('availability.day.segments.row', { start: s, end: e });
  const dayX = await freeDay(b.page).innerText();
  const order = [seg('08:00', '10:00'), seg('12:00', '14:00'), seg('16:00', '22:00')].map((s) => dayX.indexOf(s));
  expect(order.every((i) => i >= 0), `ช่วงว่างร่วมครบ 3 ช่วง:\n${dayX}`).toBe(true);
  expect([...order].sort((p, q) => p - q), 'เรียงตามเวลา').toEqual(order);
  // ปุ่ม "สร้างนัด" (R4B X66): เปิดใช้แล้ว (ไม่มีป้าย "เร็วๆ นี้") · กดแล้วเปิดฟอร์มสร้างนัดทับ sheet วัน
  await expect(freeCreate(b.page)).toBeVisible();
  await expect(freeCreate(b.page)).toContainText(T('availability.cta.create'));
  await expect(freeCreate(b.page)).not.toHaveAttribute('aria-disabled', 'true');
  await freeCreate(b.page).click();
  await expect(b.page.getByTestId('appt-form')).toBeVisible();
  await b.page.getByTestId('appt-form-cancel').click();
  await expect(b.page.getByTestId('appt-form')).toHaveCount(0);
  await expect(b.page.getByTestId('cal-toast')).toHaveCount(0);
  await expect(freeDay(b.page)).toHaveAttribute('data-date', X);

  // ───── 3) Y: 2/3 มี B เป็นคนติด · W: รายการซ่อน = "ไม่ว่าง" ─────
  await pickDay(b.page, Y);
  await expect(freeDay(b.page)).toContainText(T('availability.day.status.partial', { free: 2, total: 3 }));
  await expect(freeDay(b.page)).toContainText(pb.displayName);
  await expect(freeDay(b.page)).not.toContainText(T('availability.day.status.all'));
  await pickDay(b.page, W);
  await expect(freeDay(b.page)).toContainText(T('calendar.day.busyPlain'));
  await expect(freeDay(b.page)).not.toContainText(CT);

  // ───── 4) T24: 3/3 แต่ไม่ใช่ว่างร่วม ─────
  await pickDay(b.page, Z);
  await expect(freeDay(b.page)).toContainText(T('availability.day.status.nocommon'));
  await expect(freeDay(b.page)).not.toContainText(T('availability.day.status.all'));
  await expect(freeDay(b.page).getByText(seg('08:00', '10:00'))).toHaveCount(0); // ไม่มีช่วงว่างร่วม

  // ───── 5) canary: ไม่มี note / title ของรายการซ่อน ใน DOM หรือ response ใดๆ ที่ B ได้รับ ─────
  // เลื่อนเดือนไปกลับ → เบราว์เซอร์ขอ /availability เองจริง (โหลดแรกฝัง SSR) แล้วสแกน response นั้นด้วย
  await closeSheet(b.page);
  await b.page.getByTestId('cal-next').click();
  await expect(freeMonth(b.page)).toHaveAttribute('aria-busy', 'false');
  await b.page.getByTestId('cal-prev').click();
  await expect(freeCell(b.page, X)).toBeVisible();
  await seen.settled();
  const dumpB = await pageDump(b.page);
  for (const s of [CN, CT]) {
    expect(dumpB, `DOM ของ B ต้องไม่มี ${s}`).not.toContain(s);
    expect(seen.texts.filter((t) => t.includes(s)).length, `response ของ B ต้องไม่มี ${s}`).toBe(0);
  }
  expect(seen.urls.some((u) => u.includes('/availability')), 'หน้าเรียก availability จริง').toBe(true);
  for (const who of [a, b, c]) {
    const r = await availabilityApi(who.context.request, gid, X, Z);
    expect(r.status).toBe(200);
    for (const s of [CN, CT]) expect(r.text, 'API availability ไม่รั่ว').not.toContain(s);
  }
  const stored = await b.page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
  for (const s of [CN, CT]) expect(stored).not.toContain(s);

  // ───── 6) สิทธิ์ลิงก์ปรับช่วงเวลา: สมาชิกไม่เห็นลิงก์ · admin เห็น ─────
  const editLink = (p: typeof a) => p.page.getByRole('link', { name: T('availability.window.editAria') });
  await expect(editLink(b)).toHaveCount(0);
  await expect(b.page.getByText(T('availability.window.adminOnly'))).toBeVisible();
  await openFree(a.page, { gid, date: X });
  await expect(editLink(a)).toHaveAttribute('href', `/groups/${gid}/settings#window`);
  await expect(a.page.getByText(T('availability.window.adminOnly'))).toHaveCount(0);
  await expect(a.page.getByText(T('availability.window.line', { start: '08:00', end: '22:00', duration: T('busy.duration.hour', { hours: 2 }) }))).toHaveCount(1);

  // ───── 7) admin เปลี่ยนหน้าต่างผ่านตั้งค่ากลุ่ม (10:00–12:00) → X ไม่ใช่ว่างร่วมอีกต่อไป ─────
  await editLink(a).click();
  await expect(a.page).toHaveURL(new RegExp(`/groups/${gid}/settings`));
  const form = a.page.locator('section.set-sec', { has: a.page.getByRole('heading', { name: T('groupSettings.window.title'), exact: true }) });
  await form.getByLabel(T('groupSettings.window.start')).selectOption({ label: '10:00' });
  await form.getByLabel(T('groupSettings.window.end')).selectOption({ label: '12:00' });
  await form.getByRole('button', { name: T('common.save'), exact: true }).click();
  await expect(a.page.getByText(T('groupSettings.window.saved'))).toBeVisible();
  await openFree(b.page, { gid, date: X });
  await expect(freeCell(b.page, X)).toHaveAttribute('aria-label', stateTail('partial', 2, 3)); // A ติด 10–12 เต็มหน้าต่าง
  expect((await patchWindow(a.context.request, gid, { freeWindowStartMin: 480, freeWindowEndMin: 1320, minFreeMinutes: 120 })).status).toBe(200);
  await openFree(b.page, { gid, date: X });
  await expect(freeCell(b.page, X)).toHaveAttribute('aria-label', stateTail('all', 3, 3));

  // ───── 8) สมาชิก (B) แก้หน้าต่างผ่าน API ไม่ได้ (server ตรวจสิทธิ์) ─────
  expect((await api(b.context.request, 'PATCH', `/api/groups/${gid}`, { freeWindowStartMin: 600 })).status).toBe(403);

  // ───── 9) C ออกจากกลุ่ม → รีโหลดแล้วนับ 2 คน ─────
  expect((await api(c.context.request, 'POST', `/api/groups/${gid}/leave`)).status).toBe(200);
  await openFree(b.page, { gid, date: X });
  await expect(freeCell(b.page, X)).toHaveAttribute('aria-label', stateTail('all', 2, 2));
  await expect(freeCell(b.page, Y)).toHaveAttribute('aria-label', stateTail('partial', 1, 2));
  await expect(freeCell(b.page, Z)).toHaveAttribute('aria-label', stateTail('nocommon', 2, 2));
  const members = await membersApi(a.context.request, gid);
  expect(members.map((m) => m.displayName)).not.toContain(pc.displayName);

  // ───── 10) กลุ่มคนเดียว → สถานะ solo (ไม่มีตารางตัวเลข X/1) ─────
  const solo = await newDevice();
  await setPrefs(solo.context, baseURL!, { locale });
  await signup(solo.context, person('Sol'));
  const sg = await createGroupApi(solo.context.request, `Solo ${Date.now().toString(36)}`);
  await openFree(solo.page, { gid: sg, date: monthOf(X) + '-15' });
  await expect(freeSolo(solo.page)).toBeVisible();
  await expect(solo.page.getByRole('heading', { name: T('empty.calendarSolo.title') })).toBeVisible();
  await expect(freeMonth(solo.page)).toHaveCount(0);

  for (const [i, p] of problems.entries()) expect(p, `console ของเครื่อง ${i}`).toEqual([]);
});
