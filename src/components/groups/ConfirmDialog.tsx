"use client";

import { useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Sheet } from "@/components/shell/Sheet";

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  /** ปุ่มยืนยันกดไม่ได้ (เช่น ยังพิมพ์ชื่อกลุ่มไม่ตรง) */
  confirmDisabled?: boolean;
  error?: string | null;
  /** danger = การกระทำที่ย้อนไม่ได้/ทำลาย (ปุ่มแดง) · primary = โอนความเป็นผู้ดูแล */
  tone?: "danger" | "primary";
  children?: ReactNode;
}

/**
 * dialog ยืนยัน (UX §4 R2): alertdialog · ปุ่มทำลายอยู่บน "ยกเลิก" อยู่ล่าง · โฟกัสเริ่มที่ "ยกเลิก" ไม่ใช่ปุ่มทำลาย
 * เป็นแค่กันมือพลาด — สิทธิ์ตรวจที่เซิร์ฟเวอร์เสมอ
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose, busy = false, confirmDisabled = false, error, tone = "danger", children }: ConfirmDialogProps) {
  const t = useTranslations();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Sheet
      title={title}
      onClose={onClose}
      alert
      initialFocusRef={cancelRef}
      footer={
        <>
          <button
            type="button"
            className={tone === "danger" ? "btn btn-danger btn-block" : "btn btn-primary btn-block"}
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button ref={cancelRef} type="button" className="btn btn-secondary btn-block" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      <p>{body}</p>
      {children}
      {error ? (
        <p className="form-error sheet-error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
