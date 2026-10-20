// ตัวสร้างส่วนปฏิทิน/ฟอร์ม busy ของหน้าตัวอย่าง R3 (เรียกจาก build-samples.mjs)
// แทนแท็ก <gen-month scn="..."></gen-month> · <gen-day …> · <gen-picker …> · <gen-mine …> ด้วย markup จริง
// ข้อความมาจาก messages/*.json (data-m / data-m-aria) · วันที่จัดรูปด้วย Intl (th-TH-u-ca-buddhist / en-GB เหมือน ADR 0004 §6)
// ข้อมูลตัวอย่างเป็นข้อมูลสมมติ (วันนี้ในฉาก = 2026-10-20 18:00 ถ้าไม่ระบุ) · ไม่ใช้ใน src/ (ใช้ Date ได้ เพราะเป็นเครื่องมือเอกสาร อยู่นอกขอบเขต eslint)
export const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// ---------- วันที่ (ISO ค.ศ. ล้วน) ----------
const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s, n) => iso(parse(s) + n * 86400000);
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const dowMon = (s) => (new Date(parse(s)).getUTCDay() + 6) % 7; // 0 = จันทร์
export const monthGrid = (y, m) => {
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = iso(Date.UTC(y, m, 0));
  const from = addDays(first, -dowMon(first));
  const to = addDays(last, 6 - dowMon(last));
  return { first, last, from, to, weeks: (diffDays(from, to) + 1) / 7 };
};
const fmtCache = {};
const dtf = (loc, opts) => (fmtCache[loc + JSON.stringify(opts)] ||= new Intl.DateTimeFormat(loc, { timeZone: 'UTC', ...opts }));
const LOC = { th: 'th-TH-u-ca-buddhist-nu-latn', en: 'en-GB-u-nu-latn' };
const STYLES = {
  monthYear: { month: 'long', year: 'numeric' },
  long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  short: { day: 'numeric', month: 'short' },
  shortY: { day: 'numeric', month: 'short', year: 'numeric' },
  wdShort: { weekday: 'short', day: 'numeric', month: 'short' },
  month: { month: 'long', year: 'numeric' },
};
export const fmtDate = (lang, s, style) => dtf(LOC[lang], STYLES[style]).format(parse(s));
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const list = (lang, arr) => new Intl.ListFormat(lang === 'th' ? 'th' : 'en-GB', { style: 'long', type: 'conjunction' }).format(arr);

