import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { Aurora, Logo } from "@/components/brand";
import { LoginForm } from "@/components/login/LoginForm";
import { LoginPrefs } from "@/components/prefs/LoginPrefs";
import { THEME_COOKIE, parseLocale, parseTheme } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("title") };
}

/** หน้าเข้าสู่ระบบ (UX W1 · samples/login.html) — aurora hero: บน aurora ตรงๆ มีแค่โลโก้ หัวข้อ ปุ่มภาษา (--ink) */
export default async function LoginPage() {
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
        <LoginForm />
      </main>
    </>
  );
}
