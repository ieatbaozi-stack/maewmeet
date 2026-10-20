"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { BusyFormSheet, type BusyDone } from "@/components/busy/BusyFormSheet";
import { Cat } from "@/components/brand";
import { Notice } from "@/components/groups/Notice";
import { isGone } from "@/components/groups/errors";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { EmptyState } from "@/components/shell/EmptyState";
import { DEFAULT_TZ, addDays, format, toLocal, todayIn, type CalendarLocale, type DateISO, type EpochMs } from "@/lib/calendar";
import type { GroupCalendarDto } from "@/lib/data/services/calendar";
import { clock } from "@/lib/shared/clock";
import { DayPanel } from "./DayPanel";
import { GroupSwitchSheet, type GroupOption } from "./GroupSwitchSheet";
import { MemberLegend, MonthGrid } from "./MonthGrid";
import { MineList } from "./MineList";
import { buildMonth, busyUsersByDate, monthStart, shiftMonth, spanOf, ymOf, type OwnBusy } from "./model";

export type CalView = "month" | "day" | "mine";
const VIEWS: readonly CalView[] = ["month", "day", "mine"];

export type InitialCalendar = { status: "ready"; data: GroupCalendarDto } | { status: "error" } | { status: "gone" };

export interface CalendarViewProps {
  groups: readonly GroupOption[];
  gid: string;
  /** tz ของกลุ่ม (ปุ่ม "วันนี้" และเวลาในแถบใช้ tz นี้) */
  tz: string;
  userId: string;
  /** วันนี้ใน tz กลุ่ม ณ ตอน render ฝั่งเซิร์ฟเวอร์ + epoch ms (ให้ hydrate ตรงกัน) */
  initialToday: DateISO;
  initialNowMs: EpochMs;
  initialDate: DateISO;
  initialView: CalView;
  initial: InitialCalendar;
}

type CalState = { key: string; nowMs: EpochMs; status: "ready"; data: GroupCalendarDto } | { key: string; nowMs: EpochMs; status: "error" | "gone" };
type MineState = { key: string; nowMs: EpochMs; status: "ready"; items: OwnBusy[] } | { key: string; nowMs: EpochMs; status: "error" };
type FormState = { edit: OwnBusy | null; today: DateISO; defaultDate: DateISO } | null;

