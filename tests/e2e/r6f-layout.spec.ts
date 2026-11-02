// R6F-8 — เลย์เอาต์ ฟอร์ม "เฉพาะช่วงเวลา" (สรุป/error) · ป้ายชุดใน "ของฉัน" · dialog ลบชุด + ยืนยัน
//   375/390/768 (ทุก project) × th/en × สว่าง/มืด · ไม่ล้นจอ · ปุ่ม ≥ 44px (checkLayout) · ผู้ใช้ใหม่ต่อเทสต์
import { expect, test } from './support/auth';
import { checkLayout, type Theme } from './support/groups';
import { openCalendar, toast } from './support/calendar-ui';
import { msg, type Locale } from './support/messages';
import { makeScene } from './support/appt';
import { chooseDaily, listOwn, openMultiForm, sameMonthSpan } from './r6f-helpers';

for (const loc of ['th', 'en'] as Locale[]) {
  for (const theme of ['light', 'dark'] as Theme[]) {
    test(`R6F-8 เลย์เอาต์ ${loc}/${theme}: ฟอร์มเฉพาะช่วงเวลา · ป้ายชุด · dialog ลบชุด`, async ({ newDevice, baseURL }, testInfo) => {
      test.setTimeout(240_000);
      const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
      const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann'] });
      const A = scene.members[0]!;
      const a = A.page;
      const dlg = () => a.getByRole('dialog');
      const long = `LongTitle${'z'.repeat(60)}`;

      // 1) ฟอร์ม + สรุปก่อนบันทึก (ชื่อยาวไม่ดันจอ)
      const span = sameMonthSpan(20, 4);
      const sheet = await openMultiForm(a, scene.gid, span.start, span.end);
      await chooseDaily(sheet, { start: '17:00', end: '20:00', title: long });
      await expect(sheet.getByTestId('busy-summary-daily')).toContainText(T('busy.form.summary.daily', { count: 4, start: '17:00', end: '20:00' }));
      await checkLayout(a, testInfo, 'r6f-form-daily', loc, theme);

      // 2) error ใต้เวลา (เวลาจบ = เริ่ม)
      await sheet.getByTestId('busy-end-time').selectOption('17:00');
      await sheet.getByTestId('busy-submit').click();
      await expect(sheet.getByTestId('busy-time-error')).toHaveText(T('busy.form.error.daily.end'));
      await checkLayout(a, testInfo, 'r6f-form-error', loc, theme);

      // 3) บันทึกจริง → ป้ายชุดใน "ของฉัน"
      await sheet.getByTestId('busy-end-time').selectOption('20:00');
      await sheet.getByTestId('busy-submit').click();
      await expect(dlg()).toHaveCount(0);
      await expect(toast(a)).toContainText(T('busy.toast.savedDaily', { count: 4 }));
      await openCalendar(a, { gid: scene.gid, view: 'mine' });
      await expect(a.getByTestId('busy-series-tag')).toHaveCount(4);
      await checkLayout(a, testInfo, 'r6f-mine', loc, theme);

      // 4) แก้รายการในชุด → โน้ต · ลบ → dialog ลบชุด → ยืนยัน
      const rows = await listOwn(A.context.request);
      await a.getByTestId(`busy-row-${rows[0]!.id}`).click();
      await expect(dlg().getByTestId('busy-series-note')).toBeVisible();
      await checkLayout(a, testInfo, 'r6f-edit-series', loc, theme);
      await dlg().getByTestId('busy-delete').click();
      await expect(a.getByTestId('busy-series-dialog')).toBeVisible();
      await checkLayout(a, testInfo, 'r6f-series-dialog', loc, theme);
      await a.getByTestId('busy-series-delete-all').click();
      await expect(a.getByRole('alertdialog')).toContainText(T('busy.series.confirmAllTitle'));
      await checkLayout(a, testInfo, 'r6f-series-confirm', loc, theme);
    });
  }
}

