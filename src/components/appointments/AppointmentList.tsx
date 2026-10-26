"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Cat } from "@/components/brand";
import { Icon } from "@/components/icons/Icon";
import { withNames } from "@/components/Name";
import type { AppointmentDto } from "@/lib/data/serializers/appointments";
import { APPOINTMENT_MAX_ACTIVE_PER_GROUP } from "@/lib/shared/limits";
import { callApiFull } from "./api";
import { AppointmentRow } from "./AppointmentRow";
import { CreateAppointmentButton } from "./CreateAppointmentButton";

export type ListTab = "upcoming" | "past";

interface TabData {
  items: AppointmentDto[];
  next: string | null;
  status: "ready" | "loading" | "error";
  moreError: boolean;
  moreBusy: boolean;
}

export interface AppointmentListProps {
  groupId: string;
  groupName: string;
  memberCount: number;
  tz: string;
  userId: string;
  nowMs: number;
  initial: { appointments: AppointmentDto[]; nextCursor: string | null };
}

/** ใกล้เต็ม: ใช้ไปตั้งแต่เท่านี้ของเพดาน (เตือนเฉพาะเมื่อโหลดครบทุกหน้า — นับจากที่เห็นเป็นขอบล่างที่ถูกต้อง) */
export const LIMIT_NEAR_AT = 90;

