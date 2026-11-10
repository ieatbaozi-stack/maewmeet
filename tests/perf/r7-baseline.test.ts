// R7 เฟส A (R7_CONTRACT §2 · R7-2/R7-4): baseline จำนวน query + เวลา ต่อเส้นทาง — เครื่องมือเดียวกันใช้วัดหลังเฟส B
//
// ฐาน: libSQL ไฟล์ชั่วคราว + migration จริง (tests/groups/harness) · seed กลุ่ม 10 คน + กลุ่มที่สอง 4 คน · busy ~8 รายการ/คน + ชุดรายวัน 2 ชุด
//       · นัด 5 + 1 พร้อม RSVP · แจ้งเตือนจากการสร้างนัด (เส้นทางจริงทั้งหมดผ่าน API)
// วัด:
//  - API: route handler จริง → อ่าน header Server-Timing (ตัวนับใน src/db/request-metrics.ts — นับ execute/batch/เปิดธุรกรรม/commit)
//  - หน้า RSC (src/app/(app)/**): ตั้ง header จาก RSC ไม่ได้ → จำลองการโหลดหนึ่งครั้งด้วยการเรียกฟังก์ชันเดียวกับที่ layout + page + generateMetadata เรียก
//    พร้อมกัน (Next เรนเดอร์ layout/page ขนานกัน) ใน runWithRequestMetrics · React.cache จำลองแบบ "ต่อ request" (ล้างทุกการโหลด)
//  - ลำดับขั้น: ชื่อฟังก์ชันใน src/lib|src/app ที่เรียก DB (จาก stack ในเทสต์เท่านั้น — ไม่เก็บ SQL/พารามิเตอร์)
//  - เวลา: มัธยฐานของ RUNS รอบ (หลัง warm-up 1 รอบ) · จำนวน query ต้องเท่ากันทุกรอบ
// ผลลัพธ์: console (ตาราง) · ถ้าตั้ง R7_BASELINE_OUT=<ไฟล์> → เขียน JSON ไว้ทำรายงาน docs/reports/perf-r7-baseline.md
// เพดาน (CEILINGS) = ค่าปัจจุบัน — เฟส B ลดแล้วปรับเพดานลง (กันถอยหลัง)
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({ cookie: '', cacheStore: new Map<unknown, Map<string, unknown>>() }));

