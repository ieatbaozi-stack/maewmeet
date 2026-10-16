// R0-5 "ล้มตอนเริ่ม" — Platform (#5) · ARCHITECTURE §7 · CLAUDE.md กฎ 7
// Next 16 เรียก register() ครั้งเดียวต่อ server instance (nodejs และ edge แยกกัน)
// - ตรวจเฉพาะ runtime nodejs (env.ts ใช้ Buffer และแอปรัน route บน nodejs)
// - ข้ามช่วง `next build` (NEXT_PHASE = 'phase-production-build') เพื่อให้ build ไม่ต้องมีความลับ
//   Next 16.4.2 เองก็ข้าม register() ในเฟสนี้อยู่แล้ว (instrumentation-globals.external.js) — เช็กซ้ำเพื่อกันพลาด
// - ขาด/ผิด → assertEnv() โยน EnvError ที่มีแต่ชื่อตัวแปร (ไม่มีค่า) → Next ล้มตอนเริ่มพร้อมข้อความนั้น
// import แบบ dynamic เพื่อไม่ให้ env.ts (zod + Buffer) ถูก bundle เข้า edge runtime

export const PHASE_PRODUCTION_BUILD = 'phase-production-build';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  const { assertEnv } = await import('@/lib/shared/env');
  assertEnv();
}
