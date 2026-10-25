"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { EmptyState } from "@/components/shell/EmptyState";
import { Icon, type IconName } from "@/components/icons/Icon";
import { format, type CalendarLocale } from "@/lib/calendar";
import { fetchMyAppointments, putRsvp } from "./api";
import {
  HOME_LIMIT,
  RSVP_ANSWERS,
  countdownKind,
  dateBox,
  displayRsvp,
  isCurrentRequest,
  longDateLabel,
  maybeTruncated,
  placeView,
  rsvpErrorKey,
  rsvpReducer,
  shortDateLabel,
  splitHome,
  timeRange,
  type HomeAppointment,
  type RsvpAnswer,
  type RsvpState,
} from "./model";

export interface HomeViewProps {
  initial: { kind: "ready"; appointments: HomeAppointment[] } | { kind: "no-group" } | { kind: "error" };
  /** เวลาของเซิร์ฟเวอร์ตอนเรนเดอร์ — ใช้เรนเดอร์ครั้งแรก (hydration-safe: ห้ามอ่านนาฬิกาในเรนเดอร์) */
  initialNowMs: number;
}

type Status = "ready" | "loading" | "error";
const REFRESH_GAP_MS = 30_000;

const ANSWER_ICON: Record<RsvpAnswer | "none", IconName> = {
  going: "circle-check",
  maybe: "circle-help",
  not_going: "circle-x",
  none: "circle-dashed",
};

