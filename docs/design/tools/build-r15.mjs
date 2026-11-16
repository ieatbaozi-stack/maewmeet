#!/usr/bin/env node
// R15a — หน้าตัวอย่าง docs/design/samples/r15-feedback.html: ไอคอนกลุ่ม (ตัวเลือก/จุดที่แสดง) · "เว้นบางวัน" · ไอคอนแอป
// ใช้: node docs/design/tools/build-r15.mjs   (อ่าน group-icons.json, lucide-icons.json, messages/*.json)
// สลับด้วย URL เหมือนตัวอย่างอื่น: ?lang=th|en &theme=light|dark &state=<ดูรายการ STATES ด้านล่าง>
// ข้อความมาจาก messages/*.json (สองภาษาเขียนลง HTML ทั้งคู่ สลับด้วย html[lang]) — CSS ใหม่ทั้งหมดอยู่ใน <style> ของหน้านี้และคัดลอกไว้ใน docs/design/R15_FEEDBACK.md §7 ให้ frontend
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(import.meta.url);
const { IntlMessageFormat } = require(resolve(root, 'node_modules/intl-messageformat'));
const MSG = Object.fromEntries(['th', 'en'].map((l) => [l, JSON.parse(readFileSync(resolve(root, `messages/${l}.json`), 'utf8'))]));
const { icons: LUCIDE } = JSON.parse(readFileSync(resolve(here, 'lucide-icons.json'), 'utf8'));
const GI = JSON.parse(readFileSync(resolve(here, 'group-icons.json'), 'utf8')).icons;

const get = (l, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), MSG[l]);
const fmt = (l, key, v = {}) => {
  const m = get(l, key);
  if (typeof m !== 'string') throw new Error(`ไม่พบข้อความ ${key} (${l})`);
  return String(new IntlMessageFormat(m, l).format(v)).replace(/&/g, '&amp;').replace(/</g, '&lt;');
};
/** ข้อความสองภาษา (สลับด้วย CSS) — vals: ค่าร่วมสองภาษา หรือ { th, en } */
const T = (key, v) => ['th', 'en'].map((l) => `<span class="l ${l}">${fmt(l, key, v && (v[l] ?? (v.th || v.en ? {} : v)))}</span>`).join('');
/** ข้อความอิสระสองภาษา */
const X = (th, en) => `<span class="l th">${th}</span><span class="l en">${en}</span>`;
/** aria-label สองภาษา (สลับด้วยสคริปต์ท้ายหน้า) */
const A = (key, v) => `aria-label="${fmt('th', key, v && (v.th ?? v))}" data-aria-en="${fmt('en', key, v && (v.en ?? v))}"`;
const AX = (th, en) => `aria-label="${th}" data-aria-en="${en}"`;

const svgOf = (nodes) => nodes.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
const ic = (name, cls = '') => {
  if (!LUCIDE[name]) throw new Error('ไม่มีไอคอน ' + name);
  return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${LUCIDE[name]}</svg>`;
};
const gi = (key, cls = '') => {
  const i = GI.find((x) => x.key === key) ?? GI[0];
  return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${svgOf(i.nodes)}</svg>`;
};
/** tile ไอคอนกลุ่ม (พื้น accent-soft) ขนาด sm|md|lg */
const tile = (key, size = 'md') => `<span class="gi" data-size="${size}" aria-hidden="true">${gi(key)}</span>`;
const glyph = (key) => `<span class="gi-glyph" aria-hidden="true">${gi(key)}</span>`;
const cat = (pose, cls = 'sm') => readFileSync(resolve(root, `public/brand/cats/cat-${pose}.svg`), 'utf8').replace(/<title>.*?<\/title>\n?/, '').replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"').replace('<svg ', `<svg class="cat ${cls}" `);

