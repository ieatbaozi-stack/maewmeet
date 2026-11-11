// R14b (หน้าจอ) — busy แบบ routine ในเบราว์เซอร์จริง · R14_CONTRACT §4 R14-8 · 375/390/768 (ทุก project) × th/en × สว่าง/มืด
//   story      สร้างจากปุ่ม "ทำงาน" + "ทั้งเดือนนี้" → อีกบัญชีเห็นว่าไม่ว่าง (ซ่อนรายละเอียด = แค่ "ไม่ว่าง") → ลบวันเดียว → แก้ทั้งหมดไม่ฟื้นวัน
//              → ลบทั้งหมดพร้อมยืนยัน · แล้วชุดสัปดาห์: แก้ตั้งแต่สัปดาห์ที่ 3 (แยกสองชุด) → หยุดตั้งแต่สัปดาห์ที่ 4 → ลบทั้งหมด
//   form       ปุ่มลัดวัน · hint จาง · ข้ามเที่ยงคืน · จบ 24:00 · ลงจริงแล้วแถวใน DB ถูก
//   errors     LIMIT_REACHED routines (ตั้งฉาก 10 ชุดผ่าน API) · NO_OCCURRENCE (ลง/แก้) · ป้าย "ใกล้เต็ม"
//   truncated  availability.detailTruncated (ตั้งฉาก 6,500 แถวด้วย SQL)
// วันที่: "วันนี้" = เวลาจริง (Asia/Bangkok) เหมือนสเปกอื่น (next start เป็นโปรเซสแยก ไม่มี hook นาฬิกา) → คำนวณวันสัมพัทธ์ด้วย support/busy.ts
//   จำนวนวันของ "ทั้งเดือนนี้" ขึ้นกับวันนี้ → ตรวจเป็น "สรุปก่อนบันทึก = toast = แถวใน DB" และอยู่ในช่วง [lo, hi] ที่คิดจากปฏิทินอิสระ
//   (hi นับรวมวันนี้ · lo ไม่นับวันนี้ เผื่อเซิร์ฟเวอร์ตัดแถววันนี้ที่เวลาจบผ่านไปแล้ว)
// ผู้ใช้ใหม่ต่อเทสต์ (rate limit routine 20 ต่อ 10 นาทีต่อผู้ใช้)
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './support/auth';
import { addDays, addMonths, canary, isoWeekday, monthOf, todayBkk, type DateISO } from './support/busy';
import { openCalendar, pageDump } from './support/calendar-ui';
import { E2E_DATABASE_URL } from './support/env';
import { measureLayout, watchConsole } from './support/fixtures';
import { api, checkLayout, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';
import { makeScene } from './support/appt';
import { freeDay, openFree, pickDay } from './support/free-ui';

type Row = { id: string; allDay: boolean; startAt: number; endAt: number; title: string | null; localStartDate: string; routineId?: string | null };
type Routine = { id: string; remaining: number; startDate: DateISO; endDate: DateISO; rangeKind: 'weeks' | 'months'; weekdays: number[]; startTime: string | null; endTime: string | null; title: string | null };

const DAY_MS = 86_400_000;
const WD_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const COMBOS: { loc: Locale; theme: Theme }[] = [
  { loc: 'th', theme: 'light' },
  { loc: 'en', theme: 'dark' },
];

// ───────── วันที่ (pure · อิสระจากโค้ดแอป) ─────────
const mondayOf = (d: DateISO): DateISO => addDays(d, -isoWeekday(d));
const monthEndOf = (d: DateISO): DateISO => addDays(`${addMonths(monthOf(d), 1)}-01`, -1);
/** จำนวนวันในช่วง from..to (รวมปลาย) ที่ ISO weekday (1=จ.…7=อา.) อยู่ใน days */
function countDays(from: DateISO, to: DateISO, days: readonly number[]): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (days.includes(isoWeekday(d) + 1)) n++;
  return n;
}
/** ช่วงที่คาดของจำนวนวัน: hi นับรวมวันนี้ · lo ตัดวันนี้ออก (ถ้าวันนี้ตรงวันที่เลือก) */
function expectedRange(from: DateISO, to: DateISO, days: readonly number[], today: DateISO): [number, number] {
  const hi = countDays(from < today ? today : from, to, days);
  const lo = countDays(addDays(from < today ? today : from, from < today ? 1 : 0), to, days);
  return [lo, hi];
}
/** นาทีของวัน (UTC) จาก epoch ms — เวลาไทย 20:00 = 13:00 UTC = 780 */
const utcMinute = (ms: number): number => Math.floor(ms / 60_000) % 1440;
const WORK = [1, 2, 3, 4, 5] as const;

