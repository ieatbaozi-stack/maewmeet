// เครื่องมือเทสต์ของ Auth (R1) — DB libSQL ไฟล์จริง + migration จริง · นาฬิกา inject · pepper สร้างในเทสต์เท่านั้น
// เรียก route handler จริงผ่าน Request/Response (ไม่รัน server) พร้อม cookie jar ต่อ "เครื่อง" (Client)
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import type { Db } from '@/db/client';
import { resetDbClient } from '@/db/client';
import { ROUTE_MANIFEST, type ManifestEntry } from '@/app/api/_lib/manifest';
import { resetPepperCache, resolvePepper } from '@/lib/auth/pepper';
import { hashPin, type Pepper } from '@/lib/auth/pin';
import { insertUser, type UserRow } from '@/lib/data/repos/user';
import { fixedClock, resetClock, setClock } from '@/lib/shared/clock';
import { resetEnvCache } from '@/lib/shared/env';
import { newId } from '@/lib/shared/id';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

export const ORIGIN = 'https://maewmeet.test';
export const START = Date.UTC(2026, 9, 18, 3, 0, 0); // 2026-10-18 10:00 BKK
export const SESSION_COOKIE = 'mm_session'; // NODE_ENV=test → ชื่อสำหรับ dev/test (ADR 0002 §4)
export const RESET_COOKIE = 'mm_reset';
/** PIN ที่ไม่อยู่ในกลุ่มต้องห้าม ใช้เป็น PIN ปกติของผู้ใช้ทดสอบ */
export const GOOD_PIN = '135792';
export const OTHER_PIN = '246813';

/** pepper ทดสอบ: สร้างในเทสต์นี้เท่านั้น (ไม่ใช่ค่าจริง · ไม่ commit ค่าใดทั้งสิ้น) */
export const freshPepper = (): string => randomBytes(32).toString('base64');

const PEPPER_KEY = /^PIN_PEPPER_/;
export function setPepperEnv(peppers: Record<number, string>, current: number | null): void {
  for (const k of Object.keys(process.env)) if (PEPPER_KEY.test(k)) delete process.env[k];
  for (const [v, value] of Object.entries(peppers)) process.env[`PIN_PEPPER_V${v}`] = value;
  if (current !== null) process.env.PIN_PEPPER_CURRENT_VERSION = String(current);
  resetEnvCache();
}

export type Res<T = Record<string, unknown>> = {
  status: number;
  /** body ดิบ (string) — ใช้เทียบ "ทุกไบต์" */
  text: string;
  json: { data?: T; error?: { code: string; params?: Record<string, unknown> } };
  headers: Headers;
  setCookies: string[];
  data: T;
  code: string | undefined;
};

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

const handlerCache = new Map<string, Handler>();
const ROOT = path.resolve(import.meta.dirname, '../..');

