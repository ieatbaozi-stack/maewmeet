#!/usr/bin/env node
// คำนวณ WCAG 2.x contrast ratio ของทุกคู่ข้อความ/พื้นที่ใช้จริง จาก src/styles/tokens.css ทั้งสองธีม
// ใช้: node docs/design/tools/contrast.mjs [--md]   (ไม่มี dependency)
// exit code 1 ถ้ามีคู่ใดต่ำกว่าเกณฑ์ หรือบล็อกมืด 2 ชุด (data-theme / prefers-color-scheme) ไม่ตรงกัน
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const css = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selectorRe) {
  const m = css.match(selectorRe);
  if (!m) throw new Error('ไม่พบบล็อก ' + selectorRe);
  const start = m.index + m[0].length;
  let depth = 1, i = start;
  while (depth && i < css.length) { if (css[i] === '{') depth++; if (css[i] === '}') depth--; i++; }
  const vars = {};
  for (const d of css.slice(start, i - 1).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  return vars;
}
const light = block(/(^|\n):root\s*\{/);
const darkAttr = block(/\n:root\[data-theme="dark"\]\s*\{/);
// ธีม system บนเครื่องที่ตั้งมืด (ADR 0008 §4 / LEAD_DECISIONS Q10)
const darkMedia = block(/:root\[data-theme="system"\],\s*:root:not\(\[data-theme\]\)\s*\{/);
if (!/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\[data-theme="system"\]/.test(css)) throw new Error('บล็อก system ต้องอยู่ใน @media (prefers-color-scheme: dark)');

const mismatch = Object.keys({ ...darkAttr, ...darkMedia }).filter((k) => darkAttr[k] !== darkMedia[k]);
const dark = { ...light, ...darkAttr };
const missingDark = Object.keys(light).filter((k) => /^#/.test(light[k]) && !(k in darkAttr));

function resolveVar(theme, v) {
  let val = theme[v]; let guard = 0;
  while (val && /^var\(/.test(val) && guard++ < 5) val = theme[val.slice(4, -1).trim()];
  return val;
}
function lum(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [ข้อความ/ส่วนหน้า, พื้น, ใช้ที่ไหน, เกณฑ์]
const T = 4.5, UI = 3;
const pairs = [
  ['--ink', '--bg', 'ข้อความหลักบนพื้นหน้า', T],
  ['--ink', '--surface', 'ข้อความหลักบนการ์ด/sheet', T],
  ['--ink', '--surface-2', 'ข้อความบนพื้นยุบ (segmented, ช่องค้นหา)', T],
  ['--ink-muted', '--bg', 'ข้อความรองบนพื้นหน้า', T],
  ['--ink-muted', '--surface', 'ข้อความรองบนการ์ด/sheet', T],
  ['--ink-muted', '--surface-2', 'ข้อความรองบนพื้นยุบ / วันที่ผ่านไปแล้ว', T],
  ['--free-ink', '--free', 'ชิป "ว่าง"', T],
  ['--free-ink', '--surface', 'ข้อความ "ว่างทั้งวัน" ใน sheet', T],
  ['--busy-ink', '--busy', 'ชิป "ไม่ว่าง"', T],
  ['--busy-ink', '--surface', 'ข้อความ "ติด 09:00–13:00" ใน sheet', T],
  ['--event-ink', '--event', 'ชิปนัดในปฏิทิน/การ์ด', T],
  ['--warn-ink', '--warn', 'แถบเตือน "นัดทับเวลาไม่ว่าง"', T],
  ['--on-danger', '--danger', 'ปุ่มลบ/ยกเลิกนัด', T],
  // R4B — นัด/RSVP/แจ้งเตือน
  ['--warn-ink', '--surface', 'R4B: ข้อความเตือนนัดทับบนการ์ดย่อย (.ov)', T],
  ['--free-ink', '--free', 'R4B: ปุ่ม RSVP "ไป" ที่เลือก', T],
  ['--warn-ink', '--warn', 'R4B: ปุ่ม RSVP "อาจไป" ที่เลือก / pill คุณอาจไป', T],
  ['--busy-ink', '--busy', 'R4B: ปุ่ม RSVP "ไม่ไป" / แท็กยกเลิกแล้ว', T],
  ['--on-danger', '--danger', 'R4B: ตัวเลขกระดิ่งแจ้งเตือน', T],
  ['--accent-soft-ink', '--accent-soft', 'R4B: แถวแจ้งเตือนที่ยังไม่อ่าน', T],
  ['--ink', '--accent-soft', 'R4B: ข้อความแจ้งเตือนที่ยังไม่อ่าน', T],
  ['--ink-muted', '--accent-soft', 'R4B: เวลาในแถวแจ้งเตือนที่ยังไม่อ่าน', T],
  ['--accent-ink', '--surface', 'R4B: ลิงก์ © OpenStreetMap ใต้แผนที่', T],
  ['--danger-ink', '--danger-soft', 'กล่องข้อผิดพลาด', T],
  ['--danger-ink', '--surface', 'ข้อความผิดพลาดใต้ช่องกรอก', T],
  ['--on-accent', '--accent', 'ปุ่มหลัก', T],
  ['--accent-ink', '--bg', 'ลิงก์/ปุ่มรองบนพื้นหน้า', T],
  ['--accent-ink', '--surface', 'ลิงก์/ปุ่มรอง/แท็บที่เลือกบน sheet/nav', T],
  ['--accent-soft-ink', '--accent-soft', 'ตัวเลือกที่ถูกเลือก (RSVP, วันที่เลือก)', T],
  ['--ink', '--avail-none', 'เลขวัน + "x/y" ในช่องว่าง < 50%', T],
  ['--ink', '--avail-low', 'เลขวัน + "x/y" ในช่องว่าง 50–74%', T],
  ['--ink', '--avail-mid', 'เลขวัน + "x/y" ในช่องว่าง 75–99%', T],
  ['--ink', '--avail-full', 'เลขวัน + "x/y" ในช่องว่างครบ', T],
  ['--free-ink', '--avail-full', 'ไอคอนถูกในช่องว่างครบ', T],
  ['--ink-muted', '--avail-none', 'ตัวเลขรองในช่องว่างน้อย', T],
  ...Array.from({ length: 10 }, (_, i) => ['--member-ink', `--member-${i + 1}`, `ตัวอักษรย่อบนสีสมาชิก ${i + 1}`, T]),
  // เส้น/จุด/แถบสีประจำสมาชิก (--member-mark-N) บนพื้นทึบ — WCAG 1.4.11 (พื้นอวาตาร์ --member-N ล้อมด้วยเส้น --line-control ซึ่งตรวจแล้วข้างล่าง)
  ...Array.from({ length: 10 }, (_, i) => ['--member-mark-' + (i + 1), '--surface', `จุด/เส้นสมาชิก ${i + 1} บนการ์ด/sheet`, UI]),
  ...Array.from({ length: 10 }, (_, i) => ['--member-mark-' + (i + 1), '--bg', `จุด/เส้นสมาชิก ${i + 1} บนพื้นหน้า`, UI]),
  // R3 ปฏิทินกลุ่ม/ฟอร์ม busy: จุดสมาชิกในช่องวัน (พื้น --surface), แถบสมาชิกบนรางแถบเวลา (--surface-2), จุดในช่องวันที่เลือก (--accent-soft)
  ...Array.from({ length: 10 }, (_, i) => ['--member-mark-' + (i + 1), '--surface-2', `แถบเวลาสมาชิก ${i + 1} บนรางแถบเวลา (.cal-track)`, UI]),
  ...Array.from({ length: 10 }, (_, i) => ['--member-mark-' + (i + 1), '--accent-soft', `จุดสมาชิก ${i + 1} ในช่องวันที่เลือก (iPad)`, UI]),
  ['--ink', '--accent-soft', '"+N" ในช่องวันที่เลือก (iPad)', T],
  ['--ink-muted', '--accent-soft', 'ข้อความรองบนพื้นเลือก (เผื่อ)', T],
  ['--ink', '--accent-soft', 'กรอบ "วันนี้" ซ้อนบนช่องวันที่เลือก', UI],
  ['--accent', '--accent-soft', 'วงใน "เลือกอยู่" ของช่องวัน', UI],
  ['--ink', '--surface', 'กรอบ "วันนี้" ของช่องวัน/ตัวเลือกวัน', UI],
  ['--on-accent', '--accent', 'วันเริ่ม/วันจบในตัวเลือกวัน', T],
  ['--accent-soft-ink', '--accent-soft', 'ช่วงวันที่เลือก + ป้าย "เห็นคนเดียว" + กล่องประกาศครั้งแรก', T],
  ['--busy-ink', '--surface', 'เวลาไม่ว่างในรายการ "ใครไม่ว่างเมื่อไร"', T],
  ['--ink-muted', '--surface', '"ไม่ว่าง" ของรายการที่ซ่อนรายละเอียด + ป้ายแกนเวลา', T],
  ['--ink', '--surface-2', 'ตัวเลขเวลาในช่องเลือกเวลา/ป้าย tag-muted', T],
  ['--ink-muted', '--surface-2', 'ตัวเลขวันนอกเดือนในตัวเลือกวัน/ข้อความรองบนราง', T],
  ['--on-accent', '--accent', 'สวิตช์เปิด: ปุ่มกลมบนราง', UI],
  ['--ink-muted', '--surface-2', 'สวิตช์ปิด: ปุ่มกลมบนราง', UI],
  ['--line-control', '--surface-2', 'ขอบราง/ขอบสวิตช์ปิดบนพื้นยุบ', UI],
  // R4A วันที่ว่างตรงกัน: กรอบ/วงกลม "ว่างร่วม" (--free-ink) ต้องแยกจากพื้นข้างเคียงและพื้นช่อง (WCAG 1.4.11) · วงเลือกวัน --accent บนพื้นช่อง
  ['--free-ink', '--bg', 'กรอบทึบ "ว่างร่วม" / กรอบเส้นประ "ว่างครบไม่ตรง" เทียบพื้นหน้า (ช่องวันนอกเดือนบนพื้นโปร่ง)', UI],
  ['--free-ink', '--avail-full', 'กรอบทึบ "ว่างร่วม" เทียบพื้นช่อง (วงกลมเครื่องหมายถูกใช้คู่เดียวกันเป็นข้อความ 4.5 ด้านบน)', UI],
  ['--free-ink', '--avail-mid', 'กรอบเส้นประ "ว่างครบแต่ไม่ตรงช่วง" เทียบพื้นช่อง', UI],
  ['--free-ink', '--surface', 'กรอบเส้นประของกล่องสถานะ + ตัวอย่างช่องในคำอธิบาย', UI],
  ['--free-ink', '--avail-full', 'เครื่องหมายถูกในวงกลมทึบ "ว่างร่วม" (ตัวเลขไม่ต้องใช้ — ใช้ไอคอน)', T],
  ['--accent', '--avail-full', 'วงเลือกวันรอบช่อง "ว่างร่วม"', UI],
  ['--accent', '--avail-mid', 'วงเลือกวันรอบช่อง n/n', UI],
  ['--accent', '--busy', 'วงเลือกวันรอบช่อง "ทั้งวันไม่ว่าง"', UI],
  ['--free-ink', '--free', 'การ์ดสรุป "วันที่ว่างตรงกันเร็วที่สุด" + แถวช่วงว่างร่วม + กล่องสถานะ "ว่างร่วม"', T],
  ['--ink', '--surface', 'ชื่อ/ข้อความในการ์ดสรุปกรณีไม่มีวันว่างร่วม + ปุ่ม "สร้างนัด" ป้าย "เร็วๆ นี้"', T],
  ['--ink', '--busy', 'ข้อความกล่องสถานะ (สำรอง)', T],
  ['--busy-ink', '--busy', 'กล่องสถานะ "ทั้งวันไม่ว่าง" + ตัวเลข 0/Y', T],
  ['--ink-muted', '--surface-2', 'ปุ่ม "สร้างนัด" ที่ยังไม่เปิด (aria-disabled) + ช่องวันที่ผ่านไปแล้ว', T],
  ['--ink-muted', '--surface', 'ข้อความอธิบายผล/ช่วงเวลาที่นับ/คำใบ้ใต้ปุ่ม', T],
  // ส่วนที่ไม่ใช่ข้อความ (WCAG 1.4.11)
  ['--line-control', '--surface', 'ขอบช่องกรอก/สวิตช์บน sheet', UI],
  ['--line-control', '--bg', 'ขอบช่องกรอกบนพื้นหน้า', UI],
  ['--focus', '--bg', 'วงโฟกัสบนพื้นหน้า', UI],
  ['--focus', '--surface', 'วงโฟกัสบน sheet', UI],
  ['--accent', '--surface', 'ขอบเขตปุ่มหลักบน sheet', UI],
  ['--accent', '--bg', 'ขอบเขตปุ่มหลักบนพื้นหน้า', UI],
  ['--cat-line', '--bg', 'เส้นแมวบนพื้นหน้า', UI],
];

let fails = 0;
const rows = [];
// ---------- Aurora: ข้อความ/ส่วนควบคุมที่วางบน aurora หรือบนพื้นกึ่งทึบ (veil) เหนือ aurora ----------
// กรณีแย่สุด = พิจารณาทุกชุดย่อยของก้อนแสง 4 ก้อนที่ซ้อนกันตรงจุดกลาง (alpha เต็มของ token × ความเข้มของหน้า)
// บนพื้น --bg แล้วเลือกพื้นที่ให้คอนทราสต์ต่ำที่สุดต่อสีตัวอักษรนั้น · veil คำนวณทั้งแบบมีและไม่มี --scrim คั่น
function rgba(str) {
  if (/^#/.test(str)) { const h = str.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1); }
  const m = str.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
const over = (top, a, base) => [0, 1, 2].map((i) => top[i] * a + base[i] * (1 - a));
const toHex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
// noise กัน banding (A5): เทากลาง 50% ทับบนก้อนแสง ความทึบสูงสุด = --aurora-noise-opacity × ความเข้มของหน้า → คิดทั้งแบบมีและไม่มี
const GRAY = [128, 128, 128];
function auroraCandidates(theme, strength) {
  const base = rgba(resolveVar(theme, '--bg'));
  const blobs = [1, 2, 3, 4].map((i) => rgba(resolveVar(theme, `--aurora-${i}`)));
  const noise = parseFloat(resolveVar(theme, '--aurora-noise-opacity')) * strength;
  const out = [];
  for (let mask = 0; mask < 16; mask++) {
    let c = base.slice(0, 3);
    blobs.forEach((b, i) => { if (mask & (1 << i)) c = over(b, b[3] * strength, c); });
    out.push(c, over(GRAY, noise, c));
  }
  return out;
}
function worst(theme, fgVar, cands) {
  const fg = resolveVar(theme, fgVar);
  let best = null;
  for (const c of cands) { const r = ratio(fg, toHex(c)); if (!best || r < best.r) best = { r, bg: toHex(c) }; }
  return { fg, ...best };
}
const auroraPairs = [
  // [ส่วนหน้า, ชั้น, เกณฑ์, ใช้ที่]
  ['--ink', 'hero', T, 'ข้อความบน aurora เข้มโดยตรง: ชื่อแอป, หัวข้อหน้า, ปุ่มภาษา TH|EN (อนุญาตเฉพาะ --ink)'],
  ['--ink', 'soft', T, 'หัวข้อ/ชื่อกลุ่ม/ชื่อเดือนบน aurora จาง (ปฏิทิน, ฟอร์ม)'],
  ['--ink-muted', 'soft', T, 'ชื่อวัน, วันที่ผ่านไป, คำอธิบายสัญลักษณ์บน aurora จาง'],
  ['--accent-ink', 'soft', T, 'ลิงก์บน aurora จาง'],
  ['--ink', 'veil', T, 'ข้อความหลักบน sheet/แถบล่าง/การ์ดเข้าสู่ระบบ (veil เหนือ aurora เข้ม ± scrim)'],
  ['--ink-muted', 'veil', T, 'ข้อความรองบน veil'],
  ['--accent-ink', 'veil', T, 'แท็บที่เลือก/ลิงก์บน veil'],
  ['--free-ink', 'veil', T, '"ว่างครบ 6 จาก 6 คน" บน sheet'],
  ['--busy-ink', 'veil', T, 'ช่วงเวลาที่ติดบน sheet'],
  ['--danger-ink', 'veil', T, 'ข้อความผิดพลาดบนการ์ดเข้าสู่ระบบ'],
  ['--line-control', 'veil', UI, 'ขอบช่องกรอก/ปุ่มแป้น PIN บน veil'],
  ['--focus', 'veil', UI, 'วงโฟกัสบน veil'],
  ['--accent', 'veil', UI, 'ขอบเขตปุ่มหลักบน veil (ปุ่มหลักไม่วางบน aurora ตรงๆ)'],
  // สีประจำสมาชิกแบบเส้น/จุด บน veil และ aurora จาง (ไม่ใช่ข้อความ → 3:1)
  ...Array.from({ length: 10 }, (_, i) => ['--member-mark-' + (i + 1), 'veil', UI, `จุด/เส้นสมาชิก ${i + 1} บน sheet/แถบล่าง (veil)`]),
  ...Array.from({ length: 10 }, (_, i) => ['--member-mark-' + (i + 1), 'soft', UI, `จุด/เส้นสมาชิก ${i + 1} บน aurora จาง (ปฏิทิน)`]),
  ['--ink-muted', 'nav', T, 'ป้ายแท็บที่ไม่ได้เลือกบนแถบล่าง (--surface-nav เหนือ aurora เข้ม/การ์ดที่เลื่อนผ่าน)'],
  ['--accent-ink', 'nav', T, 'แท็บที่เลือกบนแถบล่าง'],
];
for (const [themeName, theme] of [['light', light], ['dark', dark]]) {
  const hero = auroraCandidates(theme, parseFloat(resolveVar(theme, '--aurora-hero')));
  const soft = auroraCandidates(theme, parseFloat(resolveVar(theme, '--aurora-soft')));
  const veil = rgba(resolveVar(theme, '--surface-veil'));
  const scrim = rgba(resolveVar(theme, '--scrim'));
  const veiled = hero.flatMap((c) => [over(veil, veil[3], c), over(veil, veil[3], over(scrim, scrim[3], c))]);
  // แถบล่าง: ด้านหลังเป็น aurora เข้ม หรือการ์ด/ข้อความที่เลื่อนผ่าน (--surface, --ink, --ink-muted, --event)
  const nav = rgba(resolveVar(theme, '--surface-nav'));
  const behindNav = [...hero, ...['--surface', '--ink', '--ink-muted', '--event', '--accent'].map((v) => rgba(resolveVar(theme, v)).slice(0, 3))];
  const navved = behindNav.map((c) => over(nav, nav[3], c));
  const layers = { hero, soft, veil: veiled, nav: navved };
  const label = { hero: 'aurora เข้ม (แย่สุด)', soft: 'aurora จาง (แย่สุด)', veil: 'veil เหนือ aurora (แย่สุด)', nav: 'แถบล่างเหนือเนื้อหา (แย่สุด)' };
  for (const [fg, layer, min, use] of auroraPairs) {
    const w = worst(theme, fg, layers[layer]);
    const ok = w.r >= min; if (!ok) fails++;
    rows.push({ themeName, fg, a: w.fg, bg: label[layer], b: w.bg, r: w.r, min, ok, use });
  }
}

// แถบล่าง (A4): ข้อความที่เลื่อนผ่านด้านหลังต้องจางจนอ่านไม่ออก — คอนทราสต์ของ --ink ที่ทะลุ (แย่สุด) เทียบพื้นแถบ ต้อง < 1.15:1
let navBleedFail = [];
for (const [themeName, theme] of [['light', light], ['dark', dark]]) {
  const nav = rgba(resolveVar(theme, '--surface-nav'));
  const surf = rgba(resolveVar(theme, '--surface')).slice(0, 3);
  const ink = rgba(resolveVar(theme, '--ink')).slice(0, 3);
  const r = ratio(toHex(over(nav, nav[3], ink)), toHex(over(nav, nav[3], surf)));
  console.log(`แถบล่าง ${themeName}: ข้อความ --ink ที่ทะลุ vs พื้นการ์ดใต้แถบ = ${r.toFixed(3)}:1 (ต้อง < 1.15)`);
  if (r >= 1.15) navBleedFail.push(themeName);
}
// <meta name="theme-color"> (src/styles/tokens.meta.ts) ต้องตรงกับ --bg ของแต่ละธีม
let metaFail = [];
try {
  const meta = readFileSync(resolve(root, 'src/styles/tokens.meta.ts'), 'utf8');
  for (const [k, theme] of [['light', light], ['dark', dark]]) {
    const v = (meta.match(new RegExp(`${k}:\\s*'(#[0-9A-Fa-f]{6})'`)) || [])[1];
    if (!v || v.toUpperCase() !== resolveVar(theme, '--bg').toUpperCase()) metaFail.push(`${k}=${v} ≠ ${resolveVar(theme, '--bg')}`);
  }
} catch { metaFail.push('ไม่พบ src/styles/tokens.meta.ts'); }
console.log(`theme-color ใน tokens.meta.ts ตรงกับ --bg: ${metaFail.length ? 'ไม่ตรง → ' + metaFail.join(', ') : 'ตรง'}`);
// R4A: ข้อความบนพื้นช่องที่มี "ลายเฉียง" (--hatch ทับพื้น) — ผสมจริงแล้วค่อยวัด (ลายเส้นบางจึงวัดกรณีแย่สุดที่เส้นเต็มความทึบ)
for (const [themeName, theme] of [['light', light], ['dark', dark]]) {
  const h = rgba(resolveVar(theme, '--hatch'));
  for (const [fg, base, use] of [
    ['--ink', '--avail-none', 'ตัวเลข "2/6" ในช่องว่างไม่ถึงครึ่ง (พื้น + ลายเฉียง)'],
    ['--busy-ink', '--busy', 'ตัวเลข "0/6" ในช่องทั้งวันไม่ว่าง (พื้น + ลายเฉียง)'],
  ]) {
    const bg = toHex(over(h, h[3], rgba(resolveVar(theme, base))));
    const a = resolveVar(theme, fg); const r = ratio(a, bg); const ok = r >= T; if (!ok) fails++;
    rows.push({ themeName, fg, a, bg: base + '+hatch', b: bg, r, min: T, ok, use });
  }
}
const md = process.argv.includes('--md');
for (const [themeName, theme] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, use, min] of pairs) {
    const a = resolveVar(theme, fg), b = resolveVar(theme, bg);
    const r = ratio(a, b);
    const ok = r >= min;
    if (!ok) fails++;
    rows.push({ themeName, fg, a, bg, b, r, min, ok, use });
  }
}
if (md) {
  console.log('| ธีม | ส่วนหน้า | ค่า | พื้น | ค่า | ratio | เกณฑ์ | ผล | ใช้ที่ |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const x of rows) console.log(`| ${x.themeName} | \`${x.fg}\` | ${x.a} | \`${x.bg}\` | ${x.b} | **${x.r.toFixed(2)}:1** | ${x.min}:1 | ${x.ok ? 'ผ่าน' : '**ไม่ผ่าน**'} | ${x.use} |`);
} else {
  for (const x of rows) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.themeName.padEnd(5)} ${x.fg.padEnd(17)} ${x.a}  on ${x.bg.padEnd(14)} ${x.b}  ${x.r.toFixed(2).padStart(5)}:1 (min ${x.min})`);
}
const minText = Math.min(...rows.filter((x) => x.min === T).map((x) => x.r));
console.log(`\nสรุป: ${rows.length} คู่ (${pairs.length} คู่พื้นทึบ + ${auroraPairs.length} คู่บน aurora/veil × 2 ธีม) · ไม่ผ่าน ${fails} · คู่ข้อความต่ำสุด ${minText.toFixed(2)}:1`);
console.log(`บล็อกมืด [data-theme="dark"] กับ @media prefers-color-scheme: ${mismatch.length ? 'ไม่ตรงกัน → ' + mismatch.join(', ') : 'ตรงกันทุก token'} (${Object.keys(darkAttr).length} token)`);
console.log(`token สีของธีมสว่างที่ไม่มีค่าธีมมืด: ${missingDark.length ? missingDark.join(', ') : 'ไม่มี'}`);
process.exit(fails || mismatch.length || missingDark.length || navBleedFail.length || metaFail.length ? 1 : 0);
