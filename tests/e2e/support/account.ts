// ตัวช่วย E2E ของ R5 (บัญชีของฉัน + หน้าผู้ดูแลระบบ + audit) — ตั้งฉากผ่าน API/DB ส่วนที่ไม่ใช่เป้าหมาย · ท่าทางหลักใช้ UI จริง
import { createClient, type Client } from '@libsql/client';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { E2E_DATABASE_URL } from './env';
import { expect, OTHER_PIN, postJson, pressPin, promoteToSuperAdmin, signupViaApi, uniqueUsername } from './auth';
import { setPrefs } from './fixtures';
import { msg, type Locale } from './messages';

export type Device = { context: BrowserContext; page: Page };
export type Account = Device & { username: string; displayName: string };

/** เครื่องใหม่ + บัญชีใหม่ (ล็อกอินอยู่) + ภาษา/ธีม · admin=true → ตั้ง is_admin ด้วย SQL (เทียบขั้นตอนของ boss) */
export async function account(
  newDevice: () => Promise<Device>,
  baseURL: string,
  o: { locale: Locale; theme?: 'light' | 'dark'; label?: string; admin?: boolean; displayName?: string },
): Promise<Account> {
  const d = await newDevice();
  await setPrefs(d.context, baseURL, { locale: o.locale, theme: o.theme ?? 'light' });
  const username = uniqueUsername(o.label ?? (o.admin ? 'sa' : 'u'));
  const displayName = o.displayName ?? `${o.label ?? 'User'} ${Math.random().toString(16).slice(2, 8)}`;
  await signupViaApi(d.context.request, { username, displayName });
  if (o.admin) await promoteToSuperAdmin(username);
  return { ...d, username, displayName };
}

// ───────── DB ตรง (ไฟล์เดียวกับเซิร์ฟเวอร์ next start) ─────────
let client: Client | undefined;
const db = (): Client => (client ??= createClient({ url: E2E_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined, timeout: 15_000 }));
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

export async function userIdByUsername(username: string): Promise<string> {
  const r = await withBusyRetry(() => db().execute({ sql: 'SELECT id FROM user WHERE username_normalized = ?', args: [username.toLowerCase()] }));
  const id = r.rows[0]?.id;
  if (typeof id !== 'string') throw new Error(`ไม่พบผู้ใช้ ${username}`);
  return id;
}

export async function userById(id: string): Promise<{ status: string; username: string; display_name: string; pin_hash: string | null } | undefined> {
  const r = await withBusyRetry(() => db().execute({ sql: 'SELECT status, username, display_name, pin_hash FROM user WHERE id = ?', args: [id] }));
  return r.rows[0] as unknown as { status: string; username: string; display_name: string; pin_hash: string | null } | undefined;
}

export async function sessionCount(userId: string): Promise<number> {
  const r = await withBusyRetry(() => db().execute({ sql: 'SELECT count(*) AS n FROM session WHERE user_id = ?', args: [userId] }));
  return Number(r.rows[0]?.n ?? 0);
}

export async function auditCount(action: string, targetId: string): Promise<number> {
  const r = await withBusyRetry(() => db().execute({ sql: 'SELECT count(*) AS n FROM audit_log WHERE action = ? AND target_id = ?', args: [action, targetId] }));
  return Number(r.rows[0]?.n ?? 0);
}

/** ใส่ PIN ผิดผ่าน API จนล็อก (5 ครั้ง — ADR 0002 §3) จากเครื่องที่ไม่ได้ล็อกอิน */
export async function lockAccount(request: APIRequestContext, username: string): Promise<void> {
  for (let i = 0; i < 5; i++) await postJson(request, '/api/auth/login', { username, pin: OTHER_PIN });
  const r = await postJson(request, '/api/auth/login', { username, pin: OTHER_PIN });
  expect(r.status(), 'บัญชีควรถูกล็อกแล้ว').toBe(429);
}

/** login ผ่าน API ด้วยเครื่อง (request context) ที่ให้มา — คืน status + code */
export async function loginApi(request: APIRequestContext, username: string, pin: string): Promise<{ status: number; code: string | undefined }> {
  const r = await postJson(request, '/api/auth/login', { username, pin });
  const json = (await r.json().catch(() => undefined)) as { error?: { code?: string } } | undefined;
  return { status: r.status(), code: json?.error?.code };
}

// ───────── ท่าทางบนหน้าจอ ─────────

/** แท็บ ฉัน → ลบบัญชี → ไปต่อ → ใส่ PIN (ครบ 6 หลักส่งทันที) */
export async function deleteAccountInUi(page: Page, locale: Locale, pin: string): Promise<void> {
  await page.goto('/me', { waitUntil: 'networkidle' });
  await page.getByTestId('me-delete').click();
  const sheet = page.getByRole('alertdialog');
  await expect(sheet.getByRole('heading', { name: msg(locale, 'account.delete.title') })).toBeVisible();
  await expect(sheet.getByText(msg(locale, 'account.delete.gone.busy'))).toBeVisible();
  // โฟกัสเริ่มที่ "ยกเลิก" (ไม่ใช่ปุ่มทำลาย)
  await expect(sheet.getByRole('button', { name: msg(locale, 'common.cancel'), exact: true })).toBeFocused();
  await sheet.getByRole('button', { name: msg(locale, 'account.delete.continue') }).click();
  await expect(sheet.getByText(msg(locale, 'account.delete.pinTitle'))).toBeVisible();
  await pressPin(page, locale, pin);
}

/** หน้า /admin/users: ค้นหา username แล้วคืน locator ของการ์ดนั้น */
export async function findUserCard(page: Page, locale: Locale, username: string) {
  await page.goto('/admin/users', { waitUntil: 'networkidle' });
  await page.getByLabel(msg(locale, 'adminUsers.searchLabel'), { exact: true }).fill(username);
  await page.getByRole('button', { name: msg(locale, 'admin.search'), exact: true }).click();
  const card = page.locator(`[data-testid="admin-user"][data-username="${username}"]`);
  await expect(card).toBeVisible();
  return card;
}
