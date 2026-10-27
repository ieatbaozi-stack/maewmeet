"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PinPad } from "@/components/auth/PinPad";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { Sheet } from "@/components/shell/Sheet";
import { callApiRaw } from "./api";
import { deleteOutcome, type GroupRef } from "./model";

type Step = { kind: "info" } | { kind: "pin" } | { kind: "transfer"; groups: GroupRef[] } | { kind: "superAdmin" };

const GONE = ["sessions", "groups", "busy", "rsvp", "invites", "resets", "name"] as const;
const KEEP = ["appointments", "audit"] as const;

/**
 * ลบบัญชี (POST /api/me/delete · R5 §2 ข้อ 2) — alertdialog สองขั้น:
 *  1) อธิบายสิ่งที่จะหาย/ยังอยู่ (โฟกัสเริ่มที่ "ยกเลิก") → 2) ใส่ PIN ปัจจุบัน (ครบ 6 หลักส่งทันที)
 * 409 ADMIN_TRANSFER_REQUIRED → รายชื่อกลุ่มพร้อมลิงก์ไปตั้งค่ากลุ่ม (ไม่มีอะไรถูกลบ) · สำเร็จ → /login
 */
export function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<Step>({ kind: "info" });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toLogin() {
    router.replace("/login");
    router.refresh();
  }

  async function submit(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await callApiRaw<{ deleted: true }>("/api/me/delete", { body: { pin: value } });
    if (res.ok) {
      toLogin();
      return;
    }
    setBusy(false);
    const out = deleteOutcome(res);
    setPin("");
    if (out.kind === "transfer") setStep({ kind: "transfer", groups: out.groups });
    else if (out.kind === "superAdmin") setStep({ kind: "superAdmin" });
    else if (out.kind === "authLost") toLogin();
    else setError(t(out.ref.key, out.ref.values));
  }

  const close = () => (busy ? undefined : onClose());
  const title = step.kind === "transfer" ? t("account.delete.transferTitle") : t("account.delete.title");

  return (
    <Sheet
      title={title}
      onClose={close}
      alert
      initialFocusRef={cancelRef}
      footer={
        step.kind === "info" ? (
          <>
            <button type="button" className="btn btn-danger btn-block" onClick={() => setStep({ kind: "pin" })} data-testid="delete-continue">
              {t("account.delete.continue")}
            </button>
            <button ref={cancelRef} type="button" className="btn btn-secondary btn-block" onClick={onClose}>
              {t("common.cancel")}
            </button>
          </>
        ) : step.kind === "pin" ? (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              disabled={busy}
              onClick={() => {
                setPin("");
                setError(null);
                setStep({ kind: "info" });
              }}
            >
              {t("account.delete.back")}
            </button>
            <button ref={cancelRef} type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <button ref={cancelRef} type="button" className="btn btn-secondary btn-block" onClick={onClose}>
            {t("common.close")}
          </button>
        )
      }
    >
      {step.kind === "info" ? (
        <div className="acct-delete" data-testid="delete-info">
          <p className="acct-lead">{t("account.delete.lead")}</p>
          <h3 className="acct-sub">{t("account.delete.goneTitle")}</h3>
          <ul className="acct-list is-gone">
            {GONE.map((k) => (
              <li key={k}>
                <Icon name="x" size="sm" />
                <span>{t(`account.delete.gone.${k}`)}</span>
              </li>
            ))}
          </ul>
          <h3 className="acct-sub">{t("account.delete.keepTitle")}</h3>
          <ul className="acct-list">
            {KEEP.map((k) => (
              <li key={k}>
                <Icon name="check" size="sm" />
                <span>{t(`account.delete.keep.${k}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step.kind === "pin" ? (
        <div data-testid="delete-pin">
          <p className="acct-lead">{t("account.delete.pinTitle")}</p>
          <PinPad value={pin} onChange={(v) => { setPin(v); if (error) setError(null); }} onComplete={(v) => void submit(v)} disabled={busy}>
            {error ? (
              <p className="pin-msg err" role="alert">
                {error}
              </p>
            ) : busy ? (
              <p className="pin-msg note" role="status">
                {t("account.delete.deleting")}
              </p>
            ) : (
              <p className="pin-msg">{t("account.delete.pinHint")}</p>
            )}
          </PinPad>
        </div>
      ) : null}

      {step.kind === "transfer" ? (
        <div data-testid="delete-transfer">
          <div className="alert alert-warn" role="alert">
            <Icon name="triangle-alert" />
            <div>{t("account.delete.transferBody")}</div>
          </div>
          <ul className="acct-groups">
            {step.groups.map((g) => (
              <li key={g.id}>
                <Link className="menu-row" href={`/groups/${g.id}/settings`} aria-label={t("account.delete.transferLink", { group: g.name })}>
                  <span>
                    <Name>{g.name}</Name>
                  </span>
                  <Icon name="chevron-right" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step.kind === "superAdmin" ? (
        <p role="alert" data-testid="delete-sa">
          {t("account.delete.superAdmin")}
        </p>
      ) : null}
    </Sheet>
  );
}
