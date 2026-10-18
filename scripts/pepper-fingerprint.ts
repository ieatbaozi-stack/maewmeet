/**
 * scripts/pepper-fingerprint.ts — ซ้อมกู้คืน pepper (เจ้าของ: OPS #10 · ADR 0002 §7.2, §7.4 · docs/OPERATIONS.md C8)
 *
 *   Get-Clipboard | npx tsx scripts/pepper-fingerprint.ts        (PowerShell)
 *   pbpaste | npx tsx scripts/pepper-fingerprint.ts              (macOS/Linux)
 *
 * อ่านค่า pepper จาก **stdin เท่านั้น** (ห้ามเป็น argument — ค้างใน history ของ shell / รายการ process)
 * แล้วพิมพ์ fingerprint **8 ตัวแรก** บรรทัดเดียวทาง stdout เพื่อเทียบกับหน้า super admin
 *
 * - fingerprint คำนวณด้วย `pepperFingerprint` ของแอป (src/lib/auth/pepper.ts) — ไม่เขียนสูตรซ้ำ
 * - ความถูกต้องของค่า (base64, ถอดแล้ว >= 32 ไบต์) ใช้ตัวตรวจเดียวกับที่แอปใช้ตอนเริ่ม (readPepperEnv)
 * - ไม่สร้าง/สุ่ม pepper ที่ใดทั้งสิ้น (ADR 0002 §7.1) · ไม่พิมพ์ค่า pepper หรือ fingerprint เต็มทาง stdout/stderr
 *
 * exit code: 0 = พิมพ์ fingerprint แล้ว · 2 = ใช้ผิดวิธี (argument / ไม่มี stdin / stdin ว่าง) · 4 = ค่าผิดรูป · 1 = อ่าน stdin ไม่ได้
 */
import { pathToFileURL } from 'node:url';
import { fingerprintPrefix, pepperFingerprint } from '../src/lib/auth/pepper';
import { readPepperEnv } from '../src/lib/shared/env';

export type FingerprintResult = { code: 0 | 2 | 4; stdout: string; stderr: string };

/**
 * ฟังก์ชันล้วน (เทสต์ได้) — รับข้อความดิบจาก stdin คืนผล · ไม่ echo ค่าที่รับเข้ามาในข้อความใด ๆ
 * ช่องว่าง/ขึ้นบรรทัดที่หัวท้ายถูกตัด (Get-Clipboard ต่อท้ายด้วยขึ้นบรรทัดเสมอ)
 */
export function fingerprintOfInput(raw: string): FingerprintResult {
  const value = raw.trim();
  if (value.length === 0) return { code: 2, stdout: '', stderr: 'ไม่ได้รับค่าจาก stdin\n' };
  // ใช้ตัวอ่าน env ของแอปตัวเดียวกัน → เกณฑ์เดียวกับตอน deploy (base64 ถอดได้ >= 32 ไบต์)
  const parsed = readPepperEnv({ PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: value });
  const secret = parsed.ok ? parsed.versions.get(1) : undefined;
  if (!secret) {
    return { code: 4, stderr: 'ค่าที่ได้รับผิดรูปแบบ: ต้องเป็น base64 ที่ถอดแล้วได้อย่างน้อย 32 ไบต์ (ไม่ใช่ pepper?)\n', stdout: '' };
  }
  return { code: 0, stdout: `${fingerprintPrefix(pepperFingerprint(secret))}\n`, stderr: '' };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** จุดเข้า: คืน exit code · argv = process.argv.slice(2) */
export async function main(argv: readonly string[], isTTY: boolean, read: () => Promise<string> = readStdin): Promise<number> {
  if (argv.length > 0) {
    // ไม่พิมพ์ argument กลับ (อาจเป็น pepper ที่พิมพ์ผิดวิธี)
    console.error('สคริปต์นี้รับ pepper ทาง stdin เท่านั้น — ห้ามส่งเป็น argument (ค่าจะค้างในประวัติคำสั่ง)');
    console.error('ตัวอย่าง: Get-Clipboard | npx tsx scripts/pepper-fingerprint.ts');
    return 2;
  }
  if (isTTY) {
    console.error('ส่ง pepper ทาง stdin เช่น: Get-Clipboard | npx tsx scripts/pepper-fingerprint.ts');
    return 2;
  }
  const result = fingerprintOfInput(await read());
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.code;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main(process.argv.slice(2), Boolean(process.stdin.isTTY)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      // ไม่พิมพ์รายละเอียด error — อาจมีค่าจาก stdin ปนอยู่
      console.error('ผิดพลาดระหว่างอ่าน stdin');
      process.exitCode = 1;
    },
  );
}
