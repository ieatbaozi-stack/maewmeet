// fixture การยืนยันตัวตนของ E2E (R1) — ผู้ใช้สุ่มต่อเทสต์ · IP ต่อเทสต์ · แก้ DB ตรง ๆ แทนขั้นตอนที่ boss ทำเอง (is_admin)
//
// ทำไมต้อง x-real-ip: rate limit ของ auth นับต่อ IP (signup 5/ชม., reset 3/ชม.) — เทสต์ทั้งชุดมาจาก IP เดียว
//   แอปเชื่อ x-real-ip เฉพาะเมื่อ VERCEL หรือ TRUST_PROXY_HEADERS=1 (src/lib/auth/request.ts · e2e ตั้งใน tests/e2e/support/env.ts) → ให้ทุกเทสต์/ทุก "เครื่อง" มี IP สมมติของตัวเอง
//   (ไม่ได้ทำให้เทสต์ผ่านด้วยการปิด limit — limit ทำงานจริง เพียงแต่ไม่ชนกันข้ามเทสต์)
// ทำไมไม่มีนาฬิกาจำลองในเบราว์เซอร์: `next start` เป็นโปรเซสแยก ไม่มี hook ปรับ clock จากภายนอก
//   (clock.ts ใช้ setClock ในโปรเซสเดียวกันเท่านั้น) → เคส "เกิน 24 ชม." ทดสอบที่ระดับ integration:
//   tests/auth/pin-reset-login.test.ts ("เลื่อน 24 ชม.+1 วินาที → ผิดและ expired")
import { randomBytes, randomInt } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import { test as base, expect, type APIRequestContext, type PlaywrightWorkerArgs, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_BASE_URL, E2E_DATABASE_URL } from './env';
import { setPrefs } from './fixtures';
import { msg, type Locale } from './messages';

export { expect };

/** PIN ปกติของผู้ใช้ทดสอบ — ไม่ใช่เลขซ้ำ/เรียง (ไม่ติด PIN_TOO_WEAK) */
export const GOOD_PIN = '135792';
export const OTHER_PIN = '246813';
/** PIN ชั่วคราวหลัง reset (ADR 0002 §5) */
export const RESET_PIN = '123456';

