// CI-1 (docs/NEXT_PHASE.md) — e2e ห้ามอัปโหลด artifact ทุก run (Actions storage ฟรี 0.5 GB เต็มจาก ~600 MB/run)
// ตรวจข้อความ .github/workflows/ci.yml ตรง ๆ (ไม่พึ่ง parser YAML ที่ไม่ใช่ dependency ตรงของโปรเจกต์)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');

/** step ทุกตัวที่ใช้ actions/upload-artifact (ข้อความตั้งแต่ "- name:" ถึงก่อน step ถัดไป) */
const uploadSteps = ci
  .split(/\n(?= {6}- )/)
  .filter((step) => /uses: actions\/upload-artifact@/.test(step));

/** ค่าของ key ใน step (ตัดคอมเมนต์ท้ายบรรทัด " # ..." ออก) */
const field = (step: string, key: string) =>
  step.match(new RegExp(`^ +${key}: (.+)$`, 'm'))?.[1]?.replace(/\s+#.*$/, '').trim();

describe('ci.yml: artifact ของ e2e (CI-1)', () => {
  it('มี step อัปโหลด 2 ตัว: รายงานเมื่อล้ม + ภาพหน้าจอเมื่อสั่งรันมือ', () => {
    expect(uploadSteps).toHaveLength(2);
  });

  it('ทุก step อัปโหลดมีเงื่อนไข if: ที่ไม่เป็นจริงใน run ปกติที่เขียว (ไม่ใช่ always()/!cancelled() อย่างเดียว)', () => {
    for (const step of uploadSteps) {
      const cond = field(step, 'if');
      expect(cond, step).toBeDefined();
      expect(cond).not.toMatch(/always\(\)/);
      expect(cond === '${{ failure() }}' || /github\.event_name == 'workflow_dispatch' && inputs\.screenshots/.test(cond!)).toBe(true);
    }
  });

  it('รายงานเมื่อล้มอัปโหลดเฉพาะ playwright-report/ (ไม่รวม test-results/ ที่มีภาพเต็มหน้าทุกหน้า)', () => {
    const onFailure = uploadSteps.find((s) => field(s, 'if') === '${{ failure() }}');
    expect(onFailure).toBeDefined();
    expect(field(onFailure!, 'path')).toBe('playwright-report/');
    expect(onFailure).not.toMatch(/test-results/);
  });

  it('ภาพหน้าจอครบชุด (test-results/) อัปโหลดเฉพาะรันมือ screenshots=true และไม่อัปโหลดเมื่อถูกยกเลิก', () => {
    const shots = uploadSteps.find((s) => field(s, 'path') === 'test-results/');
    expect(shots).toBeDefined();
    expect(field(shots!, 'if')).toBe("${{ !cancelled() && github.event_name == 'workflow_dispatch' && inputs.screenshots }}");
  });

  it('retention-days ของทุก artifact อยู่ระหว่าง 1–3 วัน', () => {
    for (const step of uploadSteps) {
      const days = Number(field(step, 'retention-days'));
      expect(days, step).toBeGreaterThanOrEqual(1);
      expect(days, step).toBeLessThanOrEqual(3);
    }
  });

  it('อัปโหลดล้มไม่ทำให้ job แดง (continue-on-error)', () => {
    for (const step of uploadSteps) expect(field(step, 'continue-on-error'), step).toBe('true');
  });

  it('workflow_dispatch มี input screenshots ชนิด boolean ดีฟอลต์ false', () => {
    expect(ci).toMatch(/ {2}workflow_dispatch:\n {4}inputs:\n {6}screenshots:\n(?: {8}.+\n)*? {8}type: boolean\n {8}default: false\n/);
  });

  it('Playwright ไม่เก็บ trace/video/screenshot ของเทสต์ที่ผ่าน', () => {
    const pw = readFileSync(path.join(ROOT, 'playwright.config.ts'), 'utf8');
    expect(pw).toMatch(/screenshot: 'only-on-failure'/);
    expect(pw).toMatch(/trace: 'retain-on-failure'/);
    expect(pw).not.toMatch(/video: '(on|retain-on-failure|on-first-retry)'/);
  });
});
