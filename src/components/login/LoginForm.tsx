"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";

const PIN_LENGTH = 6;
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * ฟอร์มเข้าสู่ระบบ (UX W1) — R0 เป็นหน้าแสดงเท่านั้น: ไม่ส่งข้อมูล
 * ครบ 6 หลัก / กดลืม PIN / สร้างบัญชี → แสดง login.notYet (R1 จะต่อกับ /api/auth)
 * จุด 6 จุดแสดงความคืบหน้า ไม่แสดงตัวเลขที่กด · ปุ่มแป้นสูง --tap-lg
 */
export function LoginForm() {
  const t = useTranslations("login");
  const id = useId();
  const [pin, setPin] = useState("");
  const [notYet, setNotYet] = useState(false);

  function press(digit: string) {
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) setNotYet(true);
  }

  function del() {
    setPin((p) => p.slice(0, -1));
    setNotYet(false);
  }

  const full = pin.length >= PIN_LENGTH;

  return (
    <>
      <section className="panel login-card" aria-labelledby={`${id}-pin`}>
        <div className="field field-first">
          <label htmlFor={`${id}-u`}>{t("username")}</label>
          <input
            id={`${id}-u`}
            name="username"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={`${id}-uh`}
          />
          <p className="sr-only" id={`${id}-uh`}>
            {t("usernameHint")}
          </p>
        </div>

        <p className="sr-only" id={`${id}-pin`}>
          {t("pin")}
        </p>
        <div className="pin-dots" role="img" aria-label={t("pinProgress", { count: pin.length })}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span key={i} className={i < pin.length ? "on" : undefined} />
          ))}
        </div>
        <p className={notYet ? "pin-msg note" : "pin-msg"} role="status">
          {notYet ? t("notYet") : t("pinHint")}
        </p>

        <div className="keypad" role="group" aria-label={t("keypad.label")}>
          {DIGITS.map((d) => (
            <button key={d} type="button" className="key" disabled={full} onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button type="button" className="key ghost" onClick={() => setNotYet(true)}>
            {t("forgotPin")}
          </button>
          <button type="button" className="key" disabled={full} onClick={() => press("0")}>
            0
          </button>
          <button
            type="button"
            className="key ghost"
            aria-label={t("keypad.delete")}
            disabled={pin.length === 0}
            onClick={del}
          >
            <Icon name="delete" size="lg" />
          </button>
        </div>
      </section>

      <p className="login-foot">
        <span>{t("noAccount")}</span>{" "}
        <button type="button" className="link-btn" onClick={() => setNotYet(true)}>
          {t("createAccount")}
        </button>
      </p>
    </>
  );
}
