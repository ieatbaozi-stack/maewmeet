// R6F (ฝั่ง UI) — ลง busy หลายวัน "เฉพาะช่วงเวลา" ในเบราว์เซอร์จริง · รันที่ mobile-390 ตัวเดียว (เลย์เอาต์อยู่ใน r6f-layout.spec.ts)
//   R6F-3 ปฏิทินวันเห็นเฉพาะช่วงนั้น · ว่างตรงกันเห็นช่วงอื่นว่าง · R6F-1 ทั้งวันหลายวันเหมือนเดิม
//   R6F-4 (UI) error เกินช่วง/ย้อนหลัง/เวลาจบ/เกิน 300 · ฟอร์มคงค่า · ไม่มีแถวค้าง
//   R6F-6 (UI) ป้ายชุด · แก้วันเดียวหลุดจากชุด · ลบวันนี้ / ลบทั้งชุด (ยืนยันสองชั้น) · popup ลงซ้ำกับ daily
// ผู้ใช้ใหม่ต่อเทสต์ (rate limit สร้าง 30 / ลบ 60 ต่อ 10 นาทีต่อผู้ใช้)
import type { Page } from '@playwright/test';
import { expect, test } from './support/auth';
import { api } from './support/groups';
import { addDays, countBusyRows, createBusyApi, seedBusyBulk } from './support/busy';
import { openCalendar, toast } from './support/calendar-ui';
import { watchConsole } from './support/fixtures';
import { msg, type Locale } from './support/messages';
import { daysAhead, isHydration, makeScene } from './support/appt';
import { openFree, pickDay, freeDay } from './support/free-ui';
import { chooseDaily, createDailyApi, listOwn, openMultiForm, sameMonthSpan } from './r6f-helpers';

const locale: Locale = 'th';
const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
const dialogs = (p: Page) => p.getByRole('dialog');

