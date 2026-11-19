"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import "@/components/groups/groups.css";
import { queryString } from "@/components/account/model";
import { Icon } from "@/components/icons/Icon";
import { Name, withNames } from "@/components/Name";
import { clock } from "@/lib/shared/clock";
import type { AdminGroupDto } from "@/lib/data/serializers/admin";
import { ADMIN_QUERY_MAX } from "@/lib/shared/limits";
import { AdminListState, LoadMore, SearchBox } from "./AdminParts";
import { RestoreGroupDialog } from "./RestoreGroupDialog";
import { PURGE_WARN_DAYS, purgeDaysLeft } from "./restore-model";
import { usePaged } from "./usePaged";

const STATUSES = ["active", "deleted", "all"] as const;
type Status = (typeof STATUSES)[number];

/** กลุ่มทั้งหมด (R5 §2 ข้อ 3–4) — ค้นชื่อ · กรองสถานะ · โหลดเพิ่ม · แตะการ์ด → รายละเอียด (เปิดแต่ละครั้งลง audit) */
export function AdminGroups() {
  const t = useTranslations();
  const format = useFormatter();
  const id = useId();
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [restoring, setRestoring] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const list = usePaged<AdminGroupDto, { groups: AdminGroupDto[]; nextCursor: string | null }>(
    `/api/admin/groups${queryString({ q: applied, status })}`,
    "cursor",
    (d) => ({ items: d.groups, nextCursor: d.nextCursor }),
  );

  function search(e: FormEvent) {
    e.preventDefault();
    setApplied(q.trim());
  }

  const now = clock.now();
  const date = (ms: number) => format.dateTime(ms, { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <SearchBox
        id={`${id}-q`}
        label={t("adminGroups.searchLabel")}
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
      <div className="setting">
        <span className="setting-label" id={`${id}-s`}>
          {t("adminGroups.filter")}
        </span>
        <div className="segmented" role="group" aria-labelledby={`${id}-s`}>
          {STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {t(`adminGroups.status.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {toast ? (
        <div className="alert alert-free toast" role="status" data-testid="admin-groups-toast">
          <Icon name="circle-check" />
          <div>{toast}</div>
        </div>
      ) : null}

      <AdminListState list={list} emptyTitle={t("adminGroups.empty.title")} emptyBody={t("adminGroups.empty.body")} />

      {list.status === "ready" && list.items.length > 0 ? (
        <>
          <ul className="admin-cards" data-testid="admin-groups">
            {list.items.map((g) => {
              const daysLeft = g.deletedAt !== null ? purgeDaysLeft(g.purgeAt, now) : null;
              return (
              <li key={g.id}>
                <Link
                  className="admin-card admin-card-link"
                  href={`/admin/groups/${g.id}`}
                  aria-label={t("adminGroups.openAria", { group: g.name })}
                  data-testid="admin-group"
                  data-deleted={g.deletedAt !== null ? "true" : "false"}
                >
                  <div className="admin-card-top">
                    <div className="admin-card-name">
                      <span className="admin-card-title">
                        <Name>{g.name}</Name>
                      </span>
                      <span className="admin-card-sub">
                        {g.adminUsername
                          ? withNames((n) => t("adminGroups.admin", { username: n.username }), { username: g.adminUsername })
                          : t("adminGroups.noAdmin")}
                      </span>
                    </div>
                    {g.deletedAt !== null ? <span className="tag tag-bad">{t("adminGroups.status.deleted")}</span> : null}
                    <Icon name="chevron-right" />
                  </div>
                  <ul className="admin-facts">
                    <li>
                      <Icon name="users" size="sm" />
                      <span>{t("adminGroups.members", { count: g.memberCount })}</span>
                    </li>
                    <li>
                      <Icon name="clock" size="sm" />
                      <span>{g.deletedAt !== null ? t("adminGroups.deletedAt", { date: date(g.deletedAt) }) : t("adminGroups.created", { date: date(g.createdAt) })}</span>
                    </li>
                    {daysLeft !== null ? (
                      <li className={daysLeft <= PURGE_WARN_DAYS ? "is-warn" : undefined} data-testid="admin-group-purge" data-days={daysLeft}>
                        <Icon name="clock" size="sm" />
                        <span>{t("adminGroups.purgeIn", { days: daysLeft })}</span>
                      </li>
                    ) : null}
                  </ul>
                </Link>
                {/* ปุ่มอยู่นอก <a> (ห้ามซ้อนปุ่มในลิงก์) */}
                {g.deletedAt !== null && g.restorable ? (
                  <div className="admin-restore-row">
                    <button
                      type="button"
                      className="btn btn-secondary btn-block"
                      aria-label={t("adminGroups.restoreAria", { group: g.name })}
                      data-testid="admin-group-restore"
                      onClick={() => {
                        setToast(null);
                        setRestoring({ id: g.id, name: g.name });
                      }}
                    >
                      <Icon name="rotate-ccw" />
                      <span>{t("adminGroups.restore")}</span>
                    </button>
                  </div>
                ) : null}
              </li>
              );
            })}
          </ul>
          <LoadMore list={list} />
        </>
      ) : null}

      {restoring ? (
        <RestoreGroupDialog
          group={restoring}
          onClose={() => setRestoring(null)}
          onDone={(r) => {
            list.reload();
            if (r.notice === "done") {
              setToast(t("adminGroup.restore.done", { group: restoring.name }));
              setRestoring(null);
            }
          }}
        />
      ) : null}
    </>
  );
}
