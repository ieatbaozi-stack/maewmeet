"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/icons/Icon";
import { callApi } from "./api";
import { failureText } from "./errors";

export type ResetStatus =
  | { status: "none" }
  | { status: "pending" }
  | { status: "approved"; expiresAt: number }
  | { status: "closed" };

export const RESET_POLL_MS = 15_000;

/**
 * ลืม PIN (UX W3): ส่งคำขอ → สถานะ pending / approved (เครื่องนี้ + หมดอายุ) / closed ตาม cookie ผูกเครื่อง
 * สถานะจาก GET /api/auth/pin-reset/status · pending ถามซ้ำทุก 15 วิ (หยุดเมื่อแท็บถูกซ่อน)
 * "closed" รวม หมดอายุ/ปฏิเสธ/ใช้แล้ว ไว้ข้อความเดียว (ไม่บอกผู้ไม่ได้ล็อกอินว่าถูกปฏิเสธหรือบัญชีมีจริง)
 */
export function ForgotView({ initial }: { initial: ResetStatus }) {
  const t = useTranslations();
  const format = useFormatter();
  const id = useId();
  const [status, setStatus] = useState<ResetStatus>(initial);
  const [sendNew, setSendNew] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const polling = status.status === "pending";
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    const poll = async () => {
      if (document.hidden) return;
      const res = await callApi<ResetStatus>("/api/auth/pin-reset/status", { method: "GET" });
      if (!stopped && res.ok) setStatus(res.data);
    };
    const timer = window.setInterval(() => void poll(), RESET_POLL_MS);
    const onVisible = () => void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [polling]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || username.trim() === "") return;
    setBusy(true);
    setError(null);
    const sent = await callApi<{ accepted: boolean }>("/api/auth/pin-reset", { body: { username: username.trim() } });
    if (!sent.ok) {
      setBusy(false);
      setError(failureText(t, sent));
      return;
    }
    // คำตอบ 202 เหมือนกันทุกกรณี → อ่านสถานะจริงของเครื่องนี้ (cookie เพิ่งตั้ง) ไม่ใช้ผลของ username เป็นสัญญาณ
    const now = await callApi<ResetStatus>("/api/auth/pin-reset/status", { method: "GET" });
    setBusy(false);
    setSendNew(false);
    setStatus(now.ok && now.data.status !== "none" ? now.data : { status: "pending" });
  }

  const showForm = status.status === "none" || sendNew;

  if (showForm) {
    return (
      <>
        <section className="panel login-card auth-card" aria-labelledby={`${id}-t`} aria-busy={busy}>
          <h1 className="auth-title" id={`${id}-t`}>
            {t("forgot.title")}
          </h1>
          <p className="auth-intro">{t("forgot.intro")}</p>
          <form onSubmit={(e) => void submit(e)} noValidate>
            <div className="field">
              <label htmlFor={`${id}-u`}>{t("forgot.username")}</label>
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
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-e` : undefined}
              />
              {error ? (
                <p className="form-error" id={`${id}-e`} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <p className="note-box">
              <Icon name="info" size="sm" />
              <span>{t("forgot.deviceNote")}</span>
            </p>
            <div className="auth-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={busy || username.trim() === ""} aria-busy={busy}>
                {busy ? t("forgot.submitting") : t("forgot.submit")}
              </button>
            </div>
          </form>
        </section>
        <p className="link-row">
          <Link href="/login">{t("forgot.backToLogin")}</Link>
        </p>
      </>
    );
  }

  let icon: IconName;
  let tone: "is-wait" | "is-ok" | "is-closed";
  let ns: "pending" | "approved" | "closed";
  if (status.status === "approved") {
    icon = "circle-check";
    tone = "is-ok";
    ns = "approved";
  } else if (status.status === "closed") {
    icon = "circle-dashed";
    tone = "is-closed";
    ns = "closed";
  } else {
    icon = "clock";
    tone = "is-wait";
    ns = "pending";
  }

  return (
    <section className="panel login-card auth-card" aria-labelledby={`${id}-t`}>
      <div role="status">
        <div className="status-block">
          <span className={`status-badge ${tone}`}>
            <Icon name={icon} />
          </span>
          <h1 className="auth-title" id={`${id}-t`}>
            {t(`forgot.${ns}.title`)}
          </h1>
        </div>
        <p className="auth-intro">{t(`forgot.${ns}.body`)}</p>
      </div>

      {status.status === "pending" ? (
        <>
          <ul className="status-list">
            <li>
              <Icon name="circle-check" size="sm" />
              <span>{t("forgot.pending.hint")}</span>
            </li>
            <li>
              <Icon name="clock" size="sm" />
              <span>{t("forgot.pending.expiry")}</span>
            </li>
            <li>
              <Icon name="info" size="sm" />
              <span>{t("forgot.deviceNote")}</span>
            </li>
          </ul>
          <div className="auth-actions">
            <Link className="btn btn-secondary btn-block" href="/login">
              {t("forgot.backToLogin")}
            </Link>
          </div>
        </>
      ) : null}

      {status.status === "approved" ? (
        <>
          <ul className="status-list">
            <li>
              <Icon name="clock" size="sm" />
              <strong>
                {t("forgot.approved.expires", {
                  expires: format.dateTime(status.expiresAt, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </strong>
            </li>
            <li>
              <Icon name="lock" size="sm" />
              <span>{t("forgot.approved.thisDevice")}</span>
            </li>
          </ul>
          <div className="auth-actions">
            <Link className="btn btn-primary btn-block" href="/login">
              {t("forgot.approved.cta")}
            </Link>
          </div>
        </>
      ) : null}

      {status.status === "closed" ? (
        <div className="auth-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={() => setSendNew(true)}>
            {t("forgot.closed.cta")}
          </button>
          <Link className="btn btn-text btn-block btn-plain" href="/login">
            {t("forgot.backToLogin")}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
