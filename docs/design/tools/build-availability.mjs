// ตัวสร้างหน้าจอ "วันที่ว่างตรงกัน" ของหน้าตัวอย่าง R4A (เรียกจาก build-samples.mjs)
// แทนแท็ก <gen-avpage scn="..." sel="YYYY-MM-DD" sheet="0|1" role="admin|member"></gen-avpage> ด้วย markup จริง
// คำนวณผลด้วยอัลกอริทึมของ ADR 0005 ฉบับย่อ (ช่วงเวลา busy เป็นนาทีของวัน · ข้อมูลสมมติ) เพื่อให้ตัวอย่างตรงกับกติกาจริง
// ข้อความมาจาก messages/*.json (data-m / data-m-aria) · ไม่ใช้ใน src/ (ใช้ Date ได้ เพราะเป็นเครื่องมือเอกสาร)
import {
  WEEK, addDays, diffDays, monthGrid, fmtDate, hhmm, list, EN, j, T, both, D, MEMBERS, avatar, ITEMS, onDay, itemLines, A, Tm, H, msg,
} from './build-calendar.mjs';

const WIN = { s: H(8), e: H(22), min: 120 }; // ค่าเริ่มต้นของกลุ่ม (D9)

// ---------- ข้อมูลตัวอย่าง (วันนี้ในฉาก = 2026-10-20) ----------
// สมาชิก: 0 ต้นข้าว (คุณ) · 1 ปาล์ม · 2 มายด์ · 3 โอ๊ต · 4 ฟ้า · 5 บีม
const AV_SIX = [
  Tm(0, '2026-10-20', H(19), '2026-10-20', H(21), 'ซ้อมดนตรี'),
  Tm(1, '2026-10-20', H(9), '2026-10-20', H(11), 'เรียนพิเศษ'),
  Tm(4, '2026-10-20', H(12), '2026-10-20', H(13, 30), undefined, true),
  Tm(5, '2026-10-20', H(14), '2026-10-20', H(20), 'ติวสอบ'),                    // 20 ต.ค.: ทุกคนว่างรายคน แต่ไม่ตรงช่วง (T24)
  Tm(2, '2026-10-21', H(16), '2026-10-21', H(17, 30), 'เรียนว่ายน้ำ'),
  A(1, '2026-10-21', '2026-10-21', 'ไปงานศพญาติ'),                                // 21: 5/6
  A(3, '2026-10-22', '2026-10-22', 'ไปเที่ยวหัวหิน'),
  A(4, '2026-10-22', '2026-10-22', 'งานรับปริญญาน้อง'),                           // 22: 4/6
  Tm(1, '2026-10-23', H(8), '2026-10-23', H(13), 'ซ้อมดนตรี'),
  A(3, '2026-10-23', '2026-10-23', 'ไปเที่ยวหัวหิน'),
  Tm(4, '2026-10-23', H(9), '2026-10-23', H(12), undefined, true),                 // 23: 5/6
  ...[0, 1, 2, 3, 4, 5].map((m) => A(m, '2026-10-24', '2026-10-24', m === 2 ? undefined : 'งานโรงเรียน', m === 2)), // 24: 0/6
  Tm(0, '2026-10-25', H(10), '2026-10-25', H(12), 'ตัดผม'),
  Tm(1, '2026-10-25', H(14), '2026-10-25', H(16), 'ฟิตเนส'),                      // 25: ว่างร่วม (T2) → 08–10 · 12–14 · 16–22
  A(1, '2026-10-26', '2026-10-27', undefined, true),
  A(2, '2026-10-28', '2026-10-28', 'สอบกลางภาค'), A(5, '2026-10-28', '2026-10-28', 'ไปหาหมอ'),
  A(0, '2026-10-29', '2026-10-31', 'ไปเชียงใหม่'), A(3, '2026-10-29', '2026-10-29', 'ติดงาน'), A(4, '2026-10-29', '2026-10-29', 'ติดงาน'),
  A(1, '2026-10-30', '2026-10-30', 'ติดงาน'), A(3, '2026-10-30', '2026-10-30', 'ติดงาน'), A(4, '2026-10-30', '2026-10-30', 'ติดงาน'),
  Tm(3, '2026-10-31', H(10), '2026-10-31', H(14), 'ตัดผม'),
  Tm(4, '2026-10-17', H(9), '2026-10-17', H(12), 'ซ้อมวง'),
  A(4, '2026-11-01', '2026-11-01', 'ไปเที่ยวหัวหิน'),
];
// ไม่มีวันว่างร่วมเหลือเลยตั้งแต่ 26 ต.ค. (ใช้ today = 26)
const AV_CROWDED = [...AV_SIX, A(2, '2026-11-01', '2026-11-01', 'ติดธุระ')];
// ไม่มีวันว่างร่วม และวันที่ใกล้ที่สุดเป็นแบบ "ว่างครบแต่ไม่ตรงช่วง" (20 ต.ค.)
const AV_NOCOMMON_BEST = [...AV_SIX, A(1, '2026-10-25', '2026-10-25', 'ติดงาน')];
const AV_TWELVE = [...ITEMS.twelve];
const AV_AUG = [...ITEMS.aug];
const AV_FEB = [...ITEMS.feb];

