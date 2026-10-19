"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { isForbiddenPin, isValidUsername, normalizeUsername, DISPLAY_NAME_MAX } from "@/lib/auth/pin-rules";
import { callApi } from "./api";
import { failureText } from "./errors";
import { PinPad } from "./PinPad";

type Step = 1 | 2 | 3;
const TOTAL = 3;

/**
 * สมัครบัญชี (UX W2) — 3 ขั้น: ข้อมูล → ตั้ง PIN → ใส่ PIN อีกครั้ง · POST /api/auth/signup (สร้าง session ทันที)
 * ตรวจรูปแบบเบื้องต้นฝั่ง client เพื่อความเร็ว แต่ผลจริงตัดสินที่เซิร์ฟเวอร์เสมอ (ชื่อซ้ำ ฯลฯ)
 */
export function SignupForm() {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [step, setStep] = useState<Step>(1);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  function next(e: FormEvent) {
    e.preventDefault();
    if (!isValidUsername(normalizeUsername(username))) {
      setFieldError(t("errors.USERNAME_FORMAT"));
      return;
    }
    setFieldError(null);
    setStep(2);
  }

  function onPin(p: string) {
    if (isForbiddenPin(p)) {
      setPinError(t("errors.PIN_TOO_WEAK"));
      setPin("");
      return;
    }
    setPinError(null);
    setStep(3);
  }

  async function onConfirm(c: string) {
    if (c !== pin) {
      setPinError(t("errors.PIN_MISMATCH"));
      setPin("");
      setConfirm("");
      setStep(2);
      return;
    }
    setBusy(true);
    setPinError(null);
    const res = await callApi<unknown>("/api/auth/signup", {
      body: { username: username.trim(), displayName: displayName.trim(), pin, pinConfirm: c },
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setBusy(false);
    setConfirm("");
    const text = failureText(t, res);
    const code = res.kind === "api" ? res.error.code : null;
    if (code === "USERNAME_TAKEN" || code === "USERNAME_FORMAT" || code === "VALIDATION") {
      setFieldError(text);
      setPin("");
      setStep(1);
    } else if (code === "PIN_TOO_WEAK" || code === "PIN_FORMAT" || code === "PIN_MISMATCH") {
      setPinError(text);
      setPin("");
      setStep(2);
    } else {
      setPinError(text);
    }
  }

  function back() {
    setPinError(null);
    setConfirm("");
    if (step === 3) setPin("");
    setStep((s) => (s === 3 ? 2 : 1));
  }

  const ready = username.trim() !== "" && displayName.trim() !== "";

  return (
    <>
      <section className="panel login-card auth-card" aria-labelledby={`${id}-t`} aria-busy={busy}>
        <p className="step-of">{t("signup.stepOf", { current: step, total: TOTAL })}</p>
        <h1 className="auth-title" id={`${id}-t`}>
          {t("signup.title")}
        </h1>

        {step === 1 ? (
          <form onSubmit={next} noValidate>
            <p className="auth-intro">{t("signup.intro")}</p>
            <div className="field">
              <label htmlFor={`${id}-u`}>{t("signup.username")}</label>
              <input
                id={`${id}-u`}
                className="input"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={64}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setFieldError(null);
                }}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${id}-e ${id}-uh` : `${id}-uh`}
              />
              <p className="field-hint" id={`${id}-uh`}>
                {t("signup.usernameHint")}
              </p>
              {fieldError ? (
                <p className="form-error" id={`${id}-e`} role="alert">
                  {fieldError}
                </p>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor={`${id}-d`}>{t("signup.displayName")}</label>
              <input
                id={`${id}-d`}
                className="input"
                autoComplete="nickname"
                maxLength={DISPLAY_NAME_MAX}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-describedby={`${id}-dh`}
              />
              <p className="field-hint" id={`${id}-dh`}>
                {t("signup.displayNameHint")}
              </p>
            </div>
            <div className="auth-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={!ready}>
                {t("login.next")}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p className="auth-intro auth-lead">{step === 2 ? t("signup.pin") : t("signup.pinConfirm")}</p>
            <PinPad
              value={step === 2 ? pin : confirm}
              onChange={(v) => {
                (step === 2 ? setPin : setConfirm)(v);
                if (pinError) setPinError(null);
              }}
              onComplete={step === 2 ? onPin : (c) => void onConfirm(c)}
              disabled={busy}
              leftKey={
                <button type="button" className="key ghost" onClick={back} disabled={busy}>
                  {t("a11y.back")}
                </button>
              }
            >
              {pinError ? (
                <p className="pin-msg err pin-msg-left" role="alert">
                  {pinError}
                </p>
              ) : busy ? (
                <p className="pin-msg" role="status">
                  {t("signup.submitting")}
                </p>
              ) : step === 2 ? (
                <p className="pin-msg pin-msg-left">{t("signup.pinRemember")}</p>
              ) : (
                <p className="pin-msg" role="status">
                  {t("login.pinHint")}
                </p>
              )}
            </PinPad>
            {step === 2 ? (
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
        )}
      </section>

      <p className="link-row">
        <span>{t("signup.haveAccount")}</span> <Link href="/login">{t("signup.signIn")}</Link>
      </p>
    </>
  );
}
