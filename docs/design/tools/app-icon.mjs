#!/usr/bin/env node
// R15a — ไอคอนแอปสำหรับหน้าจอโฮม iOS/Android: หัวแมวแบรนด์ (ชิ้นเดียวกับ public/brand/logo-mark.svg) บนพื้นครามของแบรนด์
// ใช้: node docs/design/tools/app-icon.mjs   (ใช้ sharp ของ repo) → เขียน public/brand/app/*.png (สคริปต์นี้คือต้นฉบับ ไม่มี svg แยก)
// สี: พื้น --accent สว่าง #4B59C2 · ขนแมว --surface #FFFFFF · เส้น --ink #2A2833 · ในหู --cat-fill #F4D9A8 (ไม่มีสีใหม่)
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sharp = createRequire(resolve(root, 'package.json'))('sharp');
const out = resolve(root, 'public/brand/app');
mkdirSync(out, { recursive: true });

const BG = '#4B59C2', COAT = '#FFFFFF', INK = '#2A2833', FILL = '#F4D9A8';
// หัวแมวพิกัดเดียวกับ logo-mark.svg (หัวอยู่ x 38–82, y 19–65 · กึ่งกลาง 60,42)
const HEAD = `<g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<path d="M40 50 C38 40 39 30 42 19 L54 27 C58 26 62 26 66 27 L78 19 C81 30 82 40 80 50 C78 60 70 65 60 65 C50 65 42 60 40 50 Z" fill="${COAT}"/>
<path d="M44.5 25 L45.5 33 L51 28.5 Z" fill="${FILL}" stroke="none"/><path d="M75.5 25 L74.5 33 L69 28.5 Z" fill="${FILL}" stroke="none"/>
<circle cx="46.5" cy="53.5" r="3.2" fill="${FILL}" stroke="none"/><circle cx="73.5" cy="53.5" r="3.2" fill="${FILL}" stroke="none"/>
<circle cx="52" cy="46" r="2.3" fill="${INK}" stroke="none"/><circle cx="68" cy="46" r="2.3" fill="${INK}" stroke="none"/>
<path d="M58.3 51.5 L61.7 51.5 L60 53.3 Z" fill="${INK}" stroke="none"/>
<path d="M60 53.5 Q58 56.5 55.8 55" /><path d="M60 53.5 Q62 56.5 64.2 55" />
</g>`;

/** scale = หน่วยของหัวแมวต่อ 1 พิกเซลที่ 512 · rx = มุมมน (0 = เต็มพื้น) */
const svg = ({ scale, rx }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" rx="${rx}" fill="${BG}"/>
<g transform="translate(256 256) scale(${scale}) translate(-60 -42)">${HEAD}</g>
</svg>`;

const VARIANTS = {
  // เต็มพื้น ไม่มีความโปร่งใส (iOS ตัดมุมให้เอง) · หัวสูง ~60% ของไอคอน
  'apple-touch-icon': { scale: 6.2, rx: 0, size: 180 },
  // purpose "any": มุมมนโปร่งใส
  'icon-192': { scale: 6.2, rx: 112, size: 192 },
  'icon-512': { scale: 6.2, rx: 112, size: 512 },
  // purpose "maskable": เต็มพื้น เนื้อหาทั้งหมดอยู่ในวงกลมเขตปลอดภัย (รัศมี 40% = 204.8px) — หัวกว้าง/สูง ~52%
  'icon-maskable-512': { scale: 5.3, rx: 0, size: 512 },
};
for (const [name, v] of Object.entries(VARIANTS)) {
  const s = svg(v);
  const png = await sharp(Buffer.from(s), { density: 384 }).resize(v.size, v.size).png({ compressionLevel: 9, palette: false }).toBuffer();
  // apple-touch และ maskable ต้องเต็มพื้นไม่มี alpha: flatten ลงพื้นแบรนด์ แล้วบังคับ 3 ช่อง
  const final = (name === 'apple-touch-icon' || name.includes('maskable')) ? await sharp(png).flatten({ background: BG }).removeAlpha().png({ compressionLevel: 9 }).toBuffer() : png;
  writeFileSync(resolve(out, `${name}.png`), final);
  console.log(name + '.png', v.size + '×' + v.size, final.length + ' bytes');
}
