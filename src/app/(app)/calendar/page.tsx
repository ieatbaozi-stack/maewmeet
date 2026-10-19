import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { EmptyState } from "@/components/shell/EmptyState";
import { TopBar } from "@/components/shell/TopBar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("calendar") };
}

/** ปฏิทิน — R0 ยังไม่มีกลุ่ม → หน้าว่าง (aurora hero ตาม §3.5 "หน้าว่าง"; มีปฏิทินจริงแล้วเปลี่ยนเป็น soft) */
export default async function CalendarPage() {
  await requireUser();
  const t = await getTranslations();
  return (
    <>
      <Aurora intensity="hero" />
      <TopBar title={t("nav.calendar")} />
      <main className="main" id="main">
        <EmptyState
          pose="calendar"
          title={t("empty.calendarNoGroup.title")}
          body={t("empty.calendarNoGroup.body")}
          cta={{ label: t("empty.calendarNoGroup.cta"), href: "/groups" }}
        />
      </main>
    </>
  );
}
