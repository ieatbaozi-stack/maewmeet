#!/usr/bin/env node
// ประกอบหน้าตัวอย่าง: docs/design/tools/templates/*.html → docs/design/samples/*.html
// แทนที่ <i data-icon="ชื่อ" class="..."></i> ด้วย Lucide inline SVG
// และ   <i data-brand="logo-th"> ด้วย public/brand/logo-*.svg
// และ   <i data-cat="ท่า" class="..."></i>   ด้วยแมวจาก public/brand/cats (inline เพื่อรับ CSS var ทั้งสองธีม)
// ใช้: node docs/design/tools/build-samples.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { expandCalendar, setIntl, takeEn } from './build-calendar.mjs';
import { expandAvailability } from './build-availability.mjs';
import { expandAppointments } from './build-appointments.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const { icons } = JSON.parse(readFileSync(resolve(here, 'lucide-icons.json'), 'utf8'));
const missing = new Set();

// ---- R1: ข้อความจาก messages/*.json (แหล่งเดียวกับแอปจริง — กันข้อความในหน้าตัวอย่างเพี้ยนจากไฟล์จริง) ----
// <span data-m="signup.title"></span>               → เติมข้อความไทย + ใส่ค่าอังกฤษลง window.MESSAGES_EN ที่ <!--MESSAGES_EN-->
// <span data-m="forgot.approved.expires" data-m-v='{"th":{"expires":"..."},"en":{"expires":"..."}}'></span>   (หรือ {"count":2} ใช้ร่วมสองภาษา)
// <button data-m-aria="a11y.close"> → aria-label · <input data-m-ph="key"> → placeholder
const require = createRequire(import.meta.url);
const { IntlMessageFormat } = require(resolve(root, 'node_modules/intl-messageformat'));
const MSG = Object.fromEntries(['th', 'en'].map((l) => [l, JSON.parse(readFileSync(resolve(root, `messages/${l}.json`), 'utf8'))]));
setIntl(IntlMessageFormat, MSG); // R3: ตัวสร้างปฏิทิน/ฟอร์ม busy ใช้ข้อความชุดเดียวกัน
const lookup = (l, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), MSG[l]);
const fmt = (l, key, vals) => {
  const m = lookup(l, key);
  if (typeof m !== 'string') { missing.add('messages:' + key + ':' + l); return key; }
  const v = vals && (vals[l] || (vals.th || vals.en ? {} : vals)) || {};
  return String(new IntlMessageFormat(m, l).format(v)).replace(/&/g, '&amp;').replace(/</g, '&lt;');
};
const esc = (x) => x.replace(/"/g, '&quot;');
function applyMessages(html) {
  const en = {};
  const vOf = (a) => { const m = a.match(/data-m-v='([^']*)'/); return m ? JSON.parse(m[1]) : null; };
  const strip = (a) => a.replace(/\s*data-m-v='[^']*'/g, '');
  const ids = new Map();
  const idOf = (key, v) => { if (!v) return key; const k = key + JSON.stringify(v); if (!ids.has(k)) ids.set(k, `${key}~${ids.size + 1}`); return ids.get(k); };
  html = html.replace(/<(\w+)([^>]*?)\sdata-m="([^"]+)"([^>]*)><\/\1>/g, (_, tag, a1, key, a2) => {
    const v = vOf(a1 + a2);
    const id = idOf(key, v);
    en[id] = fmt('en', key, v).replace(/&amp;/g, '&');
    return `<${tag}${a1} data-t="${id}"${a2}>${fmt('th', key, v)}</${tag}>`;
  });
  for (const [attr, tattr, real] of [['data-m-aria', 'data-t-aria', 'aria-label'], ['data-m-ph', 'data-t-ph', 'placeholder']]) {
    html = html.replace(new RegExp(`${attr}="([^"]+)"([^>]*?)>`, 'g'), (all, key, rest) => {
      const v = vOf(rest);
      const id = idOf(key, v);
      en[id] = fmt('en', key, v).replace(/&amp;/g, '&');
      return `${real}="${esc(fmt('th', key, v).replace(/&amp;/g, '&'))}" ${tattr}="${id}"${rest}>`;
    });
  }
  html = strip(html);
  if (!Object.keys(en).length) return html;
  const block = `<script>window.MESSAGES_EN = Object.assign(window.MESSAGES_EN || {}, ${JSON.stringify(en).replace(/</g, '\\u003c')});</script>`;
  return html.includes('<!--MESSAGES_EN-->') ? html.replace('<!--MESSAGES_EN-->', block) : html;
}

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
  html = expandAppointments(html); // R4B: <gen-appt> → หน้าหลัก/นัด/แจ้งเตือน
  html = expandAvailability(html); // R4A: <gen-avpage> → หน้าจอวันที่ว่างตรงกัน (ก่อน expandCalendar ไม่จำเป็น แต่ก่อน applyMessages)
  html = expandCalendar(html); // R3: <gen-month|day|picker|mine|sum|d> → markup (ก่อน applyMessages เพราะมี data-m)
  html = applyMessages(html);
  const genEn = takeEn();
  if (Object.keys(genEn).length) html = html.replace('</head>', `<script>window.MESSAGES_EN = Object.assign(window.MESSAGES_EN || {}, ${JSON.stringify(genEn).replace(/</g, '\\u003c')});</script>\n</head>`);
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
