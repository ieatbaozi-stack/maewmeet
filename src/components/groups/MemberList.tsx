"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { Icon } from "@/components/icons/Icon";
import { Sheet } from "@/components/shell/Sheet";
import type { MemberDto } from "@/lib/data/serializers/groups";
import { ConfirmDialog } from "./ConfirmDialog";
import { failureMessage, isGone } from "./errors";
import { memberActions, type GroupRole } from "./helpers";
import { MemberAvatar } from "./MemberAvatar";
import { Notice } from "./Notice";
import { RoleTag } from "./RoleTag";
import { Name } from "@/components/Name";

type Dialog = null | { kind: "manage" | "remove" | "transfer"; member: MemberDto };
type Status = { kind: "ok" | "error"; text: string } | null;

export interface MemberListProps {
  groupId: string;
  members: MemberDto[];
  /** role ที่ใช้ตัดสินว่าจะ "แสดง" ปุ่มไหน (null ของ API = super admin นอกกลุ่ม → ส่งเป็น admin) — เซิร์ฟเวอร์ตรวจสิทธิ์จริงทุกครั้ง */
  viewer: GroupRole;
  myId: string;
}

/**
 * รายชื่อสมาชิก + บทบาท (หน้ากลุ่ม และ ตั้งค่ากลุ่ม) — สีอวาตาร์ + รูปทรง + ตัวอักษรย่อ · ป้ายบทบาท ไอคอน+ข้อความ
 * ปุ่ม ⋯ เปิดชีตจัดการ (เปลี่ยนบทบาท / โอน admin / นำออก) เฉพาะแถวที่ role ของผู้ดูทำได้ · ลบ/โอนผ่าน dialog ยืนยัน
 */
export function MemberList({ groupId, members, viewer, myId }: MemberListProps) {
  const t = useTranslations();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setDialog(null);
    setBusy(false);
    setError(null);
  }

  /** ผลของการกระทำ: สำเร็จ → ปิด dialog + แจ้ง + refresh · ล้มเหลว → ข้อความใน dialog (404 = สมาชิก/กลุ่มหายไปแล้ว → refresh) */
  async function run(call: Promise<Awaited<ReturnType<typeof callApi>>>, ok: string) {
    setBusy(true);
    setError(null);
    const res = await call;
    setBusy(false);
    if (res.ok) {
      setDialog(null);
      setStatus({ kind: "ok", text: ok });
      router.refresh();
      return;
    }
    setError(failureMessage(t, "generic", res));
    if (isGone(res)) router.refresh();
  }

  return (
    <>
      {status ? <Notice kind={status.kind}>{status.text}</Notice> : null}
      <ul className="rows m-rows">
        {members.map((m) => {
          const isSelf = m.userId === myId;
          const acts = memberActions(viewer, m.role, isSelf);
          const canManage = acts.setRole !== null || acts.transfer || acts.remove;
          const roleLabel = t(`roles.${m.role}`);
          // R8: เฉพาะสมาชิกคนอื่นที่ API บอกชัดว่า "ไม่มี busy ใน 30 วัน" (ไม่มีค่า = ไม่ป้าย · แถวของตัวเองไม่ป้าย)
          const noBusy = !isSelf && m.hasUpcomingBusy === false;
          const hintId = `nobusy-${m.userId}`;
          const rowAria = t("group.members.rowAria", { name: m.displayName, role: roleLabel });
          return (
            <li key={m.userId}>
              <div
                className="row"
                role="group"
                aria-label={noBusy ? `${rowAria}. ${t("group.members.noBusyAria", { name: m.displayName })}` : rowAria}
                aria-describedby={noBusy ? hintId : undefined}
              >
                <MemberAvatar displayName={m.displayName} colorIndex={m.colorIndex} shapeIndex={m.shapeIndex} size="lg" />
                <span className="row-main">
                  <span className="row-title"><Name>{m.displayName}</Name></span>
                  {isSelf ? <span className="you">{t("group.members.you")}</span> : null}
                  <RoleTag role={m.role} label={roleLabel} />
                  {noBusy ? (
                    <span className="no-busy-line">
                      <span className="tag tag-warn no-busy" data-testid="member-no-busy">{t("group.members.noBusyBadge")}</span>
                      <span className="sr-only" id={hintId}>{t("group.members.noBusyHint")}</span>
                    </span>
                  ) : null}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("group.members.actionsAria", { name: m.displayName })}
                    onClick={() => {
                      setStatus(null);
                      setDialog({ kind: "manage", member: m });
                    }}
                  >
                    <Icon name="ellipsis" />
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {dialog?.kind === "manage" ? (
        <ManageSheet
          member={dialog.member}
          actions={memberActions(viewer, dialog.member.role, dialog.member.userId === myId)}
          busy={busy}
          error={error}
          onClose={close}
          onSetRole={(role) =>
            void run(
              callApi(`/api/groups/${groupId}/members/${dialog.member.userId}`, { method: "PATCH", body: { role } }),
              t("groupSettings.members.roleChanged", { role, name: dialog.member.displayName }),
            )
          }
          onTransfer={() => {
            setError(null);
            setDialog({ kind: "transfer", member: dialog.member });
          }}
          onRemove={() => {
            setError(null);
            setDialog({ kind: "remove", member: dialog.member });
          }}
        />
      ) : null}

      {dialog?.kind === "remove" ? (
        <ConfirmDialog
          title={t("groupSettings.members.removeConfirm.title", { name: dialog.member.displayName })}
          body={t("groupSettings.members.removeConfirm.body", { name: dialog.member.displayName })}
          confirmLabel={t("groupSettings.members.removeConfirm.confirm")}
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() =>
            void run(
              callApi(`/api/groups/${groupId}/members/${dialog.member.userId}`, { method: "DELETE" }),
              t("groupSettings.members.removed", { name: dialog.member.displayName }),
            )
          }
        />
      ) : null}

      {dialog?.kind === "transfer" ? (
        <ConfirmDialog
          tone="primary"
          title={t("groupSettings.transfer.confirm.title", { name: dialog.member.displayName })}
          body={t("groupSettings.transfer.confirm.body", { name: dialog.member.displayName })}
          confirmLabel={t("groupSettings.transfer.confirm.confirm", { name: dialog.member.displayName })}
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() =>
            void run(
              callApi(`/api/groups/${groupId}/transfer-admin`, { body: { toUserId: dialog.member.userId } }),
              t("groupSettings.transfer.done", { name: dialog.member.displayName }),
            )
          }
        />
      ) : null}
    </>
  );
}

