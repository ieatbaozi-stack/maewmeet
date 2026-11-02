"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

/** หน่วงก่อนแสดง = --loading-delay (tokens) · ค่าสำรองเมื่ออ่านไม่ได้ */
const FALLBACK_DELAY_MS = 150;
/** กันค้าง: ถ้านำทางไม่จบใน 15 วินาที (เช่น ยกเลิก/ล้ม) ซ่อนแถบเอง */
const GIVE_UP_MS = 15_000;

export function loadingDelayMs(): number {
  if (typeof document === "undefined") return FALLBACK_DELAY_MS;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--loading-delay").trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return FALLBACK_DELAY_MS;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : FALLBACK_DELAY_MS;
}

/** คลิกที่ควรถือเป็น "เริ่มนำทาง": ลิงก์ภายในที่เปลี่ยนหน้าจริง (ไม่ใช่แท็บใหม่/ดาวน์โหลด/hash/ปุ่มกด modifier) */
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
  if (url.pathname === window.location.pathname && url.search === window.location.search) return false; // หน้าเดิม/hash อย่างเดียว
  return true;
}

/**
 * สัญญาณนำทาง (R6E E12 §3.1): แถบ progress บางด้านบนสุด · ขึ้นเมื่อรอ > --loading-delay (เร็วกว่านั้น = ไม่แสดงเลย ไม่กระพริบ) ·
 * จบเมื่อ pathname/search เปลี่ยน → เติมเต็มแล้วจาง · role=status + ข้อความ sr-only เฉพาะตอนแสดง · ตัวแถบ aria-hidden
 * จับคลิกลิงก์ภายใน (แท็บล่าง/ลิงก์) — ไม่มี event ของ router ใน App Router
 */
export function NavProgress() {
  const t = useTranslations("common");
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "active" | "done">("idle");
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  });

  const clear = (r: { current: ReturnType<typeof setTimeout> | null }) => {
    if (r.current) clearTimeout(r.current);
    r.current = null;
  };

  // คลิกลิงก์ภายใน → นับหน่วง แล้วแสดง
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!isInternalNavClick(e)) return;
      clear(delayTimer);
      clear(giveUpTimer);
      clear(fadeTimer);
      delayTimer.current = setTimeout(() => setPhase("active"), loadingDelayMs());
      giveUpTimer.current = setTimeout(() => {
        clear(delayTimer);
        setPhase("idle");
      }, GIVE_UP_MS);
    }
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clear(delayTimer);
      clear(giveUpTimer);
      clear(fadeTimer);
    };
  }, []);

  // หน้าเปลี่ยนแล้ว → จบ (ถ้ายังไม่ทันแสดง = ยกเลิกตัวหน่วง ไม่แสดงเลย)
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clear(delayTimer);
    clear(giveUpTimer);
    if (phaseRef.current !== "active") return;
    setPhase("done");
    fadeTimer.current = setTimeout(() => setPhase("idle"), loadingDelayMs());
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
