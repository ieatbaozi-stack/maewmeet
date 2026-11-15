// ไอคอนกลุ่ม (R15a §1.2, B1) — allowlist กลางชุดเดียว ใช้ทั้งเซิร์ฟเวอร์ (validate/serialize) และ UI (ตัวเลือก/แสดงผล) · เจ้าของ: Platform
// ต้นฉบับรายการและลำดับ: docs/design/R15_FEEDBACK.md §1.1 (ux) · ชื่อ TH/EN อยู่ที่ messages `groupIcon.names.<key>` (เทสต์ตรวจครบทุก key)
// ไฟล์นี้ต้องไม่ import อะไรที่ผูก Node/DB (ใช้ใน client component ได้)
// ลบ key ภายหลังได้โดยไม่ต้อง migration: ค่าในฐานที่ไม่อยู่ในรายการ → normalizeGroupIcon() คืน null (= แสดงแมว)

export const GROUP_ICON_KEYS = [
  'cat',
  'food',
  'hotpot',
  'dessert',
  'coffee',
  'drinks',
  'badminton',
  'soccer',
  'volleyball',
  'fitness',
  'bike',
  'game',
  'music',
  'karaoke',
  'movie',
  'travel',
  'camping',
  'work',
  'study',
  'home',
  'shopping',
  'heart',
  'party',
  'star',
] as const;

export type GroupIconKey = (typeof GROUP_ICON_KEYS)[number];

/** ค่าเริ่มต้นเมื่อยังไม่ตั้ง (groups.icon = NULL) */
export const DEFAULT_GROUP_ICON: GroupIconKey = 'cat';

const KEY_SET: ReadonlySet<string> = new Set(GROUP_ICON_KEYS);

export function isGroupIconKey(v: unknown): v is GroupIconKey {
  return typeof v === 'string' && KEY_SET.has(v);
}

/**
 * ค่าที่ส่งออกใน DTO: key ที่อยู่ในรายการ หรือ null · ค่าที่อ่านจากฐานแล้วไม่อยู่ในรายการ (ลบ key ภายหลัง/ข้อมูลเสีย) → null
 * (UI แสดงแมว ไม่ error — R15_FEEDBACK §1.2) · ไม่แปลง 'cat' เป็น null (เก็บ 'cat' ได้ ไม่ผิด)
 */
export function normalizeGroupIcon(v: string | null | undefined): GroupIconKey | null {
  return isGroupIconKey(v) ? v : null;
}

/** ค่าที่ใช้แสดงจริง: null/ไม่รู้จัก → แมว */
export function displayGroupIcon(v: string | null | undefined): GroupIconKey {
  return normalizeGroupIcon(v) ?? DEFAULT_GROUP_ICON;
}
