/**
 * R4B — ข้อมูลที่ผู้ใช้ป้อนใน นัด / สถานที่ / แจ้งเตือน ต้องไม่รั่วและไม่อันตราย (R4B_CONTRACT §5 R4B-1/6/7, §6)
 * เจ้าของเทสต์: Auth & Access · เจ้าของโค้ด: Platform
 *
 *  1. ไม่ log params / title / description / สถานที่ / mapUrl / body ในโค้ดตระกูลนัด·แจ้งเตือน·สถานที่
 *     (error ของ drizzle พก SQL params มาด้วย จึงห้าม log ตัว error ทั้งก้อนด้วย — ใช้ code/ชื่อชนิดเท่านั้น)
 *  2. ฟังก์ชันตรวจ mapUrl ปฏิเสธ javascript:/data:/vbscript:/file:/http:/protocol-relative/มี credentials/ยาว >500 และยอมรับ https ปกติ
 *  3. params ของ notification ทุกการเรียก insertNotification()/notify() มีเฉพาะคีย์ใน allowlist ต่อ kind (ADR 0007 §1)
 *     และ kind ต้องอยู่ในตารางนี้ (เพิ่ม kind ใหม่ = เพิ่มใน ADR + ตารางนี้ + ข้อความ th/en)
 *
 * skip-safe เฉพาะ "ยังไม่มีไฟล์ของ Platform" (ไม่พบไฟล์/ฟังก์ชันที่ต้องสแกน) — พบแล้วต้องผ่านเต็ม ไม่มีการ skip เพราะผลเทสต์
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const walk = (dir: string, pred: (f: string) => boolean): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, pred) : pred(p) ? [p] : [];
  });
};
const rel = (f: string) => relative(ROOT, f).split('\\').join('/');
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
const code = (f: string) => stripComments(readFileSync(f, 'utf8'));
const isSrcTs = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\./.test(f);

const SRC = walk(join(ROOT, 'src'), isSrcTs).filter((f) => !rel(f).startsWith('src/lib/rbac/'));

/** ไฟล์ตระกูลนัด / RSVP / แจ้งเตือน / สถานที่ (ฝั่งเซิร์ฟเวอร์ + route) */
const R4B_FILE = [
  /^src\/lib\/(?:data|calendar|places?|appointments?|notifications?)\/.*(?:appointment|rsvp|notification|place|map-?url)[^/]*\.ts$/i,
  /^src\/lib\/(?:appointments?|notifications?|places?)\/.*\.ts$/i,
  /^src\/app\/api\/groups\/\[[^/]+\]\/appointments\//,
  /^src\/app\/api\/appointments\//,
  /^src\/app\/api\/places\//,
  /^src\/app\/api\/me\/(?:appointments|notifications)\//,
];
const R4B_FILES = SRC.filter((f) => R4B_FILE.some((re) => re.test(rel(f))));

