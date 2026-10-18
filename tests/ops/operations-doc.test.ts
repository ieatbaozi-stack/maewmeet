// QA (#12) R0 — OPERATIONS.md ต้องตรงกับพฤติกรรมจริงเมื่อ env "ต้องมี" หาย (R0-5 × R0-18)
// พฤติกรรมจริง (QA รัน `next start` โดยไม่มี CRON_SECRET): instrumentation.ts โยน EnvError ตอนเริ่ม →
// Next พิมพ์ "An error occurred while loading instrumentation hook: Invalid environment configuration — missing: …"
// แล้วทุก URL (รวม /api/health) ตอบ 500 "Internal Server Error" — health route ไม่เคยได้รัน จึงไม่มี 503 / log `[health]`
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const doc = readFileSync(path.join(process.cwd(), 'docs/OPERATIONS.md'), 'utf8');
const g1 = doc.slice(doc.indexOf('### G1'), doc.indexOf('### G2'));
const appendix = doc.slice(doc.indexOf('## ภาคผนวก'));

describe('OPERATIONS.md ตรงกับพฤติกรรม fail-fast ของ env (R0-5)', () => {
  it('G1 บอกอาการจริง: ทุก URL ตอบ 500 และข้อความ log จาก instrumentation hook', () => {
    expect(g1).toContain('500');
    expect(g1).toContain('loading instrumentation hook');
    expect(g1).toContain('Invalid environment configuration');
  });

  it('G1 ไม่สั่งให้ค้น log `[health]` (บรรทัดนี้ไม่เกิดเมื่อแอปไม่เริ่ม)', () => {
    expect(g1).not.toMatch(/ค้นคำว่า `\[health\]`/);
  });

  it('ภาคผนวก: ตัวแปร "ต้องมี" ที่ขาด ไม่ได้ทำให้ health 503 (แอปไม่เริ่มเลย)', () => {
    for (const name of ['TURSO_DATABASE_URL', 'APP_SECRET', 'CRON_SECRET', 'APP_ORIGIN']) {
      const row = appendix.split('\n').find((l) => l.startsWith(`| \`${name}\``));
      expect(row, name).toBeDefined();
      expect(row, name).not.toContain('health 503');
    }
  });
});
