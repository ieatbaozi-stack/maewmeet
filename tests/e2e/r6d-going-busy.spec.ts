// R6D — จำกลุ่มที่เลือกไว้ (G1) + ตอบ "ไป" = ไม่ว่างจริงทุกกลุ่ม (G2)
//   R6D-1  จำกลุ่ม: แท็บกลุ่ม → หน้าหลัก → แถบ "ปฏิทิน" ยังเป็นกลุ่มเดิม · เปลี่ยนด้วย dropdown · context ใหม่ (คุกกี้คงอยู่) ยังจำ · logout แล้ว login ไม่จำ
//   R6D-2  คุกกี้ชี้กลุ่มที่ออกแล้ว / uuid มั่ว / ไม่ใช่สมาชิก / ไม่ใช่ uuid → กลุ่มแรก ไม่ error ไม่รั่วว่ากลุ่มมีอยู่
//   R6D-3  scenario A ผ่าน UI (A: ลั้ลลา+แอ่ว) · R6D-4 ไม่มีชื่อนัด/ชื่อกลุ่ม/id/สถานที่ ใน DOM + response ของกลุ่มแอ่ว
//   R6D-5  popup ยืนยัน (to/from) · maybe↔not_going ไม่มี · Esc/ยกเลิก = ไม่เปลี่ยน · โฟกัสเริ่มที่ปุ่มคงเดิม · focus trap
//   R6D-5b นัดทับ: popup บอกชื่อนัดที่ชน · ยืนยันได้ · ป้ายชน · ชนขอบพอดีไม่ชน · ข้อมูลชนไม่หลุดไปสมาชิกอื่น
//   R6D-7  375/390/768 × (th·สว่าง | en·มืด): popup (ไม่ชน/ชน/จาก "ไป") · หน้านัดที่มีป้าย · รายการ · หน้าหลัก · แท็บของฉัน · วัน 3 kind · legend
// ข้อความทุกอย่างมาจาก messages/*.json ผ่าน msg() · วันที่สัมพัทธ์กับวันนี้ (Asia/Bangkok) ผ่าน daysAhead
// เรื่องเล่า (R6D-1..5b) รันที่ mobile-390 ตัวเดียว · เลย์เอาต์ (R6D-7) รันทั้ง 3 ขนาดจอ
import type { Locator, Page } from '@playwright/test';
import { expect, GOOD_PIN, postJson, signupViaApi, test, uniqueUsername } from './support/auth';
import { canary, createBusyApi, recordResponses } from './support/busy';
import { openCalendar, pageDump } from './support/calendar-ui';
import { setPrefs, settleAnimations, watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, go, joinViaApiCode, membersApi, type Theme } from './support/groups';
import { msg, type Locale } from './support/messages';
import { call, cancelApptApi, createApptApi, daysAhead, isHydration, makeScene, rsvpApi, type ApptApi, type Member } from './support/appt';

type Rsvp = 'going' | 'maybe' | 'not_going';
type NewDevice = () => Promise<{ context: import('@playwright/test').BrowserContext; page: Page }>;

const slot = (d: string, s: string, e: string) => ({ startDate: d, startTime: s, endDate: d, endTime: e });
const rand = () => Math.random().toString(16).slice(2, 7);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ───────── ตัวช่วย ─────────
async function makeUser(newDevice: NewDevice, baseURL: string, label: string, o: { locale: Locale; theme?: Theme; displayName?: string }): Promise<Member> {
  const d = await newDevice();
  await setPrefs(d.context, baseURL, { locale: o.locale, theme: o.theme ?? 'light' });
  const username = uniqueUsername(label.toLowerCase().slice(0, 4));
  const displayName = o.displayName ?? `${label} ${rand()}`;
  await signupViaApi(d.context.request, { username, displayName });
  return { ...d, p: { username, displayName }, userId: '' };
}

/** creator สร้างกลุ่ม แล้วให้ joiners เข้าด้วยโค้ดเชิญ · เติม userId ของทุกคนที่เกี่ยวข้อง */
async function makeGroup(creator: Member, name: string, joiners: Member[]): Promise<string> {
  const gid = await createGroupApi(creator.context.request, name);
  for (const j of joiners) await joinViaApiCode(creator.context.request, gid, j.context.request);
  const rows = await membersApi(creator.context.request, gid);
  for (const m of [creator, ...joiners]) m.userId = rows.find((r) => r.displayName === m.p.displayName)!.userId;
  return gid;
}

const mineOf = async (m: Member, id: string): Promise<string | null> => {
  const r = await call<{ appointment: ApptApi }>(m.context.request, 'GET', `/api/appointments/${id}`);
  return r.json?.data?.appointment.rsvp.mine ?? null;
};

const rsvpBtn = (p: Page, a: Rsvp): Locator => p.getByTestId(`appt-rsvp-${a}`);
const popup = (p: Page): Locator => p.getByTestId('rsvp-confirm');
const dialog = (p: Page): Locator => p.getByRole('dialog');
const switcher = (p: Page): Locator => p.getByTestId('cal-group-switch');
const labelRe = (locale: Locale, group: string): RegExp => new RegExp(esc(msg(locale, 'calendar.groupSwitch.label', { group })));

/** กดคำตอบที่ต้องมี popup → ยืนยัน (ปุ่มทำเครื่องหมาย) แล้วรอบันทึกเสร็จ (sheet ปิดหลัง PUT สำเร็จ) */
async function pickConfirmed(p: Page, a: Rsvp, direction: 'to' | 'from'): Promise<void> {
  await rsvpBtn(p, a).click();
  await expect(popup(p)).toHaveAttribute('data-direction', direction);
  await p.getByTestId('rsvp-confirm-ok').click();
  await expect(dialog(p)).toHaveCount(0);
  await expect(rsvpBtn(p, a)).toHaveAttribute('aria-pressed', 'true');
}

/** กดคำตอบที่ไม่ต้องมี popup (maybe↔not_going / ตอบครั้งแรกเป็นสองอย่างนี้) */
async function pickDirect(p: Page, a: Rsvp): Promise<void> {
  await rsvpBtn(p, a).click();
  await expect(rsvpBtn(p, a)).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog(p)).toHaveCount(0); // ไม่มี popup
  await expect(p.getByTestId('appt-rsvp-saved')).toBeVisible();
}

const nonHydration = (ps: { text: string }[]) => ps.filter((x) => !isHydration(x));

