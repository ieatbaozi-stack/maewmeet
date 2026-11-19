"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PinPad } from "@/components/auth/PinPad";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { signalNavStart } from "@/components/shell/nav-start";
import { Sheet } from "@/components/shell/Sheet";
import { normalizeUsername } from "@/lib/auth/pin-rules";
import { callApiRaw } from "./api";
import { deleteOutcome, type GroupRef } from "./model";
import { isolate } from "@/components/notifications/model";

type Step = { kind: "info" } | { kind: "pin" } | { kind: "transfer"; groups: GroupRef[] } | { kind: "superAdmin" };

const GONE = ["sessions", "groups", "busy", "rsvp", "invites", "name", "line", "resets"] as const;
const KEEP = ["appointments", "audit"] as const;

/**
 * ลบบัญชี (POST /api/me/delete · R5 §2 ข้อ 2 · R17 A1 = L3) — alertdialog สองขั้น:
 *  1) อธิบายสิ่งที่จะหาย/ยังอยู่ + พิมพ์ชื่อผู้ใช้ยืนยัน (โฟกัสเริ่มที่ "ยกเลิก") → 2) ใส่ PIN ปัจจุบัน (ครบ 6 หลักส่งทันที)
 * ส่ง {pin, confirmUsername} · 400 VALIDATION confirmUsername → กลับขั้น 1 พร้อมข้อความ (ไม่นับเป็น PIN ผิด)
 * 409 ADMIN_TRANSFER_REQUIRED → รายชื่อกลุ่มพร้อมลิงก์ไปตั้งค่ากลุ่ม (ไม่มีอะไรถูกลบ) · สำเร็จ → /login
 */
export function DeleteAccountSheet({ username, onClose }: { username: string; onClose: () => void }) {
  const t = useTranslations();
  const id = useId();
  const router = useRouter();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<Step>({ kind: "info" });
  const [pin, setPin] = useState("");
  const [typed, setTyped] = useState("");
  const [mismatch, setMismatch] = useState(false);
  // กันมือพลาด: เทียบแบบเดียวกับเซิร์ฟเวอร์ (NFKC + trim + lowercase)
  const typedOk = normalizeUsername(typed) !== "" && normalizeUsername(typed) === normalizeUsername(username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toLogin() {
    signalNavStart("/login"); // R16 U3: แถบ progress ขึ้นตอนลบบัญชี
    router.replace("/login");
    router.refresh();
  }

  async function submit(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await callApiRaw<{ deleted: true }>("/api/me/delete", { body: { pin: value, confirmUsername: typed } });
    if (res.ok) {
      toLogin();
      return;
    }
    setBusy(false);
    const out = deleteOutcome(res);
    setPin("");
    if (out.kind === "usernameMismatch") {
      setMismatch(true);
      setStep({ kind: "info" });
      return;
    }
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
            <button type="button" className="btn btn-danger btn-block" disabled={!typedOk} onClick={() => setStep({ kind: "pin" })} data-testid="delete-continue">
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
          <div className="alert alert-warn">
            <Icon name="triangle-alert" />
            <div>
              <strong>{t("account.delete.noRestore")}</strong>
            </div>
          </div>
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
          <div className="field type-confirm">
            <label htmlFor={`${id}-u`}>{t("account.delete.typeLabel")}</label>
            <div className="input">
              <input
                id={`${id}-u`}
                className="input-bare"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  if (mismatch) setMismatch(false);
                }}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={mismatch ? true : undefined}
                aria-describedby={`${id}-uh${mismatch ? ` ${id}-ue` : ""}`}
                data-testid="delete-username"
              />
            </div>
            <p className="field-hint" id={`${id}-uh`}>
              {t("account.delete.typeHint", { username: isolate(username) })}
            </p>
            {mismatch ? (
              <p className="form-error sheet-error" id={`${id}-ue`} role="alert">
                {t("account.delete.usernameMismatch")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {step.kind === "pin" ? (
        <div data-testid="delete-pin">
          <p className="acct-lead">{t("account.delete.pinTitle")}</p>
          <p className="field-hint">{t("account.delete.pinLast")}</p>
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
