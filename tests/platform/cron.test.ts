// R0-8 (ส่วน cron): 401 เมื่อ secret ผิด · รันซ้ำ 2 ครั้งผลเท่าเดิม · system_heartbeat.last_at = นาฬิกาจำลอง
// + งานเก็บกวาด ARCHITECTURE §8 ข้อ 1–3 ลบ/เปลี่ยนเฉพาะแถวที่หมดอายุจริง
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as dailyGET } from '@/app/api/cron/daily/route';
import { POST as heartbeatPOST } from '@/app/api/cron/heartbeat/route';
import { CACHE_CONTROL } from '@/app/api/_lib/route';
import { DAY_MS, HOUR_MS, fixedClock, setClock } from '@/lib/shared/clock';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const ORIGIN = 'https://maewmeet.test';
const NOW = Date.UTC(2026, 9, 16, 19, 0, 0); // 2026-10-16T19:00Z (เวลาที่ Vercel cron ยิง)

let t: InstalledTestDb;
let restoreClock: () => void;
const clock = fixedClock(NOW);

beforeEach(async () => {
  t = await installTestDb({ APP_ORIGIN: ORIGIN });
  clock.set(NOW);
  restoreClock = setClock(clock);
});
afterEach(async () => {
  restoreClock();
  await t.cleanup();
});

const exec = (sql: string, args: (string | number | null)[] = []) => t.db.$client.execute({ sql, args });
const count = async (table: string, where = '1=1') => Number((await exec(`select count(*) as n from ${table} where ${where}`)).rows[0]?.n);

function cronRequest(path: string, method: 'GET' | 'POST', authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request(`${ORIGIN}${path}`, { method, headers });
}
const daily = (auth?: string) => dailyGET(cronRequest('/api/cron/daily', 'GET', auth));
const heartbeat = (auth?: string) => heartbeatPOST(cronRequest('/api/cron/heartbeat', 'POST', auth));
const bearer = () => `Bearer ${t.env.CRON_SECRET}`;

async function heartbeats() {
  const rs = await exec('select source, last_at from system_heartbeat order by source');
  return rs.rows.map((r) => ({ source: String(r.source), lastAt: Number(r.last_at) }));
}

describe('cron auth — 401 เมื่อ secret ผิด และไม่เขียนอะไรลง DB', () => {
  const bad = (): [string, string | undefined][] => [
    ['ไม่มี Authorization', undefined],
    ['secret ผิด', 'Bearer wrong-secret-0123456789abcdef'],
    ['secret ถูกแต่ไม่ใช่ Bearer', t.env.CRON_SECRET],
    ['Basic scheme', `Basic ${t.env.CRON_SECRET}`],
    ['secret มีส่วนเกินท้าย', `${bearer()}x`],
    ['secret ขาดตัวท้าย', bearer().slice(0, -1)],
    ['Bearer ว่าง', 'Bearer '],
  ];

  it.each(['daily', 'heartbeat'] as const)('%s: ทุกกรณีผิด → 401 AUTH_REQUIRED + Cache-Control', async (which) => {
    for (const [label, auth] of bad()) {
      const res = which === 'daily' ? await daily(auth) : await heartbeat(auth);
      expect(res.status, label).toBe(401);
      expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
      const text = await res.text();
      expect(JSON.parse(text), label).toEqual({ error: { code: 'AUTH_REQUIRED' } });
      expect(text).not.toContain(t.env.CRON_SECRET);
    }
    expect(await heartbeats()).toEqual([]);
  });

  it('secret ถูก → 200 ทั้งสอง endpoint', async () => {
    expect((await daily(bearer())).status).toBe(200);
    expect((await heartbeat(bearer())).status).toBe(200);
  });
});

