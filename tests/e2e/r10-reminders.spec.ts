// R10 — แจ้งเตือนก่อนนัด + เชื่อม LINE + ปุ่มขั้น 2 (R10_CONTRACT §1.3 §2 §3 §6: R10-4 / R10-8 / R10-9): 375/390/768 (= project) × th/en × light/dark
//   1) กระดิ่ง/หน้า /notifications แสดง appointment.reminder_1d|reminder_1h|rsvp_nudge (ใส่แถวตรงใน DB) · กดแล้วไป /appointments/<id>
//   2) /me ส่วน LINE: ไม่มี env LINE → ไม่มีส่วนนี้ (API จริง) · จำลอง GET|POST|DELETE /api/me/line ด้วย page.route → idle → โค้ด → linked → ยกเลิก → idle · 429 → me-line-error
//   3) ปุ่มขั้น 2: กด group-step-cta-busy → ฟอร์ม busy เปิดทันที · URL ไม่มี add= · ปิดแล้วอยู่ปฏิทิน · รีเฟรชไม่เด้งซ้ำ
//   4) /privacy: มีส่วน LINE ทั้ง TH/EN
// cron ส่งเตือนจริงทดสอบที่ Vitest (ไม่มีนาฬิกาจำลองใน next start) — สเปกนี้ทดสอบเฉพาะฝั่งแสดงผล/การนำทาง/จอ
import type { Page, Route, TestInfo } from '@playwright/test';
import { expect, test as authTest } from './support/auth';
import { createApptApi, daysAhead } from './support/appt';
import { setPrefs, watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, go, joinViaApiCode, membersApi, person, signup, type Theme } from './support/groups';
import { LOCALES, msg } from './support/messages';
import { insertReminderNotifications, type ReminderKind } from './support/notif';

const THEMES: readonly Theme[] = ['light', 'dark'];
const test = authTest; // introSeen ดีฟอลต์ true (ตามเดิม) — สเปกนี้ไม่เกี่ยวกับการ์ดแนะนำ

const slot = (d: string) => ({ startDate: d, startTime: '10:00', endDate: d, endTime: '11:00' });
const KINDS: readonly ReminderKind[] = ['appointment.reminder_1d', 'appointment.reminder_1h', 'appointment.rsvp_nudge'];
const noOverflow = async (page: Page, label: string) => {
  const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth, b: document.body.scrollWidth }));
  expect(w.s, `${label}: documentElement ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
  expect(w.b, `${label}: body ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
};