const SC = {
  normal: { y: 2026, m: 10, items: AV_SIX, n: 6, today: '2026-10-20' },
  none: { y: 2026, m: 10, items: AV_CROWDED, n: 6, today: '2026-10-26' },
  nocommonbest: { y: 2026, m: 10, items: AV_NOCOMMON_BEST, n: 6, today: '2026-10-20' },
  nobody: { y: 2026, m: 10, items: [], n: 6, today: '2026-10-20', nobody: true },
  twelve: { y: 2026, m: 10, items: AV_TWELVE, n: 12, today: '2026-10-20' },
  wk6: { y: 2026, m: 8, items: AV_AUG, n: 6, today: '2026-08-05' },
  wk4: { y: 2027, m: 2, items: AV_FEB, n: 6, today: '2027-02-09' },
  truncated: { y: 2026, m: 10, items: AV_SIX, n: 6, today: '2026-10-20', truncated: true },
  loading: { y: 2026, m: 10, items: [], n: 6, today: '2026-10-20', loading: true },
  solo: { y: 2026, m: 10, items: AV_SIX, n: 1, today: '2026-10-20' },
};

// ---------- คำนวณ (ADR 0005 ฉบับย่อ) ----------
const merge = (iv) => { const a = iv.slice().sort((x, y) => x[0] - y[0]); const out = []; for (const [s, e] of a) { const l = out[out.length - 1]; if (l && s <= l[1]) l[1] = Math.max(l[1], e); else out.push([s, e]); } return out; };
const gaps = (mg) => { let cur = WIN.s; const g = []; for (const [s, e] of mg) { if (s > cur) g.push([cur, s]); cur = Math.max(cur, e); } if (cur < WIN.e) g.push([cur, WIN.e]); return g; };
function dayInfo(sc, d) {
  const xs = onDay(sc.items, d).filter((x) => x.it.m < sc.n);
  const per = Array.from({ length: sc.n }, () => ({ allDay: false, iv: [], rows: [] }));
  for (const x of xs) {
    const p = per[x.it.m];
    if (x.it.all) { p.allDay = true; p.rows.push(x); continue; }
    const s = Math.max(x.from, WIN.s), e = Math.min(x.to, WIN.e);
    if (e > s) { p.iv.push([s, e]); p.rows.push(x); }
  }
  const memberFree = per.map((p) => !p.allDay && gaps(merge(p.iv)).some((g) => g[1] - g[0] >= WIN.min));
  const anyAll = per.some((p) => p.allDay);
  const segments = anyAll ? [] : gaps(merge(per.flatMap((p) => p.iv))).filter((g) => g[1] - g[0] >= WIN.min);
  const free = memberFree.filter(Boolean).length;
  const allFree = segments.length > 0;
  const state = allFree ? 'all' : free === 0 ? 'none' : free === sc.n ? 'nocommon' : 'partial';
  return { d, per, memberFree, segments, free, total: sc.n, allFree, state };
}

