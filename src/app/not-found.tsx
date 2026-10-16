import { getTranslations } from "next-intl/server";
import { Aurora } from "@/components/brand";
import { EmptyState } from "@/components/shell/EmptyState";

/** 404 (UX W13) — แมวงง + "ไม่พบหน้านี้" + [กลับหน้าหลัก] */
export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <>
      <Aurora intensity="hero" />
      <main className="main main-center" id="main">
        <EmptyState pose="lost" headingLevel={1} title={t("title")} body={t("body")} cta={{ label: t("cta"), href: "/" }} />
      </main>
    </>
  );
}
