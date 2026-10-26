"use client";

import "@/components/groups/groups.css";
import "@/components/calendar/calendar-view.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MemberAvatar } from "@/components/groups/MemberAvatar";
import { Icon } from "@/components/icons/Icon";
import { Name, withNames } from "@/components/Name";
import { OpenInMaps, PlaceMap } from "@/components/places/PlaceMap";
import { hasCoords } from "@/components/places/map-model";
import { Sheet } from "@/components/shell/Sheet";
import { format, type CalendarLocale } from "@/lib/calendar";
import type { AppointmentDetailDto, PersonDto } from "@/lib/data/serializers/appointments";
import { callApiFull } from "./api";
import { AppointmentFormSheet } from "./AppointmentFormSheet";
import { ANSWER_ICON, RsvpControl } from "./RsvpControl";
import { actionFailureRef, appointmentWhen, applyRsvp, apptPhase, coordsText, rsvpClosedReason, type Rsvp } from "./model";

/** ยกเลิกนัดตอนนี้ยังไม่ส่งแจ้งเตือน (ADR 0007 v1 มีแค่ appointment.created) — ข้อความใน dialog จึงบอกว่า "ไม่แจ้ง" */
export const CANCEL_NOTIFIES = false;

export interface AppointmentDetailProps {
  initial: AppointmentDetailDto;
  me: PersonDto;
  /** epoch ms ฝั่งเซิร์ฟเวอร์ ณ ตอน render (ให้ hydrate ตรงกัน) */
  nowMs: number;
}

