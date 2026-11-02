"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";

export interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** iPad: กึ่งกลางคอลัมน์เนื้อหา (admin) */
  center?: boolean;
  /** dialog ยืนยันการกระทำที่ย้อนไม่ได้ (UX §4 R2): role=alertdialog + กลางจอบน iPad */
  alert?: boolean;
  /** sheet สูง (ฟอร์มยาว เช่น ลงวันไม่ว่าง): เต็มความสูงจอเว้นขอบบน */
  tall?: boolean;
  /** คลาสเสริมของ sheet (เช่น av-sheet ของรายละเอียดวัน "ว่างตรงกัน") */
  className?: string;
  /** ปุ่ม/ช่องที่รับโฟกัสตอนเปิด (ไม่ส่ง = ตัวแรกใน sheet) — dialog ยืนยันใช้ปุ่ม "ยกเลิก" ไม่ใช่ปุ่มทำลาย */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * bottom sheet แบบ dialog (UX §3): scrim + role=dialog aria-modal · Esc ปิด · Tab วนอยู่ใน sheet · คืนโฟกัสให้ปุ่มที่เปิด
 */
export function Sheet({ title, onClose, children, footer, center = false, alert = false, tall = false, className, initialFocusRef }: SheetProps) {
  const t = useTranslations("a11y");
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  // R6E E12: ปิด = เล่นแอนิเมชันออก (--dur-fast) แล้วค่อยเรียก onClose · reduced-motion (0ms) = ปิดทันที
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  function requestClose() {
    if (closeTimer.current) return;
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-fast").trim();
    const ms = raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : 0;
    if (!(ms > 0)) {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
      onCloseRef.current();
    }, ms);
  }

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = initialFocusRef?.current ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
    return () => opener?.focus?.();
    // โฟกัสเริ่มต้นตั้งครั้งเดียวตอนเปิด
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (!firstEl || !lastEl) return;
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }

  // render ที่ <body>: ถ้าอยู่ใน .main/.app (มี stacking context ของตัวเอง) sheet จะถูกแถบแท็บล่าง (z-nav) ทับปุ่มท้าย sheet
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="scrim" aria-hidden="true" data-closing={closing || undefined} onClick={requestClose} />
      <section
        ref={ref}
        className={["sheet", center || alert ? "center" : "", alert ? "alert-sheet" : "", tall ? "tall" : "", className ?? ""].filter(Boolean).join(" ")}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        tabIndex={-1}
        data-closing={closing || undefined}
        onKeyDown={onKeyDown}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <div className="t">
            <h2 id={`${id}-t`}>{title}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label={t("close")} onClick={requestClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot sheet-actions">{footer}</div> : null}
      </section>
    </>,
    document.body,
  );
}