// ---------- ตัวช่วยข้อความ ----------
const dur = (l, min) => { const h = Math.floor(min / 60), mi = min % 60; return msg(l, `busy.duration.${mi === 0 ? 'hour' : h === 0 ? 'min' : 'hourMin'}`, { hours: h, minutes: mi }); };
const names = (l, arr) => (arr.length <= 3 ? list(l, arr) : msg(l, 'availability.day.names.more', { names: arr.slice(0, 3).join(', '), count: arr.length - 3 }));
const icon = (n, c = '') => `<i data-icon="${n}"${c ? ` class="${c}"` : ''}></i>`;
const badge = () => `<span class="av-badge" aria-hidden="true">${icon('check')}</span>`;
const lvl = (free, total) => (free / total < 0.5 ? 'l-few' : free / total < 0.75 ? 'l-low' : 'l-mid');
const stateCls = (i) => (i.state === 'partial' ? `is-partial ${lvl(i.free, i.total)}` : `is-${i.state}`);
const frac = (i) => `<span class="av-frac">${T('availability.cell.fraction', { free: i.free, total: i.total })}</span>`;
const longest = (segs) => segs.reduce((b, s) => (!b || s[1] - s[0] > b[1] - b[0] ? s : b), null);

// ---------- เดือน ----------
function monthBlock(sc, sel, infos) {
  const g = monthGrid(sc.y, sc.m);
  const ym = `${sc.y}-${String(sc.m).padStart(2, '0')}-01`;
  EN[`mt:${ym}`] = fmtDate('en', ym, 'monthYear');
  let cells = '';
  for (let k = 0; k < g.weeks * 7; k++) {
    const d = addDays(g.from, k);
    const outside = d < g.first || d > g.last;
    if (sc.loading) { cells += '<span class="cal-cell is-skeleton" aria-hidden="true"></span>'; continue; }
    const past = d < sc.today;
    const i = infos[d];
    const state = past ? 'past' : i.state;
    const cls = ['cal-cell', 'av-cell', past ? 'is-past' : stateCls(i), outside && 'is-outside', d === sc.today && 'is-today', d === sel && 'is-selected'].filter(Boolean).join(' ');
    const v = both((l) => ({ date: fmtDate(l, d, 'long'), today: d === sc.today ? 'yes' : 'no', outside: outside ? 'yes' : 'no', state, free: i.free, total: i.total }));
    const mark = past ? '' : i.state === 'all' ? badge() : frac(i);
    cells += `<button class="${cls}"${past ? ' aria-disabled="true"' : ''}${d === sel ? ' aria-pressed="true"' : ''} data-m-aria="availability.cell.aria" data-m-v='${j(v)}'><span class="dn" aria-hidden="true">${Number(d.slice(8))}</span><span class="av-mark" aria-hidden="true">${mark}</span></button>`;
  }
  const dow = WEEK.map((w) => `<span class="cal-dow"><span aria-hidden="true" data-m="calendar.dow.${w}"></span><span class="sr-only" data-m="calendar.dowLong.${w}"></span></span>`).join('');
  const monthAria = both((l) => ({ month: fmtDate(l, ym, 'monthYear') }));
  const nav = sc.loading
    ? `<div class="cal-nav"><button class="icon-btn" disabled data-m-aria="calendar.nav.prevMonth">${icon('chevron-left')}</button><div class="skeleton" style="flex:1; height: var(--space-5)"></div><button class="icon-btn" disabled data-m-aria="calendar.nav.nextMonth">${icon('chevron-right')}</button></div>`
    : `<div class="cal-nav">
    <h2 id="mt-${sc.y}-${sc.m}" data-t="mt:${ym}">${fmtDate('th', ym, 'monthYear')}</h2>
    <button class="icon-btn" data-m-aria="calendar.nav.prevMonth">${icon('chevron-left')}</button>
    <button class="icon-btn" data-m-aria="calendar.nav.nextMonth">${icon('chevron-right')}</button>
    <button class="btn btn-secondary" data-m="calendar.nav.today" data-m-aria="calendar.nav.todayAria"></button>
  </div>`;
  return `<div data-weeks="${g.weeks}">${nav}<div class="cal-month" role="group" data-m-aria="calendar.month.gridAria" data-m-v='${j(monthAria)}'>${dow}${cells}</div></div>`;
}

