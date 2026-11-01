// สีประจำสมาชิก — R2_CONTRACT §2: คงที่ต่อ (ผู้ใช้, กลุ่ม) และคำนวณได้จากสองค่านี้อย่างเดียว (ไม่ต้องเก็บ/ไม่ต้อง join)
// คืนดัชนี 0–9 ของชุดสี (UX กำหนดชื่อสีใน src/styles/**) · เสถียรแม้คนอื่นเข้า/ออกกลุ่ม (ไม่ขึ้นกับลำดับสมาชิก)
// ข้อจำกัดที่ยอมรับ: ดัชนีชนกันได้ (10 สี, สมาชิกสูงสุด 50) — ลดการชนด้วย hash ไม่ใช่การแจกสีไม่ซ้ำ
// R6C (F3ก): สมาชิกเลือกสี/รูปทรงเองต่อกลุ่มได้ (group_member.color_slot / shape_slot = 1–10 · NULL = ใช้ hash)
//   ค่าที่ใช้แสดง: memberAppearance() ที่เดียว — ทุก serializer/service ต้องเรียกตัวนี้ ไม่คำนวณเอง
import { createHash } from 'node:crypto';

export const MEMBER_COLOR_COUNT = 10;
export const MEMBER_SHAPE_COUNT = 10;
/** slot ที่ผู้ใช้เลือกได้ (ตรงกับ CHECK ใน group_member) — slot n ↔ index n−1 */
export const APPEARANCE_SLOT_MIN = 1;
export const APPEARANCE_SLOT_MAX = 10;

/** hash เดิม (v1) — ห้ามเปลี่ยนสูตร: ผู้ใช้ที่ไม่ได้ตั้งต้องหน้าตาเหมือนเดิม (R6C-1) */
export function memberColorIndex(groupId: string, userId: string): number {
  const digest = createHash('sha256').update(`maewmeet/member-color/v1\n${groupId}\n${userId}`, 'utf8').digest();
  return digest.readUInt32BE(0) % MEMBER_COLOR_COUNT;
}

export type AppearanceSlots = { colorSlot: number | null; shapeSlot: number | null };

/** ค่าที่ client ใช้แสดง (0–9 ทั้งคู่) */
export type MemberAppearance = { colorIndex: number; shapeIndex: number };

const isSlot = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= APPEARANCE_SLOT_MIN && v <= APPEARANCE_SLOT_MAX;

/**
 * หน้าตาที่ใช้แสดงของสมาชิกในกลุ่ม: color = color_slot ?? hash · shape = shape_slot ?? hash (hash เดียวกับสี = หน้าตาก่อน R6C)
 * slot นอก 1–10 (ไม่ควรเกิด — DB มี CHECK) → ถือว่าไม่ได้ตั้ง
 */
export function memberAppearance(groupId: string, userId: string, slots?: Partial<AppearanceSlots> | null): MemberAppearance {
  const colorSlot = slots?.colorSlot;
  const shapeSlot = slots?.shapeSlot;
  const needHash = !isSlot(colorSlot) || !isSlot(shapeSlot);
  const hash = needHash ? memberColorIndex(groupId, userId) : 0;
  return {
    colorIndex: isSlot(colorSlot) ? colorSlot - 1 : hash,
    shapeIndex: isSlot(shapeSlot) ? shapeSlot - 1 : hash,
  };
}
