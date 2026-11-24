// E2E — นำเข้าไฟล์ .ics เป็นเวลาไม่ว่างของฉัน (ICS_IMPORT_CONTRACT §3–§4 · ADR 0017): 375/390/768 × th/en × light/dark
// เจ้าของ: test
import type { Page } from '@playwright/test';
import { expect, test } from './support/auth';
import { addDays, todayBkk } from './support/busy';
import { setPrefs, watchConsole } from './support/fixtures';
import { createGroupApi, go, type Theme } from './support/groups';
import { LOCALES, msg } from './support/messages';

const THEMES: readonly Theme[] = ['light', 'dark'];
const ymdCompact = (iso: string): string => iso.replace(/-/g, '');

function buildSampleIcs(): Buffer {
  const today = todayBkk();
  const dTimed = ymdCompact(addDays(today, 5));
  const dAllStart = ymdCompact(addDays(today, 8));
  const dAllEndExcl = ymdCompact(addDays(today, 10)); // 2 วัน (inclusive: +8 ถึง +9)
  const dRecWeekly = ymdCompact(addDays(today, 12));
  const dRecYearly = ymdCompact(addDays(today, 6));

  const text = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//maewmeet E2E//EN',
    'BEGIN:VEVENT',
    'SUMMARY:ประชุมวางแผน E2E',
    'DESCRIPTION:ไม่ควรถูกเก็บ',
    `DTSTART;TZID=Asia/Bangkok:${dTimed}T091500`,
    `DTEND;TZID=Asia/Bangkok:${dTimed}T104500`,
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:ทริปต่างจังหวัด E2E',
    `DTSTART;VALUE=DATE:${dAllStart}`,
    `DTEND;VALUE=DATE:${dAllEndExcl}`,
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:เรียนประจำสัปดาห์ E2E',
    `DTSTART;TZID=Asia/Bangkok:${dRecWeekly}T140000`,
    `DTEND;TZID=Asia/Bangkok:${dRecWeekly}T150000`,
    'RRULE:FREQ=WEEKLY;COUNT=2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:นัดซ้ำรายปีซับซ้อน',
    `DTSTART;TZID=Asia/Bangkok:${dRecYearly}T100000`,
    `DTEND;TZID=Asia/Bangkok:${dRecYearly}T110000`,
    'RRULE:FREQ=YEARLY',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  return Buffer.from(text, 'utf8');
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const w = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth,
    b: document.body.scrollWidth,
  }));
  expect(w.s, `${label}: documentElement ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
  expect(w.b, `${label}: body ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
}

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test(`${locale} · ${theme}: อัปโหลด .ics → preview + skipped + hideDetail เปิดเริ่มต้น → นำเข้า → อัปโหลดซ้ำเห็นซ้ำ`, async ({
      page,
      context,
      baseURL,
      user,
    }) => {
      void user;
      await setPrefs(context, baseURL!, { locale, theme });
      const problems = watchConsole(page);
      const gid = await createGroupApi(page.request, `ICS ${Math.random().toString(36).slice(2, 7)}`);

      await go(page, `/calendar?g=${gid}&v=mine`);
      const openBtn = page.getByTestId('ics-import-open');
      await expect(openBtn).toBeVisible();
      await expect(openBtn).toContainText(msg(locale, 'busy.import.button'));
      await assertNoOverflow(page, `${locale}/${theme} mine`);

      // ขั้น 1: เปิด Sheet เลือกไฟล์
      await openBtn.click();
      const sheet = page.getByTestId('ics-import-sheet');
      await expect(sheet).toBeVisible();
      const pickBox = await page.getByTestId('ics-pick-button').boundingBox();
      expect(pickBox?.height ?? 0, 'เป้าแตะเลือกไฟล์ ≥ 44px').toBeGreaterThanOrEqual(44);
      await expect(page.getByTestId('ics-window-90')).toHaveAttribute('aria-pressed', 'true');
      await assertNoOverflow(page, `${locale}/${theme} step-pick`);

      // อัปโหลดไฟล์ตัวอย่าง
      const sample = buildSampleIcs();
      await page.getByTestId('ics-file-input').setInputFiles({
        name: 'my-calendar.ics',
        mimeType: 'text/calendar',
        buffer: sample,
      });

      // ขั้น 2: Preview — เห็น 4 รายการ (2 เดี่ยว + 2 แตกจาก RRULE WEEKLY COUNT=2), hideDetail เปิดเป็นค่าเริ่มต้น, เห็นปัดเวลา, เห็น skipped RRULE ซับซ้อน
      await expect(page.getByTestId('ics-preview-list')).toBeVisible();
      await expect(page.getByTestId('ics-hide-detail')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('ics-rounded-note')).toBeVisible();
      await expect(page.getByTestId('ics-preview-quota')).toContainText('0/300');
      await expect(page.getByTestId('ics-item-check-0')).toBeChecked();
      await expect(page.getByTestId('ics-item-check-1')).toBeChecked();
      await expect(page.getByTestId('ics-item-check-2')).toBeChecked();
      await expect(page.getByTestId('ics-item-check-3')).toBeChecked();
      await expect(page.getByTestId('ics-item-rounded-0')).toBeVisible();

      // ขยายรายละเอียดที่ข้าม → เห็นไอคอนลูกศร + RRULE
      const details = page.getByTestId('ics-skipped-details');
      await expect(details).toBeVisible();
      await expect(details.locator('summary svg.ics-skipped-chevron')).toBeVisible();
      await details.locator('summary').click();
      await expect(page.getByTestId('ics-skip-rrule')).toBeVisible();
      await assertNoOverflow(page, `${locale}/${theme} step-preview`);

      // ยืนยัน alert-info ใช้สี info (--accent-soft) ไม่ใช่สี error (--danger-soft)
      const infoColors = await page.getByTestId('ics-rounded-note').evaluate((el) => {
        const probe = document.createElement('div');
        probe.className = 'alert';
        el.parentElement?.appendChild(probe);
        const infoBg = getComputedStyle(el).backgroundColor;
        const errBg = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { infoBg, errBg };
      });
      expect(infoColors.infoBg).not.toBe(infoColors.errBg);

      // ยืนยันนำเข้า
      const submitBtn = page.getByTestId('ics-import-submit');
      await expect(submitBtn).toBeEnabled();
      await submitBtn.click();

      // ปิด sheet + ขึ้น toast + เห็นทั้งรายการเดี่ยวและรายการที่แตกจาก RRULE ในปฏิทินของฉัน
      await expect(sheet).toHaveCount(0);
      await expect(page.getByTestId('cal-toast')).toBeVisible();
      const mineList = page.getByTestId('busy-mine-list');
      await expect(mineList).toBeVisible();
      await expect(mineList).toContainText('ประชุมวางแผน E2E');
      await expect(mineList).toContainText('ทริปต่างจังหวัด E2E');
      await expect(mineList).toContainText('เรียนประจำสัปดาห์ E2E');

      // อัปโหลดไฟล์เดิมซ้ำ → ทุกรายการติดสถานะซ้ำ ไม่ติ๊กเลือกเริ่มต้น และปุ่มนำเข้า disabled
      await openBtn.click();
      await expect(sheet).toBeVisible();
      await page.getByTestId('ics-file-input').setInputFiles({
        name: 'my-calendar.ics',
        mimeType: 'text/calendar',
        buffer: sample,
      });
      await expect(page.getByTestId('ics-all-duplicates')).toBeVisible();
      await expect(page.getByTestId('ics-item-dup-0')).toBeVisible();
      await expect(page.getByTestId('ics-item-dup-1')).toBeVisible();
      await expect(page.getByTestId('ics-item-check-0')).not.toBeChecked();
      await expect(page.getByTestId('ics-item-check-1')).not.toBeChecked();
      await expect(page.getByTestId('ics-select-all')).toBeDisabled();
      await expect(page.getByTestId('ics-select-none')).toBeDisabled();
      await expect(page.getByTestId('ics-import-submit')).toBeDisabled();

      // ถ้าผู้ใช้ติ๊กเลือกรายการซ้ำเอง ปุ่ม "ไม่เลือก" เปิดให้ล้างได้ ส่วน "เลือกทั้งหมด" ยังคงปิด
      await page.getByTestId('ics-item-check-0').check();
      await expect(page.getByTestId('ics-select-all')).toBeDisabled();
      await expect(page.getByTestId('ics-select-none')).toBeEnabled();
      await page.getByTestId('ics-select-none').click();
      await expect(page.getByTestId('ics-item-check-0')).not.toBeChecked();
      await expect(page.getByTestId('ics-select-none')).toBeDisabled();

      expect(problems).toEqual([]);
    });
  }
}

