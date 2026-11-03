// R7 B-1: session ของหน้า RSC อ่านครั้งเดียวต่อ request (React.cache) · ไม่ findUserById ซ้ำ · touchSession ≤ 1 ·
// request/ผู้ใช้ต่างกันไม่ปน · หมดอายุ/ถูกเพิกถอน/ระงับ/must_change_pin ให้ผลเหมือน getActor เดิม · API GET /api/auth/session ไม่อ่าน user ซ้ำ
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({
  cookie: '',
  // React.cache ของ RSC = memo ต่อ request → จำลองด้วยที่เก็บที่ล้างเมื่อเริ่ม "request ใหม่" (newRequest)
  cacheStore: new Map<unknown, Map<string, unknown>>(),
  calls: { findSessionWithUser: 0, touchSession: 0, touchWrites: 0, findUserById: 0 },
  failNextFind: false,
}));

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
vi.mock('next/headers', () => ({ cookies: async () => ({ toString: () => page.cookie }) }));
vi.mock('@/lib/data/repos/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/repos/session')>();
  return {
    ...actual,
    findSessionWithUser: (...a: Parameters<typeof actual.findSessionWithUser>) => {
      page.calls.findSessionWithUser++;
      if (page.failNextFind) {
        page.failNextFind = false;
        return Promise.reject(new Error('SQLITE_BUSY'));
      }
      return actual.findSessionWithUser(...a);
    },
    touchSession: async (...a: Parameters<typeof actual.touchSession>) => {
      page.calls.touchSession++;
      const r = await actual.touchSession(...a);
      if (r) page.calls.touchWrites++;
      return r;
    },
  };
});
vi.mock('@/lib/data/repos/user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/repos/user')>();
  return {
    ...actual,
    findUserById: (...a: Parameters<typeof actual.findUserById>) => {
      page.calls.findUserById++;
      return actual.findUserById(...a);
    },
  };
});

import { sql } from 'drizzle-orm';
import { getPageRequest, getRequestActor, getRequestSession } from '@/lib/auth/page-session';
import { getActor, issueSession, takeResolvedSessionUser } from '@/lib/auth/session';
import { Client, DAY, GOOD_PIN, SESSION_COOKIE, setupHarness, type Harness } from './harness';

let h: Harness;
let alice: { id: string; token: string };
let bob: { id: string; token: string };

const newRequest = (cookie: string): void => {
  page.cacheStore.clear();
  page.cookie = cookie;
  page.calls = { findSessionWithUser: 0, touchSession: 0, touchWrites: 0, findUserById: 0 };
};
const cookieOf = (token: string) => `${SESSION_COOKIE}=${token}`;

beforeEach(async () => {
  h = await setupHarness();
  const a = await h.seedUser('alice');
  const b = await h.seedUser('bob');
  alice = { id: a.id, token: (await issueSession(h.db, a.id, null, h.clock.now())).token };
  bob = { id: b.id, token: (await issueSession(h.db, b.id, null, h.clock.now())).token };
});
afterEach(async () => {
  await h.cleanup();
});

/** layout + page + generateMetadata + loader เรียกพร้อมกันและตามกันในหนึ่ง request */
async function renderOnce() {
  const [s1, a1, s2] = await Promise.all([getRequestSession(), getRequestActor(), getRequestSession()]);
  const a2 = await getRequestActor();
  const s3 = await getRequestSession();
  return { s1, s2, s3, a1, a2 };
}

describe('ครั้งเดียวต่อ request', () => {
  it('เรียกซ้ำหลายจุด (ขนาน + ตามกัน) = findSessionWithUser 1 ครั้ง · ไม่ findUserById · req ตัวเดียวกัน', async () => {
    newRequest(cookieOf(alice.token));
    const r = await renderOnce();
    expect(page.calls.findSessionWithUser).toBe(1);
    expect(page.calls.findUserById).toBe(0);
    expect(r.s1).toBe(r.s2);
    expect(r.s1).toBe(r.s3);
    expect(r.s1.req).toBe(await getPageRequest());
    expect(r.a1).toEqual({ kind: 'user', id: alice.id, isSuperAdmin: false, status: 'active', mustChangePin: false });
    expect(r.a2).toBe(r.s1.actor);
    expect(r.s1.user).toMatchObject({ id: alice.id, username: 'alice', displayName: 'alice', status: 'active', mustChangePin: false, isAdmin: false });
  });

  it('ข้อมูลผู้ใช้ที่คืนไม่มี hash/PIN/token', async () => {
    newRequest(cookieOf(alice.token));
    const { user } = await getRequestSession();
    expect(Object.keys(user!).sort()).toEqual(['displayName', 'id', 'isAdmin', 'locale', 'mustChangePin', 'status', 'theme', 'username']);
    expect(JSON.stringify(user)).not.toContain(alice.token);
  });

  it('touchSession ≤ 1 ต่อ request แม้ถึงรอบต่ออายุ (เขียนจริง 1 ครั้ง)', async () => {
    h.clock.advance(31 * DAY); // เหลือ < 30 วัน → ต่ออายุ + last_seen
    newRequest(cookieOf(alice.token));
    await renderOnce();
    expect(page.calls.touchSession).toBe(1);
    expect(page.calls.touchWrites).toBe(1);
    // request ถัดไปเวลาเดิม: ไม่ต้องเขียนอีก
    newRequest(cookieOf(alice.token));
    await renderOnce();
    expect(page.calls.touchSession).toBe(1);
    expect(page.calls.touchWrites).toBe(0);
  });

  it('ไม่มี cookie / cookie รูปผิด → anonymous โดยไม่แตะ DB', async () => {
    for (const c of ['', `${SESSION_COOKIE}=not-a-token!`]) {
      newRequest(c);
      const r = await renderOnce();
      expect(r.s1).toMatchObject({ actor: { kind: 'anonymous' }, user: null });
      expect(page.calls.findSessionWithUser).toBe(0);
    }
  });
});

