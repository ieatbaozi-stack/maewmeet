/**
 * R3-4 / ADR 0006 ข้อ 2, 9 — `note` ของ busy ห้ามหลุดนอกเส้นทางเจ้าของ (static grep ของ src)
 * Platform เป็นเจ้าของโค้ด · เทสต์นี้เป็นของ Auth & Security
 *
 * กติกา (ตรวจจากโค้ดจริง ไม่ใช่ชื่อไฟล์ที่เดา):
 *  1. `note` (โทเคนในโค้ด ไม่นับคอมเมนต์) ใน src/lib/data/** และ src/app/api/** อยู่ได้เฉพาะ allowlist "เส้นทางเจ้าของ":
 *     repos/busy*.ts · services/busy*.ts · serializers/busy*.ts (+ ไฟล์ schema/migration นอก scope นี้)
 *  2. route ใต้ /api/me/busy ไม่อ้าง `note` ตรง ๆ (ผ่าน service/zod ของ service) และ /api/groups/*\/calendar + services/calendar*.ts ไม่มี `note` เลย
 *  3. ใน repos/busy*.ts ฟังก์ชันฝั่งแชร์ (ชื่อมี Shared|Group|Calendar|Member|Viewer|Friend) ต้องไม่มี `note`
 *     และห้าม select ทั้งแถว (`.select()` ว่าง / getTableColumns / spread ตาราง busy / select *)
 *  4. serializer: ไฟล์ที่ประกาศ BusySharedView/BusyHiddenView ต้องมีไฟล์เดียว และชนิดทั้งสองไม่มีฟิลด์ note
 *  5. ไม่มี log ที่พ่น note (console/logger ในไฟล์ busy/calendar)
 *
 * สถานะไฟล์: ถ้ายังไม่มีไฟล์ของ Platform (ENOENT) เทสต์ข้อนั้น "skip" พร้อมข้อความ — ข้ามเฉพาะกรณีไม่พบไฟล์เท่านั้น
 * ไฟล์ที่มีแล้วต้องผ่านเต็ม
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

const NOTE = /\bnote\b/i;
const ts = (f: string) => f.endsWith('.ts') || f.endsWith('.tsx');
const DATA = walk(join(ROOT, 'src/lib/data'), ts);
const API = walk(join(ROOT, 'src/app/api'), ts);

/** เส้นทางเจ้าของ: ที่เดียวที่อนุญาตให้มี note */
const OWNER_PATH = [/^src\/lib\/data\/repos\/busy[^/]*\.ts$/, /^src\/lib\/data\/services\/busy[^/]*\.ts$/, /^src\/lib\/data\/serializers\/busy[^/]*\.ts$/];
const isOwnerPath = (r: string) => OWNER_PATH.some((re) => re.test(r));

