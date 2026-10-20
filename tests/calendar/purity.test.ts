// lib เวลาต้อง pure: import ได้เฉพาะ temporal-polyfill และไฟล์ภายใน · ไม่อ่านนาฬิกา/env (now ต้อง inject)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src/lib/calendar');
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

describe('src/lib/calendar เป็น pure', () => {
  it('มีไฟล์ให้ตรวจ', () => expect(files.length).toBeGreaterThan(5));

  it('free-time.ts (R4A) อยู่ในชุดที่ตรวจ · ไม่ import temporal-polyfill ตรง · ไม่ใช้ Date/Intl/Math.random', () => {
    expect(files).toContain('free-time.ts');
    const src = readFileSync(join(DIR, 'free-time.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/temporal-polyfill|\bDate\b|Intl\.|Math\.random|setTimeout|globalThis|require\(/);
  });

  it.each(files)('%s: import เฉพาะ temporal-polyfill / ./ภายใน', (f) => {
    const src = readFileSync(join(DIR, f), 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => m[1]!);
    for (const s of specs) expect(s === 'temporal-polyfill' || s.startsWith('./')).toBe(true);
  });

  it.each(files)('%s: ไม่เรียกนาฬิกา/env/ระบบ', (f) => {
    const src = readFileSync(join(DIR, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/Date\.now\(|new Date\(|process\.env|Temporal\.Now|performance\.now|fetch\(/);
  });
});