describe('ไม่ปนข้าม request / ผู้ใช้', () => {
  it('request ต่างกัน = อ่านใหม่ · ผู้ใช้ต่างกันได้ผลของตัวเอง', async () => {
    newRequest(cookieOf(alice.token));
    const a = await getRequestSession();
    newRequest(cookieOf(bob.token));
    const b = await getRequestSession();
    expect(page.calls.findSessionWithUser).toBe(1);
    expect(a.user!.id).toBe(alice.id);
    expect(b.user!.id).toBe(bob.id);
    expect(b.actor).toMatchObject({ kind: 'user', id: bob.id });
    expect(b.req).not.toBe(a.req);
    newRequest(cookieOf(alice.token));
    expect((await getRequestSession()).user!.id).toBe(alice.id);
    expect(page.calls.findSessionWithUser).toBe(1);
  });

  it('request ถัดไปที่ไม่มี cookie → anonymous (ไม่ได้ผลของ request ก่อน)', async () => {
    newRequest(cookieOf(alice.token));
    await getRequestSession();
    newRequest('');
    expect(await getRequestActor()).toEqual({ kind: 'anonymous' });
  });
});

describe('พฤติกรรมความปลอดภัยเดิม', () => {
  it('session ถูกเพิกถอน (logout-all) ระหว่างใช้งาน → request ถัดไป anonymous', async () => {
    newRequest(cookieOf(alice.token));
    expect((await getRequestActor()).kind).toBe('user');
    await h.db.run(sql`DELETE FROM session WHERE user_id = ${alice.id}`);
    newRequest(cookieOf(alice.token));
    expect(await getRequestSession()).toMatchObject({ actor: { kind: 'anonymous' }, user: null });
  });

  it('session หมดอายุ → request ถัดไป anonymous', async () => {
    newRequest(cookieOf(alice.token));
    expect((await getRequestActor()).kind).toBe('user');
    h.clock.advance(61 * DAY);
    newRequest(cookieOf(alice.token));
    expect(await getRequestActor()).toEqual({ kind: 'anonymous' });
  });

  it('ระงับบัญชี → actor status suspended ใน request ถัดไป (เหมือน getActor) · บัญชีถูกลบ → anonymous', async () => {
    await h.db.run(sql`UPDATE user SET status = 'suspended' WHERE id = ${alice.id}`);
    newRequest(cookieOf(alice.token));
    const s = await getRequestSession();
    expect(s.actor).toMatchObject({ kind: 'user', status: 'suspended' });
    expect(s.user!.status).toBe('suspended');
    expect(s.actor).toEqual(await getActor(new Request('http://x/', { headers: { cookie: cookieOf(alice.token) } })));
    await h.db.run(sql`UPDATE user SET status = 'deleted' WHERE id = ${alice.id}`);
    newRequest(cookieOf(alice.token));
    expect((await getRequestSession()).actor).toEqual({ kind: 'anonymous' });
  });

  it('must_change_pin / is_admin ตั้งด้วย SQL → มีผลใน request ถัดไปทันที', async () => {
    newRequest(cookieOf(alice.token));
    expect(await getRequestActor()).toMatchObject({ mustChangePin: false, isSuperAdmin: false });
    await h.db.run(sql`UPDATE user SET must_change_pin = 1, is_admin = 1 WHERE id = ${alice.id}`);
    newRequest(cookieOf(alice.token));
    expect(await getRequestActor()).toMatchObject({ mustChangePin: true, isSuperAdmin: true });
    expect((await getRequestSession()).user).toMatchObject({ mustChangePin: true, isAdmin: true });
  });

  it('ฐานล่มระหว่างอ่าน → reject (ไม่กลายเป็น anonymous) · request ถัดไปอ่านใหม่ได้', async () => {
    newRequest(cookieOf(alice.token));
    page.failNextFind = true;
    await expect(getRequestSession()).rejects.toThrow('SQLITE_BUSY');
    await expect(getRequestActor()).rejects.toThrow('SQLITE_BUSY'); // memo ใน request เดียวกัน
    expect(page.calls.findSessionWithUser).toBe(1);
    newRequest(cookieOf(alice.token));
    expect((await getRequestActor()).kind).toBe('user');
  });
});

describe('API (route wrapper)', () => {
  it('GET /api/auth/session: session อ่าน 1 ครั้ง · ไม่ findUserById ซ้ำ · ข้อมูลเดิม', async () => {
    const c = new Client();
    expect((await c.login('alice', GOOD_PIN)).status).toBe(200);
    newRequest('');
    const r = await c.getJson('/api/auth/session');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ user: { id: alice.id, username: 'alice', displayName: 'alice', isAdmin: false, mustChangePin: false } });
    expect(page.calls.findSessionWithUser).toBe(1);
    expect(page.calls.findUserById).toBe(0);
  });

  it('ไม่ได้ล็อกอิน → 401 เหมือนเดิม', async () => {
    const r = await new Client().getJson('/api/auth/session');
    expect(r.status).toBe(401);
  });

  it('takeResolvedSessionUser ผูกกับ Request ตัวเดียว (Request อื่น = null)', async () => {
    const req1 = new Request('http://x/', { headers: { cookie: cookieOf(alice.token) } });
    const req2 = new Request('http://x/', { headers: { cookie: cookieOf(alice.token) } });
    await getActor(req1);
    expect(takeResolvedSessionUser(req1)?.id).toBe(alice.id);
    expect(takeResolvedSessionUser(req2)).toBeNull();
  });
});