// ชื่อขั้น: ห่อทุก export ที่เป็นฟังก์ชันของ repo/service ด้วย AsyncLocalStorage ของเทสต์ → ตอน DB ถูกเรียก อ่านชื่อขั้นในสุดที่กำลังทำงาน
// (เฉพาะในเทสต์นี้ — โค้ดแอปไม่รู้จักชื่อขั้น · ไม่เก็บ SQL/พารามิเตอร์)
const steps = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const als = new AsyncLocalStorage<string>();
  const isClass = (f: unknown) => typeof f === 'function' && /^class/.test(Function.prototype.toString.call(f));
  function wrapAll<M extends Record<string, unknown>>(prefix: string, mod: M): M {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(mod)) {
      out[k] = typeof v === 'function' && !isClass(v) ? (...a: unknown[]) => als.run(`${prefix}.${k}`, () => (v as (...x: unknown[]) => unknown)(...a)) : v;
    }
    return out as M;
  }
  return { als, wrapAll };
});
vi.mock('@/lib/data/repos/account', async (o) => steps.wrapAll('repo.account', await o()));
vi.mock('@/lib/data/repos/admin-audit', async (o) => steps.wrapAll('repo.admin-audit', await o()));
vi.mock('@/lib/data/repos/admin-groups', async (o) => steps.wrapAll('repo.admin-groups', await o()));
vi.mock('@/lib/data/repos/admin-users', async (o) => steps.wrapAll('repo.admin-users', await o()));
vi.mock('@/lib/data/repos/appointment', async (o) => steps.wrapAll('repo.appointment', await o()));
vi.mock('@/lib/data/repos/audit-log', async (o) => steps.wrapAll('repo.audit-log', await o()));
vi.mock('@/lib/data/repos/busy', async (o) => steps.wrapAll('repo.busy', await o()));
vi.mock('@/lib/data/repos/group-invite', async (o) => steps.wrapAll('repo.group-invite', await o()));
vi.mock('@/lib/data/repos/group-member', async (o) => steps.wrapAll('repo.group-member', await o()));
vi.mock('@/lib/data/repos/group', async (o) => steps.wrapAll('repo.group', await o()));
vi.mock('@/lib/data/repos/login-throttle', async (o) => steps.wrapAll('repo.login-throttle', await o()));
vi.mock('@/lib/data/repos/maintenance', async (o) => steps.wrapAll('repo.maintenance', await o()));
vi.mock('@/lib/data/repos/notification', async (o) => steps.wrapAll('repo.notification', await o()));
vi.mock('@/lib/data/repos/pepper-fingerprint', async (o) => steps.wrapAll('repo.pepper-fingerprint', await o()));
vi.mock('@/lib/data/repos/pin-reset-request', async (o) => steps.wrapAll('repo.pin-reset-request', await o()));
vi.mock('@/lib/data/repos/rate-limit-bucket', async (o) => steps.wrapAll('repo.rate-limit-bucket', await o()));
vi.mock('@/lib/data/repos/session', async (o) => steps.wrapAll('repo.session', await o()));
vi.mock('@/lib/data/repos/system-heartbeat', async (o) => steps.wrapAll('repo.system-heartbeat', await o()));
vi.mock('@/lib/data/repos/user', async (o) => steps.wrapAll('repo.user', await o()));
vi.mock('@/lib/data/services/appointments', async (o) => steps.wrapAll('svc.appointments', await o()));
vi.mock('@/lib/data/services/availability', async (o) => steps.wrapAll('svc.availability', await o()));
vi.mock('@/lib/data/services/busy', async (o) => steps.wrapAll('svc.busy', await o()));
vi.mock('@/lib/data/services/calendar', async (o) => steps.wrapAll('svc.calendar', await o()));
vi.mock('@/lib/data/services/current-group', async (o) => steps.wrapAll('svc.current-group', await o()));
vi.mock('@/lib/data/services/groups', async (o) => steps.wrapAll('svc.groups', await o()));
vi.mock('@/lib/data/services/invites', async (o) => steps.wrapAll('svc.invites', await o()));
vi.mock('@/lib/data/services/member-busy', async (o) => steps.wrapAll('svc.member-busy', await o()));
vi.mock('@/lib/data/services/notifications', async (o) => steps.wrapAll('svc.notifications', await o()));
vi.mock('@/lib/data/services/group-common', async (o) => steps.wrapAll('svc.group-common', await o()));
vi.mock('@/lib/data/services/prefs', async (o) => steps.wrapAll('svc.prefs', await o()));
vi.mock('@/lib/data/services/account', async (o) => steps.wrapAll('svc.account', await o()));
vi.mock('@/lib/data/notifications/notify', async (o) => steps.wrapAll('notify', await o()));
vi.mock('@/lib/auth/session', async (o) => steps.wrapAll('auth.session', await o()));
vi.mock('@/lib/auth/throttle', async (o) => steps.wrapAll('auth.throttle', await o()));

vi.mock('next/headers', () => {
  const jar = () => {
    const pairs = page.cookie ? page.cookie.split('; ').map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)] as const) : [];
    return {
      toString: () => page.cookie,
      get: (name: string) => {
        const hit = pairs.find(([k]) => k === name);
        return hit ? { name, value: hit[1] } : undefined;
      },
    };
  };
  return { cookies: async () => jar(), headers: async () => new Headers(page.cookie ? { cookie: page.cookie } : {}) };
});
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
// React.cache ของ RSC = memo ต่อ request · นอก RSC (Vitest) cache ไม่ memo → จำลองให้ตรงพฤติกรรมจริง
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const cache = <A extends unknown[], R>(fn: (...args: A) => R) =>
    ((...args: A): R => {
      let m = page.cacheStore.get(fn);
      if (!m) page.cacheStore.set(fn, (m = new Map()));
      const k = JSON.stringify(args);
      if (!m.has(k)) m.set(k, fn(...args));
      return m.get(k) as R;
    }) as (...args: A) => R;
  return { ...actual, cache, default: { ...actual, cache } };
});

