// ชื่อที่ผู้ใช้ตั้งเอง (displayName / ชื่อกลุ่ม / username) ต้องถูกแยกทิศข้อความ (bidi isolate) จากข้อความรอบข้าง
// เพื่อให้ชื่อที่มีอักษร RTL/ตัวควบคุมทิศทางไม่ไปกลับลำดับข้อความข้างเคียง (บทเรียน S10)
import { Fragment, type ReactNode } from "react";

/** <bdi> = unicode-bidi: isolate โดยกำเนิด · ใช้ครอบชื่อใน JSX */
export function Name({ children }: { children: ReactNode }) {
  return <bdi>{children}</bdi>;
}

const OPEN = "\uE000";
const CLOSE = "\uE001";

/**
 * ชื่อที่อยู่ "ในประโยค" ของ message: เรียก format ด้วยตัวแทน (placeholder) แล้วแทนที่ตัวแทนด้วย <bdi>ชื่อ</bdi>
 * ข้อความที่ผู้ใช้เห็นเหมือนเดิมทุกตัวอักษร (ไฟล์ messages ไม่เปลี่ยน) — ตัวแทนใช้ private-use ซึ่งชื่อที่ผ่านกติกาไม่มีทางมี
 *   <p>{withNames((n) => t("groups.invites.item", { inviter: n.inviter, group: n.group }), { inviter, group })}</p>
 */
export function withNames<K extends string>(
  format: (placeholders: Record<K, string>) => string,
  names: Record<K, string>,
): ReactNode {
  const keys = Object.keys(names) as K[];
  const placeholders = Object.fromEntries(keys.map((k) => [k, `${OPEN}${k}${CLOSE}`])) as Record<K, string>;
  const parts = format(placeholders).split(new RegExp(`${OPEN}(.*?)${CLOSE}`, "u"));
  // split ด้วย capture group: ดัชนีคี่ = ชื่อคีย์
  return parts.map((part, i) =>
    i % 2 === 1 ? <bdi key={i}>{names[part as K] ?? ""}</bdi> : <Fragment key={i}>{part}</Fragment>,
  );
}