// ---------- การ์ดสรุป ----------
function summaryBlock(sc, infos, role) {
  if (sc.loading) return '<div class="av-summary is-loading" aria-hidden="true"></div>';
  const g = monthGrid(sc.y, sc.m);
  const days = []; for (let k = 0; k < g.weeks * 7; k++) days.push(addDays(g.from, k));
  const future = days.filter((d) => d >= sc.today).map((d) => infos[d]);
  const firstAll = future.find((i) => i.allFree);
  if (firstAll) {
    const rel = diffDays(sc.today, firstAll.d);
    const best = longest(firstAll.segments);
    const count = future.filter((i) => i.allFree).length;
    const aria = both((l) => ({ date: fmtDate(l, firstAll.d, 'long') }));
    const bestV = both((l) => ({ start: hhmm(best[0]), end: hhmm(best[1]), duration: dur(l, best[1] - best[0]) }));
    return `<button class="av-summary" data-m-aria="availability.summary.openAria" data-m-v='${j(aria)}'>
      ${badge()}
      <span><span class="st" data-m="availability.summary.title"></span>
        <span class="when"><b>${D(firstAll.d, 'wdShort')}</b><span class="rel">${T('availability.summary.relative', { days: rel })}</span></span>
        <span class="best">${T('availability.summary.best', bestV)}</span>
        ${count >= 2 ? `<span class="more">${T('availability.summary.count', { count })}</span>` : ''}</span>
      ${icon('chevron-right', 'chev')}
    </button>`;
  }
  // ไม่มีวันว่างร่วม: แสดงวันที่ใกล้ที่สุด (ว่างมากสุด เท่ากันเอาวันก่อน)
  const best = future.reduce((b, i) => (!b || i.free > b.free ? i : b), null);
  let closest = '';
  if (best && best.free > 0) {
    if (best.state === 'nocommon') closest = `<p class="hl">${T('availability.summary.none.closestNoOverlap', both((l) => ({ date: fmtDate(l, best.d, 'wdShort') })))}</p>`;
    else {
      closest = `<p class="hl">${T('availability.summary.none.closest', both((l) => ({ date: fmtDate(l, best.d, 'wdShort'), free: best.free, total: best.total })))}</p>`;
      const bl = MEMBERS.slice(0, sc.n).filter((_, mi) => !best.memberFree[mi]).map((m) => m.n);
      closest += `<p>${T('availability.summary.none.blockers', both((l) => ({ names: names(l, bl) })))}</p>`;
    }
  }
  const edit = role === 'admin' ? `<a class="av-link" href="#" data-m="availability.window.edit" data-m-aria="availability.window.editAria"></a>` : '';
  return `<section class="av-summary is-none" role="status"><span class="st" data-m="availability.summary.none.title"></span>${closest}
    <div class="actions"><button class="btn btn-secondary"><span data-m="availability.summary.none.next"></span>${icon('chevron-right')}</button>${edit}</div></section>`;
}

// ---------- คำอธิบายช่อง + บรรทัดข้อมูล ----------
function legendBlock() {
  const row = (cls, mark, key) => `<li><span class="av-sw ${cls}" aria-hidden="true">${mark}</span><span data-m="availability.legend.${key}"></span></li>`;
  const f = (a, b) => `<span class="av-frac">${a}/${b}</span>`;
  return `<section class="av-legend" aria-labelledby="av-lg-h"><h3 id="av-lg-h" data-m="availability.legend.title"></h3><ul>
    ${row('is-all', badge(), 'all')}
    ${row('is-nocommon', f(6, 6), 'nocommon')}
    ${row('is-partial l-mid', f(4, 6), 'partial')}
    ${row('is-partial l-few', f(2, 6), 'few')}
    ${row('is-none', f(0, 6), 'none')}
  </ul><p class="av-note-fraction" data-m="availability.legend.fractionNote"></p></section>`;
}
function infoBlock(role) {
  const v = both((l) => ({ start: hhmm(WIN.s), end: hhmm(WIN.e), duration: dur(l, WIN.min) }));
  const tail = role === 'admin'
    ? `<a class="av-link" href="#" data-m="availability.window.edit" data-m-aria="availability.window.editAria"></a>`
    : `<span class="av-admin-only" data-m="availability.window.adminOnly"></span>`;
  return `<p class="av-info">${icon('info')}<span data-m="availability.explain"></span></p>
  <div class="av-window"><span class="lbl" data-m="availability.window.title"></span><span class="val">${T('availability.window.line', v)}</span>${tail}</div>`;
}

