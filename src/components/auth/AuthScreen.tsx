import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { Aurora, Logo } from "@/components/brand";
import { LoginPrefs } from "@/components/prefs/LoginPrefs";
import { THEME_COOKIE, parseLocale, parseTheme } from "@/i18n/config";

/** โครงหน้าสาธารณะบน aurora hero (signup / forgot): โลโก้ + ปุ่มภาษา/ธีม แล้วการ์ด veil — ดู samples/signup.html */
export async function AuthScreen({ children }: { children: ReactNode }) {
  const locale = parseLocale(await getLocale());
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const t = await getTranslations("brand");
  return (
    <>
      <Aurora intensity="hero" />
      <main className="login" id="main">
        <div className="login-top">
          <Logo variant="mark" />
          <LoginPrefs current={{ locale, theme }} />
        </div>
        <div className="login-hero login-hero-compact">
          <Logo variant={locale} title={t("appName")} className="logo" />
        </div>
        {children}
      </main>
    </>
  );
}
