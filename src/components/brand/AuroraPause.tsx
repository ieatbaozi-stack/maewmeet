"use client";

import { useEffect } from "react";

/**
 * หยุด animation ของ aurora เมื่อแท็บไม่ active (LEAD_DECISIONS A3 / R0-11)
 * ตั้ง data-aurora-paused="true" บน <html> → aurora.css ตั้ง animation-play-state: paused
 * ไม่เรนเดอร์อะไร · ใช้ผ่าน <Aurora> เท่านั้น
 */
export function AuroraPause() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      if (document.hidden) root.dataset.auroraPaused = "true";
      else delete root.dataset.auroraPaused;
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      delete root.dataset.auroraPaused;
    };
  }, []);
  return null;
}
