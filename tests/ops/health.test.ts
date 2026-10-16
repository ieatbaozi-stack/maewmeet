// R0-8 (health) · R0_CONTRACT §3 — เรียก handler ตรง (ไม่ต้องรัน server) · DB = libSQL file: ชั่วคราวที่รัน migration จริง
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pkg from '../../package.json';
import { GET } from '@/app/api/health/route';
import { probeArgon2, resetArgon2Cache } from '@/app/api/health/argon2';
import { CACHE_CONTROL } from '@/app/api/_lib/route';
import { recordHeartbeat } from '@/lib/data/services/maintenance';
import { fixedClock, HOUR_MS, setClock } from '@/lib/shared/clock';
import { resetEnvCache } from '@/lib/shared/env';
import { resetDbClient } from '@/db/client';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

type Body = {
  ok: boolean;
  version: string;
  node: string;
  argon2: boolean;
  db: boolean;
  heartbeatAgeHours: { vercelCron: number | null; githubActions: number | null };
};

let t: InstalledTestDb;
let restoreClock: () => void;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  t = await installTestDb();
  restoreClock = setClock(fixedClock(NOW));
  resetArgon2Cache();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  errSpy.mockRestore();
  restoreClock();
  await t.cleanup();
});

function get() {
  return GET(new Request('https://maewmeet.test/api/health'));
}

async function read(res: Response): Promise<{ text: string; body: Body }> {
  const text = await res.text();
  return { text, body: JSON.parse(text) as Body };
}

function expectNoSecrets(text: string) {
  for (const [key, value] of Object.entries(t.env)) {
    expect(text, `ไม่ควรมีชื่อตัวแปร ${key}`).not.toContain(key);
    expect(text, `ไม่ควรมีค่าของ ${key}`).not.toContain(value);
  }
  expect(text).not.toMatch(/file:|libsql:|turso|stack|Error/i);
}

describe('GET /api/health — 200', () => {
  it('รูป body ตามสัญญา + argon2: true บน Node 24 + Cache-Control', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const { text, body } = await read(res);
    expect(Object.keys(body).sort()).toEqual(['argon2', 'db', 'heartbeatAgeHours', 'node', 'ok', 'version']);
    expect(body).toEqual({
      ok: true,
      version: pkg.version,
      node: process.version,
      argon2: true,
      db: true,
      heartbeatAgeHours: { vercelCron: null, githubActions: null },
    });
    expect(process.version).toMatch(/^v24\./); // R0-1: เทสต์ต้องรันบน Node 24
    expectNoSecrets(text);
  });

  it('heartbeatAgeHours คำนวณจากนาฬิกาจำลอง (ชม. ทศนิยม 2 ตำแหน่ง)', async () => {
    await recordHeartbeat(t.db, 'vercel-cron', NOW - 25.5 * HOUR_MS);
    await recordHeartbeat(t.db, 'github-actions', NOW - (11 * HOUR_MS + 20 * 60_000));
    const res = await get();
    expect(res.status).toBe(200);
    const { body } = await read(res);
    expect(body.heartbeatAgeHours).toEqual({ vercelCron: 25.5, githubActions: 11.33 });
  });

  it('รันซ้ำ 2 ครั้งผลเท่าเดิม และ health ไม่เขียน heartbeat เอง', async () => {
    const a = await read(await get());
    const b = await read(await get());
    expect(b.body).toEqual(a.body);
    expect(b.body.heartbeatAgeHours).toEqual({ vercelCron: null, githubActions: null });
  });
});

describe('GET /api/health — 503', () => {
  it('DB ต่อไม่ได้ → 503 ok:false db:false ไม่มีรายละเอียดภายใน', async () => {
    process.env.TURSO_DATABASE_URL = 'http://127.0.0.1:9/unreachable';
    resetEnvCache();
    resetDbClient();
    const res = await get();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    const { text, body } = await read(res);
    expect(body).toMatchObject({ ok: false, db: false, heartbeatAgeHours: { vercelCron: null, githubActions: null } });
    expect(body.argon2).toBe(true);
    expect(text).not.toContain('127.0.0.1');
    expectNoSecrets(text);
  });

  it.each(['CRON_SECRET', 'APP_SECRET', 'TURSO_DATABASE_URL'])('env ต้องมีหาย (%s) → 503 · log มีแค่ชื่อตัวแปร', async (name) => {
    const value = process.env[name]!;
    delete process.env[name];
    resetEnvCache();
    resetDbClient();
    const res = await get();
    expect(res.status).toBe(503);
    const { text, body } = await read(res);
    expect(body).toMatchObject({ ok: false, db: false });
    expectNoSecrets(text);
    const logged = errSpy.mock.calls.flat().join('\n');
    expect(logged).toContain(name);
    expect(logged).not.toContain(value);
  });

  it('deployed (VERCEL_ENV=production) แต่ไม่มี TURSO_AUTH_TOKEN → 503', async () => {
    process.env.VERCEL_ENV = 'production';
    resetEnvCache();
    resetDbClient();
    const res = await get();
    expect(res.status).toBe(503);
  });
});

describe('argon2 probe', () => {
  it('ใช้ crypto.argon2 จริงได้บน runtime นี้', async () => {
    await expect(probeArgon2()).resolves.toBe(true);
  });

  it('ไม่มีฟังก์ชัน (Node < 24.7) → false', async () => {
    await expect(probeArgon2(null)).resolves.toBe(false);
  });

  it('ฟังก์ชันโยน/คืน error → false (ไม่โยนต่อ)', async () => {
    await expect(
      probeArgon2(() => {
        throw new Error('boom');
      }),
    ).resolves.toBe(false);
    await expect(probeArgon2((_a: string, _p: unknown, cb: (e: Error | null) => void) => cb(new Error('x')))).resolves.toBe(false);
  });
});
