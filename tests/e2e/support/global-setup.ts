// apply ทุก migration ใน drizzle/ บน DB ของ E2E (idempotent — รันซ้ำได้) ให้ /api/health ตอบ 200 ระหว่างเทสต์
// Playwright สตาร์ต webServer ก่อน globalSetup แต่แอปต่อ DB แบบ lazy และ URL ตรวจความพร้อมไม่แตะ DB → ปลอดภัย
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { E2E_DATABASE_URL } from './env';

export default async function globalSetup(): Promise<void> {
  const client = createClient({ url: E2E_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, '../../../drizzle') });
  } finally {
    client.close();
  }
}