export function HomeView({ initial, initialNowMs }: HomeViewProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;

  const [status, setStatus] = useState<Status>(initial.kind === "error" ? "error" : "ready");
  const [items, setItems] = useState<HomeAppointment[]>(initial.kind === "ready" ? initial.appointments : []);
  const [noGroup, setNoGroup] = useState(initial.kind === "no-group");
  const [nowMs, setNowMs] = useState(initialNowMs);
  const [rsvp, dispatch] = useReducer(rsvpReducer, {} as RsvpState);
  const [announce, setAnnounce] = useState("");

  const loadSeq = useRef(0);
  const rsvpSeq = useRef(0);
  const alive = useRef(true);
  const lastLoad = useRef(0);

  useEffect(() => {
    alive.current = true;
    lastLoad.current = Date.now();
    return () => {
      alive.current = false;
    };
  }, []);

  // นาฬิกาสำหรับ "กำลังจัดอยู่" — เริ่มหลัง mount
  useEffect(() => {
    const first = window.setTimeout(() => setNowMs(Date.now()), 0);
    const h = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(h);
    };
  }, []);

  /** โหลดรายการใหม่ · silent = รีเฟรชเงียบๆ ตอนกลับมาที่แท็บ (ล้มเหลวก็คงของเดิม) */
  const load = useCallback(async (silent: boolean) => {
    loadSeq.current += 1;
    const mine = loadSeq.current;
    lastLoad.current = Date.now();
    if (!silent) setStatus("loading");
    const r = await fetchMyAppointments();
    if (!isCurrentRequest(mine, loadSeq.current, alive.current)) return;
    if (!r.ok) {
      if (!silent) setStatus("error");
      return;
    }
    setItems(r.data.appointments);
    setNoGroup(false);
    setNowMs(Date.now());
    for (const a of r.data.appointments) dispatch({ type: "forget", id: a.id });
    setStatus("ready");
  }, []);

  useEffect(() => {
    const due = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= REFRESH_GAP_MS) void load(true);
    };
    window.addEventListener("focus", due);
    document.addEventListener("visibilitychange", due);
    return () => {
      window.removeEventListener("focus", due);
      document.removeEventListener("visibilitychange", due);
    };
  }, [load]);

  const choose = useCallback(
    async (a: HomeAppointment, choice: RsvpAnswer) => {
      const cur = rsvp[a.id];
      if (cur?.saving) return;
      if (displayRsvp(a, rsvp).mine === choice) return;
      rsvpSeq.current += 1;
      const seq = rsvpSeq.current;
      dispatch({ type: "choose", id: a.id, base: a.rsvp, choice, seq });
      const r = await putRsvp(a.id, choice);
      if (!alive.current) return;
      if (r.ok) {
        dispatch({ type: "saved", id: a.id, seq, summary: r.data });
        setItems((cur2) => cur2.map((x) => (x.id === a.id ? { ...x, rsvp: r.data } : x)));
        setAnnounce(t("appointments.rsvp.saved", { answer: t(`appointments.rsvp.answer.${choice}`) }));
      } else {
        const key = r.kind === "api" ? rsvpErrorKey(r.error.code) : "generic";
        dispatch({ type: "failed", id: a.id, seq, error: key });
        // นัดถูกยกเลิก/จบ/ไม่มีสิทธิ์แล้ว: โหลดรายการใหม่ให้ตรงความจริง
        if (key !== "generic") void load(true);
      }
    },
    [load, rsvp, t],
  );

  if (status === "loading") return <LoadingMain />;
  if (status === "error") {
    return (
      <main className="main home-main" id="main">
        <div className="alert" role="alert" style={{ marginTop: "var(--space-4)" }} data-testid="home-error">
          <Icon name="circle-alert" />
          <div>
            <b>{t("home.error.title")}</b>
            <span>{t("home.error.body")}</span>
          </div>
        </div>
        <button type="button" className="btn btn-secondary" style={{ marginTop: "var(--space-4)" }} onClick={() => void load(false)} data-testid="home-retry">
          <Icon name="refresh-cw" />
          <span>{t("states.retry")}</span>
        </button>
      </main>
    );
  }

  if (noGroup) {
    return (
      <main className="main home-main" id="main">
        <div data-testid="home-nogroup">
          <EmptyState
            pose="tea"
            headingLevel={1}
            title={t("empty.homeNoGroup.title")}
            body={t("empty.homeNoGroup.body")}
            cta={{ label: t("empty.homeNoGroup.cta"), href: "/groups" }}
            extra={
              <Link className="link-btn" href="/groups">
                {t("empty.homeNoGroup.joinCode")}
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  const { next, later } = splitHome(items);
  if (!next) {
    return (
      <main className="main home-main" id="main">
        <div data-testid="home-empty">
          <EmptyState
            pose="tea"
            headingLevel={1}
            title={t("empty.home.title")}
            body={t("empty.home.body")}
            cta={{ label: t("empty.home.cta"), href: "/calendar?v=free" }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="main home-main" id="main">
      <h1 className="h-section home-h">{t("home.nextUp")}</h1>
      <NextCard a={next} rsvp={rsvp} nowMs={nowMs} locale={locale} onChoose={choose} />
      {later.length > 0 ? (
        <section className="appt-list-card" aria-labelledby="home-later-h" data-testid="home-later">
          <div className="appt-list-head">
            <h2 className="h-section" id="home-later-h">
              {t("home.later")}
            </h2>
          </div>
          <ul className="appt-rows">
            {later.map((a) => (
              <li key={a.id}>
                <Row a={a} rsvp={rsvp} locale={locale} />
              </li>
            ))}
          </ul>
          {maybeTruncated(items.length, HOME_LIMIT) ? (
            <p className="appt-more-note home-more" data-testid="home-more-note">
              {t("home.moreNote", { count: HOME_LIMIT })}
            </p>
          ) : null}
        </section>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite" data-testid="home-live">
        {announce}
      </span>
    </main>
  );
}

function LoadingMain() {
  const t = useTranslations();
  return (
    <main className="main home-main" id="main" aria-busy="true" data-testid="home-loading">
      <div className="skeleton" style={{ height: "var(--space-5)", width: "40%", margin: "var(--space-3) 0" }} />
      <div className="skeleton" style={{ height: "calc(var(--space-7) * 5)", borderRadius: "var(--radius-lg)" }} />
      <p className="loading-note" role="status">
        <Icon name="refresh-cw" size="sm" />
        <span>{t("home.loading")}</span>
      </p>
      <div className="skeleton" style={{ height: "calc(var(--space-7) * 3)", marginTop: "var(--space-5)" }} />
    </main>
  );
}

/** ชื่อเดือนสั้นบนกล่องวัน (จากวันที่ท้องถิ่นของนัด) */
const monthOnly = (date: string, locale: CalendarLocale): string => format(date, { locale, style: "day-month" }).replace(/^\d+\s*/, "");

function WhenFact({ a, locale }: { a: HomeAppointment; locale: CalendarLocale }) {
  const t = useTranslations();
  const r = timeRange(a, locale);
  return <span className="num">{r.kind === "overnight" ? t("appointments.when.overnight", { start: r.start, end: r.end }) : r.text}</span>;
}

function NextCard({
  a,
  rsvp,
  nowMs,
  locale,
  onChoose,
}: {
  a: HomeAppointment;
  rsvp: RsvpState;
  nowMs: number;
  locale: CalendarLocale;
  onChoose: (a: HomeAppointment, c: RsvpAnswer) => Promise<void>;
}) {
  const t = useTranslations();
  const kind = countdownKind(a, nowMs);
  const days = Math.max(0, a.daysUntil);
  const place = placeView(a);
  const entry = rsvp[a.id];
  const summary = displayRsvp(a, rsvp);
  const { going, maybe, noResponse } = summary.counts;
  const saving = entry?.saving ?? null;
  const errorText = entry?.error ? (entry.error === "generic" ? t("appointments.rsvp.error") : t(entry.error)) : null;

  return (
    <article className="appt-card" aria-labelledby="home-next-t" data-testid="home-next-card" data-appt-id={a.id}>
      <div className={`appt-band${kind === "ongoing" ? " is-ongoing" : ""}`}>
        <p className="appt-count" data-testid="home-countdown" data-kind={kind}>
          {kind === "ongoing" ? (
            <span className="state">
              <Icon name="clock" />
              <span>{t("appointments.status.ongoing")}</span>
            </span>
          ) : kind === "today" || kind === "tomorrow" ? (
            <span className="big">{t("home.countdown.before", { days: kind === "today" ? 0 : 1 })}</span>
          ) : (
            <>
              <span aria-hidden="true">{t("home.countdown.before", { days })}</span>
              <span className="num-big" aria-hidden="true">
                {days}
              </span>
              <span aria-hidden="true">{t("home.countdown.after", { days })}</span>
              <span className="sr-only">{t("home.countdown.aria", { days })}</span>
            </>
          )}
        </p>
        <p className="appt-date">{longDateLabel(a, locale)}</p>
      </div>
      <div className="appt-body">
        <h2 className="appt-title" id="home-next-t">
          <bdi>{a.title}</bdi>
        </h2>
        <ul className="appt-facts">
          <li className="appt-fact">
            <Icon name="clock" />
            <WhenFact a={a} locale={locale} />
          </li>
          {place ? (
            <li className="appt-fact">
              <Icon name="map-pin" />
              <span className="appt-place">
                {place.linkOnly ? null : <bdi>{place.label}</bdi>}
                {place.href ? (
                  <a
                    className="appt-maplink"
                    href={place.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={
                      place.linkOnly
                        ? t("places.openLinkAria", { name: a.title, host: place.host ?? "" })
                        : t("places.openAria", { name: place.label })
                    }
                    data-testid="home-maplink"
                  >
                    <span>{place.linkOnly ? t("places.openLink", { host: place.host ?? "" }) : t("places.open")}</span>
                    <Icon name="external-link" size="sm" />
                  </a>
                ) : null}
              </span>
            </li>
          ) : null}
          <li className="appt-fact">
            <Icon name="users" />
            <span>
              <bdi>{a.groupName}</bdi>
            </span>
          </li>
        </ul>
        <div className="appt-who">
          <p className="rsvp-counts" data-testid="home-counts">
            <span className="rsvp-count" data-answer="going" data-testid="home-count-going">
              <Icon name="circle-check" size="sm" />
              <span>{t("appointments.rsvp.summary.going", { count: going })}</span>
            </span>
            {maybe > 0 ? (
              <span className="rsvp-count" data-answer="maybe">
                <Icon name="circle-help" size="sm" />
                <span>{t("appointments.rsvp.summary.maybe", { count: maybe })}</span>
              </span>
            ) : null}
            {noResponse > 0 ? (
              <span className="rsvp-count" data-answer="none">
                <Icon name="circle-dashed" size="sm" />
                <span>{t("appointments.rsvp.summary.noReply", { count: noResponse })}</span>
              </span>
            ) : null}
          </p>
        </div>
        <div className="rsvp">
          <p className="rsvp-label" id="home-rsvp-l">
            {t("appointments.rsvp.question")}
          </p>
          <div className={`segmented rsvp-choice${saving ? " is-saving" : ""}`} role="group" aria-labelledby="home-rsvp-l" aria-busy={saving !== null} data-testid="home-rsvp">
            {RSVP_ANSWERS.map((c) => (
              <button
                type="button"
                key={c}
                data-answer={c}
                data-testid={`home-rsvp-${c}`}
                aria-pressed={summary.mine === c}
                onClick={() => void onChoose(a, c)}
              >
                <Icon name={ANSWER_ICON[c]} size="sm" />
                <span>{t(`appointments.rsvp.answer.${c}`)}</span>
              </button>
            ))}
          </div>
          {saving ? (
            <p className="rsvp-note" role="status">
              <Icon name="refresh-cw" size="sm" />
              <span>{t("appointments.rsvp.saving")}</span>
            </p>
          ) : null}
          {errorText ? (
            <p className="rsvp-error" role="alert" data-testid="home-rsvp-error">
              <Icon name="circle-alert" size="sm" />
              <span>{errorText}</span>
            </p>
          ) : null}
        </div>
        <Link className="appt-open" href={`/appointments/${encodeURIComponent(a.id)}`} aria-label={t("home.next.openAria", { title: a.title })} data-testid="home-next-open">
          <span>{t("home.next.open")}</span>
          <Icon name="chevron-right" />
        </Link>
      </div>
    </article>
  );
}

function Row({ a, rsvp, locale }: { a: HomeAppointment; rsvp: RsvpState; locale: CalendarLocale }) {
  const t = useTranslations();
  const { day, date } = dateBox(a);
  const mine = displayRsvp(a, rsvp).mine;
  const state = mine ?? "none";
  const r = timeRange(a, locale);
  const timeText = r.kind === "overnight" ? t("appointments.when.overnight", { start: r.start, end: r.end }) : r.text;
  return (
    <Link
      className="appt-row"
      href={`/appointments/${encodeURIComponent(a.id)}`}
      aria-label={t("home.row.aria", { title: a.title, when: `${shortDateLabel(a, locale)} ${timeText}`, group: a.groupName, state })}
      data-testid="home-row"
      data-appt-id={a.id}
    >
      <span className="appt-datebox" aria-hidden="true">
        <span className="d">{day}</span>
        <span className="m">{monthOnly(date, locale)}</span>
      </span>
      <span className="appt-row-main" aria-hidden="true">
        <span className="appt-row-title">
          <bdi>{a.title}</bdi>
        </span>
        <span className="appt-row-meta">
          {shortDateLabel(a, locale)} · <span className="num">{timeText}</span>
        </span>
        <span className="appt-row-pills">
          <span className="appt-row-meta">
            <bdi>{a.groupName}</bdi>
          </span>
          <span className="rsvp-pill" data-answer={state}>
            <Icon name={ANSWER_ICON[state]} size="sm" />
            <span>{t(`appointments.rsvp.mine.${state}`)}</span>
          </span>
        </span>
      </span>
      <Icon name="chevron-right" className="chev" />
    </Link>
  );
}
