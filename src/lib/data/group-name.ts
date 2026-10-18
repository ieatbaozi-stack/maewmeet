// ชื่อกลุ่ม 1–40 ตัวอักษร (R2_CONTRACT §3 ข้อ 1) — NFC + ตัดช่องว่างหัวท้าย + ยุบช่องว่างซ้ำ · นับเป็น code point (เหมือน display name ของ R1)
// ห้าม: ตัวควบคุม (Cc: \n \t NUL …), ตัวจัดรูป (Cf: bidi override/isolate/mark, zero-width space/joiner/non-joiner, word-joiner, BOM, soft hyphen, tag chars),
//       ตัวคั่นบรรทัด/ย่อหน้า (Zl/Zp), private-use/surrogate/unassigned (Co/Cs/Cn), ตัวเติมที่มองไม่เห็น (Hangul filler, Khmer inherent vowels, U+2800 braille blank, U+034F CGJ),
//       ช่องว่างที่ไม่ใช่ U+0020 (NBSP, en/em-space, ideographic space ฯลฯ — ช่องว่างปกติเท่านั้น และยุบที่ซ้ำเหลือตัวเดียว)
//       ชื่อที่ไม่มีตัวที่มองเห็นเลย (ต้องมีตัวอักษร/ตัวเลข/สัญลักษณ์/emoji/เครื่องหมายอย่างน้อย 1 ตัว) · เครื่องหมายผสม (combining mark) ที่ไม่มีตัวฐาน หรือซ้อนเกิน 3 ต่อตัวฐาน
// ยกเว้น: U+200D (ZWJ) อนุญาตเฉพาะที่อยู่ระหว่าง Extended_Pictographic สองตัว (🐈‍⬛ 👨‍👩‍👧 🏳️‍🌈) — ZWJ ที่เหลือยังห้าม
// เหตุผล: กันชื่อที่หน้าตาเหมือนกันแต่ต่างกัน, ชื่อ "ว่าง" ที่มองไม่เห็น และกันกลับทิศข้อความ (บทเรียน S10) — ชื่อกลุ่มแสดงให้คนทั้งกลุ่มเห็น
import { AppError } from '@/lib/shared/errors';
import { GROUP_LIMITS } from '@/lib/shared/limits';

const ZWJ = 0x200d;
const VS16 = 0xfe0f;
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Cn}\u115F\u1160\u17B4\u17B5\u3164\uFFA0\u2800\u034F]/u;
/** ช่องว่างทุกชนิด (Zs) — ที่ยอมให้มีในชื่อคือ U+0020 เท่านั้น */
const ANY_SPACE = /\p{Zs}/u;
const PICTO = /^\p{Extended_Pictographic}$/u;
const MODIFIER = /^\p{Emoji_Modifier}$/u;
const MARK = /^\p{M}$/u;
const VISIBLE = /^[\p{L}\p{N}\p{S}\p{P}]$/u;
export const MAX_MARKS_PER_BASE = 3;

export type GroupNameProblem = 'TOO_SHORT' | 'TOO_LONG' | 'INVALID';

const isPicto = (cp: string | undefined) => cp !== undefined && PICTO.test(cp);

/** ตำแหน่ง ZWJ ที่อยู่ระหว่าง emoji สองตัว (อนุญาตให้มี VS16 / skin tone คั่นก่อน ZWJ) · ZWJ อื่นไม่อยู่ในชุดนี้ จึงถูก FORBIDDEN จับ */
function joinerPositionsInEmoji(cps: string[]): Set<number> {
  const ok = new Set<number>();
  for (let i = 0; i < cps.length; i++) {
    if (cps[i]!.codePointAt(0) !== ZWJ) continue;
    let j = i - 1;
    while (j >= 0 && (cps[j]!.codePointAt(0) === VS16 || MODIFIER.test(cps[j]!))) j--;
    if (isPicto(cps[j]) && isPicto(cps[i + 1])) ok.add(i);
  }
  return ok;
}

export function checkGroupName(raw: string): { ok: true; name: string } | { ok: false; reason: GroupNameProblem } {
  const trimmed = raw.normalize('NFC').trim();
  const cps = [...trimmed];
  const joiners = joinerPositionsInEmoji(cps);
  if (cps.some((c, i) => !joiners.has(i) && FORBIDDEN.test(c))) return { ok: false, reason: 'INVALID' };
  if (cps.some((c) => c !== ' ' && ANY_SPACE.test(c))) return { ok: false, reason: 'INVALID' };

  // ยุบช่องว่างซ้ำ แล้วตรวจเครื่องหมายผสม: ต้องมีตัวฐาน (ไม่ใช่ต้นชื่อ/หลังช่องว่าง) และซ้อนไม่เกิน MAX_MARKS_PER_BASE
  const out: string[] = [];
  let marks = 0;
  let visible = false;
  for (const c of cps) {
    if (c === ' ') {
      if (out[out.length - 1] === ' ') continue;
      marks = 0;
    } else if (MARK.test(c)) {
      const prev = out[out.length - 1];
      if (prev === undefined || prev === ' ' || ++marks > MAX_MARKS_PER_BASE) return { ok: false, reason: 'INVALID' };
    } else {
      marks = 0;
      if (VISIBLE.test(c) || isPicto(c)) visible = true;
    }
    out.push(c);
  }
  const len = out.length;
  if (len < GROUP_LIMITS.nameMin) return { ok: false, reason: 'TOO_SHORT' };
  if (!visible) return { ok: false, reason: 'INVALID' };
  if (len > GROUP_LIMITS.nameMax) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, name: out.join('') };
}

/** ชื่อที่ผ่านกติกา หรือโยน VALIDATION { fields: { name: reason } } */
export function parseGroupName(raw: string): string {
  const r = checkGroupName(raw);
  if (!r.ok) throw new AppError('VALIDATION', { fields: { name: r.reason } });
  return r.name;
}
