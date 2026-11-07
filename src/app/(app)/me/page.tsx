import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { AccountSection } from "@/components/account/AccountSection";
import { AccountActions } from "@/components/auth/AccountActions";
import { Aurora } from "@/components/brand";
import { Icon } from "@/components/icons/Icon";
import { PrefsSettings } from "@/components/prefs/PrefsSettings";
import { TopBar } from "@/components/shell/TopBar";
import { THEME_COOKIE, parseLocale, parseTheme } from "@/i18n/config";
import { authCtx } from "@/lib/auth/context";
import { listPinResets } from "@/lib/auth/services/admin-resets";
import { getRequestSession } from "@/lib/auth/page-session";
import { clock } from "@/lib/shared/clock";
import { Name } from "@/components/Name";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("me");
  return { title: t("title") };
}

/** จำนวนคำขอ reset ที่รออนุมัติ (เฉพาะ super admin) — ล้มเหลวเงียบ ๆ แล้วไม่แสดงตัวเลข (ลิงก์ยังใช้ได้) */
async function pendingResetCount(): Promise<number | null> {
  try {
    const { req, actor } = await getRequestSession();
    const { items } = await listPinResets(actor, authCtx(req, clock.now()));
    return items.length;
  } catch {
    return null;
  }
}

/** ฉัน (UX W10 / F8) — บัญชี (ชื่อ, ความเป็นส่วนตัว, ลบบัญชี — R5) · การแสดงผล · ความปลอดภัย (เปลี่ยน PIN, ออกจากระบบ) · ผู้ดูแลระบบ (เฉพาะ super admin) */
export default async function MePage() {
  const user = await requireUser();
  const locale = parseLocale(await getLocale());
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const t = await getTranslations("me");
  const pending = user.isAdmin ? await pendingResetCount() : null;
  return (
    <>
      <Aurora intensity="hero" />
      <TopBar title={t("title")} />
      <main className="main stack-lg" id="main">
        <section className="settings account-card" aria-label={user.displayName}>
          <p className="account-name"><Name>{user.displayName}</Name></p>
          <p className="muted">{t("signedInAs", { username: user.username })}</p>
        </section>
        <AccountSection displayName={user.displayName} isSuperAdmin={user.isAdmin} />
        <PrefsSettings current={{ locale, theme }} />
        <AccountActions />
        {user.isAdmin ? (
          <section className="settings" aria-labelledby="me-admin">
            <h2 className="h-section" id="me-admin">
              {t("admin")}
            </h2>
            <Link className="menu-row" href="/admin" data-testid="me-admin-hub">
              <span>{t("adminHub")}</span>
              <Icon name="chevron-right" />
            </Link>
            <Link className="menu-row" href="/admin/pin-resets">
              <span>{t("adminResets")}</span>
              {pending ? <span className="tag tag-wait">{t("adminResetsBadge", { count: pending })}</span> : null}
              <Icon name="chevron-right" />
            </Link>
          </section>
        ) : null}
      </main>
    </>
  );
}
