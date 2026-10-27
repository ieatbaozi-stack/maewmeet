import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/app/_lib/session";
import { AdminGroups } from "@/components/admin/AdminGroups";
import { AdminHead } from "@/components/admin/AdminHead";
import { TopBar } from "@/components/shell/TopBar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups");
  return { title: t("title") };
}

/** กลุ่ม (R5 §2 ข้อ 3–4) — super admin เท่านั้น · คนอื่น 404 */
export default async function AdminGroupsPage() {
  await requireSuperAdmin();
  const t = await getTranslations("adminGroups");
  return (
    <>
      <TopBar />
      <AdminHead title={t("title")} />
      <main className="main admin-main" id="main">
        <AdminGroups />
      </main>
    </>
  );
}
