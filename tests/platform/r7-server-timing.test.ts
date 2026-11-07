// R7-3 (R7_CONTRACT §2 · §6): ตัวนับ query/เวลาต่อ request + header Server-Timing
//  - ผูก request ด้วย AsyncLocalStorage: request ที่ทำพร้อมกันนับแยกกัน · นอก request ไม่นับ
//  - header มีแค่ตัวเลข — ไม่มี SQL / พารามิเตอร์ / id / ชื่อ / ข้อมูลผู้ใช้ (canary)
//  - แนบเฉพาะผู้ใช้ที่ล็อกอินแล้ว + คำตอบ < 400 · ปิดได้ด้วย SERVER_TIMING_ENABLED=false · ค่าเริ่มต้นปิดบน production
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldExposeServerTiming } from '@/app/api/_lib/route';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { ACTIONS, PUBLIC_ACTIONS, isPublicAction } from '@/lib/rbac/actions';
import { currentRequestMetrics, metricsLogLine, runWithRequestMetrics, serverTimingValue } from '@/db/request-metrics';
import { inTx } from '@/lib/data/tx';
import { EnvError, loadEnv, serverTimingEnabled } from '@/lib/shared/env';
import { Client, get, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';
import { sql } from 'drizzle-orm';

const HEADER_RE = /^db;dur=\d+\.\d;desc="\d+ (query|queries)", total;dur=\d+\.\d$/;

describe('serverTimingEnabled / env', () => {
  it.each([
    [{}, true],
    [{ VERCEL_ENV: 'preview' }, true],
    [{ VERCEL_ENV: 'production' }, false],
    [{ VERCEL_ENV: 'production', SERVER_TIMING_ENABLED: 'true' }, true],
    [{ SERVER_TIMING_ENABLED: 'false' }, false],
    [{ SERVER_TIMING_ENABLED: ' false ' }, false],
    [{ SERVER_TIMING_ENABLED: '' }, true],
    [{ SERVER_TIMING_ENABLED: 'yes' }, false], // ค่าแปลก = ปิด (ไม่โยน)
  ] as const)('%j → %s', (source, want) => {
    expect(serverTimingEnabled(source)).toBe(want);
  });

  it('schema กลาง: ค่าผิด → EnvError ระบุชื่อตัวแปร ไม่มีค่าที่ส่งมา · ค่าถูก/ว่างผ่าน', () => {
    const base = { TURSO_DATABASE_URL: 'file:./x.db', APP_SECRET: randomBytes(32).toString('base64'), CRON_SECRET: 'c'.repeat(20) };
    expect(loadEnv({ ...base, SERVER_TIMING_ENABLED: 'false' }).SERVER_TIMING_ENABLED).toBe('false');
    expect(loadEnv({ ...base, SERVER_TIMING_ENABLED: '' }).SERVER_TIMING_ENABLED).toBeUndefined();
    const canary = `LEAK${randomBytes(4).toString('hex')}`;
    try {
      loadEnv({ ...base, SERVER_TIMING_ENABLED: canary });
      expect.fail('ควรล้ม');
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as EnvError).variables).toEqual(['SERVER_TIMING_ENABLED']);
      expect((e as EnvError).message).not.toContain(canary);
    }
  });
});

