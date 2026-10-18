import { getTranslations } from "next-intl/server";
import { Aurora } from "@/components/brand";
import { EmptyState } from "@/components/shell/EmptyState";
import { TopBar } from "@/components/shell/TopBar";

/** หน้าหลัก (UX W4) — R0 ยังไม่มีนัด → หน้าว่าง แมวถือแก้วชา */
export default async function HomePage() {
  const t = await getTranslations("empty.home");
  return (
    <>
      <Aurora intensity="hero" />
      <TopBar />
      <main className="main" id="main">
        <EmptyState
          pose="tea"
          headingLevel={1}
          title={t("title")}
          body={t("body")}
          cta={{ label: t("cta"), href: "/calendar" }}
        />
      </main>
    </>
  );
}
