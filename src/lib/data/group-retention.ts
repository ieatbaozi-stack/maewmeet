// R17 G1/G2 — กติกาเก็บกลุ่มที่ลบ 30 วัน (กู้ได้) แล้วลบถาวร · ที่เดียวที่ตัดสิน "ลบถาวรเมื่อไร" (cron + ปุ่มกู้คืน + หน้า admin ใช้ร่วมกัน)
//
// B2 (boss 2026-11-19 = (ก)): กลุ่มที่ลบก่อนออกรุ่นนี้เริ่มนับ 30 วันจากวันเริ่มใช้กติกา — ไม่มีกลุ่มเก่าถูกลบถาวรทันทีวันแรก
//   วิธี: ค่าคงที่ GROUP_RETENTION_START_MS ในโค้ด (ไม่แก้ deleted_at ในฐาน — ค่าจริงของ "ลบเมื่อไร" ยังอยู่ให้ audit/หน้า admin)
//   เวลานับ = max(deleted_at, START) · ลบถาวรเมื่อ เวลานับ + 30 วัน <= now · กู้ได้เมื่อ now < เวลานับ + 30 วัน (เส้นเดียวกัน ไม่มีช่องว่าง/ทับ)
//   START ตั้งไว้ "ไม่ก่อนวันออกรุ่น" (เลือกช้าไว้ก่อน = เก็บนานขึ้นได้ ไม่สั้นลง) — ถ้าออกรุ่นหลังวันนี้ ให้เลื่อนค่าให้ตรงวันออกรุ่นก่อน merge
import { DEFAULT_TZ, parseLocalDateTime } from '@/lib/calendar';
import { DAY_MS } from '@/lib/shared/clock';

/** เก็บกลุ่มที่ลบกี่วันก่อนลบถาวร (R16 B4 = (ก) · R17 G1/G2) */
export const GROUP_RETENTION_DAYS = 30;
export const GROUP_RETENTION_MS = GROUP_RETENTION_DAYS * DAY_MS;

/** วันเริ่มใช้กติกา 30 วัน (B2) — 00:00 Asia/Bangkok ของวันที่ระบุ · คำนวณด้วย lib เวลากลาง (กฎ 9) */
export const GROUP_RETENTION_START_DATE = '2026-12-01';
export const GROUP_RETENTION_START_MS: number = parseLocalDateTime(GROUP_RETENTION_START_DATE, '00:00', DEFAULT_TZ);

/** จำนวนกลุ่มสูงสุดที่ลบถาวรต่อการรัน cron รายวัน 1 ครั้ง (ที่เหลือไปรอบถัดไป) */
export const GROUP_PURGE_BATCH = 25;

/** เวลา (epoch ms) ที่กลุ่มที่ลบเมื่อ deletedAt จะถูกลบถาวร */
export function groupPurgeAt(deletedAt: number): number {
  return Math.max(deletedAt, GROUP_RETENTION_START_MS) + GROUP_RETENTION_MS;
}

/** deleted_at ล่าสุดที่ "ถึงกำหนดลบถาวรแล้ว" ณ now — ใช้ใน WHERE (deleted_at <= ค่านี้) · null = ยังไม่มีกลุ่มไหนถึงกำหนด (ก่อน START + 30 วัน) */
export function purgeDeletedAtCutoff(now: number): number | null {
  const cutoff = now - GROUP_RETENTION_MS;
  return GROUP_RETENTION_START_MS <= cutoff ? cutoff : null;
}

/** ยังอยู่ในช่วงกู้คืนได้ (ไม่รวมเงื่อนไข admin) */
export function withinRestoreWindow(deletedAt: number, now: number): boolean {
  return now < groupPurgeAt(deletedAt);
}
