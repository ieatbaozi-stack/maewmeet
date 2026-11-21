// R18 §S3 (ADR 0016 §3): ที่หมายหลังเข้าสู่ระบบ/สมัคร — allowlist แบบตรงรูปเท่านั้น (กัน open redirect)
// ยอมรับเฉพาะหน้าลิงก์ชวน `/i/<token 22 ตัว [A-Za-z0-9_-]>` · อย่างอื่นทั้งหมด (//x, /\x, https:, %2F, ช่องว่าง, path อื่นในแอป, ไม่ใช่สตริง) → '/'
// ไม่ decode / ไม่ normalize ก่อนเทียบ — รูปที่ผ่านต้องเป็นตัวอักษรชุดนี้ล้วนจึงไม่มีทางเป็น path อื่นหลัง decode

export const SAFE_NEXT_FALLBACK = '/';

const SHARE_PATH = /^\/i\/[A-Za-z0-9_-]{22}$/;

/** ค่า `next` จาก query (string | string[] | undefined) → path ภายในที่ปลอดภัย */
export function safeNext(raw: unknown): string {
  return typeof raw === 'string' && SHARE_PATH.test(raw) ? raw : SAFE_NEXT_FALLBACK;
}
