// ชื่อกลุ่ม 1–40 ตัวอักษร (R2_CONTRACT §3 ข้อ 1) — NFC + ตัดช่องว่างหัวท้าย + ยุบช่องว่างซ้ำ · นับเป็น code point (เหมือน display name ของ R1)
// ห้าม: ตัวควบคุม (Cc: \n \t NUL …), ตัวจัดรูป (Cf: bidi override/isolate/mark, zero-width space/joiner/non-joiner, word-joiner, BOM, soft hyphen, tag chars),
//       ตัวคั่นบรรทัด/ย่อหน้า (Zl/Zp), private-use/surrogate/unassigned (Co/Cs/Cn), ตัวเติมที่มองไม่เห็น (Hangul filler, Khmer inherent vowels, U+2800 braille blank, U+034F CGJ),
//       ช่องว่างที่ไม่ใช่ U+0020 (NBSP, en/em-space, ideographic space ฯลฯ — ช่องว่างปกติเท่านั้น และยุบที่ซ้ำเหลือตัวเดียว)
//       ชื่อที่ไม่มีตัวที่มองเห็นเลย (ต้องมีตัวอักษร/ตัวเลข/สัญลักษณ์/emoji/เครื่องหมายอย่างน้อย 1 ตัว) · เครื่องหมายผสม (combining mark) ที่ไม่มีตัวฐาน หรือซ้อนเกิน 3 ต่อตัวฐาน
// ยกเว้น: U+200D (ZWJ) อนุญาตเฉพาะที่อยู่ระหว่าง Extended_Pictographic สองตัว (🐈‍⬛ 👨‍👩‍👧 🏳️‍🌈) — ZWJ ที่เหลือยังห้าม
// เหตุผล: กันชื่อที่หน้าตาเหมือนกันแต่ต่างกัน, ชื่อ "ว่าง" ที่มองไม่เห็น และกันกลับทิศข้อความ (บทเรียน S10) — ชื่อกลุ่มแสดงให้คนทั้งกลุ่มเห็น
import { AppError } from '@/lib/shared/errors';
import { GROUP_LIMITS } from '@/lib/shared/limits';
import { checkVisibleName, MAX_MARKS_PER_BASE, type NameProblem } from '@/lib/shared/name-rules';

// ตัวตรวจอยู่ที่ src/lib/shared/name-rules.ts (ใช้ร่วมกับ displayName)
export { MAX_MARKS_PER_BASE };
export type GroupNameProblem = NameProblem;

export function checkGroupName(raw: string): { ok: true; name: string } | { ok: false; reason: GroupNameProblem } {
  return checkVisibleName(raw, { min: GROUP_LIMITS.nameMin, max: GROUP_LIMITS.nameMax });
}

/** ชื่อที่ผ่านกติกา หรือโยน VALIDATION { fields: { name: reason } } */
export function parseGroupName(raw: string): string {
  const r = checkGroupName(raw);
  if (!r.ok) throw new AppError('VALIDATION', { fields: { name: r.reason } });
  return r.name;
}
