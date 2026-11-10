// ตัวช่วย E2E ของ R4B (นัด + RSVP + สถานที่ + แจ้งเตือน + หน้าหลัก) — ตั้งฉากผ่าน API/DB ส่วนที่ไม่ใช่เป้าหมาย
//
// ข้อตกลง (เหมือน R3/R4A): ไม่มีนาฬิกาจำลอง → ใช้ "วันที่สัมพัทธ์กับวันนี้ (Asia/Bangkok)" เท่านั้น
// R13: ไม่มีค้นหาสถานที่และไม่มีภาพแผนที่ (ไม่มี tile OSM) → เทสต์ไม่ต้องดัก route ใด ๆ · ปุ่ม Google/Apple Maps เป็นลิงก์ธรรมดา ไม่มีการยิงเครือข่ายตอนโหลดหน้า
import { randomUUID } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { E2E_BASE_URL, E2E_DATABASE_URL } from './env';
import { addDays, todayBkk, type DateISO } from './busy';
import { expect, signupViaApi, uniqueUsername } from './auth';
import { createGroupApi, joinViaApiCode, membersApi, type Person } from './groups';
import { setPrefs } from './fixtures';
import { msg, type Locale } from './messages';

// ───────── API (ทุก method รวม PUT) ─────────
export type Res<T = unknown> = { status: number; json: { data?: T; error?: { code: string; [k: string]: unknown } } | undefined; text: string };

export async function call<T = Record<string, unknown>>(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<Res<T>> {
  const send = () => request.fetch(path, { method, headers: { origin: E2E_BASE_URL }, data: method === 'GET' ? undefined : (data ?? {}) });
  let res = await send();
  // SQLITE_BUSY ของ DB ไฟล์ (Handoff D1) → ลองใหม่เฉพาะ GET
  for (let i = 0; method === 'GET' && i < 4 && res.status() === 500; i++) {
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    res = await send();
  }
  const text = await res.text();
  let json: Res<T>['json'];
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status(), json, text };
}

export type ApptApi = {
  id: string;
  title: string;
  status: 'active' | 'cancelled';
  daysUntil: number;
  rsvp: { counts: { going: number; maybe: number; not_going: number; noResponse: number }; mine: string | null };
};

/** สร้างนัดผ่าน API (ต้อง 201) — คืน id */
export async function createApptApi(request: APIRequestContext, gid: string, body: Record<string, unknown>): Promise<string> {
  const r = await call<{ appointment: ApptApi }>(request, 'POST', `/api/groups/${gid}/appointments`, body);
  expect(r.status, `create appointment: ${r.text}`).toBe(201);
  return r.json!.data!.appointment.id;
}

export async function cancelApptApi(request: APIRequestContext, id: string): Promise<void> {
  const r = await call(request, 'POST', `/api/appointments/${id}/cancel`, {});
  expect(r.status, `cancel appointment: ${r.text}`).toBe(200);
}

export async function rsvpApi(request: APIRequestContext, id: string, response: 'going' | 'maybe' | 'not_going'): Promise<void> {
  const r = await call(request, 'PUT', `/api/appointments/${id}/rsvp`, { response });
  expect(r.status, `rsvp: ${r.text}`).toBe(200);
}

// ───────── วันที่ ─────────
/** จำนวนวันปฏิทินจาก a ถึง b (วันที่ท้องถิ่น) */
export const daysBetween = (a: DateISO, b: DateISO): number => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
export const daysAhead = (n: number): DateISO => addDays(todayBkk(), n);
/** ชั่วโมง 0–23 ของ "ตอนนี้" ใน Asia/Bangkok */
export const bangkokHour = (): number => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(Date.now())) % 24;

// ───────── ฉาก: กลุ่ม + สมาชิกหลายเครื่อง ─────────
type Device = { context: BrowserContext; page: Page };
export type Member = Device & { p: Person; userId: string };

export type Scene = { gid: string; groupName: string; members: Member[] };

/**
 * สร้างผู้ใช้ n คน (คนแรก = ผู้สร้างกลุ่ม/admin) ในกลุ่มเดียว — แต่ละคนเป็น "เครื่อง" แยก (cookie jar + IP)
 * names: displayName ของแต่ละคน (ไม่ระบุ = "<label> <tag>")
 */