// ───────── API ─────────
async function rowsIn(request: APIRequestContext, from: DateISO, to: DateISO): Promise<Row[]> {
  const r = await api(request, 'GET', `/api/me/busy?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  return (JSON.parse(r.text) as { data: { busy: Row[] } }).data.busy;
}
const routineRowsIn = async (request: APIRequestContext, from: DateISO, to: DateISO) => (await rowsIn(request, from, to)).filter((r) => r.routineId).sort((a, b) => a.startAt - b.startAt);
const horizon = (): { from: DateISO; to: DateISO } => ({ from: todayBkk(), to: addDays(todayBkk(), 50) });

async function routinesOf(request: APIRequestContext): Promise<Routine[]> {
  const r = await api(request, 'GET', '/api/me/busy-routines');
  expect(r.status, r.text).toBe(200);
  return (JSON.parse(r.text) as { data: { routines: Routine[] } }).data.routines;
}

async function postRoutine(request: APIRequestContext, body: Record<string, unknown>): Promise<Routine> {
  const r = await api(request, 'POST', '/api/me/busy-routines', body);
  expect(r.status, `POST routine: ${r.text}`).toBe(201);
  return (JSON.parse(r.text) as { data: { routine: Routine } }).data.routine;
}

/** เก็บ body ของ response /api/* ทั้งหมดที่หน้านี้ได้รับ — settled() รอให้อ่านครบ */
function recordApi(page: Page): { bodies: { path: string; text: string }[]; settled: () => Promise<unknown> } {
  const bodies: { path: string; text: string }[] = [];
  const pending: Promise<unknown>[] = [];
  page.on('response', (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/api/')) return;
    pending.push(
      res.text().then(
        (t) => void bodies.push({ path: u.pathname + u.search, text: t }),
        () => undefined,
      ),
    );
  });
  return { bodies, settled: () => Promise.allSettled(pending) };
}

// ───────── ท่าทางบนหน้าจอ ─────────
const dialogs = (p: Page) => p.getByRole('dialog');
const toastOf = (p: Page) => p.getByTestId('cal-toast');

async function openRoutineForm(page: Page, gid: string) {
  await openCalendar(page, { gid, view: 'mine' });
  await page.getByTestId('routine-add').click();
  const sheet = dialogs(page);
  await expect(sheet.getByTestId('routine-form')).toBeVisible();
  return sheet;
}

async function pickPreset(sheet: ReturnType<typeof dialogs>, id: 'work' | 'class' | 'gym' | 'weekend' | 'custom') {
  await sheet.getByTestId(`routine-preset-${id}`).click();
  await expect(sheet.getByTestId(`routine-preset-${id}`)).toHaveAttribute('aria-pressed', 'true');
}

async function pickShortcut(sheet: ReturnType<typeof dialogs>, id: 'thisMonth' | 'next4Weeks' | 'next3Months') {
  await sheet.getByTestId(`routine-shortcut-${id}`).click();
  await expect(sheet.getByTestId(`routine-kind-${id === 'next4Weeks' ? 'weeks' : 'months'}`)).toHaveAttribute('aria-pressed', 'true');
}

/** จำนวนวันจากบรรทัด "จะลง N วัน" ของสรุปก่อนบันทึก */
async function summaryCount(sheet: ReturnType<typeof dialogs>): Promise<number> {
  const text = (await sheet.getByTestId('routine-summary-days').innerText()).trim();
  const m = /\d+/.exec(text);
  if (!m) throw new Error(`สรุปไม่มีตัวเลข: ${text}`);
  return Number(m[0]);
}

// ═════════════════════════════════════════════════════════════
// เรื่องเล่าหลัก R14-8
// ═════════════════════════════════════════════════════════════
for (const { loc, theme } of COMBOS) {
  test(`R14-8 story ${loc}/${theme}: ทำงาน+ทั้งเดือนนี้ → อีกบัญชีเห็นไม่ว่าง → ลบวันเดียว → แก้ทั้งหมด → ลบทั้งหมด · แล้วชุดสัปดาห์: แก้ตั้งแต่สัปดาห์ที่ 3 → หยุดตั้งแต่สัปดาห์ที่ 4 → ลบทั้งหมด`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(420_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann', 'Bob'] });
    const [A, B] = [scene.members[0]!, scene.members[1]!];
    const a = A.page;
    const problems = watchConsole(a);
    const bProblems = watchConsole(B.page);
    const bApi = recordApi(B.page);
    const today = todayBkk();
    const { from: winFrom, to: winTo } = horizon();
    const title = canary('title');
    const note = canary('note');

    // ───── 1) สร้างจากปุ่ม "ทำงาน" + "ทั้งเดือนนี้" ─────
    // เดือนนี้เหลือวันทำงานหลังวันนี้ < 3 วัน (ท้ายเดือน) → ใช้ "4 สัปดาห์จากนี้" แทน เพื่อไม่ให้เรื่องเล่าว่างเปล่า
    const useMonth = countDays(addDays(today, 1), monthEndOf(today), WORK) >= 3;
    const rangeEnd = useMonth ? monthEndOf(today) : addDays(mondayOf(today), 27);
    const [lo, hi] = expectedRange(today, rangeEnd, WORK, today);

    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    // ยังไม่มีอะไร: ปุ่มเริ่มทั้งหัวหน้าและสถานะว่าง
    await expect(a.getByTestId('routine-add')).toBeVisible();
    await expect(a.getByTestId('routine-add-empty-mine')).toBeVisible();
    await a.getByTestId('routine-add').click();
    const sheet = dialogs(a);
    await expect(sheet.getByTestId('routine-form')).toBeVisible();

    // validation hint "เลือกอย่างน้อย 1 วัน" จางจนกว่าผู้ใช้ทำให้ว่างเอง (ไม่ใช่ alert ตั้งแต่เปิดฟอร์ม) · บันทึกไม่ได้
    const required = sheet.getByTestId('routine-weekdays-required');
    await expect(required).toContainText(T('busy.routine.weekdays.required'));
    await expect(required).not.toHaveAttribute('role', 'alert');
    await expect(required).toHaveClass(/rt-required-muted/);
    await expect(sheet.getByTestId('routine-submit')).toBeDisabled();
    await expect(sheet.getByTestId('routine-summary')).toHaveCount(0);

    await pickPreset(sheet, 'work');
    for (const d of [1, 2, 3, 4, 5]) await expect(sheet.getByTestId(`routine-day-${d}`)).toHaveAttribute('aria-pressed', 'true');
    for (const d of [6, 7]) await expect(sheet.getByTestId(`routine-day-${d}`)).toHaveAttribute('aria-pressed', 'false');
    await expect(sheet.getByTestId('routine-start')).toHaveValue('09:00');
    await expect(sheet.getByTestId('routine-end')).toHaveValue('18:00');
    await expect(sheet.getByTestId('routine-title')).toHaveValue(T('busy.routine.preset.work'));
    await expect(required).toHaveCount(0);
    // ชื่อ/ซ่อนรายละเอียด/บันทึกส่วนตัว: canary เพื่อตรวจว่าไม่รั่วถึงอีกบัญชี
    await sheet.getByTestId('routine-title').fill(title);
    await sheet.getByTestId('routine-hide').click();
    await expect(sheet.getByTestId('routine-hide')).toHaveAttribute('aria-checked', 'true');
    await sheet.getByTestId('routine-note').fill(note);
    await pickShortcut(sheet, useMonth ? 'thisMonth' : 'next4Weeks');
    const n1 = await summaryCount(sheet);
    expect(n1, `สรุป ${n1} ต้องอยู่ใน [${lo}, ${hi}]`).toBeGreaterThanOrEqual(lo);
    expect(n1).toBeLessThanOrEqual(hi);
    await expect(sheet.getByTestId('routine-summary-days')).toHaveText(T('busy.routine.summary.days', { count: n1 }));
    await expect(sheet.getByTestId('routine-summary')).toContainText('09:00');
    await expect(sheet.getByTestId('routine-summary')).toContainText('18:00');
    // "ทุกกลุ่มที่คุณอยู่จะเห็นช่วงนี้" (D5) + วิธีซ่อน
    await expect(sheet.getByTestId('routine-visibility')).toContainText(T('busy.routine.visibility'));
    await expect(sheet.getByTestId('routine-visibility')).toContainText(T('busy.form.visibilityGroups', { count: 1 }));
    await expect(sheet.getByTestId('routine-submit')).toHaveText(T('busy.routine.form.submit', { count: n1 }));
    await checkLayout(a, testInfo, 'r14b-form', loc, theme);
    await sheet.getByTestId('routine-submit').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toastOf(a)).toContainText(T('busy.routine.toast.saved', { count: n1 }));

    // แถวใน DB ตรงกับสรุป/toast
    let rows = await routineRowsIn(A.context.request, winFrom, winTo);
    expect(rows.length, 'แถวที่ลงจริง = สรุป = toast').toBe(n1);
    expect(new Set(rows.map((r) => r.routineId)).size, 'ชุดเดียว').toBe(1);
    expect(rows.every((r) => r.endAt - r.startAt === 9 * 3600_000), '09:00–18:00 = 9 ชม./วัน').toBe(true);
    let routines = await routinesOf(A.context.request);
    expect(routines).toHaveLength(1);
    const r1 = routines[0]!;
    expect(r1.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect([r1.startTime, r1.endTime]).toEqual(['09:00', '18:00']);

    // ───── 2) รายการ "แบบประจำของฉัน": เหลืออีก N วัน (regression: remaining ฝั่งเซิร์ฟเวอร์เคยเป็น 0) ─────
    const before = Date.now();
    const stillAhead = (rs: Row[], t: number) => rs.filter((r) => r.endAt > t).length;
    const remaining = r1.remaining;
    expect(remaining, 'remaining ต้องไม่เป็น 0 (บั๊กเดิม: อ้างคอลัมน์ไม่ระบุตาราง)').toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(n1);
    expect(remaining).toBeGreaterThanOrEqual(stillAhead(rows, Date.now()));
    expect(remaining).toBeLessThanOrEqual(stillAhead(rows, before));
    await expect(a.getByTestId('routine-count')).toHaveText(T('busy.routine.mine.count', { count: 1 }));
    const row = a.getByTestId(`routine-row-${r1.id}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('routine-remaining')).toHaveText(T('busy.routine.mine.remaining', { count: remaining }));
    await expect(row).toContainText(title); // เจ้าของเห็นชื่อจริงแม้ซ่อนจากคนอื่น
    await expect(row).toContainText(T('busy.routine.weekdays.range', { from: T('busy.routine.weekdays.short.mon'), to: T('busy.routine.weekdays.short.fri') }));
    await expect(row).toContainText('09:00');
    await expect(row).toContainText('18:00');
    await expect(row).toContainText(T('busy.mine.hiddenTag'));
    await expect(a.getByTestId('routine-near')).toHaveCount(0);
    await checkLayout(a, testInfo, 'r14b-mine', loc, theme);

    // ───── 3) ป้าย "ประจำ" บนวันของฉัน ─────
    const future = rows.filter((r) => r.localStartDate > today);
    expect(future.length, 'มีอย่างน้อย 2 วันหลังวันนี้').toBeGreaterThanOrEqual(2);
    const [d1, d2] = [future[0]!.localStartDate, future[1]!.localStartDate];
    await openCalendar(a, { gid: scene.gid, view: 'day', date: d1 });
    await expect(a.getByTestId('cal-day-panel')).toHaveAttribute('data-date', d1);
    await expect(a.getByTestId('routine-tag')).toHaveCount(1);
    await expect(a.getByTestId('routine-tag')).toContainText(T('busy.routine.calendar.tag'));
    await expect(a.getByTestId('routine-tag')).toHaveAttribute('aria-label', T('busy.routine.calendar.tagAria'));
    await expect(a.getByTestId('routine-day-edit')).toBeVisible();
    await checkLayout(a, testInfo, 'r14b-day', loc, theme);

    // ───── 4) อีกบัญชี (Bob) เห็นว่า Ann ไม่ว่าง · ซ่อนรายละเอียด = แค่ "ไม่ว่าง" · ไม่รู้ว่ามาจาก routine ─────
    const seg = (s: string, e: string) => T('availability.day.segments.row', { start: s, end: e });
    await openFree(B.page, { gid: scene.gid, date: d1 });
    await pickDay(B.page, d1);
    await expect(freeDay(B.page)).toContainText(seg('18:00', '22:00')); // 08:00–09:00 สั้นกว่าขั้นต่ำ 120 นาที → ไม่นับเป็นช่วงว่างร่วม
    await expect(freeDay(B.page).getByText(seg('08:00', '18:00'))).toHaveCount(0);
    await expect(freeDay(B.page).getByTestId(`free-blocker-${A.userId}`)).toContainText(T('calendar.day.busyPlain'));
    await expect(freeDay(B.page)).not.toContainText(title);
    await openCalendar(B.page, { gid: scene.gid, view: 'day', date: d1 });
    const bPanel = B.page.getByTestId('cal-day-panel');
    await expect(bPanel).toHaveAttribute('data-date', d1);
    await expect(bPanel).toContainText(T('calendar.day.busyPlain'));
    await expect(bPanel).not.toContainText(title);
    await expect(B.page.getByTestId('routine-tag')).toHaveCount(0);
    await expect(B.page.getByTestId('routine-day-edit')).toHaveCount(0);
    // ทุก response /api/* ที่ Bob ได้รับ (รวมที่ยิงตรง) ต้องไม่มี routineId / rangeKind / weekdays / canary
    for (const q of [`calendar?from=${winFrom}&to=${winTo}`, `availability?from=${winFrom}&to=${winTo}`]) {
      const r = await api(B.context.request, 'GET', `/api/groups/${scene.gid}/${q}`);
      expect(r.status, r.text).toBe(200);
      expect(r.text.length, 'มีข้อมูลของ Ann อยู่จริง (ไม่ใช่ตอบว่าง)').toBeGreaterThan(200);
      bApi.bodies.push({ path: `/api/groups/${scene.gid}/${q}`, text: r.text });
    }
    await bApi.settled();
    expect(bApi.bodies.some((x) => x.path.includes('/availability')), 'ตรวจ availability').toBe(true);
    expect(bApi.bodies.some((x) => x.path.includes('/calendar')), 'ตรวจปฏิทินกลุ่ม').toBe(true);
    // หน้าแรกฝังข้อมูลมากับ SSR (ไม่ผ่าน /api) → สแกนทั้ง DOM ของ Bob ด้วย (ตัด "weekdays" ออก เพราะเป็นคีย์ในแค็ตตาล็อกข้อความ)
    const dump = await pageDump(B.page);
    expect(dump, 'DOM ของ Bob ต้องไม่มี routineId/rangeKind/canary').not.toMatch(/routineId|rangeKind|CANARY-/);
    for (const x of bApi.bodies) {
      expect(x.text, `${x.path} ต้องไม่มี routineId/rangeKind/weekdays`).not.toMatch(/routineId|rangeKind|"weekdays"/);
      expect(x.text, `${x.path} ต้องไม่มี canary`).not.toMatch(/CANARY-/);
      expect(x.path, 'Bob ไม่เรียก API ของ routine').not.toContain('busy-routines');
    }

    // ───── 5) ลบวันเดียว: วันนั้นหาย วันอื่นอยู่ ─────
    await openCalendar(a, { gid: scene.gid, view: 'day', date: d1 });
    await expect(a.getByTestId('routine-tag')).toHaveCount(1);
    await a.getByTestId('routine-day-delete').click();
    const scope = a.getByTestId('routine-scope');
    await expect(scope).toHaveAttribute('data-action', 'delete');
    await expect(a.getByTestId('routine-scope-one')).toBeVisible();
    await expect(a.getByTestId('routine-scope-all')).toBeVisible();
    await checkLayout(a, testInfo, 'r14b-scope-delete', loc, theme);
    await a.getByTestId('routine-scope-one').click();
    await expect(a.getByTestId('routine-scope')).toHaveCount(0);
    await expect(toastOf(a)).toContainText(T('busy.routine.toast.deletedOne'));
    await expect(a.getByTestId('routine-tag')).toHaveCount(0);
    rows = await routineRowsIn(A.context.request, winFrom, winTo);
    expect(rows).toHaveLength(n1 - 1);
    expect(rows.some((r) => r.localStartDate === d1), 'วันที่ลบหาย').toBe(false);
    expect(rows.some((r) => r.localStartDate === d2), 'วันอื่นยังอยู่').toBe(true);

    // ───── 6) แก้ "ทั้งหมดที่ยังไม่ถึง": จบ 19:00 · วันที่ลบไม่ฟื้น ─────
    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    await a.getByTestId(`routine-open-${r1.id}`).click();
    await expect(a.getByTestId('routine-scope')).toHaveAttribute('data-action', 'edit');
    await expect(a.getByTestId('routine-scope-one')).toHaveCount(0); // แตะจากรายการ ไม่ใช่จากวัน
    await checkLayout(a, testInfo, 'r14b-scope-edit', loc, theme);
    await a.getByTestId('routine-scope-all').click();
    const edit = dialogs(a);
    await expect(edit.getByTestId('routine-editing')).toHaveText(T('busy.routine.form.editing.all'));
    await expect(edit.getByTestId('routine-preset-work')).toHaveCount(0);
    await expect(edit.getByTestId('routine-kind-weeks')).toHaveCount(0);
    await expect(edit.getByTestId('routine-submit')).toHaveText(T('busy.routine.form.submitEdit'));
    await edit.getByTestId('routine-end').selectOption('19:00');
    await edit.getByTestId('routine-submit').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toastOf(a)).toContainText(T('busy.routine.toast.updated'));
    rows = await routineRowsIn(A.context.request, winFrom, winTo);
    expect(rows, 'แก้ทั้งหมดไม่ทำให้วันที่ลบแล้วกลับมา').toHaveLength(n1 - 1);
    expect(rows.some((r) => r.localStartDate === d1)).toBe(false);
    for (const r of rows.filter((x) => x.localStartDate > today)) expect(r.endAt - r.startAt, `${r.localStartDate} ต้องเป็น 10 ชม. หลังแก้`).toBe(10 * 3600_000);
    // อีกบัญชีเห็นเวลาที่แก้ (d2: ว่างร่วมเริ่ม 19:00) และ d1 ว่างทั้งวัน
    await openFree(B.page, { gid: scene.gid, date: d2 });
    await pickDay(B.page, d2);
    await expect(freeDay(B.page)).toContainText(seg('19:00', '22:00'));
    await pickDay(B.page, d1);
    await expect(freeDay(B.page)).toContainText(T('availability.day.status.all'));

    // ───── 7) ลบทั้งหมด: ต้องยืนยัน · ยกเลิกแล้วยังอยู่ · ยืนยันแล้วหายหมด ─────
    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    await a.getByTestId(`routine-delete-${r1.id}`).click();
    await expect(a.getByTestId('routine-scope')).toHaveAttribute('data-action', 'delete');
    await a.getByTestId('routine-scope-all').click();
    const confirm = a.getByRole('alertdialog');
    await expect(confirm).toContainText(T('busy.routine.scope.confirmAll.title'));
    await expect(confirm).toContainText(title);
    await checkLayout(a, testInfo, 'r14b-confirm-all', loc, theme);
    await confirm.getByRole('button', { name: T('common.cancel') }).click();
    await expect(a.getByRole('alertdialog').filter({ hasText: T('busy.routine.scope.confirmAll.title') })).toHaveCount(0); // ยกเลิก = กลับไปที่ sheet ขอบเขต (เป็น alertdialog เหมือนกัน)
    await expect(a.getByTestId('routine-scope')).toBeVisible();
    expect((await routinesOf(A.context.request)).length, 'ยกเลิกแล้วยังไม่ลบ').toBe(1);
    await a.getByTestId('routine-scope-all').click();
    await a.getByRole('alertdialog').getByRole('button', { name: T('busy.routine.scope.confirmAll.confirm') }).click();
    await expect(a.getByRole('alertdialog')).toHaveCount(0);
    await expect(toastOf(a)).toContainText(T('busy.routine.toast.deletedAll'));
    expect(await routinesOf(A.context.request)).toEqual([]);
    expect(await routineRowsIn(A.context.request, winFrom, winTo), 'ไม่เหลือแถวสักวัน').toEqual([]);
    await expect(a.getByTestId('routine-mine')).toHaveCount(0);
    await expect(a.getByTestId('routine-add-empty-mine')).toBeVisible();
    await openFree(B.page, { gid: scene.gid, date: d2 });
    await pickDay(B.page, d2);
    await expect(freeDay(B.page)).toContainText(T('availability.day.status.all')); // อีกบัญชีเห็นว่างแล้ว

    // ───── 8) ชุดสัปดาห์: "ยิม" จ.–ศ. 20:00–21:30 × 4 สัปดาห์ ─────
    const mon0 = mondayOf(today);
    const [w3, w4] = [addDays(mon0, 14), addDays(mon0, 21)];
    const [lo2, hi2] = expectedRange(mon0, addDays(mon0, 27), WORK, today);
    const f2 = await openRoutineForm(a, scene.gid);
    await pickPreset(f2, 'gym');
    await expect(f2.getByTestId('routine-title')).toHaveValue(T('busy.routine.preset.gym'));
    for (const d of [1, 2, 3, 4, 5, 6, 7]) await expect(f2.getByTestId(`routine-day-${d}`)).toHaveAttribute('aria-pressed', 'false'); // ยิม: วันให้เลือกเอง
    await f2.getByTestId('routine-quick-weekdays').click();
    await expect(f2.getByTestId('routine-quick-weekdays')).toHaveAttribute('aria-pressed', 'true');
    await f2.getByTestId('routine-start').selectOption('20:00');
    await f2.getByTestId('routine-end').selectOption('21:30');
    await pickShortcut(f2, 'next4Weeks');
    const n2 = await summaryCount(f2);
    expect(n2).toBeGreaterThanOrEqual(lo2);
    expect(n2).toBeLessThanOrEqual(hi2);
    await f2.getByTestId('routine-submit').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toastOf(a)).toContainText(T('busy.routine.toast.saved', { count: n2 }));
    routines = await routinesOf(A.context.request);
    expect(routines).toHaveLength(1);
    const r2 = routines[0]!;
    expect([r2.rangeKind, r2.startDate, r2.endDate]).toEqual(['weeks', mon0, addDays(mon0, 27)]);
    expect((await routineRowsIn(A.context.request, winFrom, winTo)).length).toBe(n2);

    // ───── 9) แก้ "ตั้งแต่สัปดาห์ที่ 3": แตะวันจันทร์ของสัปดาห์ที่ 3 ในปฏิทิน → แยกเป็นสองชุด ─────
    await openCalendar(a, { gid: scene.gid, view: 'day', date: w3 });
    await expect(a.getByTestId('cal-day-panel')).toHaveAttribute('data-date', w3);
    await a.getByTestId('routine-day-edit').click();
    await expect(a.getByTestId('routine-scope')).toHaveAttribute('data-action', 'edit');
    await expect(a.getByTestId('routine-scope-one')).toBeVisible();
    await expect(a.getByTestId('routine-scope-from')).toContainText(String(Number(w3.slice(8, 10)))); // ช่วงสัปดาห์เป็นวันที่ ไม่ใช่เลขสัปดาห์
    await expect(a.getByTestId('routine-scope-all')).toBeVisible();
    await a.getByTestId('routine-scope-from').click();
    const e2 = dialogs(a);
    await expect(e2.getByTestId('routine-editing')).toBeVisible();
    await expect(e2.getByTestId('routine-from-locked')).toBeVisible();
    await e2.getByTestId('routine-start').selectOption('20:30');
    await e2.getByTestId('routine-end').selectOption('22:00');
    await e2.getByTestId('routine-submit').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toastOf(a)).toContainText(T('busy.routine.toast.updated'));
    routines = (await routinesOf(A.context.request)).sort((p, q) => (p.startDate < q.startDate ? -1 : 1));
    expect(routines, 'แยกเป็นสองชุด').toHaveLength(2);
    expect([routines[0]!.startDate, routines[0]!.endDate]).toEqual([mon0, addDays(mon0, 13)]);
    expect([routines[1]!.startDate, routines[1]!.endDate]).toEqual([w3, addDays(mon0, 27)]);
    rows = await routineRowsIn(A.context.request, winFrom, winTo);
    expect(rows.length, 'จำนวนวันรวมเท่าเดิม').toBe(n2);
    for (const r of rows) expect(utcMinute(r.startAt), `${r.localStartDate}: 20:00 ก่อน w3 · 20:30 ตั้งแต่ w3`).toBe(r.localStartDate < w3 ? 13 * 60 : 13 * 60 + 30);
    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    await expect(a.getByTestId('routine-count')).toHaveText(T('busy.routine.mine.count', { count: 2 }));
    await expect(a.locator('[data-testid^="routine-row-"]')).toHaveCount(2);

    // ───── 10) หยุดตั้งแต่สัปดาห์ที่ 4: ชุดหลังสั้นลง ─────
    await openCalendar(a, { gid: scene.gid, view: 'day', date: w4 });
    await expect(a.getByTestId('cal-day-panel')).toHaveAttribute('data-date', w4);
    await a.getByTestId('routine-day-delete').click();
    await expect(a.getByTestId('routine-scope')).toHaveAttribute('data-action', 'delete');
    await a.getByTestId('routine-scope-from').click();
    await expect(a.getByTestId('routine-scope')).toHaveCount(0);
    await expect(toastOf(a)).toBeVisible();
    await expect(toastOf(a)).not.toContainText(T('busy.routine.error.gone'));
    routines = (await routinesOf(A.context.request)).sort((p, q) => (p.startDate < q.startDate ? -1 : 1));
    expect(routines).toHaveLength(2);
    expect([routines[1]!.startDate, routines[1]!.endDate], 'ชุดหลังจบก่อนสัปดาห์ที่ 4').toEqual([w3, addDays(w4, -1)]);
    rows = await routineRowsIn(A.context.request, winFrom, winTo);
    expect(rows.some((r) => r.localStartDate >= w4), 'สัปดาห์ที่ 4 หายหมด').toBe(false);
    expect(rows.some((r) => r.localStartDate === w3), 'สัปดาห์ที่ 3 ยังอยู่').toBe(true);

    // ───── 11) ลบทั้งหมดทั้งสองชุด ─────
    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    for (const r of routines) {
      await a.getByTestId(`routine-delete-${r.id}`).click();
      await a.getByTestId('routine-scope-all').click();
      await a.getByRole('alertdialog').getByRole('button', { name: T('busy.routine.scope.confirmAll.confirm') }).click();
      await expect(a.getByRole('alertdialog')).toHaveCount(0);
      await expect(a.getByTestId(`routine-row-${r.id}`)).toHaveCount(0);
    }
    expect(await routinesOf(A.context.request)).toEqual([]);
    expect(await rowsIn(A.context.request, winFrom, winTo)).toEqual([]);

    expect(problems, 'console ของ Ann').toEqual([]);
    expect(bProblems, 'console ของ Bob').toEqual([]);
  });
}

