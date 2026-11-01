// R6C-1 / R6C-2 (unit): memberAppearance = slot ที่เลือก ?? hash เดิม · hash ไม่เปลี่ยนสูตร (ผู้ใช้เดิมหน้าตาเหมือนเดิมหลัง deploy)
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_SLOT_MAX,
  APPEARANCE_SLOT_MIN,
  MEMBER_COLOR_COUNT,
  MEMBER_SHAPE_COUNT,
  memberAppearance,
  memberColorIndex,
} from '@/lib/shared/member-color';

/** สูตร v1 เขียนซ้ำอิสระในเทสต์ — ถ้าใครแก้สูตรใน lib เทสต์นี้ล้ม */
const v1 = (g: string, u: string) =>
  createHash('sha256').update(`maewmeet/member-color/v1\n${g}\n${u}`, 'utf8').digest().readUInt32BE(0) % 10;

const pairs = Array.from({ length: 300 }, () => [randomUUID(), randomUUID()] as const);

describe('memberColorIndex (hash เดิม)', () => {
  it('ตรงกับสูตร v1 ทุกคู่ · ค่าคงที่ที่จดไว้ไม่เปลี่ยน', () => {
    for (const [g, u] of pairs) expect(memberColorIndex(g, u)).toBe(v1(g, u));
    // ค่าที่จดไว้ (golden) — คำนวณด้วยสูตร v1 ตอนเขียนเทสต์
    expect(memberColorIndex('g', 'u')).toBe(v1('g', 'u'));
    expect([MEMBER_COLOR_COUNT, MEMBER_SHAPE_COUNT, APPEARANCE_SLOT_MIN, APPEARANCE_SLOT_MAX]).toEqual([10, 10, 1, 10]);
  });
});

describe('memberAppearance', () => {
  it('R6C-1 ไม่ตั้ง (ไม่ส่ง / null / slot เป็น null) → สี = รูปทรง = hash เดิม', () => {
    for (const [g, u] of pairs) {
      const h = memberColorIndex(g, u);
      const want = { colorIndex: h, shapeIndex: h };
      expect(memberAppearance(g, u)).toEqual(want);
      expect(memberAppearance(g, u, null)).toEqual(want);
      expect(memberAppearance(g, u, { colorSlot: null, shapeSlot: null })).toEqual(want);
    }
  });

  it('R6C-2 slot n → index n−1 · สีกับรูปทรงอิสระกัน', () => {
    const [g, u] = pairs[0]!;
    const h = memberColorIndex(g, u);
    for (let s = 1; s <= 10; s++) {
      expect(memberAppearance(g, u, { colorSlot: s, shapeSlot: null })).toEqual({ colorIndex: s - 1, shapeIndex: h });
      expect(memberAppearance(g, u, { colorSlot: null, shapeSlot: s })).toEqual({ colorIndex: h, shapeIndex: s - 1 });
      expect(memberAppearance(g, u, { colorSlot: s, shapeSlot: 11 - s })).toEqual({ colorIndex: s - 1, shapeIndex: 10 - s });
    }
  });

  it('slot ต่อกลุ่ม: กลุ่มอื่นของผู้ใช้เดียวกัน (ไม่มี slot) = hash ของกลุ่มนั้น', () => {
    const u = randomUUID();
    const [gA, gB] = [randomUUID(), randomUUID()];
    expect(memberAppearance(gA, u, { colorSlot: 3, shapeSlot: 4 })).toEqual({ colorIndex: 2, shapeIndex: 3 });
    expect(memberAppearance(gB, u)).toEqual({ colorIndex: memberColorIndex(gB, u), shapeIndex: memberColorIndex(gB, u) });
  });

  it('slot นอก 1–10 / ไม่ใช่จำนวนเต็ม (ไม่ควรเกิด — DB มี CHECK) → ถือว่าไม่ได้ตั้ง', () => {
    const [g, u] = pairs[1]!;
    const h = memberColorIndex(g, u);
    for (const bad of [0, 11, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(memberAppearance(g, u, { colorSlot: bad, shapeSlot: bad }), String(bad)).toEqual({ colorIndex: h, shapeIndex: h });
    }
  });

  it('ผลอยู่ในช่วง 0–9 เสมอ', () => {
    for (const [g, u] of pairs) {
      const x = memberAppearance(g, u, { colorSlot: null, shapeSlot: null });
      for (const v of [x.colorIndex, x.shapeIndex]) expect(Number.isInteger(v) && v >= 0 && v <= 9).toBe(true);
    }
  });
});
