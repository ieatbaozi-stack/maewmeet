// scripts/pepper-fingerprint.ts — ADR 0002 §7.2/§7.4 · R1-8 (ไม่พิมพ์ pepper) · รันสคริปต์จริงผ่าน tsx เป็น subprocess
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fingerprintPrefix, pepperFingerprint } from '@/lib/auth/pepper';
import { fingerprintOfInput } from '../../scripts/pepper-fingerprint';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/pepper-fingerprint.ts');
const TSX = path.join(ROOT, 'node_modules/.bin/tsx');

function run(input: string | null, args: string[] = []) {
  const r = spawnSync(TSX, [SCRIPT, ...args], { cwd: ROOT, input: input ?? undefined, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('scripts/pepper-fingerprint.ts', { timeout: 90_000 }, () => {
  const pepper = randomBytes(32).toString('base64'); // สร้างในเทสต์ ไม่ใช่ค่าจริง
  const expected = createHmac('sha256', Buffer.from(pepper, 'base64')).update('maewmeet/pepper-fingerprint/v1').digest('hex');

  it('stdin → พิมพ์ 8 ตัวแรกของ fingerprint บรรทัดเดียว (ตรงสูตร ADR §7.2 และตรงฟังก์ชันของแอป)', () => {
    const r = run(`${pepper}\r\n`); // Get-Clipboard ต่อท้ายด้วย CRLF
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${expected.slice(0, 8)}\n`);
    expect(r.out.trim()).toBe(fingerprintPrefix(pepperFingerprint(Buffer.from(pepper, 'base64'))));
    expect(r.err).toBe('');
  });

  it('ไม่พิมพ์ pepper หรือ fingerprint เต็มทาง stdout/stderr ในทุกกรณี', () => {
    for (const r of [run(pepper), run(`${pepper}x!`), run(Buffer.alloc(16, 5).toString('base64')), run('')]) {
      for (const text of [r.out, r.err]) {
        expect(text).not.toContain(pepper);
        expect(text).not.toContain(expected);
        expect(text).not.toContain(expected.slice(0, 9));
      }
    }
  });

  it('ส่งเป็น argument → ปฏิเสธ exit 2 และไม่ echo argument', () => {
    const r = run(pepper, [pepper]);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).not.toContain(pepper);
    expect(r.err).toContain('stdin');
  });

  it('stdin ว่าง → exit 2 · ผิดรูป/สั้นกว่า 32 ไบต์ → exit 4 ไม่มี stdout', () => {
    expect(run('  \n').code).toBe(2);
    for (const bad of [Buffer.alloc(31, 9).toString('base64'), 'not base64 at all', `${pepper}\n${pepper}`]) {
      const r = run(bad);
      expect(r.code, bad).toBe(4);
      expect(r.out).toBe('');
    }
  });

  it('fingerprintOfInput: ค่าเดียวกัน → ผลเดียวกัน · ต่างกัน → ต่างกัน', () => {
    const a = fingerprintOfInput(pepper);
    expect(a).toEqual(fingerprintOfInput(`  ${pepper}\n`));
    expect(a.stdout).not.toBe(fingerprintOfInput(randomBytes(32).toString('base64')).stdout);
  });

  it('ไม่มีโค้ดสร้าง pepper และไม่เขียนสูตร HMAC ซ้ำในสคริปต์', () => {
    const src = readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/randomBytes|getRandomValues|randomUUID|createHmac|createHash/);
    expect(src).toMatch(/from '\.\.\/src\/lib\/auth\/pepper'/);
  });
});