describe('serverTimingValue / metricsLogLine / shouldExposeServerTiming', () => {
  it('รูปแบบตัวเลขล้วน', () => {
    expect(serverTimingValue({ queries: 7, dbMs: 3.14159, startedAt: 100 }, 112.26)).toBe('db;dur=3.1;desc="7 queries", total;dur=12.3');
    expect(serverTimingValue({ queries: 1, dbMs: 0, startedAt: 0 }, 0)).toBe('db;dur=0.0;desc="1 query", total;dur=0.0');
  });
  it('log: label ที่ไม่ใช่ pattern ปลอดภัย → "_"', () => {
    expect(metricsLogLine('/groups/[gid]', { queries: 2, dbMs: 1, startedAt: 0 }, 5)).toBe('[perf] /groups/[gid] queries=2 db=1.0ms total=5.0ms');
    expect(metricsLogLine('/groups/x y"<script>', { queries: 2, dbMs: 1, startedAt: 0 }, 5)).toMatch(/^\[perf\] _ /);
  });
  it('แนบเฉพาะผู้ใช้ + < 400 (action ที่ไม่ใช่สาธารณะ)', () => {
    const a = 'group.view' as const;
    expect([shouldExposeServerTiming(a, true, 200), shouldExposeServerTiming(a, true, 201), shouldExposeServerTiming(a, true, 404), shouldExposeServerTiming(a, false, 200)]).toEqual([true, true, false, false]);
  });
  it('security-r7 Low 1: ทุก action ใน PUBLIC_ACTIONS → ไม่แนบ แม้ผู้ใช้ล็อกอิน + 2xx · route ไม่มี action (health/cron) → ไม่แนบ', () => {
    expect(PUBLIC_ACTIONS.length).toBeGreaterThanOrEqual(5);
    for (const a of PUBLIC_ACTIONS) for (const status of [200, 201, 202, 204]) expect(shouldExposeServerTiming(a, true, status), a).toBe(false);
    expect(shouldExposeServerTiming(null, true, 200)).toBe(false);
    // action อื่นทุกตัวยังแนบได้ (ไม่ได้ปิดทั้งระบบโดยไม่ตั้งใจ)
    for (const a of ACTIONS.filter((x) => !isPublicAction(x))) expect(shouldExposeServerTiming(a, true, 200), a).toBe(true);
    // ทุก route ใน manifest ที่ผูก action สาธารณะ ถูกครอบด้วยกฎนี้ (ตัดสินจาก entry.action ไม่ใช่ actor.kind)
    const publicRoutes = ROUTE_MANIFEST.filter((e) => e.action !== null && isPublicAction(e.action));
    expect(publicRoutes.map((e) => `${e.method} ${e.path}`).sort()).toEqual(
      expect.arrayContaining(['GET /api/auth/pin-reset/status', 'POST /api/auth/login', 'POST /api/auth/pin-reset', 'POST /api/auth/signup']),
    );
  });
});

describe('ตัวนับต่อ request (DB จริง)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  const q = () => h.db.all(sql`SELECT 1 AS one`);

  it('นอก request ไม่มีตัวนับ (query ยังทำงานปกติ)', async () => {
    expect(currentRequestMetrics()).toBeUndefined();
    expect(await q()).toEqual([{ one: 1 }]);
  });

  it('request พร้อมกันนับแยกกัน (AsyncLocalStorage ไม่ปน)', async () => {
    const [a, b] = await Promise.all([
      runWithRequestMetrics(async (m) => {
        for (let i = 0; i < 3; i++) await q();
        return m.queries;
      }),
      runWithRequestMetrics(async (m) => {
        await Promise.all([q(), q(), q(), q(), q()]);
        return m.queries;
      }),
    ]);
    expect([a, b]).toEqual([3, 5]);
  });

  it('ธุรกรรม: เปิด + คำสั่งข้างใน + commit นับครบ · batch = 1', async () => {
    const n = await runWithRequestMetrics(async (m) => {
      await inTx(h.db, async (tx) => {
        await tx.all(sql`SELECT 1`);
        await tx.all(sql`SELECT 2`);
      });
      return m.queries;
    });
    expect(n).toBe(4); // begin + 2 + commit
    const b = await runWithRequestMetrics(async (m) => {
      await h.db.batch([h.db.all(sql`SELECT 1`), h.db.all(sql`SELECT 2`)] as never);
      return m.queries;
    });
    expect(b).toBe(1);
  });
});