// ═════════════════════════════════════════════════════════════
// ฟอร์ม: ปุ่มลัดวัน · ข้ามเที่ยงคืน · 24:00
// ═════════════════════════════════════════════════════════════
for (const { loc, theme } of COMBOS) {
  test(`R14b ฟอร์ม ${loc}/${theme}: ปุ่มลัดวัน · aria-pressed · hint จาง · ข้ามเที่ยงคืน 22:00–06:00 · จบ 24:00 · ลงแล้วแถวถูก`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
    const longName = (d: number) => T(`busy.routine.weekdays.long.${WD_KEYS[d - 1]}`);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann'] });
    const A = scene.members[0]!;
    const a = A.page;
    const problems = watchConsole(a);
    const today = todayBkk();
    const { from: winFrom, to: winTo } = horizon();
    const mon0 = mondayOf(today);
    const sheet = await openRoutineForm(a, scene.gid);

    // ปุ่มวันแต่ละปุ่ม: ชื่อเต็มเป็น aria-label · aria-pressed สลับ · hint จางตอนเปิด → เป็น alert เมื่อผู้ใช้ปลดจนว่าง
    const day = (d: number) => sheet.getByTestId(`routine-day-${d}`);
    await expect(day(1)).toHaveAttribute('aria-label', longName(1));
    await expect(day(7)).toHaveAttribute('aria-label', longName(7));
    await expect(sheet.getByTestId('routine-weekdays')).toHaveAttribute('role', 'group');
    await expect(sheet.getByTestId('routine-weekdays-required')).not.toHaveAttribute('role', 'alert');
    await expect(sheet.getByTestId('routine-weekdays-error')).toHaveCount(0);
    await day(3).click();
    await expect(day(3)).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByTestId('routine-weekdays-required')).toHaveCount(0);
    await day(3).click();
    await expect(day(3)).toHaveAttribute('aria-pressed', 'false');
    await expect(sheet.getByTestId('routine-weekdays-required')).toHaveAttribute('role', 'alert');
    await expect(sheet.getByTestId('routine-weekdays-required')).toHaveClass(/field-error/);
    await expect(sheet.getByTestId('routine-submit')).toBeDisabled();

    // ปุ่มลัดวัน: จ.–ศ. / ส.–อา. / ทุกวัน (aria-pressed ตามชุดที่ตรง)
    const quick = (k: 'weekdays' | 'weekend' | 'every') => sheet.getByTestId(`routine-quick-${k}`);
    const pressed = async (days: number[]) => {
      for (let d = 1; d <= 7; d++) await expect(day(d), `วัน ${d}`).toHaveAttribute('aria-pressed', String(days.includes(d)));
    };
    await quick('weekdays').click();
    await pressed([1, 2, 3, 4, 5]);
    await expect(quick('weekdays')).toHaveAttribute('aria-pressed', 'true');
    await expect(quick('weekend')).toHaveAttribute('aria-pressed', 'false');
    await quick('weekend').click();
    await pressed([6, 7]);
    await expect(quick('weekend')).toHaveAttribute('aria-pressed', 'true');
    await quick('every').click();
    await pressed([1, 2, 3, 4, 5, 6, 7]);
    await expect(quick('every')).toHaveAttribute('aria-pressed', 'true');
    await day(4).click(); // ปลดวันเดียว → ไม่ตรงปุ่มลัดไหน
    for (const k of ['weekdays', 'weekend', 'every'] as const) await expect(quick(k)).toHaveAttribute('aria-pressed', 'false');
    await quick('every').click();

    // ทั้งวัน ↔ ระบุเวลา
    await sheet.getByTestId('routine-time-allday').click();
    await expect(sheet.getByTestId('routine-time-allday')).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByTestId('routine-start')).toHaveCount(0);
    await sheet.getByTestId('routine-time-timed').click();
    await expect(sheet.getByTestId('routine-start')).toBeVisible();

    // จบ = เริ่ม ใช้ไม่ได้
    await sheet.getByTestId('routine-start').selectOption('09:00');
    await sheet.getByTestId('routine-end').selectOption('09:00');
    await expect(sheet.getByTestId('routine-time-same')).toContainText(T('busy.routine.error.end'));
    await expect(sheet.getByTestId('routine-submit')).toBeDisabled();

    // ข้ามเที่ยงคืน: นับเป็นของวันที่เริ่ม (ตัวอย่างใช้วันแรกที่เลือก = จันทร์)
    await sheet.getByTestId('routine-start').selectOption('22:00');
    await sheet.getByTestId('routine-end').selectOption('06:00');
    const overnight = sheet.getByTestId('routine-overnight');
    await expect(overnight).toContainText(T('busy.routine.time.overnight'));
    await expect(overnight).toContainText(T('busy.routine.time.overnightNote', { day: longName(1), nextDay: longName(2), start: '22:00', end: '06:00' }));
    // จบ 24:00: ป้ายข้ามเที่ยงคืนหาย · มีหมายเหตุ "ไม่ข้ามไปวันถัดไป"
    await sheet.getByTestId('routine-end').selectOption('24:00');
    await expect(sheet.getByTestId('routine-overnight')).toHaveCount(0);
    await expect(sheet.getByTestId('routine-midnight-note')).toContainText(T('busy.routine.time.midnightNote'));
    await expect(sheet.getByTestId('routine-end').locator('option[value="24:00"]')).toHaveText(T('busy.routine.time.endMidnight'));
    await sheet.getByTestId('routine-end').selectOption('06:00');
    await expect(sheet.getByTestId('routine-overnight')).toBeVisible();

    // ลงจริง: จันทร์ 22:00–06:00 × 4 สัปดาห์ → แถวละ 8 ชม. จบวันถัดไป
    for (const d of [2, 3, 4, 5, 6, 7]) if ((await day(d).getAttribute('aria-pressed')) === 'true') await day(d).click();
    await pressed([1]);
    await sheet.getByTestId('routine-title').fill('กะดึก');
    await pickShortcut(sheet, 'next4Weeks');
    const [lo, hi] = expectedRange(mon0, addDays(mon0, 27), [1], today);
    const n = await summaryCount(sheet);
    expect(n).toBeGreaterThanOrEqual(lo);
    expect(n).toBeLessThanOrEqual(hi);
    await expect(sheet.getByTestId('routine-summary')).toContainText('22:00');
    await expect(sheet.getByTestId('routine-summary')).toContainText('06:00');
    await checkLayout(a, testInfo, 'r14b-form-overnight', loc, theme);
    await sheet.getByTestId('routine-submit').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toastOf(a)).toContainText(T('busy.routine.toast.saved', { count: n }));
    let rows = await routineRowsIn(A.context.request, winFrom, winTo);
    expect(rows).toHaveLength(n);
    for (const r of rows) {
      expect(r.endAt - r.startAt, `${r.localStartDate}: 22:00→06:00 = 8 ชม.`).toBe(8 * 3600_000);
      expect(isoWeekday(r.localStartDate), `${r.localStartDate} เป็นวันจันทร์ (นับเป็นของวันที่เริ่ม)`).toBe(0);
    }
    await expect(a.getByTestId('routine-mine')).toContainText('22:00');
    await expect(a.getByTestId('routine-mine')).toContainText('06:00');

    // วันของชุดกะดึกในปฏิทินวัน
    const firstDay = rows.find((r) => r.localStartDate > today)!.localStartDate;
    await openCalendar(a, { gid: scene.gid, view: 'day', date: firstDay });
    await expect(a.getByTestId('cal-day-panel')).toHaveAttribute('data-date', firstDay);
    await expect(a.getByTestId('routine-tag')).toHaveCount(1);
    await expect(a.getByTestId('cal-day-panel')).toContainText('22:00');
    await checkLayout(a, testInfo, 'r14b-day-overnight', loc, theme);

    // ศุกร์ 22:00–24:00 (ชุดที่สอง) → แถวละ 2 ชม. จบเที่ยงคืนตรงๆ ไม่ข้ามวัน
    const s2 = await openRoutineForm(a, scene.gid);
    await s2.getByTestId('routine-day-5').click();
    await s2.getByTestId('routine-start').selectOption('22:00');
    await s2.getByTestId('routine-end').selectOption('24:00');
    await expect(s2.getByTestId('routine-overnight')).toHaveCount(0);
    await pickShortcut(s2, 'next4Weeks');
    const n2 = await summaryCount(s2);
    await s2.getByTestId('routine-submit').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toastOf(a)).toContainText(T('busy.routine.toast.saved', { count: n2 }));
    rows = await routineRowsIn(A.context.request, winFrom, winTo);
    const fri = rows.filter((r) => isoWeekday(r.localStartDate) === 4);
    expect(fri).toHaveLength(n2);
    for (const r of fri) {
      expect(r.endAt - r.startAt, `${r.localStartDate}: 22:00→24:00 = 2 ชม.`).toBe(2 * 3600_000);
      expect((r.endAt + 7 * 3600_000) % DAY_MS, 'จบพอดีเที่ยงคืนเวลาไทย').toBe(0);
    }
    await expect(a.getByTestId('routine-mine')).toContainText('24:00');

    expect(problems, 'console').toEqual([]);
  });
}

