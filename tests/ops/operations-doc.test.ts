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

// R1-8 / OPS: ส่วน H ต้องตรงกับสคริปต์และ ADR จริง
const h = doc.slice(doc.indexOf('## H.'), doc.indexOf('## ภาคผนวก'));

describe('OPERATIONS.md ส่วน H (super admin คนแรก + ซ้อมกู้ pepper)', () => {
  it('H1: SQL ตั้ง/ตรวจ super admin ตรงตามที่ตัดสินใจ และบอกชัดว่าไม่มีสคริปต์/endpoint สร้างให้', () => {
    expect(h).toContain("UPDATE user SET is_admin = 1 WHERE username = '<name>';");
    expect(h).toContain('SELECT username,is_admin FROM user WHERE is_admin=1;');
    expect(h).toMatch(/ไม่มีสคริปต์และไม่มีหน้าเว็บใดสร้าง super admin/);
  });

  it('H2/H4: คำสั่งในเอกสารตรงกับแฟลก/ไฟล์ของสคริปต์จริง และไม่ส่ง pepper/PIN เป็น argument', () => {
    expect(h).toContain('Get-Clipboard | npx tsx scripts/pepper-fingerprint.ts');
    expect(h).toContain('npx tsx scripts/admin-reset-pin.ts --username boss --confirm-username boss --confirm-pepper-lost');
    for (const f of ['scripts/pepper-fingerprint.ts', 'scripts/admin-reset-pin.ts']) {
      expect(readFileSync(path.join(process.cwd(), f), 'utf8').length).toBeGreaterThan(500);
    }
    expect(h).not.toMatch(/PIN_PEPPER_V\d\s*=\s*"?[A-Za-z0-9+/]{40,}/);
  });

  it('ส่วนที่เขียนจากความจำเกี่ยวกับหน้าจอภายนอกต้องติดป้าย "ตรวจกับหน้าจอจริง"', () => {
    expect((h.match(/ตรวจกับหน้าจอจริง/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('G7 ชี้ H และ health ตัวอย่างมี pepper', () => {
    expect(doc).toContain('"pepper":{"ok":true,"currentVersion":1,"usersByVersion":{}}');
    expect(doc.slice(doc.indexOf('### G7'), doc.indexOf('## H.'))).toContain('H4');
  });
});
