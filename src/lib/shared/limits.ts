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
  /** คำเชิญตรงที่ค้าง (active, ยังไม่หมดอายุ, กลุ่มยังอยู่) ต่อผู้รับหนึ่งคน — กันสแปมผู้รับจากหลายผู้ชวน/หลายกลุ่ม */
  pendingDirectInvitesPerInvitee: 20,
  /** GET /api/me/invites คืนสูงสุดกี่รายการ (ใหม่สุดก่อน) */
  myInvitesListMax: 50,
  nameMin: 1,
  nameMax: 40,
} as const;

// เพดาน busy / ปฏิทิน — R3_CONTRACT §2 (ค่าเริ่มต้นของ Lead) · lib เวลารับค่าเหล่านี้เป็นพารามิเตอร์ ไม่ฮาร์ดโค้ด
/** busy ที่ยังไม่สิ้นสุด (end_at > now) ต่อผู้ใช้ */
export const BUSY_MAX_PER_USER = 300;
/** ช่วงเดียวครอบได้ไม่เกินกี่วันปฏิทิน (ทั้งสองแบบ) */
export const BUSY_MAX_SPAN_DAYS = 366;
/** busy แบบมีเวลา ยาวสุดกี่วัน (ความยาวจริง — ADR 0004 §2) */
export const BUSY_MAX_TIMED_DAYS = 62;
/** ลงย้อนหลังได้ไม่เกินกี่วัน */
export const BUSY_MAX_BACKDATE_DAYS = 7;
/** ช่วงวันที่ที่ขอดูได้ต่อคำขอ (ปฏิทินกลุ่ม · รายการของฉันแบบช่วง) — monthGrid() ≤ 42 วัน */
export const CALENDAR_MAX_RANGE_DAYS = 62;
/** ความยาวสูงสุดของ title / note (อักขระ = code point) */
export const BUSY_TITLE_MAX = 80;
export const BUSY_NOTE_MAX = 500;

/** ชนิดเพดานที่ใส่ใน params ของ LIMIT_REACHED (UX แปลตามนี้) */
export type LimitKind = 'groups' | 'members' | 'codes' | 'pendingInvites' | 'busyCount' | 'busySpan' | 'busyBackdate';
