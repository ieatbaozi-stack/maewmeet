// ฟังก์ชันที่ OPS (#10) เรียกใน GET /api/health — R0_CONTRACT §3 · ADR 0001 §3.1
// ไม่โยน error และไม่คืนรายละเอียดภายใน (ข้อความ error / URL ฐาน) — คืนแค่ boolean / ตัวเลข
import { sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { HOUR_MS } from '@/lib/shared/clock';
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
