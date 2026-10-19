"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { Icon } from "@/components/icons/Icon";
import type { MemberDto } from "@/lib/data/serializers/groups";
import { ConfirmDialog } from "./ConfirmDialog";
import { failureMessage, isGone } from "./errors";
import { setFlash } from "./flash";
import { deleteTypeMatches } from "./helpers";
import type { SectionProps } from "./NameSection";
import { SelectField } from "./SelectField";
import { isolateName } from "@/components/Name";

/** โอนความเป็นผู้ดูแล (admin เท่านั้น) — เลือกสมาชิก → dialog ยืนยัน → admin เดิมกลายเป็นผู้ช่วยดูแล */
export function TransferSection({ groupId, candidates, notify }: Omit<SectionProps, "editable"> & { candidates: MemberDto[] }) {
  const t = useTranslations("groupSettings.transfer");
  const tAll = useTranslations();
  const router = useRouter();
  const id = useId();
  const [picked, setPicked] = useState<string>(candidates[0]?.userId ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = candidates.find((m) => m.userId === picked) ?? candidates[0];

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/groups/${groupId}/transfer-admin`, { body: { toUserId: target.userId } });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      notify({ kind: "ok", text: t("done", { name: target.displayName }) });
      router.refresh();
      return;
    }
    setError(failureMessage(tAll, "generic", res));
    if (isGone(res)) router.refresh();
  }

  return (
    <section className="set-sec" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{t("title")}</h2>
      <p className="lead">{t("body")}</p>
      <SelectField
        id={`${id}-p`}
        label={t("pick")}
        value={target?.userId ?? ""}
        options={candidates.map((m) => ({ value: m.userId, label: isolateName(m.displayName) }))}
        onChange={setPicked}
        disabled={candidates.length === 0}
      />
      <button type="button" className="btn btn-secondary" disabled={!target} onClick={() => setOpen(true)}>
        <Icon name="arrow-right-left" />
        <span>{t("cta")}</span>
      </button>
      {open && target ? (
        <ConfirmDialog
          tone="primary"
          title={t("confirm.title", { name: target.displayName })}
          body={t("confirm.body", { name: target.displayName })}
          confirmLabel={t("confirm.confirm", { name: target.displayName })}
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </section>
  );
}

/** ออกจากกลุ่ม — admin ออกเองไม่ได้ (D8): แสดงเหตุผล + ปุ่มปิด · คนอื่น dialog ยืนยัน → กลับแท็บกลุ่ม */
export function LeaveSection({ groupId, groupName, isAdmin }: { groupId: string; groupName: string; isAdmin: boolean }) {
  const t = useTranslations("groupSettings.leave");
  const tAll = useTranslations();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/groups/${groupId}/leave`);
    if (res.ok) {
      setFlash({ key: "groupSettings.leave.done", values: { group: groupName } });
      router.replace("/groups");
      return;
    }
    setBusy(false);
    setError(failureMessage(tAll, "leave", res));
    if (isGone(res)) router.refresh();
  }

  return (
    <section className="set-sec" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{t("title")}</h2>
      <p className="lead">{isAdmin ? t("adminBlocked") : t("body")}</p>
      <button type="button" className="btn btn-secondary" disabled={isAdmin} onClick={() => setOpen(true)}>
        <Icon name="log-out" />
        <span>{t("cta")}</span>
      </button>
      {open ? (
        <ConfirmDialog
          title={t("confirm.title", { group: groupName })}
          body={t("confirm.body")}
          confirmLabel={t("confirm.confirm")}
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </section>
  );
}

/** ลบกลุ่ม (admin เท่านั้น) — ต้องพิมพ์ชื่อกลุ่มให้ตรงปุ่มจึงกดได้ (กันมือพลาด · สิทธิ์ตรวจที่เซิร์ฟเวอร์) */
export function DeleteSection({ groupId, groupName }: { groupId: string; groupName: string }) {
  const t = useTranslations("groupSettings.delete");
  const tAll = useTranslations();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeRef = useRef<HTMLInputElement>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/groups/${groupId}`, { method: "DELETE" });
    if (res.ok) {
      setFlash({ key: "groupSettings.delete.done", values: { group: groupName } });
      router.replace("/groups");
      return;
    }
    setBusy(false);
    setError(failureMessage(tAll, "generic", res));
    if (isGone(res)) router.refresh();
  }

  function close() {
    setOpen(false);
    setTyped("");
    setError(null);
  }

  return (
    <section className="set-sec is-danger" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{t("title")}</h2>
      <p className="lead">{t("body")}</p>
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        <Icon name="trash-2" />
        <span>{t("cta")}</span>
      </button>
      {open ? (
        <ConfirmDialog
          title={t("confirm.title", { group: groupName })}
          body={t("confirm.body")}
          confirmLabel={t("confirm.confirm")}
          confirmDisabled={!deleteTypeMatches(typed, groupName)}
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() => void confirm()}
        >
          <div className="field type-confirm">
            <label htmlFor={`${id}-t`}>{t("confirm.typeLabel")}</label>
            <div className="input">
              <input
                ref={typeRef}
                id={`${id}-t`}
                className="input-bare"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={`${id}-th`}
              />
            </div>
            <p className="field-hint" id={`${id}-th`}>
              {t("confirm.typeHint", { group: groupName })}
            </p>
          </div>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
