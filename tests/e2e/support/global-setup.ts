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
    // R1: libSQL ไฟล์ + หลาย worker (signup/login พร้อมกัน + เทสต์แก้ DB ตรง ๆ) → SQLITE_BUSY ทำให้ API ตอบ 500 ได้ใน journal mode เริ่มต้น
    //     WAL ทำให้ reader ไม่ถูกบล็อกโดย writer (ค่านี้ค้างอยู่ในไฟล์ DB) — ไม่แตะโค้ดแอป
    await client.execute('PRAGMA journal_mode = WAL');
    // R1: คำขอ reset ที่ค้าง pending จากรอบก่อน (DB ไฟล์ชั่วคราวใช้ซ้ำในเครื่อง) ทำให้หน้า /admin/pin-resets ยาวขึ้นเรื่อย ๆ → ล้างก่อนเริ่ม
    await client.execute("DELETE FROM pin_reset_request WHERE status = 'pending'");
  } finally {
    client.close();
  }
}
