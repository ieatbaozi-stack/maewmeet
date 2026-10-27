import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/app/_lib/session";
import { AdminGroupDetail } from "@/components/admin/AdminGroupDetail";
import { AdminHead } from "@/components/admin/AdminHead";
import { TopBar } from "@/components/shell/TopBar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroup");
  return { title: t("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** รายละเอียดกลุ่มสำหรับดูแล (R5 §2 ข้อ 3–4) — ชื่อ/role/จำนวนเท่านั้น · เปิดแต่ละครั้งลง audit (ที่ API) · คนอื่น 404 */
export default async function AdminGroupPage({ params }: { params: Promise<{ gid: string }> }) {
  await requireSuperAdmin();
  const { gid } = await params;
  if (!UUID.test(gid)) notFound();
  const t = await getTranslations("adminGroup");
  const tList = await getTranslations("adminGroups");
  return (
    <>
      <TopBar />
      <AdminHead title={t("title")} lead={t("privacyNote")} back="/admin/groups" backLabel={tList("title")} />
      <main className="main admin-main" id="main">
        <AdminGroupDetail groupId={gid} />
      </main>
    </>
  );
}
