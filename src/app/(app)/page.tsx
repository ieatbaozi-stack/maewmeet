import { getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { EmptyState } from "@/components/shell/EmptyState";
import { TopBar } from "@/components/shell/TopBar";

/** หน้าหลัก (UX W4) — R0 ยังไม่มีนัด → หน้าว่าง แมวถือแก้วชา · ปุ่ม "ดูวันที่ว่างตรงกัน" ไปมุมมอง ?v=free ของแท็บปฏิทิน (R4A, UX X34) */
export default async function HomePage() {
  await requireUser();
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
          cta={{ label: t("cta"), href: "/calendar?v=free" }}
        />
      </main>
    </>
  );
}
