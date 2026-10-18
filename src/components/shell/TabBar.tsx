"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/icons/Icon";

const TABS: readonly { href: string; icon: IconName; label: "home" | "calendar" | "groups" | "me" }[] = [
  { href: "/", icon: "house", label: "home" },
  { href: "/calendar", icon: "calendar", label: "calendar" },
  { href: "/groups", icon: "users", label: "groups" },
  { href: "/me", icon: "user", label: "me" },
];

function isActive(pathname: string, href: string): boolean {
  // หน้า admin เป็นของแท็บ "ฉัน" (ทางเข้าอยู่ในแท็บนั้น)
  if (href === "/me" && (pathname === "/admin" || pathname.startsWith("/admin/"))) return true;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** แถบนำทางล่าง 4 แท็บ (UI_DIRECTION §4) — พื้น --surface-nav (A4) */
export function TabBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label={t("label")}>
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="tab"
          aria-current={isActive(pathname, tab.href) ? "page" : undefined}
        >
          <Icon name={tab.icon} />
          <span>{t(tab.label)}</span>
        </Link>
      ))}
    </nav>
  );
}
