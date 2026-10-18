"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { Icon } from "@/components/icons/Icon";
import type { InviteDto } from "@/lib/data/serializers/groups";
import { ConfirmDialog } from "./ConfirmDialog";
import { failureMessage, isGone } from "./errors";
import { formatShortDate } from "./helpers";
import { InviteCodeSheet, type CreatedCode } from "./InviteCodeSheet";
import type { SectionProps } from "./NameSection";

type Revoking = { invite: InviteDto } | null;

export interface InviteSectionProps extends Omit<SectionProps, "editable"> {
  groupName: string;
  invites: InviteDto[];
  /** ผู้ดู admin/moderator เห็นโค้ดของทุกคน · member เห็นเฉพาะของตัวเอง (เซิร์ฟเวอร์กรองแล้ว) */
  seesOthers: boolean;
}

/** ชวนเพื่อน (U5): สร้างโค้ด (แสดงเต็มครั้งเดียว) · รายการโค้ดที่ใช้ได้ + เพิกถอน · ชวนตรงด้วย username + คำเชิญที่รอคำตอบ */
export function InviteSection({ groupId, groupName, invites, seesOthers, notify }: InviteSectionProps) {
  const t = useTranslations("groupSettings.invite");
  const tAll = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [created, setCreated] = useState<CreatedCode | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [sending, setSending] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Revoking>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const codes = invites.filter((i) => i.kind === "code");
  const directs = invites.filter((i) => i.kind === "direct");

  async function createCode() {
    setCreating(true);
    setCreateError(null);
    notify(null);
    const res = await callApi<{ invite: { code: string; expiresAt: number } }>(`/api/groups/${groupId}/invites/code`);
    setCreating(false);
    if (res.ok) {
      setCreated({ code: res.data.invite.code, expiresAt: res.data.invite.expiresAt });
      router.refresh();
      return;
    }
    setCreateError(failureMessage(tAll, "generic", res));
    if (isGone(res)) router.refresh();
  }

  async function sendDirect(e: FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (sending || name === "") return;
    setSending(true);
    setDirectError(null);
    notify(null);
    const res = await callApi(`/api/groups/${groupId}/invites/direct`, { body: { username: name } });
    setSending(false);
    if (res.ok) {
      setUsername("");
      notify({ kind: "ok", text: t("direct.sent", { username: name }) });
      router.refresh();
      return;
    }
    setDirectError(failureMessage(tAll, "directInvite", res, { username: name }));
    if (isGone(res)) router.refresh();
  }

  async function revoke(inv: InviteDto) {
    setRevokeBusy(true);
    setRevokeError(null);
    const res = await callApi(`/api/groups/${groupId}/invites/${inv.id}`, { method: "DELETE" });
    setRevokeBusy(false);
    if (res.ok) {
      setRevoking(null);
      notify({ kind: "ok", text: t("code.revoked") });
      router.refresh();
      return;
    }
    setRevokeError(failureMessage(tAll, "generic", res));
    // ถูกใช้/หมดอายุ/เพิกถอนไปแล้ว หรือกลุ่มหาย → ให้รายการอัปเดต
    if (res.kind === "api" && (res.error.code === "CONFLICT" || isGone(res))) router.refresh();
  }

  /** ยกเลิกคำเชิญตรง: ผลกระทบเล็ก (ส่งใหม่ได้) จึงไม่ต้องมี dialog ยืนยัน */
  async function cancelDirect(inv: InviteDto) {
    notify(null);
    const res = await callApi(`/api/groups/${groupId}/invites/${inv.id}`, { method: "DELETE" });
    if (res.ok) {
      notify({ kind: "ok", text: t("direct.cancelled") });
      router.refresh();
      return;
    }
    notify({ kind: "error", text: failureMessage(tAll, "generic", res) });
    if (res.kind === "api" && (res.error.code === "CONFLICT" || isGone(res))) router.refresh();
  }

  return (
    <section className="set-sec" id="invite" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{t("title")}</h2>

      <h3 className="sub-h sub-first">{t("code.title")}</h3>
      <p className="lead small muted">{seesOthers ? t("code.body") : t("mineOnly")}</p>
      <button type="button" className="btn btn-secondary" disabled={creating} onClick={() => void createCode()}>
        <Icon name="key" />
        <span>{creating ? t("code.creating") : t("code.create")}</span>
      </button>
      {createError ? (
        <p className="form-error" role="alert">
          {createError}
        </p>
      ) : null}

      <h3 className="sub-h">{t("code.listTitle")}</h3>
      {codes.length === 0 ? (
        <p className="small muted list-empty">{t("code.listEmpty")}</p>
      ) : (
        <ul>
          {codes.map((c) => (
            <li className="code-line" key={c.id}>
              <div className="top">
                <span className="hint-code">{t("code.hint", { hint: c.codeHint ?? "" })}</span>
                <button
                  type="button"
                  className="btn-sm-text"
                  aria-label={t("code.revokeAria", { hint: c.codeHint ?? "" })}
                  onClick={() => {
                    setRevokeError(null);
                    setRevoking({ invite: c });
                  }}
                >
                  {t("code.revoke")}
                </button>
              </div>
              <p className="meta">
                {t("code.expires", { date: formatShortDate(c.expiresAt, locale) })} · {t("code.usedCount", { count: c.usesCount })}
              </p>
              <p className="meta">{t("code.createdBy", { name: c.creatorName })}</p>
            </li>
          ))}
        </ul>
      )}

      <h3 className="sub-h">{t("direct.title")}</h3>
      <form onSubmit={(e) => void sendDirect(e)} noValidate>
        <div className="field field-tight">
          <label htmlFor={`${id}-u`}>{t("direct.label")}</label>
          <div className="input" aria-invalid={directError ? true : undefined}>
            <input
              id={`${id}-u`}
              className="input-bare"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={directError ? true : undefined}
              aria-describedby={directError ? `${id}-ue ${id}-uh` : `${id}-uh`}
            />
          </div>
          {directError ? (
            <p className="field-error" id={`${id}-ue`} role="alert">
              <Icon name="circle-alert" size="sm" />
              <span>{directError}</span>
            </p>
          ) : null}
          <p className="field-hint" id={`${id}-uh`}>
            {t("direct.hint")}
          </p>
        </div>
        <button type="submit" className="btn btn-secondary" disabled={sending || username.trim() === ""}>
          <Icon name="send" />
          <span>{sending ? t("direct.sending") : t("direct.submit")}</span>
        </button>
      </form>

      {directs.length > 0 ? (
        <>
          <h3 className="sub-h">{t("direct.pendingTitle")}</h3>
          <ul>
            {directs.map((d) => (
              <li className="code-line" key={d.id}>
                <div className="top">
                  <span className="hint-code">{t("direct.waiting", { username: d.inviteeName ?? "" })}</span>
                  <button
                    type="button"
                    className="btn-sm-text"
                    aria-label={t("direct.cancelAria", { username: d.inviteeName ?? "" })}
                    onClick={() => void cancelDirect(d)}
                  >
                    {t("direct.cancel")}
                  </button>
                </div>
                <p className="meta">{tAll("groups.invites.expires", { date: formatShortDate(d.expiresAt, locale) })}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {created ? <InviteCodeSheet groupName={groupName} created={created} onClose={() => setCreated(null)} /> : null}

      {revoking ? (
        <ConfirmDialog
          title={t("code.revokeConfirm.title", { hint: revoking.invite.codeHint ?? "" })}
          body={t("code.revokeConfirm.body")}
          confirmLabel={t("code.revokeConfirm.confirm")}
          busy={revokeBusy}
          error={revokeError}
          onClose={() => setRevoking(null)}
          onConfirm={() => void revoke(revoking.invite)}
        />
      ) : null}
    </section>
  );
}
