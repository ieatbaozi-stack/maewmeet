"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/icons/Icon";
import { APPOINTMENT_GUESTS_MAX } from "@/lib/shared/limits";

export type ShareStatusKind = "full" | "expired" | "invalid" | "rate";

const ICON: Record<ShareStatusKind, IconName> = { full: "users", expired: "clock", invalid: "ban", rate: "clock" };

/**
 * หน้าสถานะของลิงก์ (UX R18_SHARE_FLOW §4): ไอคอน + หัวข้อ + ข้อความ + ปุ่ม "ไปหน้าหลัก" เท่านั้น
 * ไม่แสดงชื่อนัด/กลุ่ม/เวลา (กันรั่วจากลิงก์ที่ปิดแล้ว) · expired/invalid = ข้อความเป็นกลาง ไม่บอกเหตุผล
 * rate = เกินถังเปิดลิงก์ (ใช้ข้อความกลาง errors.RATE_LIMITED — ยังไม่มีคีย์เฉพาะ)
 */
export function ShareStatus({ kind, max }: { kind: ShareStatusKind; max?: number }) {
  const t = useTranslations();
  return (
    <section className="panel login-card share-card share-status" aria-labelledby="share-status-t" data-testid="share-status" data-kind={kind}>
      <Icon name={ICON[kind]} size="lg" />
      {kind === "rate" ? (
        <h1 id="share-status-t">{t("errors.RATE_LIMITED")}</h1>
      ) : (
        <>
          <h1 id="share-status-t">{t(`shareLanding.state.${kind}.title`)}</h1>
          <p>{t(`shareLanding.state.${kind}.body`, { max: max ?? APPOINTMENT_GUESTS_MAX })}</p>
        </>
      )}
      <Link className="btn btn-primary btn-block" href="/" data-testid="share-status-home">
        {t("shareLanding.state.home")}
      </Link>
    </section>
  );
}
