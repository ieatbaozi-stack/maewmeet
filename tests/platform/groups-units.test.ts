// หน่วยย่อยของ R2: โค้ดเชิญ (alphabet/สุ่ม/normalize/hash) · ชื่อกลุ่ม · สีสมาชิก · เพดาน/รหัส error · คิวเขียน
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkGroupName } from '@/lib/data/group-name';
import {
  formatInviteCode,
  generateInviteCode,
  hashInviteCode,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  inviteCodeHint,
  normalizeInviteCode,
} from '@/lib/data/invite-code';
import { ERROR_CODES, ERROR_HTTP_STATUS } from '@/lib/shared/errors';
import { GROUP_LIMITS } from '@/lib/shared/limits';
import { MEMBER_COLOR_COUNT, memberColorIndex } from '@/lib/shared/member-color';
import { createTestDb } from '../helpers/db';
import { serialized } from '@/lib/data/tx';

describe('โค้ดเชิญ: alphabet', () => {
  it('31 ตัวเป๊ะ · ไม่มี 0 O 1 I L · ไม่ซ้ำ', () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(31);
    for (const bad of '01OIL') expect(INVITE_CODE_ALPHABET).not.toContain(bad);
    const expected = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789'].filter((ch) => !'ILO'.includes(ch));
    expect([...INVITE_CODE_ALPHABET].sort()).toEqual(expected.sort()); // A–Z ตัด I L O + 2–9 (ตัด 0 และ 1 ไม่มีในชุดตั้งแต่ต้น)
    expect(INVITE_CODE_LENGTH).toBeGreaterThanOrEqual(8);
  });

  it('โค้ดที่สุ่มได้: 8 ตัวจาก alphabet เท่านั้น · รูปแบบแสดง XXXX-XXXX · ไม่ซ้ำกันใน 5,000 โค้ด', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const c = generateInviteCode();
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
      expect(formatInviteCode(c)).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(5000);
  });

  it('สถิติ: ทุกตำแหน่งกระจายสม่ำเสมอ (chi-square df=30, เกณฑ์หลวง 90 ≈ p<1e-7 กัน flaky) ทั้งอักขระรวมและตำแหน่งแรก/สุดท้าย', () => {
    const N = 31 * 2000;
    const chi = (counts: Map<string, number>, expected: number) =>
      [...INVITE_CODE_ALPHABET].reduce((s, ch) => s + ((counts.get(ch) ?? 0) - expected) ** 2 / expected, 0);
    const all = new Map<string, number>();
    const first = new Map<string, number>();
    const last = new Map<string, number>();
    for (let i = 0; i < N / 8; i++) {
      const c = generateInviteCode();
      for (const ch of c) all.set(ch, (all.get(ch) ?? 0) + 1);
    }
    for (let i = 0; i < N; i++) {
      const c = generateInviteCode();
      first.set(c[0]!, (first.get(c[0]!) ?? 0) + 1);
      last.set(c[7]!, (last.get(c[7]!) ?? 0) + 1);
    }
    expect(chi(all, N / 31)).toBeLessThan(90);
    expect(chi(first, N / 31)).toBeLessThan(90);
    expect(chi(last, N / 31)).toBeLessThan(90);
    expect(all.size).toBe(31); // ใช้ครบทุกตัว
  });
});

describe('โค้ดเชิญ: normalize + hash', () => {
  it('normalize: ตัวพิมพ์/ช่องว่าง/ขีดทุกแบบ/ตัวเต็มความกว้าง → รูปเดียวกัน · รูปผิด → null', () => {
    const want = 'ABCD2345';
    for (const raw of ['ABCD-2345', 'abcd-2345', ' abcd 2345 ', 'ABCD2345', 'ABCD–2345', 'ABCD‐2345', 'ＡＢＣＤ－２３４５', 'AB​CD-23­45', '\tABCD\n2345']) {
      expect(normalizeInviteCode(raw), JSON.stringify(raw)).toBe(want);
    }
    for (const raw of ['', '----', 'ABCD-234', 'ABCD-23456', 'ABCD-2340', 'ABCD-2341', 'OOOO-0000', 'ILIL-1111', 'ABCD-23_5', '😀😀😀😀😀😀😀😀', 'ABCD-2345X']) {
      expect(normalizeInviteCode(raw), JSON.stringify(raw)).toBeNull();
    }
    expect(inviteCodeHint('ABCD2345')).toBe('2345');
  });

  it('hash: HMAC มีกุญแจ — ต่าง secret ต่าง hash · deterministic · ไม่ใช่ SHA-256 ล้วน · hex 64', () => {
    const k1 = Buffer.alloc(32, 1).toString('base64');
    const k2 = Buffer.alloc(32, 2).toString('base64');
    const h1 = hashInviteCode('ABCD2345', k1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteCode('ABCD2345', k1)).toBe(h1);
    expect(hashInviteCode('ABCD2345', k2)).not.toBe(h1);
    expect(hashInviteCode('ABCD2346', k1)).not.toBe(h1);
    expect(h1).not.toBe(createHash('sha256').update('ABCD2345').digest('hex'));
  });
});

