"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { isForbiddenPin } from "@/lib/auth/pin-rules";
import { callApi } from "./api";
import { failureText } from "./errors";
import { PinPad } from "./PinPad";

type Phase = "current" | "new" | "confirm";

export interface PinChangeLabels {
  current?: string;
  next: string;
  confirm: string;
  saving: string;
}

export interface PinChangeResult {
  otherSessionsRevoked: number;
}

export interface PinChangeFlowProps {
  /** false = หลัง reset (must_change_pin) ไม่ต้องใส่ PIN เดิม */
  requireCurrent: boolean;
  labels: PinChangeLabels;
  onSuccess: (result: PinChangeResult) => void;
  /** session หมด/ไม่มี → ผู้เรียกพาไป /login */
  onAuthLost: () => void;
}

/**
 * ลำดับใส่ PIN: (PIN เดิม) → PIN ใหม่ → ยืนยัน แล้ว POST /api/auth/pin
 * ใช้ทั้งหน้า /set-pin (บังคับหลัง reset) และ sheet เปลี่ยน PIN ในแท็บ "ฉัน"
 */
export function PinChangeFlow({ requireCurrent, labels, onSuccess, onAuthLost }: PinChangeFlowProps) {
  const t = useTranslations();
  const [phase, setPhase] = useState<Phase>(requireCurrent ? "current" : "new");
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = phase === "current" ? current : phase === "new" ? pin : confirm;
  const setValue = phase === "current" ? setCurrent : phase === "new" ? setPin : setConfirm;
  const label = phase === "current" ? labels.current : phase === "new" ? labels.next : labels.confirm;

  function onComplete(p: string) {
    if (phase === "current") {
      setPhase("new");
    } else if (phase === "new") {
      if (isForbiddenPin(p)) {
        setError(t("errors.PIN_TOO_WEAK"));
        setPin("");
        return;
      }
      setPhase("confirm");
    } else {
      void submit(p);
    }
  }

  async function submit(c: string) {
    if (c !== pin) {
      setError(t("errors.PIN_MISMATCH"));
      setPin("");
      setConfirm("");
      setPhase("new");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await callApi<{ otherSessionsRevoked: number }>("/api/auth/pin", {
      body: { newPin: pin, newPinConfirm: c, ...(requireCurrent ? { currentPin: current } : {}) },
    });
    setBusy(false);
    if (res.ok) {
      setCurrent("");
      setPin("");
      setConfirm("");
      onSuccess({ otherSessionsRevoked: res.data.otherSessionsRevoked });
      return;
    }
    setConfirm("");
    if (res.kind === "api" && res.error.code === "AUTH_REQUIRED") {
      onAuthLost();
      return;
    }
    setError(failureText(t, res));
    const code = res.kind === "api" ? res.error.code : null;
    if (code === "INVALID_CREDENTIALS" || code === "LOGIN_LOCKED") {
      setCurrent("");
      setPin("");
      setPhase(requireCurrent ? "current" : "new");
    } else if (code === "PIN_TOO_WEAK" || code === "PIN_FORMAT" || code === "PIN_MISMATCH") {
      setPin("");
      setPhase("new");
    }
  }

  return (
    <div>
      <p className="auth-intro auth-lead">{label}</p>
      <PinPad
        value={value}
        onChange={(v) => {
          setValue(v);
          if (error) setError(null);
        }}
        onComplete={onComplete}
        disabled={busy}
      >
        {error ? (
          <p className="pin-msg err" role="alert">
            {error}
          </p>
        ) : busy ? (
          <p className="pin-msg" role="status">
            {labels.saving}
          </p>
        ) : (
          <p className="pin-msg" role="status">
            {t("login.pinHint")}
          </p>
        )}
      </PinPad>
      {phase !== "current" ? (
        <div className="rules-box">
          <p className="rules-title">{t("pinRules.title")}</p>
          <ul className="rules">
            {(["digits", "notRepeated", "notSequence"] as const).map((k) => (
              <li key={k}>
                <Icon name="check" size="sm" />
                <span>{t(`pinRules.${k}`)}</span>
              </li>
            ))}
          </ul>
          <p className="rules-why">{t("pinRules.why")}</p>
        </div>
      ) : null}
    </div>
  );
}
