"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { THEMES, type Theme } from "@/i18n/config";
import { usePrefs, type Prefs } from "./usePrefs";

const THEME_KEY: Record<Theme, "themeSystem" | "themeLight" | "themeDark"> = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
};

/** หัวข้อ "การแสดงผล" ในแท็บ ฉัน (UX F8 / W10) — segmented เปลี่ยนทันที ไม่ต้องกดบันทึก */
export function PrefsSettings({ current }: { current: Prefs }) {
  const t = useTranslations("prefs");
  const { shown, save, pending, error } = usePrefs(current);
  const id = useId();

  return (
    <section className="settings" aria-labelledby={`${id}-h`} aria-busy={pending}>
      <h2 className="h-section" id={`${id}-h`}>
        {t("display")}
      </h2>

      <div className="setting">
        <p className="setting-label" id={`${id}-lang`}>
          {t("language")}
        </p>
        <div className="segmented cols-2" role="group" aria-labelledby={`${id}-lang`}>
          <button type="button" lang="th" aria-pressed={shown.locale === "th"} onClick={() => save({ locale: "th" })}>
            {t("languageTh")}
          </button>
          <button type="button" lang="en" aria-pressed={shown.locale === "en"} onClick={() => save({ locale: "en" })}>
            {t("languageEn")}
          </button>
        </div>
      </div>

      <div className="setting">
        <p className="setting-label" id={`${id}-theme`}>
          {t("theme")}
        </p>
        <div className="segmented" role="group" aria-labelledby={`${id}-theme`}>
          {THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={shown.theme === theme}
              onClick={() => save({ theme })}
            >
              {t(THEME_KEY[theme])}
            </button>
          ))}
        </div>
      </div>

      <p className="form-error" role="alert">
        {error}
      </p>
    </section>
  );
}
