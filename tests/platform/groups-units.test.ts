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

// SEC#6 + QA D2 — ชื่อ "ว่าง"/หน้าตาหลอก · ZWJ เฉพาะใน emoji sequence
describe('ชื่อกลุ่ม: ชื่อที่มองไม่เห็น / เครื่องหมายผสม / ช่องว่าง / ZWJ (table-driven)', () => {
  const u = (...cps: number[]) => String.fromCodePoint(...cps);
  const INVALID = { ok: false, reason: 'INVALID' } as const;

  it.each([
    ['U+2800 braille blank ตัวเดียว', u(0x2800)],
    ['U+2800 หลายตัว', u(0x2800).repeat(5)],
    ['U+2800 ปนช่องว่างปกติ', ` ${u(0x2800)} ${u(0x2800)} `],
    ['U+034F CGJ ล้วน', u(0x34f).repeat(3)],
    ['U+FE0F ล้วน', u(0xfe0f).repeat(2)],
    ['ZWJ ล้วน', u(0x200d, 0x200d)],
    ['ZWNJ/ZWSP ล้วน', u(0x200c, 0x200b)],
    ['เครื่องหมายผสมล้วน (ไม่มีตัวฐาน)', u(0x301, 0x302)],
    ['วรรณยุกต์ไทยล้วน', u(0x0e48, 0x0e49)],
    ['ผสมของที่มองไม่เห็นทั้งหมด', ` ${u(0x2800, 0x34f, 0xfe0f, 0x200d)} `],
    ['Hangul filler ล้วน', u(0x3164, 0x115f, 0xffa0)],
    ['U+2800 ฝังกลางชื่อที่มีตัวอักษร', `a${u(0x2800)}b`],
    ['CGJ ฝังกลางชื่อที่มีตัวอักษร', `a${u(0x34f)}b`],
  ])('ไม่มีตัวที่มองเห็น: %s → INVALID', (_l, name) => {
    expect(checkGroupName(name)).toEqual(INVALID);
  });

  it.each([
    ['เครื่องหมายผสมนำหน้า', `${u(0x301)}a`],
    ['เครื่องหมายผสมหลังช่องว่าง', `a ${u(0x301)}b`],
    ['ซ้อน 4 ตัวบนตัวฐานเดียว (zalgo)', `x${u(0x300, 0x301, 0x302, 0x303)}`],
    ['ซ้อน 20 ตัว', `x${u(0x300).repeat(20)}`],
    ['ไทยซ้อน 4 ชั้น', `ก${u(0x0e38, 0x0e39, 0x0e48, 0x0e49)}`],
    ['VS16 ซ้อนหลายตัว', `❤${u(0xfe0f).repeat(4)}`],
  ])('เครื่องหมายผสมไม่ถูกต้อง: %s → INVALID', (_l, name) => {
    expect(checkGroupName(name)).toEqual(INVALID);
  });

  it.each([
    ['NBSP', 0x00a0],
    ['en space', 0x2002],
    ['em space', 0x2003],
    ['thin space', 0x2009],
    ['narrow NBSP', 0x202f],
    ['medium math space', 0x205f],
    ['ideographic space', 0x3000],
    ['ogham space mark', 0x1680],
    ['figure space', 0x2007],
  ])('ช่องว่างกลางชื่อที่ไม่ใช่ U+0020: %s → INVALID', (_l, cp) => {
    expect(checkGroupName(`a${u(cp)}b`)).toEqual(INVALID);
    expect(checkGroupName(`ก๊วน${u(cp)}แมว`)).toEqual(INVALID);
  });

  it('ช่องว่างปกติ: ยุบที่ซ้ำเป็นตัวเดียว · ตัดหัวท้าย · ไม่นับช่องว่างที่ยุบแล้วเข้าความยาว', () => {
    expect(checkGroupName('  a    b   c  ')).toEqual({ ok: true, name: 'a b c' });
    expect(checkGroupName(`${'a '.repeat(20)}`.trimEnd() + '    ')).toEqual({ ok: true, name: 'a '.repeat(20).trimEnd() });
    expect(checkGroupName(`a${' '.repeat(100)}b`)).toEqual({ ok: true, name: 'a b' });
  });

  it.each([
    ['แมวดำ 🐈‍⬛', '🐈‍⬛'],
    ['ครอบครัว 👨‍👩‍👧', '👨‍👩‍👧'],
    ['ครอบครัวสี่คน 👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦'],
    ['ธงรุ้ง (VS16 ก่อน ZWJ)', '🏳️‍🌈'],
    ['แพทย์ผิวสี (skin tone ก่อน ZWJ)', '🧑🏽‍⚕️'],
  ])('ZWJ ระหว่าง Extended_Pictographic: %s → ผ่านและคง ZWJ ไว้', (_l, emoji) => {
    expect(checkGroupName(emoji)).toEqual({ ok: true, name: emoji });
    expect(checkGroupName(`กลุ่ม ${emoji}`)).toEqual({ ok: true, name: `กลุ่ม ${emoji}` });
  });

  it.each([
    ['ZWJ ระหว่างตัวอักษร', 'ก\u200dข'],
    ['ZWJ หลังอักษรก่อน emoji', 'a\u200d🐈'],
    ['ZWJ หลัง emoji ก่อนอักษร', '🐈\u200da'],
    ['ZWJ นำหน้า', '\u200d🐈'],
    ['ZWJ ท้ายสุด', '🐈\u200d'],
    ['ZWJ ซ้อน', '🐈\u200d\u200d⬛'],
    ['ZWJ คั่นช่องว่าง', '🐈 \u200d ⬛'],
    ['bidi override', '🐈\u202e⬛'],
    ['zero-width space ใน emoji', '🐈\u200b⬛'],
    ['tag character (ธงสกอตแลนด์แบบ tag sequence)', '🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}'],
    ['word joiner', 'a\u2060b'],
    ['soft hyphen', 'a\u00adb'],
    ['control char', 'a\u0001b'],
  ])('ยังห้าม: %s → INVALID', (_l, name) => {
    expect(checkGroupName(name)).toEqual(INVALID);
  });

  it.each([
    ['ไทยมีวรรณยุกต์ซ้อนสระ', 'ก๊วนแมว ปั๊มนม ผู้ใหญ่ ที่นี่'],
    ['emoji VS16 (❤️ ☀️)', '❤️ ☀️ แมว'],
    ['keycap 1️⃣', '1️⃣ กลุ่ม'],
    ['ธง regional indicator 🇹🇭', '🇹🇭 กลุ่มไทย'],
    ['ตัวอักษรมีเครื่องหมาย 3 ตัวพอดี', `x${u(0x300, 0x301, 0x302)}`],
    ['เครื่องหมายวรรคตอนล้วน', '?!'],
    ['ตัวเลขล้วน', '8888'],
    ['symbol ล้วน', '★'],
    ['ภาษาอื่น', 'Café 猫 привет नमस्ते'],
  ])('ยังผ่าน: %s', (_l, name) => {
    expect(checkGroupName(name)).toMatchObject({ ok: true });
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
