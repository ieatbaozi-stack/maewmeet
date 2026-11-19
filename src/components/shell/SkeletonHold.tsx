"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { clock } from "@/lib/shared/clock";
import { NAV_LOADING_ATTR } from "./NavProgress";
import { skeletonHoldUntil } from "./useMinSkeleton";

/**
 * R16 U4: skeleton ของ loading.tsx (หน้าเปลี่ยนแท็บ/เปิดหน้า) ค้างขั้นต่ำ 250 ms เหมือน useMinSkeleton ของข้อมูลในหน้า (R15a §1.4)
 * loading.tsx หายทันทีที่หน้าจริงมา (เป็น server component จึงค้างเองไม่ได้) → ตัวนี้อยู่ที่ root layout เฝ้า data-nav-loading ·
 * ถ้า skeleton ที่ผู้ใช้เคยเห็นหายก่อนครบ 250 ms → วางแผ่น skeleton หน้าเนื้อหาจนครบเวลา แล้วเอาออก · โหลดเร็วกว่า --loading-delay = ไม่ทำอะไร
 */
export function SkeletonHold() {
  const t = useTranslations("states");
  const [until, setUntil] = useState(0);
  const since = useRef(0);

  useEffect(() => {
    function check() {
      const present = document.querySelector(`[${NAV_LOADING_ATTR}]`) !== null;
      if (present) {
        if (since.current === 0) since.current = clock.now();
        return;
      }
      if (since.current === 0) return;
      const hold = skeletonHoldUntil(since.current, clock.now());
      since.current = 0;
      if (hold > 0) setUntil(hold);
    }
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (until === 0) return;
    const id = setTimeout(() => setUntil(0), Math.max(0, until - clock.now()));
    return () => clearTimeout(id);
  }, [until]);

  if (until === 0) return null;
  return (
    <div className="skeleton-hold" aria-hidden="true" data-testid="skeleton-hold">
      <div className="main">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" />
        <p className="loading-note">{t("loading")}</p>
      </div>
    </div>
  );
}
