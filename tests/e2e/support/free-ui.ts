// ท่าทางบนมุมมอง "ว่างตรงกัน" (R4A, ?v=free) — ผูกกับ data-testid ที่ Front-end ใช้จริง (src/components/availability/**)
// เปลี่ยนตัวเลือกที่นี่ที่เดียวถ้า UI เปลี่ยน · ข้อความทุกอย่างมาจาก messages/*.json ผ่าน msg()
import type { Page } from '@playwright/test';
import { addDays, isoWeekday, todayBkk, type DateISO } from './busy';
import { openCalendar } from './calendar-ui';

export const openFree = (page: Page, o: { gid?: string; date?: DateISO } = {}) => openCalendar(page, { ...o, view: 'free' });

export const freeCell = (page: Page, date: DateISO) => page.getByTestId(`free-cell-${date}`);
export const freeMonth = (page: Page) => page.getByTestId('free-month');
export const freeSummary = (page: Page) => page.getByTestId('free-summary');
export const freeDay = (page: Page) => page.getByTestId('free-detail');
export const freeSolo = (page: Page) => page.getByTestId('free-solo');
export const freeNobody = (page: Page) => page.getByTestId('free-nobody');
export const freeCreate = (page: Page) => page.getByTestId('free-create');

/** จันทร์แรกที่ห่างจากวันนี้ ≥ minAhead วัน (อนาคตเสมอ — ฟอร์ม busy รับ) */
export function mondayAhead(minAhead = 14): DateISO {
  const t = addDays(todayBkk(), minAhead);
  return addDays(t, (7 - isoWeekday(t)) % 7);
}

export function availabilityApi(request: import('@playwright/test').APIRequestContext, gid: string, from: DateISO, to: DateISO) {
  return import('./groups').then(({ api }) => api(request, 'GET', `/api/groups/${gid}/availability?from=${from}&to=${to}`));
}

/** แตะวัน → รายละเอียดวันนั้นขึ้น (มือถือ: ปิด sheet เดิมก่อน เพราะ sheet เป็น modal บังตาราง · iPad: แผงขวาเปลี่ยนเอง) */
export async function closeSheet(page: Page): Promise<void> {
  const dlg = page.getByRole('dialog');
  if (await dlg.count()) {
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
  }
}

export async function pickDay(page: Page, date: DateISO): Promise<void> {
  await closeSheet(page);
  await freeCell(page, date).click();
  await page.getByTestId('free-detail').and(page.locator(`[data-date="${date}"]`)).waitFor();
}
