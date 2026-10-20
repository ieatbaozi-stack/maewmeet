/**
 * R3-6 — สแกนสถิต "authorize ก่อนแตะข้อมูล" (ARCHITECTURE §2, ADR 0003 §4) แบบทั่วไป ไม่ผูกชื่อไฟล์:
 *  A. ทุกฟังก์ชันที่ export จาก src/lib/data/services/** และ src/lib/auth/services/** ที่รับ `actor` เป็นพารามิเตอร์แรก
 *     ต้องเรียก authorize()/authorizeInGroup() และ "ก่อน" เรียกฟังก์ชันที่ import มาจาก repos / db / session
 *     (loadGroupCtx/policy-context เป็นตัวโหลดบริบทของ can() จึงเรียกก่อนได้ — ADR 0003 §1)
 *  B. ทุก src/app/api/**\/route.ts ต้องผ่าน route() wrapper (ด่าน CSRF/zod/actor/no-store) ยกเว้นที่ระบุ ·
 *     handler ห้าม import repos/db ตรง ๆ · path+method ต้องมีใน ROUTE_MANIFEST และ auth='actor' ต้องมี action
 *  C. route ใต้ /api/me/busy และ /api/groups/:gid/calendar (ถ้ามี) ต้องผูก action ตระกูล busy.* / group.calendar.view
 * ไฟล์ที่ยังไม่มี (Platform เพิ่มทีหลัง) จะถูกสแกนอัตโนมัติเมื่อมี
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ROUTE_MANIFEST } from '../../src/app/api/_lib/manifest';

const ROOT = join(__dirname, '..', '..');
const walk = (dir: string, pred: (f: string) => boolean): string[] => {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return names.flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, pred) : pred(p) ? [p] : [];
  });
};
const rel = (f: string) => relative(ROOT, f).split('\\').join('/');

/** ตัดคอมเมนต์ (คงความยาว/บรรทัดไว้พอให้ index ตรง) และสตริงเนื้อหา → กันจับคำในข้อความ */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

type Fn = { name: string; params: string; body: string };
function exportedFunctions(code: string): Fn[] {
  const out: Fn[] = [];
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*(?:<[^>]*>[^>]*)*>)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length;
    let depth = 1;
    const pStart = i;
    while (i < code.length && depth > 0) {
      const c = code[i++];
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    const params = code.slice(pStart, i - 1);
    // หา body: "{" แรกหลัง ")" ที่ไม่ได้อยู่ใน annotation ของชนิดคืนค่า ({ ... } ใน Promise<{...}> อยู่หลัง ':' ภายใน <>)
    let k = i;
    let angle = 0;
    for (; k < code.length; k++) {
      const c = code[k];
      if (c === '<') angle++;
      else if (c === '>' && code[k - 1] !== '=') angle--;
      else if (c === '{' && angle <= 0 && !/:\s*$/.test(code.slice(i, k).trim() ? code.slice(i, k) : ':x')) break;
      else if (c === '{' && angle <= 0 && code.slice(i, k).trim() === '') break;
    }
    let b = k + 1;
    let bd = 1;
    while (b < code.length && bd > 0) {
      const c = code[b++];
      if (c === '{') bd++;
      else if (c === '}') bd--;
    }
    out.push({ name: m[1]!, params, body: code.slice(k + 1, b - 1) });
  }
  return out;
}

/** ชื่อที่ import จาก module ที่ตรง pattern */
function importedNames(code: string, from: RegExp): Set<string> {
  const names = new Set<string>();
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (!from.test(m[2]!)) continue;
    if (/^\s*import\s+type/.test(m[0])) continue;
    for (const part of m[1]!.split(',')) {
      const p = part.trim();
      if (!p || p.startsWith('type ')) continue;
      names.add((p.split(/\s+as\s+/)[1] ?? p).trim());
    }
  }
  return names;
}