function ManageSheet({
  member,
  actions,
  busy,
  error,
  onClose,
  onSetRole,
  onTransfer,
  onRemove,
}: {
  member: MemberDto;
  actions: ReturnType<typeof memberActions>;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSetRole: (role: "moderator" | "member") => void;
  onTransfer: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations();
  return (
    <Sheet
      title={t("groupSettings.members.manageTitle", { name: member.displayName })}
      onClose={onClose}
      center
      footer={
        <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>
          {t("common.cancel")}
        </button>
      }
    >
      <p className="muted small">{t(`roles.help.${member.role}`)}</p>
      <ul className="rows action-rows">
        {actions.setRole ? (
          <li>
            <button type="button" className="row row-btn" disabled={busy} onClick={() => onSetRole(actions.setRole!)}>
              <Icon name={actions.setRole === "moderator" ? "shield" : "user"} />
              <span className="row-main">
                <span className="row-title">{actions.setRole === "moderator" ? t("groupSettings.members.makeModerator") : t("groupSettings.members.makeMember")}</span>
              </span>
            </button>
          </li>
        ) : null}
        {actions.transfer ? (
          <li>
            <button type="button" className="row row-btn" disabled={busy} onClick={onTransfer}>
              <Icon name="arrow-right-left" />
              <span className="row-main">
                <span className="row-title">{t("groupSettings.members.transfer")}</span>
              </span>
            </button>
          </li>
        ) : null}
        {actions.remove ? (
          <li>
            <button type="button" className="row row-btn is-danger" disabled={busy} onClick={onRemove}>
              <Icon name="user-minus" />
              <span className="row-main">
                <span className="row-title">{t("groupSettings.members.remove")}</span>
              </span>
            </button>
          </li>
        ) : null}
      </ul>
      {error ? (
        <p className="form-error sheet-error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
