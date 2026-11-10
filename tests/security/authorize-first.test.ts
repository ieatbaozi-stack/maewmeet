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
].filter((f) => !NO_ACTOR_FILES.has(rel(f)) && !rel(f).endsWith('/index.ts'));

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

const ROUTE_FILES = walk(join(ROOT, 'src/app/api'), (f) => rel(f).endsWith('/route.ts') && !rel(f).includes('/_lib/'));

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
  // R14: routine แยก action ชุดของตัวเอง
  const ROUTINE_OK: Record<string, string> = { GET: 'busy.routine.list.own', POST: 'busy.routine.create', PATCH: 'busy.routine.update', DELETE: 'busy.routine.delete' };

  it.each(busyRoutes.map((e) => [`${e.method} ${e.path}`, e] as const))('%s → busy.* ที่ตรงกับ method', (_n, e) => {
    expect(e.auth).toBe('actor');
    const table = e.path.startsWith('/api/me/busy-routines') ? ROUTINE_OK : BUSY_OK;
    expect(e.action).toBe(table[e.method]);
  });
  it.each(calRoutes.map((e) => [`${e.method} ${e.path}`, e] as const))('%s → group.calendar.view (GET เท่านั้น)', (_n, e) => {
    expect(e.method).toBe('GET');
    expect(e.auth).toBe('actor');
    expect(e.action).toBe('group.calendar.view');
  });
  it('ไม่มี route ใดเปิดให้ระบุ user id ของคนอื่นเพื่ออ่าน busy (/api/users/:id/busy ฯลฯ)', () => {
    const bad = ROUTE_MANIFEST.filter((e) => /busy|calendar/.test(e.path) && !/^\/api\/me\/busy|^\/api\/groups\/:gid\/calendar|^\/api\/appointments\/:id\/calendar\.ics$/.test(e.path));
    expect(bad.map((e) => `${e.method} ${e.path}`)).toEqual([]);
  });
});

/* ──────────────────────────────────────────────────────────────────────────────────────────────
 * D. R4B — route ของนัด / RSVP / check / me/appointments / me/notifications ผูก action ที่ถูกต้อง (places/search ลบใน R13)
 *    (R4B_CONTRACT §2, §5 R4B-2/3/7; ADR 0003 ตารางแถว 9–11 และ action ผูกผู้ใช้)
 *
 * ตารางด้านล่าง "เขียนมือ" จากสเปก ไม่ได้คัดจาก manifest. Platform เพิ่มไฟล์ route ทีหลัง:
 *  - skip เฉพาะกรณี "ไม่พบไฟล์ route" ของ route นั้น (ENOENT เทียบเท่า — ยังไม่ถูกสร้าง) และข้อความ skip ระบุชื่อ route
 *  - ไฟล์ที่มีแล้วต้องผ่านเต็ม: ประกาศ method+path ตรงสเปก, อยู่ใน ROUTE_MANIFEST ด้วย action/auth ที่ถูก, ไม่มี method เกิน
 *  - ไม่ skip ในกรณี "ไฟล์มีแต่ manifest ไม่ลง" หรือ "ผูก action ผิด" (= fail)
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
type ExpectedRoute = {
  /** regex ของตำแหน่งไฟล์ route (ชื่อพารามิเตอร์โฟลเดอร์ใดก็ได้) */
  file: RegExp;
  routes: ReadonlyArray<{
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    action: string;
  }>;
};
const R4B_EXPECTED: ExpectedRoute[] = [
  {
    file: /^src\/app\/api\/groups\/\[[^/]+\]\/appointments\/route\.ts$/,
    routes: [
      {
        method: "POST",
        path: "/api/groups/:gid/appointments",
        action: "appointment.create",
      },
      {
        method: "GET",
        path: "/api/groups/:gid/appointments",
        action: "appointment.view",
      },
    ],
  },
  {
    // check ไม่เขียนข้อมูล แต่ใช้สิทธิ์เดียวกับการสร้าง (ผู้ตรวจต้องสร้างนัดได้ ไม่งั้นรั่ว busy ให้คนที่ไม่มีสิทธิ์)
    file: /^src\/app\/api\/groups\/\[[^/]+\]\/appointments\/check\/route\.ts$/,
    routes: [
      {
        method: "POST",
        path: "/api/groups/:gid/appointments/check",
        action: "appointment.create",
      },
    ],
  },
  {
    file: /^src\/app\/api\/appointments\/\[[^/]+\]\/route\.ts$/,
    routes: [
      {
        method: "GET",
        path: "/api/appointments/:id",
        action: "appointment.view",
      },
      {
        method: "PATCH",
        path: "/api/appointments/:id",
        action: "appointment.update",
      },
    ],
  },
  {
    // R12: ไฟล์ .ics ของนัด ใช้สิทธิ์ดูนัดเดียวกับ GET /api/appointments/:id (ไม่ส่ง busy)
    file: /^src\/app\/api\/appointments\/\[[^/]+\]\/calendar\.ics\/route\.ts$/,
    routes: [
      {
        method: "GET",
        path: "/api/appointments/:id/calendar.ics",
        action: "appointment.view",
      },
    ],
  },
  {
    file: /^src\/app\/api\/appointments\/\[[^/]+\]\/cancel\/route\.ts$/,
    routes: [
      {
        method: "POST",
        path: "/api/appointments/:id/cancel",
        action: "appointment.cancel",
      },
    ],
  },
  {
    file: /^src\/app\/api\/appointments\/\[[^/]+\]\/rsvp\/route\.ts$/,
    routes: [
      {
        method: "PUT",
        path: "/api/appointments/:id/rsvp",
        action: "appointment.rsvp",
      },
    ],
  },
  {
    file: /^src\/app\/api\/me\/appointments\/route\.ts$/,
    routes: [
      {
        method: "GET",
        path: "/api/me/appointments",
        action: "appointment.list.mine",
      },
    ],
  },
  {
    file: /^src\/app\/api\/me\/notifications\/route\.ts$/,
    routes: [
      {
        method: "GET",
        path: "/api/me/notifications",
        action: "notification.list.own",
      },
    ],
  },
  {
    file: /^src\/app\/api\/me\/notifications\/read\/route\.ts$/,
    routes: [
      {
        method: "POST",
        path: "/api/me/notifications/read",
        action: "notification.markRead.own",
      },
    ],
  },
  // R13 §1.3: GET /api/places/search ถูกลบแล้ว — ตระกูล /api/places ยังอยู่ใน R4B_PATH_FAMILY เพื่อให้ route สถานที่ใดที่โผล่มาใหม่ล้มเป็น "นอกสเปก"
];
/** ชื่อพารามิเตอร์ใน path ไม่สำคัญ (:id / :aid) — เทียบที่ตำแหน่ง */
const normPath = (p: string) => p.replace(/:[A-Za-z0-9_]+/g, ":p");
const R4B_PATH_FAMILY =
  /^\/api\/(?:groups\/:[^/]+\/appointments|appointments|me\/appointments|me\/notifications|places)(?:\/|$)/;

