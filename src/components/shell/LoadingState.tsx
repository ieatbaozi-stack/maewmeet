import { getTranslations } from "next-intl/server";

/** โหลด = กล่องนิ่ง --surface-2 + "กำลังโหลด…" (ไม่มี shimmer — UI_DIRECTION §5) */
export async function LoadingState() {
  const t = await getTranslations("states");
  return (
    <div className="loading" aria-busy="true" data-nav-loading="true">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-card" />
      <p className="loading-note" role="status">
        {t("loading")}
      </p>
    </div>
  );
}