// ---------------------------------------------------------------- CSS ใหม่ (ทุกค่ามาจาก tokens)
const CSS = `
html[lang="th"] .l.en, html[lang="en"] .l.th { display: none; }
.demo-note { font-size: var(--text-sm); color: var(--ink-muted); margin: var(--space-3) 0; }
.demo-h { font-size: var(--text-lg); font-weight: var(--weight-semibold); margin: var(--space-5) 0 var(--space-2); }

/* ---- ไอคอนกลุ่ม: tile + glyph ---- */
.gi { display: inline-flex; align-items: center; justify-content: center; flex: none; background: var(--accent-soft); color: var(--accent-soft-ink); border-radius: var(--radius-sm); }
.gi[data-size="sm"] { width: 28px; height: 28px; } .gi[data-size="sm"] .icon { width: var(--icon-sm); height: var(--icon-sm); }
.gi[data-size="md"] { width: var(--tap); height: var(--tap); } .gi[data-size="md"] .icon { width: var(--icon-lg); height: var(--icon-lg); }
.gi[data-size="lg"] { width: var(--tap-lg); height: var(--tap-lg); border-radius: var(--radius-lg); } .gi[data-size="lg"] .icon { width: 28px; height: 28px; }
.gi-glyph { display: inline-flex; flex: none; color: var(--ink-muted); } .gi-glyph .icon { width: var(--icon); height: var(--icon); }

/* ---- ตัวเลือกไอคอน (sheet) ---- */
.gi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); margin-top: var(--space-3); }
.gi-opt {
  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1);
  min-height: calc(var(--tap) * 2); padding: var(--space-2) var(--space-1);
  border: var(--border) solid var(--line-control); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink);
  font: inherit; font-size: var(--text-xs); line-height: 1.25; text-align: center; overflow-wrap: anywhere;
}
.gi-opt .icon { width: 28px; height: 28px; }
.gi-opt[aria-checked="true"] { border: var(--border-strong) solid var(--accent-ink); background: var(--accent-soft); color: var(--accent-soft-ink); font-weight: var(--weight-semibold); }
.gi-opt .gi-check { position: absolute; top: var(--space-1); right: var(--space-1); display: none; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--radius-full); background: var(--accent); color: var(--on-accent); }
.gi-opt .gi-check .icon { width: 14px; height: 14px; stroke-width: 3; }
.gi-opt[aria-checked="true"] .gi-check { display: inline-flex; }
@media (min-width: 48em) { .gi-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

/* ---- ส่วนตั้งค่าในหน้าตั้งค่ากลุ่ม ---- */
.gi-set { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-3); }
.gi-set .t { flex: 1; min-width: 0; font-weight: var(--weight-medium); overflow-wrap: anywhere; }
.gi-set .t small { display: block; font-weight: var(--weight-regular); color: var(--ink-muted); font-size: var(--text-sm); }

/* ---- เว้นบางวัน ---- */
.sk-nav { display: flex; align-items: center; justify-content: space-between; margin-top: var(--space-3); }
.sk-nav b { font-weight: var(--weight-semibold); }
.sk-nav .icon-btn[aria-disabled="true"] { opacity: 1; color: var(--ink-muted); }
.sk-dow, .sk-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--space-1); }
.sk-dow { margin-top: var(--space-2); text-align: center; font-size: var(--text-sm); color: var(--ink-muted); }
.sk-grid { margin-top: var(--space-1); }
.sk-day {
  display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: var(--tap); padding: 0;
  border: var(--border) solid var(--line-control); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink);
  font: inherit; font-size: var(--text-sm); font-weight: var(--weight-medium); font-variant-numeric: tabular-nums;
}
.sk-day .icon { width: var(--icon-sm); height: var(--icon-sm); margin-top: calc(var(--space-1) * -1); }
.sk-day[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent-soft-ink); border: var(--border-strong) solid var(--accent-ink); font-weight: var(--weight-semibold); }
/* เว้นไว้แล้ว (โหมดเว้น = กดไม่ได้): ลายเฉียง + ขีดฆ่าตัวเลข — ไม่พึ่งสีอย่างเดียว */
.sk-day.is-skipped { border-color: var(--line); background-color: var(--surface-2); background-image: repeating-linear-gradient(135deg, var(--hatch) 0 var(--border), transparent var(--border) var(--space-1)); color: var(--ink); text-decoration: line-through; }
.sk-day.is-skipped[aria-pressed="true"] { text-decoration: none; background-image: none; background-color: var(--accent-soft); }
.sk-day:disabled, .sk-day[aria-disabled="true"] { cursor: default; }
.sk-day.is-locked { color: var(--ink-muted); background: var(--surface-2); border-color: var(--line); }
.sk-off { display: flex; align-items: center; justify-content: center; min-height: var(--tap); color: var(--ink-muted); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
.sk-legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin-top: var(--space-3); font-size: var(--text-sm); color: var(--ink-muted); }
.sk-legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
.sk-sw { width: 20px; height: 20px; border-radius: var(--radius-sm); border: var(--border) solid var(--line-control); background: var(--surface); display: inline-flex; align-items: center; justify-content: center; }
.sk-sw.sel { background: var(--accent-soft); border: var(--border-strong) solid var(--accent-ink); color: var(--accent-soft-ink); } .sk-sw.sel .icon { width: 12px; height: 12px; stroke-width: 3; }
.sk-sw.skp { background-color: var(--surface-2); background-image: repeating-linear-gradient(135deg, var(--hatch) 0 var(--border), transparent var(--border) var(--space-1)); border-color: var(--line); }
.sk-count { margin-top: var(--space-3); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.sk-limit { display: flex; gap: var(--space-2); align-items: flex-start; margin-top: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--warn); color: var(--warn-ink); font-size: var(--text-sm); }
.sk-limit .icon { flex: none; margin-top: 2px; }
.sk-note { margin-top: var(--space-3); font-size: var(--text-sm); color: var(--ink-muted); }
.sk-empty { display: grid; justify-items: center; gap: var(--space-2); padding: var(--space-5) var(--space-4); text-align: center; }
.sk-foot { display: flex; align-items: center; gap: var(--space-3); }
.sk-foot .btn-primary { flex: 1; }
/* .link-btn ของแอปจริงอยู่ใน globals.css (ไม่มีใน app.css ของตัวอย่าง) — คัดลอกมาให้ภาพตรงของจริง */
.link-btn { display: inline-flex; align-items: center; min-height: var(--tap); padding: 0 var(--space-3); border: 0; background: transparent; color: var(--accent-ink); font: inherit; font-weight: var(--weight-medium); }
.sk-chip { display: inline-flex; align-items: center; gap: var(--space-1); margin-top: var(--space-1); padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font-size: var(--text-xs); min-height: 24px; }
.sk-chip .icon { width: var(--icon-sm); height: var(--icon-sm); }
.sk-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); padding: 0 var(--space-2) var(--space-2) var(--space-3); }
.sk-toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tap-lg) + var(--space-5)); z-index: var(--z-sheet); display: inline-flex; gap: var(--space-2); align-items: center; padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); background: var(--ink); color: var(--bg); font-weight: var(--weight-medium); }
.sk-toast .icon { flex: none; }

/* ---- จุดที่แสดงไอคอน ---- */
.sw-btn { display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--tap); padding: 0 var(--space-3); }
.pl-row { display: flex; align-items: center; gap: var(--space-3); min-height: calc(var(--tap) + var(--space-5)); padding: var(--space-3) var(--space-3); }
.pl-row + .pl-row { border-top: var(--border) solid var(--line); }
.pl-row .row-main { flex: 1; min-width: 0; }
.pl-row .radio { width: 20px; height: 20px; border-radius: var(--radius-full); border: var(--border-strong) solid var(--line-control); flex: none; }
.pl-row[aria-checked="true"] .radio { border-color: var(--accent-ink); background: radial-gradient(circle, var(--accent-ink) 0 40%, transparent 45%); }
.fact { display: flex; align-items: center; gap: var(--space-2); min-height: var(--tap); color: var(--ink); }
.ico-sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-3); }
.ico-sheet figure { margin: 0; display: grid; justify-items: center; gap: var(--space-2); padding: var(--space-3); border: var(--border) solid var(--line); border-radius: var(--radius-sm); background: var(--surface); font-size: var(--text-xs); text-align: center; }
.ico-sheet img { width: 96px; height: 96px; }
.ico-sheet .home-tile { width: 60px; height: 60px; border-radius: 14px; }
`;

