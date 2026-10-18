// ADR 0002 Test requirement 16 (§7.1): ไม่มีโค้ดสร้าง pepper — ค้น src/** (และ scripts/**) ว่าไฟล์ที่อ้างถึง PIN_PEPPER
// ไม่มีการเรียก randomBytes/getRandomValues/ตัวสร้างกุญแจ · schema env ไม่มีค่า fallback · ไม่มีเส้นทาง "ไม่มี pepper" ตอน verify
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { requirePepper } from '@/lib/auth/pepper';
import { readPepperEnv } from '@/lib/shared/env';
import { Client, setupHarness } from './harness';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SKIP_DIRS = new Set(['node_modules', '.next', 'drizzle']);

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(n)) out.push(p);
  }
  return out;
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** การสร้างกุญแจ/ค่าสุ่มโดยตรง — ห้ามอยู่ในไฟล์ที่แตะ PIN_PEPPER */
const GENERATORS = /\b(randomBytes|randomFill(?:Sync)?|getRandomValues|generateKey(?:Sync|Pair)?|randomUUID|randomInt|Math\.random)\b/;

export function pepperFilesWithGenerators(files: { file: string; code: string }[]): string[] {
  return files.filter(({ code }) => /PIN_PEPPER/.test(code) && GENERATORS.test(code)).map((f) => f.file);
}

const load = (dirs: string[]) =>
  dirs
    .flatMap((d) => walk(path.join(ROOT, d)))
    .map((file) => ({ file: path.relative(ROOT, file), code: stripComments(readFileSync(file, 'utf8')) }));

describe('ไม่มีโค้ดสร้าง pepper', () => {
  it('ตัวตรวจจับของจริงได้ (ด้านลบ)', () => {
    const bad = [
      { file: 'a.ts', code: "const p = process.env.PIN_PEPPER_V1 ?? randomBytes(32).toString('base64')" },
      { file: 'b.ts', code: 'const k = crypto.getRandomValues(new Uint8Array(32)); use(process.env.PIN_PEPPER_V1)' },
      { file: 'c.ts', code: 'const v = "PIN_PEPPER_V1"; Math.random()' },
      { file: 'ok.ts', code: 'const salt = randomBytes(16)' }, // ไม่แตะ pepper = ได้
    ];
    expect(pepperFilesWithGenerators(bad)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('src/** และ scripts/**: ไม่มีไฟล์ที่อ้างถึง PIN_PEPPER แล้วเรียกตัวสร้างค่าสุ่ม/กุญแจ', () => {
    const files = load(['src', 'scripts']);
    expect(files.length).toBeGreaterThan(40);
    const mentioning = files.filter((f) => /PIN_PEPPER/.test(f.code)).map((f) => f.file);
    expect(mentioning).toEqual(expect.arrayContaining([path.join('src', 'lib', 'shared', 'env.ts')])); // สแกนถึงไฟล์ env จริง
    expect(pepperFilesWithGenerators(files)).toEqual([]);
  });

  it('โมดูล pepper (src/lib/auth/pepper.ts): ไม่ import ตัวสร้างค่าสุ่มของโปรเจกต์ (id/tokens) และไม่เรียก random ใด ๆ', () => {
    const src = stripComments(readFileSync(path.join(ROOT, 'src/lib/auth/pepper.ts'), 'utf8'));
    expect(src).not.toMatch(GENERATORS);
    expect(src).not.toMatch(/@\/lib\/shared\/id|\.\/tokens|node:crypto'[^;]*random/);
    // และ pin.ts (ที่สุ่ม salt) ไม่อ่าน env ใด ๆ → ไม่มีทางผูก salt กับการ "สร้าง pepper"
    const pin = stripComments(readFileSync(path.join(ROOT, 'src/lib/auth/pin.ts'), 'utf8'));
    expect(pin).not.toMatch(/process\.env|PIN_PEPPER/);
  });

  it('schema env: บรรทัดที่เกี่ยวกับ PIN_PEPPER ไม่มี .default()/ค่า fallback · ไม่มีค่าว่างที่ยอมรับเป็น pepper', () => {
    const env = stripComments(readFileSync(path.join(ROOT, 'src/lib/shared/env.ts'), 'utf8'));
    const lines = env.split('\n').filter((l) => /PIN_PEPPER/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l, l).not.toMatch(/\.default\(|\?\?|\|\|/);
    // พฤติกรรม: ไม่มีอะไรเลย / ว่าง / สั้น / ไม่ใช่ base64 → ไม่ ok ทั้งหมด (ไม่มีดีฟอลต์)
    expect(readPepperEnv({}).ok).toBe(false);
    expect(readPepperEnv({ PIN_PEPPER_CURRENT_VERSION: '1' }).ok).toBe(false);
    expect(readPepperEnv({ PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: '' }).ok).toBe(false);
    expect(readPepperEnv({ PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: Buffer.alloc(31).toString('base64') }).ok).toBe(false);
    expect(readPepperEnv({ PIN_PEPPER_CURRENT_VERSION: '1', PIN_PEPPER_V1: Buffer.alloc(32, 1).toString('base64') }).ok).toBe(true);
  });

  it('พฤติกรรม: ไม่มี pepper ใน env → requirePepper โยน AUTH_MAINTENANCE และไม่เขียนอะไรลงฐาน (ไม่สร้างให้เอง)', async () => {
    const h = await setupHarness({ peppers: {}, current: null, initFingerprint: false });
    try {
      await expect(requirePepper(h.db, h.clock.now())).rejects.toMatchObject({ code: 'AUTH_MAINTENANCE' });
      const r = await new Client().post('/api/auth/signup', { username: 'abc', displayName: 'x', pin: '482915', pinConfirm: '482915' });
      expect(r.code).toBe('AUTH_MAINTENANCE');
      expect(await h.count('pepper_fingerprint')).toBe(0);
      expect(await h.count('user')).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  it('ไม่มีเส้นทาง "verify ไม่ผ่านแล้วลองแบบไม่มี pepper": verifyPin ต้องรับ secret เสมอ และ login ไม่มี fallback', () => {
    const login = stripComments(readFileSync(path.join(ROOT, 'src/lib/auth/services/login.ts'), 'utf8'));
    const pin = stripComments(readFileSync(path.join(ROOT, 'src/lib/auth/pin.ts'), 'utf8'));
    expect(pin).toMatch(/export async function verifyPin\(pin: string, phc: string, secret: Buffer\)/);
    expect(login).not.toMatch(/Buffer\.alloc\(0\)|undefined\s*\)\s*;?\s*\/\/\s*no pepper/i);
    // ทุกการเรียก verifyPin ใน services ส่ง secret ของ pepper ที่หาจากเวอร์ชันของแถว (pepperOfVersion) ไม่ใช่ค่าตายตัว
    for (const f of ['login.ts', 'pin-change.ts']) {
      const code = stripComments(readFileSync(path.join(ROOT, 'src/lib/auth/services', f), 'utf8'));
      for (const m of code.matchAll(/verifyPin\(([^)]*)\)/g)) expect(m[1]).toMatch(/pepper\.secret/);
    }
  });
});
