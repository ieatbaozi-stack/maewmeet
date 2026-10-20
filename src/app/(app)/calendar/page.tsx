import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { CalendarView } from "@/components/calendar/CalendarView";
import { EmptyState } from "@/components/shell/EmptyState";
import { TopBar } from "@/components/shell/TopBar";
import { loadCalendarPage } from "./_lib/load";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("calendar") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * ปฏิทิน (R3, UX §7): ตัวเลือกกลุ่ม (จำใน ?g=) · เดือน | วัน | ของฉัน (?v=, ?d=) · ลงวันไม่ว่าง
 * เซิร์ฟเวอร์โหลดกลุ่ม + ปฏิทินเดือนแรกผ่าน service (authorize ที่ service) แล้วส่งให้ฝั่งไคลเอนต์ขอเดือนอื่นต่อเองผ่าน API
 */
export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const data = await loadCalendarPage({ g: one(sp.g), v: one(sp.v), d: one(sp.d) });

  if (data.kind === "no-group") {
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

  return (
    <>
      <Aurora intensity="soft" />
      <CalendarView
        key={data.gid}
        groups={data.groups}
        gid={data.gid}
        tz={data.tz}
        userId={user.id}
        initialToday={data.today}
        initialNowMs={data.nowMs}
        initialDate={data.date}
        initialView={data.view}
        initial={data.initial}
      />
    </>
  );
}