describe("D. R4B route → action (เขียนมือ; skip เฉพาะ route ที่ยังไม่มีไฟล์)", () => {
  const rows = R4B_EXPECTED.flatMap((e) => e.routes.map((r) => ({ e, r })));

  // ENOENT-equivalent: ไม่พบไฟล์ route (Platform ยังไม่สร้าง) → skip เฉพาะแถวนั้น · พบไฟล์แล้วต้องผ่านเต็ม
  const foundOf = (e: ExpectedRoute) =>
    ROUTE_FILES.map(rel).filter((f) => e.file.test(f));
  for (const { e, r } of rows) {
    const name = `${r.method} ${r.path}`;
    it.skipIf(foundOf(e).length === 0)(name, () => {
      const found = foundOf(e);
      expect(
        found.length,
        `${name}: พบไฟล์ route มากกว่าหนึ่งที่ตรง pattern เดียวกัน`,
      ).toBe(1);

      const src = stripComments(readFileSync(join(ROOT, found[0]!), "utf8"));
      const m = new RegExp(
        `export\\s+const\\s+${r.method}\\s*=\\s*route\\s*\\(\\s*\\{[\\s\\S]*?path:\\s*['"]([^'"]+)['"]`,
      ).exec(src);
      expect(
        m,
        `${name}: ${found[0]} ต้อง export const ${r.method} = route({ path })`,
      ).not.toBeNull();
      expect(normPath(m![1]!), `${name}: path ในไฟล์ route ไม่ตรงสเปก`).toBe(
        normPath(r.path),
      );

      const entry = ROUTE_MANIFEST.find(
        (x) => x.method === r.method && normPath(x.path) === normPath(r.path),
      );
      expect(entry, `${name} ไม่อยู่ใน ROUTE_MANIFEST`).toBeDefined();
      expect(entry!.auth, `${name}: ต้อง auth='actor'`).toBe("actor");
      expect(entry!.action, `${name}: ผูก action ผิด`).toBe(r.action);
    });
  }

  it("ไฟล์ route ที่มีแล้วของ R4B ไม่ export method เกินสเปก (เช่น DELETE /api/appointments/:id ที่ไม่มีในสัญญา)", () => {
    for (const e of R4B_EXPECTED) {
      const found = ROUTE_FILES.map(rel).filter((f) => e.file.test(f));
      for (const f of found) {
        const src = stripComments(readFileSync(join(ROOT, f), "utf8"));
        const methods = [
          ...src.matchAll(
            /export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
          ),
        ]
          .map((x) => x[1]!)
          .sort();
        expect(methods, `${f}: method ที่ export`).toEqual(
          e.routes.map((r) => r.method).sort(),
        );
      }
    }
  });

  it("ใน ROUTE_MANIFEST ตระกูลนัด/แจ้งเตือน/สถานที่ ไม่มี entry นอกสเปก และ action ทุกตัวอยู่ในตระกูลที่ถูก", () => {
    const allowed = new Set(
      rows.map(({ r }) => `${r.method} ${normPath(r.path)}`),
    );
    const family = ROUTE_MANIFEST.filter((x) => R4B_PATH_FAMILY.test(x.path));
    const extra = family
      .filter((x) => !allowed.has(`${x.method} ${normPath(x.path)}`))
      .map((x) => `${x.method} ${x.path}`);
    expect(
      extra,
      "route นอกสัญญา R4B (ต้องเสนอ Lead + เพิ่มสเปกในเทสต์นี้)",
    ).toEqual([]);
    for (const x of family)
      expect(x.action, `${x.method} ${x.path}`).toMatch(
        /^(appointment|notification)\./,
      );
  });

  it("R13 §1.3: ไม่มีไฟล์ route ใต้ src/app/api/places และไม่มี /api/places ใน ROUTE_MANIFEST", () => {
    expect(ROUTE_FILES.map(rel).filter((f) => f.startsWith("src/app/api/places/"))).toEqual([]);
    expect(ROUTE_MANIFEST.filter((x) => x.path.startsWith("/api/places")).map((x) => `${x.method} ${x.path}`)).toEqual([]);
  });

  it("ไม่มี route ที่เปิดให้ระบุ user id/group id ของคนอื่นเพื่ออ่านนัดหรือแจ้งเตือน (/api/users/:id/appointments, /api/users/:id/notifications ฯลฯ)", () => {
    const bad = ROUTE_MANIFEST.filter(
      (x) =>
        /(appointment|notification|rsvp)/.test(x.path) &&
        !R4B_PATH_FAMILY.test(x.path),
    );
    expect(bad.map((x) => `${x.method} ${x.path}`)).toEqual([]);
  });

  it("route นัด/แจ้งเตือน/สถานที่ที่มีอยู่ ห้ามใช้ auth ที่ไม่ใช่ actor (ไม่มี public/cron)", () => {
    for (const x of ROUTE_MANIFEST.filter((y) => R4B_PATH_FAMILY.test(y.path)))
      expect(x.auth, `${x.method} ${x.path}`).toBe("actor");
  });
});