describe('POST /api/cron/heartbeat', () => {
  it('เขียน github-actions ด้วยเวลานาฬิกาจำลอง · รันซ้ำ = แถวเดียว ค่าเดิม', async () => {
    const r1 = await heartbeat(bearer());
    expect(r1.status).toBe(200);
    expect(r1.headers.get('cache-control')).toBe(CACHE_CONTROL);
    expect(await r1.json()).toEqual({
      data: {
        source: 'github-actions',
        lastAt: NOW,
        heartbeatAgeHours: { vercelCron: null, githubActions: 0 },
      },
    });
    expect(await heartbeats()).toEqual([{ source: 'github-actions', lastAt: NOW }]);

    const r2 = await heartbeat(bearer());
    expect(r2.status).toBe(200);
    expect(await heartbeats()).toEqual([{ source: 'github-actions', lastAt: NOW }]);
  });

  it('นาฬิกาเดินแล้วยิงใหม่ → last_at อัปเดตตามนาฬิกา · รายงานอายุ vercel-cron', async () => {
    await daily(bearer());
    clock.advance(12 * HOUR_MS + 30 * 60_000);
    const res = await heartbeat(bearer());
    const body = (await res.json()) as { data: { heartbeatAgeHours: unknown } };
    expect(body.data.heartbeatAgeHours).toEqual({ vercelCron: 12.5, githubActions: 0 });
    expect(await heartbeats()).toEqual([
      { source: 'github-actions', lastAt: NOW + 12.5 * HOUR_MS },
      { source: 'vercel-cron', lastAt: NOW },
    ]);
  });
});

