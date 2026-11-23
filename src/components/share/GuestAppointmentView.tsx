"use client";

import "@/components/groups/groups.css";
import "@/components/calendar/calendar-view.css";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AddToCalendarSheet } from "@/components/appointments/AddToCalendarSheet";
import { BackButton, Band } from "@/components/appointments/AppointmentDetail";
import { callApiFull } from "@/components/appointments/api";
import { actionFailureRef, appointmentWhen, apptPhase, coordsText, rsvpConfirmKind, type Rsvp } from "@/components/appointments/model";
import { RsvpConfirm } from "@/components/appointments/RsvpConfirm";
import { ANSWER_ICON, RsvpControl } from "@/components/appointments/RsvpControl";
import { ConfirmDialog } from "@/components/groups/ConfirmDialog";
import { FlashNotice } from "@/components/groups/Notice";
import { setFlash } from "@/components/groups/flash";
import { Icon } from "@/components/icons/Icon";
import { Name, withNames } from "@/components/Name";
import { MapAppLinks, OpenInMaps } from "@/components/places/MapAppLinks";
import { mapOpenLink } from "@/components/places/map-model";
import { signalNavStart } from "@/components/shell/nav-start";
import type { CalendarLocale } from "@/lib/calendar";
import type { GuestAppointmentDto } from "@/lib/data/serializers/share";
import { applyGuestAnswer, guestRsvpClosed } from "./model";

export interface GuestAppointmentViewProps {
  initial: GuestAppointmentDto;
  /** epoch ms ฝั่งเซิร์ฟเวอร์ ณ ตอน render (ให้ hydrate ตรงกัน) */
  nowMs: number;
  appOrigin: string;
}

/**
 * หน้านัดมุมมองแขก (UX R18_SHARE_FLOW §5): การ์ดนัด + RSVP + ตัวเลขรวม (ไม่มีรายชื่อ) + .ics + ออกจากนัด
 * ข้อมูลที่แขกต้องไม่เห็นไม่ได้ถูกส่งมาจากเซิร์ฟเวอร์เลย (GuestAppointmentDto) — UI แค่ไม่มีที่ให้แสดง
 * ไม่มีลิงก์ไปหน้ากลุ่ม ไม่มีปุ่มแก้/ยกเลิก/ชวนต่อ · ชื่อกลุ่มเป็นข้อความล้วน
 */