const ADD_FRIEND = 'https://line.me/R/ti/p/@324icfvb';
const CODE = 'MM-TEST-CODE';
type LineState = { available: boolean; addFriendUrl: string | null; linked: boolean; pendingExpiresAt: number | null };
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** จำลอง /api/me/line (ไม่ยิง LINE จริง ไม่แตะ DB) — คืน state ที่เทสต์แก้ได้ + บันทึก method ที่ถูกเรียก */
async function mockLine(page: Page, opts: { postStatus?: number } = {}) {
  const state: LineState = { available: true, addFriendUrl: ADD_FRIEND, linked: false, pendingExpiresAt: null };
  const calls: string[] = [];
  await page.route('**/api/me/line', async (route) => {
    const method = route.request().method();
    calls.push(method);
    if (method === 'GET') return json(route, 200, { data: state });
    if (method === 'POST') {
      if (opts.postStatus && opts.postStatus !== 201) return json(route, opts.postStatus, { error: { code: 'RATE_LIMITED', params: {} } });
      state.pendingExpiresAt = Date.now() + 10 * 60_000;
      return json(route, 201, { data: { code: CODE, expiresAt: state.pendingExpiresAt } });
    }
    if (method === 'DELETE') {
      state.linked = false;
      state.pendingExpiresAt = null;
      return json(route, 200, { data: { linked: false } });
    }
    return route.fallback();
  });
  return { state, calls };
}

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test.describe(`${locale} · ${theme}`, () => {
      test('กระดิ่ง + /notifications: เตือน 1 วัน / 1 ชม. / ถามยืนยัน แสดงถูกภาษา กดแล้วไปหน้านัด', async ({ page, context, baseURL, user }, testInfo: TestInfo) => {
        void user;
        await setPrefs(context, baseURL!, { locale, theme });
        const groupName = `R10 ${locale} ${theme} ${Date.now().toString(36)}`;
        const gid = await createGroupApi(context.request, groupName);
        const members = await membersApi(context.request, gid);
        const me = members[0]!;
        const titles = Object.fromEntries(KINDS.map((k) => [k, `R10 ${k.split('.')[1]} ${Math.random().toString(36).slice(2, 7)}`])) as Record<ReminderKind, string>;
        const appts = {} as Record<ReminderKind, string>;
        for (const [i, k] of KINDS.entries()) appts[k] = await createApptApi(context.request, gid, { title: titles[k], ...slot(daysAhead(3 + i)) });
        await insertReminderNotifications(
          me.userId,
          KINDS.map((k) => ({ kind: k, params: { groupId: gid, groupName, appointmentId: appts[k], title: titles[k], startAt: Date.now() + 3 * 86_400_000, tz: 'Asia/Bangkok' } })),
        );

        const problems = watchConsole(page);
        // กระดิ่งหน้าหลักนับ 3 ที่ยังไม่อ่าน
        await go(page, '/');
        await expect(page.getByTestId('bell-badge')).toHaveText('3');

        await go(page, '/notifications');
        const rows = page.getByTestId('notif-row');
        await expect(rows).toHaveCount(3);
        // ข้อความ: ส่วนหน้า {title} ของแต่ละชนิดจาก messages จริง (ไม่ hard-code) · มีชื่อนัดและชื่อกลุ่ม · ไม่ตกเป็น "แจ้งเตือนที่แสดงไม่ได้"
        const prefix = (k: ReminderKind) => msg(locale, `notifications.appointment.${k.split('.')[1]}`, { title: '§', when: '§', groupName: '§' }).split('§')[0]!.trim();
        for (const k of KINDS) {
          const row = rows.filter({ hasText: titles[k] });
          await expect(row, k).toHaveCount(1);
          await expect(row).toContainText(prefix(k));
          await expect(row).toContainText(groupName);
          await expect(row).toHaveAttribute('href', `/appointments/${appts[k]}`);
          await expect(row).toHaveAttribute('data-unread', 'true');
        }
        await expect(page.getByText(msg(locale, 'notifications.unknown'))).toHaveCount(0);
        // ข้อความ 3 ชนิดต้องต่างกัน (ไม่ใช้ข้อความร่วม)
        expect(new Set(KINDS.map(prefix)).size).toBe(3);
        await noOverflow(page, 'notifications');
        await checkLayout(page, testInfo, 'r10-notifications', locale, theme);

        // กดแต่ละแถว → หน้านัดของแถวนั้น
        for (const k of KINDS) {
          await go(page, '/notifications');
          await page.getByTestId('notif-row').filter({ hasText: titles[k] }).click();
          await expect(page).toHaveURL(new RegExp(`/appointments/${appts[k]}$`));
          await expect(page.getByRole('heading', { name: titles[k] }).first()).toBeVisible(); // หน้านัดของนัดนั้นจริง
        }
        expect(problems).toEqual([]);
      });

      test('/me ส่วน LINE: เชื่อมต่อ → โค้ด + ปุ่มเพิ่มเพื่อน → เชื่อมแล้ว → ยกเลิก → กลับสถานะเริ่มต้น', async ({ page, context, baseURL, user }, testInfo: TestInfo) => {
        void user;
        await setPrefs(context, baseURL!, { locale, theme });
        const problems = watchConsole(page);
        const { state, calls } = await mockLine(page);

        await go(page, '/me');
        const section = page.getByTestId('me-line');
        await expect(section).toHaveAttribute('data-state', 'idle');
        await expect(section.getByRole('heading', { level: 2, name: msg(locale, 'me.line.title') })).toBeVisible();
        await expect(section.getByText(msg(locale, 'me.line.hint'))).toBeVisible();
        await expect(page.getByTestId('me-line-code')).toHaveCount(0);
        await expect(page.getByTestId('me-line-connected')).toHaveCount(0);
        await noOverflow(page, 'me line idle');
        await checkLayout(page, testInfo, 'r10-me-line-idle', locale, theme);

        // กดเชื่อมต่อ → โค้ด + ปุ่มเพิ่มเพื่อน (ลิงก์สาธารณะที่ server ส่งมา เปิดแท็บใหม่แบบปลอดภัย)
        const connect = page.getByTestId('me-line-connect');
        await expect(connect).toHaveText(msg(locale, 'me.line.connect'));
        await connect.click();
        await expect(section).toHaveAttribute('data-state', 'code');
        await expect(page.getByTestId('me-line-code')).toHaveText(CODE);
        const add = page.getByTestId('me-line-add-friend');
        await expect(add).toHaveText(msg(locale, 'me.line.addFriend'));
        await expect(add).toHaveAttribute('href', ADD_FRIEND);
        await expect(add).toHaveAttribute('target', '_blank');
        await expect(add).toHaveAttribute('rel', /noopener/);
        await expect(section.getByText(msg(locale, 'me.line.codeHint'))).toBeVisible();
        await expect(connect).toHaveCount(0);
        expect(calls).toEqual(['GET', 'POST']);
        // โค้ดอยู่ใน state เท่านั้น: ไม่ลง URL / localStorage / sessionStorage
        expect(page.url()).not.toContain(CODE);
        expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).not.toContain(CODE);
        await noOverflow(page, 'me line code');
        await checkLayout(page, testInfo, 'r10-me-line-code', locale, theme);

        // ผู้ใช้ส่งโค้ดใน LINE แล้วกลับมาที่แท็บ (focus → ตรวจสถานะ) → เชื่อมแล้ว
        state.linked = true;
        state.pendingExpiresAt = null;
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(section).toHaveAttribute('data-state', 'linked');
        await expect(page.getByTestId('me-line-connected')).toContainText(msg(locale, 'me.line.connected'));
        await expect(page.getByTestId('me-line-code')).toHaveCount(0);
        await expect(page.getByTestId('me-line-add-friend')).toHaveCount(0);
        await expect(page.getByTestId('me-line-disconnect')).toHaveText(msg(locale, 'me.line.disconnect'));
        await noOverflow(page, 'me line linked');
        await checkLayout(page, testInfo, 'r10-me-line-linked', locale, theme);

        // ยกเลิก: ยืนยันใน sheet ก่อน (ยกเลิกใน sheet = ยังเชื่อมอยู่ ไม่ยิง DELETE)
        await page.getByTestId('me-line-disconnect').click();
        const sheet = page.getByRole('alertdialog');
        await expect(sheet.getByText(msg(locale, 'me.line.disconnectConfirm'))).toBeVisible();
        await sheet.getByRole('button', { name: msg(locale, 'common.cancel'), exact: true }).click();
        await expect(sheet).toHaveCount(0);
        await expect(section).toHaveAttribute('data-state', 'linked');
        expect(calls).not.toContain('DELETE');

        await page.getByTestId('me-line-disconnect').click();
        await page.getByTestId('me-line-disconnect-confirm').click();
        await expect(section).toHaveAttribute('data-state', 'idle');
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        await expect(page.getByTestId('me-line-connect')).toBeVisible();
        await expect(page.getByTestId('me-line-connected')).toHaveCount(0);
        expect(calls.filter((c) => c === 'DELETE')).toHaveLength(1);
        expect(problems).toEqual([]);
      });

      test('/me ส่วน LINE: ทำถี่เกิน (429) → แสดง me-line-error · ยังไม่เชื่อม ไม่มีโค้ด', async ({ page, context, baseURL, user }) => {
        void user;
        await setPrefs(context, baseURL!, { locale, theme });
        // เบราว์เซอร์บันทึก console error ของ HTTP 429 เองทุกครั้ง (เสียงของเบราว์เซอร์ ไม่ใช่ข้อผิดพลาดของแอป) → กรองเฉพาะ resource นั้น ที่เหลือยังนับ
        const problems = watchConsole(page, (m) => /status of 429/.test(m.text) && /\/api\/me\/line$/.test(m.url ?? ''));
        const { calls } = await mockLine(page, { postStatus: 429 });
        await go(page, '/me');
        await page.getByTestId('me-line-connect').click();
        const err = page.getByTestId('me-line-error');
        await expect(err).toHaveText(msg(locale, 'errors.RATE_LIMITED'));
        await expect(err).toHaveAttribute('role', 'alert');
        await expect(page.getByTestId('me-line')).toHaveAttribute('data-state', 'idle');
        await expect(page.getByTestId('me-line-code')).toHaveCount(0);
        await expect(page.getByTestId('me-line-connect')).toBeEnabled();
        expect(calls).toEqual(['GET', 'POST']);
        await noOverflow(page, 'me line 429');
        expect(problems).toEqual([]);
      });

      test('ปุ่มขั้น 2 "ลงวันไม่ว่าง": เปิดฟอร์ม busy ทันที · URL ไม่มี add= · ปิดแล้วอยู่ปฏิทิน · รีเฟรชไม่เด้งซ้ำ', async ({ newDevice, baseURL }, testInfo: TestInfo) => {
        test.setTimeout(120_000);
        const [a, b] = await Promise.all([newDevice(), newDevice()]);
        for (const x of [a, b]) await setPrefs(x.context, baseURL!, { locale, theme });
        const [pa, pb] = [person('Ann'), person('Ben')];
        await signup(a.context, pa);
        await signup(b.context, pb);
        const problems = watchConsole(a.page);
        const gid = await createGroupApi(a.context.request, `R10 ${locale} ${theme} ${Date.now().toString(36)}`);
        await joinViaApiCode(a.context.request, gid, b.context.request); // ขั้น 1 เสร็จ → ขั้น 2 เป็นขั้นถัดไป

        await go(a.page, `/groups/${gid}`);
        const cta = a.page.getByTestId('group-step-cta-busy');
        await expect(cta).toBeVisible();
        await cta.click();

        // ฟอร์มเปิดทันที (ไม่ต้องกดปุ่มเพิ่มอีก) บนหน้าปฏิทินของกลุ่มนี้
        await expect(a.page).toHaveURL(new RegExp(`/calendar\\?`));
        const dialog = a.page.getByRole('dialog');
        await expect(dialog.getByTestId('busy-form')).toBeVisible();
        // add=1 ถูกลบออกจาก URL หลังอ่านครั้งเดียว (รีเฟรช/ย้อนกลับไม่เด้งซ้ำ) · g= ยังอยู่
        await expect(a.page).not.toHaveURL(/[?&]add=/);
        expect(new URL(a.page.url()).searchParams.get('g')).toBe(gid);
        await checkLayout(a.page, testInfo, 'r10-step2-form', locale, theme);

        // ปิดฟอร์ม → อยู่หน้าปฏิทิน ไม่เด้งกลับ
        await a.page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(a.page).toHaveURL(/\/calendar\?/);
        await expect(a.page).not.toHaveURL(/[?&]add=/);
        await expect(a.page.getByTestId('cal-month')).toBeVisible();
        await noOverflow(a.page, 'ปฏิทินหลังปิดฟอร์ม');

        // รีเฟรช: ฟอร์มไม่เด้งซ้ำ
        await a.page.reload({ waitUntil: 'networkidle' });
        await expect(a.page.getByTestId('cal-month')).toBeVisible();
        await expect(a.page.getByRole('dialog')).toHaveCount(0);
        await expect(a.page.getByTestId('busy-form')).toHaveCount(0);
        await expect(a.page).not.toHaveURL(/[?&]add=/);
        expect(problems).toEqual([]);
      });
    });
  }

  test(`${locale}: /privacy มีส่วน LINE (ข้อมูลที่ส่งผ่าน LINE + อายุเก็บ LINE user ID) · ไม่ต้องล็อกอิน`, async ({ page, context, baseURL }) => {
    await setPrefs(context, baseURL!, { locale });
    const problems = watchConsole(page);
    const res = await page.goto('/privacy', { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 2, name: msg(locale, 'privacy.line.title') })).toBeVisible();
    await expect(page.getByText(msg(locale, 'privacy.line.body'))).toBeVisible();
    await expect(page.getByText(msg(locale, 'privacy.retention.line'))).toBeVisible();
    // ข้อความ LINE ไม่ส่งสถานที่/รายละเอียด/ชื่อสมาชิก — ข้อความในหน้าต้องบอกชนิดข้อมูลที่ส่งจริง (ชื่อนัด วันเวลา ชื่อกลุ่ม ลิงก์) ตรงกับ messages
    expect(msg(locale, 'privacy.line.body').length).toBeGreaterThan(50);
    await noOverflow(page, `privacy ${locale}`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    expect(problems).toEqual([]);
  });
}