// ═════════════════════════════════════════════════════════════
// error จากเซิร์ฟเวอร์: LIMIT_REACHED (routines) · NO_OCCURRENCE · ป้ายใกล้เต็ม
// ═════════════════════════════════════════════════════════════
for (const { loc, theme } of COMBOS) {
  test(`R14b error ${loc}/${theme}: เต็ม 10 ชุด (LIMIT_REACHED) · NO_OCCURRENCE ตอนลง/แก้ · ฟอร์มคงค่า`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann'] });
    const A = scene.members[0]!;
    const a = A.page;
    // 4xx ของคำขอที่ตั้งใจให้ล้ม (เบราว์เซอร์ log "Failed to load resource") ไม่นับ · error อื่นนับ
    const problems = watchConsole(a, (m) => /Failed to load resource/.test(m.text));
    const nextMon = addDays(mondayOf(todayBkk()), 7);

    // ตั้งฉาก: 10 ชุดที่ยังไม่จบ (สัปดาห์หน้า วันละชุด 1 วัน)
    const seeded: Routine[] = [];
    for (let i = 0; i < 10; i++) {
      seeded.push(await postRoutine(A.context.request, { rangeKind: 'weeks', fromWeek: nextMon, toWeek: nextMon, weekdays: [(i % 5) + 1], allDay: false, startTime: '10:00', endTime: '11:00', title: `seed ${i}`, note: null, hideDetail: false }));
    }

    // ป้าย "ใกล้เต็ม" ในรายการ
    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    await expect(a.getByTestId('routine-count')).toHaveText(T('busy.routine.mine.count', { count: 10 }));
    await expect(a.getByTestId('routine-near')).toContainText(T('busy.routine.mine.limitNear', { count: 10, max: 10 }));
    await checkLayout(a, testInfo, 'r14b-mine-near', loc, theme);

    // ลงชุดที่ 11 → LIMIT_REACHED routines · ฟอร์มยังอยู่ ค่าไม่หาย
    await a.getByTestId('routine-add').click();
    const sheet = dialogs(a);
    await pickPreset(sheet, 'work');
    await pickShortcut(sheet, 'next4Weeks');
    await sheet.getByTestId('routine-submit').click();
    await expect(sheet.getByTestId('routine-error')).toContainText(T('busy.routine.error.routines', { max: 10 }));
    await expect(sheet.getByTestId('routine-title')).toHaveValue(T('busy.routine.preset.work'));
    await expect(sheet.getByTestId('routine-end')).toHaveValue('18:00');
    await expect(sheet.getByTestId('routine-submit')).toBeEnabled();
    await checkLayout(a, testInfo, 'r14b-form-limit', loc, theme);
    expect(await routinesOf(A.context.request), 'ไม่มีชุดที่ 11').toHaveLength(10);
    // แก้ฟอร์มแล้ว error หาย
    await sheet.getByTestId('routine-title').fill('แก้แล้ว');
    await expect(sheet.getByTestId('routine-error')).toHaveCount(0);

    // NO_OCCURRENCE ตอนลง: ใช้รูป error จริงของเซิร์ฟเวอร์ (VALIDATION + fields) — ฝั่ง client กันกรณีนี้ไว้ก่อนส่ง จึงต้องจำลองการแข่งกัน
    const noOcc = JSON.stringify({ error: { code: 'VALIDATION', params: { fields: { weekdays: 'NO_OCCURRENCE' } } } });
    const real = await api(A.context.request, 'POST', '/api/me/busy-routines', { rangeKind: 'weeks', fromWeek: nextMon, toWeek: nextMon, weekdays: [], allDay: false, startTime: '10:00', endTime: '11:00', title: null, note: null, hideDetail: false });
    expect(real.status).toBe(400);
    expect(JSON.parse(real.text), 'รูป error จริงมี error.params.fields').toMatchObject({ error: { code: 'VALIDATION', params: { fields: { weekdays: expect.any(String) } } } });
    const isCreate = (u: URL) => u.pathname === '/api/me/busy-routines';
    await a.route(isCreate, (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 400, contentType: 'application/json', body: noOcc }) : route.continue()));
    await sheet.getByTestId('routine-submit').click();
    await expect(sheet.getByTestId('routine-noocc-error')).toContainText(T('busy.routine.error.noOccurrence'));
    await expect(sheet.getByTestId('routine-title')).toHaveValue('แก้แล้ว');
    await a.unroute(isCreate);
    await sheet.getByTestId('routine-title').focus(); // โฟกัสอยู่ใน sheet (ปุ่มบันทึกเพิ่งหมดสถานะกำลังส่ง) แล้ว Esc = ปิด
    await a.keyboard.press('Escape');
    await expect(dialogs(a)).toHaveCount(0);

    // NO_OCCURRENCE ตอนแก้ทั้งหมด → ข้อความ "แก้แบบนี้แล้วจะไม่เหลือวันไหนเลย"
    await a.getByTestId(`routine-open-${seeded[0]!.id}`).click();
    await a.getByTestId('routine-scope-all').click();
    const edit = dialogs(a);
    await expect(edit.getByTestId('routine-editing')).toBeVisible();
    const isPatch = (u: URL) => u.pathname === `/api/me/busy-routines/${seeded[0]!.id}`;
    await a.route(isPatch, (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 400, contentType: 'application/json', body: noOcc }) : route.continue()));
    await edit.getByTestId('routine-submit').click();
    await expect(edit.getByTestId('routine-error')).toContainText(T('busy.routine.error.noOccurrenceEdit'));
    await expect(edit.getByTestId('routine-noocc-error')).toHaveCount(0);
    await a.unroute(isPatch);
    await checkLayout(a, testInfo, 'r14b-form-noocc-edit', loc, theme);

    expect(problems, 'console').toEqual([]);
  });
}

