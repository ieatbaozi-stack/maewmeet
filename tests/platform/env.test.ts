// R0-5: env ล้มพร้อมชื่อตัวแปรเมื่อขาด/ผิด และข้อความไม่มีค่าลับ (ARCHITECTURE §7 · ADR 0002 §7.1)
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvError, configuredAppOrigin, loadEnv, readPepperEnv } from '@/lib/shared/env';

const SECRET_32 = randomBytes(32).toString('base64');
const CRON = 'cron-' + randomBytes(16).toString('hex');

const devEnv = () => ({
  TURSO_DATABASE_URL: 'file:./local.db',
  APP_SECRET: SECRET_32,
  CRON_SECRET: CRON,
});

function catchEnvError(source: Record<string, string | undefined>): EnvError {
  try {
    loadEnv(source);
  } catch (e) {
    expect(e).toBeInstanceOf(EnvError);
    return e as EnvError;
  }
  throw new Error('loadEnv ควรล้ม');
}

describe('loadEnv — dev/test profile', () => {
  it('ค่าครบ → ผ่าน พร้อมค่าดีฟอลต์', () => {
    const env = loadEnv(devEnv());
    expect(env.TURSO_DATABASE_URL).toBe('file:./local.db');
    expect(env.TURSO_AUTH_TOKEN).toBeUndefined();
    expect(env.PLACE_SEARCH_ENABLED).toBe(true);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NOMINATIM_BASE_URL).toBe('https://nominatim.openstreetmap.org');
    expect(env.PIN_PEPPER_CURRENT_VERSION).toBeUndefined(); // R0 ยังไม่บังคับ
  });

  it('ขาดตัวแปรต้องมี → EnvError ระบุชื่อครบทุกตัว', () => {
    const e = catchEnvError({});
    expect([...e.variables].sort()).toEqual(['APP_SECRET', 'CRON_SECRET', 'TURSO_DATABASE_URL']);
    expect(e.message).toContain('missing: ');
    for (const name of ['TURSO_DATABASE_URL', 'APP_SECRET', 'CRON_SECRET']) expect(e.message).toContain(name);
  });

  it('ค่าว่าง (บรรทัด `X=` ใน .env) นับเป็นขาด', () => {
    const e = catchEnvError({ ...devEnv(), APP_SECRET: '', CRON_SECRET: '   ' });
    expect([...e.variables].sort()).toEqual(['APP_SECRET', 'CRON_SECRET']);
    expect(e.message).toMatch(/missing: .*APP_SECRET/);
  });

  it('ค่าผิดรูป → ระบุชื่อ แต่ข้อความไม่มีค่าที่ส่งมา (ห้ามพิมพ์ความลับ)', () => {
    const shortCron = 'short-' + randomBytes(3).toString('hex'); // < 16 ตัว
    const weakSecret = Buffer.from('only-16-bytes!!!').toString('base64'); // base64 แต่ < 32 ไบต์
    const badUrl = 'postgres://user:hunter2@db.example/x';
    const e = catchEnvError({
      TURSO_DATABASE_URL: badUrl,
      APP_SECRET: weakSecret,
      CRON_SECRET: shortCron,
      APP_ORIGIN: 'https://x.test/path?token=leak',
    });
    expect([...e.variables].sort()).toEqual(['APP_ORIGIN', 'APP_SECRET', 'CRON_SECRET', 'TURSO_DATABASE_URL']);
    for (const value of [shortCron, weakSecret, badUrl, 'hunter2', 'token=leak']) {
      expect(e.message).not.toContain(value);
      expect(String(e.stack)).not.toContain(value);
    }
    expect(e.message).toContain('invalid: ');
  });

  it('ตัวแปรอื่นที่ไม่เกี่ยว (ความลับใด ๆ ใน process.env) ไม่โผล่ในข้อความ', () => {
    const e = catchEnvError({ SOME_TOKEN: 'super-secret-value-123', APP_SECRET: SECRET_32 });
    expect(e.message).not.toContain('super-secret-value-123');
    expect(e.message).not.toContain(SECRET_32);
  });

  it('PLACE_SEARCH_ENABLED/LOG_LEVEL นอกชุด → ล้ม', () => {
    const e = catchEnvError({ ...devEnv(), PLACE_SEARCH_ENABLED: 'yes', LOG_LEVEL: 'trace' });
    expect([...e.variables].sort()).toEqual(['LOG_LEVEL', 'PLACE_SEARCH_ENABLED']);
    expect(loadEnv({ ...devEnv(), PLACE_SEARCH_ENABLED: 'false' }).PLACE_SEARCH_ENABLED).toBe(false);
  });
});

describe('loadEnv — deployed profile (VERCEL_ENV=production|preview)', () => {
  const prodEnv = () => ({
    VERCEL_ENV: 'production',
    TURSO_DATABASE_URL: 'libsql://maewmeet-x.turso.io',
    TURSO_AUTH_TOKEN: 'tok-' + randomBytes(8).toString('hex'),
    APP_SECRET: SECRET_32,
    CRON_SECRET: CRON,
    APP_ORIGIN: 'https://maewmeet.vercel.app',
  });

  it('ค่าครบ → ผ่าน', () => {
    expect(loadEnv(prodEnv()).APP_ORIGIN).toBe('https://maewmeet.vercel.app');
  });

  it('prod ห้าม file: และต้องมี TURSO_AUTH_TOKEN + APP_ORIGIN', () => {
    const e = catchEnvError({ ...prodEnv(), TURSO_DATABASE_URL: 'file:./local.db', TURSO_AUTH_TOKEN: '', APP_ORIGIN: '' });
    expect([...e.variables].sort()).toEqual(['APP_ORIGIN', 'TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL']);
  });

  it('preview ใช้ VERCEL_URL แทน APP_ORIGIN ได้', () => {
    const env = loadEnv({ ...prodEnv(), VERCEL_ENV: 'preview', APP_ORIGIN: '', VERCEL_URL: 'maewmeet-git-r0.vercel.app' });
    expect(configuredAppOrigin(env)).toBe('https://maewmeet-git-r0.vercel.app');
  });

  it('dev profile ยอมให้ไม่มี token/origin', () => {
    expect(configuredAppOrigin(loadEnv(devEnv()))).toBeUndefined();
  });
});

describe('readPepperEnv (ประกาศชนิดไว้ — R1 บังคับ)', () => {
  const pepper = randomBytes(32).toString('base64');

  it('ครบ → ok พร้อมเวอร์ชัน', () => {
    const r = readPepperEnv({ PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: pepper });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.currentVersion).toBe(1);
      expect(r.versions.get(1)?.length).toBe(32);
    }
  });

  it('ไม่มี/สั้น/เวอร์ชันไม่ตรง → ไม่ ok และคืนเฉพาะชื่อ ไม่ใช่ค่า', () => {
    expect(readPepperEnv({})).toEqual({ ok: false, problems: ['PIN_PEPPER_CURRENT_VERSION'] });
    const weak = Buffer.from('short').toString('base64');
    const r = readPepperEnv({ PIN_PEPPER_CURRENT_VERSION: '2', PIN_PEPPER_V1: pepper, PIN_PEPPER_V2: weak });
    expect(r).toEqual({ ok: false, problems: ['PIN_PEPPER_V2'] });
    expect(JSON.stringify(r)).not.toContain(weak);
    expect(readPepperEnv({ PIN_PEPPER_CURRENT_VERSION: '3', PIN_PEPPER_V1: pepper })).toEqual({
      ok: false,
      problems: ['PIN_PEPPER_V3'],
    });
  });
});