/** ตัดข้อความระหว่างวงเล็บที่สมดุลเริ่มที่ตำแหน่ง open (ตัวอักษร '(') */
function balanced(src: string, open: number, o = '(', c = ')'): string {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) d++;
    else if (src[i] === c && --d === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/* ───────────────────────────── 1. ไม่ log ข้อมูลผู้ใช้ ───────────────────────────── */
describe('0. ตัวเลือกไฟล์สแกนครอบไฟล์ R4B จริง (กัน regex คลาดแล้วสแกนว่างเปล่า)', () => {
  it('ถ้ามี service นัด/แจ้งเตือน/สถานที่ ต้องอยู่ใน R4B_FILES ทุกไฟล์', () => {
    const real = SRC.map(rel).filter((r) => /^src\/lib\/data\/services\/(?:appointments?|notifications?|places?)[^/]*\.ts$/.test(r));
    const scanned = new Set(R4B_FILES.map(rel));
    expect(real.filter((r) => !scanned.has(r))).toEqual([]);
    const routes = SRC.map(rel).filter((r) =>
      /^src\/app\/api\/(?:appointments|places|me\/(?:appointments|notifications)|groups\/\[[^/]+\]\/appointments)\//.test(r),
    );
    expect(routes.filter((r) => !scanned.has(r))).toEqual([]);
  });
});

describe('1. โค้ดนัด/แจ้งเตือน/สถานที่ ไม่ log params/title/สถานที่/mapUrl/body/error ดิบ', () => {
  const LOG_CALL =
    /\b(?:console\s*\.\s*\w+|logger\s*\.\s*\w+|log\s*\.\s*(?:debug|info|warn|error)|logError|logWarn|logInfo|debugLog)\s*\(/g;
  /** token ที่ห้ามอยู่ในอาร์กิวเมนต์ของคำสั่ง log */
  const FORBIDDEN_IN_LOG =
    /\b(?:params|title|description|placeName|placeText|location|locationName|mapUrl|lat|lng|latitude|longitude|payload|body|input|data|row|rows|notification|appointment|rsvp|query|q|note|groupName|inviterName|inviteeName|displayName|username|pin|token|secret|hash)\b|\b(?:e|err|error|ex|cause)\b(?!\s*\.\s*(?:code|name|status)\b)(?!\s*instanceof)(?!\s*\))?/;

  it('พบ log ได้เฉพาะในรูปที่ปลอดภัย (ถ้ามีไฟล์ให้สแกน)', () => {
    const offenders: string[] = [];
    for (const f of R4B_FILES) {
      const src = code(f);
      for (const m of src.matchAll(LOG_CALL)) {
        const args = balanced(src, m.index! + m[0].length - 1);
        // ลบสตริงลิเทอรัลล้วน ๆ (ข้อความคงที่) ออกก่อนตรวจ token — แต่คง ${…} ใน template ไว้
        const noPlain = args.replace(/'[^'\n]*'|"[^"\n]*"/g, "''").replace(/`([^`$]|\$(?!\{))*`/g, '``');
        if (FORBIDDEN_IN_LOG.test(noPlain)) offenders.push(`${rel(f)}: ${m[0]}${args.trim().slice(0, 80)})`);
      }
    }
    expect(offenders, 'log ที่อ้างข้อมูลผู้ใช้/ตัว error ดิบ (ใช้ e.code / ชื่อชนิดเท่านั้น)').toEqual([]);
  });

  it('ไม่มี console.log/debug และไม่มี JSON.stringify(params|body|input) ในไฟล์ตระกูลนี้', () => {
    const offenders: string[] = [];
    for (const f of R4B_FILES) {
      const src = code(f);
      if (/console\s*\.\s*(?:log|debug|info|dir|table)\s*\(/.test(src)) offenders.push(`${rel(f)}: console.log/debug`);
      if (/JSON\s*\.\s*stringify\s*\(\s*(?:params|body|input|payload|data)\b/.test(src) && /console|logger/.test(src))
        offenders.push(`${rel(f)}: stringify ข้อมูลผู้ใช้คู่กับ log`);
    }
    expect(offenders).toEqual([]);
  });

  it('ตัวสแกนจับ log ที่ผิดได้จริง (self-check)', () => {
    const bad = stripComments(
      "console.error('x', params);\nlogger.warn(`created ${title}`);\nconsole.error(e);\nconsole.error(`[appt] ${body.title}`);",
    );
    const hits = [...bad.matchAll(LOG_CALL)].filter((m) =>
      FORBIDDEN_IN_LOG.test(balanced(bad, m.index! + m[0].length - 1).replace(/'[^'\n]*'|"[^"\n]*"/g, "''")),
    );
    expect(hits.length).toBe(4);
    const ok = stripComments('console.error(`[api] ${entry.method} ${entry.path} ${e.code}`);');
    const okHits = [...ok.matchAll(LOG_CALL)].filter((m) => FORBIDDEN_IN_LOG.test(balanced(ok, m.index! + m[0].length - 1)));
    expect(okHits.length).toBe(0);
  });
});

/* ───────────────────────────── 2. ตรวจ mapUrl ───────────────────────────── */
describe('2. mapUrl: https เท่านั้น ≤500 ไม่มี credentials', () => {
  const NAME = /map-?url/i;
  const VERB = /(?:valid|safe|parse|check|sanitize|sanitise|assert|normali[sz]e|is)/i;
  type Candidate = { file: string; name: string };
  const candidates: Candidate[] = SRC.flatMap((f) =>
    [...code(f).matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)]
      .map((m) => m[1]!)
      .filter((n) => NAME.test(n) && VERB.test(n))
      .map((name) => ({ file: f, name })),
  );
  const mentionsMapUrl = SRC.filter((f) => /\bmapUrl\b/.test(code(f)) && !/^src\/(?:components|db)\//.test(rel(f)));

  /** แปลงผลของ validator หลายรูปแบบเป็น accepted | rejected */
  const verdict = async (fn: unknown, input: string): Promise<'accepted' | 'rejected'> => {
    try {
      let r: unknown;
      if (typeof fn === 'function') r = await (fn as (x: string) => unknown)(input);
      else if (fn && typeof (fn as { safeParse?: unknown }).safeParse === 'function')
        r = (fn as { safeParse: (x: unknown) => unknown }).safeParse(input);
      else throw new Error('validator ไม่ใช่ function หรือ zod schema');
      if (r === false || r === null || r === undefined) return 'rejected';
      if (typeof r === 'object') {
        const o = r as Record<string, unknown>;
        if (o.success === false || o.ok === false || o.valid === false || o.error) return 'rejected';
      }
      return 'accepted';
    } catch (e) {
      if (/validator ไม่ใช่/.test(String(e))) throw e;
      return 'rejected';
    }
  };

  const HOSTILE: Array<[string, string]> = [
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: ตัวพิมพ์ปน', 'JaVaScRiPt:alert(1)'],
    ['javascript: มีช่องว่างนำหน้า', '  javascript:alert(1)'],
    ['javascript: มี tab แทรก', 'java\tscript:alert(1)'],
    ['javascript: มี newline นำหน้า', '\njavascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['data: base64', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['blob:', 'blob:https://example.com/uuid'],
    ['http ธรรมดา', 'http://www.openstreetmap.org/?mlat=1&mlon=2'],
    ['ftp:', 'ftp://example.com/x'],
    ['geo: (mapUrl เก็บเฉพาะ https)', 'geo:13.7,100.5'],
    ['protocol-relative', '//evil.example.com/x'],
    ['ไม่มี scheme', 'www.openstreetmap.org/x'],
    ['credentials user:pass', 'https://user:pass@example.com/map'],
    ['credentials user เฉย ๆ', 'https://user@example.com/map'],
    ['credentials หลอกด้วย @', 'https://www.openstreetmap.org@evil.example.com/'],
    ['ยาวเกิน 500', 'https://example.com/' + 'a'.repeat(490)],
    ['มีอักขระควบคุม', 'https://example.com/\u0000x'],
    ['มี newline ใน URL', 'https://example.com/\njavascript:alert(1)'],
    ['https: ไม่มี host', 'https://'],
  ];
  const GOOD: Array<[string, string]> = [
    ['OSM', 'https://www.openstreetmap.org/?mlat=13.7563&mlon=100.5018#map=16/13.7563/100.5018'],
    ['Google Maps @lat,lng', 'https://www.google.com/maps/@13.7563,100.5018,15z'],
    ['maps.app.goo.gl', 'https://maps.app.goo.gl/AbCdEf123'],
    ['ยาว 500 พอดี', 'https://example.com/' + 'a'.repeat(500 - 'https://example.com/'.length)],
  ];

  const found = candidates.length > 0;
  it.skipIf(!found && mentionsMapUrl.length === 0)('พบฟังก์ชันตรวจ mapUrl (หรือยังไม่มีโค้ด mapUrl เลย → skip)', () => {
    expect(
      found,
      `พบโค้ดที่อ้าง mapUrl (${mentionsMapUrl.map(rel).join(', ')}) แต่ไม่พบ export ฟังก์ชันตรวจ (ชื่อมี mapUrl + validate/safe/parse/check/is…) — ให้ Platform export ตัวตรวจแยกเพื่อให้เทสต์ได้`,
    ).toBe(true);
  });

  const cases = found ? candidates : [{ file: '', name: '(ยังไม่มีฟังก์ชันตรวจ mapUrl — Platform ยังไม่ส่ง)' }];
  describe.skipIf(!found).each(cases.map((c) => [`${c.file ? rel(c.file) : ''}#${c.name}`, c] as const))('%s', (_id, c) => {
    const load = async () => ((await import(/* @vite-ignore */ c.file)) as Record<string, unknown>)[c.name];
    it.each(HOSTILE)('ปฏิเสธ: %s', async (_n, input) => {
      expect(await verdict(await load(), input), JSON.stringify(input).slice(0, 70)).toBe('rejected');
    });
    it.each(GOOD)('ยอมรับ: %s', async (_n, input) => {
      expect(await verdict(await load(), input), input.slice(0, 70)).toBe('accepted');
    });
  });

  it.skipIf(mentionsMapUrl.length === 0 || found)(
    'สำรอง (ไม่มีฟังก์ชันตรวจแยก): ไฟล์ที่ประกาศ mapUrl ต้องมีการตรวจ https และเพดาน 500 ในโค้ด',
    () => {
      const schemaFiles = mentionsMapUrl.filter((f) => /zod|z\./.test(code(f)));
      expect(schemaFiles.length).toBeGreaterThan(0);
      for (const f of schemaFiles) {
        const c = code(f);
        expect(/https/.test(c), `${rel(f)}: ไม่พบการตรวจ https`).toBe(true);
        expect(/500/.test(c), `${rel(f)}: ไม่พบเพดาน 500`).toBe(true);
      }
    },
  );

  it('ใน UI/route ไม่มีการใช้ mapUrl เป็น href โดยไม่ผ่านตัวตรวจ: ห้าม dangerouslySetInnerHTML กับฟิลด์นัด/สถานที่', () => {
    const offenders = SRC.filter((f) => /^src\/(?:components\/(?:appointments|places|notifications|home)|app\/\(app\))\//.test(rel(f)))
      .filter((f) => /dangerouslySetInnerHTML/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ───────────────────────────── 3. params ของ notification ───────────────────────────── */
describe('3. params ของ notification มีเฉพาะคีย์ใน allowlist ต่อ kind (ADR 0007 §1)', () => {
  /** เขียนมือจาก ADR 0007 — ไม่คัดจากโค้ด */
  const ALLOW: Record<string, readonly string[]> = {
    'group.invite.received': ['groupId', 'groupName', 'inviterName', 'inviteId'],
    'group.invite.accepted': ['groupId', 'groupName', 'inviteeName', 'inviteId'],
    'group.invite.declined': ['groupId', 'groupName', 'inviteeName', 'inviteId'],
    'appointment.created': ['groupId', 'groupName', 'appointmentId', 'title', 'startAt', 'tz'],
    'appointment.reminder_1d': ['groupId', 'groupName', 'appointmentId', 'title', 'startAt', 'tz'],
    'appointment.reminder_1h': ['groupId', 'groupName', 'appointmentId', 'title', 'startAt', 'tz'],
    'appointment.rsvp_nudge': ['groupId', 'groupName', 'appointmentId', 'title', 'startAt', 'tz'],
    'pin_reset.approved': ['expiresAt'],
    'pin_reset.cancelled_by_login': [],
  };
  /** คีย์ที่ห้ามโผล่ใน params ทุก kind (ความลับ / ข้อมูลที่ผู้รับยังไม่ควรได้ผ่านแถวแจ้งเตือน) */
  const NEVER =
    /^(?:pin|pinHash|token|secret|code|inviteCode|codeHash|password|hash|note|description|location|locationName|placeName|mapUrl|lat|lng|latitude|longitude|createdBy|username|email|ip|userId|rsvp|busy|body)$/i;

  const KIND_MAPS = new Map<string, string>(); // 'NOTIFY_KIND.inviteReceived' → 'group.invite.received'
  for (const f of SRC) {
    for (const m of code(f).matchAll(/(?:const|let)\s+([A-Z][A-Z0-9_]*KIND[A-Z0-9_]*)\s*=\s*\{/g)) {
      const body = balanced(code(f), m.index! + m[0].length - 1, '{', '}');
      for (const p of body.matchAll(/([A-Za-z0-9_]+)\s*:\s*['"]([^'"]+)['"]/g)) KIND_MAPS.set(`${m[1]}.${p[1]}`, p[2]!);
    }
  }

  /** แยก top-level ด้วยคอมมา */
  const splitTop = (s: string): string[] => {
    const out: string[] = [];
    let d = 0,
      cur = '',
      q = '';
    for (const ch of s) {
      if (q) {
        cur += ch;
        if (ch === q) q = '';
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        q = ch;
        cur += ch;
        continue;
      }
      if ('({['.includes(ch)) d++;
      if (')}]'.includes(ch)) d--;
      if (ch === ',' && d === 0) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  const keysOf = (objBody: string): string[] =>
    splitTop(objBody).map((p) => {
      if (p.startsWith('...')) return `...${p.slice(3).trim()}`;
      const m = /^(?:\[([^\]]+)\]|['"]?([A-Za-z0-9_$]+)['"]?)\s*(?::|$|\()/.exec(p);
      return m ? (m[1] ? `[${m[1]}]` : m[2]!) : `?${p.slice(0, 20)}`;
    });

  type Call = { file: string; kinds: string[]; keys: string[] | null; why: string };
  const calls: Call[] = [];
  for (const f of SRC.filter((x) => /^src\/(?:lib|app\/api|db)\//.test(rel(x)))) {
    const src = code(f);
    for (const m of src.matchAll(/\b(?:insertNotification|notify|notifyMany|insertNotifications)\s*\(/g)) {
      // ข้ามตัวนิยามฟังก์ชัน (export async function insertNotification( …)
      if (/(?:function|async)\s+$/.test(src.slice(Math.max(0, m.index! - 20), m.index!))) continue;
      const argText = balanced(src, m.index! + m[0].length - 1);
      const objStart = argText.indexOf('{');
      if (objStart < 0) {
        calls.push({ file: rel(f), kinds: [], keys: null, why: 'ไม่พบ object literal ของอาร์กิวเมนต์' });
        continue;
      }
      const obj = balanced(argText, objStart, '{', '}');
      const fields = splitTop(obj);
      const kindExpr = fields.find((x) => /^kind\s*:/.test(x))?.replace(/^kind\s*:/, '') ?? '';
      const kinds = [...kindExpr.matchAll(/['"]([a-z_]+(?:\.[a-z_]+)+)['"]/g)].map((x) => x[1]!);
      for (const r of kindExpr.matchAll(/([A-Z][A-Z0-9_]*KIND[A-Z0-9_]*\.[A-Za-z0-9_]+)/g)) {
        const v = KIND_MAPS.get(r[1]!);
        if (v) kinds.push(v);
      }
      const pField = fields.find((x) => /^params\b/.test(x));
      let keys: string[] | null = [];
      let why = '';
      if (pField) {
        const expr = pField.replace(/^params\s*:?\s*/, '').trim() || 'params';
        if (expr.startsWith('{')) keys = keysOf(balanced(expr, 0, '{', '}'));
        else if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
          const def = new RegExp(`(?:const|let)\\s+${expr}\\s*(?::[^=]+)?=\\s*\\{`).exec(src);
          if (def) keys = keysOf(balanced(src, def.index + def[0].length - 1, '{', '}'));
          else {
            keys = null;
            why = `params เป็นตัวแปร "${expr}" ที่หา object literal ในไฟล์เดียวกันไม่เจอ`;
          }
        } else {
          keys = null;
          why = `params เป็น expression "${expr.slice(0, 40)}" ตรวจสถิตไม่ได้ — ใช้ object literal`;
        }
      }
      calls.push({ file: rel(f), kinds: [...new Set(kinds)], keys, why });
    }
  }
  const callsOutsideRepo = calls.filter((c) => c.file !== 'src/lib/data/repos/notification.ts');

  it('สแกนเจอการสร้างแจ้งเตือนจริง (กันสแกนว่างเปล่า — มีของ R1/R2 อยู่แล้ว)', () => {
    expect(callsOutsideRepo.length).toBeGreaterThanOrEqual(3);
  });
  it('ตัวแยกคีย์ทำงานถูก (self-check)', () => {
    expect(keysOf(" groupId, groupName: sanitize(x), 'a': 1, ...rest, [k]: 2")).toEqual(['groupId', 'groupName', 'a', '...rest', '[k]']);
  });
  it.each(callsOutsideRepo.map((c, i) => [`${c.file} #${i} ${c.kinds.join('|') || '?'}`, c] as const))('%s', (_n, c) => {
    expect(c.keys, `${c.file}: ${c.why}`).not.toBeNull();
    expect(c.kinds.length, `${c.file}: resolve kind ไม่ได้ (ใช้ string literal หรือ const *_KIND.x)`).toBeGreaterThan(0);
    for (const k of c.kinds) {
      expect(Object.keys(ALLOW), `kind "${k}" ไม่อยู่ใน ADR 0007 / ตาราง allowlist ของเทสต์นี้ (เพิ่ม kind = เสนอ Lead ก่อน)`).toContain(k);
      for (const key of c.keys!) {
        expect(key.startsWith('...'), `${c.file}: ห้าม spread ใน params (${key})`).toBe(false);
        expect(NEVER.test(key), `${c.file}: params.${key} ห้ามอยู่ใน notification`).toBe(false);
        expect(ALLOW[k], `${c.file}: kind ${k} มี params.${key} นอก allowlist`).toContain(key);
      }
    }
  });
  it('ทุก kind ใน allowlist ของ ADR ที่ R4B ต้องใช้ (appointment.created) ถูกสร้างจากโค้ดจริงเมื่อมีโค้ดนัดแล้ว', () => {
    const apptCode = SRC.some((f) => /^src\/lib\/data\/services\/appointment/.test(rel(f)));
    if (!apptCode) return; // ยังไม่มี service นัด (Platform ยังไม่ส่ง) — ไม่มีอะไรให้ตรวจ
    expect(callsOutsideRepo.some((c) => c.kinds.includes('appointment.created'))).toBe(true);
  });
  it('ไม่มี kind ที่ผู้ถูกแจ้ง = ผู้ก่อเหตุ: appointment.created ไม่ยิงโดยไม่กรองผู้สร้าง (ตรวจสถิตแบบหยาบ)', () => {
    for (const f of SRC.filter((x) => /services\/appointment/.test(rel(x)))) {
      const c = code(f);
      if (!/appointment\.created/.test(c)) continue;
      expect(
        /(?:!==|!=)\s*(?:me|actor|creator)\b[\w.]*|(?:filter|exclude|except)[^\n]*(?:me|actor|creator)/i.test(c),
        `${rel(f)}: ไม่พบการกันผู้สร้างออกจากผู้รับ`,
      ).toBe(true);
    }
  });
});
