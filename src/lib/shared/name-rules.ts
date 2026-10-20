// กติกาตัวอักษรของ "ชื่อที่ผู้ใช้ตั้งเองและคนอื่นเห็น" — ชื่อกลุ่ม (R2_CONTRACT §3 ข้อ 1) และ displayName (สมัคร) ใช้ตัวตรวจเดียวกันนี้
// ห้าม: ตัวควบคุม (Cc), ตัวจัดรูป (Cf: bidi override/isolate/mark, zero-width space/joiner/non-joiner, word-joiner, BOM, soft hyphen, tag chars),
//       ตัวคั่นบรรทัด/ย่อหน้า (Zl/Zp), private-use/surrogate/unassigned (Co/Cs/Cn), ตัวเติมที่มองไม่เห็น (Hangul filler, Khmer inherent vowels, U+2800, U+034F CGJ),
//       ช่องว่างที่ไม่ใช่ U+0020 · ชื่อที่ไม่มีตัวที่มองเห็นเลย · เครื่องหมายผสมที่ไม่มีตัวฐาน หรือซ้อนเกิน 3 ต่อตัวฐาน
// ยกเว้น: U+200D (ZWJ) อนุญาตเฉพาะระหว่าง Extended_Pictographic สองตัว (🐈‍⬛ 👨‍👩‍👧 🏳️‍🌈)
// เหตุผล: กันชื่อหน้าตาเหมือนกัน, ชื่อ "ว่าง" ที่มองไม่เห็น และกันกลับทิศข้อความ (บทเรียน S10)
// นับความยาวเป็น code point หลัง NFC + ตัดหัวท้าย + ยุบช่องว่างซ้ำ

const ZWJ = 0x200d;
const VS16 = 0xfe0f;
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Cn}ᅟᅠ឴឵ㅤﾠ⠀͏]/u;
/** ช่องว่างทุกชนิด (Zs) — ที่ยอมให้มีในชื่อคือ U+0020 เท่านั้น */
const ANY_SPACE = /\p{Zs}/u;
const PICTO = /^\p{Extended_Pictographic}$/u;
const MODIFIER = /^\p{Emoji_Modifier}$/u;
const MARK = /^\p{M}$/u;
const VISIBLE = /^[\p{L}\p{N}\p{S}\p{P}]$/u;
export const MAX_MARKS_PER_BASE = 3;

export type NameProblem = 'TOO_SHORT' | 'TOO_LONG' | 'INVALID';

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

export function checkVisibleName(
  raw: string,
  limits: { min: number; max: number },
): { ok: true; name: string } | { ok: false; reason: NameProblem } {
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
  if (len < limits.min) return { ok: false, reason: 'TOO_SHORT' };
  if (!visible) return { ok: false, reason: 'INVALID' };
  if (len > limits.max) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, name: out.join('') };
}

/**
 * ทำความสะอาดชื่อ "ตอนอ่าน" สำหรับแถวเก่าที่เข้ามาก่อนมีกติกา: ตัดตัวที่กติกาปฏิเสธออก (ไม่โยน ไม่แก้ DB)
 * ตัวควบคุม/จัดรูป/ที่มองไม่เห็นถูกลบ · ช่องว่างพิเศษกลายเป็นช่องว่างปกติ · ZWJ ใน emoji คงไว้ · เครื่องหมายผสมเกินถูกตัด
 * ไม่ตัดความยาว (ความยาวไม่ใช่ความเสี่ยงด้านการแสดงผล) · ถ้าเหลือว่าง คืนสตริงว่าง
 */
export function sanitizeDisplayText(raw: string): string {
  const cps = [...raw.normalize('NFC')];
  const joiners = joinerPositionsInEmoji(cps);
  const out: string[] = [];
  let marks = 0;
  cps.forEach((c, i) => {
    if (joiners.has(i)) return void (marks = 0, out.push(c));
    if (FORBIDDEN.test(c)) return;
    if (ANY_SPACE.test(c)) c = ' ';
    if (c === ' ') {
      if (out.length === 0 || out[out.length - 1] === ' ') return;
      marks = 0;
    } else if (MARK.test(c)) {
      const prev = out[out.length - 1];
      if (prev === undefined || prev === ' ' || ++marks > MAX_MARKS_PER_BASE) return;
    } else {
      marks = 0;
    }
    out.push(c);
  });
  if (out[out.length - 1] === ' ') out.pop();
  return out.join('');
}
