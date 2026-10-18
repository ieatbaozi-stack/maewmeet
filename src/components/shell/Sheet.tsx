"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";

export interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** iPad: กึ่งกลางคอลัมน์เนื้อหา (admin) */
  center?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * bottom sheet แบบ dialog (UX §3): scrim + role=dialog aria-modal · Esc ปิด · Tab วนอยู่ใน sheet · คืนโฟกัสให้ปุ่มที่เปิด
 */
export function Sheet({ title, onClose, children, footer, center = false }: SheetProps) {
  const t = useTranslations("a11y");
  const id = useId();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
    return () => opener?.focus?.();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
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

  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <section
        ref={ref}
        className={center ? "sheet center" : "sheet"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <div className="t">
            <h2 id={`${id}-t`}>{title}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label={t("close")} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot sheet-actions">{footer}</div> : null}
      </section>
    </>
  );
}