// ═════════════════════════════════════════════════════════════
// availability.detailTruncated (>5,000 ชิ้นทับช่วงที่ขอ) — ตั้งฉากด้วย SQL 6,500 แถวของ Ann กระจาย 42 วัน
//   อ่านฝั่ง Bob: มีแถบแจ้ง "รายละเอียดแสดงไม่ครบ" แต่ช่วงว่างร่วมยังคำนวณครบ · ไม่ใช่ `truncated` เดิม
// ═════════════════════════════════════════════════════════════
const TZ = 'Asia/Bangkok';
/**
 * แทรก busy 10:00–10:30 ของผู้ใช้ n แถว กระจายเท่าๆ กันตามวันต่อเนื่อง `days` วัน เริ่มที่ firstDay (ข้ามกฎ 300 ด้วย SQL — เฉพาะตั้งฉาก)
 * กระจายหลายวันเพื่อให้รายละเอียดวันหนึ่งไม่ยาวเป็นแสนพิกเซล (หน้าวันว่างแสดงทุกรายการของวันนั้น)
 */
async function seedSpread(userId: string, firstDay: DateISO, days: number, n: number): Promise<void> {
  const db = createClient({ url: E2E_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined, timeout: 15_000 });
  try {
    for (let i = 0; i < n; i += 100) {
      const vals: string[] = [];
      const args: (string | number)[] = [];
      for (let j = i; j < Math.min(n, i + 100); j++) {
        const date = addDays(firstDay, j % days);
        const [y, m, d] = date.split('-').map(Number);
        const start = Date.UTC(y!, m! - 1, d!, 10 - 7, 0); // 10:00 เวลาไทย
        vals.push(`(?, ?, ?, NULL, 0, ?, ?, '${date}', '${date}', '${TZ}', 0, 1, 1)`);
        args.push(`r14b-trunc-${userId}-${j}`, userId, `r14b-trunc ${j}`, start, start + 1800_000);
      }
      for (let k = 0; ; k++) {
        try {
          await db.execute({
            sql: `INSERT INTO busy_block (id, user_id, title, note, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) VALUES ${vals.join(',')}`,
            args,
          });
          break;
        } catch (e) {
          if (k >= 8 || !/database is locked|SQLITE_BUSY/.test(String(e))) throw e;
          await new Promise((r) => setTimeout(r, 250 * (k + 1)));
        }
      }
    }
  } finally {
    db.close();
  }
}

