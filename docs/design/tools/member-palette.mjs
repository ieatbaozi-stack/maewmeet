#!/usr/bin/env node
// ตรวจชุดสีประจำสมาชิก 10 สี จาก src/styles/tokens.css: ระยะสี OKLab (×100) ระหว่างทุกคู่ ในสายตาปกติและจำลองตาบอดสี
// (Machado 2009, severity 1.0: protan / deutan / tritan) แยกตามธีม × (พื้นอวาตาร์ --member-N, สีเส้น --member-mark-N)
// ใช้: node docs/design/tools/member-palette.mjs [--md]   exit 1 ถ้าต่ำกว่าเกณฑ์
// เกณฑ์: ปกติ ≥ 8 · ตาบอดสี ≥ 3.5 — ชุดสีเดียวไม่พอแยก 10 คนในตาบอดสีบางแบบ จึงต้องมีสัญญาณที่ไม่ใช่สีเสมอ
//        (ตัวอักษรย่อ + รูปทรงประจำสี src/styles/members.css) · สคริปต์นี้ตรวจด้วยว่า members.css กำหนดรูปทรงครบ 10 แบบไม่ซ้ำกัน
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const css = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function block(re) {
  const m = css.match(re); if (!m) throw new Error('ไม่พบบล็อก ' + re);
  let d = 1, i = m.index + m[0].length; const st = i;
  while (d && i < css.length) { if (css[i] === '{') d++; if (css[i] === '}') d--; i++; }
  const v = {}; for (const x of css.slice(st, i - 1).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) v[x[1]] = x[2].trim(); return v;
}
const light = block(/(^|\n):root\s*\{/);
const dark = { ...light, ...block(/\n:root\[data-theme="dark"\]\s*\{/) };
const lin = (h) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const M1 = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]];
const M2 = [[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]];
const oklab = (l) => mul(M2, mul(M1, l).map(Math.cbrt));
const CVD = {
  ปกติ: null,
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const sim = (hex, m) => oklab(m ? mul(m, lin(hex)).map((x) => Math.min(1, Math.max(0, x))) : lin(hex));
const MIN = { ปกติ: 8, protan: 3.5, deutan: 3.5, tritan: 3.5 };
let fail = 0; const rows = [];
for (const [tn, th] of [['light', light], ['dark', dark]]) {
  for (const [set, prefix] of [['พื้นอวาตาร์', '--member-'], ['สีเส้น/จุด', '--member-mark-']]) {
    const hex = Array.from({ length: 10 }, (_, i) => th[prefix + (i + 1)]);
    for (const [vn, m] of Object.entries(CVD)) {
      const S = hex.map((h) => sim(h, m)); let best = { d: 1e9 };
      for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
        const d = Math.hypot(...S[i].map((x, k) => x - S[j][k])) * 100; if (d < best.d) best = { d, i: i + 1, j: j + 1 };
      }
      const ok = best.d >= MIN[vn]; if (!ok) fail++;
      rows.push({ tn, set, vn, ...best, ok });
    }
  }
}
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.tn.padEnd(5)} ${r.set.padEnd(11)} ${r.vn.padEnd(7)} คู่ที่ใกล้สุด ${r.i}-${r.j} ระยะ ${r.d.toFixed(1)} (min ${MIN[r.vn]})`);
// รูปทรงประจำสี: members.css ต้องมี [data-slot="1".."10"] แต่ละอันมี clip-path ต่างกัน
let shapeMsg;
try {
  const mc = readFileSync(resolve(root, 'src/styles/members.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const shapes = Array.from({ length: 10 }, (_, i) => (mc.match(new RegExp(`--member-shape-${i + 1}:\\s*([^;]+);`)) || [])[1]);
  const miss = shapes.map((s, i) => (s ? null : i + 1)).filter(Boolean);
  const dup = shapes.filter((s, i) => s && shapes.indexOf(s) !== i);
  if (miss.length || dup.length) { fail++; shapeMsg = `FAIL  รูปทรง: ขาด ${miss} ซ้ำ ${dup.length}`; } else shapeMsg = 'PASS  รูปทรงประจำสี 10 แบบไม่ซ้ำกัน';
} catch { fail++; shapeMsg = 'FAIL  ไม่พบ src/styles/members.css'; }
console.log(shapeMsg);
console.log(`\nสรุป: ${rows.length} ชุดตรวจ · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
