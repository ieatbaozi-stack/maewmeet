// ข้อความฝั่ง UI ของ auth ที่ต้องคำนวณก่อนส่งเข้า t() — ICU param contract: docs/design/UX.md §4 "R1 — ไฟล์จริง"
import { retryAfterMinutes, type ApiErrorMessage, type MessageValues } from "./errors";

export interface MessageRef {
  key: string;
  values: MessageValues;
}

/** ล็อกนานสุด 24 ชม. → ตั้งแต่ 60 นาทีขึ้นไปใช้ login.locked.long ({hours, minutes}) แทน errors.LOGIN_LOCKED */
export function splitMinutes(totalMin: number): { hours: number; minutes: number } {
  const min = Math.max(0, Math.floor(totalMin));
  return { hours: Math.floor(min / 60), minutes: min % 60 };
}

/** ข้อความล็อกจากจำนวนวินาทีที่เหลือ (แสดงนับถอยหลังได้โดยเรียกซ้ำด้วยค่าที่ลดลง) */
export function lockedMessage(retryAfterSec: number): MessageRef {
  const retryAfterMin = retryAfterMinutes(retryAfterSec);
  if (retryAfterMin >= 60) return { key: "login.locked.long", values: splitMinutes(retryAfterMin) };
  return { key: "errors.LOGIN_LOCKED", values: { retryAfterMin } };
}

/** ข้อความของ error จาก API → คีย์ที่ต้องใช้จริง (LOGIN_LOCKED ยาวเกิน 1 ชม. ใช้คีย์ login.locked.long) */
export function messageRefOf(err: ApiErrorMessage): MessageRef {
  if (err.code === "LOGIN_LOCKED") {
    const sec = typeof err.values.retryAfterSec === "number" ? err.values.retryAfterSec : 0;
    return lockedMessage(sec);
  }
  return { key: err.key, values: err.values };
}

/** ชื่อประเทศจากรหัส ISO 2 ตัวอักษร ตามภาษาที่แสดง · รหัสแปลก/ไม่รองรับ → null (ผู้เรียกใช้ข้อความ "ไม่ทราบประเทศ") */
export function regionName(locale: string, code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  if (/^(zz|xx)$/i.test(code)) return null; // CLDR/CDN ใช้เป็น "ไม่ทราบภูมิภาค"
  try {
    const name = new Intl.DisplayNames([locale], { type: "region", fallback: "none" }).of(code.toUpperCase());
    return name ?? null;
  } catch {
    return null;
  }
}

/** อุปกรณ์ย่อจาก Auth เช่น "iPhone · Safari" — ส่วนที่เป็น "Unknown" (UA อ่านไม่ออก) ตัดทิ้ง · ไม่เหลืออะไร → null (UI ใช้ข้อความ "ไม่ทราบอุปกรณ์") */
export function deviceLabel(device: string | null | undefined): string | null {
  if (!device) return null;
  const parts = device
    .split("·")
    .map((p) => p.trim())
    .filter((p) => p !== "" && p.toLowerCase() !== "unknown");
  return parts.length > 0 ? parts.join(" · ") : null;
}
