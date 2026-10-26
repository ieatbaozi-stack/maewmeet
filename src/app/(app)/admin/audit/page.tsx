import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/app/_lib/session";
import { AdminAudit } from "@/components/admin/AdminAudit";
import { AdminHead } from "@/components/admin/AdminHead";
import { TopBar } from "@/components/shell/TopBar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAudit");
  return { title: t("title") };
}

/** audit log (R5 §2 ข้อ 3–4) — super admin เท่านั้น · คนอื่น 404 */
export default async function AdminAuditPage() {
  await requireSuperAdmin();
  const t = await getTranslations("adminAudit");
  return (
    <>
      <TopBar />
      <AdminHead title={t("title")} lead={t("lead")} />
      <main className="main admin-main" id="main">
        <AdminAudit />
      </main>
    </>
  );
}