export const randomIp = (): string => `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
/** username 3–20 ตัว a-z0-9._ */
export const uniqueUsername = (prefix = 'e2e'): string => `${prefix}_${randomBytes(5).toString('hex')}`;

// ───────── DB ของเซิร์ฟเวอร์ E2E (ไฟล์เดียวกับที่ next start ใช้) ─────────
let dbClient: Client | undefined;
function db(): Client {
  if (!dbClient) {
    // timeout = busy timeout (ms) ของ DB ไฟล์: รอ lock แทนล้มทันที (เซิร์ฟเวอร์ next start เขียนไฟล์เดียวกันอยู่)
    dbClient = createClient({ url: E2E_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined, timeout: 15_000 });
  }
  return dbClient;
}
/** SQLITE_BUSY จากการแย่งเขียนกับเซิร์ฟเวอร์ → ลองใหม่ (busy_timeout ของ PRAGMA ไม่การันตีใน libsql client) */
async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 8 || !/database is locked|SQLITE_BUSY/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}
async function run(sql: string, args: (string | number)[]): Promise<void> {
  const res = await withBusyRetry(() => db().execute({ sql, args }));
  if (res.rowsAffected !== 1) throw new Error(`คาดว่าแก้ 1 แถว แต่ได้ ${res.rowsAffected}: ${sql}`);
}
/** เทียบ boss: `UPDATE user SET is_admin = 1` (R1_CONTRACT §7 ข้อ 2) — มีผลทันทีเพราะ getActor อ่านจาก DB ทุก request */
export const promoteToSuperAdmin = (username: string) => run('UPDATE user SET is_admin = 1 WHERE username_normalized = ?', [username.toLowerCase()]);
export const forceMustChangePin = (username: string) => run('UPDATE user SET must_change_pin = 1 WHERE username_normalized = ?', [username.toLowerCase()]);

export async function userRow(username: string): Promise<{ must_change_pin: number; is_admin: number } | undefined> {
  const r = await withBusyRetry(() => db().execute({ sql: 'SELECT must_change_pin, is_admin FROM user WHERE username_normalized = ?', args: [username.toLowerCase()] }));
  return r.rows[0] as unknown as { must_change_pin: number; is_admin: number } | undefined;
}

// ───────── API ─────────
/** สมัครผ่าน API: cookie session ลง jar ของ request context (ซึ่งใช้ร่วมกับ BrowserContext) */
export async function signupViaApi(
  request: APIRequestContext,
  u: { username: string; displayName?: string; pin?: string },
): Promise<void> {
  const pin = u.pin ?? GOOD_PIN;
  // 500 UNKNOWN จาก SQLITE_BUSY ของ DB ไฟล์ (ดู Handoff) → ลองใหม่ได้ เพราะ signup ที่ล้มก่อน insert ไม่ทิ้งแถว
  let res = await postSignup(request, u.username, u.displayName, pin);
  for (let i = 0; i < 4 && res.status() === 500; i++) {
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    res = await postSignup(request, u.username, u.displayName, pin);
  }
  expect(res.status(), `signup ${u.username}: ${await res.text()}`).toBe(201);
}

function postSignup(request: APIRequestContext, username: string, displayName: string | undefined, pin: string) {
  return request.post('/api/auth/signup', {
    headers: { origin: E2E_BASE_URL },
    data: { username, displayName: displayName ?? `E2E ${username}`, pin, pinConfirm: pin },
  });
}

export async function postJson(request: APIRequestContext, path: string, data: unknown = {}) {
  // 500 จาก SQLITE_BUSY (ดู Handoff D1) → ลองใหม่เฉพาะ endpoint ที่ซ้ำได้โดยไม่เปลี่ยนผล (pin-reset/approve ซ้ำ = 202/ผลเดิม)
  let res = await request.post(path, { headers: { origin: E2E_BASE_URL }, data });
  for (let i = 0; i < 4 && res.status() === 500; i++) {
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    res = await request.post(path, { headers: { origin: E2E_BASE_URL }, data });
  }
  return res;
}

// ───────── fixtures ─────────
export type User = { username: string; displayName: string; pin: string };

/** cookie jar ที่เซฟได้ (storageState ของ Playwright) */
export type Jar = Awaited<ReturnType<APIRequestContext['storageState']>>;

/**
 * "โลก" ต่อ worker — สร้างครั้งเดียวต่อ worker (ไม่ใช่ต่อเทสต์) แล้วแชร์เป็น cookie jar:
 *   user ปกติ · super admin · ผู้ใช้ที่ติด must_change_pin · เครื่องของผู้ขอ reset ที่ pending / approved แล้ว
 * ใช้โดยเทสต์เลย์เอาต์/เมทริกซ์ที่ต้องการแค่ "หน้าในสถานะนั้น" ไม่ต้องสมัคร/อนุมัติใหม่ทุกครั้ง (ลดเวลา e2e)
 * ห้ามใช้กับเทสต์ที่เปลี่ยนสถานะผู้ใช้ (ตั้ง PIN, ออกจากระบบ, อนุมัติ) — ใช้ `user`/`newDevice` ที่สร้างใหม่ต่อเทสต์
 */
export type World = { user: Jar; admin: Jar; mustChange: Jar; resetPending: Jar; resetApproved: Jar; pendingUsername: string };

async function freshApi(playwright: PlaywrightWorkerArgs['playwright']): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: { 'x-real-ip': randomIp() } });
}

async function buildWorld(playwright: PlaywrightWorkerArgs['playwright']): Promise<World> {
  const open: APIRequestContext[] = [];
  const api = async () => {
    const c = await freshApi(playwright);
    open.push(c);
    return c;
  };
  const signedIn = async (prefix: string, after?: (username: string) => Promise<void>) => {
    const c = await api();
    const username = uniqueUsername(prefix);
    await signupViaApi(c, { username });
    await after?.(username);
    return { c, username };
  };
  try {
    const user = await signedIn('wu');
    const admin = await signedIn('wadm', promoteToSuperAdmin);
    const mustChange = await signedIn('wmc', forceMustChangePin);

    // เครื่องของผู้ขอ reset: บัญชีสมัครจาก jar หนึ่ง (ทิ้ง) แล้วขอจาก jar ใหม่ → jar หลังมีแค่ cookie ผูกเครื่อง ไม่มี session
    const requestFromDevice = async (prefix: string) => {
      const owner = await signedIn(prefix);
      const device = await api();
      expect((await postJson(device, '/api/auth/pin-reset', { username: owner.username })).status()).toBe(202);
      return { device, username: owner.username };
    };
    const pending = await requestFromDevice('wrp');
    const approved = await requestFromDevice('wra');
    let list = await admin.c.get('/api/auth/admin/pin-resets?status=pending');
    for (let i = 0; i < 4 && list.status() === 500; i++) {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      list = await admin.c.get('/api/auth/admin/pin-resets?status=pending');
    }
    const items = ((await list.json()) as { data: { items: { id: string; username: string }[] } }).data.items;
    const id = items.find((i) => i.username === approved.username)?.id;
    if (!id) throw new Error('ไม่พบคำขอ reset ที่เพิ่งสร้างในรายการ admin');
    expect((await postJson(admin.c, `/api/auth/admin/pin-resets/${id}/approve`)).status()).toBe(200);

    return {
      user: await user.c.storageState(),
      admin: await admin.c.storageState(),
      mustChange: await mustChange.c.storageState(),
      resetPending: await pending.device.storageState(),
      resetApproved: await approved.device.storageState(),
      pendingUsername: pending.username,
    };
  } finally {
    await Promise.all(open.map((c) => c.dispose()));
  }
}

/** worker ทุกตัวสร้างโลกพร้อมกันตอนเริ่ม → เขียน DB ไฟล์ชนกันได้ (D1) — ลองใหม่ทั้งชุด (ใช้ username ใหม่ ของเก่าทิ้งไว้ไม่เป็นปัญหา) */
async function buildWorldWithRetry(playwright: PlaywrightWorkerArgs['playwright']): Promise<World> {
  for (let i = 0; ; i++) {
    try {
      return await buildWorld(playwright);
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 500 + randomInt(0, 1500)));
    }
  }
}

type Fixtures = {
  /** ผู้ใช้ใหม่ที่ "ล็อกอินอยู่แล้ว" ใน page/context ของเทสต์ (สมัครผ่าน API) */
  user: User;
  /** เปิด BrowserContext ใหม่จาก cookie jar ของ `world` (+ ค่าภาษา/ธีม) */
  openAs: (jar: Jar, prefs?: { locale?: Locale; theme?: 'light' | 'dark' | 'system' }) => Promise<{ context: BrowserContext; page: Page }>;
  /** สร้าง "เครื่อง" (BrowserContext) ใหม่ — cookie jar แยก, IP สมมติแยก, ขนาดจอ/touch ตาม project */
  newDevice: () => Promise<{ context: BrowserContext; page: Page }>;
};

export const test = base.extend<Fixtures, { world: World }>({
  world: [
    async ({ playwright }, provide) => {
      await provide(await buildWorldWithRetry(playwright));
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  // IP สมมติต่อเทสต์ (override option fixture ของ Playwright)
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ 'x-real-ip': randomIp() });
  },
  user: async ({ context }, provide) => {
    const username = uniqueUsername();
    await signupViaApi(context.request, { username });
    await provide({ username, displayName: `E2E ${username}`, pin: GOOD_PIN });
  },
  openAs: async ({ browser, baseURL }, provide, testInfo) => {
    const opened: BrowserContext[] = [];
    await provide(async (jar, prefs) => {
      const context = await newDeviceContext(browser, testInfo.project.use, jar);
      opened.push(context);
      if (prefs) await setPrefs(context, baseURL!, prefs);
      return { context, page: await context.newPage() };
    });
    await Promise.all(opened.map((c) => c.close()));
  },
  newDevice: async ({ browser }, provide, testInfo) => {
    const opened: BrowserContext[] = [];
    await provide(async () => {
      const context = await newDeviceContext(browser, testInfo.project.use);
      opened.push(context);
      return { context, page: await context.newPage() };
    });
    await Promise.all(opened.map((c) => c.close()));
  },
});

type ProjectUse = {
  viewport?: { width: number; height: number } | null;
  isMobile?: boolean;
  hasTouch?: boolean;
  deviceScaleFactor?: number;
  locale?: string;
  timezoneId?: string;
};
export function newDeviceContext(browser: Browser, use: ProjectUse, storageState?: Jar): Promise<BrowserContext> {
  return browser.newContext({
    storageState,
    baseURL: E2E_BASE_URL,
    viewport: use.viewport ?? undefined,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
    locale: use.locale ?? 'th-TH',
    timezoneId: use.timezoneId ?? 'Asia/Bangkok',
    extraHTTPHeaders: { 'x-real-ip': randomIp() },
  });
}

// ───────── ท่าทางบนหน้าจอ ─────────
/** กดแป้น PIN ทีละหลัก (ปุ่มเลขมี accessible name = ตัวเลข · กลุ่มแป้นชื่อ login.keypad.label) */
export async function pressPin(page: Page, locale: Locale, pin: string): Promise<void> {
  const keypad = page.getByRole('group', { name: msg(locale, 'login.keypad.label') });
  for (const d of pin) await keypad.getByRole('button', { name: d, exact: true }).click();
}

/** สร้างบัญชี + คำขอ reset ที่ pending จาก "เครื่อง" นี้ (ไม่ล็อกอินค้าง) — คืน username */
export async function createPendingReset(context: BrowserContext, username: string): Promise<void> {
  await signupViaApi(context.request, { username });
  await context.clearCookies({ name: /^(__Host-)?mm_session$/ });
  const res = await postJson(context.request, '/api/auth/pin-reset', { username });
  expect(res.status(), 'pin-reset request').toBe(202);
}

/** super admin อนุมัติคำขอของ username ผ่านหน้า /admin/pin-resets */
export async function approveInAdminUi(page: Page, locale: Locale, username: string): Promise<void> {
  await page.goto('/admin/pin-resets', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'adminResets.title'));
  const item = page.getByRole('listitem').filter({ has: page.getByText(username, { exact: true }) });
  await item.getByRole('button', { name: msg(locale, 'adminResets.approveFor', { username }) }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('checkbox', { name: msg(locale, 'adminResets.approveSheet.check') }).check();
  await sheet.getByRole('button', { name: msg(locale, 'adminResets.approveSheet.confirm'), exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: msg(locale, 'adminResets.approvedToast', { username }) })).toBeVisible();
}

/** ผู้ดูแลระบบใหม่ในเครื่องใหม่ (สมัครผ่าน API แล้วตั้ง is_admin ด้วย SQL) */
export async function newSuperAdmin(context: BrowserContext): Promise<string> {
  const username = uniqueUsername('adm');
  await signupViaApi(context.request, { username });
  await promoteToSuperAdmin(username);
  return username;
}

/** role=alert ของหน้า (ไม่รวม route announcer ของ Next ที่เป็น role=alert ว่างเปล่าเสมอ) */
export const alertOf = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