// ---------------------------------------------------------------- ชิ้นส่วน
const TODAY = '2026-11-15';
const GROUP = 'ก๊วนแบดสวนลุม';
const sheetWrap = (id, titleHtml, body, foot = '') => `
<div class="scrim" aria-hidden="true"></div>
<section class="sheet tall" role="dialog" aria-modal="true" aria-labelledby="${id}">
  <div class="sheet-handle" aria-hidden="true"></div>
  <div class="sheet-head"><div class="t"><h2 id="${id}">${titleHtml}</h2></div><button class="icon-btn" type="button" ${A('a11y.close')}>${ic('x')}</button></div>
  <div class="sheet-body">${body}</div>
  ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
</section>`;

function pickerSheet(selected, { saving = false, error = false } = {}) {
  const opts = GI.map((i) => `<button type="button" class="gi-opt" role="radio" aria-checked="${i.key === selected}" tabindex="${i.key === selected ? 0 : -1}" ${A('groupIcon.names.' + i.key)}>${gi(i.key)}<span class="l th">${i.th}</span><span class="l en">${i.en}</span><span class="gi-check">${ic('check')}</span></button>`).join('');
  const body = `<p class="small muted">${T('groupSettings.icon.picker.hint')}</p>
    ${error ? `<div class="alert" role="alert" style="margin-top: var(--space-3)">${ic('circle-alert')}<div><span>${T('groupSettings.icon.error.generic')}</span></div></div>` : ''}
    <div class="gi-grid" role="radiogroup" ${A('groupSettings.icon.picker.listAria')}>${opts}</div>`;
  const foot = `<button type="button" class="btn btn-primary" style="width:100%" ${saving ? 'aria-busy="true"' : ''}>${saving ? T('groupSettings.icon.picker.saving') : T('groupSettings.icon.picker.save')}</button>`;
  return sheetWrap('gi-t', T('groupSettings.icon.picker.title'), body, foot);
}

