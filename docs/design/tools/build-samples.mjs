#!/usr/bin/env node
// ประกอบหน้าตัวอย่าง: docs/design/tools/templates/*.html → docs/design/samples/*.html
// แทนที่ <i data-icon="ชื่อ" class="..."></i> ด้วย Lucide inline SVG
// และ   <i data-brand="logo-th"> ด้วย public/brand/logo-*.svg
// และ   <i data-cat="ท่า" class="..."></i>   ด้วยแมวจาก public/brand/cats (inline เพื่อรับ CSS var ทั้งสองธีม)
// ใช้: node docs/design/tools/build-samples.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const { icons } = JSON.parse(readFileSync(resolve(here, 'lucide-icons.json'), 'utf8'));
const missing = new Set();

const icon = (name, cls = '') => {
  if (!icons[name]) { missing.add(name); return ''; }
  return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
};
const cat = (name, cls = '', label = '') => {
  const svg = readFileSync(resolve(root, `public/brand/cats/cat-${name}.svg`), 'utf8')
    .replace(/<title>.*?<\/title>\n?/, '')
    .replace(/ role="img" aria-label="[^"]*"/, label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"')
    .replace('<svg ', `<svg class="cat${cls ? ' ' + cls : ''}" `)
    .trim();
  return svg;
};

const attr = (s, n) => (s.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] || '';
const tdir = resolve(here, 'templates');
for (const f of readdirSync(tdir).filter((x) => x.endsWith('.html'))) {
  let html = readFileSync(resolve(tdir, f), 'utf8');
  html = html.replace(/<i ([^>]*data-icon="[^"]+"[^>]*)><\/i>/g, (_, a) => icon(attr(a, 'data-icon'), attr(a, 'class')));
  html = html.replace(/<i ([^>]*data-cat="[^"]+"[^>]*)><\/i>/g, (_, a) => cat(attr(a, 'data-cat'), attr(a, 'class'), attr(a, 'aria-label')));
  html = html.replace(/<i ([^>]*data-brand="[^"]+"[^>]*)><\/i>/g, (_, a) => readFileSync(resolve(root, `public/brand/${attr(a, 'data-brand')}.svg`), 'utf8')
    .replace(/<title>.*?<\/title>/, '').replace('<svg ', `<svg class="${attr(a, 'class')}" `).trim());
  // inline แล้วรับ token จาก tokens.css เสมอ → ตัดค่า fallback hex ออก (fallback มีไว้สำหรับใช้เป็น <img> เท่านั้น)
  html = html.replace(/var\((--cat-[a-z0-9-]+), #[0-9A-Fa-f]{3,8}\)/g, 'var($1)');
  writeFileSync(resolve(root, 'docs/design/samples', f), `<!-- สร้างจาก docs/design/tools/templates/${f} ด้วย build-samples.mjs — แก้ที่ template -->\n` + html);
  console.log('สร้าง docs/design/samples/' + f);
}
if (missing.size) { console.error('ไอคอนที่ไม่มีใน lucide-icons.json: ' + [...missing].join(', ')); process.exit(1); }
