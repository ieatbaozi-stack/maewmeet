"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

/** หน่วงก่อนแสดง = --loading-delay (tokens) · ค่าสำรองเมื่ออ่านไม่ได้ */
const FALLBACK_DELAY_MS = 150;
/** กันค้าง: ถ้านำทางไม่จบใน 15 วินาที (เช่น ยกเลิก/ล้ม) ซ่อนแถบเอง */
const GIVE_UP_MS = 15_000;
/** หน้าที่ยังโหลดอยู่ (loading.tsx → LoadingState) มี attribute นี้ — แถบจบเมื่อมันหายไป */
export const NAV_LOADING_ATTR = "data-nav-loading";

export function loadingDelayMs(): number {
  if (typeof document === "undefined") return FALLBACK_DELAY_MS;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--loading-delay").trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return FALLBACK_DELAY_MS;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : FALLBACK_DELAY_MS;
}

/** คลิกที่ควรถือเป็น "เริ่มนำทาง": ลิงก์ภายในที่เปลี่ยนหน้า (pathname ต่าง) — ไม่ใช่แท็บใหม่/ดาวน์โหลด/hash/query เดิม/ปุ่มกด modifier */
export function isInternalNavClick(e: MouseEvent): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!a) return false;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return false;
  let url: URL;
  try {
    url = new URL(a.href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  return url.pathname !== window.location.pathname;
}

/**
 * สัญญาณนำทาง (R6E E12 §3.1): แถบ progress บางด้านบนสุด · ขึ้นเมื่อรอ > --loading-delay (เร็วกว่านั้น = ไม่แสดงเลย ไม่กระพริบ) ·
 * "จบ" = pathname เปลี่ยนแล้ว และ loading boundary ของหน้า (data-nav-loading) หายไปแล้ว → เติมเต็มแล้วจาง ·
 * role=status + ข้อความ sr-only เฉพาะตอนแสดง · ตัวแถบ aria-hidden · จับคลิกลิงก์ภายใน (App Router ไม่มี event ของ router)
 */
export function NavProgress() {
  const t = useTranslations("common");
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "active" | "done">("idle");
  const phaseRef = useRef(phase);
  const navigating = useRef(false);
  const startPath = useRef<string | null>(null);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observer = useRef<MutationObserver | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  });

  useEffect(() => {
    const clear = (r: { current: ReturnType<typeof setTimeout> | null }) => {
      if (r.current) clearTimeout(r.current);
      r.current = null;
    };

    function finish() {
      navigating.current = false;
      startPath.current = null;
      clear(delayTimer);
      clear(giveUpTimer);
      observer.current?.disconnect();
      observer.current = null;
      if (phaseRef.current === "active") {
        setPhase("done");
        clear(fadeTimer);
        fadeTimer.current = setTimeout(() => setPhase("idle"), loadingDelayMs());
      }
    }

    function settleIfReady() {
      if (!navigating.current) return;
      if (window.location.pathname === startPath.current) return; // ยังไม่ถึงหน้าใหม่
      if (document.querySelector(`[${NAV_LOADING_ATTR}]`)) return; // หน้าใหม่ยังเป็น skeleton
      finish();
    }

    function onClick(e: MouseEvent) {
      if (!isInternalNavClick(e)) return;
      clear(fadeTimer);
      clear(delayTimer);
      clear(giveUpTimer);
      navigating.current = true;
      startPath.current = window.location.pathname;
      delayTimer.current = setTimeout(() => {
        if (navigating.current) setPhase("active");
      }, loadingDelayMs());
      giveUpTimer.current = setTimeout(finish, GIVE_UP_MS);
      observer.current?.disconnect();
      observer.current = new MutationObserver(() => settleIfReady());
      observer.current.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clear(delayTimer);
      clear(giveUpTimer);
      clear(fadeTimer);
      observer.current?.disconnect();
    };
  }, []);

  // pathname เปลี่ยน → ตรวจว่าเสร็จจริงไหม (หลัง render ของ loading boundary)
  useEffect(() => {
    if (!navigating.current) return;
    const id = requestAnimationFrame(() => {
      if (!navigating.current || window.location.pathname === startPath.current) return;
      if (!document.querySelector(`[${NAV_LOADING_ATTR}]`)) {
        // เสร็จแล้ว (ไม่มี skeleton)
        navigating.current = false;
        startPath.current = null;
        if (delayTimer.current) clearTimeout(delayTimer.current);
        if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
        observer.current?.disconnect();
        observer.current = null;
        if (phaseRef.current === "active") {
          setPhase("done");
          fadeTimer.current = setTimeout(() => setPhase("idle"), loadingDelayMs());
        }
      }
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return (
    <div className="nav-progress" role="status" data-phase={phase} data-testid="nav-progress">
      {phase !== "idle" ? (
        <>
          <span className="nav-progress-bar" aria-hidden="true" />
          {phase === "active" ? <span className="sr-only">{t("navLoading")}</span> : null}
        </>
      ) : null}
    </div>
  );
}
