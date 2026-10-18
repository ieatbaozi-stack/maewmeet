"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";

export const PIN_LENGTH = 6;
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export interface PinPadProps {
  /** ตัวเลขที่กดแล้ว (state ของฟอร์มเท่านั้น — ไม่เก็บใน cookie/storage ไม่ log) */
  value: string;
  onChange: (next: string) => void;
  /** เรียกเมื่อครบ 6 หลัก (ค่าที่ครบแล้ว) */
  onComplete?: (pin: string) => void;
  /** ปิดแป้นตัวเลข + ปุ่มลบ (กำลังส่ง / ถูกล็อก) — ปุ่มซ้ายล่าง (leftKey) ยังกดได้ */
  disabled?: boolean;
  /** ปุ่มซ้ายล่าง: ลืม PIN (หน้าเข้าสู่ระบบ) · ไม่ส่ง = ช่องว่าง */
  leftKey?: ReactNode;
  /** ข้อความใต้จุด (hint / error / status) */
  children?: ReactNode;
}

/**
 * แป้น PIN 6 หลัก (UX W1/W2) — ใช้ร่วม login / signup / set-pin / เปลี่ยน PIN
 * จุด 6 จุดแสดงความคืบหน้า ไม่แสดงตัวเลข · ปุ่มสูง --tap-lg · รองรับคีย์บอร์ดตัวเลข/Backspace เมื่อโฟกัสอยู่ที่แป้น
 */
export function PinPad({ value, onChange, onComplete, disabled = false, leftKey, children }: PinPadProps) {
  const t = useTranslations("login");
  const full = value.length >= PIN_LENGTH;

  function press(digit: string) {
    if (disabled || value.length >= PIN_LENGTH) return;
    const next = value + digit;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  }

  function del() {
    if (disabled) return;
    onChange(value.slice(0, -1));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      press(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      del();
    }
  }

  return (
    <>
      <div className="pin-dots" role="img" aria-label={t("pinProgress", { count: value.length })}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={i < value.length ? "on" : undefined} />
        ))}
      </div>
      {children}
      <div className="keypad" role="group" aria-label={t("keypad.label")} onKeyDown={onKeyDown}>
        {DIGITS.map((d) => (
          <button key={d} type="button" className="key" disabled={disabled || full} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        {leftKey ?? <span className="key blank" aria-hidden="true" />}
        <button type="button" className="key" disabled={disabled || full} onClick={() => press("0")}>
          0
        </button>
        <button
          type="button"
          className="key ghost"
          aria-label={t("keypad.delete")}
          disabled={disabled || value.length === 0}
          onClick={del}
        >
          <Icon name="delete" size="lg" />
        </button>
      </div>
    </>
  );
}