/** รายการนัดของกลุ่ม (X62, W23): กำลังจะถึง | ที่ผ่านมา · cursor load-more · ยกเลิกแล้วอยู่ในรายการ (ขีดฆ่า + ป้าย) */
export function AppointmentList({ groupId, groupName, memberCount, tz, userId, nowMs, initial }: AppointmentListProps) {
  const t = useTranslations();
  const [tab, setTab] = useState<ListTab>("upcoming");
  const [data, setData] = useState<Record<ListTab, TabData | null>>({
    upcoming: { items: initial.appointments, next: initial.nextCursor, status: "ready", moreError: false, moreBusy: false },
    past: null,
  });

  const cur = data[tab];

  async function load(which: ListTab, cursor: string | null) {
    const append = cursor !== null;
    setData((d) => ({
      ...d,
      [which]: append ? { ...d[which]!, moreBusy: true, moreError: false } : { items: [], next: null, status: "loading", moreError: false, moreBusy: false },
    }));
    const q = new URLSearchParams({ scope: which, limit: "20", ...(cursor ? { cursor } : {}) });
    const res = await callApiFull<{ appointments: AppointmentDto[]; nextCursor: string | null }>(`/api/groups/${groupId}/appointments?${q}`);
    setData((d) => {
      const prev = d[which];
      if (!res.ok) return { ...d, [which]: append ? { ...prev!, moreBusy: false, moreError: true } : { items: [], next: null, status: "error", moreError: false, moreBusy: false } };
      const seen = new Set(append ? prev!.items.map((x) => x.id) : []);
      const fresh = res.data.appointments.filter((x) => !seen.has(x.id));
      return { ...d, [which]: { items: append ? [...prev!.items, ...fresh] : fresh, next: res.data.nextCursor, status: "ready", moreError: false, moreBusy: false } };
    });
  }

  function choose(next: ListTab) {
    if (next === tab) return;
    setTab(next);
    if (data[next] === null) void load(next, null);
  }

  const activeCount = data.upcoming ? data.upcoming.items.filter((a) => a.status !== "cancelled").length : 0;
  const allLoaded = data.upcoming !== null && data.upcoming.next === null;
  const showCount = tab === "upcoming" && cur?.status === "ready" && allLoaded;

  return (
    <>
      <header className="topbar">
        <Link className="icon-btn" href={`/groups/${groupId}`} aria-label={t("group.back")} data-testid="appt-list-back">
          <Icon name="chevron-left" />
        </Link>
        <h1 className="title" style={{ fontSize: "var(--text-lg)" }}>
          {t("appointments.list.title")}
        </h1>
      </header>
      <main className="main appt-main" id="main" style={{ display: "block" }} data-testid="appt-list" data-tab={tab}>
        <div className="appt-list-top">
          <p className="muted small" style={{ margin: 0 }}>
            {withNames((n) => t("appointments.form.inGroup", { group: n.group }), { group: groupName })}
          </p>
          <CreateAppointmentButton groupId={groupId} groupName={groupName} memberCount={memberCount} tz={tz} userId={userId} className="btn btn-primary btn-block" testId="appt-list-create" />
          <div className="segmented cols-2" role="group" aria-label={t("appointments.list.tabsLabel")}>
            <button type="button" aria-pressed={tab === "upcoming"} data-testid="appt-tab-upcoming" onClick={() => choose("upcoming")}>
              {t("appointments.list.upcoming")}
            </button>
            <button type="button" aria-pressed={tab === "past"} data-testid="appt-tab-past" onClick={() => choose("past")}>
              {t("appointments.list.past")}
            </button>
          </div>
          {showCount ? (
            <p className="appt-count-note" role="status" data-testid="appt-list-count">
              <Icon name="info" size="sm" />
              <span>{t("appointments.list.count", { count: activeCount })}</span>
            </p>
          ) : null}
        </div>

        {tab === "upcoming" && allLoaded && activeCount >= LIMIT_NEAR_AT ? (
          <p className="appt-count-note" data-testid="appt-list-limit-near">
            <Icon name="triangle-alert" size="sm" />
            <span>{t("appointments.list.limitNear", { count: activeCount, max: APPOINTMENT_MAX_ACTIVE_PER_GROUP })}</span>
          </p>
        ) : null}

        {cur === null || cur.status === "loading" ? (
          <div aria-busy="true">
            <div className="skeleton" style={{ height: "calc(var(--space-7) * 2)", marginBottom: "var(--space-2)" }} />
            <div className="skeleton" style={{ height: "calc(var(--space-7) * 2)" }} />
            <p className="loading-note" role="status">
              <Icon name="refresh-cw" size="sm" />
              <span>{t("appointments.list.loading")}</span>
            </p>
          </div>
        ) : cur.status === "error" ? (
          <>
            <div className="alert" role="alert" data-testid="appt-list-error">
              <Icon name="circle-alert" />
              <div>
                <b>{t("appointments.list.error.title")}</b>
                <span>{t("appointments.list.error.body")}</span>
              </div>
            </div>
            <button type="button" className="btn btn-secondary" style={{ marginTop: "var(--space-3)" }} data-testid="appt-list-retry" onClick={() => void load(tab, null)}>
              <Icon name="refresh-cw" />
              <span>{t("states.retry")}</span>
            </button>
          </>
        ) : cur.items.length === 0 ? (
          <div className="empty panel" data-testid="appt-list-empty">
            <Cat pose={tab === "upcoming" ? "calendar" : "sleep"} size="md" />
            <h2 className="h-section">{t(`appointments.list.empty.${tab}.title`)}</h2>
            <p className="muted">{t(`appointments.list.empty.${tab}.body`)}</p>
            {tab === "upcoming" ? (
              <Link className="btn btn-secondary" href={`/calendar?g=${groupId}&v=free`} data-testid="appt-list-free">
                {t("appointments.list.empty.upcoming.free")}
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <ul className="appt-rows is-bare" data-testid="appt-rows">
              {cur.items.map((a) => (
                <AppointmentRow key={a.id} a={a} nowMs={nowMs} />
              ))}
            </ul>
            {cur.next !== null ? (
              <div style={{ marginTop: "var(--space-3)", display: "grid", gap: "var(--space-2)" }}>
                {cur.moreError ? (
                  <p className="field-error" role="alert">
                    <Icon name="circle-alert" size="sm" />
                    <span>{t("appointments.list.error.title")}</span>
                  </p>
                ) : null}
                <button type="button" className="btn btn-secondary btn-block" disabled={cur.moreBusy} data-testid="appt-load-more" onClick={() => void load(tab, cur.next)}>
                  <Icon name={cur.moreBusy ? "refresh-cw" : "chevron-down"} className={cur.moreBusy ? "ov-spin" : undefined} />
                  <span>{cur.moreBusy ? t("states.loading") : t("appointments.list.loadMore")}</span>
                </button>
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