/** หน้ารายละเอียดนัด (X60) — ข้อมูลโหลดฝั่งเซิร์ฟเวอร์ · RSVP optimistic + rollback · ปุ่มแก้/ยกเลิกตามสิทธิ์ที่เซิร์ฟเวอร์ส่ง (ซ่อนปุ่มไม่ใช่การป้องกัน) */
export function AppointmentDetail({ initial, me, nowMs }: AppointmentDetailProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const router = useRouter();
  const uid = useId();
  const [a, setA] = useState<AppointmentDetailDto>(initial);
  const [saving, setSaving] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Rsvp | null>(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  const phase = apptPhase(a, nowMs);
  const cancelled = a.status === "cancelled";
  const live = phase === "upcoming" || phase === "ongoing"; // ใช้แค่เลือกข้อความบอกสิทธิ์ ไม่ใช้ตัดสินว่าปุ่มโผล่หรือไม่
  // สิทธิ์ตามที่เซิร์ฟเวอร์ส่งเท่านั้น (ไม่เช็กเวลาฝั่งไคลเอนต์) — ยกเว้นสถานะ "ยกเลิกแล้ว" ที่ไคลเอนต์เพิ่งตั้งเองหลังได้ APPOINTMENT_CANCELLED
  const canEdit = a.permissions.canEdit && !cancelled;
  const canCancel = a.permissions.canCancel && !cancelled;
  const closed = rsvpClosedReason(a);
  const when = appointmentWhen(a, locale);
  const whenText = t(when.key, when.values);
  const hasPlace = a.placeName !== null || a.lat !== null || a.mapUrl !== null;
  const placeName = a.placeName ?? t("places.selected.defaultName");
  const dateTime = (ms: number) => `${format(ms, { locale, style: "date-medium", tz: a.tz })} ${format(ms, { locale, style: "time", tz: a.tz })}`;

  async function pick(next: Rsvp) {
    if (saving || closed !== null || a.rsvp.mine === next) return;
    const before = a;
    setA({ ...a, rsvp: applyRsvp(a.rsvp, next, me) });
    setSaving(true);
    setRsvpError(null);
    setSaved(null);
    const res = await callApiFull<{ appointment: AppointmentDetailDto }>(`/api/appointments/${a.id}/rsvp`, { method: "PUT", body: { response: next } });
    setSaving(false);
    if (res.ok) {
      setA(res.data.appointment);
      setSaved(next);
      return;
    }
    // rollback: คำตอบเดิมยังอยู่
    let restored: AppointmentDetailDto = before;
    if (res.kind === "api") {
      if (res.error.code === "APPOINTMENT_CANCELLED") restored = { ...before, status: "cancelled" };
      else if (res.error.code === "APPOINTMENT_PAST") restored = { ...before, isPast: true };
    }
    const fr = actionFailureRef(res, "appointments.rsvp.error");
    setRsvpError(t(fr.key, fr.values));
    setA(restored);
  }

  async function doCancel() {
    if (cancelBusy) return;
    setCancelBusy(true);
    setCancelError(null);
    const res = await callApiFull<{ appointment: AppointmentDetailDto }>(`/api/appointments/${a.id}/cancel`, { method: "POST", body: {} });
    setCancelBusy(false);
    if (res.ok) {
      setA(res.data.appointment);
      setCancelling(false);
      return;
    }
    if (res.kind === "api" && res.error.code === "APPOINTMENT_CANCELLED") {
      // ถูกยกเลิกไปแล้ว (เครื่องอื่น) — ถือว่าสำเร็จ: รีเฟรชข้อมูลจริง
      setCancelling(false);
      router.refresh();
      setA({ ...a, status: "cancelled" });
      return;
    }
    const fr = actionFailureRef(res, "appointments.cancel.error");
    setCancelError(t(fr.key, fr.values));
  }

  const c = a.rsvp.counts;
  const answerGroups: { key: Rsvp; list: PersonDto[]; label: string }[] = [
    { key: "going", list: a.rsvp.members.going, label: "appointments.rsvp.list.going" },
    { key: "maybe", list: a.rsvp.members.maybe, label: "appointments.rsvp.list.maybe" },
    { key: "not_going", list: a.rsvp.members.not_going, label: "appointments.rsvp.list.notGoing" },
  ];
  const answered = c.going + c.maybe + c.not_going;

  return (
    <>
      <header className="topbar">
        <BackButton label={t("appointments.detail.back")} />
        <h1 className="title" style={{ fontSize: "var(--text-lg)" }}>
          {t("appointments.detail.title")}
        </h1>
        {canEdit ? (
          <button type="button" className="icon-btn" aria-label={t("appointments.detail.editAria", { title: a.title })} data-testid="appt-edit-top" onClick={() => setEditing(true)}>
            <Icon name="pencil" />
          </button>
        ) : null}
      </header>

      <main className="main appt-main" id="main" data-testid="appt-detail" data-status={a.status} data-phase={phase}>
        {cancelled ? (
          <div className="appt-banner appt-wide" role="status" data-testid="appt-cancelled-banner">
            <Icon name="ban" />
            <div>
              <b>
                {a.cancelledBy
                  ? withNames((n) => t("appointments.cancelled.banner", { name: n.name, when: a.cancelledAt !== null ? dateTime(a.cancelledAt) : "" }), { name: a.cancelledBy.displayName })
                  : t("appointments.cancelled.bannerGone", { when: a.cancelledAt !== null ? dateTime(a.cancelledAt) : "" })}
              </b>
              <span>{t("appointments.cancelled.hint")}</span>
            </div>
          </div>
        ) : null}

        <article className="appt-card" aria-labelledby={`${uid}-t`}>
          <Band a={a} phase={phase} locale={locale} />
          <div className="appt-body">
            <h2 className={cancelled ? "appt-title is-cancelled" : "appt-title"} id={`${uid}-t`} data-testid="appt-detail-title">
              <Name>{a.title}</Name>
            </h2>
            <ul className="appt-facts">
              <li className="appt-fact">
                <Icon name="clock" />
                <span className="num" data-testid="appt-when">
                  {whenText}
                </span>
              </li>
              <li className="appt-fact">
                <Icon name="users" />
                <Link href={`/groups/${a.groupId}`} aria-label={t("appointments.detail.openGroupAria", { group: a.groupName })} data-testid="appt-group-link">
                  <Name>{a.groupName}</Name>
                </Link>
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
            {coordsText(a) !== null ? <p className="appt-place-sub num">{t("places.selected.coords", { lat: Math.round(a.lat! * 1e5) / 1e5, lng: Math.round(a.lng! * 1e5) / 1e5 })}</p> : a.mapUrl ? <p className="appt-place-sub">{t("places.selected.linkOnly", { host: hostOf(a.mapUrl) })}</p> : null}
            {hasCoords(a) ? <PlaceMap name={placeName} lat={a.lat!} lng={a.lng!} /> : null}
            <OpenInMaps target={{ placeName: a.placeName, lat: a.lat, lng: a.lng, mapUrl: a.mapUrl }} name={placeName} />
          </section>
        ) : null}

        {a.description ? (
          <section className="appt-section" aria-labelledby={`${uid}-ds`}>
            <h2 id={`${uid}-ds`}>{t("appointments.detail.description")}</h2>
            {/* ข้อความล้วน — ไม่ render HTML/ลิงก์ (React escape) */}
            <p className="appt-desc" data-testid="appt-detail-description">
              {a.description}
            </p>
          </section>
        ) : null}

        {!cancelled ? (
          <section className="appt-section" aria-labelledby={`${uid}-rv`} data-testid="appt-rsvp-section">
            <h2 id={`${uid}-rv`}>{t("appointments.rsvp.question")}</h2>
            <RsvpControl value={a.rsvp.mine} closed={closed} saving={saving} error={rsvpError} saved={saved} labelledBy={`${uid}-rv`} onPick={(r) => void pick(r)} />
            <div className="appt-who" style={{ borderTop: 0, paddingTop: 0 }}>
              <p className="rsvp-counts" data-testid="appt-rsvp-counts">
                <Count answer="going" label={t("appointments.rsvp.summary.going", { count: c.going })} />
                <Count answer="maybe" label={t("appointments.rsvp.summary.maybe", { count: c.maybe })} />
                <Count answer="not_going" label={t("appointments.rsvp.summary.notGoing", { count: c.not_going })} />
                <Count answer="none" label={t("appointments.rsvp.summary.noReply", { count: c.noResponse })} />
              </p>
            </div>
          </section>
        ) : null}

        <section className="appt-section" aria-labelledby={`${uid}-wh`} data-testid="appt-who">
          <h2 id={`${uid}-wh`}>{t("appointments.rsvp.list.title")}</h2>
          {answered === 0 ? <p className="muted" data-testid="appt-who-nobody">{t(cancelled || a.isPast ? "appointments.rsvp.list.nobodyClosed" : "appointments.rsvp.list.nobody")}</p> : null}
          <div className="rsvp-groups">
            {answerGroups.map((g) =>
              g.list.length === 0 ? null : (
                <div className="rsvp-group" data-answer={g.key} key={g.key} data-testid={`appt-who-${g.key}`}>
                  <h3>
                    <Icon name={ANSWER_ICON[g.key]} size="sm" />
                    {t(g.label, { count: g.list.length })}
                  </h3>
                  <ul className="rsvp-people">
                    {g.list.map((p) => (
                      <li key={p.userId}>
                        <MemberAvatar displayName={p.displayName} colorIndex={p.colorIndex} size="sm" />
                        <span className="nm">
                          <Name>{p.displayName}</Name>
                          {p.userId === me.userId ? <span className="you">({t("group.members.you")})</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
            {c.noResponse > 0 ? (
              <div className="rsvp-group" data-answer="none" data-testid="appt-who-none">
                <h3>
                  <Icon name={ANSWER_ICON.none} size="sm" />
                  {t("appointments.rsvp.list.noReply", { count: c.noResponse })}
                </h3>
              </div>
            ) : null}
          </div>
        </section>

        {canEdit || canCancel ? (
          <section className="appt-section appt-wide" aria-labelledby={`${uid}-mg`} data-testid="appt-manage">
            <h2 id={`${uid}-mg`}>{t("appointments.detail.manage")}</h2>
            <div className="appt-actions">
              {canEdit ? (
                <button type="button" className="btn btn-secondary" data-testid="appt-edit" onClick={() => setEditing(true)}>
                  <Icon name="pencil" />
                  <span>{t("appointments.detail.edit")}</span>
                </button>
              ) : null}
              {canCancel ? (
                <button type="button" className="btn btn-secondary" style={{ color: "var(--danger-ink)", borderColor: "var(--danger-ink)" }} data-testid="appt-cancel" onClick={() => { setCancelError(null); setCancelling(true); }}>
                  <Icon name="ban" />
                  <span>{t("appointments.detail.cancelAction")}</span>
                </button>
              ) : null}
            </div>
          </section>
        ) : live ? (
          <p className="appt-created appt-wide" style={{ display: "flex", gap: "var(--space-2)" }} data-testid="appt-no-permission">
            <Icon name="lock" size="sm" />
            <span>{t("appointments.detail.noPermission")}</span>
          </p>
        ) : null}

        <p className="appt-created appt-wide" data-testid="appt-created-by">
          {a.createdBy
            ? withNames((n) => t("appointments.detail.createdBy", { name: n.name, date: format(a.createdAt, { locale, style: "date-medium", tz: a.tz }) }), { name: a.createdBy.displayName })
            : t("appointments.detail.createdByGone", { date: format(a.createdAt, { locale, style: "date-medium", tz: a.tz }) })}
        </p>
      </main>

      {editing ? (
        <AppointmentFormSheet
          mode="edit"
          edit={a}
          groupId={a.groupId}
          groupName={a.groupName}
          memberCount={0}
          tz={a.tz}
          userId={me.userId}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setA(next);
            setEditing(false);
          }}
          onGone={() => router.replace("/")}
        />
      ) : null}

      {cancelling ? (
        <Sheet
          alert
          title={t("appointments.cancel.title", { title: a.title })}
          onClose={() => !cancelBusy && setCancelling(false)}
          initialFocusRef={keepRef}
          footer={
            <>
              <button type="button" className="btn btn-danger btn-block" disabled={cancelBusy} data-testid="appt-cancel-confirm" onClick={() => void doCancel()}>
                {cancelBusy ? t("appointments.cancel.working") : t("appointments.cancel.confirm")}
              </button>
              <button ref={keepRef} type="button" className="btn btn-secondary btn-block" style={{ minHeight: "var(--tap-lg)" }} data-testid="appt-cancel-keep" onClick={() => setCancelling(false)}>
                {t("appointments.cancel.keep")}
              </button>
            </>
          }
        >
          <p>{t("appointments.cancel.body")}</p>
          <p className="muted small" style={{ marginTop: "var(--space-2)" }} data-testid="appt-cancel-notify">
            {t("appointments.cancel.notify", { notify: CANCEL_NOTIFIES ? "yes" : "no", count: Math.max(0, c.going + c.maybe + c.not_going + c.noResponse - 1) })}
          </p>
          {cancelError ? (
            <div className="alert sheet-error" role="alert" data-testid="appt-cancel-error">
              <Icon name="circle-alert" />
              <div>
                <span>{cancelError}</span>
              </div>
            </div>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}

function Count({ answer, label }: { answer: Rsvp | "none"; label: string }) {
  return (
    <span className="rsvp-count" data-answer={answer}>
      <Icon name={ANSWER_ICON[answer]} size="sm" />
      {label}
    </span>
  );
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

function Band({ a, phase, locale }: { a: AppointmentDetailDto; phase: ReturnType<typeof apptPhase>; locale: CalendarLocale }) {
  const t = useTranslations();
  // ICU ของ Node (server) กับเบราว์เซอร์อาจต่างกันเล็กน้อย (เช่น จุลภาคหลังวันในสัปดาห์ของ en) → ยอมรับความต่างของข้อความวันที่ตอน hydrate
  const date = <p className="appt-date" suppressHydrationWarning>{format(a.localDate, { locale, style: "date-full" })}</p>;
  if (phase !== "upcoming") {
    return (
      <div className={`appt-band is-${phase}`} data-testid="appt-band">
        <p className="appt-count">
          <span className="state">
            <Icon name={phase === "cancelled" ? "ban" : "clock"} />
            {t(`appointments.status.${phase}`)}
          </span>
        </p>
        {date}
      </div>
    );
  }
  const days = Math.max(0, a.daysUntil);
  return (
    <div className="appt-band" data-testid="appt-band">
      <p className="appt-count" aria-label={t("home.countdown.aria", { days })}>
        {days >= 2 ? (
          <>
            <span>{t("home.countdown.before", { days })}</span>
            <span className="num-big">{days}</span>
            <span>{t("home.countdown.after", { days })}</span>
          </>
        ) : (
          <span className="big">{t("home.countdown.before", { days })}</span>
        )}
      </p>
      {date}
    </div>
  );
}

function BackButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button type="button" className="icon-btn" aria-label={label} data-testid="appt-back" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}>
      <Icon name="chevron-left" />
    </button>
  );
}
