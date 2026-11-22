"use client";

import { useId, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { readDismissed as readIntroDismissed, subscribeIntro } from "./intro-flag";
import { dismissInstallHint, installHintSnapshot, subscribeInstallHint } from "./install-hint";

const subscribe = (cb: () => void): (() => void) => {
  const a = subscribeInstallHint(cb);
  const b = subscribeIntro(cb);
  return () => {
    a();
    b();
  };
};

/**
 * R18 G1: แถบ "เพิ่มไปหน้าจอโฮม" (iPhone/iPad Safari · ยังไม่เป็นแอป · ยังไม่เคยปิด · การ์ดแนะนำปิดแล้ว)
 * อยู่ในกระแสเนื้อหาบนสุดของ <main> หน้าหลัก/ปฏิทินเท่านั้น (ไม่ fixed ไม่บังแถบล่าง) · ปุ่มเดียวคือทางปิด
 * hydrate: ฝั่งเซิร์ฟเวอร์ = ไม่เรนเดอร์ แล้วตัดสินหลัง mount (ไม่เกิด mismatch)
 */
export function InstallHint() {
  const t = useTranslations("installHint");
  const id = useId();
  const show = useSyncExternalStore(subscribe, () => installHintSnapshot(readIntroDismissed()), () => false);
  if (!show) return null;

  function dismiss() {
    dismissInstallHint();
    // แถบหายไปพร้อมปุ่มที่โฟกัสอยู่ → ย้ายโฟกัสไปหัวหน้า (เหมือนการ์ดแนะนำ)
    const h = document.querySelector<HTMLElement>("main h1");
    if (h) {
      h.tabIndex = -1;
      h.focus();
    }
  }

  return (
    <section className="panel install-hint" role="region" aria-label={t("region")} aria-labelledby={`${id}-h`} data-testid="install-hint">
      <Icon name="share-2" size="lg" />
      <div className="install-hint-body">
        <h2 id={`${id}-h`}>{t("title")}</h2>
        <p>{t("body")}</p>
        <ol>
          <li>{t("step1")}</li>
          <li>{t("step2")}</li>
        </ol>
        <button type="button" className="btn btn-secondary" onClick={dismiss} data-testid="install-hint-dismiss">
          {t("dismiss")}
        </button>
      </div>
    </section>
  );
}