// ---------- ตัวช่วยสร้างข้อความ ----------
export const EN = {}; // data-t id → อังกฤษ (ผนวกเข้า window.MESSAGES_EN)
export const j = (o) => JSON.stringify(o).replace(/'/g, '&#39;');
export const T = (key, v) => `<span data-m="${key}"${v ? ` data-m-v='${j(v)}'` : ''}></span>`;
export const both = (f) => ({ th: f('th'), en: f('en') });
/** วันที่เป็นข้อความธรรมดา (th ใน HTML, en ผ่าน data-t) */
export const D = (s, style) => {
  const id = `d:${s}:${style}`; EN[id] = fmtDate('en', s, style);
  return `<span data-t="${id}">${fmtDate('th', s, style)}</span>`;
};
const TXT = (id, th, en) => { EN[id] = en; return `<span data-t="${id}">${th}</span>`; };

// ---------- สมาชิก + ข้อมูลตัวอย่าง ----------
export const MEMBERS = [
  { n: 'ต้นข้าว', slot: 1, me: true }, { n: 'ปาล์ม', slot: 3 }, { n: 'มายด์', slot: 5 }, { n: 'โอ๊ต', slot: 8 }, { n: 'ฟ้า', slot: 10 }, { n: 'บีม', slot: 2 },
  { n: 'นุ่น', slot: 4 }, { n: 'Kwan', slot: 6 }, { n: 'ณัฐพงศ์ วงศ์สวัสดิ์ศรีสกุล', slot: 7 }, { n: 'พลอย', slot: 9 }, { n: 'ไอซ์', slot: 1 }, { n: 'แพรว', slot: 2 },
];
export const initial = (name) => { const ch = [...name].find((c) => !'เแโใไ'.includes(c)) || name[0]; return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch; };
export const avatar = (m, cls = 'sm') => `<span class="member-avatar ${cls}" data-slot="${m.slot}" aria-hidden="true"><span class="member-initial">${initial(m.n)}</span></span>`;
const dot = (m) => `<span class="member-dot" data-slot="${m.slot}"></span>`;

// item: { m: index, sd, sm, ed, em, all, title, hidden }  (all = ทั้งวัน: sd..ed รวมปลาย · timed: sd sm → ed em)
export const A = (m, sd, ed, title, hidden = false) => ({ m, all: true, sd, ed, title, hidden });
export const Tm = (m, sd, sm, ed, em, title, hidden = false) => ({ m, all: false, sd, sm, ed, em, title, hidden });
export const H = (h, m = 0) => h * 60 + m;
export const ITEMS = {
  six: [
    Tm(0, '2026-10-20', H(19), '2026-10-20', H(21), 'ซ้อมดนตรี'),
    Tm(0, '2026-10-23', H(20), '2026-10-24', H(2), 'ดูหนังรอบดึก'),
    A(0, '2026-10-29', '2026-10-31', 'ไปเชียงใหม่'),
    Tm(1, '2026-10-23', H(8), '2026-10-23', H(13), 'ซ้อมดนตรี'),
    A(1, '2026-10-26', '2026-10-27', undefined, true),
    Tm(2, '2026-10-21', H(16), '2026-10-21', H(17, 30), 'เรียนว่ายน้ำ'),
    A(2, '2026-10-28', '2026-10-28', 'สอบกลางภาค'),
    A(3, '2026-10-22', '2026-10-24', 'ไปเที่ยวหัวหิน'),
    Tm(3, '2026-10-31', H(10), '2026-10-31', H(14), 'ตัดผม'),
    Tm(4, '2026-10-23', H(9), '2026-10-23', H(12), undefined, true),
    A(4, '2026-10-17', '2026-10-18', 'งานรับปริญญาน้อง'),
    Tm(5, '2026-10-22', H(22), '2026-10-23', H(6), 'เข้าเวรกลางคืน'),
    A(5, '2026-10-10', '2026-10-10', 'ไปหาหมอ', true),
    Tm(5, '2026-10-24', H(13), '2026-10-24', H(15), 'ประชุมชมรม'),
    Tm(1, '2026-10-20', H(9), '2026-10-20', H(11), 'เรียนพิเศษ'),
    Tm(4, '2026-10-20', H(12), '2026-10-20', H(13, 30), undefined, true),
  ],
  aug: [
    A(0, '2026-08-12', '2026-08-12', 'วันแม่'),
    A(1, '2026-08-01', '2026-08-02', 'ไปทะเล'),
    Tm(2, '2026-08-05', H(10), '2026-08-05', H(12), 'ประชุม'),
    A(3, '2026-08-31', '2026-08-31', undefined, true),
    Tm(5, '2026-08-05', H(18), '2026-08-05', H(21), 'ซ้อมวง'),
  ],
  dec: [
    Tm(0, '2026-12-31', H(22), '2027-01-01', H(2), 'ปาร์ตี้ข้ามปี'),
    A(1, '2026-12-24', '2026-12-26', 'กลับบ้านต่างจังหวัด'),
    A(2, '2026-12-05', '2026-12-05', 'วันพ่อ'),
    A(3, '2027-01-02', '2027-01-03', undefined, true),
    Tm(4, '2026-12-31', H(18), '2026-12-31', H(21), 'ดินเนอร์ครอบครัว'),
  ],
  feb: [
    A(0, '2027-02-01', '2027-02-03', 'อบรมที่ภูเก็ต'),
    A(1, '2027-02-14', '2027-02-14', undefined, true),
    Tm(2, '2027-02-28', H(9), '2027-02-28', H(12), 'วิ่งมินิมาราธอน'),
    Tm(3, '2027-02-10', H(19), '2027-02-10', H(22), 'ซ้อมวง'),
  ],
};
// 12 คน: สร้างแบบกำหนดได้ (ไม่สุ่ม) · 24 ต.ค. ติดครบ 12 คน · 17 ต.ค. 9 คน · 10 ต.ค. 7 คน · วันอื่นกระจาย
ITEMS.twelve = [];
for (let i = 0; i < 12; i++) {
  const t = H(7 + (i % 6), (i % 2) * 30);
  ITEMS.twelve.push(Tm(i, '2026-10-24', t, '2026-10-24', t + H(2 + (i % 3)), i % 4 === 3 ? undefined : ['ซ้อมวง', 'เรียนพิเศษ', 'ประชุมทีม', 'ไปตลาดนัด', 'ติวสอบ'][i % 5], i % 4 === 3));
  for (const d of [1, 3, 6, 9, 13, 15, 21, 27]) if ((i * 5 + d * 3) % 4 === 0) ITEMS.twelve.push(A(i, `2026-10-${String(d).padStart(2, '0')}`, `2026-10-${String(d).padStart(2, '0')}`, 'ติดธุระ'));
}
for (let i = 0; i < 9; i++) ITEMS.twelve.push(A(i, '2026-10-17', '2026-10-17', 'งานแต่ง'));
for (let i = 3; i < 10; i++) ITEMS.twelve.push(A(i, '2026-10-10', '2026-10-10', 'ติดธุระ'));
ITEMS.twelve.push(Tm(8, '2026-10-22', H(22), '2026-10-23', H(5), 'กะดึก'));

/** รายการที่แตะวัน d → [{item, from, to, cutStart, cutEnd, dayN, dayTotal}] */
export function onDay(items, d) {
  const out = [];
  for (const it of items) {
    if (it.all) {
      if (d < it.sd || d > it.ed) continue;
      out.push({ it, from: 0, to: 1440, cutStart: d > it.sd, cutEnd: d < it.ed, dayN: diffDays(it.sd, d) + 1, dayTotal: diffDays(it.sd, it.ed) + 1 });
    } else {
      const endDay = it.em === 0 && it.ed > it.sd ? addDays(it.ed, -1) : it.ed; // จบตรงเที่ยงคืน = วันสุดท้ายคือวันก่อนหน้า
      if (d < it.sd || d > endDay) continue;
      const from = d === it.sd ? it.sm : 0;
      const to = d === it.ed ? (it.em === 0 ? 1440 : it.em) : 1440;
      out.push({ it, from, to, cutStart: d > it.sd, cutEnd: d < it.ed && !(it.em === 0 && d === endDay), dayN: 1, dayTotal: 1 });
    }
  }
  return out;
}
const busyMembers = (items, d, n) => [...new Set(onDay(items, d).map((x) => x.it.m).filter((m) => m < n))].sort((a, b) => a - b);

// ---------- <gen-month> ----------
const MONTH_SCN = {
  normal: { y: 2026, m: 10, items: 'six', n: 6, today: '2026-10-20', sel: null },
  selected: { y: 2026, m: 10, items: 'six', n: 6, today: '2026-10-20', sel: '2026-10-23' },
  twelve: { y: 2026, m: 10, items: 'twelve', n: 12, today: '2026-10-20', sel: null },
  wk6: { y: 2026, m: 8, items: 'aug', n: 6, today: '2026-08-05', sel: null },
  wk4: { y: 2027, m: 2, items: 'feb', n: 6, today: '2027-02-09', sel: null },
  yearcross: { y: 2026, m: 12, items: 'dec', n: 6, today: '2026-12-24', sel: null },
  empty: { y: 2026, m: 11, items: [], n: 6, today: '2026-10-20', sel: null },
  solo: { y: 2026, m: 10, items: 'six', n: 1, today: '2026-10-20', sel: null },
};
function dots(ms, members) {
  const n = ms.length;
  if (n === 0) return '';
  if (n <= 8) return ms.map((m) => dot(members[m])).join('');
  const more = n - 6 <= 9 ? n - 6 : n - 5;
  const shown = n - 6 <= 9 ? 6 : 5;
  return ms.slice(0, shown).map((m) => dot(members[m])).join('') + `<span class="more${more >= 10 ? ' wide' : ''}" data-m="calendar.cell.more" data-m-v='{"count":${more}}'></span>`;
}
function monthBlock(sc, { loading = false } = {}) {
  const items = typeof sc.items === 'string' ? ITEMS[sc.items] : sc.items;
  const g = monthGrid(sc.y, sc.m);
  const members = MEMBERS.slice(0, sc.n);
  const ym = `${sc.y}-${String(sc.m).padStart(2, '0')}-01`;
  let cells = '';
  for (let k = 0; k < g.weeks * 7; k++) {
    const d = addDays(g.from, k);
    const outside = d < g.first || d > g.last;
    if (loading) { cells += '<span class="cal-cell is-skeleton" aria-hidden="true"></span>'; continue; }
    const ms = busyMembers(items, d, sc.n);
    const cls = ['cal-cell', outside && 'is-outside', d === sc.today && 'is-today', d === sc.sel && 'is-selected'].filter(Boolean).join(' ');
    const v = both((l) => ({ date: fmtDate(l, d, 'long'), today: d === sc.today ? 'yes' : 'no', outside: outside ? 'yes' : 'no', count: ms.length }));
    cells += `<button class="${cls}" data-m-aria="calendar.cell.aria" data-m-v='${j(v)}'><span class="dn" aria-hidden="true">${Number(d.slice(8))}</span><span class="cal-dots" aria-hidden="true">${dots(ms, members)}</span></button>`;
  }
  const dow = WEEK.map((w) => `<span class="cal-dow"><span aria-hidden="true" data-m="calendar.dow.${w}"></span><span class="sr-only" data-m="calendar.dowLong.${w}"></span></span>`).join('');
  const title = fmtDate('th', ym, 'monthYear');
  const monthAria = both((l) => ({ month: fmtDate(l, ym, 'monthYear') }));
  EN[`mt:${ym}`] = fmtDate('en', ym, 'monthYear');
  const nav = `<div class="cal-nav">
    <h2 id="mt-${sc.y}-${sc.m}" data-t="mt:${ym}">${title}</h2>
    <button class="icon-btn" data-m-aria="calendar.nav.prevMonth"><i data-icon="chevron-left"></i></button>
    <button class="icon-btn" data-m-aria="calendar.nav.nextMonth"><i data-icon="chevron-right"></i></button>
    <button class="btn btn-secondary" data-m="calendar.nav.today" data-m-aria="calendar.nav.todayAria"></button>
  </div>`;
  const who = `<ul class="cal-who" aria-label="">${members.map((m) => `<li>${dot(m)}<span class="nm">${m.n}</span>${m.me ? `<span class="you small muted" data-m="group.members.you"></span>` : ''}</li>`).join('')}</ul>`;
  return { nav, grid: `<div class="cal-month" role="group" aria-busy="${loading}" data-m-aria="calendar.month.gridAria" data-m-v='${j(monthAria)}'>${dow}${cells}</div>`, who, weeks: g.weeks, members };
}

// ---------- <gen-day> ----------
const DAY_SCN = {
  normal: { d: '2026-10-23', items: 'six', n: 6, today: '2026-10-20' },
  today: { d: '2026-10-20', items: 'six', n: 6, today: '2026-10-20', now: H(19, 30) },
  twelve: { d: '2026-10-24', items: 'twelve', n: 12, today: '2026-10-20' },
  empty: { d: '2026-11-03', items: [], n: 6, today: '2026-10-20' },
  long: { d: '2026-10-23', items: 'six', n: 6, today: '2026-10-20', long: true },
  aug: { d: '2026-08-05', items: 'aug', n: 6, today: '2026-08-05', now: H(11) },
  dec: { d: '2026-12-31', items: 'dec', n: 6, today: '2026-12-24' },
  feb: { d: '2027-02-10', items: 'feb', n: 6, today: '2027-02-09' },
  solo: { d: '2026-10-23', items: 'six', n: 1, today: '2026-10-20' },
};
export function itemLines(x, d) {
  const it = x.it; const lines = [];
  let when;
  if (it.all) when = T('calendar.day.allDay');
  else if (x.cutStart && x.cutEnd) when = T('calendar.day.allDay');
  else if (x.cutStart) when = T('calendar.day.fromPrev', { end: hhmm(it.em) });
  else if (x.cutEnd) when = T('calendar.day.toNext', { start: hhmm(it.sm) });
  else when = T('calendar.day.range', { start: hhmm(it.sm), end: hhmm(it.em === 0 ? 1440 : it.em) });
  const sub = it.all && x.dayTotal > 1 ? `<span class="sub">${T('calendar.day.dayOf', { n: x.dayN, total: x.dayTotal })}</span>` : '';
  const what = it.hidden || !it.title ? `<span class="what plain">${T('calendar.day.busyPlain')}</span>` : `<span class="what">${it.title}</span>`;
  return `<div class="cal-item"><span class="when">${when}</span>${what}${sub}</div>`;
}
function dayBlock(sc, { long = false } = {}) {
  const items = typeof sc.items === 'string' ? ITEMS[sc.items] : sc.items;
  const members = MEMBERS.slice(0, sc.n);
  const rows = []; const people = []; const idle = [];
  members.forEach((m, mi) => {
    const xs = onDay(items, sc.d).filter((x) => x.it.m === mi);
    const bars = xs.map((x) => `<span class="cal-bar${x.cutStart ? ' cut-start' : ''}${x.cutEnd ? ' cut-end' : ''}" data-slot="${m.slot}" style="--s:${(x.from / 14.4).toFixed(2)}%;--w:${((x.to - x.from) / 14.4).toFixed(2)}%"></span>`).join('');
    rows.push(`<div class="cal-row"><span class="cal-name">${avatar(m)}<span class="nm">${m.n}</span></span><span class="cal-track" aria-hidden="true">${bars}</span></div>`);
    if (xs.length) people.push(`<li class="cal-person">${avatar(m, 'sm')}<span class="pn">${m.n}${m.me ? ` <span class="you small muted" data-m="group.members.you"></span>` : ''}</span><div class="items">${xs.sort((a, b) => a.from - b.from).map((x) => itemLines(x, sc.d)).join('')}</div></li>`);
    else idle.push(m.n);
  });
  const total = sc.n; const count = members.filter((_, mi) => onDay(items, sc.d).some((x) => x.it.m === mi)).length;
  const axis = [0, 6, 12, 18, 24].map((h) => `<span style="--at:${(h / 24 * 100)}%">${String(h).padStart(2, '0')}</span>`).join('');
  const now = sc.now != null ? `<div class="cal-now-layer" aria-hidden="true"><span class="cal-now-tag" style="--at:${(sc.now / 14.4).toFixed(2)}%" data-m="calendar.day.now"></span><span class="cal-now" style="--at:${(sc.now / 14.4).toFixed(2)}%"></span></div>` : '';
  const names = both((l) => ({ names: list(l, idle) }));
  const head = `<div class="cal-day-head">
    <h2>${D(sc.d, 'long')}</h2>
    <button class="icon-btn" data-m-aria="calendar.nav.prevDay"><i data-icon="chevron-left"></i></button>
    <button class="icon-btn" data-m-aria="calendar.nav.nextDay"><i data-icon="chevron-right"></i></button>
    <button class="btn btn-secondary" data-m="calendar.nav.today" data-m-aria="calendar.nav.todayAria"></button>
  </div>
  <p class="cal-summary" role="status">${T('calendar.day.summary', { count, total })}</p>`;
  const timeline = `<section class="cal-card" aria-labelledby="tl-h">
    <h3 id="tl-h" data-m="calendar.day.timeline"></h3>
    <div class="cal-axis" aria-hidden="true">${axis}</div>
    <div class="cal-rows">${rows.join('')}${now}</div>
    <p class="hint-line" data-m="calendar.day.timelineHint"></p>
  </section>`;
  const listing = people.length
    ? `<section class="cal-card" aria-labelledby="ls-h"><h3 id="ls-h" data-m="calendar.day.listTitle"></h3><ul class="cal-people">${people.join('')}</ul>${idle.length ? `<p class="cal-others" data-m="calendar.day.othersFree" data-m-v='${j(names)}'></p>` : ''}</section>`
    : `<section class="empty panel" style="margin-top: var(--space-4)"><i data-cat="calendar"></i><h3 class="h-section" data-m="calendar.day.empty.title" data-m-v='{"when":"${sc.d === sc.today ? 'today' : 'other'}"}'></h3><p class="muted" data-m="calendar.day.empty.body"></p><button class="btn btn-primary"><i data-icon="plus"></i><span data-m="busy.add"></span></button></section>`;
  return { head, timeline, listing };
}

// ---------- <gen-picker> ----------
const PICK_SCN = {
  allday: { y: 2026, m: 10, s: '2026-10-23', e: '2026-10-23', today: '2026-10-20' },
  multi: { y: 2026, m: 10, s: '2026-10-29', e: '2026-11-01', today: '2026-10-20' },
  timed: { y: 2026, m: 10, s: '2026-10-23', e: '2026-10-24', today: '2026-10-20' },
  past: { y: 2026, m: 10, s: '2026-10-12', e: '2026-10-12', today: '2026-10-20' },
  long: { y: 2026, m: 10, s: '2026-10-29', e: '2027-11-05', today: '2026-10-20' },
  timed1: { y: 2026, m: 10, s: '2026-10-23', e: '2026-10-23', today: '2026-10-20' },
  edit: { y: 2026, m: 10, s: '2026-10-29', e: '2026-10-31', today: '2026-10-20' },
};
function pickerBlock(sc) {
  const g = monthGrid(sc.y, sc.m); const min = addDays(sc.today, -7); // ลงย้อนหลังได้ ≤ 7 วัน
  const ym = `${sc.y}-${String(sc.m).padStart(2, '0')}-01`; EN[`mt:${ym}`] = fmtDate('en', ym, 'monthYear');
  let cells = '';
  for (let k = 0; k < g.weeks * 7; k++) {
    const d = addDays(g.from, k);
    const outside = d < g.first || d > g.last;
    const isS = d === sc.s, isE = d === sc.e, inR = d > sc.s && d < sc.e;
    const cls = ['pk-cell', outside && 'is-outside', d === sc.today && 'is-today', isS && 'is-start', isE && 'is-end', isS && sc.e !== sc.s && 'has-range', inR && 'is-range'].filter(Boolean).join(' ');
    const dis = d < min;
    const id = `d:${d}:long`; EN[id] = fmtDate('en', d, 'long');
    cells += `<button class="${cls}"${dis ? ' aria-disabled="true"' : ''}${isS || isE ? ' aria-pressed="true"' : ''} aria-label="${fmtDate('th', d, 'long')}" data-t-aria="${id}">${Number(d.slice(8))}</button>`;
  }
  const dow = WEEK.map((w) => `<span class="cal-dow"><span aria-hidden="true" data-m="calendar.dow.${w}"></span><span class="sr-only" data-m="calendar.dowLong.${w}"></span></span>`).join('');
  const monthAria = both((l) => ({ month: fmtDate(l, ym, 'monthYear') }));
  return `<div class="cal-picker"><div class="cal-nav"><button class="icon-btn" data-m-aria="calendar.nav.prevMonth"><i data-icon="chevron-left"></i></button><h3 style="flex:1;text-align:center;font-size:var(--text-md);font-weight:var(--weight-semibold)" data-t="mt:${ym}">${fmtDate('th', ym, 'monthYear')}</h3><button class="icon-btn" data-m-aria="calendar.nav.nextMonth"><i data-icon="chevron-right"></i></button></div><div class="cal-month" role="group" data-m-aria="calendar.month.gridAria" data-m-v='${j(monthAria)}'>${dow}${cells}</div></div>`;
}

// ---------- <gen-mine> ----------
const MINE = [
  { all: false, sd: '2026-10-20', sm: H(19), ed: '2026-10-20', em: H(21), title: 'ซ้อมดนตรี', ongoing: true },
  { all: false, sd: '2026-10-23', sm: H(20), ed: '2026-10-24', em: H(2), title: 'ดูหนังรอบดึก' },
  { all: true, sd: '2026-10-29', ed: '2026-10-31', title: 'ไปเชียงใหม่', note: true },
  { all: true, sd: '2026-11-07', ed: '2026-11-07', title: 'งานแต่งเพื่อน', hidden: true, note: true },
  { all: false, sd: '2026-11-14', sm: H(9), ed: '2026-11-14', em: H(12) },
  { all: true, sd: '2026-12-24', ed: '2026-12-26', title: 'กลับบ้านต่างจังหวัด' },
];
function whenText(it) {
  if (it.all && it.sd === it.ed) return { key: 'busy.when.allDay', v: both((l) => ({ date: fmtDate(l, it.sd, 'wdShort') })) };
  if (it.all) return { key: 'busy.when.days', v: both((l) => ({ start: fmtDate(l, it.sd, 'short'), end: fmtDate(l, it.ed, 'short'), count: diffDays(it.sd, it.ed) + 1 })) };
  if (it.sd === it.ed) return { key: 'busy.when.timed', v: both((l) => ({ date: fmtDate(l, it.sd, 'wdShort'), start: hhmm(it.sm), end: hhmm(it.em) })) };
  return { key: 'busy.when.timedSpan', v: both((l) => ({ startDate: fmtDate(l, it.sd, 'short'), start: hhmm(it.sm), endDate: fmtDate(l, it.ed, 'short'), end: hhmm(it.em) })) };
}
function mineBlock() {
  let cur = ''; let out = '';
  for (const it of MINE) {
    const ym = it.sd.slice(0, 7) + '-01';
    if (ym !== cur) { cur = ym; EN[`mt:${ym}`] = fmtDate('en', ym, 'monthYear'); out += `${out ? '</ul>' : ''}<h3 class="busy-month" data-t="mt:${ym}">${fmtDate('th', ym, 'monthYear')}</h3><ul class="rows busy-list">`; }
    const w = whenText(it);
    const tag = (cls, icon, key) => `<span class="tag ${cls}"><i data-icon="${icon}"></i><span data-m="${key}"></span></span>`;
    const tags = [it.ongoing && tag('tag-busy', 'clock', 'busy.mine.ongoing'), it.hidden && tag('tag-muted', 'eye-off', 'busy.mine.hiddenTag'), it.note && tag('tag-muted', 'lock', 'busy.mine.hasNote')].filter(Boolean).join('');
    const titleHtml = it.title ? `<span class="row-title">${it.title}</span>` : `<span class="row-title plain" data-m="busy.mine.noTitle"></span>`;
    const aria = both((l) => ({ title: it.title || msg(l, 'busy.mine.noTitle'), when: msg(l, w.key, w.v[l]) }));
    out += `<li><button class="row" data-m-aria="busy.mine.openAria" data-m-v='${j(aria)}'>
      <span class="datebox"><span class="d">${Number(it.sd.slice(8))}</span><span class="m">${D(it.sd, 'monthOnly') }</span></span>
      <span class="row-main">${titleHtml}<span class="row-meta">${T(w.key, w.v)}</span>${tags ? `<span class="tags">${tags}</span>` : ''}</span>
      <i data-icon="chevron-right" class="chev"></i></button></li>`;
  }
  return out + '</ul>';
}
export let msg = () => { throw new Error('เรียก setIntl() ก่อน'); };
export function setIntl(IntlMessageFormat, MSG) {
  msg = (l, key, v) => String(new IntlMessageFormat(key.split('.').reduce((o, k) => o[k], MSG[l]), l).format(v || {}));
}
STYLES.monthOnly = { month: 'short' };

// ---------- แทนแท็ก ----------
export function expandCalendar(html) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  html = html.replace(/<gen-month([^>]*)><\/gen-month>/g, (_, a) => {
    const at = attrs(a); const sc = { ...MONTH_SCN[at.scn], ...(at.sel ? { sel: at.sel } : {}) }; if (!MONTH_SCN[at.scn]) throw new Error('gen-month scn ' + at.scn);
    const b = monthBlock(sc, { loading: at.loading === '1' });
    return `<div data-weeks="${b.weeks}">${b.nav}${b.grid}${at.nolegend ? '' : `<div class="cal-legend"><h3 class="sub-h" style="margin-top: var(--space-3)" data-m="calendar.busyLegend.whoTitle"></h3>${b.who}<p class="cal-note" data-m="calendar.busyLegend.hint"></p>${b.members.length > 10 ? '<p class="cal-note" data-m="calendar.busyLegend.sameColour"></p>' : ''}</div>`}</div>`;
  });
  html = html.replace(/<gen-day([^>]*)><\/gen-day>/g, (_, a) => {
    const at = attrs(a); const sc = DAY_SCN[at.scn]; if (!sc) throw new Error('gen-day scn ' + at.scn);
    const b = dayBlock(sc);
    return b.head + b.timeline + b.listing;
  });
  html = html.replace(/<gen-picker([^>]*)><\/gen-picker>/g, (_, a) => pickerBlock(PICK_SCN[attrs(a).scn]));
  html = html.replace(/<gen-mine([^>]*)><\/gen-mine>/g, () => mineBlock());
  html = html.replace(/<gen-d([^>]*)><\/gen-d>/g, (_, a) => { const at = attrs(a); return D(at.iso, at.style); });
  const sumOf = (at) => {
    const sc = PICK_SCN[at.scn];
    const sm = at.sm != null ? Number(at.sm) : H(22), em = at.em != null ? Number(at.em) : H(6);
    const mk = { allday: { all: true, sd: sc.s, ed: sc.s }, multi: { all: true, sd: sc.s, ed: sc.e }, timed: { all: false, sd: sc.s, sm, ed: sc.e, em } }[at.kind];
    return whenText(mk);
  };
  html = html.replace(/<gen-sum([^>]*)><\/gen-sum>/g, (_, a) => { const w = sumOf(attrs(a)); return T(w.key, w.v); });
  html = html.replace(/<gen-datebtn([^>]*)><\/gen-datebtn>/g, (_, a) => { // ปุ่มช่องวันที่ (เปิด/ปิดตัวเลือกวัน)
    const at = attrs(a); const w = sumOf(at);
    const aria = both((l) => ({ summary: msg(l, w.key, w.v[l]) }));
    return `<button class="input select" aria-expanded="${at.open === '1'}"${at.invalid ? ' aria-invalid="true"' : ''} data-m-aria="busy.form.date.toggleAria" data-m-v='${j(aria)}'><i data-icon="calendar"></i><span style="flex:1; text-align:left">${T(w.key, w.v)}</span><i data-icon="chevron-down"></i></button>`;
  });
  html = html.replace(/<gen-dur([^>]*)><\/gen-dur>/g, (_, a) => { // รวม … (เวลา)
    const min = Number(attrs(a).min); const h = Math.floor(min / 60), mi = min % 60;
    const key = mi === 0 ? 'busy.duration.hour' : h === 0 ? 'busy.duration.min' : 'busy.duration.hourMin';
    const total = both((l) => msg(l, key, { hours: h, minutes: mi }));
    return T('busy.form.total', both((l) => ({ total: total[l] })));
  });
  html = html.replace(/<gen-days([^>]*)><\/gen-days>/g, (_, a) => T('busy.form.totalDays', { count: Number(attrs(a).n) }));
  return html;
}
export const takeEn = () => { const o = { ...EN }; for (const k of Object.keys(EN)) delete EN[k]; return o; };
