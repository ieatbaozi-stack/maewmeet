"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { Icon } from "@/components/icons/Icon";
import { failureMessage, isGone } from "./errors";
import { GROUP_NAME_MAX, groupNameLength } from "./helpers";
import { BusyButton } from "@/components/shell/BusyButton";

export interface SectionProps {
  groupId: string;
  editable: boolean;
  notify: (n: { kind: "ok" | "error"; text: string } | null) => void;
}

/** เปลี่ยนชื่อกลุ่ม (admin/moderator) — คนอื่นเห็นเป็นข้อความอ่านอย่างเดียว */
export function NameSection({ groupId, name, editable, notify }: SectionProps & { name: string }) {
  const t = useTranslations("groupSettings");
  const tAll = useTranslations();
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const len = groupNameLength(value);
  const unchanged = value.normalize("NFC").trim() === name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || len === 0 || unchanged) return;
    setBusy(true);
    setError(null);
    notify(null);
    const res = await callApi(`/api/groups/${groupId}`, { method: "PATCH", body: { name: value } });
    setBusy(false);
    if (res.ok) {
      notify({ kind: "ok", text: t("name.saved") });
      router.refresh();
      return;
    }
    setError(failureMessage(tAll, "groupName", res));
    if (isGone(res)) router.refresh();
  }

  return (
    <section className="set-sec" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{t("name.title")}</h2>
      {editable ? (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label htmlFor={`${id}-n`}>{t("name.label")}</label>
            <div className="input" aria-invalid={error ? true : undefined}>
              <input
                id={`${id}-n`}
                className="input-bare"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={`${id}-hint`}
              />
              <span className="counter num" aria-hidden="true">
                {len}/{GROUP_NAME_MAX}
              </span>
            </div>
            <p className="field-hint" id={`${id}-hint`}>
              {t("name.hint", { max: GROUP_NAME_MAX })}
            </p>
            {error ? (
              <p className="field-error" role="alert">
                <Icon name="circle-alert" size="sm" />
                <span>{error}</span>
              </p>
            ) : null}
          </div>
          <BusyButton type="submit" className="btn btn-primary" busy={busy} disabled={len === 0 || unchanged} busyLabel={tAll("common.save")} label={tAll("common.save")} />
        </form>
      ) : (
        <p className="readonly">{name}</p>
      )}
    </section>
  );
}