const WIDE = "(min-width: 48em)";
function subscribeWide(cb: () => void): () => void {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

const TOAST_KEY: Record<BusyDone, string> = {
  created: "busy.toast.saved",
  updated: "busy.toast.updated",
  deleted: "busy.toast.deleted",
  gone: "busy.form.error.gone",
};

const calKeyOf = (gid: string, from: DateISO, to: DateISO, version: number) => `${gid}|${from}|${to}|${version}`;

/**
 * แท็บปฏิทิน (UX §7): ตัวเลือกกลุ่ม · เดือน | วัน | ของฉัน · ฟอร์มลง busy
 * ข้อมูลโหลดครั้งแรกจากเซิร์ฟเวอร์ (page) แล้วขอใหม่ตามช่วงของตารางที่เห็น (≤ 42 วัน) · สิทธิ์ตรวจที่เซิร์ฟเวอร์ทุก API — UI แค่แสดงผล
 */
export function CalendarView({ groups, gid, tz, userId, initialToday, initialNowMs, initialDate, initialView, initial }: CalendarViewProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const router = useRouter();
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );

  const [view, setView] = useState<CalView>(initialView);
  const [selected, setSelected] = useState<DateISO>(initialDate);
  const [ym, setYm] = useState(() => ymOf(initialDate));
  const [today, setToday] = useState<DateISO>(initialToday);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<FormState>(null);
  const [switching, setSwitching] = useState(false);
  const [toast, setToast] = useState<BusyDone | null>(null);

  const month = useMemo(() => buildMonth(ym.year, ym.month, today), [ym, today]);
  const calKey = calKeyOf(gid, month.from, month.to, version);
  const [cal, setCal] = useState<CalState>(() => {
    const m = buildMonth(ymOf(initialDate).year, ymOf(initialDate).month, initialToday);
    const key = calKeyOf(gid, m.from, m.to, 0);
    return initial.status === "ready" ? { key, nowMs: initialNowMs, status: "ready", data: initial.data } : { key, nowMs: initialNowMs, status: initial.status };
  });
  const mineKey = `mine|${version}`;
  const [mine, setMine] = useState<MineState | null>(null);

  // ───────── โหลดข้อมูล (setState เฉพาะใน callback หลัง await — ไม่ซิงก์ใน effect) ─────────
  useEffect(() => {
    if (view === "mine" || cal.key === calKey) return;
    let live = true;
    void callApi<GroupCalendarDto>(`/api/groups/${gid}/calendar?from=${month.from}&to=${month.to}`, { method: "GET" }).then((res) => {
      if (!live) return;
      const nowMs = clock.now();
      if (res.ok) setCal({ key: calKey, nowMs, status: "ready", data: res.data });
      else setCal({ key: calKey, nowMs, status: isGone(res) ? "gone" : "error" });
    });
    return () => {
      live = false;
    };
  }, [view, cal.key, calKey, gid, month.from, month.to]);

  useEffect(() => {
    if (view !== "mine" || mine?.key === mineKey) return;
    let live = true;
    void callApi<{ busy: OwnBusy[] }>("/api/me/busy", { method: "GET" }).then((res) => {
      if (!live) return;
      const nowMs = clock.now();
      setMine(res.ok ? { key: mineKey, nowMs, status: "ready", items: res.data.busy } : { key: mineKey, nowMs, status: "error" });
    });
    return () => {
      live = false;
    };
  }, [view, mine?.key, mineKey]);

  // URL: จำกลุ่ม/มุมมอง/วันที่ใน search param (แค่ความสะดวก — แชร์ลิงก์/รีเฟรชได้) ไม่ทำให้เซิร์ฟเวอร์ render ใหม่
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("g", gid);
    url.searchParams.set("v", view);
    url.searchParams.set("d", selected);
    window.history.replaceState(window.history.state, "", url);
  }, [gid, view, selected]);

  // ───────── ค่าที่คำนวณจากข้อมูล ─────────
  const loading = cal.key !== calKey;
  const ready = !loading && cal.status === "ready" ? cal.data : null;
  const groupTz = ready?.group.tz ?? tz;
  const members = ready?.members ?? [];
  const spans = useMemo(() => (ready ? ready.busy.map((b) => spanOf(b, groupTz)) : []), [ready, groupTz]);
  const busyByDate = useMemo(() => busyUsersByDate(spans, month.from, month.to), [spans, month.from, month.to]);
  const monthTitle = format(monthStart(ym.year, ym.month), { locale, style: "month-year" });
  const groupName = groups.find((g) => g.id === gid)?.name ?? "";
  const solo = members.length <= 1;
  const nowMinute = cal.status === "ready" && selected === today ? toLocal(cal.nowMs, groupTz).minute : null;

  // ───────── การกระทำ ─────────
  function changeView(next: CalView) {
    setToast(null);
    setView(next);
  }

  function selectDate(date: DateISO) {
    setSelected(date);
    if (date < month.from || date > month.to) setYm(ymOf(date));
  }

  function goToday() {
    const td = todayIn(groupTz, clock.now());
    setToday(td);
    setSelected(td);
    setYm(ymOf(td));
  }

  function moveMonth(n: number) {
    const next = shiftMonth(ym.year, ym.month, n);
    if (!next) return;
    setYm(next);
    setSelected(today.startsWith(`${next.year}-${String(next.month).padStart(2, "0")}`) ? today : monthStart(next.year, next.month));
  }

  function moveDay(n: number) {
    try {
      selectDate(addDays(selected, n));
    } catch {
      /* ชนขอบปี 2000–2100 — ไม่ขยับ */
    }
  }

  function onCell(date: DateISO) {
    setToast(null);
    selectDate(date);
    // มือถือ: แตะช่องวัน = ไปมุมมองวัน · iPad: เปลี่ยนวันที่แผงขวา (ไม่เปลี่ยนหน้า — X26)
    if (!window.matchMedia(WIDE).matches) setView("day");
  }

  function openForm(edit: OwnBusy | null) {
    setToast(null);
    const formToday = todayIn(DEFAULT_TZ, clock.now());
    setForm({ edit, today: formToday, defaultDate: view === "day" ? selected : formToday });
  }

  function onDone(result: BusyDone) {
    setForm(null);
    setToast(result);
    setVersion((v) => v + 1);
  }

  function pickGroup(id: string) {
    setSwitching(false);
    if (id === gid) return;
    startTransition(() => router.replace(`/calendar?g=${id}&v=${view}`));
  }

  // ───────── ส่วนย่อยของหน้า ─────────
  const nav = (
    <div className="cal-nav">
      <h2 id="cal-month-title" data-testid="cal-month-title">
        {monthTitle}
      </h2>
      <button type="button" className="icon-btn" aria-label={t("calendar.nav.prevMonth")} data-testid="cal-prev" disabled={shiftMonth(ym.year, ym.month, -1) === null} onClick={() => moveMonth(-1)}>
        <Icon name="chevron-left" />
      </button>
      <button type="button" className="icon-btn" aria-label={t("calendar.nav.nextMonth")} data-testid="cal-next" disabled={shiftMonth(ym.year, ym.month, 1) === null} onClick={() => moveMonth(1)}>
        <Icon name="chevron-right" />
      </button>
      <button type="button" className="btn btn-secondary" aria-label={t("calendar.nav.todayAria")} data-testid="cal-today" onClick={goToday}>
        {t("calendar.nav.today")}
      </button>
    </div>
  );

  const retryCal = () => setVersion((v) => v + 1);

  const errorBlock = (title: string, body: string, retry: () => void, testId: string) => (
    <div data-testid={testId}>
      <div className="alert" role="alert">
        <Icon name="circle-alert" />
        <div>
          <b>{title}</b>
          <span>{body}</span>
        </div>
      </div>
      <button type="button" className="btn btn-secondary cal-retry" onClick={retry}>
        <Icon name="refresh-cw" />
        <span>{t("states.retry")}</span>
      </button>
    </div>
  );

  const dayPanel = ready ? (
    <DayPanel
      date={selected}
      today={today}
      members={members}
      spans={spans}
      myId={userId}
      nowMinute={nowMinute}
      onPrev={() => moveDay(-1)}
      onNext={() => moveDay(1)}
      onToday={goToday}
      onAdd={() => openForm(null)}
    />
  ) : null;

  let body: React.ReactNode;
  let showFab = true;
  if (view === "mine") {
    if (!mine || mine.key !== mineKey) {
      showFab = false;
      body = (
        <div aria-busy="true" data-testid="cal-loading">
          <div className="skeleton cal-skel" />
          <div className="skeleton cal-skel" />
          <div className="skeleton cal-skel" />
          <p className="loading-note" role="status">
            {t("busy.mine.loading")}
          </p>
        </div>
      );
    } else if (mine.status === "error") {
      showFab = false;
      body = errorBlock(t("busy.mine.error.title"), t("busy.mine.error.body"), retryCal, "cal-error");
    } else {
      showFab = mine.items.length > 0;
      body = <MineList items={mine.items} nowMs={mine.nowMs} onOpen={(it) => openForm(it)} onAdd={() => openForm(null)} />;
    }
  } else if (!loading && cal.status === "gone") {
    showFab = false;
    body = (
      <div data-testid="cal-gone">
        <EmptyState pose="lost" title={t("calendar.gone.title")} body={t("calendar.gone.body")} cta={{ label: t("calendar.gone.cta"), href: "/groups" }} />
      </div>
    );
  } else if (!loading && cal.status === "error") {
    showFab = false;
    body = errorBlock(t("calendar.error.title"), t("calendar.error.body"), retryCal, "cal-error");
  } else if (view === "day") {
    if (loading) {
      showFab = false;
      body = (
        <div aria-busy="true" data-testid="cal-loading">
          <div className="skeleton cal-skel" />
          <div className="skeleton cal-skel" />
          <p className="loading-note" role="status">
            {t("calendar.loading")}
          </p>
        </div>
      );
    } else {
      body = dayPanel;
    }
  } else {
    showFab = !loading;
    body = (
      <>
        {solo && !loading ? (
          <div className="alert alert-warn" data-testid="cal-solo">
            <Icon name="info" />
            <div>
              <b>{t("empty.calendarSolo.title")}</b>
              <span>{t("empty.calendarSolo.body")}</span>
              <Link className="link-btn" href={`/groups/${gid}/settings#invite`}>
                {t("empty.calendarSolo.cta")}
              </Link>
            </div>
          </div>
        ) : null}
        <div className={wide ? "cal-split" : undefined}>
          <section aria-label={t("calendar.view.month")}>
            {nav}
            <MonthGrid model={month} monthTitle={monthTitle} members={members} busyByDate={busyByDate} selected={wide ? selected : null} loading={loading} onSelect={onCell} />
            {loading ? (
              <p className="loading-note cal-load-note" role="status" data-testid="cal-loading">
                {t("calendar.loading")}
              </p>
            ) : (
              <>
                {ready && ready.busy.length === 0 && !solo ? (
                  <section className="empty panel" data-testid="cal-empty">
                    <Cat pose="calendar" size="lg" />
                    <h2 className="h-section">{t("empty.calendar.title")}</h2>
                    <p className="muted">{t("empty.calendar.body")}</p>
                    <button type="button" className="btn btn-primary" onClick={() => openForm(null)}>
                      <Icon name="plus" />
                      <span>{t("empty.calendar.cta")}</span>
                    </button>
                  </section>
                ) : null}
                <MemberLegend members={members} myId={userId} />
              </>
            )}
          </section>
          {wide && ready ? <aside className="cal-side">{dayPanel}</aside> : null}
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="group-switch" aria-haspopup="dialog" aria-label={t("calendar.groupSwitch.label", { group: groupName })} data-testid="cal-group-switch" onClick={() => setSwitching(true)}>
          <span className="name">
            <Name>{groupName}</Name>
          </span>
          <Icon name="chevron-down" size="sm" />
        </button>
        <button type="button" className="btn btn-secondary wide-only" data-testid="busy-add-top" onClick={() => openForm(null)}>
          <Icon name="plus" />
          <span>{t("busy.add")}</span>
        </button>
      </header>
      <main className="main wide cal-main" id="main" data-view={view}>
        <h1 className="sr-only">{t("nav.calendar")}</h1>
        <div className="segmented cal-views" role="group" aria-label={t("calendar.view.label")}>
          {VIEWS.map((v) => (
            <button type="button" key={v} aria-pressed={view === v} data-testid={`cal-view-${v}`} onClick={() => changeView(v)}>
              {t(`calendar.view.${v}`)}
            </button>
          ))}
        </div>
        {toast ? (
          <div data-testid="cal-toast">
            <Notice kind={toast === "gone" ? "error" : "ok"}>{t(TOAST_KEY[toast])}</Notice>
          </div>
        ) : null}
        {view === "mine" ? (
          <div className="busy-head">
            <h2>{t("busy.mine.title")}</h2>
            <p>{t("busy.mine.lead")}</p>
          </div>
        ) : null}
        {body}
      </main>
      {showFab ? (
        <button type="button" className="btn btn-primary fab mobile-only" data-testid="busy-add" onClick={() => openForm(null)}>
          <Icon name="plus" />
          <span>{t("busy.add")}</span>
        </button>
      ) : null}

      {switching ? <GroupSwitchSheet groups={groups} currentId={gid} onPick={pickGroup} onClose={() => setSwitching(false)} /> : null}
      {form ? (
        <BusyFormSheet edit={form.edit} defaultDate={form.defaultDate} today={form.today} groupCount={groups.length} userId={userId} onClose={() => setForm(null)} onDone={onDone} />
      ) : null}
    </>
  );
}
