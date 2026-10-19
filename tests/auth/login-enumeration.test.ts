// ADR 0002 Test requirement 2 (U1): login ผิดด้วย username ที่ไม่มี vs มีแต่ PIN ผิด → status, body, header เหมือนกันทุกไบต์
// และ lockout schedule เหมือนกัน · บัญชี suspended บอกเฉพาะเมื่อ PIN ถูก
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, GOOD_PIN, MIN, OTHER_PIN, sameResponse, setupHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
  await h.seedUser('alice');
});
afterEach(async () => {
  await h.cleanup();
});

describe('login ไม่รั่วว่ามีบัญชีหรือไม่', () => {
  it('ทุกครั้งที่ผิด (ครั้งที่ 1–4 ไม่ล็อก, ครั้งที่ 5 ล็อก) ผลเหมือนกันทุกไบต์ ระหว่าง "ไม่มีผู้ใช้" กับ "มีแต่ PIN ผิด"', async () => {
    const ghost = new Client();
    const real = new Client();
    for (let i = 1; i <= 5; i++) {
      const a = await ghost.login('nobody_here', OTHER_PIN);
      const b = await real.login('alice', OTHER_PIN);
      sameResponse(a, b);
      if (i < 5) {
        expect(a.status).toBe(401);
        expect(a.json.error).toEqual({ code: 'INVALID_CREDENTIALS', params: { attemptsRemaining: 5 - i } });
      } else {
        expect(a.status).toBe(429);
        expect(a.json.error).toEqual({ code: 'LOGIN_LOCKED', params: { retryAfterSec: 60 } });
        expect(a.headers.get('retry-after')).toBe('60');
      }
    }
  });

  it('ระหว่างล็อก: PIN ถูกของบัญชีจริง = PIN อะไรก็ได้ของบัญชีที่ไม่มี (ทุกไบต์)', async () => {
    const ghost = new Client();
    const real = new Client();
    for (let i = 0; i < 5; i++) {
      await ghost.login('nobody_here', OTHER_PIN);
      await real.login('alice', OTHER_PIN);
    }
    const a = await ghost.login('nobody_here', GOOD_PIN);
    const b = await real.login('alice', GOOD_PIN); // ถูกต้อง แต่ล็อกอยู่
    sameResponse(a, b);
    expect(b.status).toBe(429);
    expect(b.code).toBe('LOGIN_LOCKED');
  });

  it('ตารางล็อกเหมือนกันหลังครบเวลา: ผิดอีกครั้ง → 120 วินาที ทั้งสองกรณี', async () => {
    const ghost = new Client();
    const real = new Client();
    for (let i = 0; i < 5; i++) {
      await ghost.login('nobody_here', OTHER_PIN);
      await real.login('alice', OTHER_PIN);
    }
    h.clock.advance(60_000 + 1000);
    const a = await ghost.login('nobody_here', OTHER_PIN);
    const b = await real.login('alice', OTHER_PIN);
    sameResponse(a, b);
    expect(a.json.error).toEqual({ code: 'LOGIN_LOCKED', params: { retryAfterSec: 120 } });
  });

  it('username ต่างตัวพิมพ์/ช่องว่าง/fullwidth ใช้ตัวนับเดียวกันและตอบเหมือนกัน', async () => {
    const c = new Client();
    const outs = [
      await c.login('alice', OTHER_PIN),
      await c.login('ALICE', OTHER_PIN),
      await c.login(' Alice ', OTHER_PIN),
      await c.login('ａｌｉｃｅ', OTHER_PIN),
    ];
    expect(outs.map((o) => o.json.error?.params)).toEqual([
      { attemptsRemaining: 4 },
      { attemptsRemaining: 3 },
      { attemptsRemaining: 2 },
      { attemptsRemaining: 1 },
    ]);
  });

  it('username รูปแบบแปลก (ไม่มีทางเป็นบัญชีจริง) ตอบเหมือน "ไม่มีผู้ใช้" ไม่ใช่ VALIDATION', async () => {
    const a = await new Client().login('x', OTHER_PIN);
    const b = await new Client().login('nobody_here', OTHER_PIN);
    sameResponse(a, b);
    expect(a.code).toBe('INVALID_CREDENTIALS');
  });

  it('PIN รูปแบบผิด (ไม่ใช่ 6 หลัก) ตอบ PIN_FORMAT เหมือนกันไม่ว่ามีบัญชีหรือไม่ และไม่นับ throttle', async () => {
    const a = await new Client().login('nobody_here', 'abc');
    const b = await new Client().login('alice', 'abc');
    sameResponse(a, b);
    expect(a.code).toBe('PIN_FORMAT');
    expect(await h.rows('SELECT * FROM login_throttle')).toHaveLength(0);
  });

  it('บัญชี suspended: PIN ผิด → INVALID_CREDENTIALS เหมือนคนอื่น · PIN ถูก → ACCOUNT_SUSPENDED (และไม่ออก session)', async () => {
    await h.seedUser('bob');
    await h.rows("UPDATE user SET status = 'suspended' WHERE username = 'bob'");
    const wrong = await new Client().login('bob', OTHER_PIN);
    const ghost = await new Client().login('nobody_here', OTHER_PIN);
    sameResponse(wrong, ghost);
    const c = new Client();
    const right = await c.login('bob', GOOD_PIN);
    expect(right.status).toBe(401);
    expect(right.code).toBe('ACCOUNT_SUSPENDED');
    expect(c.jar.size).toBe(0);
    expect(await h.rows('SELECT * FROM session')).toHaveLength(0);
  });

  it('บัญชี deleted ถือเป็น "ไม่มีผู้ใช้"', async () => {
    await h.seedUser('carol');
    await h.rows("UPDATE user SET status = 'deleted' WHERE username = 'carol'");
    const a = await new Client().login('carol', GOOD_PIN);
    const b = await new Client().login('nobody_here', GOOD_PIN);
    sameResponse(a, b);
    expect(a.code).toBe('INVALID_CREDENTIALS');
  });

  it('เวลาตอบใกล้เคียงกัน (verify หลอก) — ไม่ต่างกันเกิน 3 เท่า (ตรวจหยาบ ไม่ใช่การพิสูจน์ constant-time)', async () => {
    const time = async (u: string) => {
      const c = new Client();
      const t0 = performance.now();
      await c.login(u, OTHER_PIN);
      return performance.now() - t0;
    };
    await time('alice'); // warm-up (dummy hash ครั้งแรก)
    await time('nobody_here');
    const real: number[] = [];
    const ghost: number[] = [];
    for (let i = 0; i < 3; i++) {
      real.push(await time('alice'));
      h.clock.advance(20 * MIN);
      ghost.push(await time(`nobody_${i}`));
      h.clock.advance(20 * MIN);
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[1]!;
    const ratio = Math.max(med(real), med(ghost)) / Math.min(med(real), med(ghost));
    expect(ratio).toBeLessThan(3);
  });
});