// ---------- รายละเอียดวัน ----------
function detailBody(sc, i) {
  const members = MEMBERS.slice(0, sc.n);
  const notFree = members.filter((_, mi) => !i.memberFree[mi]);
  const d = i.d;
  let status;
  if (i.state === 'all') status = `<div class="av-status is-all" role="status">${badge()}<div><b data-m="availability.day.status.all"></b><span>${T('availability.day.status.allBody', { total: i.total })}</span></div></div>`;
  else if (i.state === 'partial') status = `<div class="av-status is-partial" role="status"><span class="ico" aria-hidden="true">${icon('users')}</span><div><b>${T('availability.day.status.partial', { free: i.free, total: i.total })}</b><span>${T('availability.day.status.partialBody', both((l) => ({ names: names(l, notFree.map((m) => m.n)) })))}</span></div></div>`;
  else if (i.state === 'nocommon') status = `<div class="av-status is-nocommon" role="status"><span class="ico" aria-hidden="true">${icon('circle-dashed')}</span><div><b data-m="availability.day.status.nocommon"></b><span>${T('availability.day.status.nocommonBody', both((l) => ({ duration: dur(l, WIN.min) })))}</span></div></div>`;
  else status = `<div class="av-status is-none" role="status"><span class="ico" aria-hidden="true">${icon('ban')}</span><div><b data-m="availability.day.status.none"></b><span>${T('availability.day.status.noneBody', both((l) => ({ duration: dur(l, WIN.min) })))}</span></div></div>`;

  let segs = '';
  if (i.segments.length) {
    const lg = i.segments.length > 1 ? longest(i.segments) : null;
    segs = `<h3 class="sub" data-m="availability.day.segments.title"></h3><ul class="av-segs">${i.segments.map((s) => {
      const dm = s[1] - s[0]; const dk = dm % 60 === 0 ? 'hour' : Math.floor(dm / 60) === 0 ? 'min' : 'hourMin';
      return `<li><button type="button" class="av-seg av-seg-btn" ${'data-m-aria="availability.day.segments.createAria"'} data-m-v='${JSON.stringify({ start: hhmm(s[0]), end: hhmm(s[1]) })}'>${icon('clock')}<span class="tm">${T('availability.day.segments.row', { start: hhmm(s[0]), end: hhmm(s[1]) })}</span><span class="du">${T('busy.duration.' + dk, { hours: Math.floor(dm / 60), minutes: dm % 60 })}</span>${lg && lg === s ? `<span class="tag" data-m="availability.day.segments.longest"></span>` : ''}${icon('chevron-right')}</button></li>`;
    }).join('')}</ul><p class="av-hint" data-m="availability.day.segments.hint"></p>`;
  }

  // ใครไม่ว่างเมื่อไร: คนที่ "นับว่าไม่ว่าง" ขึ้นก่อน แล้วตามลำดับสมาชิก · คนไม่มีรายการ = "ไม่ได้ลงว่าติด"
  const withRows = members.map((m, mi) => ({ m, mi, p: i.per[mi] })).filter((x) => x.p.rows.length);
  withRows.sort((a, b) => Number(i.memberFree[a.mi]) - Number(i.memberFree[b.mi]) || a.mi - b.mi);
  const idle = members.filter((_, mi) => !i.per[mi].rows.length).map((m) => m.n);
  const people = withRows.map(({ m, mi, p }) => `<li class="cal-person">${avatar(m, 'sm')}<span class="pn"><span>${m.n}${m.me ? ` <span class="you small muted" data-m="group.members.you"></span>` : ''}</span>${i.memberFree[mi] ? '' : `<span class="tag tag-busy av-flag">${icon('ban')}<span data-m="availability.day.blockers.flag"></span></span>`}</span><div class="items">${p.rows.sort((a, b) => a.from - b.from).map((x) => itemLines(x, d)).join('')}</div></li>`).join('');
  const anyFlag = withRows.some(({ mi }) => !i.memberFree[mi]);
  const blockers = `<h3 class="sub" data-m="availability.day.blockers.title"></h3>${people ? `<ul class="cal-people">${people}</ul>` : `<p class="av-hint" data-m="availability.day.blockers.empty"></p>`}${idle.length && people ? `<p class="cal-others" style="margin-top:0">${T('availability.day.blockers.noBusy', both((l) => ({ names: names(l, idle) })))}</p>` : ''}${anyFlag ? `<p class="av-hint">${T('availability.day.blockers.flagHint', both((l) => ({ duration: dur(l, WIN.min) })))}</p>` : ''}`;
  const trunc = sc.truncated ? `<p class="av-hint" role="note" data-m="availability.day.truncatedNote"></p>` : '';
  return `${status}${trunc}${segs}${blockers}<p class="av-info">${icon('info')}<span data-m="availability.explain"></span></p>`;
}
const ctaBtn = (i) => `<button type="button" class="btn ${i.allFree ? 'btn-primary' : 'btn-secondary'}">${icon('calendar-plus')}<span data-m="availability.cta.create"></span></button>`;
const ctaHint = (i) => `<p class="av-hint" data-m="${i.allFree ? 'availability.cta.createHintAll' : 'availability.cta.createHintOther'}"></p>`;
function ctaBlock(i) { return `<div class="av-cta">${ctaBtn(i)}${ctaHint(i)}</div>`; }
function detailPanel(sc, i) {
  return `<h2>${D(i.d, 'long')}</h2>${detailBody(sc, i)}${ctaBlock(i)}`;
}

