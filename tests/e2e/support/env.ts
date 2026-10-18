// ค่ากลางของ E2E ที่ทั้ง playwright.config.ts และ globalSetup ใช้ร่วมกัน (โหลดในโปรเซสเดียวกัน)
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const E2E_PORT = Number(process.env.E2E_PORT || 3000);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** CI ตั้ง TURSO_DATABASE_URL (file: ใน runner) · ในเครื่องใช้ไฟล์ชั่วคราวแยกจาก DB dev */
export const E2E_DATABASE_URL = process.env.TURSO_DATABASE_URL || `file:${path.join(tmpdir(), 'maewmeet-e2e.db')}`;

/**
 * env ขั้นต่ำของ `next start` (src/lib/shared/env.ts ล้มตอนเริ่มถ้าขาด)
 * ความลับใช้ของ CI ถ้ามี ไม่งั้นสุ่มต่อรอบ · APP_ORIGIN = URL ที่เทสต์ใช้จริง (CSRF ของ POST /api/prefs)
 */
export function e2eServerEnv(): Record<string, string> {
  return {
    TURSO_DATABASE_URL: E2E_DATABASE_URL,
    APP_SECRET: process.env.APP_SECRET || randomBytes(32).toString('base64'),
    CRON_SECRET: process.env.CRON_SECRET || randomBytes(24).toString('hex'),
    APP_ORIGIN: E2E_BASE_URL,
    ...e2ePepperEnv(),
    PLACE_SEARCH_ENABLED: process.env.PLACE_SEARCH_ENABLED || 'false',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

/**
 * pepper ของ PIN (R1) — CI ตั้ง PIN_PEPPER_V1 สุ่มต่อรอบมาให้ (ci-env.sh) → ใช้ตามนั้น
 * ในเครื่องที่ไม่ตั้ง: ใช้ค่าทดสอบตายตัว (ไม่ใช่ความลับ) เพราะ DB ไฟล์ชั่วคราวถูกใช้ซ้ำข้ามรอบ และ
 * fingerprint ของ pepper ถูกบันทึกใน DB (ADR 0002 §7.2) — สุ่มใหม่ทุกรอบจะชน FINGERPRINT_MISMATCH
 */
export function e2ePepperEnv(): Record<string, string> {
  const fromEnv = process.env.PIN_PEPPER_V1;
  return {
    PIN_PEPPER_CURRENT_VERSION: process.env.PIN_PEPPER_CURRENT_VERSION || '1',
    PIN_PEPPER_V1: fromEnv || createHash('sha256').update('maewmeet/e2e-test-pepper/not-a-secret').digest('base64'),
  };
}
