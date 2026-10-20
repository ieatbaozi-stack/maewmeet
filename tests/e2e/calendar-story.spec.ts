// R3-10 / R3-8 — เรื่องเล่าปฏิทินกลุ่มในเบราว์เซอร์จริง (ไทย/อังกฤษ) · รันที่ mobile-390 ตัวเดียว (ตรรกะไม่ขึ้นกับความกว้าง · เลย์เอาต์ทุกความกว้างอยู่ใน calendar-layout.spec.ts)
//
//  A ลง busy 4 แบบผ่านฟอร์มจริง (ทั้งวัน+ซ่อน+note · ช่วงเวลา+note · ข้ามเที่ยงคืน · หลายวัน+note)
//  B (เครื่องอื่น กลุ่มเดียวกัน) เห็นจุดในมุมมองเดือน · มุมมองวัน: รายการซ่อน = "ไม่ว่าง" · ไม่เห็น note ที่ใดเลย (DOM + ทุก response)
//  A แก้ title / ลบ → B เห็นทันทีหลังโหลด · เลื่อนเดือน · ปุ่มวันนี้ · หัวตารางเริ่มจันทร์ · พ.ศ. (ไทย)
//  B ออกจากกลุ่มขณะเปิดปฏิทินค้างอยู่ → เลื่อนเดือนแล้วเห็นหน้า "ไม่ได้อยู่ในกลุ่มนี้แล้ว" (API 404) → โหลดใหม่ = ไม่มีกลุ่ม
//  C (อยู่กลุ่มอื่น) ใส่ ?g= ของกลุ่ม A → ไม่เห็นกลุ่ม/busy ของ A เลย (ตกไปกลุ่มของตัวเอง) และ API ปฏิทินตอบ 404
//
// "วันนี้" = เวลาจริง (next start ไม่มี hook นาฬิกา) → ใช้วันที่สัมพัทธ์: เดือนถัดไปของวันนี้ ตั้งหลักที่วัน 12–19 เสมอ
import { expect, test } from './support/auth';
import { addMonths, buddhistYear, calendarApi, canary, monthOf, recordResponses, todayBkk, weeksInMonthGrid } from './support/busy';
import { addBusyViaUi, cell, monthGrid, openCalendar, pageDump } from './support/calendar-ui';
import { setPrefs, watchConsole } from './support/fixtures';
import { api, createGroupApi, joinViaApiCode, person, signup } from './support/groups';
import { LOCALES, msg } from './support/messages';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องเล่าเต็มรันที่ mobile-390 ตัวเดียว');
});