import { getDb } from '@/db/client';
import { dataCtx } from '@/lib/data/context';
import { openGroupAvailability } from '@/lib/data/services/availability';
import { openGroupCalendar } from '@/lib/data/services/calendar';
import { runWithRequestMetrics, type RequestMetrics } from '@/db/request-metrics';
import { addDays, monthGrid } from '@/lib/calendar';
import { fetchRange } from '@/components/calendar/model';
import { getPageUser, requireUser } from '@/app/_lib/session';
import { loadUnreadCount } from '@/app/(app)/_lib/unread';
import { loadHome } from '@/app/(app)/_lib/home';
import { loadCalendarPage } from '@/app/(app)/calendar/_lib/load';
import { loadGroup, loadGroupsTab } from '@/app/(app)/groups/_lib/load';
import { loadAppointment, loadGroupAppointments } from '@/app/(app)/appointments/_lib/load';
import { del, get, join, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';
import { put } from '../appointments/util';

const RUNS = 7;
const START = Date.UTC(2026, 9, 18, 3); // 2026-10-18 10:00 BKK (เท่า harness)

// ───────── ลำดับขั้น + ความลึก (เทสต์เท่านั้น) ─────────
// steps: ชื่อขั้นในสุดที่เรียก DB ("∥" นำหน้า = เริ่มขณะที่ query อื่นยังค้าง = ขนานกับตัวก่อนหน้า)
// waves: จำนวนครั้งที่ query เริ่มตอนไม่มี query อื่นค้าง ≈ จำนวน round trip ที่ต้อง "รอต่อกัน" (critical path บน Turso)
type Trace = { steps: string[]; inflight: number; waves: number };
let trace: Trace | null = null;
const stepLabel = (fallback: string): string => steps.als.getStore() ?? fallback;
function track<T>(label: string, run: () => T): T {
  const t = trace;
  if (!t) return run();
  t.steps.push(t.inflight > 0 ? `∥${label}` : label);
  if (t.inflight === 0) t.waves += 1;
  t.inflight += 1;
  const dec = () => {
    t.inflight -= 1;
  };
  const r = run();
  if (r instanceof Promise) r.then(dec, dec);
  else dec();
  return r;
}
function installTracer(): void {
  const client = getDb().$client;
  const wrap = <O extends object>(o: O, key: keyof O, label?: string) => {
    const orig = (o[key] as unknown as (...a: unknown[]) => unknown).bind(o);
    (o as Record<keyof O, unknown>)[key] = (...a: unknown[]) => track(label ?? stepLabel(String(key)), () => orig(...a));
  };
  wrap(client, 'execute');
  wrap(client, 'batch');
  const tx = client.transaction.bind(client);
  client.transaction = ((...a: Parameters<typeof client.transaction>) =>
    track(`BEGIN(${stepLabel('tx')})`, () => tx(...a)).then((t) => {
      wrap(t, 'execute');
      wrap(t, 'batch');
      wrap(t, 'commit', 'COMMIT');
      wrap(t, 'rollback', 'ROLLBACK');
      return t;
    })) as typeof client.transaction;
}

// ───────── ผลวัด ─────────
type Sample = { queries: number; dbMs: number; totalMs: number; steps: string[]; waves: number };
type Row = {
  route: string;
  kind: 'api' | 'page';
  queries: number;
  queriesMinMax: [number, number];
  waves: number;
  dbMsMedian: number;
  totalMsMedian: number;
  steps: string[];
};
const rows: Row[] = [];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

function parseTiming(v: string | null): { queries: number; dbMs: number; totalMs: number } {
  const m = v && /^db;dur=([\d.]+);desc="(\d+) quer(?:y|ies)", total;dur=([\d.]+)$/.exec(v);
  if (!m) throw new Error(`no Server-Timing (${v})`);
  return { dbMs: Number(m[1]), queries: Number(m[2]), totalMs: Number(m[3]) };
}

async function sampleApi(fn: () => Promise<{ status: number; text: string; headers: Headers }>): Promise<Sample> {
  const t: Trace = (trace = { steps: [], inflight: 0, waves: 0 });
  const r = await fn();
  trace = null;
  expect(r.status, r.text.slice(0, 300)).toBeLessThan(300);
  const timing = parseTiming(r.headers.get('server-timing'));
  expect(t.steps.length, 'ตัวนับใน header = จำนวนที่ tracer เห็น').toBe(timing.queries);
  return { ...timing, steps: t.steps, waves: t.waves };
}

async function samplePage(p: Person, fn: () => Promise<unknown>): Promise<Sample> {
  page.cookie = p.c.cookieHeader();
  page.cacheStore = new Map();
  const t: Trace = (trace = { steps: [], inflight: 0, waves: 0 });
  const m = await runWithRequestMetrics(async (mm: RequestMetrics) => {
    await fn();
    return { ...mm, end: performance.now() };
  });
  trace = null;
  expect(t.steps.length).toBe(m.queries);
  return { queries: m.queries, dbMs: m.dbMs, totalMs: m.end - m.startedAt, steps: t.steps, waves: t.waves };
}

/** วัด RUNS รอบ (+ warm-up) · after = เตรียม/คืนสภาพต่อรอบสำหรับเส้นทางที่เขียน (ไม่นับในผล) */
async function measure(route: string, kind: Row['kind'], run: () => Promise<Sample>, hooks: { after?: () => Promise<void> } = {}): Promise<Row> {
  await run();
  await hooks.after?.();
  const samples: Sample[] = [];
  for (let i = 0; i < RUNS; i++) {
    samples.push(await run());
    await hooks.after?.();
  }
  const qs = samples.map((s) => s.queries);
  const row: Row = {
    route,
    kind,
    queries: median(qs),
    queriesMinMax: [Math.min(...qs), Math.max(...qs)],
    waves: median(samples.map((s) => s.waves)),
    dbMsMedian: r1(median(samples.map((s) => s.dbMs))),
    totalMsMedian: r1(median(samples.map((s) => s.totalMs))),
    steps: samples[samples.length - 1]!.steps,
  };
  rows.push(row);
  return row;
}

// ───────── เพดานจำนวน query = ค่าหลังเฟส B ครบ (B-1…B-5) · เฟส A อยู่ใน docs/reports/perf-r7-baseline.md · ห้ามขึ้น ─────────
const CEILINGS: Record<string, number> = {
  'PAGE /': 9,
  'PAGE /calendar?v=month': 8,
  'PAGE /calendar?v=free': 8,
  'PAGE /calendar?v=day': 8,
  'PAGE /calendar?v=mine': 11,
  'PAGE /groups': 5,
  'PAGE /groups/[gid]': 11, // R8-4: hasUpcomingBusy มากับ query สมาชิกเดิม (EXISTS) → +0 (วัดจริง 11 ก่อน/หลัง)
  'PAGE /appointments/[id]': 7,
  'PAGE /me': 3,
  'GET /api/groups/:gid/calendar (เดือน)': 5,
  'GET /api/groups/:gid/availability (เดือน)': 5,
  'GET /api/me/busy': 2,
  'GET /api/me/appointments?rsvp=going': 6,
  'GET /api/me/appointments?limit=5 (home refresh)': 6,
  'GET /api/me/notifications?limit=1 (bell)': 3,
  'GET /api/groups': 2,
  'GET /api/groups/:gid': 3, // R8-4: +0 (listMembers → listMembersWithUpcomingBusy · 3 ก่อน/หลัง)
  'GET /api/groups/:gid/appointments': 7,
  'GET /api/me/invites': 2,
  'GET /api/appointments/:id': 5,
  'PUT /api/me/current-group': 3,
  'POST /api/groups/:gid/appointments/check': 5,
  'PUT /api/appointments/:id/rsvp': 10, // R11: +1 อ่านคำตอบเดิมก่อนเขียน — แจ้งผู้สร้างเฉพาะเมื่อคำตอบเปลี่ยนจริง
  'POST /api/me/busy (timed)': 5,
  'DELETE /api/me/busy/:id': 5,
  // R7 B-2: service ที่ loader ของ /calendar ใช้ (วัดแยก ไม่รวม session/layout · actor สร้างตรง)
  'SVC openGroupCalendar → load (เดือน · B-2)': 4,
  'SVC openGroupAvailability → load (เดือน · B-2)': 4,
};

// ───────── seed ─────────
let h: Harness;
let A: Person;
let ppl: Person[];
let G: string;
let H: string;
let appts: string[];
const day = (offset: number) => addDays('2026-10-19', offset); // lib กลาง (กฎ 9)

beforeAll(async () => {
  delete process.env.SERVER_TIMING_ENABLED; // ค่าเริ่มต้น dev/test = เปิด
  h = await setupHarness({ startAt: START });
  ppl = [];
  for (let i = 0; i < 10; i++) ppl.push(await person(h, `perf${i}`));
  A = ppl[0]!;
  G = await makeGroup(A, 'กลุ่ม 10 คน');
  for (const p of ppl.slice(1)) await join(A, p, G);
  H = await makeGroup(A, 'กลุ่มที่สอง');
  for (const p of ppl.slice(1, 4)) await join(A, p, H);

  for (const [i, p] of ppl.entries()) {
    for (let k = 0; k < 7; k++) {
      const d = day((i * 3 + k * 5) % 38);
      const sh = 8 + ((i + k) % 10);
      const r = await post(p.c, '/api/me/busy', { kind: 'timed', startDate: d, startTime: `${String(sh).padStart(2, '0')}:00`, endDate: d, endTime: `${String(sh + 2).padStart(2, '0')}:00`, title: `งาน ${k}` });
      expect(r.status, r.text).toBe(201);
    }
    const ad = await post(p.c, '/api/me/busy', { kind: 'all_day', startDate: day((i * 4) % 38), endDate: day((i * 4) % 38) });
    expect(ad.status, ad.text).toBe(201);
  }
  for (const p of ppl.slice(0, 2)) {
    const r = await post(p.c, '/api/me/busy', { kind: 'daily', startDate: day(1), endDate: day(30), startTime: '18:00', endTime: '19:00', title: 'ยิม' });
    expect(r.status, r.text).toBe(201);
  }
  appts = [];
  for (let k = 0; k < 5; k++) {
    const d = day(3 + k * 4);
    const r = await post<{ appointment: { id: string } }>(A.c, `/api/groups/${G}/appointments`, { title: `นัด ${k}`, startDate: d, startTime: '19:00', endDate: d, endTime: '21:00' });
    expect(r.status, r.text).toBe(201);
    appts.push(r.data.appointment.id);
  }
  const hx = await post<{ appointment: { id: string } }>(A.c, `/api/groups/${H}/appointments`, { title: 'นัดกลุ่มสอง', startDate: day(6), startTime: '12:00', endDate: day(6), endTime: '13:00' });
  expect(hx.status, hx.text).toBe(201);
  for (const [k, id] of appts.slice(0, 3).entries()) {
    for (const [i, p] of ppl.entries()) {
      if ((i + k) % 3 === 2) continue;
      expect((await put(p.c, `/api/appointments/${id}/rsvp`, { response: (i + k) % 3 === 0 ? 'going' : 'maybe' })).status).toBe(200);
    }
  }
  // คุกกี้กลุ่มปัจจุบันของ A = G (ทางปกติหลังเปิดหน้ากลุ่ม)
  expect((await put(A.c, '/api/me/current-group', { gid: G })).status).toBe(200);
  installTracer();
}, 300_000);

afterAll(async () => {
  const out = process.env.R7_BASELINE_OUT;
  if (out) writeFileSync(out, JSON.stringify({ runs: RUNS, rows }, null, 2));
  await h?.cleanup();
});

// ───────── เส้นทาง ─────────
const OCT = fetchRange(monthGrid(2026, 10).from, monthGrid(2026, 10).to);
const layout = async () => {
  await requireUser();
  await loadUnreadCount();
};

describe('R7 baseline — จำนวน query + เวลา ต่อเส้นทาง', () => {
  it('วัดครบทุกเส้นทางของ §2 แล้วจำนวน query ไม่เกินเพดาน', async () => {
    // ── หน้า RSC (layout + page + generateMetadata ขนานกัน) ──
    await measure('PAGE /', 'page', () => samplePage(A, () => Promise.all([layout(), (async () => (await requireUser(), await loadHome()))()])));
    for (const v of ['month', 'free', 'day', 'mine'] as const) {
      await measure(`PAGE /calendar?v=${v}`, 'page', () =>
        samplePage(A, () => Promise.all([layout(), (async () => (await requireUser(), await loadCalendarPage({ g: G, v, d: v === 'day' ? '2026-10-24' : undefined })))()])),
      );
    }
    await measure('PAGE /groups', 'page', () => samplePage(A, () => Promise.all([layout(), (async () => (await requireUser(), await loadGroupsTab()))()])));
    await measure('PAGE /groups/[gid]', 'page', () =>
      samplePage(A, () =>
        Promise.all([
          layout(),
          (async () => {
            await getPageUser();
            await loadGroup(G);
          })(), // generateMetadata
          (async () => {
            await requireUser();
            const g = await loadGroup(G);
            if (g.memberCount > 1) await loadGroupAppointments(G);
          })(),
        ]),
      ),
    );
    await measure('PAGE /appointments/[id]', 'page', () =>
      samplePage(A, () =>
        Promise.all([
          layout(),
          (async () => {
            await getPageUser();
            await loadAppointment(appts[0]!);
          })(), // generateMetadata
          (async () => {
            await requireUser();
            await loadAppointment(appts[0]!);
          })(),
        ]),
      ),
    );
    await measure('PAGE /me', 'page', () => samplePage(A, () => Promise.all([layout(), requireUser()])));

    // ── API ที่หน้าเหล่านี้เรียก (หลัง hydrate / เมื่อเปลี่ยนเดือน-มุมมอง) ──
    const q = (p: string) => () => sampleApi(() => get(A.c, p));
    await measure('GET /api/groups/:gid/calendar (เดือน)', 'api', q(`/api/groups/${G}/calendar?from=${OCT.from}&to=${OCT.to}`));
    await measure('GET /api/groups/:gid/availability (เดือน)', 'api', q(`/api/groups/${G}/availability?from=${OCT.from}&to=${OCT.to}`));
    await measure('GET /api/me/busy', 'api', q('/api/me/busy'));
    await measure('GET /api/me/appointments?rsvp=going', 'api', q('/api/me/appointments?rsvp=going'));
    await measure('GET /api/me/appointments?limit=5 (home refresh)', 'api', q('/api/me/appointments?limit=5'));
    await measure('GET /api/me/notifications?limit=1 (bell)', 'api', q('/api/me/notifications?limit=1'));
    await measure('GET /api/groups', 'api', q('/api/groups'));
    await measure('GET /api/groups/:gid', 'api', q(`/api/groups/${G}`));
    await measure('GET /api/groups/:gid/appointments', 'api', q(`/api/groups/${G}/appointments?scope=upcoming`));
    await measure('GET /api/me/invites', 'api', q('/api/me/invites'));
    await measure('GET /api/appointments/:id', 'api', q(`/api/appointments/${appts[0]}`));
    await measure('PUT /api/me/current-group', 'api', () => sampleApi(() => put(A.c, '/api/me/current-group', { gid: G })));
    await measure('POST /api/groups/:gid/appointments/check', 'api', () =>
      sampleApi(() => post(A.c, `/api/groups/${G}/appointments/check`, { startDate: day(5), startTime: '19:00', endDate: day(5), endTime: '21:00' })),
    );

    // ── R7 B-2: service ที่ loader ของ /calendar จะใช้ (ด่านกลุ่มครั้งเดียว → tz/role → load) ──
    const actorA = { kind: 'user', id: A.id, isSuperAdmin: false, status: 'active', mustChangePin: false } as const;
    const svcCtx = () => dataCtx(new Request('https://maewmeet.test/calendar'), h.clock.now());
    await measure('SVC openGroupCalendar → load (เดือน · B-2)', 'page', () => samplePage(A, async () => (await openGroupCalendar(actorA, G, svcCtx())).load(OCT)));
    await measure('SVC openGroupAvailability → load (เดือน · B-2)', 'page', () => samplePage(A, async () => (await openGroupAvailability(actorA, G, svcCtx())).load(OCT)));

    // ── เขียน: RSVP สลับ going/maybe · เพิ่ม busy แล้วลบคืน (ลบนับแยก) ──
    let flip = false;
    await measure('PUT /api/appointments/:id/rsvp', 'api', () => sampleApi(() => put(A.c, `/api/appointments/${appts[1]}/rsvp`, { response: (flip = !flip) ? 'going' : 'maybe' })));
    const created: string[] = [];
    const cleanup = async () => {
      for (const id of created.splice(0)) expect((await del(A.c, `/api/me/busy/${id}`)).status).toBe(200);
    };
    await measure(
      'POST /api/me/busy (timed)',
      'api',
      async () => {
        let id = '';
        const s = await sampleApi(async () => {
          const r = await post<{ busy: { id: string } }>(A.c, '/api/me/busy', { kind: 'timed', startDate: day(9), startTime: '06:00', endDate: day(9), endTime: '07:00' });
          id = r.data?.busy?.id ?? '';
          return r;
        });
        created.push(id);
        return s;
      },
      { after: cleanup },
    );
    const toDelete: string[] = [];
    const prepareDelete = async () => {
      const r = await post<{ busy: { id: string } }>(A.c, '/api/me/busy', { kind: 'timed', startDate: day(10), startTime: '06:00', endDate: day(10), endTime: '07:00' });
      expect(r.status, r.text).toBe(201);
      toDelete.push(r.data.busy.id);
    };
    await prepareDelete();
    await measure('DELETE /api/me/busy/:id', 'api', () => sampleApi(() => del(A.c, `/api/me/busy/${toDelete.shift()}`)), { after: prepareDelete });

    // ── รายงาน ──
    const table = rows.map((r) => `${r.route.padEnd(52)} q=${String(r.queries).padStart(3)} waves=${String(r.waves).padStart(2)} db=${r.dbMsMedian}ms total=${r.totalMsMedian}ms`);
    console.log(`\nR7 baseline (median of ${RUNS})\n${table.join('\n')}\n`);
    for (const r of rows) console.log(`${r.route}\n  ${r.steps.join(' → ')}`);

    expect(rows.map((r) => r.route).sort()).toEqual(Object.keys(CEILINGS).sort()); // ทุกเส้นทางมีเพดาน · ไม่มีเพดานค้างที่ไม่ได้วัด
    for (const r of rows) {
      expect(r.queriesMinMax[0], `${r.route}: จำนวน query ต้องคงที่ทุกรอบ`).toBe(r.queriesMinMax[1]);
      expect(r.queries, `${r.route} เกินเพดาน`).toBeLessThanOrEqual(CEILINGS[r.route]!);
    }
  }, 600_000);
});
