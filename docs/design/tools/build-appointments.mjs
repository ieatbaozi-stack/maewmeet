// ตัวสร้างหน้าจอของหน้าตัวอย่าง R4B: หน้าหลัก · ฟอร์มนัด · รายละเอียดนัด · รายการนัดของกลุ่ม · แจ้งเตือน (เรียกจาก build-samples.mjs)
// แทนแท็ก <gen-appt page="home|form|detail|list|notif" scn="..."></gen-appt> ด้วย markup จริง (คลาสจาก src/styles/{appointments,home,notifications}.css)
// ข้อความมาจาก messages/*.json (data-m / data-m-aria) · ข้อมูลเป็นข้อมูลสมมติ (วันนี้ในฉาก = อังคาร 2026-10-20 18:00 BKK)
// ไม่ใช้ใน src/ (ใช้ Date/Intl ได้ เพราะเป็นเครื่องมือเอกสาร)
import {
  addDays, diffDays, fmtDate, STYLES, list, EN, j, T, both, D, MEMBERS, avatar, msg,
} from './build-calendar.mjs';

STYLES.wdLongY = { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' };
STYLES.wdShortY = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
STYLES.dayMon = { day: 'numeric', month: 'short', year: 'numeric' };
const TODAY = '2026-10-20';
const GROUP = 'แก๊งมัธยม ห้อง 6/3';

// ---------- ตัวช่วย ----------
const icon = (n, c = '') => `<i data-icon="${n}"${c ? ` class="${c}"` : ''}></i>`;
const bdi = (s) => `<bdi>${s}</bdi>`;
const mon = (d) => D(d, 'monthOnly');
const ANS = { going: 'circle-check', maybe: 'circle-help', not_going: 'circle-x', none: 'circle-dashed' };
const ANS_KEY = { going: 'going', maybe: 'maybe', not_going: 'not_going' };
const N = (i) => MEMBERS[i];

// ---------- ข้อมูลตัวอย่าง ----------
// a = { title, sd, st, ed, et, place?, group, creator, desc?, going[], maybe[], notGoing[], none[], my, status }
const PLACE_FULL = { name: 'ป้าแดงหมูกระทะ ลาดพร้าว 71', sub: 'ซอยลาดพร้าว 71 แขวงลาดพร้าว เขตลาดพร้าว กรุงเทพมหานคร', lat: '13.8016', lng: '100.6032' };
const base = (o) => ({ title: 'หมูกระทะวันเกิดต้นข้าว', sd: '2026-10-24', st: '18:00', ed: '2026-10-24', et: '21:00', place: PLACE_FULL, group: GROUP, creator: 0, desc: 'เจอกันหน้าร้านตอน 18:00 นะ ต้นข้าวเลี้ยงน้ำแข็ง ใครอยากกินเมนูพิเศษสั่งเพิ่มเองได้เลย\nถ้ามาช้าบอกในกลุ่มด้วย', going: [0, 1, 2, 3], maybe: [4], notGoing: [], none: [5], my: 'going', status: 'active', total: 6, ...o, ed: o.ed || o.sd || '2026-10-24' });
const NEXT = base({});
const LATER = [
  base({ title: 'ตีแบดประจำสัปดาห์', sd: '2026-10-25', st: '09:00', ed: '2026-10-25', et: '11:00', group: 'ก๊วนแบดสวนลุม', place: null, going: [0, 2, 5], maybe: [], none: [1, 3, 4], my: 'none', creator: 2 }),
  base({ title: 'ค้างคืนเขาใหญ่ เช่าบ้านพักริมลำธาร', sd: '2026-10-31', st: '15:00', ed: '2026-11-01', et: '11:00', going: [0, 1], maybe: [2], none: [3, 4, 5], my: 'maybe' }),
  base({ title: 'กินข้าวบ้านยาย', sd: '2026-11-08', st: '11:30', ed: '2026-11-08', et: '14:00', group: 'บ้านเรา', status: 'cancelled', cancelledBy: 0, cancelledOn: '2026-10-14', going: [0], maybe: [], none: [1, 2], my: 'going' }),
];
const PAST = [
  base({ title: 'ดูหนังรอบดึก', sd: '2026-10-17', st: '22:00', ed: '2026-10-18', et: '01:00', going: [0, 1, 3], maybe: [], none: [], notGoing: [2, 4, 5], my: 'going' }),
  base({ title: 'ปิ้งย่างวันเกิดมายด์', sd: '2026-10-03', st: '18:00', ed: '2026-10-03', et: '21:00', going: [0, 2, 4, 5], maybe: [3], none: [1], my: 'going' }),
  base({ title: 'ติวสอบกลางภาค', sd: '2026-09-27', st: '13:00', ed: '2026-09-27', et: '17:00', place: null, status: 'cancelled', cancelledBy: 1, cancelledOn: '2026-09-25', going: [0], maybe: [], none: [], my: 'going' }),
];
const MANY = Array.from({ length: 12 }, (_, i) => i);

const state = (a, today = TODAY) => {
  if (a.status === 'cancelled') return 'cancelled';
  const end = a.ed + ' ' + a.et; const start = a.sd + ' ' + a.st; const now = today + ' 18:00';
  if (end <= now) return 'past';
  if (start <= now) return 'ongoing';
  return 'active';
};
const rsvpOf = (a) => {
  const c = { going: a.going.length, maybe: a.maybe.length, not_going: a.notGoing.length };
  c.none = a.total - c.going - c.maybe - c.not_going;
  return c;
};

// ---------- ส่วนประกอบเล็ก ----------
function timeText(a, long = false) {
  if (a.sd === a.ed) return `<span class="num">${a.st}–${a.et}</span>`;
  if (diffDays(a.sd, a.ed) === 1 && a.et <= a.st) return `<span class="num">${T('appointments.when.overnight', { start: a.st, end: a.et })}</span>`;
  return `<span class="num">${T('busy.when.timedSpan', both((l) => ({ startDate: fmtDate(l, a.sd, 'short'), start: a.st, endDate: fmtDate(l, a.ed, 'short'), end: a.et })))}</span>`;
}
function rowWhen(a) {
  if (a.sd === a.ed) return `${D(a.sd, 'wdShort')} · <span class="num">${a.st}–${a.et}</span>`;
  if (diffDays(a.sd, a.ed) === 1 && a.et <= a.st) return `${D(a.sd, 'wdShort')} · <span class="num">${T('appointments.when.overnight', { start: a.st, end: a.et })}</span>`;
  return `<span class="num">${T('busy.when.timedSpan', both((l) => ({ startDate: fmtDate(l, a.sd, 'short'), start: a.st, endDate: fmtDate(l, a.ed, 'short'), end: a.et })))}</span>`;
}
const whenPlain = (l, a) => `${fmtDate(l, a.sd, 'wdShort')} ${a.st}`;

function band(a, st, today = TODAY) {
  const days = diffDays(today, a.sd);
  const date = `<p class="appt-date">${D(a.sd, 'wdLongY')}</p>`;
  if (st === 'cancelled') return `<div class="appt-band is-cancelled"><p class="appt-count"><span class="state">${icon('ban')}${T('appointments.status.cancelled')}</span></p>${date}</div>`;
  if (st === 'past') return `<div class="appt-band is-past"><p class="appt-count"><span class="state">${icon('clock')}${T('appointments.status.past')}</span></p>${date}</div>`;
  if (st === 'ongoing') return `<div class="appt-band is-ongoing"><p class="appt-count"><span class="state">${icon('clock')}${T('appointments.status.ongoing')}</span></p>${date}</div>`;
  const cnt = days >= 2
    ? `<span>${T('home.countdown.before', { days })}</span><span class="num-big">${days}</span><span>${T('home.countdown.after', { days })}</span>`
    : `<span class="big">${T('home.countdown.before', { days })}</span>`;
  return `<div class="appt-band"><p class="appt-count">${cnt}</p>${date}</div>`;
}

function placeFact(a, { link = true } = {}) {
  const p = a.place; if (!p) return '';
  const open = link && (p.lat || p.link)
    ? `<a class="appt-maplink" href="#" data-m-aria="places.openAria" data-m-v='${j(both(() => ({ name: p.name })))}'><span data-m="places.open"></span>${icon('external-link', 'sm')}</a>` : '';
  return `<li class="appt-fact">${icon('map-pin')}<span class="appt-place">${bdi(p.name)}${open}</span></li>`;
}

function counts(a, { notGoing = false } = {}) {
  const c = rsvpOf(a);
  const chip = (k, key, n) => `<span class="rsvp-count" data-answer="${k}">${icon(ANS[k], 'sm')}${T(key, { count: n })}</span>`;
  return `<p class="rsvp-counts">${chip('going', 'appointments.rsvp.summary.going', c.going)}${chip('maybe', 'appointments.rsvp.summary.maybe', c.maybe)}${notGoing ? chip('not_going', 'appointments.rsvp.summary.notGoing', c.not_going) : ''}${chip('none', 'appointments.rsvp.summary.noReply', c.none)}</p>`;
}
function faces(a) {
  const g = a.going; const shown = g.slice(0, 5);
  const more = g.length - shown.length;
  return `<div class="appt-faces" aria-hidden="true">${shown.map((i) => avatar(N(i), 'sm')).join('')}${more > 0 ? `<span class="more">${T('appointments.rsvp.facesMore', { count: more })}</span>` : ''}</div>`;
}

function rsvpBlock(a, mode = 'idle', id = 'rsvp', labelledBy = null) {
  const my = a.my;
  const btn = (k) => {
    const dis = mode === 'closed' ? ' disabled' : '';
    return `<button data-answer="${k}" aria-pressed="${my === k}"${dis}>${icon(ANS[k], 'sm')}<span data-m="appointments.rsvp.answer.${k}"></span></button>`;
  };
  const note = mode === 'closed-past' || mode === 'closed'
    ? `<p class="rsvp-note">${icon('info', 'sm')}<span>${T(a._closedKey || 'appointments.rsvp.closedPast')}</span></p>` : '';
  const err = mode === 'error' ? `<p class="rsvp-error" role="alert">${icon('circle-alert', 'sm')}<span data-m="appointments.rsvp.error"></span></p>` : '';
  const saving = mode === 'saving' ? `<p class="rsvp-note" role="status">${icon('refresh-cw', 'sm')}<span data-m="appointments.rsvp.saving"></span></p>` : '';
  return `<div class="rsvp">${labelledBy ? '' : `<p class="rsvp-label" id="${id}-l" data-m="appointments.rsvp.question"></p>`}
    <div class="segmented rsvp-choice${mode === 'saving' ? ' is-saving' : ''}" role="group" aria-labelledby="${labelledBy || id + '-l'}"${mode === 'saving' ? ' aria-busy="true"' : ''}>${['going', 'maybe', 'not_going'].map(btn).join('')}</div>${saving}${err}${note}</div>`;
}

const minePill = (a) => {
  if (a.status === 'cancelled') return `<span class="tag tag-busy">${icon('ban', 'sm')}<span data-m="appointments.status.cancelled"></span></span>`;
  const k = a.my; return `<span class="rsvp-pill" data-answer="${k}">${icon(ANS[k], 'sm')}${T('appointments.rsvp.mine.' + k)}</span>`;
};

function row(a, { group = true, today = TODAY } = {}) {
  const st = state(a, today);
  const sk = a.status === 'cancelled' ? 'cancelled' : a.my;
  const aria = both((l) => ({ title: a.title, when: whenPlain(l, a), group: a.group, state: sk }));
  const cls = st === 'cancelled' ? ' is-cancelled' : st === 'past' ? ' is-past' : '';
  const c = rsvpOf(a);
  const goingTxt = T('appointments.rsvp.summary.going', { count: c.going });
  const pills = group
    ? `<span class="appt-row-pills"><span class="appt-row-meta">${bdi(a.group)}</span>${minePill(a)}</span>`
    : `<span class="appt-row-pills">${st === 'cancelled' ? '' : `<span>${goingTxt}</span>`}${minePill(a)}</span>`;
  return `<li><a class="appt-row${cls}" href="appt-detail.html" data-m-aria="${group ? 'home.row.aria' : 'appointments.row.aria'}" data-m-v='${j(group ? aria : both((l) => ({ title: a.title, when: whenPlain(l, a), state: sk })))}'>
    <span class="appt-datebox" aria-hidden="true"><span class="d">${Number(a.sd.slice(8))}</span><span class="m">${mon(a.sd)}</span></span>
    <span class="appt-row-main" aria-hidden="true"><span class="appt-row-title">${bdi(a.title)}</span><span class="appt-row-meta">${rowWhen(a)}</span>${pills}</span>
    ${icon('chevron-right', 'chev')}</a></li>`;
}

// ---------- หัวหน้า ----------
const bellBtn = (n) => {
  const label = n > 9 ? '9+' : String(n);
  return `<a class="icon-btn bell" href="notifications.html" data-m-aria="notifications.bell.aria" data-m-v='${j({ count: n })}'>${icon('bell')}${n > 0 ? `<span class="bell-badge" aria-hidden="true">${label}</span>` : ''}</a>`;
};
const topHome = (bell) => `<header class="topbar"><div class="brand"><i data-brand="logo-mark" class="brand-mark"></i><span class="brand-name" data-m="brand.appName"></span></div>${bellBtn(bell)}</header>`;
const topBack = (href, title, right = '') => `<header class="topbar"><a class="icon-btn" href="${href}" data-m-aria="appointments.detail.back">${icon('chevron-left')}</a><h1 class="title" style="font-size: var(--text-lg)">${title}</h1>${right}</header>`;

// ====================== หน้าหลัก ======================
function nextCard(a, { rsvp = 'idle', today = TODAY } = {}) {
  const st = state(a, today);
  const aria = both(() => ({ title: a.title }));
  return `<article class="appt-card" aria-labelledby="next-t">
    ${band(a, st, today)}
    <div class="appt-body">
      <h2 class="appt-title" id="next-t">${bdi(a.title)}</h2>
      <ul class="appt-facts">
        <li class="appt-fact">${icon('clock')}${timeText(a)}</li>
        ${placeFact(a)}
        <li class="appt-fact">${icon('users')}<span>${bdi(a.group)}</span></li>
      </ul>
      <div class="appt-who">${faces(a)}${counts(a)}</div>
      ${rsvpBlock(a, rsvp)}
      <a class="appt-open" href="appt-detail.html" data-m-aria="home.next.openAria" data-m-v='${j(aria)}'><span data-m="home.next.open"></span>${icon('chevron-right')}</a>
    </div>
  </article>`;
}
function laterCard(rows, { more } = {}) {
  return `<section class="appt-list-card" aria-labelledby="later-h">
    <div class="appt-list-head"><h2 class="h-section" id="later-h" data-m="home.later"></h2></div>
    <ul class="appt-rows">${rows.map((r) => row(r)).join('')}</ul>
    ${more ? `<p class="appt-more-note">${T('home.moreNote', { count: more })}</p>` : ''}
  </section>`;
}
const HOME = {
  normal: { next: NEXT, later: LATER, bell: 3 },
  today: { next: base({ sd: '2026-10-20', ed: '2026-10-20', st: '19:00', et: '22:00', my: 'none', going: [1, 2], maybe: [], none: [0, 3, 4, 5] }), later: LATER.slice(0, 2), bell: 1 },
  tomorrow: { next: base({ sd: '2026-10-21', ed: '2026-10-21', my: 'maybe', going: [1, 2, 3, 5], maybe: [0, 4], none: [] }), later: LATER, bell: 0 },
  ongoing: { next: base({ sd: '2026-10-20', ed: '2026-10-20', st: '16:00', et: '20:00', going: [0, 1, 2, 3, 4], maybe: [], none: [5] }), later: LATER.slice(0, 1), bell: 12 },
  overnight: { next: base({ title: 'ปาร์ตี้ข้ามปี', sd: '2026-12-31', st: '22:00', ed: '2027-01-01', et: '02:00', place: { name: 'ดาดฟ้าคอนโดมายด์' }, going: [0, 1, 2], maybe: [4], none: [3, 5] }), later: [base({ title: 'เที่ยวเชียงใหม่ 3 วัน 2 คืน', sd: '2027-01-09', st: '08:00', ed: '2027-01-11', et: '20:00', my: 'going', going: [0, 1], maybe: [], none: [2, 3, 4, 5] })], bell: 2, today: '2026-12-26' },
  one: { next: NEXT, later: [], bell: 0 },
  long: {
    next: base({
      title: 'ปาร์ตี้ฉลองครบรอบสิบปีของแก๊งมัธยม พร้อมกินข้าวเย็นและร้องคาราโอเกะต่อจนดึก (ใครมีรูปเก่าเอามาด้วย)', group: 'ก๊วนเพื่อนสมัยมัธยมปลายห้องคิงส์ รุ่น 2559 และเพื่อนพี่เพื่อนน้อง',
      place: { name: 'โรงแรมเดอะแกรนด์ เซ็นทรัลพลาซา ลาดพร้าว ห้องบอลรูมชั้น 12 อาคาร B', lat: '13.8', lng: '100.5' }, going: MANY.slice(0, 8), maybe: [8, 9], none: [10, 11], total: 12, my: 'going',
    }),
    later: [base({ title: 'นัดมีชื่อยาวมากๆ ที่ต้องตัดด้วยจุดสามจุดเพื่อไม่ให้แถวสูงเกินไปจนผู้ใช้เลื่อนหาแถวอื่นไม่เจอ', group: 'ก๊วนเพื่อนสมัยมัธยมปลายห้องคิงส์ รุ่น 2559 และเพื่อนพี่เพื่อนน้อง', sd: '2026-11-14', total: 12, going: [0, 1, 2], none: MANY.slice(3), maybe: [], my: 'none' }), base({ title: 'Team dinner @ Sathorn (confirm by Friday)', group: 'Office buddies', sd: '2026-11-20', total: 12, going: [0, 1, 2, 3, 4, 5, 6], maybe: [7], none: MANY.slice(8), my: 'going' })],
    bell: 27,
  },
  'only-cancelled': { next: null, later: [LATER[2]], bell: 1 },
  many: { next: NEXT, later: Array.from({ length: 10 }, (_, i) => base({ title: `นัดที่ ${i + 2}`, sd: addDays('2026-10-25', i), group: i % 2 ? 'ก๊วนแบดสวนลุม' : GROUP, my: ['going', 'maybe', 'none', 'not_going'][i % 4], going: [0, 1], maybe: [2], none: [3, 4, 5], notGoing: [] })), bell: 4, more: 10 },
};
function homePage(scn) {
  if (scn === 'loading') return `${topHome(0)}<main class="main home-main" id="main" aria-busy="true"><div class="skeleton" style="height: var(--space-5); width: 40%; margin: var(--space-3) 0"></div><div class="skeleton" style="height: calc(var(--space-7) * 5); border-radius: var(--radius-lg)"></div><p class="loading-note" role="status">${icon('refresh-cw', 'sm')}<span data-m="home.loading"></span></p><div class="skeleton" style="height: calc(var(--space-7) * 3); margin-top: var(--space-5)"></div></main>`;
  if (scn === 'error') return `${topHome(0)}<main class="main home-main" id="main"><div class="alert" role="alert" style="margin-top: var(--space-4)">${icon('circle-alert')}<div><b data-m="home.error.title"></b><span data-m="home.error.body"></span></div></div><button class="btn btn-secondary" style="margin-top: var(--space-4)">${icon('refresh-cw')}<span data-m="states.retry"></span></button></main>`;
  if (scn === 'empty') return `${topHome(0)}<main class="main home-main" id="main"><div class="empty panel" style="margin-top: var(--space-5)"><i data-cat="tea"></i><h1 class="h-section" data-m="empty.home.title"></h1><p class="muted" data-m="empty.home.body"></p><a class="btn btn-primary" href="availability.html" data-m="empty.home.cta"></a></div></main>`;
  if (scn === 'nogroup') return `${topHome(0)}<main class="main home-main" id="main"><div class="empty panel" style="margin-top: var(--space-5)"><i data-cat="wave"></i><h1 class="h-section" data-m="empty.homeNoGroup.title"></h1><p class="muted" data-m="empty.homeNoGroup.body"></p><div class="home-empty-links"><a class="btn btn-primary" href="groups.html" data-m="empty.homeNoGroup.cta"></a><a class="link-btn" href="groups.html" data-m="empty.homeNoGroup.joinCode"></a></div></div></main>`;
  const rsvpMode = { 'rsvp-error': 'error', 'rsvp-saving': 'saving' }[scn] || 'idle';
  const d = HOME[scn === 'rsvp-error' || scn === 'rsvp-saving' ? 'normal' : scn];
  const today = d.today || TODAY;
  const hasLater = d.later.length > 0;
  return `${topHome(d.bell)}<main class="main home-main" id="main">
    ${d.next ? `<h1 class="h-section home-h" data-m="home.nextUp"></h1>${nextCard(d.next, { rsvp: rsvpMode, today })}` : `<div class="empty panel" style="margin-top: var(--space-4)"><i data-cat="tea"></i><h1 class="h-section" data-m="empty.home.title"></h1><p class="muted" data-m="empty.home.body"></p><a class="btn btn-primary" href="availability.html" data-m="empty.home.cta"></a></div>`}
    ${hasLater ? laterCard(d.later, { more: d.more }) : ''}
  </main>`;
}

// ====================== รายละเอียดนัด ======================
function mapBlock(a, mode) {
  const p = a.place; if (!p) return '';
  const hasCoords = !!p.lat;
  const subLine = hasCoords ? `<p class="appt-place-sub num">${T('places.selected.coords', { lat: p.lat, lng: p.lng })}</p>` : (p.link ? `<p class="appt-place-sub">${T('places.selected.linkOnly', { host: 'maps.app.goo.gl' })}</p>` : '');
  const nameAria = both(() => ({ name: p.name }));
  const open = hasCoords
    ? `<a class="btn btn-secondary map-open" href="#" data-m-aria="places.openAria" data-m-v='${j(nameAria)}'>${icon('external-link')}<span data-m="places.open"></span></a>`
    : p.link ? `<a class="btn btn-secondary map-open" href="#" data-m-aria="places.openLinkAria" data-m-v='${j(both(() => ({ name: p.name, host: 'maps.app.goo.gl' })))}'>${icon('external-link')}<span>${T('places.openLink', { host: 'maps.app.goo.gl' })}</span></a>` : '';
  let map = '';
  if (hasCoords) {
    const inner = mode === 'failed'
      ? `<div class="map-fallback">${icon('map-pin')}<b data-m="places.map.failed.title"></b><span data-m="places.map.failed.body"></span></div>`
      : mode === 'loading'
        ? `<div class="map-loading" role="status">${icon('refresh-cw', 'sm ov-spin')}<span style="margin-left: var(--space-2)" data-m="places.map.loading"></span></div>`
        : `<div class="map-canvas" aria-hidden="true"></div><span class="map-pin" aria-hidden="true">${icon('map-pin')}</span>`;
    map = `<figure class="map-fig"><div class="map-box is-sample" role="img" data-m-aria="places.map.region" data-m-v='${j(nameAria)}'>${inner}</div>${mode === 'failed' ? '' : `<figcaption class="map-caption"><a href="#" rel="noopener noreferrer"><span data-m="places.map.attribution"></span></a></figcaption>`}</figure>`;
  }
  return `<section class="appt-section" aria-labelledby="pl-h"><h2 id="pl-h" data-m="appointments.detail.place"></h2>
    <p class="appt-place-name">${bdi(p.name)}</p>${subLine}${map}${open}</section>`;
}
function peopleGroup(k, key, ids, n) {
  if (!ids.length) return '';
  return `<div class="rsvp-group" data-answer="${k}"><h3>${icon(ANS[k], 'sm')}${T(key, { count: ids.length })}</h3><ul class="rsvp-people">${ids.map((i) => `<li>${avatar(N(i), 'sm')}<span class="nm">${bdi(N(i).n)}${N(i).me ? `<span class="you">(<span data-m="group.members.you"></span>)</span>` : ''}</span></li>`).join('')}</ul></div>`;
}
function detailPage(scn) {
  const O = {
    normal: {}, member: { creator: 1, can: false }, today: { sd: '2026-10-20', ed: '2026-10-20', st: '19:00', et: '22:00', my: 'none', going: [1, 2], maybe: [], none: [0, 3, 4, 5] },
    ongoing: { sd: '2026-10-20', ed: '2026-10-20', st: '16:00', et: '20:00' }, past: { sd: '2026-10-17', ed: '2026-10-17', st: '18:00', et: '21:00', going: [0, 1, 2, 3], notGoing: [4], none: [5], maybe: [] },
    cancelled: { status: 'cancelled', cancelledBy: 1, cancelledOn: '2026-10-19', can: false }, 'cancelled-gone': { status: 'cancelled', cancelledBy: null, cancelledOn: '2026-10-19', can: false, canceller: 'gone' },
    nolink: { place: { name: 'ร้านชาบูหน้าปากซอย', link: 'https://maps.app.goo.gl/…' } }, nocoords: { place: { name: 'ร้านชาบูหน้าปากซอย' } }, noplace: { place: null }, 'map-failed': {}, 'map-loading': {},
    unanswered: { my: 'none', going: [1, 2, 3], maybe: [4], none: [0, 5] }, 'rsvp-error': {}, 'rsvp-saving': {}, 'cancel-confirm': {}, 'cancel-error': {},
    overnight: { title: 'ปาร์ตี้ข้ามปี', sd: '2026-12-31', st: '22:00', ed: '2027-01-01', et: '02:00', place: { name: 'ดาดฟ้าคอนโดมายด์' } },
    long: {
      title: 'ปาร์ตี้ฉลองครบรอบสิบปีของแก๊งมัธยม พร้อมกินข้าวเย็นและร้องคาราโอเกะต่อจนดึก (ใครมีรูปเก่าเอามาด้วย)', group: 'ก๊วนเพื่อนสมัยมัธยมปลายห้องคิงส์ รุ่น 2559 และเพื่อนพี่เพื่อนน้อง', total: 12,
      place: { name: 'โรงแรมเดอะแกรนด์ เซ็นทรัลพลาซา ลาดพร้าว ห้องบอลรูมชั้น 12 อาคาร B', lat: '13.8016', lng: '100.5' },
      desc: 'ขอบคุณทุกคนที่ตอบรับ! สรุปคือ 18:00 ลงทะเบียน รับป้ายชื่อ 18:30 เริ่มเลี้ยงอาหารเย็น 20:30 เล่นเกมทายชื่อเพื่อน 21:30 ย้ายไปห้องคาราโอเกะ\nที่จอดรถ: ลานจอดชั้น B2 ฟรี 4 ชม. ประทับตราที่เคาน์เตอร์\nอย่าลืมเอารูปเก่ามาด้วย https://example.com/a/very/long/link/that/should/wrap/instead/of/overflowing/the/screen/width',
      going: MANY.slice(0, 8), maybe: [8, 9], none: [10, 11], creator: 8,
    },
  }[scn] ?? (() => { throw new Error('detail scn ' + scn); })();
  const a = base(O);
  const st = state(a);
  const can = O.can === false ? false : st === 'active' || st === 'ongoing';
  const rmode = scn === 'rsvp-error' ? 'error' : scn === 'rsvp-saving' ? 'saving' : st === 'past' ? 'closed' : 'idle';
  const mapMode = scn === 'map-failed' ? 'failed' : scn === 'map-loading' ? 'loading' : 'ok';
  const creator = a.creator == null ? null : N(a.creator);
  const edit = can ? `<a class="icon-btn" href="appt-form.html" data-m-aria="appointments.detail.editAria" data-m-v='${j(both(() => ({ title: a.title })))}'>${icon('pencil')}</a>` : '';
  const banner = st === 'cancelled'
    ? `<div class="appt-banner appt-wide" role="status">${icon('ban')}<div>${a.cancelledBy != null
      ? `<b>${T('appointments.cancelled.banner', both((l) => ({ name: N(a.cancelledBy).n, when: fmtDate(l, a.cancelledOn, 'dayMon') + (l === 'th' ? ' 18:20' : ', 18:20') })))}</b>`
      : `<b>${T('appointments.cancelled.bannerGone', both((l) => ({ when: fmtDate(l, a.cancelledOn, 'dayMon') + (l === 'th' ? ' 18:20' : ', 18:20') })))}</b>`}<span data-m="appointments.cancelled.hint"></span></div></div>` : '';
  const statusRow = st === 'cancelled' ? `<div class="appt-status-row"><span class="appt-status is-cancelled">${icon('ban', 'sm')}<span data-m="appointments.status.cancelled"></span></span></div>`
    : st === 'past' ? `<div class="appt-status-row"><span class="appt-status is-past">${icon('clock', 'sm')}<span data-m="appointments.status.past"></span></span></div>`
      : st === 'ongoing' ? `<div class="appt-status-row"><span class="appt-status is-ongoing">${icon('clock', 'sm')}<span data-m="appointments.status.ongoing"></span></span></div>` : '';
  const today = scn === 'overnight' ? '2026-12-26' : TODAY;
  const bandHtml = band(a, st === 'active' && scn === 'overnight' ? 'active' : st, today);
  const desc = a.desc ? `<section class="appt-section" aria-labelledby="ds-h"><h2 id="ds-h" data-m="appointments.detail.description"></h2><p class="appt-desc">${a.desc}</p></section>` : '';
  const c = rsvpOf(a);
  const rsvpSec = st === 'cancelled' ? '' : `<section class="appt-section" aria-labelledby="rv-h"><h2 id="rv-h" data-m="appointments.rsvp.question"></h2>
    ${rsvpBlock({ ...a, _closedKey: 'appointments.rsvp.closedPast' }, rmode, 'dt', 'rv-h')}
    <div class="appt-who" style="border-top: 0; padding-top: 0">${counts(a, { notGoing: true })}</div></section>`;
  const who = `<section class="appt-section" aria-labelledby="wh-h"><h2 id="wh-h" data-m="appointments.rsvp.list.title"></h2><div class="rsvp-groups">
    ${peopleGroup('going', 'appointments.rsvp.list.going', a.going)}${peopleGroup('maybe', 'appointments.rsvp.list.maybe', a.maybe)}${peopleGroup('not_going', 'appointments.rsvp.list.notGoing', a.notGoing)}${peopleGroup('none', 'appointments.rsvp.list.noReply', Array.from({ length: a.total }, (_, i) => i).filter((i) => !a.going.includes(i) && !a.maybe.includes(i) && !a.notGoing.includes(i)))}
  </div></section>`;
  const manage = can ? `<section class="appt-section appt-wide" aria-labelledby="mg-h"><h2 id="mg-h" data-m="appointments.detail.manage"></h2>
    <div class="appt-actions"><a class="btn btn-secondary" href="appt-form.html">${icon('pencil')}<span data-m="appointments.detail.edit"></span></a><button class="btn btn-secondary" style="color: var(--danger-ink); border-color: var(--danger-ink)">${icon('ban')}<span data-m="appointments.detail.cancelAction"></span></button></div></section>`
    : st === 'cancelled' || st === 'past' ? '' : `<p class="appt-created appt-wide" style="display:flex; gap: var(--space-2)">${icon('lock', 'sm')}<span data-m="appointments.detail.noPermission"></span></p>`;
  const createdOn = '2026-10-12';
  const created = `<p class="appt-created appt-wide">${creator ? T('appointments.detail.createdBy', both((l) => ({ name: creator.n, date: fmtDate(l, createdOn, 'dayMon') }))) : T('appointments.detail.createdByGone', both((l) => ({ date: fmtDate(l, createdOn, 'dayMon') })))}</p>`;
  const card = `<article class="appt-card" aria-labelledby="dt-t">${bandHtml}<div class="appt-body">${statusRow}
      <h2 class="appt-title${st === 'cancelled' ? ' is-cancelled' : ''}" id="dt-t">${bdi(a.title)}</h2>
      <ul class="appt-facts"><li class="appt-fact">${icon('clock')}${timeText(a)}</li>
      <li class="appt-fact">${icon('users')}<a href="group.html" data-m-aria="appointments.detail.openGroupAria" data-m-v='${j(both(() => ({ group: a.group })))}'>${bdi(a.group)}</a></li></ul></div></article>`;
  const dialog = scn === 'cancel-confirm' || scn === 'cancel-error' ? `<div class="scrim" aria-hidden="true"></div>
    <section class="sheet center alert-sheet" role="alertdialog" aria-modal="true" aria-labelledby="cx-t">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-head"><div class="t"><h2 id="cx-t">${T('appointments.cancel.title', { title: a.title })}</h2></div><button class="icon-btn" data-m-aria="a11y.close">${icon('x')}</button></div>
      <div class="sheet-body"><p data-m="appointments.cancel.body"></p><p class="muted small" style="margin-top: var(--space-2)">${T('appointments.cancel.notify', { notify: 'no' })}</p>
      ${scn === 'cancel-error' ? `<div class="alert sheet-error" role="alert">${icon('circle-alert')}<div><span data-m="appointments.cancel.error"></span></div></div>` : ''}</div>
      <div class="sheet-foot sheet-actions"><button class="btn btn-danger btn-block" data-m="appointments.cancel.confirm"></button><button class="btn btn-secondary btn-block" style="min-height: var(--tap-lg)" data-m="appointments.cancel.keep"></button></div>
    </section>` : '';
  return `${topBack('home.html', T('appointments.detail.title'), edit)}<main class="main appt-main" id="main">
    ${banner}${card}${mapBlock(a, mapMode)}${desc}${rsvpSec}${who}${manage}${created}
  </main>${dialog}`;
}
function detailState(scn) {
  if (scn === 'loading') return `${topBack('home.html', T('appointments.detail.title'))}<main class="main appt-main" id="main" aria-busy="true"><div class="skeleton" style="height: calc(var(--space-7) * 4); border-radius: var(--radius-lg)"></div><div class="skeleton" style="height: calc(var(--space-7) * 3)"></div><p class="loading-note" role="status">${icon('refresh-cw', 'sm')}<span data-m="appointments.detail.loading"></span></p></main>`;
  if (scn === 'error') return `${topBack('home.html', T('appointments.detail.title'))}<main class="main appt-main" id="main"><div class="alert" role="alert">${icon('circle-alert')}<div><b data-m="appointments.detail.error.title"></b><span data-m="appointments.detail.error.body"></span></div></div><button class="btn btn-secondary" style="justify-self: start">${icon('refresh-cw')}<span data-m="states.retry"></span></button></main>`;
  if (scn === 'gone') return `${topBack('home.html', T('appointments.detail.title'))}<main class="main appt-main" id="main"><div class="empty panel appt-wide"><i data-cat="lost"></i><h2 class="h-section" data-m="appointments.detail.gone.title"></h2><p class="muted" data-m="appointments.detail.gone.body"></p><a class="btn btn-primary" href="home.html" data-m="appointments.detail.gone.cta"></a></div></main>`;
  return detailPage(scn);
}

// ====================== รายการนัดของกลุ่ม ======================
function listPage(scn) {
  const tab = scn === 'past' || scn === 'empty-past' ? 'past' : 'upcoming';
  const top = `<header class="topbar"><a class="icon-btn" href="group.html" data-m-aria="group.back">${icon('chevron-left')}</a><h1 class="title" style="font-size: var(--text-lg)"><span data-m="appointments.list.title"></span></h1></header>`;
  const head = (count) => `<div class="appt-list-top">
    <p class="muted small" style="margin:0">${T('appointments.form.inGroup', { group: GROUP })}</p>
    <a class="btn btn-primary btn-block" href="appt-form.html">${icon('calendar-plus')}<span data-m="appointments.create"></span></a>
    <div class="segmented cols-2" role="group" data-m-aria="appointments.list.tabsLabel"><button aria-pressed="${tab === 'upcoming'}" data-m="appointments.list.upcoming"></button><button aria-pressed="${tab === 'past'}" data-m="appointments.list.past"></button></div>
    ${count != null ? `<p class="appt-count-note" role="status">${icon('info', 'sm')}<span>${T('appointments.list.count', { count })}</span></p>` : ''}</div>`;
  const wrap = (inner) => `${top}<main class="main appt-main" id="main" style="display:block">${inner}</main>`;
  if (scn === 'loading') return wrap(`${head(null)}<div class="skeleton" style="height: calc(var(--space-7) * 2); margin-bottom: var(--space-2)"></div><div class="skeleton" style="height: calc(var(--space-7) * 2)"></div><p class="loading-note" role="status">${icon('refresh-cw', 'sm')}<span data-m="appointments.list.loading"></span></p>`);
  if (scn === 'error') return wrap(`${head(null)}<div class="alert" role="alert">${icon('circle-alert')}<div><b data-m="appointments.list.error.title"></b><span data-m="appointments.list.error.body"></span></div></div><button class="btn btn-secondary" style="margin-top: var(--space-3)">${icon('refresh-cw')}<span data-m="states.retry"></span></button>`);
  if (scn === 'empty-upcoming') return wrap(`${head(0)}<div class="empty panel"><i data-cat="calendar"></i><h2 class="h-section" data-m="appointments.list.empty.upcoming.title"></h2><p class="muted" data-m="appointments.list.empty.upcoming.body"></p><a class="btn btn-secondary" href="availability.html" data-m="appointments.list.empty.upcoming.free"></a></div>`);
  if (scn === 'empty-past') return wrap(`${head(null)}<div class="empty panel"><i data-cat="sleep"></i><h2 class="h-section" data-m="appointments.list.empty.past.title"></h2><p class="muted" data-m="appointments.list.empty.past.body"></p></div>`);
  const long = scn === 'long';
  const up = long ? [base({ title: 'ปาร์ตี้ฉลองครบรอบสิบปีของแก๊งมัธยม พร้อมกินข้าวเย็นและร้องคาราโอเกะต่อจนดึก', place: null, total: 12, going: MANY.slice(0, 8), none: MANY.slice(8), maybe: [] }), base({ title: 'Team dinner @ Sathorn (confirm by Friday)', sd: '2026-10-30', my: 'none', going: [1], maybe: [], none: [0, 2, 3, 4, 5] })] : [NEXT, ...LATER];
  const lst = tab === 'past' ? PAST : up;
  const near = scn === 'near-limit';
  const limitNote = near ? `<p class="appt-count-note">${icon('triangle-alert', 'sm')}<span>${T('appointments.list.limitNear', { count: 94, max: 100 })}</span></p>` : '';
  const capped = scn === 'past-capped' ? `<p class="appt-more-note">${T('appointments.list.pastCapped', { count: 50 })}</p>` : '';
  return wrap(`${head(tab === 'upcoming' ? lst.filter((x) => x.status !== 'cancelled').length : null)}${limitNote}<ul class="appt-rows is-bare">${lst.map((r) => row(r, { group: false })).join('')}</ul>${capped}`);
}

// ====================== แจ้งเตือน ======================
const K = {
  'group.invite.received': { ico: 'user-plus', cls: 'k-invite', key: 'notifications.group.invite.received', v: () => ({ inviterName: 'ปาล์ม', groupName: 'ก๊วนแบดสวนลุม' }) },
  'group.invite.accepted': { ico: 'circle-check', cls: 'k-ok', key: 'notifications.group.invite.accepted', v: () => ({ inviteeName: 'นุ่น', groupName: GROUP }) },
  'group.invite.declined': { ico: 'circle-x', cls: '', key: 'notifications.group.invite.declined', v: () => ({ inviteeName: 'Kwan', groupName: GROUP }) },
  'appointment.created': { ico: 'calendar-plus', cls: 'k-appt', key: 'notifications.appointment.created', v: (l) => ({ groupName: GROUP, title: 'หมูกระทะวันเกิดต้นข้าว', when: `${fmtDate(l, '2026-10-24', 'wdShort')} 18:00` }) },
  'appointment.cancelled': { ico: 'ban', cls: 'k-cancel', key: 'notifications.appointment.cancelled', v: (l) => ({ groupName: 'บ้านเรา', title: 'กินข้าวบ้านยาย', when: `${fmtDate(l, '2026-11-08', 'wdShort')} 11:30` }) },
  'pin_reset.approved': { ico: 'key', cls: '', key: 'notifications.pin_reset.approved', v: (l) => ({ expiresAt: `${fmtDate(l, '2026-10-21', 'wdShort')} 17:42` }) },
  'pin_reset.cancelled_by_login': { ico: 'shield', cls: '', key: 'notifications.pin_reset.cancelled_by_login', v: () => ({}) },
};
const TIMES = [
  () => T('notifications.time.justNow'), (n = 12) => T('notifications.time.minutes', { count: n }), () => T('notifications.time.hours', { count: 3 }),
  () => T('notifications.time.yesterday', { time: '18:20' }),
];
function notifRow(kind, { unread, time, vOver, href = 'appt-detail.html' }) {
  const k = K[kind];
  const body = T(k.key, both((l) => ({ ...k.v(l), ...(vOver || {}) })));
  return `<li><a class="notif-row${unread ? ' is-unread' : ''}" href="${href}">
    <span class="notif-ico ${k.cls}" aria-hidden="true">${icon(k.ico)}</span>
    <span class="notif-body"><span class="notif-msg">${unread ? `<span class="sr-only">${T('notifications.unreadSr')} · </span>` : ''}${body}</span><span class="notif-time">${time}</span></span>
    ${unread ? '<span class="notif-dot" aria-hidden="true"></span>' : ''}${icon('chevron-right', 'notif-chev')}</a></li>`;
}
function notifPage(scn) {
  const top = (unread) => `<header class="topbar"><a class="icon-btn" href="home.html" data-m-aria="notifications.back">${icon('chevron-left')}</a><h1 class="title" style="font-size: var(--text-lg)" data-m="notifications.title"></h1>${unread > 0 ? `<button class="btn btn-text" data-m-aria="notifications.markAllAria"><span data-m="notifications.markAll"></span></button>` : ''}</header>`;
  const shell = (unread, inner, sub = true) => `${top(unread)}<main class="main" id="main">${sub ? `<p class="notif-sub" role="status" style="margin-bottom: var(--space-3)">${T('notifications.unreadCount', { count: unread })}</p>` : ''}${inner}</main>`;
  if (scn === 'loading') return shell(0, `<div class="notif-card" aria-busy="true"><div class="notif-skel"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div><p class="loading-note" role="status">${icon('refresh-cw', 'sm')}<span data-m="notifications.loading"></span></p>`, false);
  if (scn === 'error') return shell(0, `<div class="alert" role="alert">${icon('circle-alert')}<div><b data-m="notifications.error.title"></b><span data-m="notifications.error.body"></span></div></div><button class="btn btn-secondary" style="margin-top: var(--space-3)">${icon('refresh-cw')}<span data-m="states.retry"></span></button>`, false);
  if (scn === 'empty') return shell(0, `<div class="empty panel"><i data-cat="sleep"></i><h2 class="h-section" data-m="notifications.empty.title"></h2><p class="muted" data-m="notifications.empty.body"></p></div>`, false);
  const all = [
    ['appointment.created', true, TIMES[1](12)], ['group.invite.received', true, TIMES[2]()], ['appointment.cancelled', true, TIMES[3]()],
    ['group.invite.accepted', false, `<span class="num">${D('2026-10-18', 'wdShort')} · 14:05</span>`], ['group.invite.declined', false, `<span class="num">${D('2026-10-16', 'wdShort')} · 09:40</span>`],
    ['pin_reset.approved', false, `<span class="num">${D('2026-10-14', 'wdShort')} · 17:42</span>`], ['pin_reset.cancelled_by_login', false, `<span class="num">${D('2026-10-12', 'wdShort')} · 08:15</span>`],
  ];
  const hrefs = { 'appointment.created': 'appt-detail.html', 'appointment.cancelled': 'appt-detail.html', 'group.invite.received': 'groups.html', 'group.invite.accepted': 'group.html', 'group.invite.declined': 'group.html', 'pin_reset.approved': 'groups.html', 'pin_reset.cancelled_by_login': 'groups.html' };
  const mk = (rows) => `<div class="notif-card"><ul class="notif-list">${rows.map(([k, u, t], i) => notifRow(k, { unread: u, time: t, href: hrefs[k] })).join('')}</ul></div>`;
  if (scn === 'allread') return shell(0, mk(all.map(([k, , t]) => [k, false, t])));
  if (scn === 'long') {
    const longRows = [
      ['appointment.created', true, TIMES[0]()],
      ['group.invite.received', true, TIMES[1](5)],
    ];
    return shell(2, `<div class="notif-card"><ul class="notif-list">${notifRow('appointment.created', { unread: true, time: TIMES[0](), vOver: { groupName: 'ก๊วนเพื่อนสมัยมัธยมปลายห้องคิงส์ รุ่น 2559 และเพื่อนพี่เพื่อนน้อง', title: 'ปาร์ตี้ฉลองครบรอบสิบปีของแก๊งมัธยม พร้อมกินข้าวเย็นและร้องคาราโอเกะต่อจนดึก (ใครมีรูปเก่าเอามาด้วย)' } })}${notifRow('group.invite.received', { unread: true, time: TIMES[1](5), vOver: { inviterName: 'ณัฐพงศ์ วงศ์สวัสดิ์ศรีสกุล', groupName: 'Office buddies: Sathorn & Silom lunch crew' }, href: 'groups.html' })}${notifRow('group.invite.accepted', { unread: false, time: TIMES[3](), vOver: { inviteeName: 'Wanwisa-Chantarapornkul-ThePrettiestPersonEver' }, href: 'group.html' })}</ul></div>`);
  }
  const rows = scn === 'more' ? [...all, ...all.map(([k, , t]) => [k, false, t])] : all;
  const nUnread = rows.filter((r) => r[1]).length;
  const foot = scn === 'more' ? `<div class="notif-foot"><button class="btn btn-secondary" data-m="notifications.loadMore"></button></div>` : '';
  const flash = scn === 'mark-error' ? `<div class="alert" role="alert" style="margin-bottom: var(--space-3)">${icon('circle-alert')}<div><span data-m="notifications.markError"></span></div></div>` : '';
  return shell(nUnread, `${flash}${mk(rows)}${foot}<p class="notif-retention">${T('notifications.retention', { days: 90 })}</p>`);
}

// ====================== ฟอร์มสร้าง/แก้นัด ======================
const FREE_BUSY = [
  { m: 1, t: 'ซ้อมดนตรี', r: ['17:00', '19:00'] },
  { m: 4, hidden: true, r: ['18:00', '20:30'] },
  { m: 3, t: 'ไปเที่ยวหัวหิน', allDay: true },
];
function ovBlock(kind, opts = {}) {
  const live = (inner, cls) => `<div class="ov ${cls}" aria-live="polite">${inner}</div>`;
  if (kind === 'none') return '';
  if (kind === 'checking') return live(`<p class="ov-head">${icon('refresh-cw', 'sm ov-spin')}<span data-m="appointments.overlap.checking"></span></p>`, 'is-checking');
  if (kind === 'clear') return live(`<p class="ov-head">${icon('circle-check', 'sm')}<span data-m="appointments.overlap.clear"></span></p>`, 'is-clear');
  if (kind === 'error') return live(`<p class="ov-head">${icon('info', 'sm')}<span data-m="appointments.overlap.error"></span></p><button class="btn btn-secondary ov-retry">${icon('refresh-cw', 'sm')}<span data-m="states.retry"></span></button>`, 'is-error');
  const people = opts.people || FREE_BUSY;
  const shown = people.slice(0, 5); const more = people.length - shown.length;
  const why = (p) => {
    const t = p.allDay ? T('calendar.day.allDay') : p.r ? T('calendar.day.range', { start: p.r[0], end: p.r[1] }) : '';
    const w = p.hidden ? `<span class="t">${T('calendar.day.busyPlain')}</span>` : p.t ? `<span class="t">${p.t}</span>` : (opts.minimal ? `<span class="t">${T('calendar.day.busyPlain')}</span>` : '');
    return `<span class="ov-why">${[t && `<span class="num">${t}</span>`, w].filter(Boolean).join(' · ')}</span>`;
  };
  const items = shown.map((p) => `<li>${avatar(N(p.m), 'sm')}<span class="ov-who"><span class="ov-name">${bdi(N(p.m).n)}${N(p.m).me ? ` <span class="you">(<span data-m="group.members.you"></span>)</span>` : ''}</span>${why(p)}</span></li>`).join('');
  const head = `<p class="ov-head">${icon('triangle-alert', 'sm')}<span>${T('appointments.overlap.title', { count: people.length })}</span></p>`;
  const list0 = `<ul class="ov-list" data-m-aria="appointments.overlap.groupAria">${items}</ul>${more > 0 ? `<p class="ov-more">${T('appointments.overlap.more', { count: more })}</p>` : ''}`;
  if (kind === 'unknown') {
    const parts = `<p class="ov-head">${icon('triangle-alert', 'sm')}<span data-m="appointments.overlap.unknown.title"></span></p><p class="ov-body" data-m="appointments.overlap.unknown.body"></p>`;
    return live(opts.people ? parts + list0 + `<p class="ov-body">${T('availability.explain')}</p>` : parts, 'is-unknown');
  }
  return live(`${head}${list0}<p class="ov-body">${T('appointments.overlap.nonBlocking')}</p><p class="ov-body" style="opacity: 1">${T('availability.explain')}</p>`, 'is-warn');
}

const PLACES = [
  { n: 'ป้าแดงหมูกระทะ', a: 'ซอยลาดพร้าว 71 แขวงลาดพร้าว เขตลาดพร้าว กรุงเทพมหานคร 10230' },
  { n: 'ป้าแดงหมูกระทะ สาขารัชดา', a: 'ถนนรัชดาภิเษก แขวงสามเสนนอก เขตห้วยขวาง กรุงเทพมหานคร' },
  { n: 'แดงหมูกระทะ บางปู', a: 'ตำบลบางปู อำเภอเมืองสมุทรปราการ จังหวัดสมุทรปราการ' },
  { n: 'Daeng Moo Kratha', a: 'Lat Phrao 71 Alley, Lat Phrao, Bangkok' },
  { n: 'ร้านหมูกระทะป้าแดง', a: 'ถนนสุขุมวิท 101/1 แขวงบางจาก เขตพระโขนง กรุงเทพมหานคร' },
];
function placeBlock(st, o = {}) {
  const q = o.q ?? 'ป้าแดงหมูกระทะ';
  const label = `<div class="field-label-row"><label for="pl-q"><span data-m="places.label"></span> <span class="opt">(<span data-m="appointments.form.optional"></span>)</span></label></div>`;
  const disabledBtn = st === 'disabled';
  const searchRow = (val, { busy = false } = {}) => `<div class="place-search"><div class="input">${icon('map-pin')}<input id="pl-q" class="input-bare" value="${val}" data-m-ph="places.name.placeholder" aria-describedby="pl-h"></div>
    <button class="btn btn-secondary" ${disabledBtn ? 'aria-disabled="true"' : busy ? 'disabled' : ''} data-m-aria="places.search.aria" data-m-v='${j(both(() => ({ query: val || '…' })))}'>${icon(busy ? 'refresh-cw' : 'search', busy ? 'sm ov-spin' : '')}<span data-m="${busy ? 'places.search.searching' : 'places.search.button'}"></span></button></div>`;
  const hint = `<p class="field-hint" id="pl-h" data-m="places.name.hint"></p>`;
  const toggle = `<button class="link-btn place-toggle">${icon('link', 'sm')}<span data-m="places.paste.toggle"></span></button>`;
  const paste = (val, err) => `<div class="place-paste"><div class="field field-first"><label for="pl-u" data-m="places.paste.label"></label>
      <div class="row2"><div class="input${err ? ' has-error' : ''}">${icon('link')}<input id="pl-u" class="input-bare" value="${val}" data-m-ph="places.paste.placeholder" aria-describedby="pl-uh"${err ? ' aria-invalid="true"' : ''}></div><button class="btn btn-primary" data-m="places.paste.submit"></button></div>
      ${err ? `<p class="field-error" role="alert">${icon('circle-alert', 'sm')}<span data-m="errors.${err}"></span></p>` : ''}<p class="field-hint" id="pl-uh" data-m="places.paste.hint"></p></div>
      <button class="link-btn">${icon('search', 'sm')}<span data-m="places.paste.back"></span></button></div>`;
  const results = (sel, stale = false) => `<ul class="place-results${stale ? ' is-stale' : ''}" role="radiogroup" data-m-aria="places.search.results">${PLACES.map((p, i) => `<li><button class="place-opt" role="radio" aria-checked="${sel === i}" data-m-aria="places.search.pickAria" data-m-v='${j(both(() => ({ name: p.n })))}'><span class="radio-mark" aria-hidden="true"></span><span><span class="pn">${bdi(p.n)}</span><span class="pa">${p.a}</span></span></button></li>`).join('')}</ul>
    <p class="place-foot"><span role="status">${T('places.search.count', { count: PLACES.length })}</span><span data-m="places.search.attribution"></span></p>`;
  const note = (cls, ic, inner) => `<div class="place-note ${cls}" role="status">${icon(ic)}<div>${inner}</div></div>`;
  let body;
  switch (st) {
    case 'idle': body = `${searchRow('')}${hint}${toggle}`; break;
    case 'typed': body = `${searchRow(q)}${hint}${toggle}`; break;
    case 'searching': body = `${searchRow(q, { busy: true })}${hint}${results(-1, true)}${toggle}`; break;
    case 'results': body = `${searchRow(q)}${results(-1)}${toggle}`; break;
    case 'picked': body = `${searchRow(q)}${results(0)}${toggle}`; break;
    case 'none': body = `${searchRow('ร้านลับสุดซอย')}${note('', 'search', `<b>${T('places.search.noResults.title', { query: 'ร้านลับสุดซอย' })}</b>${T('places.search.noResults.body')}`)}${toggle}`; break;
    case 'error': body = `${searchRow(q)}${note('is-error', 'circle-alert', `<span data-m="places.search.error"></span>`)}${toggle}`; break;
    case 'rate': body = `${searchRow(q)}${note('is-warn', 'triangle-alert', `<span data-m="places.search.rateLimited"></span>`)}${toggle}`; break;
    case 'disabled': body = `${searchRow(q)}${note('', 'info', `<span data-m="places.search.disabled"></span>`)}${paste('', null)}`; break;
    case 'tooshort': body = `${searchRow('ป')}${note('', 'info', T('places.search.tooShort', { min: 2 }))}${toggle}`; break;
    case 'paste': body = `${searchRow(q)}${paste('', null)}`; break;
    case 'paste-error': body = `${searchRow(q)}${paste('http://maps.example.com/abc', 'INVALID_MAP_URL')}`; break;
    case 'paste-coords-error': body = `${searchRow(q)}${paste('95.5, 100.5', 'INVALID_COORDINATES')}`; break;
    case 'chip': body = chip({ n: PLACES[0].n, s: T('places.selected.coords', { lat: '13.8016', lng: '100.6032' }) }); break;
    case 'chip-link': body = chip({ n: 'ร้านชาบูหน้าปากซอย', s: T('places.selected.linkOnly', { host: 'maps.app.goo.gl' }) }); break;
    case 'chip-pin': body = chip({ n: T('places.selected.defaultName'), s: T('places.selected.coords', { lat: '13.7563', lng: '100.5018' }) }); break;
    case 'chip-long': body = chip({ n: 'โรงแรมเดอะแกรนด์ เซ็นทรัลพลาซา ลาดพร้าว ห้องบอลรูมชั้น 12 อาคาร B ติดกับลานจอดรถชั้นใต้ดิน', s: T('places.selected.coords', { lat: '13.80160', lng: '100.60320' }) }); break;
    default: throw new Error('place st ' + st);
  }
  function chip({ n, s }) {
    return `<div class="place-chip" role="group" data-m-aria="places.selected.aria" data-m-v='${j(both(() => ({ name: 'สถานที่' })))}'>${icon('map-pin')}<div class="tx"><span class="pn">${bdi(n)}</span><span class="ps num">${s}</span></div>
      <button class="icon-btn" data-m-aria="places.clearAria" data-m-v='${j(both(() => ({ name: 'สถานที่' })))}'>${icon('x')}</button></div>`;
  }
  return `<div class="field" id="place">${label}${body}</div>`;
}

const FORM_BASE = { title: '', sd: '2026-10-24', st: '18:00', ed: '2026-10-24', et: '21:00', desc: '', place: 'idle', ov: 'clear', mode: 'create' };
const FORM = {
  create: {},
  empty: { ov: 'none', sd: null },
  prefilled: { title: '', prefilled: true, st: '16:00', et: '19:00', sd: '2026-10-25', ed: '2026-10-25' },
  filled: { title: 'หมูกระทะวันเกิดต้นข้าว', desc: 'เจอกันหน้าร้านตอน 18:00 นะ', place: 'chip' },
  warn: { title: 'หมูกระทะวันเกิดต้นข้าว', ov: 'warn' },
  'warn-min': { title: 'หมูกระทะวันเกิดต้นข้าว', ov: 'warn-min' },
  'warn-many': { title: 'หมูกระทะวันเกิดต้นข้าว', ov: 'warn-many', total: 12 },
  unknown: { title: 'หมูกระทะวันเกิดต้นข้าว', ov: 'unknown' },
  'unknown-warn': { title: 'หมูกระทะวันเกิดต้นข้าว', ov: 'unknown-warn' },
  checking: { title: 'หมูกระทะวันเกิดต้นข้าว', ov: 'checking' },
  'check-error': { title: 'หมูกระทะวันเกิดต้นข้าว', ov: 'error' },
  overnight: { title: 'ปาร์ตี้ข้ามปี', sd: '2026-12-31', st: '22:00', ed: '2027-01-01', et: '02:00', ov: 'clear', place: 'idle' },
  'place-typed': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'typed', focus: 'place' },
  'place-searching': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'searching', focus: 'place' },
  'place-results': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'results', focus: 'place' },
  'place-picked': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'picked', focus: 'place' },
  'place-none': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'none', focus: 'place' },
  'place-error': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'error', focus: 'place' },
  'place-rate': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'rate', focus: 'place' },
  'place-disabled': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'disabled', focus: 'place' },
  'place-short': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'tooshort', focus: 'place' },
  'place-paste': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'paste', focus: 'place' },
  'place-paste-error': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'paste-error', focus: 'place' },
  'place-coords-error': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'paste-coords-error', focus: 'place' },
  'place-chip': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'chip', focus: 'place' },
  'place-link': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'chip-link', focus: 'place' },
  'place-pin': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'chip-pin', focus: 'place' },
  'place-long': { title: 'หมูกระทะวันเกิดต้นข้าว', place: 'chip-long', focus: 'place' },
  'error-fields': { title: '', sd: null, ov: 'none', errors: { title: 'appointments.form.error.title.required', date: 'appointments.form.error.date.required' } },
  'error-past': { title: 'หมูกระทะวันเกิดต้นข้าว', sd: '2026-10-20', st: '15:00', ed: '2026-10-20', et: '17:00', ov: 'clear', errors: { time: 'start.past' } },
  'error-range': { title: 'หมูกระทะวันเกิดต้นข้าว', ed: '2026-10-24', et: '18:00', ov: 'none', errors: { time: 'INVALID_RANGE' } },
  'error-save': { title: 'หมูกระทะวันเกิดต้นข้าว', alert: 'appointments.form.error.save' },
  'error-limit': { title: 'หมูกระทะวันเกิดต้นข้าว', alert: 'LIMIT_REACHED' },
  'error-rate': { title: 'หมูกระทะวันเกิดต้นข้าว', alert: 'RATE_LIMITED' },
  saving: { title: 'หมูกระทะวันเกิดต้นข้าว', saving: true },
  edit: { mode: 'edit', title: 'หมูกระทะวันเกิดต้นข้าว', desc: 'เจอกันหน้าร้านตอน 18:00 นะ', place: 'chip' },
  'edit-cancelled': { mode: 'edit', title: 'หมูกระทะวันเกิดต้นข้าว', alert: 'APPOINTMENT_CANCELLED', ov: 'none' },
  long: {
    title: 'ปาร์ตี้ฉลองครบรอบสิบปีของแก๊งมัธยม พร้อมกินข้าวเย็นและร้องคาราโอเกะต่อจนดึก (ใครมีรูปเก่าเอามาด้วย)', group: 'ก๊วนเพื่อนสมัยมัธยมปลายห้องคิงส์ รุ่น 2559 และเพื่อนพี่เพื่อนน้อง',
    desc: 'ลงทะเบียน 18:00 เริ่มอาหารเย็น 18:30 ที่จอดรถชั้น B2 https://example.com/a/very/long/link/that/should/wrap/instead/of/overflowing/the/screen', place: 'chip-long', ov: 'warn-many', total: 12,
  },
};
function formSheet(scn) {
  const f = { ...FORM_BASE, group: GROUP, total: 6, ...FORM[scn] };
  if (!FORM[scn]) throw new Error('form scn ' + scn);
  const edit = f.mode === 'edit';
  const hasDate = f.sd != null;
  const overnight = hasDate && f.ed !== f.sd;
  const dateTxt = hasDate ? D(f.sd, 'long') : '<span class="muted" data-m="busy.form.date.none"></span>';
  const durMin = hasDate ? (() => { const [h1, m1] = f.st.split(':').map(Number), [h2, m2] = f.et.split(':').map(Number); let d = (h2 * 60 + m2) - (h1 * 60 + m1); if (d <= 0) d += 1440; return d; })() : 0;
  const durT = (() => { const h = Math.floor(durMin / 60), m = durMin % 60; const key = m === 0 ? 'busy.duration.hour' : h === 0 ? 'busy.duration.min' : 'busy.duration.hourMin'; return T('busy.form.total', both((l) => ({ total: msg(l, key, { hours: h, minutes: m }) }))); })();
  const err = f.errors || {};
  const titleErr = err.title ? `<p class="field-error" role="alert">${icon('circle-alert', 'sm')}<span data-m="${err.title}"></span></p>` : '';
  const dateErr = err.date ? `<p class="field-error" role="alert">${icon('circle-alert', 'sm')}<span data-m="${err.date}"></span></p>` : '';
  let timeErr = '';
  if (err.time === 'start.past') timeErr = `<p class="field-error" role="alert">${icon('circle-alert', 'sm')}${T('appointments.form.error.start.past', { hours: 1 })}</p>`;
  if (err.time === 'INVALID_RANGE') timeErr = `<p class="field-error" role="alert">${icon('circle-alert', 'sm')}${T('errors.INVALID_RANGE', { kind: 'time' })}</p>`;
  const people = f.ov === 'warn-many' ? [...FREE_BUSY, { m: 5, t: 'ติวสอบ', r: ['17:00', '19:30'] }, { m: 6, hidden: true, allDay: true }, { m: 7, t: 'เข้าเวร', r: ['16:00', '22:00'] }, { m: 8, hidden: true, r: ['18:00', '19:00'] }, { m: 9, t: 'Dinner with family', r: ['18:30', '20:00'] }, { m: 10, hidden: true, allDay: true }] : f.ov === 'warn-min' ? FREE_BUSY.map((p) => ({ m: p.m, hidden: true })) : FREE_BUSY;
  const ovKind = f.ov.startsWith('warn') ? 'warn' : f.ov.startsWith('unknown') ? 'unknown' : f.ov;
  const ov = ovBlock(ovKind, { people: f.ov === 'unknown' ? null : people, minimal: f.ov === 'warn-min' });
  const alertKey = f.alert;
  const alertHtml = alertKey ? `<div class="alert form-alert" role="alert">${icon('circle-alert')}<div>${alertKey === 'LIMIT_REACHED' ? T('errors.LIMIT_REACHED', { limit: 'appointments', max: 100 }) : alertKey.startsWith('appointments.') ? `<span data-m="${alertKey}"></span>` : `<span data-m="errors.${alertKey}"></span>`}</div></div>` : '';
  const created = scn === 'created';
  const notifyN = f.total - 1;
  const titleLen = [...f.title].length;
  const descLen = [...f.desc].length;
  const t = (k) => `appointments.form.${k}`;
  return `<div class="scrim" aria-hidden="true"></div>
  <section class="sheet tall" role="dialog" aria-modal="true" aria-labelledby="af-t">
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-head"><div class="t"><h2 id="af-t" data-m="${t(edit ? 'editTitle' : 'createTitle')}"></h2><p class="appt-form-sub">${T(t('inGroup'), { group: f.group })}</p></div><button class="icon-btn" data-m-aria="a11y.close">${icon('x')}</button></div>
    <div class="sheet-body">
      ${alertHtml}
      ${f.prefilled ? `<p class="appt-prefill">${icon('info', 'sm')}<span data-m="${t('prefilled')}"></span></p>` : ''}
      ${edit ? `<p class="appt-form-edit-note">${icon('info', 'sm')}<span data-m="${t('editNote')}"></span></p>` : ''}
      <div class="field" style="margin-top: ${f.prefilled || edit || alertKey ? 'var(--space-4)' : '0'}">
        <div class="field-label-row"><label for="af-title" data-m="${t('title.label')}"></label></div>
        <div class="input${err.title ? ' has-error' : ''}"><input id="af-title" class="input-bare" value="${f.title}" data-m-ph="${t('title.placeholder')}" aria-describedby="af-title-h"${err.title ? ' aria-invalid="true"' : ''}><span class="counter num">${titleLen}/80</span></div>
        ${titleErr}<p class="field-hint" id="af-title-h">${T(t('title.hint'), { max: 80 })}</p>
      </div>
      <div class="field">
        <span class="label" data-m="${t('date.label')}"></span>
        <button class="input select${err.date ? ' has-error' : ''}" aria-expanded="false">${icon('calendar')}<span style="flex:1; text-align:left">${dateTxt}</span>${icon('chevron-down')}</button>${dateErr}
      </div>
      <div class="pair2" style="margin-top: var(--space-3)">
        <div class="field" style="margin-top: 0"><span class="label" data-m="busy.form.time.start"></span><div class="input select${err.time ? ' has-error' : ''}"><span class="num">${hasDate ? f.st : '—'}</span>${icon('chevron-down')}</div></div>
        <div class="field" style="margin-top: 0"><span class="label" data-m="busy.form.time.end"></span><div class="input select${err.time ? ' has-error' : ''}"><span class="num">${hasDate ? f.et : '—'}</span>${icon('chevron-down')}</div></div>
      </div>
      ${timeErr}
      ${hasDate && !err.time ? `<p class="cal-summary-line">${durT}${overnight ? `<span class="tag tag-event">${icon('clock', 'sm')}<span>${T(t('time.endsOn'), both((l) => ({ date: fmtDate(l, f.ed, 'wdShort') })))}</span></span>` : ''}</p>` : ''}
      <p class="field-hint" style="margin-top: var(--space-1)" data-m="${t('time.stepHint')}"></p>
      ${ov}
      ${placeBlock(f.place)}
      <div class="field">
        <div class="field-label-row"><label for="af-desc"><span data-m="${t('description.label')}"></span> <span class="opt">(<span data-m="${t('optional')}"></span>)</span></label></div>
        <div class="input"><textarea id="af-desc" class="input-bare" rows="3" style="resize: vertical; padding: var(--space-3) 0" data-m-ph="${t('description.placeholder')}" aria-describedby="af-desc-h">${f.desc}</textarea></div>
        <p class="field-hint" id="af-desc-h">${T(t('description.hint'), { max: 1000 })} · <span class="num">${descLen}/1000</span></p>
      </div>
    </div>
    <div class="sheet-foot">
      ${edit ? '' : `<p class="notify-line">${icon('users', 'sm')}<span>${T(t('notifyLine'), { count: notifyN })}</span></p>`}
      <div class="appt-foot-actions"><button class="btn btn-secondary" data-m="common.cancel"></button><button class="btn btn-primary"${f.saving ? ' disabled' : ''} data-m="${t(f.saving ? (edit ? 'submit.saving' : 'submit.creating') : edit ? 'submit.save' : 'submit.create')}"></button></div>
    </div>
  </section>`;
}
function createdSheet(count) {
  return `<div class="scrim" aria-hidden="true"></div>
  <section class="sheet center alert-sheet" role="dialog" aria-modal="true" aria-labelledby="ac-t">
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-head"><div class="t"></div><button class="icon-btn" data-m-aria="a11y.close">${icon('x')}</button></div>
    <div class="sheet-body"><div class="appt-created-body"><i data-cat="pin"></i><h2 class="h-section" id="ac-t" data-m="appointments.created.title"></h2><p class="muted">${T('appointments.created.body', { count })}</p></div></div>
    <div class="sheet-foot sheet-actions"><a class="btn btn-primary btn-block" href="appt-detail.html" data-m="appointments.created.view"></a><button class="btn btn-secondary btn-block" style="min-height: var(--tap-lg)" data-m="appointments.created.done"></button></div>
  </section>`;
}

// ---------- แทนแท็ก ----------
export function expandAppointments(html) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  return html.replace(/<gen-appt([^>]*)><\/gen-appt>/g, (_, a) => {
    const at = attrs(a);
    switch (at.page) {
      case 'home': return homePage(at.scn);
      case 'detail': return detailState(at.scn);
      case 'list': return listPage(at.scn);
      case 'notif': return notifPage(at.scn);
      case 'form': return at.scn === 'created' ? createdSheet(5) : formSheet(at.scn);
      case 'formbg': return listPage('upcoming');
      default: throw new Error('gen-appt page ' + at.page);
    }
  });
}
export const FORM_SCENARIOS = [...Object.keys(FORM), 'created'];
export const DETAIL_SCENARIOS = ['normal', 'member', 'today', 'ongoing', 'past', 'cancelled', 'cancelled-gone', 'nolink', 'nocoords', 'noplace', 'map-failed', 'map-loading', 'unanswered', 'rsvp-error', 'rsvp-saving', 'cancel-confirm', 'cancel-error', 'overnight', 'long', 'loading', 'error', 'gone'];
export const HOME_SCENARIOS = [...Object.keys(HOME), 'rsvp-error', 'rsvp-saving', 'empty', 'nogroup', 'loading', 'error'];
