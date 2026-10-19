"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Sheet } from "@/components/shell/Sheet";
import { callApi } from "./api";
import { failureText } from "./errors";
import { PinChangeFlow } from "./PinChangeFlow";

type Open = null | "pin" | "logoutAll";

/** ส่วน "ความปลอดภัย" ของแท็บ ฉัน: เปลี่ยน PIN · ออกจากระบบ · ออกจากระบบทุกเครื่อง (U1, U13) */
export function AccountActions() {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinDone, setPinDone] = useState(false);

  function toLogin() {
    router.replace("/login");
    router.refresh();
  }

  async function signOut(path: "/api/auth/logout" | "/api/auth/logout-all") {
    setBusy(true);
    setError(null);
    const res = await callApi(path);
    if (res.ok || (res.kind === "api" && res.error.code === "AUTH_REQUIRED")) {
      toLogin();
      return;
    }
    setBusy(false);
    setError(failureText(t, res));
  }

  function close() {
    setOpen(null);
    setPinDone(false);
    setError(null);
  }

  return (
    <section className="settings" aria-labelledby={`${id}-h`}>
      <h2 className="h-section" id={`${id}-h`}>
        {t("me.security")}
      </h2>

      <button type="button" className="btn btn-secondary btn-block" onClick={() => setOpen("pin")}>
        {t("me.changePin")}
      </button>
      <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => void signOut("/api/auth/logout")}>
        {t("me.logout")}
      </button>
      <div className="setting">
        <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => setOpen("logoutAll")}>
          {t("me.logoutAll")}
        </button>
        <p className="field-hint">{t("me.logoutAllHint")}</p>
      </div>

      {open === null && error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {open === "pin" ? (
        <Sheet
          title={t("me.pin.title")}
          onClose={close}
          footer={
            pinDone ? (
              <button type="button" className="btn btn-primary btn-block" onClick={close}>
                {t("common.close")}
              </button>
            ) : undefined
          }
        >
          {pinDone ? (
            <p role="status">{t("me.pin.done")}</p>
          ) : (
            <PinChangeFlow
              requireCurrent
              labels={{ current: t("me.pin.current"), next: t("me.pin.new"), confirm: t("me.pin.confirm"), saving: t("me.pin.saving") }}
              onSuccess={() => setPinDone(true)}
              onAuthLost={toLogin}
            />
          )}
        </Sheet>
      ) : null}

      {open === "logoutAll" ? (
        <Sheet
          title={t("me.logoutAllConfirm.title")}
          onClose={close}
          footer={
            <>
              <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void signOut("/api/auth/logout-all")}>
                {t("me.logoutAllConfirm.confirm")}
              </button>
              <button type="button" className="btn btn-secondary btn-block" onClick={close} disabled={busy}>
                {t("common.cancel")}
              </button>
            </>
          }
        >
          <p>{t("me.logoutAllConfirm.body")}</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </Sheet>
      ) : null}
    </section>
  );
}