for (const locale of LOCALES) {
  test(`${locale}: A ลง 4 แบบ → B เห็นจุด/"ไม่ว่าง" ไม่เห็น note · แก้/ลบ · ออกกลุ่ม → gone · คนนอกไม่เห็น`, async ({ newDevice, baseURL }) => {
    test.setTimeout(180_000);
    const [a, b, c] = await Promise.all([newDevice(), newDevice(), newDevice()]);
    for (const x of [a, b, c]) await setPrefs(x.context, baseURL!, { locale });
    const [pa, pb, pc] = [person('Ann'), person('Ben'), person('Cat')];
    await signup(a.context, pa);
    await signup(b.context, pb);
    await signup(c.context, pc);
    const problems = [a, b, c].map((x) => watchConsole(x.page, (m) => /status of (4\d\d)/.test(m.text) && /\/api\//.test(m.url ?? '')));

    const groupName = `Cal ${locale} ${Date.now().toString(36)}`;
    const gid = await createGroupApi(a.context.request, groupName);
    await joinViaApiCode(a.context.request, gid, b.context.request);
    const otherName = `Other ${locale} ${Date.now().toString(36)}`;
    await createGroupApi(c.context.request, otherName);

    // ───── วันที่: เดือนถัดไปของวันนี้ (อยู่ในอนาคตเสมอ ฟอร์มรับ) ─────
    const M = addMonths(monthOf(todayBkk()), 1);
    const [D_ALL, D_TIMED, D_OVER, D_OVER2, D_MULTI1, D_MULTI3] = ['12', '13', '14', '15', '17', '19'].map((d) => `${M}-${d}`) as [string, string, string, string, string, string];
    const [nHidden, nTimed, nMulti] = [canary('hidden'), canary('timed'), canary('multi')];
    const T_HIDDEN = canary('title-hidden'); // title ของรายการซ่อน ต้องไม่ถึง B
    const T_TIMED = locale === 'th' ? 'ซ้อมวง' : 'Band practice';
    const T_OVER = locale === 'th' ? 'เข้าเวร' : 'Night shift';
    const T_MULTI = locale === 'th' ? 'ไปเชียงใหม่' : 'Trip north';
    const secrets = [nHidden, nTimed, nMulti, T_HIDDEN];

    // ───── 1) A ลง 4 แบบผ่านฟอร์มจริง ─────
    await addBusyViaUi(a.page, locale, gid, { kind: 'allDay', date: D_ALL, title: T_HIDDEN, hide: true, note: nHidden });
    await addBusyViaUi(a.page, locale, gid, { kind: 'timed', date: D_TIMED, start: '18:00', end: '20:30', title: T_TIMED, note: nTimed });
    await addBusyViaUi(a.page, locale, gid, { kind: 'timed', date: D_OVER, start: '22:00', end: '06:00', title: T_OVER });
    await addBusyViaUi(a.page, locale, gid, { kind: 'multi', date: D_MULTI1, endDate: D_MULTI3, title: T_MULTI, note: nMulti });

    // A เองดูปฏิทินกลุ่ม = เห็นเท่าที่เพื่อนเห็น (ไม่มี note / title ของรายการซ่อน) · "ของฉัน" เห็นครบ 4 รายการ
    await openCalendar(a.page, { gid, view: 'day', date: D_ALL });
    await expect(a.page.getByTestId('cal-item')).toHaveCount(1);
    await expect(a.page.getByTestId('cal-item')).toContainText(msg(locale, 'calendar.day.busyPlain'));
    const dumpA = await pageDump(a.page);
    for (const s of secrets) expect(dumpA, `A ในมุมมองกลุ่มไม่เห็น ${s}`).not.toContain(s);
    await openCalendar(a.page, { view: 'mine' });
    await expect(a.page.getByTestId('busy-mine-list').locator('[data-testid^="busy-row-"]')).toHaveCount(4);
    await expect(a.page.getByTestId('busy-mine-list').getByText(msg(locale, 'busy.mine.hiddenTag'))).toHaveCount(1);
    await expect(a.page.getByTestId('busy-mine-list').getByText(msg(locale, 'busy.mine.hasNote'))).toHaveCount(3);
    await expect(a.page.getByTestId('busy-mine-list')).toContainText(T_HIDDEN); // เจ้าของเห็น title ของรายการที่ซ่อน

    // ───── 2) B: มุมมองเดือน — จุด/จำนวนคนต่อวัน · พ.ศ. · หัวจันทร์ ─────
    const seen = recordResponses(b.page);
    await openCalendar(b.page, { gid, view: 'month', date: D_ALL });
    await expect(monthGrid(b.page)).toHaveAttribute('data-weeks', String(weeksInMonthGrid(M)));
    await expect(b.page.getByTestId('cal-month-title')).toContainText(String(locale === 'th' ? buddhistYear(M) : M.slice(0, 4)));
    if (locale === 'th') await expect(b.page.getByTestId('cal-month-title')).not.toContainText(M.slice(0, 4)); // ไม่ใช่ ค.ศ.
    const heads = monthGrid(b.page).getByRole('columnheader');
    await expect(heads).toHaveCount(7);
    for (const [i, d] of (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).entries()) await expect(heads.nth(i)).toContainText(msg(locale, `calendar.dowLong.${d}`));

    const expectCounts = async (expected: Record<string, number>) => {
      for (const [d, n] of Object.entries(expected)) await expect(cell(b.page, `${M}-${d}`), `วันที่ ${d}`).toHaveAttribute('data-count', String(n));
    };
    await expectCounts({ '11': 0, '12': 1, '13': 1, '14': 1, '15': 1, '16': 0, '17': 1, '18': 1, '19': 1, '20': 0 });
    // aria-label ของช่อง: วันที่ + จำนวนคนที่ติด (สัญญาณที่ไม่ใช่สี)
    const tail = msg(locale, 'calendar.cell.aria', { date: '', today: 'no', outside: 'no', count: 1 }); // ", ติด 1 คน"
    await expect(cell(b.page, D_ALL)).toHaveAttribute('aria-label', new RegExp(`${tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await expect(cell(b.page, D_ALL).locator('.member-dot')).toHaveCount(1);

    // ───── 3) B: มุมมองวัน — รายการซ่อน = "ไม่ว่าง", ที่เหลือเห็น title · ไม่เห็น note ──────
    const day = async (d: string) => {
      await openCalendar(b.page, { gid, view: 'day', date: d });
      await expect(b.page.getByTestId('cal-day-panel')).toHaveAttribute('data-date', d);
      return b.page.getByTestId('cal-item');
    };
    let items = await day(D_ALL);
    await expect(items).toHaveCount(1);
    await expect(items).toContainText(msg(locale, 'calendar.day.allDay'));
    await expect(items).toContainText(msg(locale, 'calendar.day.busyPlain'));
    await expect(items).not.toContainText(T_HIDDEN);
    await expect(b.page.getByTestId('cal-day-summary')).toHaveText(msg(locale, 'calendar.day.summary', { count: 1, total: 2 }));
    items = await day(D_TIMED);
    await expect(items).toContainText(msg(locale, 'calendar.day.range', { start: '18:00', end: '20:30' }));
    await expect(items).toContainText(T_TIMED);
    items = await day(D_OVER); // ข้ามเที่ยงคืน: วันแรก "ตั้งแต่ 22:00 ต่อไปถึงพรุ่งนี้" · วันถัดไป "ต่อจากเมื่อวาน ถึง 06:00"
    await expect(items).toContainText(msg(locale, 'calendar.day.toNext', { start: '22:00' }));
    items = await day(D_OVER2);
    await expect(items).toContainText(msg(locale, 'calendar.day.fromPrev', { end: '06:00' }));
    await expect(items).toContainText(T_OVER);
    items = await day(`${M}-18`); // กลางช่วงหลายวัน = ทั้งวัน · วันที่ 2 จาก 3
    await expect(items).toContainText(msg(locale, 'calendar.day.allDay'));
    await expect(items).toContainText(msg(locale, 'calendar.day.dayOf', { n: 2, total: 3 }));
    await expect(items).toContainText(T_MULTI);
    await day(`${M}-16`);
    await expect(b.page.getByTestId('cal-day-empty')).toBeVisible();

    // ───── 4) canary: ไม่พบ note (หรือ title ของรายการซ่อน) ใน DOM หรือ response ใด ๆ ที่ B ได้รับ ─────
    await openCalendar(b.page, { gid, view: 'month', date: D_ALL });
    await expect(cell(b.page, D_ALL)).toBeVisible();
    await seen.settled();
    const dumpB = await pageDump(b.page);
    for (const s of secrets) {
      expect(dumpB, `DOM ของ B ต้องไม่มี ${s}`).not.toContain(s);
      expect(seen.texts.filter((t) => t.includes(s)).length, `response ของ B ต้องไม่มี ${s}`).toBe(0);
    }
    expect(seen.texts.length, 'บันทึก response ได้จริง').toBeGreaterThan(3);
    expect(seen.texts.some((t) => t.includes(T_TIMED)), 'title ที่ไม่ซ่อนมาถึง B (เช็คว่าตัวสแกนเห็น response จริง)').toBe(true);
    // ไม่เก็บใน storage ของ B
    const stored = await b.page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    for (const s of secrets) expect(stored).not.toContain(s);

    // ───── 5) เลื่อนเดือน + ปุ่มวันนี้ ─────
    const title = b.page.getByTestId('cal-month-title');
    const before = await title.innerText();
    await b.page.getByTestId('cal-next').click();
    await expect(title).not.toHaveText(before);
    await expect(monthGrid(b.page)).toHaveAttribute('data-weeks', String(weeksInMonthGrid(addMonths(M, 1))));
    await b.page.getByTestId('cal-prev').click();
    await expect(title).toHaveText(before);
    await expect(cell(b.page, D_ALL)).toHaveAttribute('data-count', '1'); // กลับมาแล้วข้อมูลยังอยู่
    await b.page.getByTestId('cal-today').click();
    const today = todayBkk();
    await expect(title).toContainText(String(locale === 'th' ? buddhistYear(monthOf(today)) : today.slice(0, 4)));
    await expect(cell(b.page, today)).toHaveAttribute('aria-current', 'date');
    await expect(monthGrid(b.page).locator('[aria-current="date"]')).toHaveCount(1);

    // ───── 6) A แก้ title รายการช่วงเวลา แล้วลบรายการหลายวัน → B เห็นหลังโหลดใหม่ ─────
    const NEW_TITLE = `${T_TIMED} 2`;
    await openCalendar(a.page, { view: 'mine' });
    await a.page.getByRole('button', { name: new RegExp(T_TIMED) }).click();
    let sheet = a.page.getByRole('dialog', { name: msg(locale, 'busy.form.editTitle'), exact: true });
    await expect(sheet.getByTestId('busy-note')).toHaveValue(nTimed); // เจ้าของเห็น note ของตัวเอง
    await sheet.getByTestId('busy-title').fill(NEW_TITLE);
    await sheet.getByTestId('busy-submit').click();
    await expect(sheet).toHaveCount(0);
    await expect(a.page.getByTestId('cal-toast')).toContainText(msg(locale, 'busy.toast.updated'));
    await expect(a.page.getByTestId('busy-mine-list')).toContainText(NEW_TITLE);

    await a.page.getByRole('button', { name: new RegExp(T_MULTI) }).click();
    sheet = a.page.getByRole('dialog', { name: msg(locale, 'busy.form.editTitle'), exact: true });
    await sheet.getByTestId('busy-delete').click();
    const confirm = a.page.getByRole('alertdialog', { name: msg(locale, 'busy.delete.title'), exact: true });
    await expect(confirm.getByTestId('busy-delete-summary')).toContainText(T_MULTI);
    await confirm.getByRole('button', { name: msg(locale, 'busy.delete.confirm'), exact: true }).click();
    await expect(a.page.getByTestId('cal-toast')).toContainText(msg(locale, 'busy.toast.deleted'));
    await expect(a.page.getByTestId('busy-mine-list').locator('[data-testid^="busy-row-"]')).toHaveCount(3);

    items = await day(D_TIMED);
    await expect(items).toContainText(NEW_TITLE);
    await openCalendar(b.page, { gid, view: 'month', date: D_ALL });
    await expectCounts({ '12': 1, '13': 1, '17': 0, '18': 0, '19': 0 });

    // ───── 7) C (กลุ่มอื่น) ใส่ ?g= ของกลุ่ม A: ไม่เห็นกลุ่ม/busy ของ A · API ปฏิทินของกลุ่ม A = 404 ─────
    await openCalendar(c.page, { gid, view: 'month', date: D_ALL });
    await expect(c.page.getByTestId('cal-group-switch')).toContainText(otherName); // ตกไปกลุ่มของตัวเอง ไม่ใช่กลุ่ม A
    const dumpC = await pageDump(c.page);
    for (const s of [...secrets, groupName, T_TIMED, NEW_TITLE, pa.displayName]) expect(dumpC, `C ไม่เห็น ${s}`).not.toContain(s);
    const direct = await calendarApi(c.context.request, gid, D_ALL, D_TIMED);
    expect(direct.status).toBe(404);
    for (const s of secrets) expect(direct.text).not.toContain(s);

    // ───── 8) B ออกจากกลุ่มขณะเปิดปฏิทินค้างอยู่ → เลื่อนเดือน = gone (404) → โหลดใหม่ = ไม่มีกลุ่ม ─────
    await openCalendar(b.page, { gid, view: 'month', date: D_ALL });
    await expect(cell(b.page, D_ALL)).toHaveAttribute('data-count', '1');
    expect((await api(b.context.request, 'POST', `/api/groups/${gid}/leave`)).status).toBe(200);
    await b.page.getByTestId('cal-next').click();
    const gone = b.page.getByTestId('cal-gone');
    await expect(gone).toBeVisible();
    await expect(gone.getByRole('heading', { name: msg(locale, 'calendar.gone.title') })).toBeVisible();
    await expect(gone.getByRole('link', { name: msg(locale, 'calendar.gone.cta') })).toHaveAttribute('href', '/groups');
    await expect(monthGrid(b.page)).toHaveCount(0); // ไม่เหลือตาราง/จุดของ A ค้างบนจอ
    expect((await calendarApi(b.context.request, gid, D_ALL, D_TIMED)).status).toBe(404);
    await openCalendar(b.page, { gid, view: 'month', date: D_ALL });
    await expect(b.page.getByRole('heading', { level: 2, name: msg(locale, 'empty.calendarNoGroup.title') })).toBeVisible();
    expect(await pageDump(b.page)).not.toContain(T_TIMED);

    // 4xx ของ API ที่คาดไว้ถูกกรองแล้ว — ที่เหลือ (pageerror, CSP, hydration) ต้องไม่มี
    for (const [i, p] of problems.entries()) expect(p, `console ของเครื่อง ${i}`).toEqual([]);
  });
}
