"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { callApi } from "./api";
import { PinChangeFlow } from "./PinChangeFlow";

/** หน้าบังคับตั้ง PIN ใหม่หลัง reset (UX W2) — ไม่มีแถบล่าง · ออกได้ทางเดียวคือ "ออกจากระบบ" */
export function SetPinForm() {
  const t = useTranslations("setPin");
  const router = useRouter();
  const id = useId();
  const [done, setDone] = useState<{ others: number } | null>(null);

  function toLogin() {
    router.replace("/login");
    router.refresh();
  }

  return (
    <section className="panel login-card auth-card" aria-labelledby={`${id}-t`}>
      {done ? (
        <div role="status">
          <h2 className="auth-title" id={`${id}-t`}>
            {t("done")}
          </h2>
          {done.others > 0 ? <p className="auth-intro">{t("doneOthers")}</p> : null}
          <DoneLink />
        </div>
      ) : (
        <>
          <p className="sr-only" id={`${id}-t`}>
            {t("title")}
          </p>
          <p className="auth-intro auth-first">{t("intro")}</p>
          <PinChangeFlow
            requireCurrent={false}
            labels={{ next: t("pin"), confirm: t("pinConfirm"), saving: t("saving") }}
            onSuccess={(r) => {
              setDone({ others: r.otherSessionsRevoked });
            }}
            onAuthLost={toLogin}
          />
        </>
      )}
    </section>
  );
}

function DoneLink() {
  const t = useTranslations("nav");
  return (
    <div className="auth-actions">
      <Link className="btn btn-primary btn-block" href="/">
        {t("home")}
      </Link>
    </div>
  );
}

/** ปุ่มออกจากระบบมุมบนของหน้า /set-pin */
export function SetPinSignOut() {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    const res = await callApi("/api/auth/logout");
    if (res.ok) {
      router.replace("/login");
      router.refresh();
      return;
    }
    setBusy(false);
    setError(t("states.error.network"));
  }

  return (
    <div className="login-prefs">
      <button type="button" className="btn btn-text" onClick={() => void signOut()} disabled={busy}>
        {t("setPin.signOut")}
      </button>
      {error ? (
        <p className="login-prefs-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
