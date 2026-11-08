"use client";

import { useId, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import "@/components/groups/groups.css";
import { dismissIntro, getIntroServerSnapshot, getIntroSnapshot, subscribeIntro } from "./intro-flag";

const STEPS = ["s1", "s2", "s3", "s4"] as const;

/**
 * การ์ดแนะนำ 4 ขั้นบนหน้าหลัก (R8 · docs/design/R8_ONBOARDING.md §4) — แสดงจนกว่าจะกด "เข้าใจแล้ว"
 * สถานะอ่านจาก localStorage หลัง mount ผ่าน useSyncExternalStore (ฝั่งเซิร์ฟเวอร์/hydrate = ไม่เรนเดอร์ จึงไม่ mismatch)
 */
export function IntroCard() {
  const t = useTranslations();
  const id = useId();
  const state = useSyncExternalStore(subscribeIntro, getIntroSnapshot, getIntroServerSnapshot);
  if (state !== "show") return null;

  function dismiss() {
    dismissIntro();
    // การ์ดหายไปพร้อมปุ่มที่โฟกัสอยู่ → ย้ายโฟกัสไปหัวหน้า ไม่ให้โฟกัสหลุด
    const h = document.querySelector<HTMLElement>("main h1");
    if (h) {
      h.tabIndex = -1;
      h.focus();
    }
  }

  return (
    <section className="intro-card" aria-labelledby={`${id}-h`} data-testid="home-intro">
      <h2 id={`${id}-h`}>{t("onboarding.intro.title")}</h2>
      <ol role="list" aria-label={t("onboarding.intro.listAria")}>
        {STEPS.map((s) => (
          <li key={s}>{t(`onboarding.intro.${s}`)}</li>
        ))}
      </ol>
      <p className="field-hint">{t("onboarding.intro.reopenHint")}</p>
      <button type="button" className="btn btn-primary" onClick={dismiss} data-testid="home-intro-dismiss">
        {t("onboarding.intro.dismiss")}
      </button>
    </section>
  );
}