export async function makeScene(
  newDevice: () => Promise<Device>,
  baseURL: string,
  o: { locale: Locale; theme?: 'light' | 'dark' | 'system'; labels: string[]; displayNames?: (string | undefined)[]; groupName?: string },
): Promise<Scene> {
  const members: Member[] = [];
  for (const [i, label] of o.labels.entries()) {
    const d = await newDevice();
    await setPrefs(d.context, baseURL, { locale: o.locale, theme: o.theme ?? 'light' });
    const username = uniqueUsername(label.toLowerCase().slice(0, 4));
    const displayName = o.displayNames?.[i] ?? `${label} ${Math.random().toString(16).slice(2, 8)}`;
    await signupViaApi(d.context.request, { username, displayName });
    members.push({ ...d, p: { username, displayName }, userId: '' });
  }
  const groupName = o.groupName ?? `R4B ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const gid = await createGroupApi(members[0]!.context.request, groupName);
  for (const m of members.slice(1)) await joinViaApiCode(members[0]!.context.request, gid, m.context.request);
  const rows = await membersApi(members[0]!.context.request, gid);
  for (const m of members) m.userId = rows.find((r) => r.displayName === m.p.displayName)!.userId;
  return { gid, groupName, members };
}

// ───────── DB ตรง (ไฟล์เดียวกับเซิร์ฟเวอร์) ─────────
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

/** แทรกนัด active n รายการด้วย SQL (เลี่ยงยิง API ร้อยครั้ง; created_at ย้อนหลัง 3 วัน ไม่ให้ติดเพดานสร้างต่อวัน R4B) — อยู่ในอนาคตไกล (ต้นปี +2) เรียงทีละ 3 ชม. */
export async function seedActiveAppointments(gid: string, createdBy: string, n: number, titlePrefix = 'seed'): Promise<void> {
  const base = Date.UTC(Number(todayBkk().slice(0, 4)) + 2, 0, 1);
  const now = Date.now();
  for (let i = 0; i < n; i += 50) {
    const vals: string[] = [];
    const args: (string | number)[] = [];
    for (let j = i; j < Math.min(n, i + 50); j++) {
      const start = base + j * 3 * 3_600_000;
      const local = new Date(start + 7 * 3_600_000).toISOString().slice(0, 10);
      vals.push("(?, ?, ?, ?, ?, 'Asia/Bangkok', ?, 'active', ?, ?, ?)");
      args.push(randomUUID(), gid, `${titlePrefix} ${j}`, start, start + 1_800_000, local, createdBy, now - 3 * 86_400_000, now);
    }
    await withBusyRetry(() =>
      db().execute({
        sql: `INSERT INTO appointment (id, group_id, title, start_at, end_at, tz, local_date, status, created_by, created_at, updated_at) VALUES ${vals.join(',')}`,
        args,
      }),
    );
  }
}

export async function countActiveAppointments(gid: string): Promise<number> {
  const r = await withBusyRetry(() => db().execute({ sql: "SELECT COUNT(*) AS n FROM appointment WHERE group_id = ? AND status = 'active'", args: [gid] }));
  return Number((r.rows[0] as unknown as { n: number }).n);
}

// ───────── ท่าทางบนหน้าจอ ─────────
export const bell = (page: Page) => page.getByTestId('bell');
export const bellBadge = (page: Page) => page.getByTestId('bell-badge');

/** รอให้ fetch-พื้นหลังของหน้าสงบ แล้วคืนข้อความ DOM ทั้งหน้า (ไว้เทียบ canary) */
export async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.outerHTML);
}

/** id ของนัดจาก URL /appointments/<uuid> */
export const apptIdFromUrl = (page: Page): string => {
  const m = /\/appointments\/([0-9a-f-]{36})(?:[/?#]|$)/.exec(page.url());
  if (!m) throw new Error(`URL ไม่ใช่หน้านัด: ${page.url()}`);
  return m[1]!;
};

/** เปิดตัวเลือกวันที่ในฟอร์มนัดแล้วเลือกวัน (ปฏิทินเดือนเดียว — เลื่อนเดือนถ้าวันอยู่เดือนหน้า) */
export async function pickFormDate(page: Page, date: DateISO, locale: Locale = 'th'): Promise<void> {
  await page.getByTestId('appt-date-toggle').click();
  const cell = page.getByTestId(`pk-${date}`);
  if ((await cell.count()) === 0) {
    // ปุ่มเดือนถัดไปของ DateRangePicker (aria-label จาก busy.form.date.nextMonth)
    await page.getByRole('button', { name: msg(locale, 'calendar.nav.nextMonth'), exact: true }).click();
  }
  await cell.click();
}

/** ข้อผิดพลาด hydration ของ React (#418/#423/#425 หรือข้อความ dev) — แยกออกจาก console error อื่นเพื่อรายงานเป็นบั๊กเดียว (ดู appt-validation.spec.ts "hydration") */
export const isHydration = (p: { text: string }): boolean => /react\.dev\/errors\/(418|423|425)|[Hh]ydrat/.test(p.text);
