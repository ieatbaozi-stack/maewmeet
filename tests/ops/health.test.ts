// R0-8 (health) · R0_CONTRACT §3 — เรียก handler ตรง (ไม่ต้องรัน server) · DB = libSQL file: ชั่วคราวที่รัน migration จริง
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pkg from '../../package.json';
import { GET } from '@/app/api/health/route';
import { probeArgon2, resetArgon2Cache } from '@/app/api/health/argon2';
import { CACHE_CONTROL } from '@/app/api/_lib/route';
import { recordHeartbeat } from '@/lib/data/services/maintenance';
import { fixedClock, HOUR_MS, setClock } from '@/lib/shared/clock';
import { resetEnvCache } from '@/lib/shared/env';
import { resetDbClient } from '@/db/client';
import { resetPepperCache, pepperFingerprint } from '@/lib/auth/pepper';
import { insertPepperFingerprintIfAbsent } from '@/lib/data/repos/pepper-fingerprint';
import { insertUser } from '@/lib/data/repos/user';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

type Body = {
  ok: boolean;
  version: string;
  node: string;
  argon2: boolean;
  db: boolean;
  pepper: { ok: boolean; currentVersion: number | null; usersByVersion: Record<string, number> };
  heartbeatAgeHours: { vercelCron: number | null; githubActions: number | null };
};

let t: InstalledTestDb;
let restoreClock: () => void;
let errSpy: ReturnType<typeof vi.spyOn>;
let pepperV1: string; // สร้างในเทสต์เท่านั้น
const PEPPER_KEYS = ['PIN_PEPPER_CURRENT_VERSION', 'PIN_PEPPER_V1', 'PIN_PEPPER_V2'];

function setPepper(vals: Record<string, string | undefined>) {
  for (const k of PEPPER_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vals)) if (v !== undefined) process.env[k] = v;
  resetEnvCache();
  resetPepperCache();
}

beforeEach(async () => {
  t = await installTestDb();
  pepperV1 = randomBytes(32).toString('base64');
  setPepper({ PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: pepperV1 });
  restoreClock = setClock(fixedClock(NOW));
  resetArgon2Cache();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  errSpy.mockRestore();
  setPepper({});
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
    if (value.length >= 8) expect(text, `ไม่ควรมีค่าของ ${key}`).not.toContain(value); // ค่าสั้น (เช่น เลขเวอร์ชัน '1') ซ้ำกับตัวเลขอื่นได้
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
    expect(Object.keys(body).sort()).toEqual(['argon2', 'db', 'heartbeatAgeHours', 'node', 'ok', 'pepper', 'version']);
    expect(body).toEqual({
      ok: true,
      version: pkg.version,
      node: process.version,
      argon2: true,
      db: true,
      pepper: { ok: true, currentVersion: 1, usersByVersion: {} },
      heartbeatAgeHours: { vercelCron: null, githubActions: null },
    });
    expect(process.version).toMatch(/^v24\./); // R0-1: เทสต์ต้องรันบน Node 24
    expectNoSecrets(text);
    expect(text).not.toContain(pepperV1);
    expect(text).not.toContain(pepperFingerprint(Buffer.from(pepperV1, 'base64')).slice(0, 8)); // ไม่มี fingerprint แม้ 8 ตัว
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

describe('GET /api/health — pepper (ADR 0002 §7.1, test 14)', () => {
  const addUser = (username: string, version: number) =>
    insertUser(
      t.db,
      { id: `u_${username}`, username, usernameNormalized: username, displayName: username, pinHash: 'x', pinPepperVersion: version },
      NOW,
    );

  async function expectPepperFail(extra?: (body: Body) => void) {
    const res = await get();
    expect(res.status).toBe(503);
    const { text, body } = await read(res);
    expect(body).toMatchObject({ ok: false, db: true, pepper: { ok: false } });
    expectNoSecrets(text);
    expect(text).not.toContain(pepperV1);
    extra?.(body);
  }

  it('ผู้ใช้ V1 อยู่ → usersByVersion นับ · ยัง 200', async () => {
    await insertPepperFingerprintIfAbsent(t.db, 1, pepperFingerprint(Buffer.from(pepperV1, 'base64')), NOW);
    await addUser('a', 1);
    await addUser('b', 1);
    const res = await get();
    expect(res.status).toBe(200);
    expect((await read(res)).body.pepper).toEqual({ ok: true, currentVersion: 1, usersByVersion: { '1': 2 } });
  });

  it.each([
    ['ไม่มี PIN_PEPPER_CURRENT_VERSION', () => ({ PIN_PEPPER_V1: pepperV1 })],
    ['ไม่มี PIN_PEPPER_V<CURRENT>', () => ({ PIN_PEPPER_CURRENT_VERSION: '1' })],
    ['ค่าว่าง', () => ({ PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: '' })],
    ['base64 สั้นกว่า 32 ไบต์', () => ({ PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: Buffer.alloc(16, 7).toString('base64') })],
  ])('%s → 503 pepper.ok:false', async (_name, vals) => {
    setPepper(vals());
    await expectPepperFail();
  });

  it('fingerprint ในฐานไม่ตรงกับ env → 503 · ไม่รั่ว fingerprint', async () => {
    const stored = pepperFingerprint(randomBytes(32));
    await insertPepperFingerprintIfAbsent(t.db, 1, stored, NOW);
    await expectPepperFail((b) => expect(JSON.stringify(b)).not.toContain(stored.slice(0, 8)));
  });

  it('ผู้ใช้ V1 อยู่ แต่ env เหลือแต่ V2 (ลบ V1 ก่อนเวลา) → 503 · เห็นจำนวนผู้ใช้ V1 ให้รู้สาเหตุ', async () => {
    await addUser('a', 1);
    setPepper({ PIN_PEPPER_CURRENT_VERSION: '2', PIN_PEPPER_V2: randomBytes(32).toString('base64') });
    await expectPepperFail((b) => expect(b.pepper).toMatchObject({ currentVersion: 2, usersByVersion: { '1': 1 } }));
  });

  it('มีผู้ใช้ V1 แต่แถว fingerprint หาย → 503 (แถวหายผิดปกติ ต้องให้คนตรวจ)', async () => {
    await addUser('a', 1);
    await expectPepperFail();
  });

  it('แก้ env กลับเป็นค่าที่ถูก → 200 ทันที (ผลที่ไม่ผ่านไม่ cache)', async () => {
    setPepper({});
    expect((await get()).status).toBe(503);
    setPepper({ PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: pepperV1 });
    expect((await get()).status).toBe(200);
  });

  it('env หลักหาย → pepper ok:false ไม่โยน (503 เดียวกับเดิม)', async () => {
    delete process.env.APP_SECRET;
    resetEnvCache();
    resetDbClient();
    const res = await get();
    expect(res.status).toBe(503);
    expect((await read(res)).body.pepper).toEqual({ ok: false, currentVersion: null, usersByVersion: {} });
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