test.describe('R6F ฝั่ง UI', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องเล่ารันที่ mobile-390 ตัวเดียว (เลย์เอาต์แยกใน r6f-layout.spec.ts)');
  });

  test('R6F-3/1/4/6: สร้างชุด → ปฏิทิน/ว่างตรงกัน · ทั้งวันเหมือนเดิม · error · ลบวันนี้/ทั้งชุด · ลงซ้ำ', async ({ newDevice, baseURL }) => {
    test.setTimeout(300_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann', 'Bob'] });
    const [A, B] = [scene.members[0]!, scene.members[1]!];
    const a = A.page;
    const problems = watchConsole(a, (m) => /status of (4\d\d)/.test(m.text));
    const span = sameMonthSpan(20, 4);
    const [D0, D3] = [span.start, span.end];
    const D1 = addDays(D0, 1);
    const submit = () => dialogs(a).getByTestId('busy-submit');

    // ───── 1) สร้างชุด 17:00–20:00 × 4 วัน: สรุปก่อนบันทึก · toast มีจำนวนวัน ─────
    const sheet = await openMultiForm(a, scene.gid, D0, D3);
    // ค่าเริ่มต้น = ทั้งวัน (R6F-1) · ยังไม่เห็นช่องเวลา
    await expect(sheet.getByTestId('busy-scope-allDay')).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByTestId('busy-start-time')).toHaveCount(0);
    await expect(sheet.getByTestId('busy-summary-daily')).toHaveCount(0);
    await chooseDaily(sheet, { start: '17:00', end: '20:00', title: 'คลาสเรียน' });
    const summary = sheet.getByTestId('busy-summary-daily');
    await expect(summary).toContainText(T('busy.form.summary.daily', { count: 4, start: '17:00', end: '20:00' }));
    await expect(summary).toContainText(T('busy.form.summary.dailyNote', { count: 4 }));
    await expect(sheet.getByTestId('busy-summary')).toHaveCount(1); // ไม่แสดงสรุปซ้อนสอง (ไม่มีบรรทัด "รวม")
    await expect(sheet).not.toContainText(T('busy.form.overnight'));
    await submit().click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toast(a)).toContainText(T('busy.toast.savedDaily', { count: 4 }));
    const rows = await listOwn(A.context.request);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.seriesId)).size, 'ชุดเดียวกันทั้ง 4 วัน').toBe(1);
    expect(rows[0]!.seriesId).toBeTruthy();
    expect(rows.every((r) => !r.allDay && r.endAt - r.startAt === 3 * 3600_000), 'วันละ 3 ชม. ไม่ใช่ช่วงต่อเนื่อง').toBe(true);

    // ───── 2) R6F-3: ปฏิทินวัน — Bob เห็นเฉพาะ 17:00–20:00 · ว่างตรงกันเห็นช่วงอื่นว่าง ─────
    await openCalendar(B.page, { gid: scene.gid, view: 'day', date: D1 });
    const panel = B.page.getByTestId('cal-day-panel');
    await expect(panel.getByTestId('cal-item')).toHaveCount(1);
    await expect(panel).toContainText('17:00');
    await expect(panel).toContainText('20:00');
    await expect(panel).not.toContainText('00:00');
    await openFree(B.page, { gid: scene.gid, date: D1 });
    await pickDay(B.page, D1);
    const seg = (s: string, e: string) => T('availability.day.segments.row', { start: s, end: e });
    await expect(freeDay(B.page)).toContainText(seg('08:00', '17:00'));
    await expect(freeDay(B.page)).toContainText(seg('20:00', '22:00')); // (17:00–20:00 ขึ้นในรายการ "ใครไม่ว่าง" ไม่ใช่ช่วงว่าง — ช่วงว่างมีแค่สองช่วงนี้)

    // ───── 3) ป้ายชุดใน "ของฉัน" ─────
    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    await expect(a.getByTestId('busy-series-tag')).toHaveCount(4);
    await expect(a.getByTestId('busy-series-tag').first()).toContainText(T('busy.series.tag'));
    // คนอื่นไม่รู้ว่าเป็นชุด (R6F-7): response ปฏิทินของ Bob ไม่มี seriesId
    const cal = await api(B.context.request, 'GET', `/api/groups/${scene.gid}/calendar?from=${D0}&to=${D3}`);
    expect(cal.status).toBe(200);
    expect(cal.text).not.toContain('seriesId');

    // ───── 4) R6F-1: หลายวัน + ทั้งวัน (ค่าเริ่มต้น) = all_day เหมือนเดิม ไม่มีชุด ─────
    const span2 = sameMonthSpan(40, 3);
    const sheet2 = await openMultiForm(a, scene.gid, span2.start, span2.end);
    await sheet2.getByTestId('busy-title').fill('ไปต่างประเทศ');
    await expect(sheet2.getByTestId('busy-summary')).toContainText(T('busy.form.totalDays', { count: 3 }));
    await submit().click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toast(a)).toContainText(T('busy.toast.saved'));
    const trip = (await listOwn(A.context.request)).filter((r) => r.title === 'ไปต่างประเทศ');
    expect(trip).toHaveLength(1);
    expect(trip[0]!.allDay).toBe(true);
    expect(trip[0]!.seriesId ?? null).toBeNull();

    // ───── 5) R6F-4 ฝั่ง UI: error · ฟอร์มคงค่า · ไม่มีแถวค้าง ─────
    const before = (await listOwn(A.context.request)).length;
    const span4 = sameMonthSpan(80, 4); // ช่วงว่าง (ไม่ทับชุดเดิม → ไม่มี popup ลงซ้ำคั่น)
    const sheet3 = await openMultiForm(a, scene.gid, span4.start, span4.end);
    await chooseDaily(sheet3, { start: '17:00', end: '17:00', title: 'ต้องไม่หาย' });
    // 5a) เวลาจบ ≤ เริ่ม → error ใต้แถวเวลา (ตรวจฝั่งไคลเอนต์ก่อนส่ง) · สรุปไม่แสดง
    await expect(sheet3.getByTestId('busy-summary-daily')).toHaveCount(0);
    await submit().click();
    await expect(sheet3.getByTestId('busy-time-error')).toHaveText(T('busy.form.error.daily.end'));
    await expect(sheet3.getByTestId('busy-title')).toHaveValue('ต้องไม่หาย');
    // 5b) เกิน 62 วัน / ย้อนหลังเกิน 7 วัน: ใช้ body error จริงจากเซิร์ฟเวอร์ (ไม่สร้างแถว) แล้วตอบกลับที่ฟอร์ม
    const real = async (body: object) => {
      const r = await api(A.context.request, 'POST', '/api/me/busy', { kind: 'daily', startTime: '17:00', endTime: '20:00', ...body });
      expect(r.status).toBe(400);
      return r.text;
    };
    const spanBody = await real({ startDate: span4.start, endDate: addDays(span4.start, 62) });
    const backBody = await real({ startDate: daysAhead(-10), endDate: daysAhead(-8) });
    let reply = spanBody;
    const isPost = (u: URL) => u.pathname === '/api/me/busy';
    await a.route(isPost, (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 400, contentType: 'application/json', body: reply }) : route.continue()));
    await sheet3.getByTestId('busy-end-time').selectOption('20:00');
    await submit().click();
    await expect(sheet3.getByTestId('busy-error')).toHaveText(T('busy.form.error.daily.span', { max: 62 }));
    await expect(sheet3.getByTestId('busy-title')).toHaveValue('ต้องไม่หาย');
    await expect(sheet3.getByTestId('busy-end-time')).toHaveValue('20:00');
    reply = backBody;
    await submit().click();
    await expect(sheet3.getByTestId('busy-date-error')).toHaveText(T('busy.form.error.daily.backdate', { max: 7 }));
    await expect(sheet3.getByTestId('busy-title')).toHaveValue('ต้องไม่หาย');
    await a.unroute(isPost);
    await sheet3.getByTestId('busy-title').focus(); // โฟกัสอยู่ใน sheet (ปุ่มบันทึก disabled ตอนส่ง โฟกัสหลุด) แล้ว Esc = ปิด
    await a.keyboard.press('Escape');
    await expect(dialogs(a)).toHaveCount(0);
    expect((await listOwn(A.context.request)).length, 'ไม่มีแถวค้างจากรอบที่ล้ม').toBe(before);

    // ───── 6) แก้วันเดียวในชุด → หลุดจากชุด · ข้อความเตือนก่อนแก้ ─────
    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    const byDay = async () => (await listOwn(A.context.request)).filter((r) => r.title?.startsWith('คลาสเรียน')).sort((x, y) => x.startAt - y.startAt);
    let series = await byDay();
    await a.getByTestId(`busy-row-${series[0]!.id}`).click();
    await expect(dialogs(a).getByTestId('busy-series-note')).toContainText(T('busy.form.series.editNote'));
    await expect(dialogs(a).getByTestId('busy-series-note')).toContainText(T('busy.series.detailPlain'));
    await dialogs(a).getByTestId('busy-title').fill('คลาสเรียน แก้');
    await submit().click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toast(a)).toContainText(T('busy.toast.updated'));
    const detached = (await listOwn(A.context.request)).find((r) => r.id === series[0]!.id)!;
    expect(detached.seriesId ?? null, 'วันที่แก้หลุดจากชุด').toBeNull();
    await expect(a.getByTestId('busy-series-tag')).toHaveCount(3);

    // ───── 7) ลบวันนี้ (วันอื่นในชุดอยู่) → ลบทั้งชุด (ยืนยันสองชั้น · ไม่แตะรายการนอกชุด) ─────
    series = (await listOwn(A.context.request)).filter((r) => r.seriesId).sort((x, y) => x.startAt - y.startAt);
    expect(series).toHaveLength(3);
    await a.getByTestId(`busy-row-${series[0]!.id}`).click();
    await dialogs(a).getByTestId('busy-delete').click();
    await expect(a.getByTestId('busy-series-dialog')).toBeVisible();
    await expect(a.getByRole('alertdialog')).toContainText(T('busy.series.deleteTitle'));
    for (const id of ['busy-series-delete-one', 'busy-series-delete-all', 'busy-series-cancel']) {
      expect((await a.getByTestId(id).boundingBox())!.height, `${id} ≥ 44`).toBeGreaterThanOrEqual(44);
    }
    await a.getByTestId('busy-series-delete-one').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toast(a)).toContainText(T('busy.toast.deletedDay'));
    const afterOne = await listOwn(A.context.request);
    expect(afterOne.filter((r) => r.seriesId)).toHaveLength(2);
    expect(afterOne.some((r) => r.id === series[0]!.id)).toBe(false);

    const remain = afterOne.filter((r) => r.seriesId).sort((x, y) => x.startAt - y.startAt);
    await a.getByTestId(`busy-row-${remain[0]!.id}`).click();
    await dialogs(a).getByTestId('busy-delete').click();
    await a.getByTestId('busy-series-delete-all').click();
    // ขั้นยืนยัน: บอกว่ารวมวันที่ผ่านแล้ว · ยกเลิกแล้วยังไม่ลบ
    await expect(a.getByTestId('busy-series-dialog')).toHaveCount(0);
    await expect(a.getByRole('alertdialog')).toContainText(T('busy.series.confirmAllTitle'));
    await expect(a.getByRole('alertdialog')).toContainText(T('busy.series.confirmAllBody'));
    await a.getByRole('alertdialog').getByRole('button', { name: T('common.cancel') }).click();
    expect((await listOwn(A.context.request)).filter((r) => r.seriesId)).toHaveLength(2);
    await dialogs(a).getByTestId('busy-delete').click();
    await a.getByTestId('busy-series-delete-all').click();
    await a.getByRole('alertdialog').getByRole('button', { name: T('busy.series.confirmAll') }).click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toast(a)).toContainText(T('busy.toast.deletedSeriesCount', { count: 2 }));
    const left = await listOwn(A.context.request);
    expect(left.filter((r) => r.seriesId)).toHaveLength(0);
    expect(left.some((r) => r.id === detached.id), 'วันที่หลุดจากชุดไม่ถูกลบ').toBe(true);
    expect(left.some((r) => r.title === 'ไปต่างประเทศ'), 'รายการนอกชุดไม่ถูกแตะ').toBe(true);
    // รายการนอกชุด → dialog ลบเดิม (ไม่ใช่ dialog ชุด)
    await a.getByTestId(`busy-row-${detached.id}`).click();
    await dialogs(a).getByTestId('busy-delete').click();
    await expect(a.getByRole('alertdialog')).toContainText(T('busy.delete.title'));
    await expect(a.getByTestId('busy-series-dialog')).toHaveCount(0);
    await a.keyboard.press('Escape');
    await a.keyboard.press('Escape');

    // ───── 8) E11 กับ daily: วันใดในชุดทับ busy เดิม → popup · ลงซ้ำ = บันทึก ─────
    const span3 = sameMonthSpan(60, 4);
    await createBusyApi(A.context.request, { kind: 'timed', startDate: addDays(span3.start, 1), startTime: '18:00', endDate: addDays(span3.start, 1), endTime: '19:00', title: 'ติวเพื่อน' });
    const sheet4 = await openMultiForm(a, scene.gid, span3.start, span3.end);
    await chooseDaily(sheet4, { start: '17:00', end: '20:00', title: 'คลาสเย็น' });
    await submit().click();
    await expect(a.getByTestId('busy-overlap')).toBeVisible();
    await expect(a.getByTestId('busy-overlap-item')).toHaveCount(1);
    await expect(a.getByTestId('busy-overlap-item')).toContainText('ติวเพื่อน');
    await a.getByTestId('busy-overlap-back').click();
    await expect(dialogs(a).getByTestId('busy-title')).toHaveValue('คลาสเย็น');
    expect((await listOwn(A.context.request)).filter((r) => r.title === 'คลาสเย็น')).toHaveLength(0);
    await submit().click();
    await a.getByTestId('busy-overlap-confirm').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toast(a)).toContainText(T('busy.toast.savedDaily', { count: 4 }));
    expect((await listOwn(A.context.request)).filter((r) => r.title === 'คลาสเย็น')).toHaveLength(4);

    expect(problems.filter((x) => !isHydration(x)).filter((x) => !/Failed to load resource/.test(x.text)), 'console').toEqual([]);
  });

  test('R6F-4: เกิน 300 รายการ → ข้อความ daily.count · ไม่สร้างสักวัน · ฟอร์มคงค่า', async ({ newDevice, baseURL }) => {
    test.setTimeout(180_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann'] });
    const A = scene.members[0]!;
    const a = A.page;
    await seedBusyBulk(A.userId, 299, 'r6f-cap');
    const span = sameMonthSpan(20, 3);
    const sheet = await openMultiForm(a, scene.gid, span.start, span.end);
    await chooseDaily(sheet, { start: '17:00', end: '20:00', title: 'เกินเพดาน' });
    await sheet.getByTestId('busy-submit').click();
    await expect(sheet.getByTestId('busy-error')).toHaveText(T('busy.form.error.daily.count', { max: 300 }));
    await expect(sheet.getByTestId('busy-title')).toHaveValue('เกินเพดาน');
    await expect(sheet.getByTestId('busy-scope-daily')).toHaveAttribute('aria-pressed', 'true');
    expect(await countBusyRows(A.userId), 'ไม่มีแถวใหม่แม้แต่วันเดียว').toBe(299);
    // ลดจำนวนวันจนพอดีเพดาน (1 วัน = 300) → บันทึกได้ (ไม่มีชุด)
    await createDailyApi(A.context.request, { startDate: span.start, endDate: span.start, startTime: '10:00', endTime: '11:00' });
    expect(await countBusyRows(A.userId)).toBe(300);
  });
});
