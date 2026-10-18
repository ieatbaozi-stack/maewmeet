// ตัวช่วย E2E ของ R2 (กลุ่ม/บทบาท/คำเชิญ) — ตั้งฉากผ่าน API ส่วนที่ไม่ใช่เป้าหมายของเทสต์ · ท่าทางในเรื่องราวใช้ UI จริง
// ผู้ใช้ทุกคนเป็น "เครื่อง" แยก (cookie jar + x-real-ip แยก) ผ่าน newDevice / freshApi ของ auth.ts
import { randomBytes } from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { E2E_BASE_URL } from './env';
import { expect, signupViaApi, uniqueUsername } from './auth';
import { measureLayout } from './fixtures';
import type { Locale } from './messages';

export type Role = 'admin' | 'moderator' | 'member';
export type Person = { username: string; displayName: string };

/** ชื่อที่แสดง = ชื่อที่ไม่ซ้ำกันและอ่านง่าย (ใช้เป็น accessible name ของแถวสมาชิก) */
export const person = (label: string): Person => {
  const tag = randomBytes(3).toString('hex');
  return { username: uniqueUsername(label.toLowerCase().slice(0, 4)), displayName: `${label} ${tag}` };
};

/** สมัครในเครื่อง (context) นี้ — session cookie ลง jar ของ context */
export async function signup(context: BrowserContext, p: Person): Promise<void> {
  await signupViaApi(context.request, { username: p.username, displayName: p.displayName });
}

/** เรียก API ด้วย method ใดก็ได้ (Origin ถูกต้องตาม CSRF ของ route wrapper) — คืน status + json */
export async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown) {
  // 500 จาก SQLITE_BUSY ของ DB ไฟล์ (Handoff D1) → ลองใหม่เฉพาะ GET (ซ้ำได้ไม่เปลี่ยนผล) · การเขียนที่ 500 ต้องล้มให้เห็น
  let res = await request.fetch(path, { method, headers: { origin: E2E_BASE_URL }, data: method === 'GET' ? undefined : (data ?? {}) });
  for (let i = 0; method === 'GET' && i < 4 && res.status() === 500; i++) {
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    res = await request.fetch(path, { method, headers: { origin: E2E_BASE_URL } });
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status(), json: json as { data?: any; error?: { code: string } } | undefined, text };
}

export async function createGroupApi(request: APIRequestContext, name: string): Promise<string> {
  const r = await api(request, 'POST', '/api/groups', { name });
  expect(r.status, `create group: ${r.text}`).toBe(201);
  return r.json!.data.group.id as string;
}

export type MemberRow = { userId: string; displayName: string; role: Role };
export async function membersApi(request: APIRequestContext, gid: string): Promise<MemberRow[]> {
  const r = await api(request, 'GET', `/api/groups/${gid}`);
  expect(r.status, `get group: ${r.text}`).toBe(200);
  return r.json!.data.group.members as MemberRow[];
}

/** admin สร้างโค้ด → สมาชิกใหม่ใช้โค้ด (ผ่าน API) */
export async function joinViaApiCode(admin: APIRequestContext, gid: string, joiner: APIRequestContext): Promise<void> {
  const c = await api(admin, 'POST', `/api/groups/${gid}/invites/code`);
  expect(c.status, `create code: ${c.text}`).toBe(201);
  const r = await api(joiner, 'POST', '/api/invites/redeem', { code: c.json!.data.invite.code });
  expect(r.status, `redeem: ${r.text}`).toBe(200);
}

export async function setRoleApi(admin: APIRequestContext, gid: string, userId: string, role: 'moderator' | 'member'): Promise<void> {
  const r = await api(admin, 'PATCH', `/api/groups/${gid}/members/${userId}`, { role });
  expect(r.status, `set role: ${r.text}`).toBe(200);
}

export const userIdOf = (members: MemberRow[], p: Person): string => {
  const m = members.find((x) => x.displayName === p.displayName);
  if (!m) throw new Error(`ไม่พบสมาชิก ${p.displayName}`);
  return m.userId;
};

/** goto แล้วรอให้ hydrate (networkidle) ก่อนกดอะไร */
export async function go(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
}

export type Theme = 'light' | 'dark';

/** ตรวจเลย์เอาต์ตามเกณฑ์ R0-12/R2-8 + ภาพหน้าจอเต็มหน้า (ใช้ซ้ำของ responsive.spec.ts R1 โดยไม่แก้ไฟล์นั้น) */
export async function checkLayout(
  page: Page,
  testInfo: import('@playwright/test').TestInfo,
  label: string,
  locale: Locale,
  theme: Theme,
): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const layout = await measureLayout(page);
  expect(layout.targetCount, `${label}: มีปุ่ม/ลิงก์ให้วัด`).toBeGreaterThan(0);
  expect(layout.scrollWidth, `${label}: ไม่มี horizontal scroll (documentElement)`).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.bodyScrollWidth, `${label}: ไม่มี horizontal scroll (body)`).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.smallTargets, `${label}: a/button/input ทุกตัว ≥ 44×44 px`).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath(`${label}-${locale}-${theme}-${testInfo.project.name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}