describe('Server-Timing บน API (route wrapper)', () => {
  let h: Harness;
  let alice: Person;
  const saved = process.env.SERVER_TIMING_ENABLED;
  beforeEach(async () => {
    delete process.env.SERVER_TIMING_ENABLED;
    h = await setupHarness();
    alice = await person(h, 'alice_canary');
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env.SERVER_TIMING_ENABLED;
    else process.env.SERVER_TIMING_ENABLED = saved;
    await h.cleanup();
  });

  it('ผู้ใช้ที่ล็อกอิน + 200/201 → มี header · มีแค่ตัวเลข ไม่มี id/ชื่อ/ชื่อกลุ่ม/SQL', async () => {
    const name = `CANARY${randomBytes(4).toString('hex')}`;
    const c = await post<{ group: { id: string } }>(alice.c, '/api/groups', { name });
    expect(c.status).toBe(201);
    const gid = c.data.group.id;
    const r = await get(alice.c, `/api/groups/${gid}`);
    for (const res of [c, r]) {
      const v = res.headers.get('server-timing');
      expect(v).toMatch(HEADER_RE);
      for (const bad of [gid, alice.id, alice.username, name, 'SELECT', 'select', 'groups', '?']) expect(v).not.toContain(bad);
    }
    const n = Number(/desc="(\d+)/.exec(r.headers.get('server-timing')!)![1]);
    expect(n).toBeGreaterThan(0);
  });

  it('ไม่แนบ: anonymous (401 / login) · error (404 คนนอก) · ปิดด้วย SERVER_TIMING_ENABLED=false', async () => {
    const anon = new Client();
    expect((await get(anon, '/api/groups')).headers.get('server-timing')).toBeNull();
    const bob = new Client();
    await h.seedUser('bob', undefined, {});
    const login = await bob.login('bob', '135792');
    expect(login.status).toBe(200);
    expect(login.headers.get('server-timing')).toBeNull(); // auth.login เป็น action สาธารณะ → ไม่แนบเสมอ
    const gid = await makeGroup(alice);
    const nf = await get(bob, `/api/groups/${gid}`);
    expect(nf.status).toBe(404);
    expect(nf.headers.get('server-timing')).toBeNull();
    process.env.SERVER_TIMING_ENABLED = 'false';
    expect((await get(alice.c, '/api/groups')).headers.get('server-timing')).toBeNull();
    process.env.SERVER_TIMING_ENABLED = 'true';
    expect((await get(alice.c, '/api/groups')).headers.get('server-timing')).toMatch(HEADER_RE);
  });

  it('security-r7 Low 1: ผู้ใช้ที่ล็อกอินแล้วเรียก pin-reset / pin-reset status / login / signup / prefs → ไม่มี header (ไม่เป็น oracle ว่ามีบัญชี)', async () => {
    await h.seedUser('victim_active');
    // มีบัญชี active / ไม่มีบัญชี — คำตอบ 202 เหมือนกัน และไม่มี Server-Timing ทั้งคู่
    for (const username of ['victim_active', 'nobody_here']) {
      const r = await post(alice.c, '/api/auth/pin-reset', { username });
      expect(r.status, r.text).toBe(202);
      expect(r.headers.get('server-timing'), username).toBeNull();
    }
    const st = await get(alice.c, '/api/auth/pin-reset/status');
    expect(st.headers.get('server-timing')).toBeNull();
    const login = await post(alice.c, '/api/auth/login', { username: 'victim_active', pin: '135792' });
    expect(login.headers.get('server-timing')).toBeNull();
    const signup = await post(alice.c, '/api/auth/signup', { username: 'newbie_st', displayName: 'newbie', pin: '135792', pinConfirm: '135792' });
    expect(signup.headers.get('server-timing')).toBeNull();
    const prefs = await post(alice.c, '/api/prefs', { theme: 'dark' });
    expect(prefs.headers.get('server-timing')).toBeNull();
    // route ที่ไม่ใช่สาธารณะของผู้ใช้คนเดิมยังมี header
    expect((await get(alice.c, '/api/groups')).headers.get('server-timing')).toMatch(HEADER_RE);
  });
});
