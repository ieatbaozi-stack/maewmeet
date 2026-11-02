"use client";

import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

export interface BusyButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** กำลังส่ง: วงหมุน + ข้อความ busyLabel · aria-busy · กดซ้ำไม่ได้ */
  busy: boolean;
  /** ข้อความตอนกำลังส่ง (คีย์ "…saving" เดิมของปุ่มนั้น) */
  busyLabel: string;
  /** ข้อความปกติ (ข้อความล้วน — ใช้จองความกว้างตอนสลับ) */
  idleLabel: string;
}

/**
 * ปุ่มส่ง (R6E E12 §3.2): ระหว่างส่ง = disabled + aria-busy="true" + วงหมุนหน้าข้อความ "กำลัง…" ·
 * ความกว้างคงที่ — ข้อความอีกแบบถูกจองที่ไว้ด้วย CSS (::after จาก data-ghost) ปุ่มจึงไม่ขยับตอนสลับ ·
 * ตอนกำลังส่งปุ่ม disabled (ไม่รับ click/Enter ซ้ำ) · ภาพล้วน CSS (.btn-label / .spinner ใน globals.css)
 */
export function BusyButton({ busy, busyLabel, idleLabel, className, disabled, type = "button", ...rest }: BusyButtonProps) {
  return (
    <button type={type} className={className} disabled={busy || disabled} aria-busy={busy || undefined} {...rest}>
      <span className="btn-label" data-state={busy ? "busy" : "idle"} data-ghost={busy ? idleLabel : busyLabel}>
        <span className="btn-label-row">
          {busy ? <Spinner /> : null}
          <span>{busy ? busyLabel : idleLabel}</span>
        </span>
      </span>
    </button>
  );
}