for (const { loc, theme } of COMBOS) {
  test(`R14b detailTruncated ${loc}/${theme}: รายการทับเกิน 5,000 → แถบ "รายละเอียดไม่ครบ" · ช่วงว่างร่วมยังถูก`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann', 'Bob'] });
    const [A, B] = [scene.members[0]!, scene.members[1]!];
    const problems = watchConsole(B.page);
    const date = addDays(todayBkk(), 5);
    // ตารางเดือน ≤ 6 สัปดาห์ (42 วัน) · ลงให้ครบ 42 วันของตารางเดือนที่มี `date` → ในหน้าต่างที่ขอ ≥ 35 วัน ≥ 5,416 แถว (> 5,000 แน่นอน)
    const gridFrom = mondayOf(`${monthOf(date)}-01`);
    await seedSpread(A.userId, gridFrom, 42, 6500);

    await openFree(B.page, { gid: scene.gid, date });
    await expect(B.page.getByTestId('free-detail-truncated')).toContainText(T('availability.detailTruncated'));
    await expect(B.page.getByTestId('free-truncated')).toHaveCount(0); // `truncated` เดิม (ช่วงว่างอาจผิด) ต้องไม่ขึ้น
    await pickDay(B.page, date);
    const seg = (s: string, e: string) => T('availability.day.segments.row', { start: s, end: e });
    await expect(freeDay(B.page)).toContainText(seg('08:00', '10:00'));
    await expect(freeDay(B.page)).toContainText(seg('10:30', '22:00'));
    await expect(freeDay(B.page).getByText(seg('08:00', '22:00'))).toHaveCount(0); // 10:00–10:30 ของ Ann ถูกนับ แม้รายละเอียดถูกตัด
    // เลย์เอาต์ (ไม่ใช้ checkLayout เพราะภาพเต็มหน้ายาวเกินที่ Chromium จับได้เมื่อรายการของวันเดียวมีเป็นร้อยแถว)
    await expect(B.page.locator('html')).toHaveAttribute('data-theme', theme);
    const layout = await measureLayout(B.page);
    expect(layout.scrollWidth, 'ไม่มี horizontal scroll').toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.smallTargets, 'ปุ่ม ≥ 44px').toEqual([]);
    await B.page.screenshot({ path: testInfo.outputPath(`r14b-detail-truncated-${loc}-${theme}-${testInfo.project.name}.png`), animations: 'disabled' });

    // API ทั้งตารางเดือน: ธงเป็น boolean ตัวเดียว · busy[] ไม่เกิน 5,000 · วันว่างไม่ถูกตัด
    const r = await api(B.context.request, 'GET', `/api/groups/${scene.gid}/availability?from=${gridFrom}&to=${addDays(gridFrom, 41)}`);
    expect(r.status, r.text).toBe(200);
    const d = (JSON.parse(r.text) as { data: { truncated: boolean; detailTruncated: boolean; busy: unknown[] } }).data;
    expect([d.truncated, d.detailTruncated]).toEqual([false, true]);
    expect(d.busy.length, 'ส่งรายละเอียดเต็มเพดาน 5,000').toBe(5000);
    expect(problems, 'console').toEqual([]);
  });
}

