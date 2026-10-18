// Security (#13) R0-20 — CSP/headers ไม่มี source กว้างเกิน · ไม่มีความลับใน repo · .gitignore · workflow least-privilege
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

afterEach(() => {
  vi.unstubAllEnvs();
});

async function cspDirectives(nodeEnv: string): Promise<Map<string, string[]>> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  const config = (await import('../../next.config')).default;
  const rules = (await config.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
  const value = rules.flatMap((r) => r.headers).find((h) => h.key.toLowerCase() === 'content-security-policy')!.value;
  return new Map(
    value
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [n, ...v] = d.split(/\s+/);
        return [n!, v];
      }),
  );
}

describe('CSP (production) — ไม่มี source กว้างเกิน', () => {
  it('ไม่มี *, https:, http:, data: ใน script/connect/frame · ไม่มี unsafe-eval / strict-dynamic ที่ไม่ได้ตั้งใจ', async () => {
    const d = await cspDirectives('production');
    for (const [name, values] of d) {
      for (const v of values) expect(['*', 'https:', 'http:', "'unsafe-hashes'"], `${name} ${v}`).not.toContain(v);
    }
    expect(d.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]); // ความเสี่ยงที่ยอมรับใน R0 — ดูรายงาน
    expect(d.get('connect-src')).toEqual(["'self'"]);
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org']);
  });
});

describe('ความลับไม่อยู่ใน repo (working tree ที่ track + ทุก commit)', () => {
  const PATTERNS: [string, RegExp][] = [
    ['JWT/Turso token', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
    ['Turso URL จริง', /libsql:\/\/(?!maewmeet-prod-xxxx\.|maewmeet-x\.|<)[a-z0-9-]+\.turso\.io/],
    ['ค่าความลับใน KEY=', /^\+?\s*(?:export\s+)?(PIN_PEPPER_V\d+|APP_SECRET|CRON_SECRET|TURSO_AUTH_TOKEN)\s*=\s*["']?[A-Za-z0-9+/_-]{16,}/m],
    ['GitHub token', /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/],
    ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ];

  it('ไฟล์ที่ track ตอนนี้', () => {
    const files = git('ls-files', '-z').split('\0').filter((f) => f && !/\.(png|jpg|webp|woff2?|ico)$/.test(f) && f !== 'package-lock.json');
    for (const f of files) {
      let text: string;
      try {
        text = readFileSync(path.join(ROOT, f), 'utf8');
      } catch {
        continue; // ไฟล์ถูกลบใน working tree
      }
      for (const [label, re] of PATTERNS) expect(re.test(text), `${label} ใน ${f}`).toBe(false);
    }
  });

  it('ประวัติ git ทั้งหมด (git log -p --all)', () => {
    const log = git('log', '-p', '--all', '--no-color', '--', '.', ':(exclude)package-lock.json');
    for (const [label, re] of PATTERNS) expect(re.test(log), label).toBe(false);
  });

  it('ไม่มีไฟล์ .env* (ยกเว้น .env.example) หรือ *.db* ถูก track/อยู่ในประวัติ', () => {
    const everAdded = git('log', '--all', '--diff-filter=A', '--name-only', '--format=').split('\n').filter(Boolean);
    for (const f of new Set(everAdded)) {
      expect(/(^|\/)\.env/.test(f) && !f.endsWith('.env.example'), f).toBe(false);
      expect(/\.db($|-)/.test(f), f).toBe(false);
    }
  });

  it('.gitignore กัน .env*, *.db*, *.pem', () => {
    const check = (p: string) => {
      try {
        git('check-ignore', '-q', '--no-index', p);
        return true;
      } catch {
        return false;
      }
    };
    for (const p of ['.env', '.env.local', '.env.production', 'local.db', 'local.db-wal', 'x.db-journal', 'key.pem']) expect(check(p), p).toBe(true);
    expect(check('.env.example')).toBe(false);
  });
});

describe('GitHub workflows', () => {
  const wf = (name: string) => readFileSync(path.join(ROOT, '.github/workflows', name), 'utf8');
  const files = ['ci.yml', 'keepalive.yml'];

  it.each(files)('%s: permissions ระดับ workflow = contents: read เท่านั้น · ไม่มี pull_request_target / write-all', (f) => {
    const y = wf(f);
    expect(y).toMatch(/^permissions:\n {2}contents: read\n(?! {2}\S)/m);
    expect(y).not.toMatch(/pull_request_target|workflow_run|write-all|:\s*write\b/);
  });

  it.each(files)('%s: checkout ไม่เก็บ credential · ไม่ใช้ ${{ github.event.* }} ใน run (script injection)', (f) => {
    const y = wf(f);
    const checkouts = y.match(/uses: actions\/checkout@/g)?.length ?? 0;
    expect((y.match(/persist-credentials: false/g)?.length ?? 0)).toBe(checkouts);
    // ${{ }} ที่อยู่ในบล็อก run: เท่านั้นที่อันตราย — ci.yml ใช้ github.event ใน concurrency.group (ไม่รันเป็น shell)
    const runBlocks = y.split(/\n\s*- /).filter((b) => /\brun:/.test(b)).map((b) => b.slice(b.indexOf('run:')));
    for (const b of runBlocks) expect(b, b).not.toMatch(/\$\{\{/);
  });

  it('secret ใช้เฉพาะใน keepalive ผ่าน env: ไม่ echo · สคริปต์ไม่มี set -x', () => {
    expect(wf('ci.yml')).not.toMatch(/secrets\./);
    const k = wf('keepalive.yml');
    expect(k.match(/secrets\.[A-Z_]+/g)?.sort()).toEqual(['secrets.APP_ORIGIN', 'secrets.CRON_SECRET']);
    const sh = readFileSync(path.join(ROOT, '.github/scripts/keepalive.sh'), 'utf8');
    expect(sh).not.toMatch(/set -[a-z]*x|set -o xtrace/);
    expect(sh).not.toMatch(/echo[^\n]*\$\{?CRON_SECRET/);
    // header ส่งผ่าน stdin (-H @-) ไม่ใช่ argv
    expect(sh).toMatch(/printf 'Authorization: Bearer %s\\n' "\$CRON_SECRET" \|\s*\n?\s*curl [^\n]*-H @-/);
  });
});
