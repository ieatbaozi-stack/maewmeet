// เพดานของกลุ่ม/คำเชิญ — R2_CONTRACT §3 ข้อ 2–3, 5 · ปรับได้ที่นี่ที่เดียว (ทุกด่านอ่านจากค่าเหล่านี้)
import { DAY_MS } from './clock';

export const GROUP_LIMITS = {
  /** กลุ่มที่ผู้ใช้หนึ่งคน "สร้าง" ได้ (นับเฉพาะที่ยังไม่ถูกลบ) */
  groupsCreatedPerUser: 10,
  /** สมาชิกต่อกลุ่ม */
  membersPerGroup: 50,
  /** โค้ดเชิญที่ยังใช้ได้พร้อมกันต่อกลุ่ม */
  activeCodesPerGroup: 20,
  /** อายุโค้ดเชิญ/คำเชิญตรง (D6, R2 §3 ข้อ 5) */
  inviteTtlMs: 7 * DAY_MS,
  nameMin: 1,
  nameMax: 40,
} as const;

/** ชนิดเพดานที่ใส่ใน params ของ LIMIT_REACHED (UX แปลตามนี้) */
export type LimitKind = 'groups' | 'members' | 'codes';