describe("D2. service ของ R4B (ถ้ามีไฟล์) เรียก authorize ด้วย action ในตระกูลเดียวกัน และครอบครบทุก action ที่เกี่ยว", () => {
  const FAMILY =
    /services\/(?:appointments?|rsvp|notifications?|places?)[^/]*\.ts$/;
  const files = SERVICE_FILES.filter((f) => FAMILY.test(rel(f)));
  const ACTION_LITERAL =
    /\b(?:authorize|authorizeInGroup|can|canInGroup)\s*\(\s*[A-Za-z_.]+\s*,\s*['"]([a-zA-Z.]+)['"]/g;

  // ไม่มีไฟล์ service ของ R4B (ENOENT) → skip แถวเดียว · มีแล้วต้องผ่านเต็มทุกไฟล์
  const svcCases = files.length
    ? files.map((f) => [rel(f), f] as const)
    : [["(ยังไม่มีไฟล์ service ของ R4B — ENOENT)", ""] as const];
  it.skipIf(files.length === 0).each(svcCases)("%s", (name, f) => {
    const code = stripComments(readFileSync(f, "utf8"));
    const used = [...code.matchAll(ACTION_LITERAL)].map((m) => m[1]!);
    expect(
      used.length,
      `${name}: ไม่พบการเรียก authorize(actor, '<action>', …) ด้วย literal`,
    ).toBeGreaterThan(0);
    for (const a of used) {
      // group.view ใช้โหลดกลุ่มก่อนตอบ 404 ได้ · นอกนั้นต้องเป็น action ตระกูลเดียวกัน
      expect(a, `${name}: action แปลกปลอม`).toMatch(
        /^(appointment|notification)\.|^group\.view$/,
      );
    }
  });

  it.skipIf(files.length === 0)(
    "รวมทุกไฟล์ service ของ R4B: ใช้ครบ create/view/update/cancel/rsvp/list.mine + notification.list.own/markRead.own (place.search ลบใน R13)",
    () => {
      const used = new Set(
        files.flatMap((f) =>
          [
            ...stripComments(readFileSync(f, "utf8")).matchAll(ACTION_LITERAL),
          ].map((m) => m[1]!),
        ),
      );
      // เฉพาะเมื่อ Platform ส่งครบชุด (มีไฟล์ของทั้งนัดและแจ้งเตือนและสถานที่) จึงบังคับ coverage ทั้งหมด
      const have = (re: RegExp) => files.some((f) => re.test(rel(f)));
      const need: string[] = [];
      if (have(/appointment/))
        need.push(
          "appointment.create",
          "appointment.view",
          "appointment.update",
          "appointment.cancel",
          "appointment.rsvp",
          "appointment.list.mine",
        );
      if (have(/notification/))
        need.push("notification.list.own", "notification.markRead.own");
      for (const a of need)
        expect(
          used.has(a),
          `ไม่พบการ authorize('${a}') ในไฟล์ service ของ R4B`,
        ).toBe(true);
    },
  );
});
