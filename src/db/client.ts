// drizzle + libSQL — ARCHITECTURE §1 (src/db/client.ts) · ADR 0001
// prod/preview: Turso (libsql://…) + TURSO_AUTH_TOKEN · dev/test: file:./local.db หรือ file:<tmp> (เทสต์)
// libSQL เปิด foreign_keys ให้เองทุก connection (ตรวจแล้วใน tests/platform/schema.test.ts)
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { getEnv } from '@/lib/shared/env';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = LibSQLDatabase<Schema> & { $client: Client };
/** ใช้เป็นชนิดของ `tx` ใน db.transaction(async (tx) => …) */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** repo รับได้ทั้ง db และ tx */
export type DbOrTx = Db | Tx;

export function createDb(options: { url: string; authToken?: string }): Db {
  const client = createClient({ url: options.url, authToken: options.authToken });
  return drizzle(client, { schema });
}

let instance: Db | undefined;

/** connection ของ instance นี้ (lazy — ไม่ต่อฐานตอน import/build) */
export function getDb(): Db {
  if (!instance) {
    const env = getEnv();
    instance = createDb({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  }
  return instance;
}

/** ปิดและล้าง connection — สำหรับเทสต์ที่เปลี่ยน TURSO_DATABASE_URL */
export function resetDbClient(): void {
  instance?.$client.close();
  instance = undefined;
}

export { schema };
