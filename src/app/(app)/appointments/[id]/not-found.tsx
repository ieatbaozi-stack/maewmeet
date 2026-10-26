import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Aurora } from "@/components/brand";
import { Icon } from "@/components/icons/Icon";
import { EmptyState } from "@/components/shell/EmptyState";

/** นัดไม่มี / คุณไม่ได้อยู่ในกลุ่มแล้ว (404 — ไม่แยกสองกรณี) */
export default async function AppointmentGone() {
  const t = await getTranslations();
  return (
    <>
      <Aurora intensity="soft" />
      <header className="topbar">
        <Link className="icon-btn" href="/" aria-label={t("appointments.detail.back")}>
          <Icon name="chevron-left" />
        </Link>
        <h1 className="title" style={{ fontSize: "var(--text-lg)" }}>
          {t("appointments.detail.title")}
        </h1>
      </header>
      <main className="main appt-main" id="main" data-testid="appt-gone">
        <EmptyState pose="lost" title={t("appointments.detail.gone.title")} body={t("appointments.detail.gone.body")} cta={{ label: t("appointments.detail.gone.cta"), href: "/" }} />
      </main>
    </>
  );
}
