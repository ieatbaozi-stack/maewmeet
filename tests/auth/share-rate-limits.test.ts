/**
 * R18 §S — ค่าถัง rate limit ของลิงก์ชวน/แขก (ADR 0016 §6) ที่ auth ยืนยัน
 * ตัวเลขเขียนมือตรงนี้ (ไม่คัดจาก throttle.ts) — เปลี่ยนค่าแล้วเทสต์ต้องล้ม เพื่อให้ผู้ตรวจเห็น
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RATE_LIMITS, SHARE_RATE_LIMITS, rateKey } from '@/lib/auth/throttle';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('SHARE_RATE_LIMITS (ADR 0016 §6)', () => {
  it('ค่าตรงตามที่ auth ยืนยัน', () => {
    expect(SHARE_RATE_LIMITS).toEqual({
      createUser: { prefix: 'share:create:u', limit: 30, windowMs: HOUR },
      revokeUser: { prefix: 'share:revoke:u', limit: 60, windowMs: 10 * MIN },
      joinUser: { prefix: 'share:join:u', limit: 10, windowMs: 15 * MIN },
      joinIp: { prefix: 'share:join:ip', limit: 30, windowMs: 15 * MIN },
      guestUser: { prefix: 'share:guest:u', limit: 30, windowMs: HOUR },
      viewIp: { prefix: 'share:view:ip', limit: 120, windowMs: 15 * MIN },
      guestRemoveUser: { prefix: 'share:guest:remove:u', limit: 60, windowMs: 10 * MIN },
    });
  });

  it('ถัง join เข้มกว่าหรือเท่ากับถังใช้โค้ดเชิญ (redeem 10/15 นาที/ผู้ใช้ · 30/15 นาที/IP) และ IP ≥ ผู้ใช้', () => {
    expect(SHARE_RATE_LIMITS.joinUser.limit).toBeLessThanOrEqual(10);
    expect(SHARE_RATE_LIMITS.joinIp.limit).toBeLessThanOrEqual(30);
    expect(SHARE_RATE_LIMITS.joinIp.limit).toBeGreaterThanOrEqual(SHARE_RATE_LIMITS.joinUser.limit);
  });

  it('คีย์ถังไม่ชนกันเอง (prefix ต่างกัน และไม่มี prefix ใดเป็นต้นของอีกตัว + ":")', () => {
    const prefixes = Object.values(SHARE_RATE_LIMITS).map((s) => s.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const a of prefixes) for (const b of prefixes) if (a !== b) expect(b.startsWith(`${a}:`), `${a} / ${b}`).toBe(false);
    expect(rateKey(SHARE_RATE_LIMITS.guestUser, 'u1')).toBe('share:guest:u:u1');
    expect(rateKey(SHARE_RATE_LIMITS.guestRemoveUser, 'u1')).toBe('share:guest:remove:u:u1');
  });

  it('prefix ไม่ซ้ำกับถังอื่นในโค้ด (สแกน `prefix: \'…\'` ทั้ง src/)', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(join(process.cwd(), 'src'));
    const all = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/prefix:\s*'([^']+)'/g)].map((m) => m[1]!));
    const share = new Set<string>(Object.values(SHARE_RATE_LIMITS).map((s) => s.prefix));
    for (const s of share) expect(all.filter((p) => p === s), s).toHaveLength(1);
    // ถังอื่นไม่มีตัวไหนขึ้นต้นด้วย share: (ตระกูลนี้เป็นของ §S เท่านั้น)
    expect(all.filter((p) => p.startsWith('share:') && !share.has(p))).toEqual([]);
    // ตัวอย่างถังเดิมยังอยู่ (สแกนได้จริง)
    expect(all).toContain(RATE_LIMITS.loginIp.prefix);
  });
});
