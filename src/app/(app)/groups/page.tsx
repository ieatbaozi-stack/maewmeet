import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { EmptyState } from "@/components/shell/EmptyState";
import { TopBar } from "@/components/shell/TopBar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("groups") };
}

/** กลุ่ม (UX W9) — R0 ยังไม่มีกลุ่ม · สร้างกลุ่มมาใน R2 → ปุ่มปิดไว้ */
export default async function GroupsPage() {
  await requireUser();
  const t = await getTranslations();
  return (
    <>
      <Aurora intensity="hero" />
      <TopBar title={t("nav.groups")} />
      <main className="main" id="main">
        <EmptyState
          pose="peek"
          title={t("empty.groups.title")}
          body={t("empty.groups.body")}
          cta={{ label: t("empty.groups.cta") }}
        />
      </main>
    </>
  );
}
