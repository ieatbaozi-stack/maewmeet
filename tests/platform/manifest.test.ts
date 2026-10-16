// R0-7 / ADR 0003 §4 ข้อ 6: ทุก src/app/api/**/route.ts อยู่ใน manifest (สแกนไฟล์จริง) — มีกรณีด้านลบ
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '@/lib/rbac/actions';
import { HTTP_METHODS, ROUTE_MANIFEST, type ManifestEntry } from '@/app/api/_lib/manifest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const API_DIR = path.join(ROOT, 'src/app/api');

/** route ที่ลงทะเบียนล่วงหน้าแต่บทบาทอื่นยังไม่สร้างไฟล์ (R0 ขั้น 3) — ลบออกเมื่อไฟล์มาแล้ว */
const PLANNED = new Set(['GET /api/health']);

type Found = { file: string; method: string; path: string };

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/^route\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** src/app/api/groups/[gid]/route.ts → /api/groups/:gid · (group) segment ถูกตัด */
export function routePathOf(file: string): string {
  const rel = path.relative(path.join(ROOT, 'src/app'), path.dirname(file)).split(path.sep);
  const segs = rel
    .filter((s) => !/^\(.*\)$/.test(s))
    .map((s) => s.replace(/^\[\[?\.\.\.(.+?)\]?\]$/, '*$1').replace(/^\[(.+)\]$/, ':$1'));
  return '/' + segs.join('/');
}

export function exportedMethods(source: string): string[] {
  const found = new Set<string>();
  const re = /export\s+(?:const|let|var|(?:async\s+)?function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  for (const m of source.matchAll(re)) found.add(m[1]!);
  const reList = /export\s*\{([^}]*)\}/g;
  for (const m of source.matchAll(reList)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name)) found.add(name);
    }
  }
  return [...found];
}

export function scanRoutes(files: { file: string; source: string }[]): Found[] {
  return files.flatMap(({ file, source }) => exportedMethods(source).map((method) => ({ file, method, path: routePathOf(file) })));
}

export function unregistered(found: Found[], manifest: readonly ManifestEntry[]): Found[] {
  return found.filter((f) => !manifest.some((e) => e.method === f.method && e.path === f.path));
}

const realFiles = walk(API_DIR)
  .filter((f) => !f.includes(`${path.sep}_lib${path.sep}`))
  .map((file) => ({ file, source: readFileSync(file, 'utf8') }));
const found = scanRoutes(realFiles);

describe('route manifest', () => {
  it('สแกนเจอ route จริง (กันเทสต์ว่างผ่านเอง)', () => {
    const keys = found.map((f) => `${f.method} ${f.path}`);
    expect(keys).toEqual(expect.arrayContaining(['GET /api/cron/daily', 'POST /api/cron/heartbeat', 'POST /api/prefs']));
  });

  it('ทุก method ที่ export จาก src/app/api/**/route.ts อยู่ใน manifest', () => {
    expect(unregistered(found, ROUTE_MANIFEST).map((f) => `${f.method} ${f.path} (${path.relative(ROOT, f.file)})`)).toEqual([]);
  });

  it('ทุก entry ใน manifest มีไฟล์จริง (ยกเว้นที่ประกาศ PLANNED)', () => {
    const keys = new Set(found.map((f) => `${f.method} ${f.path}`));
    const stale = ROUTE_MANIFEST.map((e) => `${e.method} ${e.path}`).filter((k) => !keys.has(k) && !PLANNED.has(k));
    expect(stale).toEqual([]);
  });

  it('PLANNED ที่มีไฟล์แล้วต้องถูกลบออกจาก PLANNED (กันลืม)', () => {
    const keys = new Set(found.map((f) => `${f.method} ${f.path}`));
    expect([...PLANNED].filter((k) => keys.has(k))).toEqual([]);
  });

  it('manifest: ไม่ซ้ำ · method ถูกชุด · action อยู่ใน ACTIONS ของ rbac · cron/public ไม่มี action', () => {
    const keys = ROUTE_MANIFEST.map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of ROUTE_MANIFEST as readonly ManifestEntry[]) {
      expect(HTTP_METHODS).toContain(e.method);
      expect(e.path.startsWith('/api/')).toBe(true);
      if (e.auth === 'actor') expect(ACTIONS).toContain(e.action);
      else expect(e.action).toBeNull();
    }
  });

  it('ด้านลบ: ไฟล์ route ที่ไม่ลงทะเบียนถูกจับได้', () => {
    const fake = [
      { file: path.join(API_DIR, 'groups/[gid]/route.ts'), source: 'export const GET = route(...);\nexport async function DELETE() {}' },
      { file: path.join(API_DIR, 'sneaky/route.ts'), source: 'const POST = () => 1; export { POST };' },
    ];
    const missing = unregistered(scanRoutes(fake), ROUTE_MANIFEST).map((f) => `${f.method} ${f.path}`);
    expect(missing.sort()).toEqual(['DELETE /api/groups/:gid', 'GET /api/groups/:gid', 'POST /api/sneaky']);
  });
});
