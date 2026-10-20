// ข้อความสถานะข้ามหน้า (เช่น สร้างกลุ่มแล้วไปหน้ากลุ่ม) — เก็บเฉพาะ "คีย์ข้อความ + ค่า" ใน sessionStorage ชั่วคราว (ต่อแท็บ)
// ห้ามใส่โค้ดเชิญหรือข้อมูลลับ · ทุกการอ่าน/เขียนครอบ try/catch (private window / บล็อกข้อมูลไซต์ → ข้ามเงียบๆ)
import type { MessageRef } from "@/i18n/auth-messages";

const KEY = "mm_flash";

export function setFlash(ref: MessageRef): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ref));
  } catch {
    /* ไม่มี storage — ข้ามข้อความแจ้ง ผลลัพธ์จริงของการกระทำไม่เสีย */
  }
}

export function takeFlash(): MessageRef | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(KEY);
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && typeof (v as MessageRef).key === "string") {
      const values = (v as MessageRef).values;
      return { key: (v as MessageRef).key, values: typeof values === "object" && values !== null ? values : {} };
    }
  } catch {
    /* ข้าม */
  }
  return null;
}