describe('GET /api/cron/daily', () => {
  async function seed() {
    const old = NOW - 100 * DAY_MS;
    await exec(
      'insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)',
      ['u1', 'alice', 'alice', 'Alice', old, old],
    );
    await exec('insert into groups(id, name, created_by, created_at, updated_at) values (?,?,?,?,?)', ['g1', 'G', 'u1', old, old]);
    // §8.1 session: หมด (= now นับว่าหมด) / ยังไม่หมด
    const ses = (id: string, exp: number) =>
      exec('insert into session(id, user_id, created_at, expires_at, last_seen_at) values (?,?,?,?,?)', [id, 'u1', old, exp, old]);
    await ses('s-expired', NOW - 1);
    await ses('s-edge', NOW);
    await ses('s-live', NOW + 1);
    // §8.1 rate_limit_bucket: เก่ากว่า 2 วัน / ไม่เก่า
    const bucket = (k: string, ws: number) => exec('insert into rate_limit_bucket values (?,?,1)', [k, ws]);
    await bucket('b-old', NOW - 2 * DAY_MS - 1);
    await bucket('b-new', NOW - 2 * DAY_MS);
    // §8.1 login_throttle: ไม่ล็อก+นิ่ง 30 วัน (ลบ) / ยังล็อก (เก็บ) / ขยับล่าสุด (เก็บ) / ล็อกหมดแล้ว+นิ่ง (ลบ)
    const thr = (k: string, locked: number | null, upd: number) => exec('insert into login_throttle values (?,1,?,?)', [k, locked, upd]);
    await thr('t-idle', null, NOW - 31 * DAY_MS);
    await thr('t-locked', NOW + HOUR_MS, NOW - 31 * DAY_MS);
    await thr('t-recent', null, NOW - DAY_MS);
    await thr('t-lock-ended', NOW - DAY_MS, NOW - 31 * DAY_MS);
    // §8.2 pin_reset_request
    const reset = (id: string, user: string, status: string, pendingExp: number, exp: number | null) =>
      exec(
        'insert into pin_reset_request(id, user_id, status, device_token_hash, requested_at, pending_expires_at, expires_at) values (?,?,?,?,?,?,?)',
        [id, user, status, 'h', old, pendingExp, exp],
      );
    await exec(
      'insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)',
      ['u2', 'bob', 'bob', 'Bob', old, old],
    );
    await reset('r-pending-expired', 'u1', 'pending', NOW - 1, null);
    await reset('r-approved-expired', 'u2', 'approved', NOW - DAY_MS, NOW - 1);
    // §8.2 group_invite
    const inv = (id: string, hash: string, exp: number) =>
      exec(
        'insert into group_invite(id, group_id, kind, code_hash, status, created_by, created_at, expires_at) values (?,?,?,?,?,?,?,?)',
        [id, 'g1', 'code', hash, 'active', 'u1', old, exp],
      );
    await inv('i-expired', 'h1', NOW - 1);
    await inv('i-live', 'h2', NOW + DAY_MS);
    // §8.3 notification / place_search_cache
    const notif = (id: string, created: number) =>
      exec("insert into notification(id, user_id, kind, params, created_at) values (?,?,'x','{}',?)", [id, 'u1', created]);
    await notif('n-old', NOW - 90 * DAY_MS - 1);
    await notif('n-new', NOW - 90 * DAY_MS);
    const busy = (id: string, end: number) =>
      exec(
        "insert into busy_block(id, user_id, all_day, start_at, end_at, local_start_date, local_end_date, tz, hide_detail, created_at, updated_at) values (?,?,0,?,?,'2026-01-01','2026-01-01','Asia/Bangkok',0,?,?)",
        [id, 'u1', end - 1000, end, old, old],
      );
    await busy('bz-old', NOW - 90 * DAY_MS - 1);
    await busy('bz-edge', NOW - 90 * DAY_MS);
    await busy('bz-future', NOW + DAY_MS);
    const cache = (q: string, fetched: number) => exec("insert into place_search_cache values (?, '[]', ?)", [q, fetched]);
    await cache('q-old', NOW - 30 * DAY_MS - 1);
    await cache('q-new', NOW - 30 * DAY_MS);
  }

  async function snapshot() {
    const out: Record<string, unknown[]> = {};
    for (const [table, key] of [
      ['session', 'id'],
      ['rate_limit_bucket', 'key'],
      ['login_throttle', 'key'],
      ['pin_reset_request', 'id'],
      ['group_invite', 'id'],
      ['notification', 'id'],
      ['place_search_cache', 'query_normalized'],
      ['system_heartbeat', 'source'],
    ] as const) {
      out[table] = (await exec(`select * from ${table} order by ${key}`)).rows.map((r) => ({ ...r }));
    }
    return out;
  }

  it('เขียน heartbeat vercel-cron = เวลานาฬิกาจำลอง และเก็บกวาดเฉพาะแถวที่หมดอายุ', async () => {
    await seed();
    const res = await daily(bearer());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    const body = (await res.json()) as { data: { heartbeat: unknown; cleaned: Record<string, number> } };
    expect(body.data.heartbeat).toEqual({ source: 'vercel-cron', lastAt: NOW });
    expect(body.data.cleaned).toEqual({
      expiredSessions: 2,
      staleRateLimitBuckets: 1,
      idleLoginThrottles: 2,
      expiredPendingPinResets: 1,
      expiredApprovedPinResets: 1,
      expiredInvites: 1,
      oldNotifications: 1,
      oldBusyBlocks: 1,
      oldBusyRoutines: 0, // R14
      stalePlaceSearchCache: 1,
      oldLineOutbox: 0,
      staleLineLinkCodes: 0,
    });
    expect(await heartbeats()).toEqual([{ source: 'vercel-cron', lastAt: NOW }]);

    const ids = async (table: string, col: string) =>
      (await exec(`select ${col} as k from ${table} order by ${col}`)).rows.map((r) => String(r.k));
    expect(await ids('session', 'id')).toEqual(['s-live']);
    expect(await ids('rate_limit_bucket', 'key')).toEqual(['b-new']);
    expect(await ids('login_throttle', 'key')).toEqual(['t-locked', 't-recent']);
    expect(await ids('notification', 'id')).toEqual(['n-new']);
    expect(await ids('busy_block', 'id')).toEqual(['bz-edge', 'bz-future']);
    expect(await ids('place_search_cache', 'query_normalized')).toEqual(['q-new']);
    expect(await count('pin_reset_request', "status = 'expired'")).toBe(2);
    expect(await count('group_invite', "status = 'expired'")).toBe(1);
    expect(await count('group_invite', "id = 'i-live' and status = 'active'")).toBe(1);
  });

  it('idempotent: รันซ้ำ 2 ครั้งที่เวลาเดียวกัน → ข้อมูลเท่าเดิม และครั้งที่ 2 ไม่มีอะไรให้เก็บ', async () => {
    await seed();
    const r1 = await daily(bearer());
    expect(r1.status).toBe(200);
    const after1 = await snapshot();

    const r2 = await daily(bearer());
    expect(r2.status).toBe(200);
    const body2 = (await r2.json()) as { data: { heartbeat: unknown; cleaned: Record<string, number> } };
    expect(body2.data.heartbeat).toEqual({ source: 'vercel-cron', lastAt: NOW });
    expect(Object.values(body2.data.cleaned).every((n) => n === 0)).toBe(true);
    expect(await snapshot()).toEqual(after1);
    expect(await count('system_heartbeat')).toBe(1);
  });

  it('heartbeat เขียนก่อนเก็บกวาด — DB ว่างก็ยังเขียน และรันวันถัดไปอัปเดต last_at', async () => {
    expect((await daily(bearer())).status).toBe(200);
    expect(await heartbeats()).toEqual([{ source: 'vercel-cron', lastAt: NOW }]);
    clock.advance(DAY_MS);
    expect((await daily(bearer())).status).toBe(200);
    expect(await heartbeats()).toEqual([{ source: 'vercel-cron', lastAt: NOW + DAY_MS }]);
  });
});