// ═════════════════════════ เรื่องเล่า (mobile-390 ตัวเดียว) ═════════════════════════
test.describe('R6D เรื่องเล่า', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'เรื่องเล่าเต็มรันที่ mobile-390 ตัวเดียว (เลย์เอาต์ทดสอบทุกขนาดแยกด้านล่าง)');
  });

  const locale: Locale = 'th';
  const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);

  // ───────── R6D-1 ─────────
  test('R6D-1: จำกลุ่มจากแท็บกลุ่ม/dropdown → แถบปฏิทินยังเป็นกลุ่มเดิม · context ใหม่ยังจำ · logout แล้ว login ไม่จำ', async ({ newDevice, openAs, baseURL }) => {
    test.setTimeout(150_000);
    const owner = await makeUser(newDevice, baseURL!, 'Own', { locale });
    const u = await makeUser(newDevice, baseURL!, 'Usr', { locale });
    const nameA = `R6D1a ${rand()}`;
    const nameB = `R6D1b ${rand()}`;
    const gidA = await makeGroup(owner, nameA, [u]);
    const gidB = await makeGroup(owner, nameB, [u]);
    const gidOf: Record<string, string> = { [nameA]: gidA, [nameB]: gidB };
    const problems = watchConsole(u.page);
    const nav = u.page.getByRole('navigation', { name: T('nav.label') });
    const navTo = async (tab: 'calendar' | 'me' | 'groups') => nav.getByRole('link', { name: T(`nav.${tab}`), exact: true }).click();
    const rememberDone = (p: Page) => p.waitForResponse((r) => r.url().endsWith('/api/me/current-group') && r.request().method() === 'PUT');

    // กลุ่มเริ่มต้น (ไม่มีคุกกี้) — ให้แอปตอบเองว่าอันไหนมาก่อน แล้วเลือกอีกอันเป็นเป้าหมาย
    await go(u.page, '/calendar');
    const first = (await switcher(u.page).getAttribute('aria-label'))!;
    const D0 = [nameA, nameB].find((n) => first.includes(n))!;
    const X = D0 === nameA ? nameB : nameA;
    const Y = D0;
    expect((await u.context.cookies()).some((c) => c.name === 'mm_group'), 'ยังไม่เคยเลือก = ไม่มีคุกกี้').toBe(false);

    // 1) แท็บกลุ่ม → แตะกลุ่ม X → (ตั้งคุกกี้) → หน้าหลัก → แถบ "ปฏิทิน" → ยังเป็น X
    await go(u.page, '/groups');
    const put1 = rememberDone(u.page);
    await u.page.getByRole('link', { name: T('groups.openAria', { name: X, count: 2 }) }).click();
    await expect(u.page).toHaveURL(new RegExp(`/groups/${gidOf[X]}$`));
    expect((await put1).status()).toBe(200);
    const ck = (await u.context.cookies()).find((c) => c.name === 'mm_group');
    expect(ck?.value, 'คุกกี้เก็บแค่ group id').toBe(gidOf[X]);
    expect(ck?.httpOnly).toBe(true);
    expect(ck?.sameSite).toBe('Lax');
    expect((ck!.expires - Date.now() / 1000) / 86_400, 'อายุ ~1 ปี').toBeGreaterThan(360);
    await go(u.page, '/');
    await navTo('calendar');
    await expect(u.page).toHaveURL(/\/calendar$/);
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, X));

    // 1b) เปิด /groups/<gid> ซ้ำเมื่อคุกกี้ตรง gid แล้ว → ไม่มี PUT ซ้ำ · เปิดกลุ่มอื่น → PUT 1 ครั้ง
    const puts: string[] = [];
    const onReq = (r: import('@playwright/test').Request) => {
      if (r.url().endsWith('/api/me/current-group') && r.method() === 'PUT') puts.push(r.postData() ?? '');
    };
    u.page.on('request', onReq);
    await go(u.page, `/groups/${gidOf[X]}`);
    await expect(u.page).toHaveURL(new RegExp(`/groups/${gidOf[X]}$`));
    await u.page.waitForLoadState('networkidle');
    expect(puts, 'คุกกี้ตรงกลุ่มอยู่แล้ว = ไม่ PUT ซ้ำ').toEqual([]);
    const put1b = rememberDone(u.page);
    await go(u.page, `/groups/${gidOf[Y]}`);
    expect((await put1b).status()).toBe(200);
    await u.page.waitForLoadState('networkidle');
    expect(puts, 'เปิดกลุ่มอื่น = PUT 1 ครั้ง').toHaveLength(1);
    expect(puts[0]).toContain(gidOf[Y]);
    u.page.off('request', onReq);
    // คืนเป็น X ให้ขั้นต่อไป
    const put1c = rememberDone(u.page);
    await go(u.page, `/groups/${gidOf[X]}`);
    await put1c;
    await go(u.page, '/calendar');
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, X));

    // 2) เปลี่ยนด้วย dropdown เป็น Y → ไปหน้าอื่นแล้วกลับ → Y
    const put2 = rememberDone(u.page);
    await switcher(u.page).click();
    await u.page.getByTestId(`cal-group-option-${gidOf[Y]}`).click();
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, Y));
    expect((await put2).status()).toBe(200);
    await navTo('me');
    await expect(u.page).toHaveURL(/\/me$/);
    await navTo('calendar');
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, Y));
    await go(u.page, '/calendar'); // โหลดเต็มหน้า (ไม่ใช่นำทางฝั่งไคลเอนต์)
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, Y));

    // 3) ?g= ที่ชัดเจนชนะคุกกี้ และอัปเดตคุกกี้
    const put3 = rememberDone(u.page);
    await openCalendar(u.page, { gid: gidOf[X] });
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, X));
    expect((await put3).status()).toBe(200);
    await go(u.page, '/calendar');
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, X));
    // กลับไป Y ให้ขั้นต่อไป
    const put3b = rememberDone(u.page);
    await openCalendar(u.page, { gid: gidOf[Y] });
    await put3b;

    // 4) เครื่อง/เบราว์เซอร์ที่เปิดใหม่ด้วยคุกกี้เดิม → ยังจำ
    const reopened = await openAs(await u.context.storageState(), { locale, theme: 'light' });
    await go(reopened.page, '/calendar');
    await expect(switcher(reopened.page)).toHaveAttribute('aria-label', labelRe(locale, Y));
    // เครื่องอื่นที่ไม่มีคุกกี้ (จำแยกตามเครื่อง) → กลุ่มแรก
    const other = await newDevice();
    await setPrefs(other.context, baseURL!, { locale });
    await call(other.context.request, 'POST', '/api/auth/login', { username: u.p.username, pin: GOOD_PIN });
    await go(other.page, '/calendar');
    await expect(switcher(other.page)).toHaveAttribute('aria-label', labelRe(locale, D0));

    // 5) logout (ปุ่มจริง) → คุกกี้หาย · login ใหม่ → กลุ่มแรก ไม่ใช่ Y
    await go(u.page, '/me');
    await u.page.getByRole('button', { name: T('me.logout'), exact: true }).click();
    await expect(u.page).toHaveURL(/\/login/);
    await expect.poll(async () => (await u.context.cookies()).some((c) => c.name === 'mm_group'), { message: 'logout ลบ mm_group' }).toBe(false);
    const login = await postJson(u.context.request, '/api/auth/login', { username: u.p.username, pin: GOOD_PIN });
    expect(login.status()).toBe(200);
    await go(u.page, '/calendar');
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, D0));
    expect(nonHydration(problems), 'console').toEqual([]);
  });

  // ───────── R6D-2 ─────────
  test('R6D-2: คุกกี้ชี้กลุ่มที่ออกแล้ว/uuid มั่ว/ไม่ใช่สมาชิก/ไม่ใช่ uuid → กลุ่มแรกตามเดิม ไม่ error ไม่รั่ว', async ({ newDevice, baseURL }) => {
    test.setTimeout(150_000);
    const owner = await makeUser(newDevice, baseURL!, 'Own', { locale });
    const stranger = await makeUser(newDevice, baseURL!, 'Str', { locale });
    const u = await makeUser(newDevice, baseURL!, 'Usr', { locale });
    const names = [`R6D2a ${rand()}`, `R6D2b ${rand()}`, `R6D2c ${rand()}`];
    const gids: string[] = [];
    for (const n of names) gids.push(await makeGroup(owner, n, [u]));
    const secretName = `R6D2-secret ${rand()}`;
    const secretGid = await makeGroup(stranger, secretName, []); // u ไม่ใช่สมาชิก
    const problems = watchConsole(u.page);
    const shown = async (): Promise<string> => (await switcher(u.page).getAttribute('aria-label'))!;
    const setCookie = (value: string) => u.context.addCookies([{ name: 'mm_group', value, url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);

    await go(u.page, '/calendar');
    const baseline = await shown();
    const D0 = names[gids.map((_, i) => i).find((i) => baseline.includes(names[i]!))!]!;
    const wIdx = names.findIndex((n) => n !== D0);
    const W = names[wIdx]!;
    const wGid = gids[wIdx]!;

    // กลุ่ม W ที่จำไว้ใช้งานได้ก่อน (ยืนยันว่าคุกกี้มีผลจริง) → ออกจาก W → กลับไปกลุ่มแรก
    expect((await call(u.context.request, 'PUT', '/api/me/current-group', { gid: wGid })).status).toBe(200);
    await go(u.page, '/calendar');
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, W));
    expect((await call(u.context.request, 'POST', `/api/groups/${wGid}/leave`)).status).toBe(200);
    await go(u.page, '/calendar');
    await u.page.getByTestId('cal-view-month').waitFor();
    await expect(switcher(u.page)).toHaveAttribute('aria-label', labelRe(locale, D0));
    await expect(u.page.getByTestId('cal-group-missing')).toHaveCount(0);
    expect(await pageDump(u.page)).not.toContain(W);

    // ค่ามั่ว: uuid ที่ไม่มีอยู่ · ไม่ใช่ uuid · ว่าง · กลุ่มของคนอื่น (ไม่ใช่สมาชิก) → ได้กลุ่มแรกเหมือนกัน ไม่รั่วชื่อ/การมีอยู่
    for (const bad of ['9b2b6d0e-5c55-4c0f-9d61-0f3d2a1c7e11', 'zzz-not-a-uuid', secretGid]) {
      await setCookie(bad);
      await go(u.page, '/calendar');
      await u.page.getByTestId('cal-view-month').waitFor();
      await expect(switcher(u.page), `คุกกี้ ${bad.slice(0, 8)}`).toHaveAttribute('aria-label', labelRe(locale, D0));
      await expect(u.page.getByTestId('cal-group-missing'), `คุกกี้ ${bad.slice(0, 8)}: ไม่มีแถบ "ไม่พบกลุ่ม" (ไม่บอกว่ากลุ่มมีอยู่)`).toHaveCount(0);
      expect(await pageDump(u.page)).not.toContain(secretName);
    }
    // เป็นสมาชิกกลุ่มของตัวเองแต่ยัง ?g= เป็นกลุ่มของคนอื่น → แจ้งสั้นๆ ตามเดิม (พฤติกรรมของ ?g= ไม่เปลี่ยน) แต่ไม่รั่วชื่อ
    await openCalendar(u.page, { gid: secretGid });
    await u.page.getByTestId('cal-view-month').waitFor();
    expect(await pageDump(u.page)).not.toContain(secretName);
    expect(nonHydration(problems), 'console').toEqual([]);
  });

  // ───────── R6D-3 / R6D-4 ─────────
  test('R6D-3/4 scenario A: A ไปนัดในลั้ลลา → แอ่วเห็น A ไม่ว่าง "ติดนัดกลุ่มอื่น" (ไม่มีชื่อนัด/กลุ่ม/id/สถานที่) · ลั้ลลาเห็น "นัด: ..." · เปลี่ยนใจ/ยกเลิก → ว่าง', async ({ newDevice, baseURL }) => {
    test.setTimeout(240_000);
    const [A, B, C, D] = [
      await makeUser(newDevice, baseURL!, 'Ann', { locale }),
      await makeUser(newDevice, baseURL!, 'Ben', { locale }),
      await makeUser(newDevice, baseURL!, 'Cat', { locale }),
      await makeUser(newDevice, baseURL!, 'Dan', { locale }),
    ] as const;
    const nameL = `ลั้ลลา ${rand()}`;
    const nameE = `แอ่ว ${rand()}`;
    const gidL = await makeGroup(A, nameL, [B]);
    const gidE = await makeGroup(A, nameE, [C, D]);
    const X = daysAhead(10);
    const [cTitle, cPlace] = [canary('title'), canary('place')];
    const apptId = await createApptApi(B.context.request, gidL, { title: cTitle, ...slot(X, '12:00', '15:00'), placeName: cPlace, lat: 13.75, lng: 100.5 });
    const problems = [A, B, C, D].map((m) => watchConsole(m.page));
    const seenC = recordResponses(C.page);
    const seenD = recordResponses(D.page);

    /** แอ่วเห็น A: free = ไม่มี A ในรายการ+ไม่มีแท่ง · other = มีแถว "ติดนัดกลุ่มอื่น" 12:00–15:00 และไม่มีข้อมูลนัดลั้ลลาในหน้า/response */
    async function expectEveryoneInEOf(viewer: Member, seen: ReturnType<typeof recordResponses>, state: 'free' | 'other') {
      await openCalendar(viewer.page, { gid: gidE, view: 'day', date: X });
      await expect(viewer.page.getByTestId('cal-day-panel')).toHaveAttribute('data-date', X);
      const strip = viewer.page.getByTestId(`cal-strip-${A.userId}`);
      await expect(strip).toBeVisible();
      if (state === 'free') {
        await expect(viewer.page.getByTestId(`cal-person-${A.userId}`)).toHaveCount(0);
        await expect(strip.getByTestId('cal-bar')).toHaveCount(0);
        await expect(viewer.page.getByTestId('cal-item-other-group')).toHaveCount(0);
        await expect(viewer.page.getByTestId('cal-day-empty')).toBeVisible();
      } else {
        const item = viewer.page.getByTestId(`cal-person-${A.userId}`).getByTestId('cal-item-other-group');
        await expect(item).toHaveCount(1);
        await expect(item).toContainText(T('calendar.kind.otherLabel'));
        await expect(item).toContainText('12:00');
        await expect(item).toContainText('15:00');
        await expect(strip.getByTestId('cal-bar')).toHaveCount(1);
        await expect(strip.getByTestId('cal-bar')).toHaveAttribute('data-kind', 'other_group_appointment');
        // แตะไม่ได้: ไม่ใช่ลิงก์/ปุ่ม
        expect(await item.evaluate((el) => ({ tag: el.tagName, href: el.getAttribute('href'), role: el.getAttribute('role'), tabindex: el.getAttribute('tabindex') }))).toEqual({ tag: 'DIV', href: null, role: 'group', tabindex: null });
        await expect(item.getByRole('link')).toHaveCount(0);
      }
      await seen.settled();
      const dump = await pageDump(viewer.page);
      for (const [what, s] of [['ชื่อนัด', cTitle], ['สถานที่', cPlace], ['ชื่อกลุ่มลั้ลลา', nameL], ['id นัด', apptId], ['id กลุ่มลั้ลลา', gidL]] as const) {
        expect(dump, `DOM ของ ${viewer.p.displayName} (${state}) ต้องไม่มี${what}`).not.toContain(s);
        expect(seen.texts.filter((t) => t.includes(s)).length, `response ของ ${viewer.p.displayName} (${state}) ต้องไม่มี${what}`).toBe(0);
      }
    }

    // A อาจจะไป / ไม่ไป → แอ่วเห็น A ว่าง (ไม่มี popup)
    await go(A.page, `/appointments/${apptId}`);
    await expect(A.page.getByTestId('appt-detail-title')).toHaveText(cTitle);
    await pickDirect(A.page, 'maybe');
    await expectEveryoneInEOf(C, seenC, 'free');
    await pickDirect(A.page, 'not_going');
    await expectEveryoneInEOf(C, seenC, 'free');

    // A ไป (กดยืนยัน) → แอ่วเห็น A ไม่ว่าง "ติดนัดกลุ่มอื่น"
    await pickConfirmed(A.page, 'going', 'to');
    await expect.poll(() => mineOf(A, apptId)).toBe('going');
    await expectEveryoneInEOf(C, seenC, 'other');
    await expectEveryoneInEOf(D, seenD, 'other');

    // ลั้ลลา (กลุ่มของนัด) เห็น "นัด: <ชื่อนัด>" แตะไปหน้านัดได้ · ไม่ใช่ป้ายกลุ่มอื่น
    await openCalendar(B.page, { gid: gidL, view: 'day', date: X });
    const item = B.page.getByTestId(`cal-person-${A.userId}`).getByTestId('cal-item-appointment');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(cTitle);
    await expect(item).toContainText(T('calendar.kind.appointmentLabel', { title: '' }).replace(/\s+$/, ''));
    await expect(item).toHaveAttribute('href', `/appointments/${apptId}`);
    await expect(B.page.getByTestId('cal-item-other-group')).toHaveCount(0);
    await expect(B.page.getByTestId(`cal-strip-${A.userId}`).getByTestId('cal-bar')).toHaveAttribute('data-kind', 'appointment');

    // แท็บ "ของฉัน" ของ A: เห็นนัดที่ไป พร้อมชื่อกลุ่มของตัวเอง · แตะไปหน้านัด · ไม่มีปุ่มแก้/ลบ
    await openCalendar(A.page, { gid: gidE, view: 'mine' });
    const rows = A.page.getByTestId('mine-going-row');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(cTitle);
    await expect(rows).toContainText(nameL);
    await expect(rows).toHaveAttribute('href', `/appointments/${apptId}`);
    await expect(A.page.getByTestId('mine-going-section').getByRole('button')).toHaveCount(0);

    // A เปลี่ยนเป็นไม่ไป (popup from) → แอ่วเห็น A ว่าง · ของฉันว่าง
    await go(A.page, `/appointments/${apptId}`);
    await pickConfirmed(A.page, 'not_going', 'from');
    await expect.poll(() => mineOf(A, apptId)).toBe('not_going');
    await expectEveryoneInEOf(C, seenC, 'free');
    await openCalendar(B.page, { gid: gidL, view: 'day', date: X });
    await expect(B.page.getByTestId(`cal-person-${A.userId}`)).toHaveCount(0);
    await openCalendar(A.page, { gid: gidE, view: 'mine' });
    await expect(A.page.getByTestId('mine-going-empty')).toBeVisible();

    // A ไปอีกครั้ง แล้วผู้สร้างยกเลิกนัด → แอ่วเห็น A ว่าง (หายเอง ไม่มีแถว busy ค้าง)
    await go(A.page, `/appointments/${apptId}`);
    await pickConfirmed(A.page, 'going', 'to');
    await expectEveryoneInEOf(C, seenC, 'other');
    await cancelApptApi(B.context.request, apptId);
    await expectEveryoneInEOf(C, seenC, 'free');
    await openCalendar(A.page, { gid: gidE, view: 'mine' });
    await expect(A.page.getByTestId('mine-going-empty')).toBeVisible();

    for (const [i, p] of problems.entries()) expect(nonHydration(p), `console ของเครื่อง ${i}`).toEqual([]);
  });

  // ───────── R6D-5 ─────────
  test('R6D-5: popup เป็น "ไป"/จาก "ไป" · maybe↔not_going ไม่มี popup · Esc/ยกเลิก = ไม่เปลี่ยน · โฟกัสเริ่มที่ปุ่มคงเดิม · focus trap · คีย์บอร์ดยืนยันได้', async ({ newDevice, baseURL }) => {
    test.setTimeout(180_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann', 'Ben'] });
    const [A, B] = scene.members as [Member, Member];
    const id = await createApptApi(A.context.request, scene.gid, { title: 'R6D-5 นัด', ...slot(daysAhead(12), '18:00', '20:00') });
    const problems = watchConsole(B.page);
    const p = B.page;
    await go(p, `/appointments/${id}`);

    // คำอธิบายใต้ปุ่ม + ผูก aria-describedby
    await expect(p.getByTestId('appt-rsvp-hint')).toHaveText(T('appointments.rsvp.goingHint'));
    const hintId = await p.getByTestId('appt-rsvp-hint').getAttribute('id');
    await expect(p.getByRole('group', { name: T('appointments.rsvp.question') })).toHaveAttribute('aria-describedby', hintId!);

    // ตอบครั้งแรกเป็น maybe / not_going = ไม่มี popup
    await pickDirect(p, 'maybe');
    await pickDirect(p, 'not_going');
    await pickDirect(p, 'maybe');
    await expect.poll(() => mineOf(B, id)).toBe('maybe');

    // maybe → going: popup "to" · โฟกัสเริ่มที่ปุ่มคงเดิม · ปุ่มเป็นชื่อผลลัพธ์
    await rsvpBtn(p, 'going').click();
    await expect(dialog(p)).toBeVisible();
    await expect(popup(p)).toHaveAttribute('data-direction', 'to');
    await expect(dialog(p)).toHaveAccessibleName(T('appointments.goingConfirm.toTitle'));
    await expect(p.getByTestId('rsvp-conflicts')).toHaveCount(0); // ไม่มีนัดชน
    await expect(p.getByTestId('rsvp-confirm-cancel')).toHaveText(T('appointments.goingConfirm.keep', { prev: 'maybe' }));
    await expect(p.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.toConfirm'));
    await expect(p.getByTestId('rsvp-confirm-cancel')).toBeFocused(); // ไม่เลือกปุ่มยืนยันไว้ก่อน
    // Esc = ยกเลิก = ไม่เปลี่ยน · โฟกัสคืนปุ่มที่กด
    await p.keyboard.press('Escape');
    await expect(dialog(p)).toHaveCount(0);
    await expect(rsvpBtn(p, 'maybe')).toHaveAttribute('aria-pressed', 'true');
    await expect(rsvpBtn(p, 'going')).toHaveAttribute('aria-pressed', 'false');
    await expect(rsvpBtn(p, 'going')).toBeFocused();
    await expect.poll(() => mineOf(B, id)).toBe('maybe');
    // ปุ่มยกเลิก = ไม่เปลี่ยน
    await rsvpBtn(p, 'going').click();
    await p.getByTestId('rsvp-confirm-cancel').click();
    await expect(dialog(p)).toHaveCount(0);
    await expect(rsvpBtn(p, 'maybe')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mineOf(B, id)).toBe('maybe');
    // scrim (กดนอก sheet) = ยกเลิก
    await rsvpBtn(p, 'going').click();
    await p.locator('.scrim').click({ position: { x: 5, y: 5 } });
    await expect(dialog(p)).toHaveCount(0);
    await expect.poll(() => mineOf(B, id)).toBe('maybe');

    // focus trap: Tab/Shift+Tab วนอยู่ใน dialog
    await rsvpBtn(p, 'going').click();
    const inDialog = () => dialog(p).evaluate((el) => el.contains(document.activeElement));
    for (let i = 0; i < 5; i++) {
      await p.keyboard.press('Tab');
      expect(await inDialog(), `Tab ครั้งที่ ${i + 1} ยังอยู่ใน dialog`).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await p.keyboard.press('Shift+Tab');
      expect(await inDialog(), `Shift+Tab ครั้งที่ ${i + 1} ยังอยู่ใน dialog`).toBe(true);
    }
    // คีย์บอร์ดล้วนยืนยันได้: โฟกัสปุ่มยืนยันแล้ว Enter
    await p.getByTestId('rsvp-confirm-ok').focus();
    await p.keyboard.press('Enter');
    await expect(dialog(p)).toHaveCount(0);
    await expect(rsvpBtn(p, 'going')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mineOf(B, id)).toBe('going');
    // ตอบ "ไป" ซ้ำ (คำตอบเดิม) = ไม่มี popup ไม่เรียกซ้ำ
    await rsvpBtn(p, 'going').click();
    await expect(dialog(p)).toHaveCount(0);

    // going → maybe: popup "from" · ปุ่ม "ยังไป" มาก่อน · Esc/ยกเลิกไม่เปลี่ยน
    await rsvpBtn(p, 'maybe').click();
    await expect(popup(p)).toHaveAttribute('data-direction', 'from');
    await expect(dialog(p)).toHaveAccessibleName(T('appointments.goingConfirm.fromTitle'));
    await expect(p.getByTestId('rsvp-confirm-cancel')).toHaveText(T('appointments.goingConfirm.fromKeep'));
    await expect(p.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.fromConfirm', { next: 'maybe' }));
    await expect(p.getByTestId('rsvp-confirm-cancel')).toBeFocused();
    await expect(p.getByTestId('rsvp-conflicts')).toHaveCount(0);
    await p.keyboard.press('Escape');
    await expect(dialog(p)).toHaveCount(0);
    await expect(rsvpBtn(p, 'going')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mineOf(B, id)).toBe('going');
    await rsvpBtn(p, 'not_going').click();
    await expect(p.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.fromConfirm', { next: 'not_going' }));
    await p.getByTestId('rsvp-confirm-cancel').click();
    await expect(rsvpBtn(p, 'going')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mineOf(B, id)).toBe('going');
    // ยืนยัน → not_going
    await pickConfirmed(p, 'not_going', 'from');
    await expect.poll(() => mineOf(B, id)).toBe('not_going');
    // not_going → maybe = ไม่มี popup
    await pickDirect(p, 'maybe');
    await expect.poll(() => mineOf(B, id)).toBe('maybe');
    // ตอบครั้งแรกเป็น "ไป" ของอีกคน (ยังไม่เคยตอบ → going): ปุ่มคงเดิมเป็น "ยังไม่ตอบ"
    await go(A.page, `/appointments/${id}`);
    await rsvpBtn(A.page, 'going').click();
    await expect(A.page.getByTestId('rsvp-confirm-cancel')).toHaveText(T('appointments.goingConfirm.keep', { prev: 'none' }));
    await A.page.getByTestId('rsvp-confirm-cancel').click();
    await expect(A.page.locator('[data-testid^="appt-rsvp-"][aria-pressed="true"]')).toHaveCount(0);
    await expect.poll(() => mineOf(A, id)).toBeNull();
    expect(nonHydration(problems), 'console').toEqual([]);
  });

  // ───────── R6D-5b ─────────
  test('R6D-5b: ไปนัดที่ทับ → popup บอกชื่อ+เวลาที่ชน (นัดในกลุ่ม/กลุ่มอื่น/busy ของตัวเอง) · ยืนยันได้ · ป้ายชน · ชนขอบพอดีไม่ชน · ไม่หลุดไปสมาชิกอื่น', async ({ newDevice, baseURL }) => {
    test.setTimeout(240_000);
    const A = await makeUser(newDevice, baseURL!, 'Ann', { locale });
    const B = await makeUser(newDevice, baseURL!, 'Ben', { locale });
    const nameG1 = `R6D5b-1 ${rand()}`;
    const nameG2 = `R6D5b-2 ${rand()}`;
    const g1 = await makeGroup(A, nameG1, [B]);
    const g2 = await makeGroup(A, nameG2, []);
    const D3 = daysAhead(12);
    const D4 = daysAhead(13);
    const [t1, t2, tq, tb] = [`ชน1 ${rand()}`, `ชน2 ${rand()}`, canary('qtitle'), `ซ้อมดนตรี ${rand()}`];
    const p1 = await createApptApi(B.context.request, g1, { title: t1, ...slot(D3, '10:00', '12:00') });
    const p2 = await createApptApi(B.context.request, g1, { title: t2, ...slot(D3, '11:00', '13:00') });
    const q1 = await createApptApi(A.context.request, g2, { title: tq, ...slot(D3, '11:30', '12:30') });
    await createBusyApi(A.context.request, { kind: 'timed', startDate: D3, startTime: '12:30', endDate: D3, endTime: '13:30', title: tb });
    const e1 = await createApptApi(B.context.request, g1, { title: `ขอบ1 ${rand()}`, ...slot(D4, '10:00', '11:00') });
    const e2 = await createApptApi(B.context.request, g1, { title: `ขอบ2 ${rand()}`, ...slot(D4, '11:00', '12:00') });
    const problems = [A, B].map((m) => watchConsole(m.page));
    const seenB = recordResponses(B.page);
    const badge = (p: Page) => p.getByTestId('appt-conflict-badge');

    // a) ไป P1 ก่อน: ยังไม่มีอะไรทับ → popup ไม่มีส่วนชน
    await go(A.page, `/appointments/${p1}`);
    await rsvpBtn(A.page, 'going').click();
    await expect(popup(A.page)).toHaveAttribute('data-direction', 'to');
    await expect(A.page.getByTestId('rsvp-conflicts')).toHaveCount(0);
    await expect(A.page.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.toConfirm'));
    await A.page.getByTestId('rsvp-confirm-ok').click();
    await expect(dialog(A.page)).toHaveCount(0);
    await expect(badge(A.page)).toHaveCount(0); // ไม่มีอะไรชน → ไม่มีป้าย
    // b) นัดกลุ่มอื่นที่ตอบ "ไป" แล้ว (11:30–12:30 ทับ P1)
    await rsvpApi(A.context.request, q1, 'going');

    // c) ไป P2 (11:00–13:00): ชน P1 (กลุ่มเดียวกัน) · Q1 (กลุ่มอื่น บอกชื่อกลุ่ม) · busy ที่ลงเอง (12:30–13:30)
    await go(A.page, `/appointments/${p2}`);
    await rsvpBtn(A.page, 'going').click();
    const list = A.page.getByTestId('rsvp-conflicts');
    await expect(list).toBeVisible();
    await expect(A.page.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.conflictConfirm'));
    await expect(A.page.getByTestId('rsvp-confirm-cancel')).toHaveText(T('appointments.goingConfirm.keep', { prev: 'none' }));
    await expect(list.locator('li')).toHaveCount(3);
    const li = (s: string) => list.locator('li').filter({ hasText: s });
    await expect(li(t1)).toHaveCount(1);
    await expect(li(t1)).toContainText('10:00');
    await expect(li(t1)).toContainText('12:00');
    await expect(li(t1)).not.toContainText(nameG1); // กลุ่มเดียวกัน ไม่ต้องบอกชื่อกลุ่ม
    await expect(li(tq)).toHaveCount(1);
    await expect(li(tq)).toContainText(nameG2); // นัดกลุ่มอื่นของตัวเอง บอกชื่อกลุ่ม
    await expect(li(tq)).toContainText('11:30');
    await expect(li(tb)).toHaveCount(1);
    await expect(li(tb)).toContainText('12:30');
    await expect(list).not.toContainText(t2); // ไม่ชนตัวเอง
    await expect(list).toContainText(T('appointments.goingConfirm.conflictNote'));
    // ไม่บล็อก: ยืนยัน → ตอบ "ไป" ได้ · ป้ายชนที่หน้านัด
    await A.page.getByTestId('rsvp-confirm-ok').click();
    await expect(dialog(A.page)).toHaveCount(0);
    await expect(rsvpBtn(A.page, 'going')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mineOf(A, p2)).toBe('going');
    await expect(badge(A.page)).toBeVisible();
    await expect(badge(A.page)).toContainText(T('appointments.conflictBadge'));
    await go(A.page, `/appointments/${p2}`); // โหลดใหม่ก็ยังมีป้าย
    await expect(badge(A.page)).toBeVisible();
    await go(A.page, `/appointments/${p1}`);
    await expect(badge(A.page)).toBeVisible(); // P1 ชนกับ P2/Q1 ด้วย

    // d) รายการนัดของกลุ่ม: A มีป้ายบนแถว P1/P2 · B (ไม่ได้ตอบไป) ไม่มีป้ายเลย
    await go(A.page, `/groups/${g1}/appointments`);
    await expect(A.page.getByTestId('appt-row').filter({ hasText: t1 }).getByTestId('appt-conflict-badge')).toHaveCount(1);
    await expect(A.page.getByTestId('appt-row').filter({ hasText: t2 }).getByTestId('appt-conflict-badge')).toHaveCount(1);
    await go(B.page, `/groups/${g1}/appointments`);
    await expect(B.page.getByTestId('appt-row')).not.toHaveCount(0);
    await expect(badge(B.page)).toHaveCount(0);
    await go(B.page, `/appointments/${p2}`);
    await expect(badge(B.page)).toHaveCount(0);

    // e) ข้อมูลชนไม่หลุดไปสมาชิกอื่น: B เรียก API ของ P2 / รายการ / ปฏิทิน — ไม่มีชื่อ Q1 / ชื่อกลุ่ม 2 / id / busy ส่วนตัว
    const bDetail = await call<{ appointment: ApptApi & { myConflicts: unknown[] } }>(B.context.request, 'GET', `/api/appointments/${p2}`);
    expect(bDetail.status).toBe(200);
    expect(bDetail.json?.data?.appointment.myConflicts, 'B ไม่ได้ตอบไป → ไม่มีรายการชน').toEqual([]);
    const bList = await call<{ appointments: { id: string; myConflict?: boolean }[] }>(B.context.request, 'GET', `/api/groups/${g1}/appointments?scope=upcoming`);
    expect(bList.json?.data?.appointments.some((a) => a.myConflict === true)).toBe(false);
    const bCal = await call(B.context.request, 'GET', `/api/groups/${g1}/calendar?from=${D3}&to=${D4}`);
    expect(bCal.status).toBe(200);
    for (const [what, s] of [['ชื่อนัดกลุ่มอื่น', tq], ['ชื่อกลุ่มอื่น', nameG2], ['id นัดกลุ่มอื่น', q1], ['id กลุ่มอื่น', g2]] as const) {
      for (const [src, txt] of [['detail', bDetail.text], ['list', bList.text], ['calendar', bCal.text]] as const) expect(txt, `API ${src} ของ B ต้องไม่มี${what}`).not.toContain(s);
    }
    expect(bDetail.text).not.toContain(tb);
    await openCalendar(B.page, { gid: g1, view: 'day', date: D3 });
    await expect(B.page.getByTestId(`cal-person-${A.userId}`).getByTestId('cal-item-other-group')).toHaveCount(1); // Q1 ของ A เห็นเป็นกลุ่มอื่น
    await seenB.settled();
    for (const [what, s] of [['ชื่อนัดกลุ่มอื่น', tq], ['ชื่อกลุ่มอื่น', nameG2], ['id นัดกลุ่มอื่น', q1], ['id กลุ่มอื่น', g2]] as const) {
      expect(await pageDump(B.page), `DOM ของ B ต้องไม่มี${what}`).not.toContain(s);
      expect(seenB.texts.filter((t) => t.includes(s)).length, `response ของ B ต้องไม่มี${what}`).toBe(0);
    }

    // f) เปลี่ยน P2 เป็นไม่ไป (popup from) → ป้ายหายที่ P2
    await go(A.page, `/appointments/${p2}`);
    await pickConfirmed(A.page, 'not_going', 'from');
    await expect(badge(A.page)).toHaveCount(0);

    // g) ชนขอบพอดี (E1 10–11 · E2 11–12) → popup ไม่มีส่วนชน · ไม่มีป้ายทั้งสองนัด
    await go(A.page, `/appointments/${e1}`);
    await pickConfirmed(A.page, 'going', 'to');
    await go(A.page, `/appointments/${e2}`);
    await rsvpBtn(A.page, 'going').click();
    await expect(popup(A.page)).toHaveAttribute('data-direction', 'to');
    await expect(A.page.getByTestId('rsvp-conflicts')).toHaveCount(0);
    await expect(A.page.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.toConfirm'));
    await A.page.getByTestId('rsvp-confirm-ok').click();
    await expect(dialog(A.page)).toHaveCount(0);
    await expect(badge(A.page)).toHaveCount(0);
    await go(A.page, `/appointments/${e1}`);
    await expect(rsvpBtn(A.page, 'going')).toHaveAttribute('aria-pressed', 'true');
    await expect(badge(A.page)).toHaveCount(0);

    for (const [i, pr] of problems.entries()) expect(nonHydration(pr), `console ของเครื่อง ${i}`).toEqual([]);
  });

  // ───────── หน้าหลัก (NextCard) ─────────
  test('หน้าหลัก: popup ที่การ์ดนัดถัดไป (ยืนยัน/ยกเลิก/Esc/จาก "ไป") + ชื่อนัดที่ชน + ป้ายชนบนการ์ดและแถว', async ({ newDevice, baseURL }) => {
    test.setTimeout(180_000);
    const scene = await makeScene(newDevice, baseURL!, { locale, labels: ['Ann', 'Ben'] });
    const [A, B] = scene.members as [Member, Member];
    const D1 = daysAhead(1);
    const [t0, t3] = [`หน้าหลัก-ถัดไป ${rand()}`, `หน้าหลัก-ทับ ${rand()}`];
    const e0 = await createApptApi(A.context.request, scene.gid, { title: t0, ...slot(D1, '09:00', '11:00') });
    const e3 = await createApptApi(A.context.request, scene.gid, { title: t3, ...slot(D1, '10:00', '12:00') });
    await rsvpApi(B.context.request, e3, 'going');
    const problems = watchConsole(B.page);
    const p = B.page;
    const card = p.getByTestId('home-next-card');
    const going = p.getByTestId('home-rsvp-going');
    await go(p, '/');
    await expect(card).toContainText(t0);
    // หมายเหตุ: HomeView ยังไม่ใส่ data-testid="home-rsvp-hint" (มีแต่ id) → ใช้ id แทนจนกว่า frontend เพิ่ม testid
    await expect(p.locator('#home-rsvp-hint')).toHaveText(T('appointments.rsvp.goingHint'));

    // กด "ไป" → popup (ดึงรายละเอียดมาบอกนัดที่ชน) · Esc = ไม่เปลี่ยน
    await going.click();
    await expect(popup(p)).toHaveAttribute('data-direction', 'to');
    await expect(p.getByTestId('rsvp-conflicts')).toContainText(t3);
    await expect(p.getByTestId('rsvp-conflicts')).toContainText('10:00');
    await expect(p.getByTestId('rsvp-confirm-cancel')).toBeFocused();
    await p.keyboard.press('Escape');
    await expect(dialog(p)).toHaveCount(0);
    await expect(going).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mineOf(B, e0)).toBeNull();
    // ยกเลิกด้วยปุ่ม = ไม่เปลี่ยน
    await going.click();
    await p.getByTestId('rsvp-confirm-cancel').click();
    await expect(dialog(p)).toHaveCount(0);
    await expect(going).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mineOf(B, e0)).toBeNull();
    // ยืนยัน → ไป · ป้ายชนบนการ์ด + แถวของนัดที่ทับ
    await going.click();
    await expect(p.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.conflictConfirm'));
    await p.getByTestId('rsvp-confirm-ok').click();
    await expect(dialog(p)).toHaveCount(0);
    await expect(going).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mineOf(B, e0)).toBe('going');
    await expect(card.getByTestId('appt-conflict-badge')).toBeVisible();
    await expect(p.locator(`[data-testid="home-row"][data-appt-id="${e3}"]`).getByTestId('appt-conflict-badge')).toBeVisible();

    // จาก "ไป" → popup from · ยกเลิก (ยังไป) · ยืนยัน → maybe · ป้ายหาย
    const maybe = p.getByTestId('home-rsvp-maybe');
    await maybe.click();
    await expect(popup(p)).toHaveAttribute('data-direction', 'from');
    await expect(p.getByTestId('rsvp-confirm-cancel')).toHaveText(T('appointments.goingConfirm.fromKeep'));
    await p.getByTestId('rsvp-confirm-cancel').click();
    await expect(going).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mineOf(B, e0)).toBe('going');
    await maybe.click();
    await p.getByTestId('rsvp-confirm-ok').click();
    await expect(dialog(p)).toHaveCount(0);
    await expect(maybe).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mineOf(B, e0)).toBe('maybe');
    await expect(p.getByTestId('appt-conflict-badge')).toHaveCount(0);
    // maybe → not_going = ไม่มี popup
    await p.getByTestId('home-rsvp-not_going').click();
    await expect(p.getByTestId('home-rsvp-not_going')).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog(p)).toHaveCount(0);
    await expect.poll(() => mineOf(B, e0)).toBe('not_going');
    expect(nonHydration(problems), 'console').toEqual([]);
  });
});

