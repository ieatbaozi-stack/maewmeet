import type { ReactNode } from "react";
import { requireUser } from "@/app/_lib/session";
import { NotificationsProvider } from "@/components/shell/NotificationsProvider";
import { TabBar } from "@/components/shell/TabBar";
import { loadUnreadCount } from "./_lib/unread";

/**
 * shell หลังล็อกอิน — ตรวจ session ที่นี่ (ไม่ล็อกอิน → /login · ต้องเปลี่ยน PIN → /set-pin)
 * เลย์เอาต์ไม่เรนเดอร์ซ้ำเมื่อเปลี่ยนหน้าภายใน จึงเรียก requireUser ในแต่ละหน้าด้วย (cache ต่อ request)
 * จำนวนแจ้งเตือนที่ยังไม่อ่านโหลดที่นี่ครั้งเดียว (กระดิ่งทุกแท็บใช้ร่วม) แล้วรีเฟรชฝั่งไคลเอนต์
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  const unread = await loadUnreadCount();
  return (
    <NotificationsProvider initialUnread={unread}>
      <div className="app">
        {children}
        <TabBar />
      </div>
    </NotificationsProvider>
  );
}
