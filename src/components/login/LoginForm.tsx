"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { PinPad } from "@/components/auth/PinPad";
import { useCountdown } from "@/components/auth/useCountdown";
import { Icon } from "@/components/icons/Icon";
import { lockedMessage, messageRefOf } from "@/i18n/auth-messages";

export type ResetBanner = { status: "pending" } | { status: "approved"; expiresAt: number } | null;

interface LoginResponse {
  user: { mustChangePin: boolean };
}

/**
 * ฟอร์มเข้าสู่ระบบ (UX W1) — POST /api/auth/login
 * ครบ 6 หลัก (และมีชื่อผู้ใช้) → ส่งทันที · ผิด: "เหลืออีก N ครั้ง" · ล็อก: นับถอยหลังจาก retryAfterSec แป้นปิด (ลืม PIN ยังกดได้)
 * AUTH_MAINTENANCE / RATE_LIMITED / เครือข่าย → ข้อความจาก messages ไม่นับเป็น PIN ผิด
 */
export function LoginForm({ reset }: { reset: ResetBanner }) {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const id = useId();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<{ until: number; username: string } | null>(null);

  const lockedFor = lock && lock.username === username.trim().toLowerCase() ? lock : null;
  const remainingSec = useCountdown(lockedFor?.until ?? null);
  const locked = lockedFor !== null && remainingSec > 0;
  const lockRef = lockedMessage(remainingSec);

  async function submit(fullPin: string) {
    setBusy(true);
    setError(null);
    const res = await callApi<LoginResponse>("/api/auth/login", { body: { username: username.trim(), pin: fullPin } });
    if (res.ok) {
      router.replace(res.data.user.mustChangePin ? "/set-pin" : "/");
      router.refresh();
      return; // ค้างสถานะ busy จนกว่าหน้าจะเปลี่ยน
    }
    setPin("");
    setBusy(false);
    if (res.kind === "network") {
      setError(t("states.error.network"));
      return;
    }
    if (res.error.code === "LOGIN_LOCKED") {
      const sec = typeof res.error.values.retryAfterSec === "number" ? res.error.values.retryAfterSec : 60;
      setLock({ until: Date.now() + sec * 1000, username: username.trim().toLowerCase() });
      return;
    }
    const ref = messageRefOf(res.error);
    setError(t(ref.key, ref.values));
  }

  const disabled = busy || locked || username.trim() === "";
  const expires =
    reset?.status === "approved"
      ? format.dateTime(reset.expiresAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";

  return (
    <>
      {reset ? (
        <div className="banner" role="status">
          <Icon name={reset.status === "approved" ? "circle-check" : "clock"} size="sm" />
          <p>{reset.status === "approved" ? t("login.resetBanner.approved", { expires }) : t("login.resetBanner.pending")}</p>
          <Link className="link-btn" href="/forgot">
            {t("login.resetBanner.action")}
          </Link>
        </div>
      ) : null}

      <section className="panel login-card" aria-labelledby={`${id}-pin`} aria-busy={busy}>
        <div className="field field-first">
          <label htmlFor={`${id}-u`}>{t("login.username")}</label>
          <input
            id={`${id}-u`}
            name="username"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-describedby={`${id}-uh`}
          />
          <p className="sr-only" id={`${id}-uh`}>
            {t("login.usernameHint")}
          </p>
        </div>

        <p className="sr-only" id={`${id}-pin`}>
          {t("login.pin")}
        </p>
        <PinPad
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (error) setError(null);
          }}
          onComplete={(p) => void submit(p)}
          disabled={disabled}
          leftKey={
            <Link className="key ghost" href="/forgot">
              {t("login.forgotPin")}
            </Link>
          }
        >
          {locked ? (
            <div className="lock-box" role="alert">
              <p className="lock-title">{t("login.locked.title")}</p>
              <p>{t(lockRef.key, lockRef.values)}</p>
              <p className="muted">{t("login.locked.hint")}</p>
            </div>
          ) : error ? (
            <p className="pin-msg err" role="alert">
              {error}
            </p>
          ) : busy ? (
            <p className="pin-msg" role="status">
              {t("login.checking")}
            </p>
          ) : (
            <p className="pin-msg" role="status">
              {t("login.pinHint")}
            </p>
          )}
        </PinPad>
      </section>

      <p className="login-foot">
        <span>{t("login.noAccount")}</span>{" "}
        <Link className="link-btn" href="/signup">
          {t("login.createAccount")}
        </Link>
      </p>
    </>
  );
}
