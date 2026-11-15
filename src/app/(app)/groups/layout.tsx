import type { ReactNode } from "react";
import "@/components/groups/groups.css";
// sheet สูง (.sheet.tall) ที่แผ่นเลือกไอคอนกลุ่มใช้ในหน้าตั้งค่า อยู่ใน calendar-view.css (R15a)
import "@/components/calendar/calendar-view.css";

/** นำเข้าสไตล์ของหน้ากลุ่ม (R2) — ใช้กับ /groups, /groups/[gid], /groups/[gid]/settings */
export default function GroupsLayout({ children }: { children: ReactNode }) {
  return children;
}
