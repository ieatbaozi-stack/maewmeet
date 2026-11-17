// ลบโฟลเดอร์ชั่วคราวของเทสต์ — ถาวรแทน shim ข้าม EPERM (R15b §4)
// - ลองซ้ำพร้อม backoff (Node: maxRetries/retryDelay ครอบ EPERM/EBUSY/ENOTEMPTY...) เพราะ Windows ปล่อย handle ของ libSQL/ไฟล์ช้า
// - เฉพาะ win32: ถ้ายังลบไม่ได้ด้วย EPERM/EBUSY หลังลองซ้ำ → กลืน + log ครั้งเดียว (เศษใน %TEMP% ไม่ใช่ความล้มเหลวของเทสต์)
// - ระบบอื่น (CI Linux) และ error อื่นทุกชนิด → throw ตามเดิม ไม่ซ่อนปัญหาจริง
import { rmSync } from 'node:fs';

const RETRIES = 3;
const RETRY_DELAY_MS = 50; // Node คูณตามครั้งที่ลอง (linear backoff) → รวมสูงสุด ~0.3 วินาที: ไฟล์ที่ยังล็อกนานกว่านี้ไม่หายเอง (ถ้าหน่วงนานจะทำเทสต์เกิน 5 วินาที)
let warned = false;

export function removeTempDir(dir: string, platform: NodeJS.Platform = process.platform, remove: typeof rmSync = rmSync): void {
  try {
    remove(dir, { recursive: true, force: true, maxRetries: RETRIES, retryDelay: RETRY_DELAY_MS });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    if (platform === 'win32' && (code === 'EPERM' || code === 'EBUSY')) {
      if (!warned) {
        warned = true;
        console.warn(`[tests] Windows: ลบโฟลเดอร์ชั่วคราวไม่ได้ (${code}) หลังลองซ้ำ ${RETRIES} ครั้ง — ข้าม (เศษไฟล์ใน temp, log ครั้งเดียว): ${dir}`);
      }
      return;
    }
    throw e;
  }
}

/** ใช้เฉพาะเทสต์ของตัวช่วยนี้ */
export function _resetRemoveTempDirWarning(): void {
  warned = false;
}
