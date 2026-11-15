// โมเดลตัวเลือกไอคอนกลุ่ม (R15a §1.4) — ล้วน ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/group-icon-model.test.ts
// กติกา: ผู้ใช้เลือก "แมว" → ส่ง null (ไม่เก็บ "cat") เพื่อให้ "ยังไม่ตั้ง" กับ "เลือกแมว" เป็นค่าเดียว (spec §1.2)
import type { ApiResult } from "@/components/auth/api";
import type { FullResult } from "@/components/appointments/api";
import { messageRefOf, type MessageRef } from "@/i18n/auth-messages";
import { DEFAULT_GROUP_ICON, GROUP_ICON_KEYS, displayGroupIcon, type GroupIconKey } from "@/lib/shared/group-icons";

export type PickerKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";
export const PICKER_KEYS: readonly string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

/** ตัวเลือกที่เลือกอยู่ตอนเปิดแผ่น: ค่าปัจจุบัน (ไม่ตั้ง/ไม่รู้จัก = แมว) */
export const initialPick = (current: string | null | undefined): GroupIconKey => displayGroupIcon(current);

/** ยังไม่เปลี่ยนจากของเดิม (ปุ่มบันทึก aria-disabled + ประกาศ picker.unchanged) */
export const isUnchanged = (current: string | null | undefined, picked: GroupIconKey): boolean => initialPick(current) === picked;

/** body ของ PUT /api/groups/:gid/icon — แมว → null */
export const iconBody = (picked: GroupIconKey): { icon: GroupIconKey | null } => ({ icon: picked === DEFAULT_GROUP_ICON ? null : picked });

/**
 * ย้ายตัวเลือกด้วยคีย์บอร์ด: ซ้าย/ขวา ±1 · บน/ล่าง ±จำนวนคอลัมน์ · Home/End = ตัวแรก/ตัวสุดท้าย
 * ชนขอบ = อยู่ที่เดิม (ไม่วน — ผู้ใช้อ่านตารางเป็นแถว)
 */
export function movePick(current: GroupIconKey, key: PickerKey, cols: number, keys: readonly GroupIconKey[] = GROUP_ICON_KEYS): GroupIconKey {
  const i = keys.indexOf(current);
  const last = keys.length - 1;
  const step = Math.max(1, Math.trunc(cols));
  let n = i;
  switch (key) {
    case "ArrowLeft":
      n = i - 1;
      break;
    case "ArrowRight":
      n = i + 1;
      break;
    case "ArrowUp":
      n = i - step;
      break;
    case "ArrowDown":
      n = i + step;
      break;
    case "Home":
      n = 0;
      break;
    case "End":
      n = last;
      break;
  }
  if (i < 0) return keys[0] ?? DEFAULT_GROUP_ICON;
  if (n < 0 || n > last) return current;
  return keys[n] ?? current;
}

type Failure = Extract<FullResult<unknown> | ApiResult<unknown>, { ok: false }>;
export type IconFailure = { ref: MessageRef; forbidden: boolean; gone: boolean };

/**
 * ผลล้มเหลวของการตั้งไอคอน → ข้อความ (spec §1.4 ตารางสถานะ)
 * 403 → icon.error.forbidden (ซ่อนปุ่มหลังรีเฟรช) · 404 → errors.NOT_FOUND (กลุ่มหาย) · 429 → errors.RATE_LIMITED · อื่นๆ/เครือข่าย → icon.error.generic
 */
export function mapIconFailure(res: Failure): IconFailure {
  const generic: IconFailure = { ref: { key: "groupSettings.icon.error.generic", values: {} }, forbidden: false, gone: false };
  if (res.kind === "network") return generic;
  switch (res.error.code) {
    case "FORBIDDEN":
      return { ref: { key: "groupSettings.icon.error.forbidden", values: {} }, forbidden: true, gone: false };
    case "NOT_FOUND":
      return { ref: messageRefOf(res.error), forbidden: false, gone: true };
    case "RATE_LIMITED":
      return { ref: messageRefOf(res.error), forbidden: false, gone: false };
    default:
      return generic;
  }
}
