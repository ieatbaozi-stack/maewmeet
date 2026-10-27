// ป้ายภาษาคนของ audit log (R5) — ล้วน · ทดสอบที่ tests/ui/admin-audit-labels.test.ts
// คีย์ข้อความแทน '.' ด้วย '_' (next-intl ห้ามจุดในชื่อคีย์) เช่น pinReset.decide → adminAudit.actions.pinReset_decide
import { AUDIT_META_WHITELIST } from "@/lib/data/serializers/admin";

/** action ที่รู้จัก = ทุก action ที่ระบบเขียนจริง (ตาราง whitelist ของ serializer) — ใช้เป็นตัวเลือกของตัวกรองด้วย */
export const AUDIT_ACTIONS: readonly string[] = Object.keys(AUDIT_META_WHITELIST);

/** ชนิดเป้าหมายที่ service เขียน (grep `targetType: '` ใน src/lib/**) */
export const AUDIT_TARGET_TYPES = ["user", "group", "member", "invite", "appointment", "pin_reset"] as const;

const KNOWN_ACTIONS = new Set(AUDIT_ACTIONS);
const KNOWN_TYPES = new Set<string>(AUDIT_TARGET_TYPES);

/** คีย์ข้อความของ action · ไม่รู้จัก → null (ผู้เรียกใช้ adminAudit.unknownAction) */
export function auditActionKey(action: string): string | null {
  return KNOWN_ACTIONS.has(action) ? `adminAudit.actions.${action.replace(/\./g, "_")}` : null;
}

export function auditTargetTypeKey(type: string): string | null {
  return KNOWN_TYPES.has(type) ? `adminAudit.targetTypes.${type}` : null;
}
