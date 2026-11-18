// OPS (#10) — DOCS_SYNC_CONTRACT §4: เอกสารต้องตรงกับของจริง (เลขรุ่น · routes · ตาราง · env · สถานะ ADR)
// ข้อความที่ล้มเป็นภาษาไทย บอกชัดว่า "ไฟล์ไหน ขาดอะไร"
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';

const root = process.cwd();
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const SEMVER = String.raw`\d+\.\d+\.\d+`;

function fail(msg: string): never {
  throw new Error(msg);
}

describe('DOCS_SYNC §4 — เลขรุ่นตรงกันทุกไฟล์', () => {
  const pkgVersion = (JSON.parse(read('package.json')) as { version: string }).version;

  function latestChangelog(): string {
    const m = /^## \[(\d+\.\d+\.\d+)\]/m.exec(read('CHANGELOG.md'));
    return m?.[1] ?? fail('CHANGELOG.md: ไม่พบหัวข้อรุ่น `## [x.y.z]` เลย');
  }

  it('CHANGELOG.md หัวข้อรุ่นล่าสุด = package.json', () => {
    expect(latestChangelog(), `CHANGELOG.md หัวข้อรุ่นล่าสุดไม่ตรง package.json (${pkgVersion})`).toBe(pkgVersion);
  });

  it('docs/guides/quickstart-th.html ท้ายหน้า "app vX.Y.Z" = package.json', () => {
    const html = read('docs/guides/quickstart-th.html');
    const all = [...html.matchAll(new RegExp(String.raw`app v(${SEMVER})`, 'g'))];
    const last = all.at(-1)?.[1];
    if (!last) fail('docs/guides/quickstart-th.html: ไม่พบข้อความ "app vX.Y.Z" ที่ท้ายหน้า');
    expect(last, `docs/guides/quickstart-th.html ท้ายหน้าเป็น v${last} แต่ package.json เป็น v${pkgVersion}`).toBe(pkgVersion);
  });

  it('docs/prd/PRD.md หมายเหตุ "สถานะปัจจุบัน" = package.json', () => {
    const line = read('docs/prd/PRD.md').split(/\r?\n/).find((l) => l.includes('สถานะปัจจุบัน'));
    if (!line) fail('docs/prd/PRD.md: ไม่พบบรรทัดหมายเหตุ "สถานะปัจจุบัน"');
    const v = new RegExp(`v(${SEMVER})`).exec(line)?.[1];
    if (!v) fail('docs/prd/PRD.md: บรรทัด "สถานะปัจจุบัน" ไม่มีเลขรุ่น vX.Y.Z');
    expect(v, `docs/prd/PRD.md บรรทัด "สถานะปัจจุบัน" เป็น v${v} แต่ package.json เป็น v${pkgVersion}`).toBe(pkgVersion);
  });

  it('docs/team/PROGRESS.md บรรทัด "อัปเดตล่าสุด" มีรุ่น = package.json', () => {
    const line = read('docs/team/PROGRESS.md').split(/\r?\n/).find((l) => l.includes('อัปเดตล่าสุด'));
    if (!line) fail('docs/team/PROGRESS.md: ไม่พบบรรทัด "อัปเดตล่าสุด"');
    const v = new RegExp(`v(${SEMVER})`).exec(line)?.[1];
    if (!v) fail('docs/team/PROGRESS.md: บรรทัด "อัปเดตล่าสุด" ไม่มีเลขรุ่น vX.Y.Z');
    expect(v, `docs/team/PROGRESS.md บรรทัด "อัปเดตล่าสุด" เป็น v${v} แต่ package.json เป็น v${pkgVersion}`).toBe(pkgVersion);
  });
});

describe('DOCS_SYNC §4 — ARCHITECTURE.md ตรงกับโค้ด', () => {
  const arch = read('docs/design/ARCHITECTURE.md');

  it('ทุก method + path ใน ROUTE_MANIFEST มีแถวในตารางข้อ 5 ของ docs/design/ARCHITECTURE.md', () => {
    // ตรวจเฉพาะส่วน "## 5." (ตาราง endpoint) และต้องเป็นรูป `METHOD /path` — กันเคสพูดถึง path ที่อื่นในไฟล์แล้วผ่านทั้งที่ไม่มีแถว
    // ชื่อพารามิเตอร์ในเอกสารต่างได้ (:aid / :id)
    const start = arch.indexOf('## 5. API');
    const end = arch.indexOf('## 6.', start);
    if (start < 0 || end < 0) fail('docs/design/ARCHITECTURE.md: ไม่พบหัวข้อ "## 5. API" หรือ "## 6." (ตาราง endpoint)');
    const norm = (t: string): string => t.replace(/:[A-Za-z]+/g, ':p');
    const doc = norm(arch.slice(start, end));
    const missing = ROUTE_MANIFEST.filter((r) => !doc.includes(`\`${r.method} ${norm(r.path)}\``)).map((r) => `${r.method} ${r.path}`);
    expect(missing, `docs/design/ARCHITECTURE.md ข้อ 5 ขาดแถว route (ดู ROUTE_MANIFEST; :param ชื่ออะไรก็ได้): ${missing.join(', ')}`).toEqual([]);
  });

  it('ทุกตารางที่ drizzle/*.sql สร้างและยังไม่ถูก DROP มีใน docs/design/ARCHITECTURE.md', () => {
    const dir = path.join(root, 'drizzle');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const created = new Map<string, string>();
    const dropped = new Set<string>();
    for (const f of files) {
      const sql = readFileSync(path.join(dir, f), 'utf8');
      for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+[`"]?(\w+)[`"]?/gi)) created.set(m[1]!, f);
      for (const m of sql.matchAll(/DROP TABLE(?: IF EXISTS)?\s+[`"]?(\w+)[`"]?/gi)) dropped.add(m[1]!);
    }
    const missing = [...created]
      .filter(([t]) => !dropped.has(t))
      .filter(([t]) => !new RegExp(`(?<![A-Za-z0-9_])${t}(?![A-Za-z0-9_])`).test(arch))
      .map(([t, f]) => `${t} (สร้างใน drizzle/${f})`);
    expect(missing, `docs/design/ARCHITECTURE.md ขาดตาราง: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('DOCS_SYNC §4 — env และ ADR', () => {
  it('ทุกตัวแปรใน .env.example มีใน docs/OPERATIONS.md', () => {
    const names = [...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!);
    const ops = read('docs/OPERATIONS.md');
    const missing = names.filter((n) => !ops.includes(n));
    expect(missing, `docs/OPERATIONS.md ขาดตัวแปรจาก .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  it('ADR ทุกไฟล์ไม่มีสถานะ Draft / ร่าง / Proposed ค้าง', () => {
    const dir = path.join(root, 'docs/adr');
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const line = readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).find((l) => /\*\*Status\*\*/i.test(l));
      if (!line) {
        bad.push(`docs/adr/${f}: ไม่พบบรรทัด **Status**`);
        continue;
      }
      const status = line.replace(/^.*?\*\*Status\*\*:?\s*/i, '').replace(/^\*+\s*/, '');
      if (/^(draft|proposed|ร่าง)/i.test(status)) bad.push(`docs/adr/${f}: สถานะ "${status.slice(0, 40)}" (ต้อง Accepted/Superseded)`);
    }
    expect(bad, `สถานะ ADR ค้าง:\n${bad.join('\n')}`).toEqual([]);
  });
});
