import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { NavProgress } from "@/components/shell/NavProgress";
import { SkeletonHold } from "@/components/shell/SkeletonHold";
import { THEME_COOKIE, parseTheme } from "@/i18n/config";
import { THEME_COLOR } from "@/styles/tokens.meta";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  const name = t("name");
  return {
    title: { default: name, template: `%s — ${name}` },
    description: t("description"),
    icons: {
      icon: "/brand/logo-mark.svg",
      apple: [{ url: "/brand/app/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    // R15a §1.3: เปิดจากหน้าจอโฮมเป็นแอป · ชื่อใต้ไอคอนตามภาษาผู้ใช้ (app.name) · แถบสถานะ default = ไม่ทับเนื้อหา อ่านออกทั้งสองธีม
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
};

/**
 * root layout — ADR 0008: <html lang data-theme> มาจาก cookie ฝั่งเซิร์ฟเวอร์ (ไม่มี inline script, ไม่กระพริบ)
 * data-theme="system" → tokens.css ใช้ @media (prefers-color-scheme) เอง
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const t = await getTranslations("a11y");
  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <a className="skip-link" href="#main">
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          <NavProgress />
          <SkeletonHold />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