describe('1. note อยู่ได้เฉพาะเส้นทางเจ้าของ', () => {
  it('สแกนไฟล์ได้จริง', () => {
    expect(DATA.length).toBeGreaterThan(10);
    expect(API.length).toBeGreaterThan(10);
  });
  it('ไม่มีไฟล์นอก allowlist ใน src/lib/data / src/app/api ที่มีโทเคน note', () => {
    const offenders = [...DATA, ...API].map(rel).filter((r) => !isOwnerPath(r) && !/^src\/app\/api\/me\/busy\//.test(r)).filter((r) => NOTE.test(code(join(ROOT, r))));
    expect(offenders).toEqual([]);
  });
});

describe('2. route / service ฝั่งปฏิทิน ไม่แตะ note', () => {
  const calFiles = [
    ...API.filter((f) => /\/groups\/\[gid\]\/calendar\//.test(rel(f))),
    ...DATA.filter((f) => /\/services\/calendar[^/]*\.ts$/.test(rel(f)) || /\/repos\/calendar[^/]*\.ts$/.test(rel(f))),
  ];
  const meBusyRoutes = API.filter((f) => /^src\/app\/api\/me\/busy\//.test(rel(f)));

  it.skipIf(calFiles.length === 0)('ปฏิทินกลุ่ม: ไม่มี note ในไฟล์ใดเลย', () => {
    for (const f of calFiles) expect(NOTE.test(code(f)), rel(f)).toBe(false);
  });
  it.skipIf(calFiles.length === 0)('ปฏิทินกลุ่ม: ไม่ select ทั้งแถวของ busy', () => {
    for (const f of calFiles) expect(/\.select\(\s*\)|getTableColumns\s*\(|\.\.\.\s*busy\b|select\s+\*/i.test(code(f)), rel(f)).toBe(false);
  });
  it.skipIf(meBusyRoutes.length === 0)('/api/me/busy: route ไม่อ้าง note ตรง ๆ (ผ่าน service เท่านั้น)', () => {
    for (const f of meBusyRoutes) expect(NOTE.test(code(f)), rel(f)).toBe(false);
  });
  it('บันทึกสถานะ: ไฟล์ที่พบตอนรัน (เพื่อให้ Lead เห็นว่าสแกนจริงหรือ skip)', () => {
    // ไม่ assert ค่า — ใช้ดูใน output เมื่อรัน --reporter=verbose
    expect({ calendarFiles: calFiles.map(rel), meBusyRoutes: meBusyRoutes.map(rel) }).toBeTruthy();
  });
});

/** แยกฟังก์ชันระดับบนสุด (export/ไม่ export) ของไฟล์ repo อย่างหยาบ: ชื่อ + body ด้วย brace matching */
function topFunctions(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)|(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g;
  const starts: { name: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ name: (m[1] ?? m[2])!, idx: m.index });
  starts.forEach((s, i) => out.push({ name: s.name, body: src.slice(s.idx, starts[i + 1]?.idx ?? src.length) }));
  return out;
}

describe('3. repos/busy*.ts — query ฝั่งแชร์ไม่ SELECT note', () => {
  const repoFiles = DATA.filter((f) => /\/repos\/busy[^/]*\.ts$/.test(rel(f)));
  const SHARED_NAME = /Shared|Group|Calendar|Member|Viewer|Friend|Visible/;

  it.skipIf(repoFiles.length === 0)('ฟังก์ชันฝั่งแชร์ไม่มี note และไม่ select ทั้งแถว', () => {
    let sharedFns = 0;
    for (const f of repoFiles) {
      for (const fn of topFunctions(code(f))) {
        if (!SHARED_NAME.test(fn.name)) continue;
        sharedFns++;
        expect(NOTE.test(fn.body), `${rel(f)}#${fn.name} มี note`).toBe(false);
        expect(/\.select\(\s*\)|getTableColumns\s*\(|\.\.\.\s*busy\b|select\s+\*/i.test(fn.body), `${rel(f)}#${fn.name} select ทั้งแถว`).toBe(false);
      }
    }
    // repo ที่มีอยู่ต้องมี query ฝั่งแชร์อย่างน้อยหนึ่งตัว (ไม่งั้นกฎนี้ว่างเปล่า — ปฏิทินกลุ่มต้องอ่านจากที่ไหนสักแห่ง)
    expect(sharedFns, 'ไม่พบฟังก์ชันฝั่งแชร์ใน repos/busy*.ts — ตั้งชื่อให้มี Shared|Group|Calendar|Member|Viewer').toBeGreaterThan(0);
  });
});

describe('4. serializer เดียว และ DTO ที่แชร์ไม่มีฟิลด์ note/title(ซ่อน)', () => {
  const all = [...DATA, ...API];
  const declaring = all.filter((f) => /^\s*(?:export\s+)?(?:type|interface)\s+BusyHiddenView\s*[={<]/m.test(code(f)));
  it.skipIf(declaring.length === 0)('มีไฟล์เดียวที่ประกาศ BusySharedView/BusyHiddenView/BusyOwnView', () => {
    expect(declaring.length).toBe(1);
    const src = code(declaring[0]!);
    for (const t of ['BusyOwnView', 'BusySharedView', 'BusyHiddenView']) expect(new RegExp(`^\\s*(?:export\\s+)?(?:type|interface)\\s+${t}\\s*[={<]`, 'm').test(src), t).toBe(true);
    expect(isOwnerPath(rel(declaring[0]!)) || /serializers\//.test(rel(declaring[0]!))).toBe(true);
  });
  it.skipIf(declaring.length === 0)('BusySharedView / BusyHiddenView ไม่มี note; BusyHiddenView ไม่มี title', () => {
    const src = code(declaring[0]!);
    const block = (t: string) => {
      const i = src.search(new RegExp(`^\\s*(?:export\\s+)?(?:type|interface)\\s+${t}\\s*[={<]`, 'm'));
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === '{' || c === '(' || c === '<') depth++;
        else if (c === '}' || c === ')' || (c === '>' && src[j - 1] !== '=')) depth--;
        else if (c === ';' && depth <= 0) break;
      }
      return src.slice(i, j);
    };
    // ส่วนที่นิยามแบบ "Omit/Pick" จากชนิดอื่นก็ต้องตรวจ: ห้ามอ้าง BusyOwnView ตรง ๆ (จะพา note มาด้วย)
    for (const t of ['BusySharedView', 'BusyHiddenView']) {
      expect(NOTE.test(block(t)), `${t} มี note`).toBe(false);
      expect(new RegExp('\\bBusyOwnView\\b').test(block(t)), `${t} สืบทอด BusyOwnView`).toBe(false);
    }
    expect(/\btitle\b/.test(block('BusyHiddenView')), 'BusyHiddenView มี title').toBe(false);
  });
  it('ไฟล์อื่นไม่ re-declare view types (ต้อง import จาก serializer)', () => {
    const decls = all.filter((f) => /^\s*(?:export\s+)?(?:type|interface)\s+Busy(?:Own|Shared|Hidden)View\s*[={<]/m.test(code(f)));
    expect(decls.length).toBeLessThanOrEqual(1);
  });
});

describe('5. ไม่ log note', () => {
  const files = [...DATA, ...API].filter((f) => /busy|calendar/i.test(rel(f)));
  it('console/logger ในไฟล์ busy/calendar ไม่รับ note', () => {
    for (const f of files) {
      const c = code(f);
      const bad = [...c.matchAll(/(?:console|logger|log)\.\w+\s*\(([^;]*)\)/g)].filter((m) => NOTE.test(m[1]!));
      expect(bad.map((m) => m[0]), rel(f)).toEqual([]);
    }
  });
  it('audit meta ของ busy/calendar ไม่ใส่ note', () => {
    for (const f of files) {
      const c = code(f);
      const bad = [...c.matchAll(/\bmeta\s*:\s*\{([^}]*)\}/g)].filter((m) => NOTE.test(m[1]!));
      expect(bad.map((m) => m[0]), rel(f)).toEqual([]);
    }
  });
});
