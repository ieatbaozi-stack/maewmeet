import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { Aurora } from "@/components/brand";
import { PrefsSettings } from "@/components/prefs/PrefsSettings";
import { EmptyState } from "@/components/shell/EmptyState";
import { TopBar } from "@/components/shell/TopBar";
import { THEME_COOKIE, parseLocale, parseTheme } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("me") };
}

/** ฉัน (UX W10 / F8) — การแสดงผลใช้ได้จริง · ส่วนบัญชียังไม่เปิด (R1) */
export default async function MePage() {
  const locale = parseLocale(await getLocale());
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const t = await getTranslations();
  return (
    <>
      <Aurora intensity="hero" />
      <TopBar title={t("nav.me")} />
      <main className="main stack-lg" id="main">
        <PrefsSettings current={{ locale, theme }} />
        <EmptyState
          pose="sit"
          catSize="md"
          title={t("empty.me.title")}
          body={t("empty.me.body")}
          cta={{ label: t("empty.me.cta"), href: "/login" }}
        />
      </main>
    </>
  );
}