// ═════════════════════════ R6D-7 เลย์เอาต์ (ทุกขนาดจอ) ═════════════════════════
const COMBOS: { locale: Locale; theme: Theme }[] = [
  { locale: 'th', theme: 'light' },
  { locale: 'en', theme: 'dark' },
];
const LONG_NAME = 'Abcdefghijklmnopqrstuvwxyz0123456789ABCD'; // 40 ตัว ไม่เว้นวรรค
const LONG_GROUP = `LongGroup${'x'.repeat(31)}`; // 40 ตัว
const LONG_TITLE = `LongTitle${'x'.repeat(71)}`; // 80 ตัว
const LONG_BUSY = `LongBusy${'z'.repeat(72)}`; // 80 ตัว

/** sheet อยู่ในจอ: ไม่ล้นข้าง · ปุ่มท้าย sheet เห็นครบและ ≥ 44px · ข้อความในรายการชนไม่ล้นแถว */
async function expectSheetFits(page: Page, label: string): Promise<void> {
  await settleAnimations(page); // R6E E12: sheet มี transition เข้า ≤ 200 ms
  const r = await dialog(page).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, sw: el.scrollWidth, cw: el.clientWidth, vw: document.documentElement.clientWidth, vh: window.innerHeight };
  });
  expect(r.left, `${label}: sheet ไม่ล้นซ้าย`).toBeGreaterThanOrEqual(0);
  expect(r.right, `${label}: sheet ไม่ล้นขวา`).toBeLessThanOrEqual(r.vw);
  expect(r.top, `${label}: sheet ไม่ล้นบน`).toBeGreaterThanOrEqual(0);
  expect(r.bottom, `${label}: sheet ไม่ล้นล่าง`).toBeLessThanOrEqual(r.vh + 1);
  expect(r.sw, `${label}: sheet ไม่มี horizontal scroll ภายใน`).toBeLessThanOrEqual(r.cw);
  for (const id of ['rsvp-confirm-ok', 'rsvp-confirm-cancel']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.height, `${label}: ${id} สูง ≥ 44`).toBeGreaterThanOrEqual(44);
    expect(b.x, `${label}: ${id} ไม่ล้นซ้าย`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${label}: ${id} ไม่ล้นขวา`).toBeLessThanOrEqual(r.vw);
    expect(b.y, `${label}: ${id} อยู่ในจอ (บน)`).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height, `${label}: ${id} อยู่ในจอ (ล่าง)`).toBeLessThanOrEqual(r.vh + 1);
    const clipped = await page.getByTestId(id).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, `${label}: ข้อความปุ่ม ${id} ไม่ถูกตัด`).toBe(false);
  }
  const rows = await page.getByTestId('rsvp-conflicts').locator('li').evaluateAll((els) => els.map((e) => ({ over: e.scrollWidth > e.clientWidth + 1, right: e.getBoundingClientRect().right })));
  for (const [i, row] of rows.entries()) {
    expect(row.over, `${label}: แถวชน ${i} ไม่ล้น`).toBe(false);
    expect(row.right, `${label}: แถวชน ${i} อยู่ในจอ`).toBeLessThanOrEqual(r.vw);
  }
}

for (const { locale, theme } of COMBOS) {
  test(`R6D-7 ${locale}/${theme}: popup/ป้ายชน/ของฉัน/วัน 3 ชนิด/legend — ไม่ล้นจอ ปุ่ม ≥44px ไม่มี console error`, async ({ newDevice, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const T = (k: string, v?: Record<string, string | number>) => msg(locale, k, v);
    const scene = await makeScene(newDevice, baseURL!, { locale, theme, labels: ['Ann', 'Ben'], displayNames: [undefined, LONG_NAME] });
    const [A, B] = scene.members as [Member, Member];
    const g1 = scene.gid;
    const g2 = await createGroupApi(A.context.request, LONG_GROUP);
    const D = daysAhead(8);
    const far = daysAhead(15);
    const p1 = await createApptApi(B.context.request, g1, { title: LONG_TITLE, ...slot(D, '18:00', '20:00') });
    const q1 = await createApptApi(A.context.request, g2, { title: 'นัดกลุ่มอื่น', ...slot(D, '19:00', '21:00') });
    const p2 = await createApptApi(B.context.request, g1, { title: 'นัดที่สอง', ...slot(D, '19:00', '20:30') });
    const p4 = await createApptApi(B.context.request, g1, { title: 'นัดไกล', ...slot(far, '10:00', '11:00') });
    await createBusyApi(A.context.request, { kind: 'timed', startDate: D, startTime: '18:30', endDate: D, endTime: '19:30', title: LONG_BUSY });
    await rsvpApi(A.context.request, p1, 'going');
    await rsvpApi(A.context.request, q1, 'going');
    const problems = [A, B].map((m) => watchConsole(m.page));
    const a = A.page;
    const check = (p: Page, label: string) => checkLayout(p, testInfo, label, locale, theme);

    // หน้านัดที่ยังไม่ตอบ: คำอธิบายใต้ปุ่ม
    await go(a, `/appointments/${p2}`);
    await expect(a.getByTestId('appt-rsvp-hint')).toHaveText(T('appointments.rsvp.goingHint'));
    await check(a, 'r6d-detail-unanswered');

    // popup เป็น "ไป" แบบมีส่วนชน (3 รายการ: นัดชื่อ 80 ตัว · นัดกลุ่มอื่นชื่อกลุ่ม 40 ตัว · busy ชื่อ 80 ตัว)
    await rsvpBtn(a, 'going').click();
    await expect(a.getByTestId('rsvp-conflicts').locator('li')).toHaveCount(3);
    await expect(a.getByTestId('rsvp-confirm-ok')).toHaveText(T('appointments.goingConfirm.conflictConfirm'));
    await expectSheetFits(a, 'popup-conflict');
    await check(a, 'r6d-popup-to-conflict');
    await a.keyboard.press('Escape');
    await expect(dialog(a)).toHaveCount(0);

    // popup เป็น "ไป" แบบไม่ชน (ปุ่มยาวในภาษาอังกฤษ)
    await go(a, `/appointments/${p4}`);
    await rsvpBtn(a, 'going').click();
    await expect(a.getByTestId('rsvp-conflicts')).toHaveCount(0);
    await expectSheetFits(a, 'popup-to');
    await check(a, 'r6d-popup-to');
    await a.keyboard.press('Escape');
    await expect(dialog(a)).toHaveCount(0);

    // ยืนยัน P2 → หน้านัดมีป้ายชน → popup จาก "ไป"
    await go(a, `/appointments/${p2}`);
    await pickConfirmed(a, 'going', 'to');
    await expect(a.getByTestId('appt-conflict-badge')).toBeVisible();
    await check(a, 'r6d-detail-badge');
    await rsvpBtn(a, 'not_going').click();
    await expect(popup(a)).toHaveAttribute('data-direction', 'from');
    await expectSheetFits(a, 'popup-from');
    await check(a, 'r6d-popup-from');
    await a.keyboard.press('Escape');
    await expect(dialog(a)).toHaveCount(0);

    // รายการนัดของกลุ่ม (ป้ายบนแถว) · หน้าหลัก (ป้ายบนการ์ด + popup จากการ์ด)
    await go(a, `/groups/${g1}/appointments`);
    await expect(a.getByTestId('appt-row').filter({ hasText: LONG_TITLE }).getByTestId('appt-conflict-badge')).toHaveCount(1);
    await check(a, 'r6d-list-badge');
    await go(a, '/');
    await expect(a.getByTestId('home-next-card').getByTestId('appt-conflict-badge')).toBeVisible();
    await check(a, 'r6d-home-badge');
    await a.getByTestId('home-rsvp-maybe').click();
    await expect(popup(a)).toHaveAttribute('data-direction', 'from');
    await expectSheetFits(a, 'home-popup-from');
    await check(a, 'r6d-home-popup-from');
    await a.keyboard.press('Escape');
    await expect(dialog(a)).toHaveCount(0);

    // แท็บของฉัน: ส่วนนัดที่ตอบไป
    await openCalendar(a, { gid: g1, view: 'mine' });
    await expect(a.getByTestId('mine-going-row')).toHaveCount(3);
    await check(a, 'r6d-mine-going');

    // มุมมองวัน (ของ B): แท่ง/รายการ 3 ชนิดในวันเดียว + legend
    await openCalendar(B.page, { gid: g1, view: 'day', date: D });
    await expect(B.page.getByTestId('cal-day-panel')).toHaveAttribute('data-date', D);
    await expect(B.page.getByTestId('cal-item')).toHaveCount(1); // busy ที่ลงเอง
    await expect(B.page.getByTestId('cal-item-appointment')).toHaveCount(2); // P1 + P2
    await expect(B.page.getByTestId('cal-item-other-group')).toHaveCount(1); // Q1
    const kinds = await B.page.getByTestId('cal-bar').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-kind')))].sort());
    expect(kinds).toEqual(['appointment', 'busy', 'other_group_appointment']);
    await check(B.page, 'r6d-day-kinds');
    await openCalendar(B.page, { gid: g1, view: 'month', date: D });
    await expect(B.page.getByTestId('cal-kinds')).toBeVisible();
    await check(B.page, 'r6d-month-legend');

    for (const [i, pr] of problems.entries()) {
      for (const x of pr.filter(isHydration)) testInfo.annotations.push({ type: 'hydration', description: `${i}: ${x.text.slice(0, 80)}` });
      expect(nonHydration(pr), `console ของเครื่อง ${i}`).toEqual([]);
    }
  });
}
