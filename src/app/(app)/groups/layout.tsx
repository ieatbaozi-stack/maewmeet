import type { ReactNode } from "react";
import "@/components/groups/groups.css";

/** นำเข้าสไตล์ของหน้ากลุ่ม (R2) — ใช้กับ /groups, /groups/[gid], /groups/[gid]/settings */
export default function GroupsLayout({ children }: { children: ReactNode }) {
  return children;
}
