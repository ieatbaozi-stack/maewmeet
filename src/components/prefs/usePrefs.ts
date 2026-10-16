"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiErrorMessage } from "@/i18n/errors";
import type { Locale, Theme } from "@/i18n/config";

export interface Prefs {
  locale: Locale;
  theme: Theme;
}

/**
 * สลับภาษา/ธีม (ADR 0008 §1, §4): POST /api/prefs → cookie HttpOnly → router.refresh()
 * - ค่าปัจจุบันมาจาก server component (JS อ่าน cookie HttpOnly ไม่ได้)
 * - ธีม: ตั้ง data-theme บน <html> ทันที (ไม่รอ refresh) · ล้มเหลว → คืนค่าเดิม
 * - fetch ของเบราว์เซอร์ส่ง Origin เองสำหรับ POST (route wrapper ตรวจ CSRF)
 */
export function usePrefs(current: Prefs) {
  const router = useRouter();
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(current);
  const [error, setError] = useState<string | null>(null);

  function save(next: Partial<Prefs>) {
    setError(null);
    const root = document.documentElement;
    const prevTheme = root.dataset.theme;
    if (next.theme) root.dataset.theme = next.theme;

    startTransition(async () => {
      setShown({ ...current, ...next });
      let ok = false;
      try {
        const res = await fetch("/api/prefs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(next),
        });
        if (res.ok) ok = true;
        else {
          const body: unknown = await res.json().catch(() => undefined);
          const msg = apiErrorMessage(body);
          setError(t(msg.key, msg.values));
        }
      } catch {
        setError(t("states.error.network"));
      }
      if (ok) {
        router.refresh();
      } else if (next.theme && prevTheme !== undefined) {
        root.dataset.theme = prevTheme;
      }
    });
  }

  return { shown, save, pending, error };
}
