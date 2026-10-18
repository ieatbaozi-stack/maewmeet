// libSQL `file:` ชั่วคราวต่อเทสต์ + apply migration จริงจาก drizzle/ (ไม่ใช่ push schema) — R0-4 / PROCESS เกต Migration
// ใช้:
//   const t = await createTestDb();         // DB ว่าง + migration ครบ
//   await t.cleanup();
// หรือสำหรับเทสต์ route handler (getDb()/getEnv() ของแอปชี้มาที่ DB นี้):
//   const t = await installTestDb();         // ตั้ง process.env ชุดทดสอบ + reset cache env/db
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb, resetDbClient, type Db } from '@/db/client';
import { resetEnvCache } from '@/lib/shared/env';

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

export type TestDb = { db: Db; url: string; cleanup: () => Promise<void> };

export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDb> {
  const dir = mkdtempSync(path.join(tmpdir(), 'maewmeet-test-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  const db = createDb({ url });
  if (options.migrate !== false) await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db,
    url,
    cleanup: async () => {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** ค่า env ทดสอบ — ความลับสุ่มต่อรอบ (ARCHITECTURE §7) */
export function testEnv(url: string): Record<string, string> {
  return {
    TURSO_DATABASE_URL: url,
    APP_SECRET: randomBytes(32).toString('base64'),
    CRON_SECRET: randomBytes(24).toString('base64url'),
    APP_ORIGIN: 'https://maewmeet.test',
  };
}

const TOUCHED_KEYS = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'APP_SECRET', 'CRON_SECRET', 'APP_ORIGIN', 'VERCEL_URL', 'VERCEL_ENV'];

export type InstalledTestDb = TestDb & { env: Record<string, string> };

/** สร้าง DB + ตั้ง process.env ให้แอปใช้ DB นี้ · cleanup คืน env เดิม */
export async function installTestDb(overrides: Record<string, string> = {}): Promise<InstalledTestDb> {
  const t = await createTestDb();
  const saved = Object.fromEntries(TOUCHED_KEYS.map((k) => [k, process.env[k]]));
  const env = { ...testEnv(t.url), ...overrides };
  for (const k of TOUCHED_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  resetEnvCache();
  resetDbClient();
  return {
    ...t,
    env,
    cleanup: async () => {
      resetDbClient();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetEnvCache();
      await t.cleanup();
    },
  };
}
