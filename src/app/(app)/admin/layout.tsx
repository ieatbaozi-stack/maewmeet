import type { ReactNode } from "react";
import { requireSuperAdmin } from "@/app/_lib/session";

/** ทุกหน้าใต้ /admin: ไม่ใช่ super admin → 404 (หน้าลูกเรียก requireSuperAdmin ซ้ำเพราะเลย์เอาต์ไม่รันตอนเปลี่ยนหน้าภายใน) */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin();
  return children;
}
