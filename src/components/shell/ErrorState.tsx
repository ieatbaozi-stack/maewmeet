"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";

/** ผิดพลาด = กล่อง --danger-soft บอกเหตุ + ทางแก้ + [ลองอีกครั้ง] (UX §3) */
export function ErrorState({ retry }: { retry: () => void }) {
  const t = useTranslations("states");
  return (
    <div className="error-state">
      <div className="alert" role="alert">
        <Icon name="circle-alert" />
        <div>
          <b>{t("error.generic")}</b>
          <span>{t("error.dataSafe")}</span>
        </div>
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => retry()}>
        <Icon name="refresh-cw" />
        <span>{t("retry")}</span>
      </button>
    </div>
  );
}