/** path แบบ manifest (/api/a/:id/b) → ไฟล์ route.ts จริง */
export async function handlerFor(entry: Pick<ManifestEntry, 'method' | 'path'>): Promise<Handler> {
  const key = `${entry.method} ${entry.path}`;
  const hit = handlerCache.get(key);
  if (hit) return hit;
  const dir = entry.path.replace(/^\//, '').split('/').map((s) => (s.startsWith(':') ? `[${s.slice(1)}]` : s)).join('/');
  const mod = (await import(/* @vite-ignore */ path.join(ROOT, 'src/app', dir, 'route.ts'))) as Record<string, Handler>;
  const h = mod[entry.method];
  if (!h) throw new Error(`no ${entry.method} export for ${entry.path}`);
  handlerCache.set(key, h);
  return h;
}

let clientSeq = 0;

/** "เครื่อง" หนึ่งเครื่อง: cookie jar + IP + UA */
export class Client {
  readonly jar = new Map<string, string>();
  constructor(
    public ip = `10.1.${Math.floor(clientSeq / 250)}.${(clientSeq++ % 250) + 1}`,
    public ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  ) {}

  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name: string): string | undefined {
    return this.jar.get(name);
  }
  set(name: string, value: string): void {
    this.jar.set(name, value);
  }
  /** ลอกสำเนาคุกกี้ไปอีกเครื่อง (จำลองการขโมย/ใช้ token ซ้ำ) */
  cloneJarTo(other: Client): void {
    for (const [k, v] of this.jar) other.jar.set(k, v);
  }

  async call<T = Record<string, unknown>>(
    method: 'GET' | 'POST',
    urlPath: string,
    body?: unknown,
    opts: { headers?: Record<string, string>; params?: Record<string, string>; noCookie?: boolean } = {},
  ): Promise<Res<T>> {
    const pathOnly = urlPath.split('?')[0]!;
    // หา manifest entry: เทียบ path รูป :param
    const entry = ROUTE_MANIFEST.find((e) => e.method === method && matches(e.path, pathOnly));
    if (!entry) throw new Error(`not in manifest: ${method} ${urlPath}`);
    const h = await handlerFor(entry);
    const headers = new Headers({ origin: ORIGIN, 'x-real-ip': this.ip, 'user-agent': this.ua, ...opts.headers });
    if (method !== 'GET') headers.set('content-type', 'application/json');
    if (!opts.noCookie && this.jar.size) headers.set('cookie', this.cookieHeader());
    const req = new Request(`${ORIGIN}${urlPath}`, {
      method,
      headers,
      ...(method !== 'GET' ? { body: body === undefined ? undefined : JSON.stringify(body) } : {}),
    });
    const params = opts.params ?? paramsOf(entry.path, pathOnly);
    const res = await h(req, { params: Promise.resolve(params) });
    const text = await res.text();
    const setCookies = res.headers.getSetCookie();
    for (const sc of setCookies) {
      const [pair, ...attrs] = sc.split(';').map((s) => s.trim());
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      const maxAge = attrs.find((a) => /^max-age=/i.test(a));
      if (value === '' || (maxAge && Number(maxAge.split('=')[1]) <= 0)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const json = text ? (JSON.parse(text) as Res['json']) : {};
    return {
      status: res.status,
      text,
      json: json as Res<T>['json'],
      headers: res.headers,
      setCookies,
      data: json.data as T,
      code: json.error?.code,
    };
  }

  post = <T = Record<string, unknown>>(p: string, body?: unknown, opts?: Parameters<Client['call']>[3]) =>
    this.call<T>('POST', p, body ?? {}, opts);
  getJson = <T = Record<string, unknown>>(p: string, opts?: Parameters<Client['call']>[3]) =>
    this.call<T>('GET', p, undefined, opts);

  login = (username: string, pin: string) => this.post('/api/auth/login', { username, pin });
}

function matches(pattern: string, actual: string): boolean {
  const a = pattern.split('/');
  const b = actual.split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}
function paramsOf(pattern: string, actual: string): Record<string, string> {
  const out: Record<string, string> = {};
  const b = actual.split('/');
  pattern.split('/').forEach((seg, i) => {
    if (seg.startsWith(':')) out[seg.slice(1)] = b[i]!;
  });
  return out;
}

export type Harness = {
  t: InstalledTestDb;
  db: Db;
  clock: ReturnType<typeof fixedClock>;
  peppers: Record<number, string>;
  /** สร้างผู้ใช้ตรง ๆ ผ่าน repo (ไม่กิน rate limit ของ signup) */
  seedUser(username: string, pin?: string, opts?: { version?: number; displayName?: string; isAdmin?: boolean; pepper?: string }): Promise<UserRow>;
  /** จำลอง SQL ของ boss: UPDATE user SET is_admin = 1 WHERE username = '…' */
  setAdminBySql(username: string, value?: boolean): Promise<void>;
  rows<T = Record<string, unknown>>(query: string, args?: (string | number | null)[]): Promise<T[]>;
  /** SELECT count(*) … → number */
  count(fromWhere: string, args?: (string | number | null)[]): Promise<number>;
  cleanup(): Promise<void>;
};

export async function setupHarness(
  opts: { peppers?: Record<number, string>; current?: number | null; startAt?: number; initFingerprint?: boolean } = {},
): Promise<Harness> {
  const t = await installTestDb({ APP_ORIGIN: ORIGIN });
  const peppers = opts.peppers ?? { 1: freshPepper() };
  setPepperEnv(peppers, opts.current === undefined ? Math.max(...Object.keys(peppers).map(Number)) : opts.current);
  resetPepperCache();
  const clock = fixedClock(opts.startAt ?? START);
  setClock(clock);
  const db = t.db;
  // เหมือนระบบจริง: request แรกที่ต้องใช้ pepper ตั้ง fingerprint ตอนฐานยังว่าง (ก่อนมีผู้ใช้) — ข้ามได้เพื่อทดสอบกรณีแถวหาย
  if (opts.initFingerprint !== false && opts.current !== null) await resolvePepper(db, clock.now());
  const h: Harness = {
    t,
    db,
    clock,
    peppers,
    async seedUser(username, pin = GOOD_PIN, o = {}) {
      const version = o.version ?? Math.max(...Object.keys(peppers).map(Number));
      const secret = Buffer.from(o.pepper ?? peppers[version]!, 'base64');
      const pepper: Pepper = { version, secret };
      const row = await insertUser(
        db,
        {
          id: newId(),
          username,
          usernameNormalized: username.toLowerCase(),
          displayName: o.displayName ?? username,
          pinHash: await hashPin(pin, pepper),
          pinPepperVersion: version,
        },
        clock.now(),
      );
      if (!row) throw new Error('seed failed');
      if (o.isAdmin) await h.setAdminBySql(username, true);
      return row;
    },
    async setAdminBySql(username, value = true) {
      await db.run(sql`UPDATE user SET is_admin = ${value ? 1 : 0} WHERE username = ${username}`);
    },
    async rows(query, args = []) {
      const r = await db.$client.execute({ sql: query, args });
      return r.rows as unknown as never[];
    },
    async count(fromWhere, args = []) {
      const r = await h.rows<{ n: number }>(`SELECT count(*) AS n FROM ${fromWhere}`, args);
      return Number(r[0]?.n ?? 0);
    },
    async cleanup() {
      resetClock();
      for (const k of Object.keys(process.env)) if (PEPPER_KEY.test(k)) delete process.env[k];
      resetDbClient();
      resetEnvCache();
      await t.cleanup();
    },
  };
  return h;
}

/** ตัดค่าที่ต่างกันโดยธรรมชาติออก (ไม่มี request id ใน R1 — เผื่อไว้) แล้วเทียบ response ทุกไบต์ */
export function sameResponse(a: Res, b: Res): void {
  expect(a.status).toBe(b.status);
  expect(a.text).toBe(b.text);
  const pick = (r: Res) => ({
    cc: r.headers.get('cache-control'),
    ct: r.headers.get('content-type'),
    ra: r.headers.get('retry-after'),
    cookies: r.setCookies.map((c) => c.replace(/=[^;]*/, '=<v>')),
  });
  expect(pick(a)).toEqual(pick(b));
}

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MIN = 60_000;

/** ผู้ใช้ที่ล็อกอินแล้วหนึ่งคน (เครื่อง + แถว) */
export async function loggedIn(h: Harness, username: string, pin = GOOD_PIN, opts: { admin?: boolean } = {}) {
  const user = await h.seedUser(username, pin, { isAdmin: opts.admin });
  const c = new Client();
  const r = await c.login(username, pin);
  expect(r.status).toBe(200);
  return { user, c };
}
