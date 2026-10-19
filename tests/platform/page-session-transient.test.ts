// D3: DB ล้มชั่วคราวระหว่างหา session ของหน้าเว็บ ≠ "ไม่ได้ล็อกอิน" → โยน error ให้ error.tsx (ไม่ redirect /login)
// ส่วน "ไม่มี session จริง" ยัง redirect /login เหมือนเดิม
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibsqlError } from '@libsql/client';

const state = vi.hoisted(() => ({ cookie: '', failing: false }));

vi.mock('next/headers', () => ({ cookies: async () => ({ toString: () => state.cookie }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { redirectTo: to });
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
// DB ฉีดพัง: ทุกการ query โยน SQLITE_BUSY แบบที่ libsql โยนจริง
vi.mock('@/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/client')>();
  return {
    ...actual,
    getDb: () => {
      if (!state.failing) return actual.getDb();
      const busy = () => {
        throw new LibsqlError('database is locked', 'SQLITE_BUSY', 'SQLITE_BUSY', 5);
      };
      return new Proxy({}, { get: busy }) as ReturnType<typeof actual.getDb>;
    },
  };
});

import { requireUser, redirectIfSignedIn, requireMustChangePin, SessionUnavailableError } from '@/app/_lib/session';
import { sha256Hex } from '@/lib/auth/tokens';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const NOW = Date.now();
const TOKEN = 'a'.repeat(43);
let t: InstalledTestDb;

beforeAll(async () => {
  t = await installTestDb();
  await t.db.$client.execute({
    sql: 'insert into user(id, username, username_normalized, display_name, created_at, updated_at) values (?,?,?,?,?,?)',
    args: ['u1', 'alice', 'alice', 'Alice', NOW, NOW],
  });
  await t.db.$client.execute({
    sql: 'insert into session(id, user_id, created_at, expires_at, last_seen_at) values (?,?,?,?,?)',
    args: [sha256Hex(TOKEN), 'u1', NOW, NOW + 86_400_000, NOW],
  });
});
afterAll(async () => {
  await t.cleanup();
});
beforeEach(() => {
  state.cookie = `mm_session=${TOKEN}`;
  state.failing = false;
});

const redirectOf = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { redirectTo?: string }).redirectTo ?? `threw:${(e as Error).message}`;
  }
};

describe('guard ของหน้าเว็บเมื่อ DB ล้มชั่วคราว', () => {
  it('ควบคุม: session จริง → ผ่าน guard', async () => {
    await expect(requireUser()).resolves.toMatchObject({ username: 'alice' });
  });

  it('ไม่มี cookie → redirect /login (ไม่แตะ DB แม้ DB พัง)', async () => {
    state.cookie = '';
    state.failing = true;
    expect(await redirectOf(requireUser)).toBe('/login');
  });

  it('cookie ที่ไม่มีใน DB (หมดอายุ/ถูกเพิก) → redirect /login', async () => {
    state.cookie = `mm_session=${'b'.repeat(43)}`;
    expect(await redirectOf(requireUser)).toBe('/login');
  });

  it('DB พัง (SQLITE_BUSY) ขณะมี cookie → โยน SessionUnavailableError 503 ไม่ใช่ redirect', async () => {
    state.failing = true;
    for (const guard of [requireUser, requireMustChangePin, redirectIfSignedIn]) {
      const err = await guard().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, guard.name).toBeInstanceOf(SessionUnavailableError);
      expect((err as SessionUnavailableError).status).toBe(503);
      expect(((err as SessionUnavailableError).cause as LibsqlError).code).toBe('SQLITE_BUSY');
      expect((err as Error).message).not.toMatch(/locked|SQLITE/i); // ไม่รั่วรายละเอียดฐานข้อมูล
    }
  });
});