function settingsSection(key, { viewer = 'admin' } = {}) {
  const name = (l) => (key === 'cat' ? '' : fmt(l, 'groupIcon.names.' + key));
  const current = key === 'cat' ? T('groupSettings.icon.currentDefault') : `<span class="l th">${fmt('th', 'groupSettings.icon.current', { name: name('th') })}</span><span class="l en">${fmt('en', 'groupSettings.icon.current', { name: name('en') })}</span>`;
  return `<section class="set-sec" aria-labelledby="s-icon"><h2 id="s-icon">${T('groupSettings.icon.title')}</h2>
    <p class="small muted">${T('groupSettings.icon.body')}</p>
    <div class="gi-set">${tile(key, 'lg')}<div class="t">${current}</div></div>
    ${viewer === 'admin'
      ? `<button type="button" class="btn btn-secondary" style="margin-top: var(--space-3)" ${A('groupSettings.icon.changeAria', { th: { name: key === 'cat' ? fmt('th', 'groupIcon.names.cat') : name('th') }, en: { name: key === 'cat' ? fmt('en', 'groupIcon.names.cat') : name('en') } })}>${ic('pencil')}<span>${T('groupSettings.icon.change')}</span></button>`
      : `<p class="field-hint" style="margin-top: var(--space-3)">${ic('lock', 'sm')} ${T('groupSettings.icon.viewOnly')}</p>`}
  </section>`;
}