test('ไม่มี env LINE → API บอกว่าไม่พร้อม และ /me ไม่แสดงส่วนเชื่อม LINE (th)', async ({ page, context, baseURL, user }) => {
  void user;
  await setPrefs(context, baseURL!, { locale: 'th', theme: 'light' });
  const problems = watchConsole(page);
  // ไม่จำลอง: ใช้ API จริงของเซิร์ฟเวอร์ E2E ซึ่งไม่ตั้ง LINE_MESSAGING_* (support/env.ts)
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/me/line') && r.request().method() === 'GET'), go(page, '/me')]);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: { available: boolean; linked: boolean } };
  expect(body.data.available).toBe(false);
  expect(body.data.linked).toBe(false);
  await expect(page.getByTestId('me-howto')).toBeVisible(); // หน้า /me โหลดครบแล้ว
  await expect(page.getByTestId('me-line')).toHaveCount(0);
  expect(problems).toEqual([]);
});

// เมทริกซ์สิทธิ์ของ API: ไม่ล็อกอิน = 401 ทุก method (กฎ 6 — ตรวจที่เซิร์ฟเวอร์ ไม่ใช่แค่ซ่อน UI)
test('ไม่ล็อกอิน: GET|POST|DELETE /api/me/line → 401', async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL: baseURL!, extraHTTPHeaders: { origin: baseURL! } });
  try {
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const r = await anon.fetch('/api/me/line', { method, data: method === 'GET' ? undefined : {} });
      expect(r.status(), method).toBe(401);
    }
  } finally {
    await anon.dispose();
  }
});

