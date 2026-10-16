#!/usr/bin/env node
// ถ่ายภาพหน้าจอหน้าตัวอย่าง + ตรวจ: horizontal scroll, ฟอนต์ Plex โหลดจริง, เป้าแตะ < 44px, คีย์ EN หาย
// ใช้: PLAYWRIGHT_MODULE=/path/to/playwright node docs/design/tools/shoot.mjs [page ...]
//      ค่าเริ่มต้น module: /opt/npm-tools/node_modules/playwright · Chromium: /opt/pw-browsers/chromium-1194/chrome-linux/chrome
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright');
const here = dirname(fileURLToPath(import.meta.url));
const samples = resolve(here, '../samples');
const outDir = resolve(here, '../screenshots');
mkdirSync(outDir, { recursive: true });

const WIDTHS = { 375: 812, 390: 844, 768: 1024 };
const VARIANTS = [['th', 'light'], ['th', 'dark'], ['en', 'light'], ['en', 'dark']];
// [หน้า, state, fullPage, variants]
const JOBS = [
  // [หน้า, state, โหมดภาพ, ชุดภาษา×ธีม]  โหมด: 'view' = เท่าจอ (สิ่งที่เห็นตอนเปิด) · 'full' = ยาวทั้งหน้า (ขยาย viewport — ขนาด aurora ในภาพไม่ตรงจอจริง)
  ['login', 'normal', 'view', VARIANTS],
  ['login', 'error', 'view', [['th', 'light'], ['en', 'dark']]],
  ['login', 'loading', 'view', [['th', 'dark']]],
  ['home', 'normal', 'view', VARIANTS],
  ['home', 'normal', 'full', [['th', 'light'], ['th', 'dark']]],
  ['home', 'empty', 'view', [['th', 'light'], ['th', 'dark'], ['en', 'light'], ['en', 'dark']]],
  ['home', 'loading', 'view', [['th', 'light']]],
  ['home', 'error', 'view', [['th', 'light'], ['en', 'dark']]],
  ['calendar', 'normal', 'view', VARIANTS],
  ['create', 'normal', 'view', VARIANTS],
  ['cats', 'normal', 'full', [['th', 'light'], ['th', 'dark']]],
];
const only = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const results = [];
for (const [page, state, mode, variants] of JOBS) {
  const fullPage = mode === 'full';
  if (only.length && !only.includes(page)) continue;
  for (const [lang, theme] of variants) {
    for (const [w, h] of Object.entries(WIDTHS)) {
      if (page === 'cats' && w !== '390' && w !== '768') continue;
      const ctx = await browser.newContext({ viewport: { width: +w, height: h }, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      const warnings = [];
      p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
      const url = pathToFileURL(resolve(samples, page + '.html')).href + `?lang=${lang}&theme=${theme}&state=${state}`;
      await p.goto(url);
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(150);
      const m = await p.evaluate(() => {
        const fams = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')} ${f.weight} ${/e01/i.test(f.unicodeRange) ? 'thai' : 'latin'}`);
        const small = [];
        for (const el of document.querySelectorAll('a, button, [role="radio"], input, textarea')) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (!r.width || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
          if (r.height < 44 || r.width < 44) small.push(`${el.tagName.toLowerCase()}.${el.className || ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
        const missing = [...document.querySelectorAll('[data-missing]')].map((e) => e.getAttribute('data-missing'));
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fams: [...new Set(fams)], small, missing };
      });
      const suffix = (state === 'normal' ? '' : '-' + state) + (fullPage && page !== 'cats' ? '-full' : '');
      const file = `${page}${suffix}-${lang}-${theme}-${w}.png`;
      if (fullPage) { // ให้แถบล่าง (fixed) อยู่ท้ายภาพ ไม่ลอยกลางภาพ
        const fullH = await p.evaluate(() => document.documentElement.scrollHeight);
        if (fullH > h) { await p.setViewportSize({ width: +w, height: fullH }); await p.waitForTimeout(100); }
      }
      await p.screenshot({ path: resolve(outDir, file) });
      results.push({ file, ...m, warnings });
      await ctx.close();
    }
  }
}
await browser.close();
let bad = 0;
for (const r of results) {
  const hs = r.sw > r.cw;
  if (hs || r.small.length || r.missing.length || !r.fams.some((f) => f.startsWith('IBM Plex Sans Thai'))) bad++;
  console.log(`${r.file.padEnd(36)} scrollWidth=${r.sw} clientWidth=${r.cw} ${hs ? 'H-SCROLL!' : 'ok'} | fonts: ${r.fams.join(', ') || 'NONE'}${r.small.length ? '\n   tap<44: ' + r.small.join(' | ') : ''}${r.missing.length ? '\n   missing EN: ' + r.missing.join(', ') : ''}${r.warnings.length ? '\n   console: ' + r.warnings.join(' | ') : ''}`);
}
console.log(`\n${results.length} ภาพ · มีปัญหา ${bad}`);
