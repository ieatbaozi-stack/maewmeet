// drizzle + libSQL — ARCHITECTURE §1 (src/db/client.ts) · ADR 0001
// prod/preview: Turso (libsql://…) + TURSO_AUTH_TOKEN · dev/test: file:./local.db หรือ file:<tmp> (เทสต์)
// libSQL เปิด foreign_keys ให้เองทุก connection (ตรวจแล้วใน tests/platform/schema.test.ts)
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { getEnv } from '@/lib/shared/env';
import { instrumentClient } from './request-metrics';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = LibSQLDatabase<Schema> & { $client: Client };
/** ใช้เป็นชนิดของ `tx` ใน db.transaction(async (tx) => …) */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** repo รับได้ทั้ง db และ tx */
export type DbOrTx = Db | Tx;

/**
 * busy timeout (มิลลิวินาที) ของ `file:` — หลาย process/worker เขียนไฟล์เดียวกัน (E2E, next start + cron) ต้องรอล็อกแทนตอบ SQLITE_BUSY ทันที
 * (ค่าเริ่มต้นของ @libsql/client 0.18 = 0 = ไม่รอ) · หน่วยของ option `timeout` คือ ms (ตรวจใน tests/platform/db-busy-timeout.test.ts)
 * หมายเหตุ: driver ของ file: เป็น sync — การรอล็อกบล็อก event loop ของ process นั้นจนกว่าจะได้ล็อกหรือครบเวลา จึงต้องไม่ตั้งยาวเกินจำเป็น:
 * writer 2 ตัวใน process เดียว (คนละ connection ของ pool) ที่ชนกัน ผู้ถือล็อกต้องใช้ event loop เพื่อ commit แต่ผู้รอบล็อก loop อยู่ → รอจนครบเวลาแล้วได้ BUSY เหมือนเดิม
 * (ตัวอย่าง: tests/auth/pin-reset-admin.test.ts 'approve พร้อมกัน') — ที่ 5000ms ทำให้คำขอนั้นค้าง 5 วิ จึงใช้ 1000ms
 */
export const FILE_BUSY_TIMEOUT_MS = 1000;

export function createDb(options: { url: string; authToken?: string }): Db {
  const client = createClient({
    url: options.url,
    authToken: options.authToken,
    ...(options.url.startsWith('file:') ? { timeout: FILE_BUSY_TIMEOUT_MS } : {}),
  });
  // R7 §2: นับ query/เวลา DB ต่อ request (เฉพาะใน runWithRequestMetrics — นอกนั้นไม่ทำอะไร) · ไม่เก็บ SQL/พารามิเตอร์
  return drizzle(instrumentClient(client), { schema });
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
