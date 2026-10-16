// ฟังก์ชันที่ OPS (#10) เรียกใน GET /api/health — R0_CONTRACT §3 · ADR 0001 §3.1
// ไม่โยน error และไม่คืนรายละเอียดภายใน (ข้อความ error / URL ฐาน) — คืนแค่ boolean / ตัวเลข
import { sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { HOUR_MS } from '@/lib/shared/clock';
import { getEnv } from '@/lib/shared/env';
import { listHeartbeats } from './repos/system-heartbeat';

/** อายุ heartbeat ล่าสุดเป็นชั่วโมง (ทศนิยม 2 ตำแหน่ง) · null = ยังไม่เคยมี heartbeat จาก source นั้น */
export type HeartbeatAgeHours = { vercelCron: number | null; githubActions: number | null };

/** ต่อ DB ได้หรือไม่ (SELECT 1) — false ถ้า env ผิด/ต่อไม่ได้ */
export async function checkDbConnection(db?: Db): Promise<boolean> {
  try {
    const conn = db ?? getDb();
    await conn.run(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function heartbeatAgeHours(db: Db, now: number): Promise<HeartbeatAgeHours> {
  const rows = await listHeartbeats(db);
  const age = (source: string) => {
    const row = rows.find((r) => r.source === source);
    return row ? Math.round(((now - row.lastAt) / HOUR_MS) * 100) / 100 : null;
  };
  return { vercelCron: age('vercel-cron'), githubActions: age('github-actions') };
}

/** สำหรับ health: อ่านอายุ heartbeat แบบไม่โยน — null ทั้งก้อนถ้าอ่าน DB ไม่ได้ */
export async function readHeartbeatAgeHours(now: number, db?: Db): Promise<HeartbeatAgeHours | null> {
  try {
    return await heartbeatAgeHours(db ?? getDb(), now);
  } catch {
    return null;
  }
}

export type HealthData = {
  /** env ที่ "ต้องมี" ครบและถูกรูป (ไม่บอกว่าตัวไหน — ชื่อตัวแปรไป log ฝั่งเซิร์ฟเวอร์ของผู้เรียกเอง) */
  env: boolean;
  /** SELECT 1 ผ่าน */
  db: boolean;
  /** อายุ heartbeat ต่อ source · ทั้งสองค่าเป็น null เมื่ออ่าน DB ไม่ได้หรือยังไม่เคยมี */
  heartbeatAgeHours: HeartbeatAgeHours;
};

/**
 * จุดเดียวที่ GET /api/health (OPS) เรียก — ไม่โยน error เสมอ · คืนแค่ boolean/ตัวเลข
 * 503 เมื่อ `!env || !db` (R0_CONTRACT §3) เป็นการตัดสินของ route ฝั่ง OPS
 * `db` ส่งมาเองได้ (เทสต์) — ไม่ส่ง = ใช้ connection ของแอป (getDb) ซึ่งต้องการ env ที่ถูกต้อง
 */
export async function readHealthData(now: number, db?: Db): Promise<HealthData> {
  let env = true;
  try {
    getEnv();
  } catch {
    env = false;
  }
  if (!db && !env) return { env, db: false, heartbeatAgeHours: { vercelCron: null, githubActions: null } };
  const dbOk = await checkDbConnection(db);
  const ages = dbOk ? await readHeartbeatAgeHours(now, db) : null;
  return { env, db: dbOk, heartbeatAgeHours: ages ?? { vercelCron: null, githubActions: null } };
}
