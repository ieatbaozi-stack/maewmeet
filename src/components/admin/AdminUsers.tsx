"use client";

import { useId, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import "@/components/groups/groups.css";
import { callApi } from "@/components/auth/api";
import { failureText } from "@/components/auth/errors";
import { queryString } from "@/components/account/model";
import { ConfirmDialog } from "@/components/groups/ConfirmDialog";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import type { AdminUserDto } from "@/lib/data/serializers/admin";
import { ADMIN_QUERY_MAX } from "@/lib/shared/limits";
import { AdminListState, LoadMore, SearchBox } from "./AdminParts";
import { usePaged } from "./usePaged";

type Action = "suspend" | "unsuspend" | "unlock";
type Pending = { action: Action; user: AdminUserDto };

/**
 * ผู้ใช้ทั้งหมด (R5 §2 ข้อ 3–4) — ค้นหา · โหลดเพิ่มแบบ cursor · ระงับ/ยกเลิกระงับ/ปลดล็อก ผ่าน Sheet ยืนยันที่บอกผลที่ตามมา
 * ไม่มีปุ่มกับตัวเองและผู้ดูแลระบบคนอื่น (เซิร์ฟเวอร์ปฏิเสธ 403 อีกชั้น)
 */
export function AdminUsers({ meId }: { meId: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const id = useId();
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const list = usePaged<AdminUserDto, { users: AdminUserDto[]; nextCursor: string | null }>(
    `/api/admin/users${queryString({ q: applied })}`,
    "cursor",
    (d) => ({ items: d.users, nextCursor: d.nextCursor }),
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function search(e: FormEvent) {
    e.preventDefault();
    setToast(null);
    setApplied(q.trim());
  }

  function open(action: Action, user: AdminUserDto) {
    setPending({ action, user });
    setSheetError(null);
  }

  async function confirm() {
    if (!pending || busy) return;
    const { action, user } = pending;
    setBusy(true);
    setSheetError(null);
    const res = await callApi<{ user: { status?: "active" | "suspended"; changed?: boolean; wasLocked?: boolean } }>(
      `/api/admin/users/${encodeURIComponent(user.id)}/${action}`,
    );
    setBusy(false);
    if (!res.ok) {
      setSheetError(res.kind === "api" && res.error.code === "FORBIDDEN" ? t("adminUsers.forbidden") : failureText(t, res));
      if (res.kind === "api" && res.status === 404) list.reload();
      return;
    }
    setPending(null);
    const changed = action === "unlock" ? true : res.data.user.changed !== false;
    setToast(
      changed
        ? t(action === "suspend" ? "adminUsers.suspended" : action === "unsuspend" ? "adminUsers.unsuspended" : "adminUsers.unlocked", { username: user.username })
        : t("adminUsers.unchanged", { username: user.username }),
    );
    list.update((items) =>
      items.map((u) =>
        u.id !== user.id
          ? u
          : action === "unlock"
            ? { ...u, locked: false, lockedUntil: null }
            : { ...u, status: action === "suspend" ? "suspended" : "active" },
      ),
    );
  }

  const date = (ms: number) => format.dateTime(ms, { day: "numeric", month: "short", year: "numeric" });
  const when = (ms: number) => format.dateTime(ms, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <SearchBox
        id={`${id}-q`}
        label={t("adminUsers.searchLabel")}
        hint={t("adminUsers.searchHint", { max: ADMIN_QUERY_MAX })}
        value={q}
        maxLength={ADMIN_QUERY_MAX}
        onChange={setQ}
        onSubmit={search}
        onClear={
          applied || q
            ? () => {
                setQ("");
                setApplied("");
              }
            : undefined
        }
      />

      {toast ? (
        <div className="alert alert-free toast" role="status">
          <Icon name="circle-check" />
          <div>{toast}</div>
        </div>
      ) : null}

      <AdminListState list={list} emptyTitle={t("adminUsers.empty.title")} emptyBody={t("adminUsers.empty.body")} />

      {list.status === "ready" && list.items.length > 0 ? (
        <section aria-labelledby={`${id}-h`}>
          <h2 className="sub-h" id={`${id}-h`}>
            {t("adminUsers.count", { count: list.items.length })}
          </h2>
          <ul className="admin-cards" data-testid="admin-users">
            {list.items.map((u) => {
              const self = u.id === meId;
              const actionable = !self && !u.isAdmin && u.status !== "deleted";
              return (
                <li className="admin-card" key={u.id} data-testid="admin-user" data-username={u.username} data-status={u.status}>
                  <div className="admin-card-top">
                    <div className="admin-card-name">
                      <span className="admin-card-title">
                        <Name>{u.displayName || t("account.deletedName")}</Name>
                      </span>
                      <span className="admin-card-sub">
                        <Name>{u.username}</Name>
                        {self ? ` · ${t("admin.you")}` : ""}
                      </span>
                    </div>
                    <span className={`tag ${u.status === "active" ? "tag-ok" : "tag-bad"}`}>{t(`adminUsers.status.${u.status}`)}</span>
                  </div>
                  <ul className="admin-facts">
                    {u.isAdmin ? (
                      <li>
                        <Icon name="shield" size="sm" />
                        <span>{t("adminUsers.superAdmin")}</span>
                      </li>
                    ) : null}
                    {u.locked ? (
                      <li className="is-warn">
                        <Icon name="lock" size="sm" />
                        <span>{u.lockedUntil !== null ? t("adminUsers.lockedUntil", { when: when(u.lockedUntil) }) : t("adminUsers.locked")}</span>
                      </li>
                    ) : null}
                    {u.hasOpenReset ? (
                      <li>
                        <Icon name="key" size="sm" />
                        <span>{t("adminUsers.openReset")}</span>
                      </li>
                    ) : null}
                    <li>
                      <Icon name="users" size="sm" />
                      <span>{t("adminUsers.groupCount", { count: u.groupCount })}</span>
                    </li>
                    <li>
                      <Icon name="clock" size="sm" />
                      <span>{t("adminUsers.joined", { date: date(u.createdAt) })}</span>
                    </li>
                  </ul>
                  {actionable || (u.locked && u.status !== "deleted") ? (
                    <div className="admin-card-actions">
                      {actionable ? (
                        u.status === "suspended" ? (
                          <button type="button" className="btn btn-secondary" aria-label={t("adminUsers.unsuspendFor", { username: u.username })} onClick={() => open("unsuspend", u)}>
                            {t("adminUsers.unsuspend")}
                          </button>
                        ) : (
                          <button type="button" className="btn btn-danger-outline" aria-label={t("adminUsers.suspendFor", { username: u.username })} onClick={() => open("suspend", u)}>
                            <Icon name="ban" />
                            <span>{t("adminUsers.suspend")}</span>
                          </button>
                        )
                      ) : null}
                      {u.locked ? (
                        <button type="button" className="btn btn-secondary" aria-label={t("adminUsers.unlockFor", { username: u.username })} onClick={() => open("unlock", u)}>
                          <Icon name="lock" />
                          <span>{t("adminUsers.unlock")}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <LoadMore list={list} />
        </section>
      ) : null}

      {pending ? (
        <ConfirmDialog
          tone={pending.action === "suspend" ? "danger" : "primary"}
          title={t(`adminUsers.${pending.action}Sheet.title`, { username: pending.user.username })}
          body={t(`adminUsers.${pending.action}Sheet.body`)}
          confirmLabel={t(`adminUsers.${pending.action}Sheet.confirm`)}
          busy={busy}
          error={sheetError}
          onClose={() => (busy ? undefined : setPending(null))}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </>
  );
}
