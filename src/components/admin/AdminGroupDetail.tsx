"use client";

import { useEffect, useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import "@/components/groups/groups.css";
import { callApi } from "@/components/auth/api";
import { failureText } from "@/components/auth/errors";
import { shownName } from "@/components/account/model";
import { ConfirmDialog } from "@/components/groups/ConfirmDialog";
import { deleteTypeMatches } from "@/components/groups/helpers";
import { RoleTag } from "@/components/groups/RoleTag";
import { SelectField } from "@/components/groups/SelectField";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import type { AdminGroupDetailDto } from "@/lib/data/serializers/admin";
import type { Failure } from "./usePaged";

type Load = { kind: "loading" } | { kind: "error"; failure: Failure } | { kind: "ready"; group: AdminGroupDetailDto };
type Dialog = null | { kind: "transfer"; toUserId: string } | { kind: "delete" };

/**
 * รายละเอียดกลุ่มสำหรับ super admin (R5 §2 ข้อ 3): ชื่อ เขตเวลา จำนวนนัดที่ยังไม่ถึง สมาชิก (ชื่อ/role/เวลาเข้า) — ไม่มี busy/รายละเอียดนัด
 * โอน admin / ลบกลุ่ม ใช้ endpoint กลุ่มเดิม (/api/groups/:gid/transfer-admin, DELETE /api/groups/:gid) — เซิร์ฟเวอร์ลง audit actor = super admin
 */
export function AdminGroupDetail({ groupId }: { groupId: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const id = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [picked, setPicked] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void callApi<{ group: AdminGroupDetailDto }>(`/api/admin/groups/${encodeURIComponent(groupId)}`, { method: "GET" }).then((res) => {
      if (cancelled) return;
      setLoad(res.ok ? { kind: "ready", group: res.data.group } : { kind: "error", failure: res });
    });
    return () => {
      cancelled = true;
    };
  }, [groupId, reloadKey]);

  const date = (ms: number) => format.dateTime(ms, { day: "numeric", month: "short", year: "numeric" });
  const deleted = t("account.deletedName");

  if (load.kind === "loading") {
    return (
      <div className="admin-loading" aria-busy="true">
        <div className="skeleton skeleton-req" />
        <p className="loading-note" role="status">
          {t("states.loading")}
        </p>
      </div>
    );
  }
  if (load.kind === "error") {
    return (
      <div className="admin-loading">
        <div className="alert" role="alert">
          <Icon name="circle-alert" />
          <div>
            <b>{failureText(t, load.failure)}</b>
          </div>
        </div>
        {load.failure.kind === "network" || load.failure.status >= 500 ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setLoad({ kind: "loading" });
              setReloadKey((k) => k + 1);
            }}
          >
            <Icon name="refresh-cw" />
            <span>{t("states.retry")}</span>
          </button>
        ) : null}
      </div>
    );
  }

  const g = load.group;
  const live = g.deletedAt === null;
  const candidates = g.members.filter((m) => m.role !== "admin");
  const target = candidates.find((m) => m.userId === picked) ?? candidates[0];

  function close() {
    if (busy) return;
    setDialog(null);
    setTyped("");
    setSheetError(null);
  }

  async function confirm() {
    if (!dialog || busy) return;
    setBusy(true);
    setSheetError(null);
    const res =
      dialog.kind === "transfer"
        ? await callApi(`/api/groups/${encodeURIComponent(g.id)}/transfer-admin`, { body: { toUserId: dialog.toUserId } })
        : await callApi(`/api/groups/${encodeURIComponent(g.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setSheetError(failureText(t, res));
      return;
    }
    const name = dialog.kind === "transfer" ? shownName(g.members.find((m) => m.userId === dialog.toUserId)?.displayName, deleted) : g.name;
    setToast(dialog.kind === "transfer" ? t("adminGroup.transfer.done", { name }) : t("adminGroup.delete.done", { group: name }));
    setDialog(null);
    setTyped("");
    setReloadKey((k) => k + 1);
  }

  const transferName = dialog?.kind === "transfer" ? shownName(g.members.find((m) => m.userId === dialog.toUserId)?.displayName, deleted) : "";

  return (
    <>
      {toast ? (
        <div className="alert alert-free toast" role="status">
          <Icon name="circle-check" />
          <div>{toast}</div>
        </div>
      ) : null}

      <section className="admin-card" aria-labelledby={`${id}-n`} data-testid="admin-group-detail" data-deleted={live ? "false" : "true"}>
        <h2 className="admin-card-title" id={`${id}-n`}>
          <Name>{g.name}</Name>
        </h2>
        {!live && g.deletedAt !== null ? (
          <div className="alert alert-warn admin-banner" role="note">
            <Icon name="trash-2" />
            <div>{t("adminGroup.deletedBanner", { date: date(g.deletedAt) })}</div>
          </div>
        ) : null}
        <ul className="admin-facts">
          <li>
            <Icon name="users" size="sm" />
            <span>{t("adminGroups.members", { count: g.memberCount })}</span>
          </li>
          <li>
            <Icon name="calendar" size="sm" />
            <span>{t("adminGroup.openAppointments", { count: g.openAppointmentCount })}</span>
          </li>
          <li>
            <Icon name="clock" size="sm" />
            <span>{t("adminGroup.tz", { tz: g.tz })}</span>
          </li>
          <li>
            <Icon name="calendar-plus" size="sm" />
            <span>{t("adminGroups.created", { date: date(g.createdAt) })}</span>
          </li>
        </ul>
      </section>

      <section aria-labelledby={`${id}-m`}>
        <h2 className="sub-h" id={`${id}-m`}>
          {t("adminGroup.membersTitle")}
        </h2>
        <ul className="admin-cards" data-testid="admin-group-members">
          {g.members.map((m) => (
            <li className="admin-card admin-member" key={m.userId} data-username={m.username}>
              <div className="admin-card-top">
                <div className="admin-card-name">
                  <span className="admin-card-title">
                    <Name>{shownName(m.displayName, deleted)}</Name>
                  </span>
                  <span className="admin-card-sub">
                    <Name>{m.username}</Name>
                  </span>
                </div>
                <RoleTag role={m.role} label={t(`roles.${m.role}`)} />
              </div>
              <p className="admin-card-meta">{t("adminGroup.joined", { date: date(m.joinedAt) })}</p>
            </li>
          ))}
        </ul>
      </section>

      {live ? (
        <>
          <section className="set-sec" aria-labelledby={`${id}-t`}>
            <h2 id={`${id}-t`}>{t("adminGroup.transfer.title")}</h2>
            <p className="lead">{t("adminGroup.transfer.body")}</p>
            {target ? (
              <>
                <SelectField
                  id={`${id}-p`}
                  label={t("adminGroup.transfer.pick")}
                  value={target.userId}
                  options={candidates.map((m) => ({ value: m.userId, label: `${shownName(m.displayName, deleted)} (${m.username})` }))}
                  onChange={setPicked}
                />
                <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: "transfer", toUserId: target.userId })} data-testid="admin-transfer">
                  <Icon name="arrow-right-left" />
                  <span>{t("adminGroup.transfer.cta")}</span>
                </button>
              </>
            ) : (
              <p className="field-hint">{t("adminGroup.transfer.none")}</p>
            )}
          </section>

          <section className="set-sec is-danger" aria-labelledby={`${id}-d`}>
            <h2 id={`${id}-d`}>{t("adminGroup.delete.title")}</h2>
            <p className="lead">{t("adminGroup.delete.body")}</p>
            <button type="button" className="btn btn-danger" onClick={() => setDialog({ kind: "delete" })} data-testid="admin-delete-group">
              <Icon name="trash-2" />
              <span>{t("adminGroup.delete.cta")}</span>
            </button>
          </section>
        </>
      ) : null}

      {dialog?.kind === "transfer" ? (
        <ConfirmDialog
          tone="primary"
          title={t("adminGroup.transfer.confirm.title", { name: transferName })}
          body={t("adminGroup.transfer.confirm.body", { name: transferName })}
          confirmLabel={t("adminGroup.transfer.confirm.confirm", { name: transferName })}
          busy={busy}
          error={sheetError}
          onClose={close}
          onConfirm={() => void confirm()}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title={t("adminGroup.delete.confirm.title", { group: g.name })}
          body={t("adminGroup.delete.confirm.body", { count: g.memberCount })}
          confirmLabel={t("adminGroup.delete.confirm.confirm")}
          confirmDisabled={!deleteTypeMatches(typed, g.name)}
          busy={busy}
          error={sheetError}
          onClose={close}
          onConfirm={() => void confirm()}
        >
          <div className="field type-confirm">
            <label htmlFor={`${id}-x`}>{t("adminGroup.delete.confirm.typeLabel")}</label>
            <div className="input">
              <input
                id={`${id}-x`}
                className="input-bare"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={`${id}-xh`}
              />
            </div>
            <p className="field-hint" id={`${id}-xh`}>
              {t("adminGroup.delete.confirm.typeHint", { group: g.name })}
            </p>
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
