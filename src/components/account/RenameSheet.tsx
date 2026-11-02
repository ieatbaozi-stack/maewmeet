"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Sheet } from "@/components/shell/Sheet";
import { DISPLAY_NAME_MAX } from "@/lib/auth/pin-rules";
import { ACCOUNT_RATE_LIMITS } from "@/lib/shared/limits";
import { callApiRaw } from "./api";
import { renameErrorRef, renameLocalProblem } from "./model";
import { BusyButton } from "@/components/shell/BusyButton";

/** เปลี่ยนชื่อที่แสดง (PATCH /api/me) — กติกาเดียวกับสมัคร ตรวจที่เซิร์ฟเวอร์ · ที่เครื่องกันแค่ชื่อว่าง/ยาวเกิน */
export function RenameSheet({ current, onClose, onDone }: { current: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations();
  const id = useId();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const local = renameLocalProblem(value);
    if (local) {
      setError(t("account.rename.invalid", { reason: local, max: DISPLAY_NAME_MAX }));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await callApiRaw<{ user: { displayName: string } }>("/api/me", { method: "PATCH", body: { displayName: value.trim() } });
    setBusy(false);
    if (res.ok) {
      onDone();
      return;
    }
    const ref = renameErrorRef(res);
    setError(t(ref.key, ref.values));
  }

  return (
    <Sheet
      title={t("account.rename.title")}
      onClose={() => (busy ? undefined : onClose())}
      footer={
        <>
          <BusyButton type="submit" form={`${id}-f`} className="btn btn-primary btn-block" busy={busy} busyLabel={t("account.rename.saving")} idleLabel={t("account.rename.save")} />
          <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      <form id={`${id}-f`} onSubmit={(e) => void submit(e)} noValidate>
        <div className="field field-first">
          <label htmlFor={`${id}-n`}>{t("account.rename.label")}</label>
          <div className="input">
            <input
              id={`${id}-n`}
              className="input-bare"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              autoComplete="nickname"
              maxLength={DISPLAY_NAME_MAX * 4}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-h${error ? ` ${id}-e` : ""}`}
            />
          </div>
          <p className="field-hint" id={`${id}-h`}>
            {t("account.rename.hint", { max: DISPLAY_NAME_MAX, perDay: ACCOUNT_RATE_LIMITS.rename.limit })}
          </p>
          {error ? (
            <p className="form-error sheet-error" id={`${id}-e`} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </Sheet>
  );
}