function whereBlocks() {
  const rows = [['badminton', GROUP, 6], ['cat', 'แก๊งมัธยม ห้อง 6/3', 4], ['food', 'ชมรมหมูกระทะ', 9]];
  const enName = { [GROUP]: 'Badminton at the park', 'แก๊งมัธยม ห้อง 6/3': 'High school gang', 'ชมรมหมูกระทะ': 'Moo kratha club' };
  const nm = (n) => X(n, enName[n]);
  return `
  <h3 class="demo-h">${X('1) หัวปฏิทิน (ปุ่มสลับกลุ่ม)', '1) Calendar header (group switch button)')}</h3>
  <button type="button" class="btn btn-secondary sw-btn">${tile('badminton', 'sm')}<span>${nm(GROUP)}</span>${ic('chevron-down')}</button>
  <h3 class="demo-h">${X('2) รายการในแผ่นสลับกลุ่ม', '2) Rows in the group switch sheet')}</h3>
  <div class="rows" role="radiogroup">${rows.map(([k, n, c], i) => `<div class="pl-row" role="radio" aria-checked="${i === 0}">${tile(k, 'md')}<span class="row-main"><span class="row-title">${nm(n)}</span><span class="row-meta">${T('groups.memberCount', { count: c })}</span></span><span class="radio" aria-hidden="true"></span></div>`).join('')}</div>
  <h3 class="demo-h">${X('3) การ์ดกลุ่มในหน้ากลุ่ม', '3) Group cards on the Groups page')}</h3>
  <ul class="rows group-rows">${rows.map(([k, n, c]) => `<li><a class="row" href="#">${tile(k, 'md')}<span class="row-main"><span class="row-title">${nm(n)}</span><span class="row-meta">${T('groups.memberCount', { count: c })} · ${T('roles.admin')}</span></span>${ic('chevron-right', 'chev')}</a></li>`).join('')}</ul>
  <h3 class="demo-h">${X('4) หน้าหลัก: บรรทัดกลุ่มในการ์ดนัด (glyph เปล่า ไม่มีพื้น)', '4) Home: group line on the plan card (bare glyph, no tile)')}</h3>
  <div class="fact">${ic('clock')}<span>${X('เสาร์ 24 ต.ค. · 09:00–11:00', 'Sat, 24 Oct · 09:00–11:00')}</span></div>
  <div class="fact">${glyph('badminton')}<span>${nm(GROUP)}</span></div>`;
}