export function GuestAppointmentView({ initial, nowMs, appOrigin }: GuestAppointmentViewProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const router = useRouter();
  const uid = useId();
  const [a, setA] = useState<GuestAppointmentDto>(initial);
  const [saving, setSaving] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Rsvp | null>(null);
  const [confirm, setConfirm] = useState<{ direction: "to" | "from"; prev: Rsvp | null; next: Rsvp } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const phase = apptPhase(a, nowMs);
  const cancelled = a.status === "cancelled";
  const closed = guestRsvpClosed(a);
  const whenRef = appointmentWhen(a, locale);
  const hasPlace = a.placeName !== null || a.lat !== null || a.mapUrl !== null;
  const placeName = a.placeName ?? t("places.selected.defaultName");
  const target = { placeName: a.placeName, lat: a.lat, lng: a.lng, mapUrl: a.mapUrl };
  const guestApi = `/api/appointments/${encodeURIComponent(a.id)}/guest`;

  async function pick(next: Rsvp) {
    if (saving || closed !== null || a.myRsvp === next) return;
    const before = a;
    setA(applyGuestAnswer(a, next));
    setSaving(true);
    setRsvpError(null);
    setSaved(null);
    const res = await callApiFull<{ appointment: GuestAppointmentDto }>(`${guestApi}/rsvp`, { method: "PUT", body: { response: next } });
    setSaving(false);
    if (res.ok) {
      setA(res.data.appointment);
      setSaved(next);
      return;
    }
    let restored: GuestAppointmentDto = before;
    if (res.kind === "api") {
      if (res.error.code === "APPOINTMENT_CANCELLED") restored = { ...before, status: "cancelled" };
      else if (res.error.code === "APPOINTMENT_PAST") restored = { ...before, isPast: true };
      else if (res.error.code === "NOT_FOUND") router.refresh(); // ถูกนำออก/ออกจากนัดแล้ว → หน้า "ไม่พบนัดนี้"
    }
    const fr = actionFailureRef(res, "appointments.rsvp.error");
    setRsvpError(t(fr.key, fr.values));
    setA(restored);
  }

  function onPick(next: Rsvp) {
    if (saving || closed !== null || a.myRsvp === next) return;
    const direction = rsvpConfirmKind(a.myRsvp, next);
    if (direction === null) {
      void pick(next);
      return;
    }
    setRsvpError(null);
    setConfirm({ direction, prev: a.myRsvp, next });
  }

  async function onConfirm() {
    if (!confirm || confirmBusy) return;
    setConfirmBusy(true);
    await pick(confirm.next);
    setConfirmBusy(false);
    setConfirm(null);
  }

  async function leave() {
    if (leaveBusy) return;
    setLeaveBusy(true);
    setLeaveError(null);
    const res = await callApiFull<{ left: true }>(guestApi, { method: "DELETE" });
    if (res.ok) {
      setFlash({ key: "guest.leave.done", values: {} });
      signalNavStart("/");
      router.replace("/");
      router.refresh();
      return; // ค้างสถานะ busy จนกว่าหน้าจะเปลี่ยน
    }
    setLeaveBusy(false);
    const fr = actionFailureRef(res, "guest.leave.error");
    setLeaveError(t(fr.key, fr.values));
  }

  return (
    <>
      <header className="topbar">
        <BackButton label={t("appointments.detail.back")} />
        <h1 className="title" style={{ fontSize: "var(--text-lg)" }}>
          {t("appointments.detail.title")}
        </h1>
      </header>

      <main className="main appt-main" id="main" data-testid="guest-detail" data-status={a.status} data-phase={phase}>
        <div className="appt-wide">
          <FlashNotice />
        </div>

        <div className="guest-banner appt-wide" role="status" data-testid="guest-banner">
          <Icon name="user" />
          <p>{a.invitedBy ? withNames((n) => t("guest.banner", { name: n.name }), { name: a.invitedBy }) : t("guest.badge")}</p>
        </div>

        <article className="appt-card" aria-labelledby={`${uid}-t`}>
          <Band a={a} phase={phase} locale={locale} />
          <div className="appt-body">
            <h2 className={cancelled ? "appt-title is-cancelled" : "appt-title"} id={`${uid}-t`} data-testid="appt-detail-title">
              <Name>{a.title}</Name> <span className="tag tag-wait" data-testid="guest-badge">{t("guest.badge")}</span>
            </h2>
            {a.myRsvp === "going" && a.myConflicts.length > 0 && !cancelled && !a.isPast ? (
              <p className="appt-conflict">
                <span className="tag tag-warn" data-testid="appt-conflict-badge">
                  <Icon name="triangle-alert" size="sm" />
                  <span>{t("appointments.conflictBadge")}</span>
                </span>
              </p>
            ) : null}
            <ul className="appt-facts">
              <li className="appt-fact">
                <Icon name="clock" />
                <span className="num nowrap" data-testid="appt-when">
                  {t(whenRef.key, whenRef.values)}
                </span>
              </li>
              <li className="appt-fact">
                <Icon name="users" />
                {/* ข้อความล้วน ไม่เป็นลิงก์ — แขกเข้าหน้ากลุ่มไม่ได้ */}
                <span data-testid="appt-group-text">{withNames((n) => t("guest.fromGroup", { group: n.group }), { group: a.groupName })}</span>
              </li>
            </ul>
          </div>
        </article>

        {hasPlace ? (
          <section className="appt-section" aria-labelledby={`${uid}-pl`} data-testid="appt-place">
            <h2 id={`${uid}-pl`}>{t("appointments.detail.place")}</h2>
            <p className="appt-place-name" data-testid="appt-place-name">
              <Name>{placeName}</Name>
            </p>
            {coordsText(a) !== null ? <p className="appt-place-sub num">{t("places.selected.coords", { lat: Math.round(a.lat! * 1e5) / 1e5, lng: Math.round(a.lng! * 1e5) / 1e5 })}</p> : null}
            {mapOpenLink(target) !== null ? <OpenInMaps target={target} name={placeName} /> : a.placeName ? <MapAppLinks name={a.placeName} variant="find" /> : null}
          </section>
        ) : null}

        {a.description ? (
          <section className="appt-section" aria-labelledby={`${uid}-ds`}>
            <h2 id={`${uid}-ds`}>{t("appointments.detail.description")}</h2>
            <p className="appt-desc" data-testid="appt-detail-description">
              {a.description}
            </p>
          </section>
        ) : null}

        {!cancelled ? (
          <section className="appt-section" aria-labelledby={`${uid}-rv`} data-testid="appt-rsvp-section">
            <h2 id={`${uid}-rv`}>{t("appointments.rsvp.question")}</h2>
            <RsvpControl value={a.myRsvp} closed={closed} saving={saving} error={rsvpError} saved={saved} labelledBy={`${uid}-rv`} onPick={onPick} goingHint={t("guest.goingHint")} />
            {a.myRsvp === "going" && !saving && !a.isPast ? (
              <button type="button" className="btn btn-secondary appt-cal-add" data-testid="appt-add-calendar" onClick={() => setCalOpen(true)}>
                <Icon name="calendar-plus" />
                <span>{t("appointments.calendar.add")}</span>
              </button>
            ) : null}
          </section>
        ) : null}

        <section className="appt-section" aria-labelledby={`${uid}-ct`} data-testid="guest-counts-section">
          <h2 id={`${uid}-ct`}>{t("guest.counts.title")}</h2>
          <p className="rsvp-counts guest-counts" data-testid="guest-counts">
            <span className="rsvp-count" data-answer="going" data-testid="guest-count-going">
              <Icon name={ANSWER_ICON.going} size="sm" />
              {t("appointments.rsvp.summary.going", { count: a.counts.going })}
            </span>
            <span className="rsvp-count" data-answer="maybe" data-testid="guest-count-maybe">
              <Icon name={ANSWER_ICON.maybe} size="sm" />
              {t("appointments.rsvp.summary.maybe", { count: a.counts.maybe })}
            </span>
          </p>
        </section>

        <p className="guest-limits appt-wide" data-testid="guest-limits">
          <Icon name="lock" size="sm" />
          <span>{t("guest.limits")}</span>
        </p>

        {a.permissions.canLeave ? (
          <div className="guest-leave appt-wide">
            <button
              type="button"
              className="share-danger-text"
              onClick={() => {
                setLeaveError(null);
                setLeaving(true);
              }}
              data-testid="guest-leave"
            >
              {t("guest.leave.cta")}
            </button>
          </div>
        ) : null}
      </main>

      {calOpen ? (
        <AddToCalendarSheet appointment={a} appOrigin={appOrigin} icsHref={`${guestApi}/calendar.ics`} onClose={() => setCalOpen(false)} />
      ) : null}

      {confirm ? (
        <RsvpConfirm
          direction={confirm.direction}
          prev={confirm.prev}
          next={confirm.next}
          conflicts={a.myConflicts}
          truncated={a.myConflictsTruncated}
          groupId=""
          saving={confirmBusy}
          onConfirm={() => void onConfirm()}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {leaving ? (
        <ConfirmDialog
          title={t("guest.leave.title")}
          body={t("guest.leave.body")}
          confirmLabel={t("guest.leave.confirm")}
          onConfirm={() => void leave()}
          onClose={() => {
            if (!leaveBusy) setLeaving(false);
          }}
          busy={leaveBusy}
          error={leaveError}
        />
      ) : null}
    </>
  );
}
