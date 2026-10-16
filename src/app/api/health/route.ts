// GET /api/health — สาธารณะ · R0_CONTRACT §3 / R0-8 · ADR 0001 §3.1 · เจ้าของ: OPS (#10)
//
// 200 {ok, version, node, argon2, db, heartbeatAgeHours: {vercelCron, githubActions}}
// 503 รูปเดียวกันแต่ ok:false — เมื่อ env "ต้องมี" หาย/ผิดรูป หรือต่อ DB ไม่ได้
//
// ไม่เปิดเผย: ค่า env, ชื่อตัวแปรที่หาย, URL ฐาน, ข้อความ error (ชื่อตัวแปรที่หายไปอยู่ใน log ของ Vercel เท่านั้น
// — EnvError.message มีแต่ชื่อ ไม่มีค่า) · body ไม่ห่อ {data} ตามสัญญา (reply raw) · Cache-Control: private, no-store (wrapper)
// argon2 เป็นข้อมูลรายงาน (R0) — ไม่ทำให้ 503 ตามสัญญา §3 (R1 จะเพิ่ม pepper เป็นเงื่อนไข 503 ตาม ADR 0002 §7.1)
import pkg from '../../../../package.json';
import { readHealthData, type HeartbeatAgeHours } from '@/lib/data/health';
import { getEnv, isEnvError } from '@/lib/shared/env';
import { route, reply } from '../_lib/route';
import { argon2Available } from './argon2';

type HealthBody = {
  ok: boolean;
  version: string;
  node: string;
  argon2: boolean;
  db: boolean;
  heartbeatAgeHours: HeartbeatAgeHours;
};

/** ชื่อตัวแปร env ที่มีปัญหา → log ฝั่งเซิร์ฟเวอร์ (EnvError.message มีแต่ชื่อ ไม่มีค่า) — ไม่ส่งออกใน response */
function logEnvProblem(): void {
  try {
    getEnv();
  } catch (e) {
    console.error(`[health] ${isEnvError(e) ? e.message : 'env check failed'}`);
  }
}

export const GET = route({
  method: 'GET',
  path: '/api/health',
  handler: async ({ now }) => {
    const [argon2, data] = await Promise.all([argon2Available(), readHealthData(now)]);
    if (!data.env) logEnvProblem();
    const ok = data.env && data.db;
    const body: HealthBody = {
      ok,
      version: pkg.version,
      node: process.version,
      argon2,
      db: data.db,
      heartbeatAgeHours: data.heartbeatAgeHours,
    };
    return reply(body, { status: ok ? 200 : 503, raw: true });
  },
});