// ---- เว้นบางวัน ----
const SK_MONTHS = { '2026-11': { th: 'พฤศจิกายน 2569', en: 'November 2026', first: 6 /* 1 พ.ย. 2026 = อาทิตย์ → คอลัมน์ 7 (index 6) ตอนเริ่มจันทร์ */, days: 30 } };
function skipSheet({ month = '2026-11', picked = [18, 19], skipped = [24, 25], mode = 'skip', error = null, limit = false, saving = false, empty = false } = {}) {
  const routineDays = (d) => { const wd = new Date(Date.UTC(2026, 10, d)).getUTCDay(); return wd >= 1 && wd <= 5 && d >= 16; }; // จ.–ศ. ตั้งแต่ 16 พ.ย.
  const M = month === '2026-11' ? { th: 'พฤศจิกายน 2569', en: 'November 2026', lead: 6, days: 30 } : { th: 'ธันวาคม 2569', en: 'December 2026', lead: 1, days: 31 };
  const cells = [];
  // แสดงตั้งแต่สัปดาห์แรกที่ยังมีวันของชุด (ไม่แสดงสัปดาห์ที่ผ่านไปแล้ว/ก่อนชุดเริ่ม) — ตัวอย่าง: พ.ย. เริ่มที่ จ. 16
  const startDay = month === '2026-11' ? 16 : 1;
  const lead = month === '2026-11' ? 0 : M.lead;
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  for (let d = startDay; d <= M.days; d++) {
    const dateTh = `${d} ${month === '2026-11' ? 'พ.ย.' : 'ธ.ค.'}`;
    const dateEn = `${month === '2026-11' ? 'Nov' : 'Dec'} ${d}`;
    const inRoutine = month === '2026-11' ? routineDays(d) : (() => { const wd = new Date(Date.UTC(2026, 11, d)).getUTCDay(); return wd >= 1 && wd <= 5 && d <= 13; })();
    const isSk = inRoutine && skipped.includes(d);
    const isPicked = picked.includes(d);
    if (!inRoutine) { cells.push(`<span class="sk-off" aria-hidden="true">${d}</span>`); continue; }
    const lbl = (state) => `aria-label="${fmt('th', 'busy.routine.skip.day.aria', { date: dateTh, state })}" data-aria-en="${fmt('en', 'busy.routine.skip.day.aria', { date: dateEn, state })}"`;
    if (mode === 'skip') {
      if (isSk) cells.push(`<button type="button" class="sk-day is-skipped" aria-disabled="true" ${lbl('skipped')}>${d}</button>`);
      else if (limit && !isPicked) cells.push(`<button type="button" class="sk-day is-locked" aria-disabled="true" aria-pressed="false" ${lbl('off')}>${d}</button>`);
      else cells.push(`<button type="button" class="sk-day" aria-pressed="${isPicked}" ${lbl(isPicked ? 'on' : 'off')}>${d}${isPicked ? ic('check') : ''}</button>`);
    } else if (isSk) {
      cells.push(`<button type="button" class="sk-day is-skipped" aria-pressed="${isPicked}" ${lbl(isPicked ? 'on' : 'skipped')}>${d}${isPicked ? ic('check') : ''}</button>`);
    } else {
      cells.push(`<button type="button" class="sk-day is-locked" aria-disabled="true" ${lbl('off')}>${d}</button>`);
    }
  }
  const dows = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => `<span>${T('calendar.dow.' + k)}</span>`).join('');
  const n = picked.length;
  const tabs = `<div class="segmented" style="grid-template-columns: repeat(2, 1fr); margin-top: var(--space-3)" role="group" ${A('busy.routine.skip.mode.label')}>
    <button type="button" aria-pressed="${mode === 'skip'}">${T('busy.routine.skip.mode.skip')}</button>
    <button type="button" aria-pressed="${mode === 'restore'}">${T('busy.routine.skip.mode.restore', { count: skipped.length })}</button></div>`;
  const nav = `<div class="sk-nav"><button type="button" class="icon-btn" ${month === '2026-11' ? 'aria-disabled="true"' : ''} ${A('busy.routine.skip.calendar.prev')}>${ic('chevron-left')}</button>
    <b aria-live="polite">${X(M.th, M.en)}</b><button type="button" class="icon-btn" ${month === '2026-12' ? 'aria-disabled="true"' : ''} ${A('busy.routine.skip.calendar.next')}>${ic('chevron-right')}</button></div>`;
  const legend = `<div class="sk-legend"><span><i class="sk-sw"></i>${T('busy.routine.skip.legend.available')}</span><span><i class="sk-sw sel">${ic('check')}</i>${T('busy.routine.skip.legend.selected')}</span>${skipped.length ? `<span><i class="sk-sw skp"></i>${T('busy.routine.skip.legend.skipped')}</span>` : ''}</div>`;
  const body = empty
    ? `${skipped.length ? tabs : ''}<div class="sk-empty">${cat('sleep', 'md')}<b>${T('busy.routine.skip.empty.title')}</b><p class="muted">${T('busy.routine.skip.empty.body')}</p></div>`
    : `<p>${T('busy.routine.skip.lead')}</p>${skipped.length ? tabs : ''}${nav}<div class="sk-dow" aria-hidden="true">${dows}</div><div class="sk-grid" role="group" ${A(mode === 'skip' ? 'busy.routine.skip.calendar.aria' : 'busy.routine.skip.restoreCalendarAria', { th: { month: M.th }, en: { month: M.en } })}>${cells.join('')}</div>${legend}
    <p class="sk-count" role="status">${T('busy.routine.skip.count', { count: n })}</p>
    ${limit ? `<p class="sk-limit">${ic('info')}<span>${T('busy.routine.skip.limit', { max: 31 })}</span></p>` : ''}
    <p class="sk-note">${T('busy.routine.skip.note')}</p>
    ${error ? `<div class="alert" role="alert" style="margin-top: var(--space-3)">${ic('circle-alert')}<div><span>${T('busy.routine.skip.error.' + error)}</span></div></div>` : ''}`;
  const foot = empty ? '' : `<div class="sk-foot"><button type="button" class="link-btn" ${n === 0 ? 'aria-disabled="true"' : ''}>${T('busy.routine.skip.clear')}</button>
    <button type="button" class="btn btn-primary" ${n === 0 ? 'aria-disabled="true"' : ''} ${saving ? 'aria-busy="true"' : ''}>${saving ? T('busy.routine.skip.saving') : T(mode === 'skip' ? 'busy.routine.skip.confirm' : 'busy.routine.skip.confirmRestore', { count: n })}</button></div>`;
  return sheetWrap('sk-t', T('busy.routine.skip.title'), body, foot);
}