// ---------- ทั้งหน้า ----------
function page(sc, { sel, sheet, role }) {
  const g = monthGrid(sc.y, sc.m);
  const infos = {}; for (let k = 0; k < g.weeks * 7; k++) { const d = addDays(g.from, k); infos[d] = dayInfo(sc, d); }
  if (sc.n === 1) {
    return `<div class="cal-split"><section><div class="empty panel" style="margin-top: var(--space-4)"><i data-cat="lost"></i><h2 class="h-section" data-m="empty.calendarSolo.title"></h2><p class="muted" data-m="empty.calendarSolo.body"></p><button class="btn btn-primary"><span data-m="empty.calendarSolo.cta"></span></button></div></section></div>`;
  }
  const future = Object.values(infos).filter((i) => i.d >= sc.today);
  const first = future.find((i) => i.allFree) || future.reduce((b, i) => (!b || i.free > b.free ? i : b), null);
  const selected = sel || first.d;
  const banners = [
    sc.truncated ? `<div class="alert alert-warn" role="status" style="margin-top: var(--space-3)">${icon('triangle-alert')}<div><span data-m="availability.truncated"></span></div></div>` : '',
    sc.nobody ? `<div class="alert alert-warn" role="status" style="margin-top: var(--space-3)">${icon('info')}<div><b data-m="availability.nobody.title"></b><span data-m="availability.nobody.body"></span><div style="margin-top: var(--space-2)"><button class="btn btn-secondary" style="background: var(--surface)">${icon('plus')}<span data-m="availability.nobody.cta"></span></button></div></div></div>` : '',
  ].join('');
  const left = `<section data-m-aria="availability.region">
    ${banners}${summaryBlock(sc, infos, role)}
    ${monthBlock(sc, sheet ? selected : (sel || null), infos)}
    ${sc.loading ? '<p class="loading-note" role="status" data-m="availability.loading"></p>' : `${legendBlock()}${infoBlock(role)}`}
  </section>`;
  const side = sc.loading ? '' : `<aside class="cal-side"><section class="cal-card av-detail" style="margin-top:0" aria-live="polite">${detailPanel(sc, infos[selected])}</section></aside>`;
  const sh = sheet ? `<div class="av-sheet-layer"><div class="scrim" aria-hidden="true"></div>
    <section class="sheet av-sheet" role="dialog" aria-modal="true" aria-labelledby="av-sh-t">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-head"><div class="t"><h2 id="av-sh-t">${D(selected, 'long')}</h2></div><button class="icon-btn" data-m-aria="a11y.close">${icon('x')}</button></div>
      <div class="sheet-body av-detail">${detailBody(sc, infos[selected])}${ctaHint(infos[selected])}</div>
      <div class="sheet-foot"><div class="av-cta">${ctaBtn(infos[selected])}</div></div>
    </section></div>` : '';
  return `<div class="cal-split">${left}${side}</div>${sh}`;
}

export function expandAvailability(html) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  return html.replace(/<gen-avpage([^>]*)><\/gen-avpage>/g, (_, a) => {
    const at = attrs(a); const sc = SC[at.scn]; if (!sc) throw new Error('gen-avpage scn ' + at.scn);
    return page(sc, { sel: at.sel, sheet: at.sheet === '1', role: at.role || 'admin' });
  });
}
