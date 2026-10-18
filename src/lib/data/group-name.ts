// ชื่อกลุ่ม 1–40 ตัวอักษร (R2_CONTRACT §3 ข้อ 1) — NFC + ตัดช่องว่างหัวท้าย · นับเป็น code point (เหมือน display name ของ R1)
// ห้าม: ตัวควบคุม (Cc: \n \t NUL …), ตัวจัดรูป (Cf: bidi override/isolate/mark, zero-width space/joiner/non-joiner, word-joiner, BOM, soft hyphen),
//       ตัวคั่นบรรทัด/ย่อหน้า (Zl/Zp), private-use/surrogate/unassigned (Co/Cs/Cn), ตัวเติมที่มองไม่เห็น (Hangul filler, Khmer inherent vowels)
// เหตุผล: กันชื่อที่หน้าตาเหมือนกันแต่ต่างกัน และกันกลับทิศข้อความ (บทเรียน S10) — ชื่อกลุ่มแสดงให้คนทั้งกลุ่มเห็น
import { AppError } from '@/lib/shared/errors';
import { GROUP_LIMITS } from '@/lib/shared/limits';

const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Cn}ᅟᅠ឴឵ㅤﾠ]/u;

export type GroupNameProblem = 'TOO_SHORT' | 'TOO_LONG' | 'INVALID';

export function checkGroupName(raw: string): { ok: true; name: string } | { ok: false; reason: GroupNameProblem } {
  const name = raw.normalize('NFC').trim();
  if (FORBIDDEN.test(name)) return { ok: false, reason: 'INVALID' };
  const len = [...name].length;
  if (len < GROUP_LIMITS.nameMin) return { ok: false, reason: 'TOO_SHORT' };
  if (len > GROUP_LIMITS.nameMax) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, name };
}

/** ชื่อที่ผ่านกติกา หรือโยน VALIDATION { fields: { name: reason } } */
export function parseGroupName(raw: string): string {
  const r = checkGroupName(raw);
  if (!r.ok) throw new AppError('VALIDATION', { fields: { name: r.reason } });
  return r.name;
}