describe('ชื่อกลุ่ม', () => {
  it('trim + NFC · นับ code point · ขอบเขต 1–40', () => {
    expect(checkGroupName('  แมว  ')).toEqual({ ok: true, name: 'แมว' });
    expect(checkGroupName('é')).toEqual({ ok: true, name: 'é' }); // NFC
    expect(checkGroupName('a'.repeat(GROUP_LIMITS.nameMax))).toMatchObject({ ok: true });
    expect(checkGroupName('a'.repeat(GROUP_LIMITS.nameMax + 1))).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(checkGroupName('')).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(checkGroupName('   ')).toEqual({ ok: false, reason: 'TOO_SHORT' });
  });
  it('ห้าม: ควบคุม · bidi · zero-width · separator · private-use · ตัวเติมมองไม่เห็น (ทุกตัวที่ระบุ)', () => {
    const bad = ['\u0000', '\u0007', '\n', '\r', '\t', '\u007f', '\u0085', '؜', '​', '‌', '‍', '‎', '‏', '‪', '‫', '‬', '‭', '‮', '⁠', '⁦', '⁧', '⁨', '⁩', '﻿', '­', ' ', ' ', '', 'ㅤ', 'ᅟ', '឴'];
    for (const ch of bad) expect(checkGroupName(`ก${ch}ข`), `U+${ch.codePointAt(0)!.toString(16)}`).toEqual({ ok: false, reason: 'INVALID' });
    // ที่ต้องผ่าน: ไทย (สระ/วรรณยุกต์ซ้อน), อีโมจิ, ภาษาอื่น, ช่องว่างกลางชื่อ, เครื่องหมาย
    for (const ok of ['ก๊วนแมวเหมียว ๑๒๓', '🐱 แมว', 'Café 猫', "Tom's gang!", 'a  b']) expect(checkGroupName(ok), ok).toMatchObject({ ok: true });
  });
});

describe('สีสมาชิก', () => {
  it('เป็นจำนวนเต็ม 0–9, deterministic, คงที่ต่อ (กลุ่ม, ผู้ใช้) และต่างกันตามกลุ่ม', () => {
    const g = '11111111-1111-4111-8111-111111111111';
    const u = '22222222-2222-4222-8222-222222222222';
    expect(memberColorIndex(g, u)).toBe(memberColorIndex(g, u));
    const counts = new Array<number>(MEMBER_COLOR_COUNT).fill(0);
    for (let i = 0; i < 5000; i++) {
      const idx = memberColorIndex(g, `${i}`.padStart(8, '0') + u.slice(8));
      expect(Number.isInteger(idx) && idx >= 0 && idx < MEMBER_COLOR_COUNT).toBe(true);
      counts[idx]!++;
    }
    for (const n of counts) expect(n).toBeGreaterThan(400); // ใช้ครบ 10 สี กระจายพอสมควร (คาด 500)
    const perGroup = new Set(Array.from({ length: 200 }, (_, i) => memberColorIndex(`${i}`.padStart(8, '0') + g.slice(8), u)));
    expect(perGroup.size).toBeGreaterThan(5);
  });
});

describe('รหัส error / เพดาน', () => {
  it('LIMIT_REACHED เป็น 409 และอยู่ใน ERROR_CODES', () => {
    expect(ERROR_CODES).toContain('LIMIT_REACHED');
    expect(ERROR_HTTP_STATUS.LIMIT_REACHED).toBe(409);
  });
  it('เพดานตาม R2_CONTRACT §3', () => {
    expect(GROUP_LIMITS).toMatchObject({ groupsCreatedPerUser: 10, membersPerGroup: 50, activeCodesPerGroup: 20, nameMin: 1, nameMax: 40, inviteTtlMs: 7 * 86_400_000 });
  });
});

describe('คิวเขียน serialized()', () => {
  it('รันทีละตัวตามลำดับ · ตัวที่ล้มไม่ทำให้คิวค้าง', async () => {
    const t = await createTestDb({ migrate: false });
    try {
      const log: string[] = [];
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const a = serialized(t.db, async () => {
        log.push('a:start');
        await sleep(20);
        log.push('a:end');
        return 1;
      });
      const b = serialized(t.db, async () => {
        log.push('b:start');
        throw new Error('boom');
      });
      const c = serialized(t.db, async () => {
        log.push('c:start');
        return 3;
      });
      await expect(b).rejects.toThrow('boom');
      expect(await Promise.all([a, c])).toEqual([1, 3]);
      expect(log).toEqual(['a:start', 'a:end', 'b:start', 'c:start']);
    } finally {
      await t.cleanup();
    }
  });
});
