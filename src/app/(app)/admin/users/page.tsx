import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/app/_lib/session";
import { AdminHead } from "@/components/admin/AdminHead";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { TopBar } from "@/components/shell/TopBar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers");
  return { title: t("title") };
}

/** ผู้ใช้ (R5 §2 ข้อ 3–4) — super admin เท่านั้น · คนอื่น 404 (สิทธิ์ของ API ตรวจที่เซิร์ฟเวอร์อีกชั้น) */
export default async function AdminUsersPage() {
  const me = await requireSuperAdmin();
  const t = await getTranslations("adminUsers");
  return (
    <>
      <TopBar />
      <AdminHead title={t("title")} />
      <main className="main admin-main" id="main">
        <AdminUsers meId={me.id} />
      </main>
    </>
  );
}
