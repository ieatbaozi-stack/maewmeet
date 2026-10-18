import type { ReactNode } from "react";
import { requireUser } from "@/app/_lib/session";
import { TabBar } from "@/components/shell/TabBar";

/**
 * shell หลังล็อกอิน — ตรวจ session ที่นี่ (ไม่ล็อกอิน → /login · ต้องเปลี่ยน PIN → /set-pin)
 * เลย์เอาต์ไม่เรนเดอร์ซ้ำเมื่อเปลี่ยนหน้าภายใน จึงเรียก requireUser ในแต่ละหน้าด้วย (cache ต่อ request)
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return (
    <div className="app">
      {children}
      <TabBar />
    </div>
  );
}
