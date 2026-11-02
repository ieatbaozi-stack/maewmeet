// ตัวช่วย E2E ของ R6F (ลง busy หลายวันเฉพาะช่วงเวลา) — ท่าทางผ่าน UI จริง · ตั้งฉากผ่าน API
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from './support/auth';
import { addDays, todayBkk, type DateISO } from './support/busy';
import { openCalendar, addButton } from './support/calendar-ui';
import { api } from './support/groups';

/** วันเริ่ม (นับจากวันนี้ ≥ minAhead) ที่ช่วง span วันอยู่ในเดือนเดียวกัน — ตัวเลือกวันของฟอร์มเลื่อนเดือนไม่ต้อง */
export function sameMonthSpan(minAhead: number, span: number): { start: DateISO; end: DateISO } {
  for (let n = minAhead; n < minAhead + 40; n++) {
    const start = addDays(todayBkk(), n);
    const end = addDays(start, span - 1);
    if (start.slice(0, 7) === end.slice(0, 7)) return { start, end };
  }
  throw new Error('ไม่พบช่วงในเดือนเดียวกัน');
}

export type OwnRow = { id: string; allDay: boolean; startAt: number; endAt: number; title: string | null; seriesId?: string | null; localStartDate: string };

export async function listOwn(request: APIRequestContext): Promise<OwnRow[]> {
  const r = await api(request, 'GET', '/api/me/busy');
  return (JSON.parse(r.text) as { data: { busy: OwnRow[] } }).data.busy;
}

/** POST /api/me/busy kind daily ผ่าน API (ต้อง 201) — คืน { seriesId, count } */
export async function createDailyApi(
  request: APIRequestContext,
  b: { startDate: DateISO; endDate: DateISO; startTime: string; endTime: string; title?: string },
): Promise<{ seriesId: string | null; count: number }> {
  const r = await api(request, 'POST', '/api/me/busy', { kind: 'daily', ...b });
  if (r.status !== 201) throw new Error(`create daily: ${r.status} ${r.text}`);
  return (JSON.parse(r.text) as { data: { seriesId: string | null; count: number } }).data;
}

/** เปิดฟอร์มลงใหม่แบบ "หลายวัน" ช่วง start..end (ต้องอยู่เดือนเดียวกัน) — ยังไม่เลือกเฉพาะช่วงเวลา */
export async function openMultiForm(page: Page, gid: string, start: DateISO, end: DateISO) {
  await openCalendar(page, { gid, view: 'day', date: start });
  await expect(page.getByTestId('cal-day-panel')).toHaveAttribute('data-date', start);
  await addButton(page).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('busy-form')).toBeVisible();
  const ok = sheet.getByTestId('busy-notice-ok');
  if (await ok.isVisible()) await ok.click();
  await sheet.getByTestId('busy-type-multi').click();
  const picker = sheet.getByTestId('busy-picker');
  await expect(picker).toBeVisible();
  await picker.getByTestId(`pk-${start}`).click();
  await picker.getByTestId(`pk-${end}`).click();
  await expect(picker).toHaveCount(0);
  return sheet;
}

/** ต่อจาก openMultiForm: เลือก "เฉพาะช่วงเวลา" + เวลา + ชื่อ */
export async function chooseDaily(sheet: ReturnType<Page['getByRole']>, o: { start: string; end: string; title?: string }): Promise<void> {
  await sheet.getByTestId('busy-scope-daily').click();
  await expect(sheet.getByTestId('busy-scope-daily')).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByTestId('busy-start-time').selectOption(o.start);
  await sheet.getByTestId('busy-end-time').selectOption(o.end);
  if (o.title) await sheet.getByTestId('busy-title').fill(o.title);
}
