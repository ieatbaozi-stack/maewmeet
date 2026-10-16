"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { usePrefs, type Prefs } from "./usePrefs";

/**
 * มุมบนขวาของหน้าเข้าสู่ระบบ (UX W1): ไทย | EN + ปุ่มสลับสว่าง/มืด
 * ไอคอนบนปุ่มเลือกด้วย CSS ตามธีมที่เห็นจริง (data-theme + prefers-color-scheme) จึงไม่ต้องรู้ค่าเครื่องตอนเรนเดอร์
 */
export function LoginPrefs({ current }: { current: Prefs }) {
  const t = useTranslations("prefs");
  const { shown, save, error } = usePrefs(current);

  function toggleTheme() {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = shown.theme === "dark" || (shown.theme === "system" && systemDark);
    save({ theme: isDark ? "light" : "dark" });
  }

  return (
    <div className="login-prefs">
      <div className="lang-switch" role="group" aria-label={t("languageLabel")}>
        <button type="button" lang="th" aria-pressed={shown.locale === "th"} onClick={() => save({ locale: "th" })}>
          {t("languageTh")}
        </button>
        <button type="button" lang="en" aria-pressed={shown.locale === "en"} onClick={() => save({ locale: "en" })}>
          {t("languageShortEn")}
        </button>
      </div>
      <button type="button" className="icon-btn theme-toggle" aria-label={t("toggleTheme")} onClick={toggleTheme}>
        <Icon name="moon" className="when-light" />
        <Icon name="sun" className="when-dark" />
      </button>
      {error ? (
        <p className="login-prefs-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
