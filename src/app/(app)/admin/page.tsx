import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/app/_lib/session";
import { Icon, type IconName } from "@/components/icons/Icon";
import { TopBar } from "@/components/shell/TopBar";
import { authCtx } from "@/lib/auth/context";
import { listPinResets } from "@/lib/auth/services/admin-resets";
import { getRequestSession } from "@/lib/auth/page-session";
import { clock } from "@/lib/shared/clock";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("title") };
}

/** จำนวนคำขอ reset ที่รออนุมัติ — ล้มเหลวเงียบ ๆ แล้วไม่แสดงตัวเลข (ลิงก์ยังใช้ได้) */
async function pendingResetCount(): Promise<number | null> {
  try {
    const { req, actor } = await getRequestSession();
    const { items } = await listPinResets(actor, authCtx(req, clock.now()));
    return items.length;
  } catch {
    return null;
  }
}

const LINKS: readonly { href: string; icon: IconName; key: "resets" | "users" | "groups" | "audit" }[] = [
  { href: "/admin/pin-resets", icon: "key", key: "resets" },
  { href: "/admin/users", icon: "user", key: "users" },
  { href: "/admin/groups", icon: "users", key: "groups" },
  { href: "/admin/audit", icon: "shield", key: "audit" },
];

/** หน้าแรกของผู้ดูแลระบบ (R5 §2 ข้อ 4) — สรุปคำขอ reset ค้าง + ทางไปผู้ใช้/กลุ่ม/audit · ไม่ใช่ super admin → 404 */
export default async function AdminHubPage() {
  await requireSuperAdmin();
  const t = await getTranslations("admin");
  const tMe = await getTranslations("me");
  const pending = await pendingResetCount();
  return (
    <>
      <TopBar />
      <div className="admin-head">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p className="admin-lead">{t("lead")}</p>
      </div>
      <main className="main admin-main" id="main">
        <ul className="admin-hub">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link className="hub-card" href={l.href} data-testid={`admin-hub-${l.key}`}>
                <span className="hub-ico" aria-hidden="true">
                  <Icon name={l.icon} />
                </span>
                <span className="hub-text">
                  <span className="hub-title">{t(l.key)}</span>
                  <span className="hub-hint">{t(`${l.key}Hint`)}</span>
                </span>
                {l.key === "resets" && pending ? <span className="tag tag-wait">{tMe("adminResetsBadge", { count: pending })}</span> : null}
                <Icon name="chevron-right" />
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
