// ชื่อที่ผู้ใช้ตั้งเอง (displayName / ชื่อกลุ่ม / username) ต้องถูกแยกทิศข้อความ (bidi isolate) จากข้อความรอบข้าง
// เพื่อให้ชื่อที่มีอักษร RTL/ตัวควบคุมทิศทางไม่ไปกลับลำดับข้อความข้างเคียง (บทเรียน S10)
import type { ReactNode } from "react";

/** <bdi> = unicode-bidi: isolate โดยกำเนิด · ใช้ครอบชื่อใน JSX */
export function Name({ children }: { children: ReactNode }) {
  return <bdi>{children}</bdi>;
}

/** FSI … PDI — ใช้เมื่อชื่อต้องไปอยู่ "ในสตริง" (ค่าที่ใส่ใน message, aria-label, label ของ <option>) ซึ่งครอบด้วย <bdi> ไม่ได้ */
export function isolateName(name: string): string {
  return `⁨${name}⁩`;
}
