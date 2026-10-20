// ท่าทางบนหน้าปฏิทิน (R3) — ผูกกับ data-testid/aria ที่ Front-end ใช้จริง (src/components/calendar/**, src/components/busy/**)
// เปลี่ยนตัวเลือกที่นี่ที่เดียวถ้า UI เปลี่ยน · ข้อความทุกอย่างมาจาก messages/*.json ผ่าน msg() (ไม่ hard-code คำ)
import type { Page } from '@playwright/test';
import { expect } from './auth';
import { go } from './groups';
import { msg, type Locale } from './messages';
import type { DateISO } from './busy';

export type CalView = 'month' | 'day' | 'mine';

/** เปิดแท็บปฏิทินที่กลุ่ม/มุมมอง/วันที่ตาม search param (?g ?v ?d) — เส้นทางที่ Front-end จำไว้ให้แชร์ลิงก์ได้ */
export async function openCalendar(page: Page, o: { gid?: string; view?: CalView; date?: DateISO } = {}): Promise<void> {
  const q = new URLSearchParams();
  if (o.gid) q.set('g', o.gid);
  if (o.view) q.set('v', o.view);
  if (o.date) q.set('d', o.date);
  await go(page, `/calendar${q.size ? `?${q}` : ''}`);
}

export const cell = (page: Page, date: DateISO) => page.getByTestId(`cal-cell-${date}`);
export const monthGrid = (page: Page) => page.getByTestId('cal-month');
export const toast = (page: Page) => page.getByTestId('cal-toast');
export const addButton = (page: Page) => page.locator('[data-testid="busy-add"], [data-testid="busy-add-top"]').filter({ visible: true }).first();

export type NewBusy = {
  kind: 'allDay' | 'timed' | 'multi';
  /** allDay/timed: วันนั้น (ต้องตรงกับวันที่เปิดมุมมองวันไว้) · multi: วันเริ่ม */
  date: DateISO;
  /** multi: วันสุดท้าย (ต้องอยู่ในเดือนเดียวกับ date) */
  endDate?: DateISO;
  start?: string;
  end?: string;
  title?: string;
  note?: string;
  hide?: boolean;
};

/**
 * ลง busy ผ่านฟอร์มจริง: เปิดมุมมองวันของ `date` (ฟอร์มตั้งต้นที่วันนั้น) → กดลงวันไม่ว่าง → เลือกแบบ/เวลา/ข้อความ → บันทึก → รอแถบ "บันทึกแล้ว"
 * คืน sheet (ปิดแล้ว) ไม่ได้ — คืนว่าง · ใช้กับผู้ใช้ที่ล็อกอินอยู่ใน page
 */
export async function addBusyViaUi(page: Page, locale: Locale, gid: string, b: NewBusy): Promise<void> {
  await openCalendar(page, { gid, view: 'day', date: b.date });
  await expect(page.getByTestId('cal-day-panel')).toHaveAttribute('data-date', b.date);
  await addButton(page).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('busy-form')).toBeVisible();
  // การ์ดประกาศครั้งแรก (ไม่บล็อก) — ปิดถ้ามี เพื่อให้เลย์เอาต์คงที่
  const ok = sheet.getByTestId('busy-notice-ok');
  if (await ok.isVisible()) await ok.click();

  const kindBtn = (k: NewBusy['kind']) => sheet.getByTestId(`busy-type-${k}`);
  if (b.kind !== 'allDay') await kindBtn(b.kind).click();
  await expect(kindBtn(b.kind)).toHaveAttribute('aria-pressed', 'true');

  if (b.kind === 'multi') {
    // ตัวเลือกวันเปิดเองเมื่อเลือกแบบหลายวัน: แตะวันเริ่ม แล้วแตะวันสุดท้าย
    const picker = sheet.getByTestId('busy-picker');
    await expect(picker).toBeVisible();
    await picker.getByTestId(`pk-${b.date}`).click();
    await picker.getByTestId(`pk-${b.endDate!}`).click();
    await expect(picker).toHaveCount(0); // เลือกครบแล้วพับ
  }
  if (b.kind === 'timed') {
    await sheet.getByTestId('busy-start-time').selectOption(b.start!);
    await sheet.getByTestId('busy-end-time').selectOption(b.end!);
  }
  if (b.title) await sheet.getByTestId('busy-title').fill(b.title);
  if (b.hide) await sheet.getByTestId('busy-hide').click();
  if (b.note) await sheet.getByTestId('busy-note').fill(b.note);
  await sheet.getByTestId('busy-submit').click();
  await expect(sheet).toHaveCount(0);
  await expect(toast(page)).toContainText(msg(locale, 'busy.toast.saved'));
}

/** ข้อความทั้งหน้า (innerText) + HTML เต็ม — ใช้สแกน canary */
export async function pageDump(page: Page): Promise<string> {
  const [text, html] = await Promise.all([page.locator('body').innerText(), page.content()]);
  return `${text}\n${html}`;
}
