import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { NotificationsView } from "@/components/notifications/NotificationsView";
import { loadNotificationsPage } from "./_lib/load";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

/** แจ้งเตือนในแอป (R4B ADR 0007 · UX W24) — เต็มหน้า · เซิร์ฟเวอร์โหลดหน้าแรก ไคลเอนต์ mark read / โหลดเพิ่ม */
export default async function NotificationsPage() {
  await requireUser();
  const { page, nowMs } = await loadNotificationsPage();
  return (
    <>
      <Aurora intensity="soft" />
      <NotificationsView initial={page} initialNowMs={nowMs} />
    </>
  );
}
