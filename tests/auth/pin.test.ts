// ADR 0002 §2: argon2id (m=19456,t=2,p=1) + pepper · PHC · timingSafeEqual · dummy hash · วัด ms/verify
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashPin, parsePhc, verifyDummy, verifyPin, type Pepper } from '@/lib/auth/pin';

const pepper = (v: number, b: number): Pepper => ({ version: v, secret: Buffer.alloc(32, b) });

describe('pin hashing', () => {
  it('PHC: argon2id v=19 m=19456,t=2,p=1 · salt/tag ยาวตามกำหนด · salt ต่างกันทุกครั้ง', async () => {
    const a = await hashPin('482915', pepper(1, 7));
    const b = await hashPin('482915', pepper(1, 7));
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(a).not.toBe(b);
    const p = parsePhc(a)!;
    expect(p).toBeTruthy();
    expect(Buffer.from(a.split('$')[4]!, 'base64').length).toBe(16);
    expect(Buffer.from(a.split('$')[5]!, 'base64').length).toBe(32);
  });

  it('verify: ถูก=true · PIN ผิด=false · pepper ผิด=false', async () => {
    const phc = await hashPin('482915', pepper(1, 7));
    expect(await verifyPin('482915', phc, Buffer.alloc(32, 7))).toBe(true);
    expect(await verifyPin('482916', phc, Buffer.alloc(32, 7))).toBe(false);
    expect(await verifyPin('482915', phc, Buffer.alloc(32, 8))).toBe(false);
  });

  it('parsePhc ปฏิเสธรูปแบบเสีย/พารามิเตอร์เกินเพดาน และ verify คืน false ไม่โยน', async () => {
    const good = await hashPin('482915', pepper(1, 7));
    const bad = [
      '', 'garbage', '$argon2i$v=19$m=19456,t=2,p=1$AAAA$AAAA',
      good.replace('m=19456', 'm=999999999'), good.replace('t=2', 't=99'), good.replace('p=1', 'p=4'),
      good.replace('v=19', 'v=16'),
    ];
    for (const s of bad) {
      expect(parsePhc(s), s).toBeNull();
      expect(await verifyPin('482915', s, Buffer.alloc(32, 7))).toBe(false);
    }
  });

  it('verifyDummy คืน false เสมอ', async () => {
    expect(await verifyDummy('482915')).toBe(false);
    expect(await verifyDummy('123456')).toBe(false);
  });

  it('เทียบ tag ด้วย timingSafeEqual เท่านั้น ไม่ใช้ === / Buffer.equals', () => {
    const src = readFileSync(path.resolve(import.meta.dirname, '../../src/lib/auth/pin.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).toMatch(/timingSafeEqual/);
    expect(src).not.toMatch(/\.equals\(/);
  });

  it('วัดเวลา: เฉลี่ย ms/verify (รายงานใน Handoff)', async () => {
    const phc = await hashPin('482915', pepper(1, 7));
    await verifyPin('482915', phc, Buffer.alloc(32, 7)); // วอร์ม
    const N = 20;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) await verifyPin('482915', phc, Buffer.alloc(32, 7));
    const avg = (performance.now() - t0) / N;
    console.info(`[measure] argon2id verify avg ${avg.toFixed(1)} ms (n=${N})`);
    expect(avg).toBeLessThan(500); // เพดานหลวมกันเครื่องช้า · เป้าหมาย ≤100ms วัดแยกในรายงาน
  });
});
