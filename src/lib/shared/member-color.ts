// สีประจำสมาชิก — R2_CONTRACT §2: คงที่ต่อ (ผู้ใช้, กลุ่ม) และคำนวณได้จากสองค่านี้อย่างเดียว (ไม่ต้องเก็บ/ไม่ต้อง join)
// คืนดัชนี 0–9 ของชุดสี (UX กำหนดชื่อสีใน src/styles/**) · เสถียรแม้คนอื่นเข้า/ออกกลุ่ม (ไม่ขึ้นกับลำดับสมาชิก)
// ข้อจำกัดที่ยอมรับ: ดัชนีชนกันได้ (10 สี, สมาชิกสูงสุด 50) — ลดการชนด้วย hash ไม่ใช่การแจกสีไม่ซ้ำ
import { createHash } from 'node:crypto';

export const MEMBER_COLOR_COUNT = 10;

export function memberColorIndex(groupId: string, userId: string): number {
  const digest = createHash('sha256').update(`maewmeet/member-color/v1\n${groupId}\n${userId}`, 'utf8').digest();
  return digest.readUInt32BE(0) % MEMBER_COLOR_COUNT;
}
