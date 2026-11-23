import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { Aurora, Logo } from "@/components/brand";
import { getResetStatus, redirectIfSignedIn } from "@/app/_lib/session";
import { LoginForm, type ResetBanner } from "@/components/login/LoginForm";
import { LoginPrefs } from "@/components/prefs/LoginPrefs";
import { nextFromSearch } from "@/components/share/model";
import { THEME_COOKIE, parseLocale, parseTheme } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("title") };
}

/** หน้าเข้าสู่ระบบ (UX W1 · samples/login.html) — aurora hero: บน aurora ตรงๆ มีแค่โลโก้ หัวข้อ ปุ่มภาษา (--ink) */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  // R18 §S3: `next` = หน้าลิงก์ชวน (/i/<token>) เท่านั้น — safeNext ตรวจแบบ allowlist · อย่างอื่น = "/"
  const next = nextFromSearch((await searchParams).next);
  await redirectIfSignedIn(next);
  const status = await getResetStatus();
  const reset: ResetBanner =
    status.status === "pending"
      ? { status: "pending" }
      : status.status === "approved"
        ? { status: "approved", expiresAt: status.expiresAt }
        : null;
  const locale = parseLocale(await getLocale());
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const t = await getTranslations();
  return (
    <>
      <Aurora intensity="hero" />
      <main className="login" id="main">
        <div className="login-top">
          <Logo variant="mark" />
          <LoginPrefs current={{ locale, theme }} />
        </div>
        <div className="login-hero">
          <Logo variant={locale} title={t("brand.appName")} className="logo" />
          <h1>{t("login.title")}</h1>
        </div>
        <LoginForm reset={reset} next={next} />
        <p className="link-row login-privacy">
          <Link href="/privacy" data-testid="login-privacy">
            {t("login.privacy")}
          </Link>
        </p>
      </main>
    </>
  );
}
