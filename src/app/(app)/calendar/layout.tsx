import type { ReactNode } from "react";
import "@/components/groups/groups.css";
import "@/components/calendar/calendar-view.css";

/** นำเข้าสไตล์ของแท็บปฏิทิน (R3) — ใช้คลาสฟอร์ม/แถว/ป้ายร่วมกับหน้ากลุ่ม (groups.css) — เปลือกที่ globals.css ยังไม่มี; สไตล์หลักของ UX อยู่ที่ src/styles/calendar.css (นำเข้าใน globals.css) */
export default function CalendarLayout({ children }: { children: ReactNode }) {
  return children;
}
