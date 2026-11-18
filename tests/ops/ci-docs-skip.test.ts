// R15b — PR เอกสารล้วนข้าม build + e2e แต่โค้ดไม่ถูกลดความเข้มงวด
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');
const jobBlock = (name: string) => ci.split(/\n(?=  [a-z0-9-]+:\n)/).find((b) => b.includes(`  ${name}:\n`)) ?? '';

describe('ci.yml: ข้าม build/e2e เมื่อเอกสารล้วน', () => {
  it('build รอ changes และมี if ระดับ job (ไม่ใช่ matrix ชื่อคงเดิม)', () => {
    const b = jobBlock('build');
    expect(b).toMatch(/needs: changes/);
    expect(b).toMatch(/\n    if: \$\{\{ needs\.changes\.outputs\.code == 'true' \}\}/);
  });
  it('e2e (matrix) ห้ามมี if ระดับ job (ชื่อ e2e (Playwright) (1..4) ต้องไม่ยุบ) · ทุก step ต้องมี if code == true', () => {
    const b = jobBlock('e2e');
    expect(b).toMatch(/needs: changes/);
    expect(b).not.toMatch(/\n    if:/);
    const steps = b.split(/\n(?=      - )/).slice(1);
    expect(steps.length).toBeGreaterThanOrEqual(8);
    for (const s of steps) expect(s, s.split('\n')[0]).toMatch(/if: \$\{\{ .*needs\.changes\.outputs\.code == 'true'.*\}\}/);
    expect(b).toMatch(/name: e2e \(Playwright\)\n/);
  });
  it('lint/typecheck/test/contrast ไม่ถูกข้าม · ไม่ใช้ paths-ignore', () => {
    for (const j of ['lint', 'typecheck', 'test', 'contrast']) expect(jobBlock(j), j).not.toMatch(/needs\.changes/);
    expect(ci).not.toMatch(/^\s*paths(-ignore)?:/m);
  });
});

describe('changed-code.sh', () => {
  const git = (cwd: string, ...a: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd, encoding: 'utf8' }).trim();
  const run = (cwd: string, base: string) => {
    const out = path.join(cwd, 'out.txt');
    writeFileSync(out, '');
    execFileSync('bash', [path.join(ROOT, '.github/scripts/changed-code.sh')], {
      cwd, env: { ...process.env, BASE_SHA: base, HEAD_SHA: 'HEAD', GITHUB_OUTPUT: out }, stdio: 'pipe',
    });
    return readFileSync(out, 'utf8').trim();
  };
  const repo = () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'cc-'));
    git(d, 'init', '-q');
    writeFileSync(path.join(d, 'a.txt'), '1');
    git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
    return { d, base: git(d, 'rev-parse', 'HEAD') };
  };
  const commit = (d: string, rel: string) => {
    const f = path.join(d, rel);
    execFileSync('node', ['-e', `const fs=require('fs');fs.mkdirSync(require('path').dirname(${JSON.stringify(f)}),{recursive:true});fs.writeFileSync(${JSON.stringify(f)},'x')`]);
    git(d, 'add', '-A'); git(d, 'commit', '-qm', 'c');
  };

  it('เอกสารล้วน -> code=false', () => {
    const { d, base } = repo();
    commit(d, 'docs/x/y.txt'); commit(d, 'README.md');
    expect(run(d, base)).toBe('code=false');
  });
  it('มีไฟล์โค้ดปนอยู่ -> code=true', () => {
    const { d, base } = repo();
    commit(d, 'docs/a.md'); commit(d, 'src/a.ts');
    expect(run(d, base)).toBe('code=true');
  });
  it('แตะ workflow/package.json -> code=true · ไม่มี base -> code=true', () => {
    const { d, base } = repo();
    commit(d, '.github/workflows/ci.yml');
    expect(run(d, base)).toBe('code=true');
    expect(run(d, '')).toBe('code=true');
  });
});
