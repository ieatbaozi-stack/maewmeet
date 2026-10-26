import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/icons/Icon";

/** หัวหน้าย่อยของ /admin/** — ลิงก์กลับหน้าแรกผู้ดูแลระบบ + h1 (+ คำอธิบาย) */
export async function AdminHead({ title, lead, back = "/admin", backLabel }: { title: string; lead?: string; back?: string; backLabel?: string }) {
  const t = await getTranslations("admin");
  return (
    <div className="admin-head">
      <Link className="admin-back" href={back} data-testid="admin-back">
        <Icon name="chevron-left" size="sm" />
        <span>{backLabel ?? t("back")}</span>
      </Link>
      <h1>{title}</h1>
      {lead ? <p className="admin-lead">{lead}</p> : null}
    </div>
  );
}
