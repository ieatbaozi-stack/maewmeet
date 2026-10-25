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
  ['calendar', 'normal', 'view', VARIANTS],
  ['create', 'normal', 'view', VARIANTS],
  ['cats', 'normal', 'full', [['th', 'light'], ['th', 'dark']]],
  // R1 — บัญชี / reset PIN / admin (th/en × light/dark ทุกสถานะหลัก)
  ['signup', 'normal', 'view', VARIANTS],
  ['signup', 'pin', 'view', VARIANTS],
  ['signup', 'error', 'view', VARIANTS],
  ['forgot', 'normal', 'view', VARIANTS],
  ['forgot', 'loading', 'view', [['th', 'light'], ['en', 'dark']]],
  ['forgot', 'pending', 'view', VARIANTS],
  ['forgot', 'approved', 'view', VARIANTS],
  ['forgot', 'closed', 'view', VARIANTS],
  ['set-pin', 'normal', 'view', VARIANTS],
  ['set-pin', 'error', 'view', VARIANTS],
  ['set-pin', 'loading', 'view', [['th', 'light'], ['en', 'dark']]],
  ['admin-resets', 'normal', 'view', VARIANTS],
  ['admin-resets', 'sheet', 'view', VARIANTS],
  ['admin-resets', 'all', 'view', VARIANTS],
  ['admin-resets', 'empty', 'view', VARIANTS],
  ['admin-resets', 'error', 'view', [['th', 'light'], ['en', 'dark']]],
  // R2 — กลุ่ม / หน้ากลุ่ม / ตั้งค่า / sheet / dialog (th/en × light/dark)
  ['groups', 'invites', 'view', VARIANTS],
  ['groups', 'list', 'view', VARIANTS],
  ['groups', 'empty', 'view', VARIANTS],
  ['groups', 'create', 'view', VARIANTS],
  ['groups', 'join', 'view', VARIANTS],
  ['groups', 'loading', 'view', [['th', 'light']]],
  ['group', 'normal', 'view', VARIANTS],
  ['group', 'member', 'view', VARIANTS],
  ['group', 'solo', 'view', VARIANTS],
  ['group-settings', 'admin', 'full', VARIANTS],
  ['group-settings', 'member', 'full', VARIANTS],
  ['group-settings', 'invite', 'view', VARIANTS],
  ['group-settings', 'confirm', 'view', VARIANTS],
  ['group-settings', 'delete', 'view', VARIANTS],
  ['group-settings', 'actions', 'view', VARIANTS],
  ['members', 'normal', 'view', [['th', 'light'], ['th', 'dark']]],
  // R3 — ปฏิทินกลุ่ม (เดือน/วัน) + ฟอร์มลง busy + รายการของฉัน (th/en × light/dark × 375/390/768)
  ['calendar-month', 'normal', 'view', VARIANTS],
  ['calendar-month', 'twelve', 'view', VARIANTS],
  ['calendar-month', 'wk6', 'view', VARIANTS],
  ['calendar-month', 'wk4', 'view', VARIANTS],
  ['calendar-month', 'yearcross', 'view', VARIANTS],
  ['calendar-month', 'solo', 'view', VARIANTS],
  ['calendar-month', 'empty', 'view', VARIANTS],
  ['calendar-month', 'loading', 'view', VARIANTS],
  ['calendar-month', 'error', 'view', VARIANTS],
  ['calendar-month', 'gone', 'view', VARIANTS],
  ['calendar-month', 'switch', 'view', VARIANTS],
  ['calendar-day', 'normal', 'full', VARIANTS],
  ['calendar-day', 'today', 'full', VARIANTS],
  ['calendar-day', 'twelve', 'full', VARIANTS],
  ['calendar-day', 'empty', 'view', VARIANTS],
  ['calendar-day', 'long', 'full', VARIANTS],
  ['calendar-day', 'loading', 'view', VARIANTS],
  ['calendar-day', 'error', 'view', VARIANTS],
  ['busy-form', 'timed', 'view', VARIANTS],
  ['busy-form', 'timed', 'view', VARIANTS, { scroll: 'end' }],
  ['busy-form', 'allday', 'view', VARIANTS],
  ['busy-form', 'multi', 'view', VARIANTS],
  ['busy-form', 'overnight', 'view', VARIANTS],
  ['busy-form', 'overnight', 'view', VARIANTS, { scroll: 'end' }],
  ['busy-form', 'first', 'view', VARIANTS],
  ['busy-form', 'error-range', 'view', VARIANTS],
  ['busy-form', 'error-limit', 'view', VARIANTS],
  ['busy-form', 'error-span', 'view', VARIANTS],
  ['busy-form', 'error-backdate', 'view', VARIANTS],
  ['busy-form', 'error-save', 'view', VARIANTS],
  ['busy-form', 'error-copy', 'view', VARIANTS],
  ['busy-form', 'saving', 'view', VARIANTS],
  ['busy-form', 'edit', 'view', VARIANTS],
  ['busy-form', 'edit', 'view', VARIANTS, { scroll: 'end' }],
  ['busy-form', 'delete', 'view', VARIANTS],
  ['busy-mine', 'list', 'view', VARIANTS],
  ['busy-mine', 'saved', 'view', VARIANTS],
  ['busy-mine', 'near', 'view', VARIANTS],
  ['busy-mine', 'empty', 'view', VARIANTS],
  ['busy-mine', 'loading', 'view', VARIANTS],
  ['busy-mine', 'error', 'view', VARIANTS],
  // R4A — วันที่ว่างตรงกัน (th/en × light/dark × 375/390/768)
  ['availability', 'normal', 'full', VARIANTS],
  ['availability', 'member', 'view', VARIANTS],
  ['availability', 'day', 'view', VARIANTS],
  ['availability', 'day-partial', 'view', VARIANTS],
  ['availability', 'day-nocommon', 'view', VARIANTS],
  ['availability', 'day-none', 'view', VARIANTS],
  ['availability', 'none', 'view', VARIANTS],
  ['availability', 'none-nocommon', 'view', VARIANTS],
  ['availability', 'nobody', 'view', VARIANTS],
  ['availability', 'twelve', 'view', VARIANTS],
  ['availability', 'twelve-day', 'view', VARIANTS],
  ['availability', 'wk6', 'view', VARIANTS],
  ['availability', 'wk4', 'view', VARIANTS],
  ['availability', 'truncated', 'view', VARIANTS],
  ['availability', 'solo', 'view', VARIANTS],
  ['availability', 'loading', 'view', VARIANTS],
  ['availability', 'error', 'view', VARIANTS],
  ['availability', 'gone', 'view', VARIANTS],
  ['availability', 'nogroup', 'view', VARIANTS],
  // R4B — หน้าหลัก · นัด (ฟอร์ม/รายละเอียด/รายการ) · แจ้งเตือน (th/en × light/dark × 375/390/768)
  ...(() => {
    const V2 = [['th', 'light'], ['en', 'dark']];
    const V2b = [['th', 'dark'], ['en', 'light']];
    const out = [];
    for (const s of ['normal', 'today', 'tomorrow', 'ongoing', 'overnight', 'one', 'long', 'only-cancelled', 'many', 'rsvp-error', 'rsvp-saving', 'empty', 'nogroup', 'loading', 'error']) {
      out.push(['home', s, s === 'normal' || s === 'many' || s === 'long' ? 'full' : 'view', ['normal', 'empty', 'long'].includes(s) ? VARIANTS : s === 'today' || s === 'only-cancelled' ? V2b : V2]);
    }
    out.push(['home', 'normal', 'view', VARIANTS]);
    for (const s of ['normal', 'member', 'today', 'ongoing', 'past', 'cancelled', 'cancelled-gone', 'nolink', 'nocoords', 'noplace', 'map-failed', 'map-loading', 'unanswered', 'rsvp-error', 'rsvp-saving', 'cancel-confirm', 'cancel-error', 'overnight', 'long', 'loading', 'error', 'gone']) {
      out.push(['appt-detail', s, ['cancel-confirm', 'cancel-error', 'loading', 'error', 'gone'].includes(s) ? 'view' : 'full', ['normal', 'cancelled', 'past', 'long'].includes(s) ? VARIANTS : V2]);
    }
    for (const s of ['upcoming', 'past', 'empty-upcoming', 'empty-past', 'loading', 'error', 'near-limit', 'long', 'past-capped']) {
      out.push(['appt-list', s, s === 'upcoming' || s === 'long' || s === 'past' ? 'full' : 'view', ['upcoming', 'past'].includes(s) ? VARIANTS : V2]);
    }
    for (const s of ['normal', 'allread', 'more', 'long', 'mark-error', 'empty', 'loading', 'error']) {
      out.push(['notifications', s, s === 'normal' || s === 'more' || s === 'long' ? 'full' : 'view', ['normal', 'empty'].includes(s) ? VARIANTS : V2]);
    }
    const FORMS = ['create', 'empty', 'prefilled', 'filled', 'warn', 'warn-min', 'warn-many', 'unknown', 'unknown-warn', 'checking', 'check-error', 'overnight', 'error-fields', 'error-past', 'error-range', 'error-save', 'error-limit', 'error-rate', 'saving', 'edit', 'edit-cancelled', 'long', 'created'];
    for (const s of FORMS) out.push(['appt-form', s, 'view', ['create', 'warn', 'prefilled', 'created'].includes(s) ? VARIANTS : V2]);
    out.push(['appt-form', 'warn', 'view', V2, { scrollTo: '.ov' }]);
    out.push(['appt-form', 'warn-many', 'view', V2, { scrollTo: '.ov' }]);
    out.push(['appt-form', 'create', 'view', V2, { scroll: 'end' }]);
    out.push(['appt-form', 'edit', 'view', V2, { scroll: 'end' }]);
    out.push(['appt-form', 'long', 'view', V2, { scroll: 'end' }]);
    for (const s of ['place-typed', 'place-searching', 'place-results', 'place-picked', 'place-none', 'place-error', 'place-rate', 'place-disabled', 'place-short', 'place-paste', 'place-paste-error', 'place-coords-error', 'place-chip', 'place-link', 'place-pin', 'place-long']) {
      out.push(['appt-form', s, 'view', ['place-results', 'place-disabled', 'place-chip'].includes(s) ? VARIANTS : V2b, { scrollTo: '#place' }]);
    }
    return out;
  })(),
];
const only = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const results = [];
for (const [page, state, mode, variants, opts = {}] of JOBS) {
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
        // R3: จุดสมาชิก/ตัวเลข +N ต้องไม่ล้นช่องวัน · ข้อความในแถบเวลา/รายการต้องไม่ล้นแถว
        const clipped = [];
        for (const el of document.querySelectorAll('.cal-dots, .cal-row, .cal-person, .busy-list .row, .cal-summary-line, .private-badge, .av-cell, .av-summary, .av-seg, .av-status, .av-sw, .segmented button, .appt-band, .appt-count, .appt-row, .appt-row-main, .notif-row, .notif-body, .place-search, .place-chip, .ov-list li, .ov, .appt-section, .appt-card')) {
          if (el.closest('[hidden]')) continue;
          if (el.scrollWidth > el.clientWidth + 1) clipped.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        }
        for (const el of document.querySelectorAll('.cal-dots')) {
          if (el.closest('[hidden]')) continue;
          const c = el.closest('.cal-cell').getBoundingClientRect(); const r = el.getBoundingClientRect();
          const last = el.lastElementChild ? el.lastElementChild.getBoundingClientRect() : r;
          if (last.right > c.right + 0.5 || r.bottom > c.bottom + 0.5) clipped.push(`cal-dots ออกนอกช่อง ${Math.round(last.right - c.right)}/${Math.round(r.bottom - c.bottom)}`);
        }
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fams: [...new Set(fams)], small, missing, clipped };
      });
      if (opts.scrollTo) await p.evaluate((sel) => { const el = [...document.querySelectorAll('.sheet-body ' + sel)].find((e) => e.getClientRects().length); const sb = el && el.closest('.sheet-body'); if (el && sb) sb.scrollTop = el.offsetTop - sb.offsetTop - 8; }, opts.scrollTo);
      if (opts.scroll === 'end') await p.evaluate(() => document.querySelectorAll('.sheet-body').forEach((e) => { e.scrollTop = e.scrollHeight; }));
      const suffix = (state === 'normal' ? '' : '-' + state) + (opts.scroll === 'end' ? '-end' : '') + (opts.scrollTo ? '-at' : '') + (fullPage && page !== 'cats' ? '-full' : '');
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
  if (hs || r.small.length || r.missing.length || (r.clipped && r.clipped.length) || !r.fams.some((f) => f.startsWith('IBM Plex Sans Thai'))) bad++;
  console.log(`${r.file.padEnd(36)} scrollWidth=${r.sw} clientWidth=${r.cw} ${hs ? 'H-SCROLL!' : 'ok'} | fonts: ${r.fams.join(', ') || 'NONE'}${r.small.length ? '\n   tap<44: ' + r.small.join(' | ') : ''}${r.missing.length ? '\n   missing EN: ' + r.missing.join(', ') : ''}${r.clipped && r.clipped.length ? '\n   clipped: ' + r.clipped.join(' | ') : ''}${r.warnings.length ? '\n   console: ' + r.warnings.join(' | ') : ''}`);
}
console.log(`\n${results.length} ภาพ · มีปัญหา ${bad}`);