// ═════════════════════════════════════════════════════════════
// ต่ออายุชุดที่จบแล้ว (qa 7f3273e: เปิดฟอร์มแล้ว "ถึง" ต้องไม่อยู่ก่อน "ตั้งแต่") · ตั้งฉากชุดที่จบด้วย SQL (ลงชุดที่จบแล้วผ่าน API ไม่ได้)
// ═════════════════════════════════════════════════════════════
async function seedEndedRoutine(userId: string, id: string, startDate: DateISO, endDate: DateISO, title: string): Promise<void> {
  const db = createClient({ url: E2E_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined, timeout: 15_000 });
  try {
    for (let k = 0; ; k++) {
      try {
        await db.execute({
          sql: `INSERT INTO busy_routine (id, user_id, title, note, hide_detail, all_day, weekdays, start_min, end_min, range_kind, start_date, end_date, tz, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, 0, 31, 540, 1080, 'weeks', ?, ?, 'Asia/Bangkok', 1, 1)`,
          args: [id, userId, title, startDate, endDate],
        });
        break;
      } catch (e) {
        if (k >= 8 || !/database is locked|SQLITE_BUSY/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 250 * (k + 1)));
      }
    }
  } finally {
    db.close();
  }
}

for (const { loc, theme } of COMBOS) {
  test(`R14b ต่ออายุ ${loc}/${theme}: ชุดที่จบแล้ว → เปิดฟอร์มไม่มี error ช่วง · สรุป N วัน · บันทึกได้ · เหลือวัน > 0`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann'] });
    const A = scene.members[0]!;
    const a = A.page;
    const problems = watchConsole(a);
    const today = todayBkk();
    const mon0 = mondayOf(today);
    const id = randomUUID(); // เซิร์ฟเวอร์ตรวจ id เป็น uuid
    await seedEndedRoutine(A.userId, id, addDays(mon0, -14), addDays(mon0, -1), 'ชุดเก่า');

    await openCalendar(a, { gid: scene.gid, view: 'mine' });
    await expect(a.getByTestId(`routine-row-${id}`).getByTestId('routine-remaining')).toHaveText(T('busy.routine.mine.ended'));
    await a.getByTestId(`routine-extend-${id}`).click();
    const sheet = dialogs(a);
    await expect(sheet.getByTestId('routine-editing')).toHaveText(T('busy.routine.form.editing.all'));
    // เปิดมาแล้วต้องไม่มี error ช่วง/ถึง ก่อนผู้ใช้แตะอะไร (บั๊กเดิม: "ถึง" ก่อน "ตั้งแต่")
    await expect(sheet.getByTestId('routine-range-error')).toHaveCount(0);
    await expect(sheet.getByTestId('routine-to-error')).toHaveCount(0);
    await expect(sheet.getByTestId('routine-to')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(sheet.getByTestId('routine-from')).not.toHaveAttribute('aria-invalid', 'true');
    // ต่อไปอีก 3 สัปดาห์จากสัปดาห์นี้ (ช่วงที่เหลือต้องมีวันแน่ ไม่ขึ้นกับวันนี้เป็นวันหยุดหรือไม่)
    await sheet.getByTestId('routine-to').selectOption(addDays(mon0, 21));
    const n = await summaryCount(sheet);
    const [lo, hi] = expectedRange(mon0, addDays(mon0, 27), WORK, today);
    expect(n).toBeGreaterThanOrEqual(lo);
    expect(n).toBeLessThanOrEqual(hi);
    await expect(sheet.getByTestId('routine-range-error')).toHaveCount(0);
    await expect(sheet.getByTestId('routine-submit')).toBeEnabled();
    await checkLayout(a, testInfo, 'r14b-extend', loc, theme);
    await sheet.getByTestId('routine-submit').click();
    await expect(dialogs(a)).toHaveCount(0);
    await expect(toastOf(a)).toContainText(T('busy.routine.toast.updated'));
    const r = (await routinesOf(A.context.request)).find((x) => x.id === id)!;
    expect(r.endDate).toBe(addDays(mon0, 27));
    expect(r.remaining, 'ต่ออายุแล้วต้องเหลือวัน').toBeGreaterThan(0);
    const { from, to } = horizon();
    expect((await routineRowsIn(A.context.request, from, to)).length).toBe(n);
    await expect(a.getByTestId(`routine-row-${id}`).getByTestId('routine-remaining')).toHaveText(T('busy.routine.mine.remaining', { count: r.remaining }));
    expect(problems, 'console').toEqual([]);
  });

  test(`R14b โน้ตไม่รั่ว ${loc}/${theme}: ไม่ซ่อนรายละเอียด → อีกคนเห็นชื่อ แต่ไม่เห็นโน้ตเลย`, async ({ newDevice, baseURL }) => {
    test.setTimeout(240_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(loc, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale: loc, theme, labels: ['Ann', 'Bob'] });
    const [A, B] = [scene.members[0]!, scene.members[1]!];
    const bApi = recordApi(B.page);
    const [title, note] = [canary('title'), canary('note')];
    const mon1 = addDays(mondayOf(todayBkk()), 7);
    await postRoutine(A.context.request, { rangeKind: 'weeks', fromWeek: mon1, toWeek: mon1, weekdays: [1, 2, 3, 4, 5, 6, 7], allDay: false, startTime: '09:00', endTime: '18:00', title, note, hideDetail: false });
    const d = addDays(mon1, 2);

    await openCalendar(B.page, { gid: scene.gid, view: 'day', date: d });
    await expect(B.page.getByTestId('cal-day-panel')).toHaveAttribute('data-date', d);
    await expect(B.page.getByTestId('cal-day-panel')).toContainText(title); // ไม่ซ่อน → เห็นชื่อ
    await expect(B.page.getByTestId('routine-tag')).toHaveCount(0);
    await openFree(B.page, { gid: scene.gid, date: d });
    await pickDay(B.page, d);
    await expect(freeDay(B.page).getByTestId(`free-blocker-${A.userId}`)).toContainText(title);
    await expect(freeDay(B.page).getByText(T('availability.day.segments.row', { start: '18:00', end: '22:00' }))).toBeVisible();
    for (const q of [`calendar?from=${mon1}&to=${addDays(mon1, 6)}`, `availability?from=${mon1}&to=${addDays(mon1, 6)}`]) {
      const r = await api(B.context.request, 'GET', `/api/groups/${scene.gid}/${q}`);
      expect(r.status, r.text).toBe(200);
      bApi.bodies.push({ path: `/api/groups/${scene.gid}/${q}`, text: r.text });
    }
    await bApi.settled();
    expect(bApi.bodies.some((x) => x.text.includes(title)), 'ชื่ออยู่ใน response (ไม่ซ่อน) — ยืนยันว่าตรวจข้อมูลจริง').toBe(true);
    for (const x of bApi.bodies) {
      expect(x.text, `${x.path} ต้องไม่มีโน้ต`).not.toContain(note);
      expect(x.text, `${x.path} ต้องไม่มี routineId/rangeKind`).not.toMatch(/routineId|rangeKind/);
    }
    const dump = await pageDump(B.page);
    expect(dump, 'DOM ของ Bob ต้องไม่มีโน้ต').not.toContain(note);
    expect(dump).not.toMatch(/routineId|rangeKind/);
  });
}
