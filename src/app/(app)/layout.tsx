import type { ReactNode } from "react";
import { TabBar } from "@/components/shell/TabBar";

/** shell หลังล็อกอิน (R1 จะตรวจ session ที่นี่) — เนื้อหา + แถบนำทางล่าง 4 แท็บ */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      {children}
      <TabBar />
    </div>
  );
}