test('ไฟล์ไม่ใช่ .ics แสดง error และ /privacy แสดงคำอธิบายการนำเข้า .ics ทั้ง TH/EN', async ({ page, context, baseURL, user }) => {
  void user;
  await setPrefs(context, baseURL!, { locale: 'th', theme: 'light' });
  const gid = await createGroupApi(page.request, `ICS err ${Math.random().toString(36).slice(2, 7)}`);

  await go(page, `/calendar?g=${gid}&v=mine`);
  await page.getByTestId('ics-import-open').click();
  await page.getByTestId('ics-file-input').setInputFiles({
    name: 'broken.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from('not a calendar file', 'utf8'),
  });
  await expect(page.getByTestId('ics-import-error')).toBeVisible();
  await expect(page.getByTestId('ics-import-error')).toContainText(msg('th', 'errors.ICS_INVALID'));

  // เปิด preview จากไฟล์ดี แล้วเปลี่ยนเป็นไฟล์เสีย → ชื่อไฟล์เดิมต้องไม่ถูกทับด้วยชื่อไฟล์เสีย
  await page.getByTestId('ics-file-input').setInputFiles({
    name: 'good-keep.ics',
    mimeType: 'text/calendar',
    buffer: buildSampleIcs(),
  });
  await expect(page.getByTestId('ics-preview-list')).toBeVisible();
  await expect(page.locator('.ics-file-name')).toContainText('good-keep.ics');

  await page.getByTestId('ics-file-input').setInputFiles({
    name: 'broken-second.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from('still not an ics file', 'utf8'),
  });
  await expect(page.getByTestId('ics-import-error')).toBeVisible();
  await expect(page.locator('.ics-file-name')).toContainText('good-keep.ics');
  await expect(page.locator('.ics-file-name')).not.toContainText('broken-second.ics');

  for (const loc of LOCALES) {
    await setPrefs(context, baseURL!, { locale: loc });
    await page.goto('/privacy', { waitUntil: 'networkidle' });
    await expect(page.getByText(msg(loc, 'privacy.calendar.import'))).toBeVisible();
  }
});