function routineCard({ skipped = 2, ended = false, toast = null } = {}) {
  const remaining = 20 - skipped;
  return `<section class="rt-section"><div class="rt-head"><h3>${T('busy.routine.mine.title')}</h3><p class="small muted">${T('busy.routine.mine.lead')}</p></div>
  <div class="rows rt-list" style="margin-top: var(--space-3)"><div class="rt-item">
    <button type="button" class="row rt-open" style="text-align:left; width:100%; background:none; border:0; color:inherit; font:inherit"><span class="row-main"><span class="row-title">${X('ทำงาน', 'Work')}</span>
      <span class="row-meta">${X('จ.–ศ. · 09:00–18:00', 'Mon–Fri · 09:00–18:00')}</span>
      <span class="row-meta">${X('16 พ.ย. – 13 ธ.ค.', 'Nov 16 – Dec 13')} · <span class="rt-remaining">${T('busy.routine.mine.remaining', { count: remaining })}</span></span>
      ${skipped ? `<span class="sk-chip">${ic('calendar-x')}${T('busy.routine.skip.chip', { count: skipped })}</span>` : ''}</span>${ic('chevron-right', 'chev')}</button>
    <div class="sk-actions"><button type="button" class="btn btn-secondary" ${A('busy.routine.skip.buttonAria', { th: { title: 'ทำงาน' }, en: { title: 'Work' } })}>${ic('calendar-x')}<span>${T('busy.routine.skip.button')}</span></button>
      <button type="button" class="icon-btn" ${A('busy.routine.mine.deleteAria', { th: { title: 'ทำงาน' }, en: { title: 'Work' } })}>${ic('trash-2')}</button></div>
  </div></div>
  ${toast ? `<div class="sk-toast" role="status">${ic('circle-check')}<span>${T('busy.routine.skip.toast.' + toast, { count: 2 })}</span></div>` : ''}</section>`;
}

function appIcons() {
  const f = [['apple-touch-icon.png', 180, 'apple-touch-icon 180×180'], ['icon-192.png', 192, 'icon-192'], ['icon-512.png', 512, 'icon-512'], ['icon-maskable-512.png', 512, 'icon-maskable-512']];
  return `<div class="ico-sheet">${f.map(([n, , l]) => `<figure><img src="../../../public/brand/app/${n}" alt="${l}"><span>${l}</span></figure>`).join('')}
  <figure><img class="home-tile" src="../../../public/brand/app/apple-touch-icon.png" alt=""><span>${X('ที่ 60px (หน้าจอโฮม)', 'At 60px (home screen)')}</span></figure></div>`;
}

