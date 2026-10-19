import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/app/_lib/session";
import { PinResetList } from "@/components/admin/PinResetList";
import { TopBar } from "@/components/shell/TopBar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminResets");
  return { title: t("title") };
}

/** คำขอ reset PIN (UX W12) — super admin เท่านั้น · คนอื่น 404 (สิทธิ์ของ API ตรวจที่เซิร์ฟเวอร์อีกชั้น) */
export default async function AdminPinResetsPage() {
  await requireSuperAdmin();
  const t = await getTranslations("adminResets");
  return (
    <>
      <TopBar />
      <div className="admin-head">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
      </div>
      <main className="main admin-main" id="main">
        <PinResetList />
      </main>
    </>
  );
}