const DATA_ACCESS_MODULE = /(?:^|\/)(?:repos\/[^'"]+|db\/client|auth\/session|policy-context)$|\.\.\/repos\//;
// policy-context เรียกก่อน authorize ได้ (โหลด GroupCtx ให้ can()) จึงถูกกันออกด้านล่าง
const CONTEXT_LOADERS = new Set(['loadGroupCtx', 'goneGroupCtx']);

/** service ที่ไม่มี actor โดยออกแบบ (ด่านคือ CRON_SECRET) */
const NO_ACTOR_FILES = new Set([
  'src/lib/data/services/maintenance.ts',
  // helper ภายใน (ไม่ใช่ entry ของ route): แปลง/ยืนยัน actor, เขียน audit — ผู้เรียกเป็น service ที่ authorize แล้ว
  'src/lib/data/services/group-common.ts',
  'src/lib/auth/services/shared.ts',
]);
/**
 * ข้อยกเว้นที่ Lead/Security รับทราบ: ฟังก์ชันที่ต้องอ่านแถวเพื่อสร้าง resource ให้ can() (ตอบ 404 แทน 403 กัน IDOR)
 * — ต้องเป็น "อ่านอย่างเดียว" ก่อน authorize และไม่มีการเขียน/คืนข้อมูลก่อนผ่านด่าน. เพิ่มรายการต้องมีเหตุผล
 */
const READ_BEFORE_AUTHORIZE_OK = new Set<string>([
  'src/lib/data/services/invites.ts#respondToDirectInvite',
  'src/lib/data/services/invites.ts#revokeInvite', // loadGroupCtx แล้วอ่านแถวคำเชิญเพื่อสร้าง resource; ไม่พบ → authorize(group.view) แล้ว 404
]);

const AUTHZ_CALL = /\b(?:authorize|authorizeInGroup)\s*\(/;

const SERVICE_FILES = [
  ...walk(join(ROOT, 'src/lib/data/services'), (f) => f.endsWith('.ts')),
  ...walk(join(ROOT, 'src/lib/auth/services'), (f) => f.endsWith('.ts')),
].filter((f) => !NO_ACTOR_FILES.has(rel(f)) && !f.endsWith('/index.ts'));

describe('A. service ทุกตัวเรียก authorize() ก่อนแตะ repo/db', () => {
  it('พบไฟล์ service ให้สแกน (กันสแกนว่างเปล่า)', () => {
    expect(SERVICE_FILES.length).toBeGreaterThanOrEqual(8);
  });

  const cases = SERVICE_FILES.flatMap((file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    const touching = importedNames(code, DATA_ACCESS_MODULE);
    for (const n of CONTEXT_LOADERS) touching.delete(n);
    return exportedFunctions(code)
      .filter((fn) => /^\s*actor\b/.test(fn.params))
      .map((fn) => ({ id: `${rel(file)}#${fn.name}`, fn, touching }));
  });

  it('พบฟังก์ชันที่รับ actor ให้สแกน', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s', (id, { fn, touching }) => {
    const m = AUTHZ_CALL.exec(fn.body);
    expect(m, `${id}: ไม่พบ authorize()/authorizeInGroup() ใน body`).not.toBeNull();
    if (READ_BEFORE_AUTHORIZE_OK.has(id)) return;
    const before = fn.body.slice(0, m!.index);
    // บรรทัดก่อน authorize ห้ามเรียกฟังก์ชันจาก repos/db/session
    for (const name of touching) {
      expect(new RegExp(`\\b${name}\\s*\\(`).test(before), `${id}: เรียก ${name}() ก่อน authorize()`).toBe(false);
    }
    // และห้ามแตะ ctx.db โดยตรงก่อนผ่านด่าน (ยกเว้นส่งต่อให้ loadGroupCtx)
    const direct = before.replace(/loadGroupCtx\s*\([^)]*\)/g, '');
    expect(/\bctx\.db\b|\bdb\./.test(direct), `${id}: แตะ db ก่อน authorize()`).toBe(false);
  });
});

const ROUTE_FILES = walk(join(ROOT, 'src/app/api'), (f) => f.endsWith('/route.ts') && !f.includes('/_lib/'));

describe('B. route ทุกตัวผ่าน route() wrapper และ manifest', () => {
  it('พบ route ให้สแกน', () => {
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(ROUTE_FILES.map((f) => [rel(f), f] as const))('%s', (_n, file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    expect(/from\s+['"][^'"]*_lib\/route['"]/.test(code), 'ต้อง import route จาก _lib/route').toBe(true);
    const exported = [...code.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*route\s*\(/g)];
    const anyExport = [...code.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)];
    expect(exported.length, 'ทุก handler ต้องสร้างด้วย route({...})').toBe(anyExport.length);
    expect(exported.length).toBeGreaterThan(0);
    // handler ห้ามคุยกับ repo/db ตรง ๆ — ต้องผ่าน service (ซึ่ง authorize ก่อน)
    const importsDb = /from\s+['"][^'"]*(?:\/repos\/|@\/db\/|\/db\/client)/.test(code);
    for (const [, method] of exported) {
      const pathMatch = new RegExp(`${method}\\s*=\\s*route\\s*\\(\\s*\\{[\\s\\S]*?path:\\s*['"]([^'"]+)['"]`).exec(code);
      expect(pathMatch, 'ต้องระบุ path ใน route()').not.toBeNull();
      const entry = ROUTE_MANIFEST.find((e) => e.method === method && e.path === pathMatch![1]);
      expect(entry, `${method} ${pathMatch![1]} ไม่อยู่ใน ROUTE_MANIFEST`).toBeDefined();
      if (entry!.auth === 'actor') {
        expect(entry!.action, 'auth=actor ต้องมี action').not.toBeNull();
        expect(importsDb, 'route แบบ actor ห้าม import repos/db ตรง (ต้องผ่าน service ที่ authorize)').toBe(false);
      }
    }
  });

  it('manifest ไม่มี entry กำพร้า (ไม่มีไฟล์ route)', () => {
    const sources = ROUTE_FILES.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const e of ROUTE_MANIFEST) {
      expect(sources.includes(e.path), `${e.method} ${e.path} ไม่มีไฟล์ route`).toBe(true);
    }
  });
});

describe('C. route ของ busy / ปฏิทิน ผูก action ที่ถูกต้อง (ถ้ามีใน manifest)', () => {
  const busyRoutes = ROUTE_MANIFEST.filter((e) => e.path.startsWith('/api/me/busy'));
  const calRoutes = ROUTE_MANIFEST.filter((e) => /^\/api\/groups\/:gid\/calendar/.test(e.path));
  const BUSY_OK: Record<string, string> = { GET: 'busy.list.own', POST: 'busy.create', PATCH: 'busy.update', DELETE: 'busy.delete' };

  it.each(busyRoutes.map((e) => [`${e.method} ${e.path}`, e] as const))('%s → busy.* ที่ตรงกับ method', (_n, e) => {
    expect(e.auth).toBe('actor');
    expect(e.action).toBe(BUSY_OK[e.method]);
  });
  it.each(calRoutes.map((e) => [`${e.method} ${e.path}`, e] as const))('%s → group.calendar.view (GET เท่านั้น)', (_n, e) => {
    expect(e.method).toBe('GET');
    expect(e.auth).toBe('actor');
    expect(e.action).toBe('group.calendar.view');
  });
  it('ไม่มี route ใดเปิดให้ระบุ user id ของคนอื่นเพื่ออ่าน busy (/api/users/:id/busy ฯลฯ)', () => {
    const bad = ROUTE_MANIFEST.filter((e) => /busy|calendar/.test(e.path) && !/^\/api\/me\/busy|^\/api\/groups\/:gid\/calendar/.test(e.path));
    expect(bad.map((e) => `${e.method} ${e.path}`)).toEqual([]);
  });
});