function allIcons() {
  return `<ul class="ico-sheet" style="list-style:none; padding:0">${GI.map((i) => `<li><figure>${tile(i.key, 'lg')}<span><code>${i.key}</code><br>${X(i.th, i.en)}${i.source === 'custom' ? '<br>★ custom' : ''}</span></figure></li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------- หน้า
const STATES = {
  picker: { title: ['ตัวเลือกไอคอน (เลือกแบดมินตัน)', 'Icon picker (badminton selected)'], bg: () => settingsSection('cat'), sheet: () => pickerSheet('badminton') },
  'picker-cat': { title: ['ตัวเลือกไอคอน (ค่าเริ่มต้น = แมว)', 'Icon picker (default = cat)'], bg: () => settingsSection('cat'), sheet: () => pickerSheet('cat') },
  'picker-saving': { title: ['กำลังบันทึก', 'Saving'], bg: () => settingsSection('cat'), sheet: () => pickerSheet('badminton', { saving: true }) },
  'picker-error': { title: ['บันทึกไม่สำเร็จ', 'Save failed'], bg: () => settingsSection('cat'), sheet: () => pickerSheet('badminton', { error: true }) },
  settings: { title: ['ตั้งค่ากลุ่ม (ผู้ดูแล/ผู้ช่วยดูแล)', 'Group settings (admin/moderator)'], main: () => settingsSection('badminton') },
  'settings-default': { title: ['ตั้งค่ากลุ่ม ยังไม่เลือก', 'Group settings, none picked'], main: () => settingsSection('cat') },
  'settings-member': { title: ['ตั้งค่ากลุ่ม (สมาชิก ดูอย่างเดียว)', 'Group settings (member, view only)'], main: () => settingsSection('badminton', { viewer: 'member' }) },
  where: { title: ['จุดที่แสดงไอคอน', 'Where the icon shows'], main: whereBlocks },
  all: { title: ['ไอคอนทั้ง 24 แบบ', 'All 24 icons'], main: allIcons },
  card: { title: ['การ์ดแบบประจำ มีปุ่ม "เว้นบางวัน"', 'Routine card with "Skip some days"'], main: () => routineCard() },
  'card-toast': { title: ['หลังเว้นสำเร็จ (toast)', 'After skipping (toast)'], main: () => routineCard({ skipped: 4, toast: 'skipped' }) },
  skip: { title: ['เลือกวันที่จะเว้น (เลือก 18, 19)', 'Picking days to skip (18, 19)'], bg: () => routineCard(), sheet: () => skipSheet() },
  'skip-none': { title: ['ยังไม่ได้เลือกวัน', 'No days picked'], bg: () => routineCard(), sheet: () => skipSheet({ picked: [] }) },
  'skip-next': { title: ['เดือนถัดไป (ธ.ค.)', 'Next month (Dec)'], bg: () => routineCard(), sheet: () => skipSheet({ month: '2026-12', picked: [1, 2, 3], skipped: [] }) },
  'skip-limit': { title: ['เลือกครบ 31 วัน (ตัวอย่างย่อ)', 'Hit the 31-day limit (shortened)'], bg: () => routineCard(), sheet: () => skipSheet({ picked: [16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 30], skipped: [], limit: true }) },
  'skip-restore': { title: ['แท็บ "วันที่เว้นไว้" เลือกคืน 24', 'Skipped tab, bringing back the 24th'], bg: () => routineCard(), sheet: () => skipSheet({ mode: 'restore', picked: [24], skipped: [24, 25] }) },
  'skip-saving': { title: ['กำลังบันทึก', 'Saving'], bg: () => routineCard(), sheet: () => skipSheet({ saving: true }) },
  'skip-error': { title: ['บันทึกไม่สำเร็จ', 'Save failed'], bg: () => routineCard(), sheet: () => skipSheet({ error: 'generic' }) },
  'skip-stale': { title: ['วันที่เลือกผ่านไปแล้ว', 'Picked days are stale'], bg: () => routineCard(), sheet: () => skipSheet({ error: 'stale' }) },
  'skip-empty': { title: ['ไม่เหลือวันให้เว้น', 'No days left to skip'], bg: () => routineCard({ skipped: 20 }), sheet: () => skipSheet({ empty: true }) },
  appicon: { title: ['ไอคอนแอป', 'App icon'], main: appIcons },
};

const page = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>R15a — ไอคอนกลุ่ม · เว้นบางวัน · ไอคอนแอป</title>
<link rel="stylesheet" href="fonts.css">
<link rel="stylesheet" href="../../../src/styles/tokens.css">
<link rel="stylesheet" href="../../../src/styles/members.css">
<link rel="stylesheet" href="../../../src/components/brand/aurora.css">
<link rel="stylesheet" href="app.css">
<link rel="stylesheet" href="../../../src/styles/routine.css">
<link rel="stylesheet" href="../../../src/styles/appointments.css">
<style>${CSS}</style>
<script src="sample.js"></script>
</head>
<body>
<div class="aurora" data-intensity="soft" aria-hidden="true"><div class="aurora-field"><span class="aurora-blob b1"></span><span class="aurora-blob b2"></span><span class="aurora-blob b3"></span><span class="aurora-blob b4"></span></div></div>
<div class="app">
  <header class="topbar"><h1 class="title">${X('R15a ตัวอย่าง', 'R15a samples')}</h1></header>
  <main class="main" style="padding-top: 0">
${Object.entries(STATES).map(([k, s], i) => `    <div data-state-show="${k}${i === 0 ? ' normal' : ''}"${i === 0 ? '' : ' hidden'}>
      <p class="demo-note">${X(s.title[0], s.title[1])}</p>
      ${s.main ? s.main() : s.bg()}
      ${s.sheet ? s.sheet() : ''}
    </div>`).join('\n')}
  </main>
</div>
<script>
  if (document.documentElement.lang === 'en') document.querySelectorAll('[data-aria-en]').forEach(function (e) { e.setAttribute('aria-label', e.getAttribute('data-aria-en')); });
</script>
</body>
</html>
`;
writeFileSync(resolve(here, '../samples/r15-feedback.html'), page);
console.log('สร้าง docs/design/samples/r15-feedback.html · states:', Object.keys(STATES).join(' '));
