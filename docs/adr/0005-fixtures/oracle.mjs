// Independent oracle #2 (temporal-polyfill) — follows ADR 0005 pseudo-code literally.
import { Temporal } from 'temporal-polyfill';
import fs from 'node:fs';

const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function wall(date, minute, tz) {
  // minute in [0,1440]; 1440 = start of next day
  const d = minute === 1440 ? date.add({ days: 1 }) : date;
  const m = minute === 1440 ? 0 : minute;
  return d.toZonedDateTime({ timeZone: tz, plainTime: new Temporal.PlainTime(Math.floor(m / 60), m % 60) })
    .toInstant().epochMilliseconds;
}

function normalize(busy, gtz) {
  return busy.map((b) => {
    const tz = b.tz ?? gtz;
    if (b.k === 'd') return { u: b.u, allDay: true, sd: Temporal.PlainDate.from(b.s), ed: Temporal.PlainDate.from(b.e) };
    const s = Temporal.PlainDateTime.from(b.s).toZonedDateTime(tz).toInstant().epochMilliseconds;
    const e = Temporal.PlainDateTime.from(b.e).toZonedDateTime(tz).toInstant().epochMilliseconds;
    return { u: b.u, allDay: false, s, e };
  });
}

function subtract(w0, w1, intervals) {
  const iv = intervals.map(([s, e]) => [Math.max(s, w0), Math.min(e, w1)]).filter(([s, e]) => s < e)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const free = [];
  let cur = w0;
  for (const [s, e] of iv) { if (s > cur) free.push([cur, s]); cur = Math.max(cur, e); }
  if (cur < w1) free.push([cur, w1]);
  return free;
}

function fmt(ms, date, tz) {
  const z = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tz);
  if (Temporal.PlainDate.compare(z.toPlainDate(), date) > 0) return '24:00';
  return z.toPlainTime().toString({ smallestUnit: 'minute' });
}

const result = {};
for (const c of cases) {
  const gtz = c.gtz ?? 'Asia/Bangkok';
  const [ws, we] = c.window ?? [480, 1320];
  const minMs = (c.min ?? 120) * 60000;
  const members = new Set(c.members);
  const blocks = normalize(c.busy, gtz).filter((b) => members.has(b.u));
  const days = [];
  for (let d = Temporal.PlainDate.from(c.from); Temporal.PlainDate.compare(d, Temporal.PlainDate.from(c.to)) <= 0; d = d.add({ days: 1 })) {
    const w0 = wall(d, ws, gtz), w1 = wall(d, we, gtz);
    const blockedAllDay = new Set(blocks.filter((b) => b.allDay && Temporal.PlainDate.compare(b.sd, d) <= 0 && Temporal.PlainDate.compare(d, b.ed) <= 0).map((b) => b.u));
    const timed = blocks.filter((b) => !b.allDay && b.s < w1 && b.e > w0);
    let freeCount = 0;
    for (const m of members) {
      if (blockedAllDay.has(m)) continue;
      const own = subtract(w0, w1, timed.filter((b) => b.u === m).map((b) => [b.s, b.e]));
      if (own.some(([s, e]) => e - s >= minMs)) freeCount++;
    }
    const common = blockedAllDay.size > 0 ? [] :
      subtract(w0, w1, timed.map((b) => [b.s, b.e])).filter(([s, e]) => e - s >= minMs);
    days.push({
      date: d.toString(), free: `${freeCount}/${members.size}`, all_free: common.length > 0,
      segments: common.map(([s, e]) => `${fmt(s, d, gtz)}-${fmt(e, d, gtz)}(${(e - s) / 60000})`),
    });
  }
  result[c.id] = days;
}
console.log(JSON.stringify(result, null, 1));
