// R0-5: src/instrumentation.ts — register() ล้มตอนเริ่มเมื่อ env ขาด (ระบุชื่อ ไม่มีค่า) · ข้ามช่วง build / edge
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHASE_PRODUCTION_BUILD, register } from '@/instrumentation';
import { EnvError, resetEnvCache } from '@/lib/shared/env';

const SECRET_32 = randomBytes(32).toString('base64');
const CRON = 'cron-' + randomBytes(16).toString('hex');

const ENV_KEYS = [
  'NEXT_RUNTIME',
  'NEXT_PHASE',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'APP_SECRET',
  'CRON_SECRET',
  'APP_ORIGIN',
  'VERCEL_ENV',
  'VERCEL_URL',
] as const;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) vi.stubEnv(k, values[k]);
}

const fullEnv = {
  NEXT_RUNTIME: 'nodejs',
  TURSO_DATABASE_URL: 'file:./local.db',
  APP_SECRET: SECRET_32,
  CRON_SECRET: CRON,
};

beforeEach(() => resetEnvCache());
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('instrumentation register()', () => {
  it('ใช้ชื่อเฟสเดียวกับ Next 16 (next/constants)', async () => {
    const constants = await import('next/constants');
    expect(PHASE_PRODUCTION_BUILD).toBe(constants.PHASE_PRODUCTION_BUILD);
  });

  it('env ครบ (nodejs runtime) → ไม่โยน', async () => {
    setEnv(fullEnv);
    await expect(register()).resolves.toBeUndefined();
  });

  it('ขาด CRON_SECRET → โยน EnvError ระบุชื่อตัวแปร และไม่มีค่าลับในข้อความ', async () => {
    setEnv({ ...fullEnv, CRON_SECRET: undefined });
    const err = await register().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EnvError);
    const e = err as EnvError;
    expect(e.variables).toEqual(['CRON_SECRET']);
    expect(e.message).toContain('CRON_SECRET');
    expect(e.message).not.toContain(SECRET_32);
    expect(e.message).not.toContain(CRON);
    expect(String(e.stack)).not.toContain(SECRET_32);
  });

  it('CRON_SECRET เป็นค่าว่าง (.env.example) → ถือว่าขาด', async () => {
    setEnv({ ...fullEnv, CRON_SECRET: '' });
    await expect(register()).rejects.toThrow(/missing: CRON_SECRET/);
  });

  it('ช่วง next build (NEXT_PHASE=phase-production-build) → ไม่โยนแม้ env ขาด', async () => {
    setEnv({ NEXT_RUNTIME: 'nodejs', NEXT_PHASE: PHASE_PRODUCTION_BUILD });
    await expect(register()).resolves.toBeUndefined();
  });

  it('edge runtime → ไม่ตรวจ (ไม่โยนแม้ env ขาด)', async () => {
    setEnv({ NEXT_RUNTIME: 'edge' });
    await expect(register()).resolves.toBeUndefined();
  });

  it('เฟสอื่น (phase-production-server) + env ขาด → โยน', async () => {
    setEnv({ NEXT_RUNTIME: 'nodejs', NEXT_PHASE: 'phase-production-server' });
    await expect(register()).rejects.toBeInstanceOf(EnvError);
  });
});
