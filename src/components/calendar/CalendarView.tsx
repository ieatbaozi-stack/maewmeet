"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { rememberGroup } from "./RememberGroup";
import { GoingList } from "./GoingList";
import { BusyFormSheet, type BusyDone } from "@/components/busy/BusyFormSheet";
import { CreateAppointmentButton } from "@/components/appointments/CreateAppointmentButton";
import { FreeView } from "@/components/availability/FreeView";
import { Cat } from "@/components/brand";
import { Notice } from "@/components/groups/Notice";
import { isGone } from "@/components/groups/errors";
import { Bell } from "@/components/shell/Bell";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { EmptyState } from "@/components/shell/EmptyState";
import { DEFAULT_TZ, addDays, format, toLocal, todayIn, type CalendarLocale, type DateISO, type EpochMs } from "@/lib/calendar";
import type { GroupAvailabilityDto } from "@/lib/data/services/availability";
import type { GroupCalendarDto } from "@/lib/data/services/calendar";
import type { AppointmentDto } from "@/lib/data/serializers/appointments";
import { clock } from "@/lib/shared/clock";
import { DayPanel } from "./DayPanel";
import { GroupSwitchSheet, type GroupOption } from "./GroupSwitchSheet";
import { KindLegend, MemberLegend, MonthGrid } from "./MonthGrid";
import { MineList } from "./MineList";
import { classifyDay, isSelectable, planFromDate, urlDayParam } from "@/components/availability/model";
import { addCreatedBusy, buildMonth, busyUsersByDate, fetchRange, monthStart, shiftMonth, spanOf, toSharedBusy, ymOf, type OwnBusy } from "./model";

export type CalView = "month" | "free" | "day" | "mine";
/** ลำดับปุ่ม (UX X34): เดือน | ว่างตรงกัน | วัน | ของฉัน */
const VIEWS: readonly CalView[] = ["month", "free", "day", "mine"];

/** skipped = เซิร์ฟเวอร์ไม่ได้โหลดปฏิทิน (เปิดมาที่ ?v=free) → โหลดเมื่อสลับไปมุมมองเดือน/วัน */
export type InitialCalendar = { status: "ready"; data: GroupCalendarDto } | { status: "error" } | { status: "gone" } | { status: "skipped" };
/** ข้อมูลแท็บ "ของฉัน" จากเซิร์ฟเวอร์ (?v=mine) */
export type InitialMine = { status: "ready"; items: OwnBusy[]; truncated: boolean; going: AppointmentDto[] | null } | { status: "error" };
export type InitialAvailability = { status: "ready"; data: GroupAvailabilityDto } | { status: "error" } | { status: "gone" };

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
  /** ?g= ที่ขอมาไม่ใช่กลุ่มของฉัน → แสดงกลุ่มแรกแทน (แจ้งสั้นๆ) */
  groupMissing?: boolean;
  /** มี ?d= มาจริง → มุมมองว่างตรงกันเลือกวันนั้นที่แผงขวา (iPad) */
  dateGiven?: boolean;
  /** admin/ผู้ช่วยดูแล → ลิงก์ปรับช่วงเวลา (ความสะดวก — สิทธิ์จริงที่ API) */
  canEditWindow?: boolean;
  initial: InitialCalendar;
  initialAvailability?: InitialAvailability | null;
  initialMine?: InitialMine | null;
}

type CalState = { key: string; nowMs: EpochMs; status: "ready"; data: GroupCalendarDto } | { key: string; nowMs: EpochMs; status: "error" | "gone" };
type AvState = { key: string; nowMs: EpochMs; status: "ready"; data: GroupAvailabilityDto } | { key: string; nowMs: EpochMs; status: "error" | "gone" };
type MineState = { key: string; nowMs: EpochMs; status: "ready"; items: OwnBusy[]; truncated: boolean; going: AppointmentDto[] | null } | { key: string; nowMs: EpochMs; status: "error" };
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
  deletedDay: "busy.toast.deletedDay",
  deletedSeries: "busy.toast.deletedSeries",
  gone: "busy.form.error.gone",
};

/** รายการถูกตัดที่เพดานแถว (Platform ส่ง truncated:true) — แจ้งเบาๆ ไม่บล็อก */
function TruncatedNote({ messageKey }: { messageKey: string }) {
  const t = useTranslations();
  return (
    <div className="alert alert-warn" role="status" data-testid="cal-truncated">
      <Icon name="info" />
      <div>
        <span>{t(messageKey)}</span>
      </div>
    </div>
  );
}

const calKeyOf = (gid: string, from: DateISO, to: DateISO, version: number) => `${gid}|${from}|${to}|${version}`;
const avKeyOf = (gid: string, from: DateISO, to: DateISO, version: number) => `av|${gid}|${from}|${to}|${version}`;

/**
 * แท็บปฏิทิน (UX §7, §8): ตัวเลือกกลุ่ม · เดือน | ว่างตรงกัน | วัน | ของฉัน · ฟอร์มลง busy
 * ข้อมูลโหลดครั้งแรกจากเซิร์ฟเวอร์ (page) แล้วขอใหม่ตามช่วงของตารางที่เห็น (≤ 42 วัน) · สิทธิ์ตรวจที่เซิร์ฟเวอร์ทุก API — UI แค่แสดงผล
 */
export function CalendarView({ groups, gid, tz, userId, initialToday, initialNowMs, initialDate, initialView, groupMissing = false, dateGiven = false, canEditWindow = false, initial, initialAvailability = null, initialMine = null }: CalendarViewProps) {
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
  const [toast, setToast] = useState<{ result: BusyDone; count?: number } | null>(null);
  const [missingShown, setMissingShown] = useState(groupMissing);
  // มุมมองว่างตรงกัน: วันที่ผู้ใช้เลือก (null = ใช้วันตั้งต้น) · sheet รายละเอียดวัน (มือถือ)
  const [freePicked, setFreePicked] = useState<DateISO | null>(initialView === "free" && dateGiven ? initialDate : null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const month = useMemo(() => buildMonth(ym.year, ym.month, today), [ym, today]);
  const calKey = calKeyOf(gid, month.from, month.to, version);
  const [cal, setCal] = useState<CalState>(() => {
    const m = buildMonth(ymOf(initialDate).year, ymOf(initialDate).month, initialToday);
    const key = calKeyOf(gid, m.from, m.to, 0);
    if (initial.status === "ready") return { key, nowMs: initialNowMs, status: "ready", data: initial.data };
    // skipped: key ว่างไม่มีวันตรงกับ calKey → ถือว่ายังไม่ได้โหลด (สถานะ error ไม่ถูกแสดงเพราะ loading มาก่อน)
    return initial.status === "skipped" ? { key: "", nowMs: initialNowMs, status: "error" } : { key, nowMs: initialNowMs, status: initial.status };
  });
  const range = useMemo(() => fetchRange(month.from, month.to), [month.from, month.to]);
  const avKey = avKeyOf(gid, range.from, range.to, version);
  const [av, setAv] = useState<AvState | null>(() => {
    if (!initialAvailability) return null;
    const m = buildMonth(ymOf(initialDate).year, ymOf(initialDate).month, initialToday);
    const r = fetchRange(m.from, m.to);
    const key = avKeyOf(gid, r.from, r.to, 0);
    return initialAvailability.status === "ready" ? { key, nowMs: initialNowMs, status: "ready", data: initialAvailability.data } : { key, nowMs: initialNowMs, status: initialAvailability.status };
  });
  const mineKey = `mine|${version}`;
  const [mine, setMine] = useState<MineState | null>(() => (initialMine ? { key: "mine|0", nowMs: initialNowMs, ...initialMine } : null));

  // ───────── โหลดข้อมูล (setState เฉพาะใน callback หลัง await — ไม่ซิงก์ใน effect) ─────────
  useEffect(() => {
    if (view === "mine" || view === "free" || cal.key === calKey) return;
    let live = true;
    // ตารางเดือนของ 2000-01 / 2100-12 ล้นไปนอกปีที่ API รับ → ขอเฉพาะช่วงที่รับได้
    void callApi<GroupCalendarDto>(`/api/groups/${gid}/calendar?from=${range.from}&to=${range.to}`, { method: "GET" }).then((res) => {
      if (!live) return;
      const nowMs = clock.now();
      if (res.ok) setCal({ key: calKey, nowMs, status: "ready", data: res.data });
      else setCal({ key: calKey, nowMs, status: isGone(res) ? "gone" : "error" });
    });
    return () => {
      live = false;
    };
  }, [view, cal.key, calKey, gid, range.from, range.to]);

  // ว่างตรงกัน: ขอผลของทั้งตารางเดือน (≤ 42 วัน) · กันผลเก่า: live=false เมื่อเปลี่ยนเดือน/กลุ่ม/ลองใหม่ + ผลเก็บพร้อม key ของคำขอ (เทียบ avKey ก่อนใช้)
  useEffect(() => {
    if (view !== "free" || av?.key === avKey) return;
    let live = true;
    void callApi<GroupAvailabilityDto>(`/api/groups/${gid}/availability?from=${range.from}&to=${range.to}`, { method: "GET" }).then((res) => {
      if (!live) return;
      const nowMs = clock.now();
      if (res.ok) setAv({ key: avKey, nowMs, status: "ready", data: res.data });
      else setAv({ key: avKey, nowMs, status: isGone(res) ? "gone" : "error" });
    });
    return () => {
      live = false;
    };
  }, [view, av?.key, avKey, gid, range.from, range.to]);

  useEffect(() => {
    if (view !== "mine" || mine?.key === mineKey) return;
    let live = true;
    // R6D: นัดที่ตอบ "ไป" โหลดคู่กัน — ล้มเหลวเฉพาะส่วนนี้ (going: null) ไม่ทำให้รายการ busy หายไป
    void Promise.all([
      callApi<{ busy: OwnBusy[]; truncated?: boolean }>("/api/me/busy", { method: "GET" }),
      callApi<{ appointments: AppointmentDto[] }>("/api/me/appointments?rsvp=going", { method: "GET" }),
    ]).then(([res, going]) => {
      if (!live) return;
      const nowMs = clock.now();
      setMine(
        res.ok
          ? { key: mineKey, nowMs, status: "ready", items: res.data.busy, truncated: res.data.truncated === true, going: going.ok ? going.data.appointments : null }
          : { key: mineKey, nowMs, status: "error" },
      );
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
    const d = urlDayParam(view, freePicked, selected);
    if (d) url.searchParams.set("d", d);
    else url.searchParams.delete("d"); // ว่างตรงกัน + ยังไม่เลือกวัน: อย่าปักวันลง URL (รีโหลดแล้วแผงขวาจะไม่ถูกปักที่วันนี้)
    window.history.replaceState(window.history.state, "", url);
  }, [gid, view, selected, freePicked]);

  // ───────── ค่าที่คำนวณจากข้อมูล ─────────
  const loading = cal.key !== calKey;
  const ready = !loading && cal.status === "ready" ? cal.data : null;
  const avLoading = av === null || av.key !== avKey;
  const avReadyRaw = !avLoading && av?.status === "ready" ? av.data : null;
  // R6D: busy[] มี kind — แปลงเป็นรูปเดิมให้ FreeView (ลำดับคงเดิม → itemIdx ยังชี้ถูก)
  const avReady = useMemo(() => (avReadyRaw ? { ...avReadyRaw, busy: avReadyRaw.busy.map((b) => toSharedBusy(b, avReadyRaw.group.tz)) } : null), [avReadyRaw]);
  const groupTz = ready?.group.tz ?? tz;
  const members = ready?.members ?? [];
  const spans = useMemo(() => (ready ? ready.busy.map((b) => spanOf(toSharedBusy(b, groupTz), groupTz)) : []), [ready, groupTz]);
  const busyByDate = useMemo(() => busyUsersByDate(spans, month.from, month.to), [spans, month.from, month.to]);
  const monthTitle = format(monthStart(ym.year, ym.month), { locale, style: "month-year" });
  const group = groups.find((g) => g.id === gid) ?? null;
  const groupName = group?.name ?? "";
  const solo = members.length <= 1;
  const nowMinute = cal.status === "ready" && selected === today ? toLocal(cal.nowMs, groupTz).minute : null;

  // ───────── การกระทำ ─────────
  function changeView(next: CalView) {
    setToast(null);
    setMissingShown(false);
    setSheetOpen(false);
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
    if (view === "free") setFreePicked(wide ? td : null);
  }

  /** ว่างตรงกัน: แตะวัน (หรือการ์ดสรุป) = เลือกวัน · มือถือเปิด sheet · iPad เปลี่ยนแผงขวา */
  function pickFree(date: DateISO) {
    setToast(null);
    setFreePicked(date);
    selectDate(date);
    if (!wide) setSheetOpen(true);
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

  function onDone(result: BusyDone, count?: number, created?: OwnBusy[]) {
    setForm(null);
    // R6F: สร้างชุด → "บันทึก N วัน" · ลบทั้งชุด → "ลบทั้งชุด (N วัน)" (N จาก response)
    setToast(count === undefined ? { result } : { result, count });
    const next = version + 1;
    setVersion(next);
    // R7 B-5: เพิ่ม busy สำเร็จ → ใช้ผลของ POST ต่อเข้าข้อมูลที่แสดงอยู่ (เดือน/วัน/ของฉัน) ไม่ GET ซ้ำ · ทำถูกไม่ได้ (ข้อมูลไม่ตรงคีย์/ถูกตัดที่เพดาน)
    // → ปล่อยให้คีย์เปลี่ยนแล้วโหลดใหม่ตามเดิม · ว่างตรงกัน (คำนวณที่เซิร์ฟเวอร์) โหลดใหม่เสมอเพราะคีย์มี version
    if (result !== "created" || !created || created.length === 0) return;
    if (cal.status === "ready" && cal.key === calKey) {
      const patched = addCreatedBusy(cal.data, created, userId, range);
      if (patched) setCal({ key: calKeyOf(gid, month.from, month.to, next), nowMs: cal.nowMs, status: "ready", data: patched });
    }
    if (mine?.status === "ready" && mine.key === mineKey && !mine.truncated) {
      setMine({ ...mine, key: `mine|${next}`, items: [...mine.items, ...created] });
    }
  }

  function toastText(result: BusyDone, count: number | undefined): string {
    if (result === "created" && count !== undefined) return t("busy.toast.savedDaily", { count });
    if (result === "deletedSeries" && count !== undefined) return t("busy.toast.deletedSeriesCount", { count });
    return t(TOAST_KEY[result]);
  }

  function pickGroup(id: string) {
    setSwitching(false);
    if (id === gid) return;
    // R6D G1: จำกลุ่มที่เลือกไว้ (คุกกี้ฝั่งเซิร์ฟเวอร์) — ไม่รอผล ไม่แจ้ง error
    rememberGroup(id);
    startTransition(() => router.replace(`/calendar?g=${id}&v=${view}&d=${selected}`));
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
  // R6C L1: ปุ่มแถบบนจอกว้าง ซ่อนเฉพาะ gone/error/loading (ไม่ผูกกับ showFab)
  let showTopActions = true;
  if (view === "mine") {
    if (!mine || mine.key !== mineKey) {
      showFab = false;
      showTopActions = false;
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
      showTopActions = false;
      body = errorBlock(t("busy.mine.error.title"), t("busy.mine.error.body"), retryCal, "cal-error");
    } else {
      showFab = mine.items.length > 0;
      body = (
        <>
          {mine.truncated ? <TruncatedNote messageKey="busy.mine.truncated" /> : null}
          <MineList items={mine.items} nowMs={mine.nowMs} onOpen={(it) => openForm(it)} onAdd={() => openForm(null)} />
          <GoingList items={mine.going} onRetry={retryCal} />
        </>
      );
    }
  } else if (view === "free") {
    const avGone = !avLoading && av?.status === "gone";
    const avError = !avLoading && av?.status === "error";
    if (avGone) {
      showFab = false;
      showTopActions = false;
      body = (
        <div data-testid="free-gone">
          <EmptyState pose="lost" title={t("calendar.gone.title")} body={t("calendar.gone.body")} cta={{ label: t("calendar.gone.cta"), href: "/groups" }} />
        </div>
      );
    } else if (avError) {
      showFab = false;
      showTopActions = false;
      body = errorBlock(t("availability.error.title"), t("availability.error.body"), retryCal, "free-error");
    } else if (avReady && avReady.members.length <= 1) {
      // กลุ่มคนเดียว: X/1 ไม่มีความหมาย → ซ่อนตาราง ชวนเพื่อนแทน
      showFab = false;
      body = (
        <div data-testid="free-solo">
          <EmptyState pose="calendar" title={t("empty.calendarSolo.title")} body={t("empty.calendarSolo.body")} cta={{ label: t("empty.calendarSolo.cta"), href: `/groups/${gid}/settings#invite` }} />
        </div>
      );
    } else {
      showFab = !avLoading;
      showTopActions = !avLoading;
      const planFrom = avReady && av ? planFromDate(today, av.nowMs, avReady.group) : today;
      const pickedOk = freePicked !== null && avReady ? avReady.days.some((d) => d.date === freePicked && isSelectable(classifyDay(d, planFrom))) : false;
      body = (
        <FreeView
          data={avReady}
          gid={gid}
          groupName={groupName}
          myId={userId}
          month={month}
          monthTitle={monthTitle}
          nav={nav}
          today={planFrom}
          windowPassed={planFrom !== today}
          picked={pickedOk ? freePicked : null}
          sheetOpen={sheetOpen}
          wide={wide}
          canEditWindow={canEditWindow}
          onPick={pickFree}
          onCloseSheet={() => setSheetOpen(false)}
          onNextMonth={shiftMonth(ym.year, ym.month, 1) === null ? null : () => moveMonth(1)}
          onAddBusy={() => openForm(null)}
        />
      );
    }
  } else if (!loading && cal.status === "gone") {
    showFab = false;
    showTopActions = false;
    body = (
      <div data-testid="cal-gone">
        <EmptyState pose="lost" title={t("calendar.gone.title")} body={t("calendar.gone.body")} cta={{ label: t("calendar.gone.cta"), href: "/groups" }} />
      </div>
    );
  } else if (!loading && cal.status === "error") {
    showFab = false;
    showTopActions = false;
    body = errorBlock(t("calendar.error.title"), t("calendar.error.body"), retryCal, "cal-error");
  } else if (view === "day") {
    if (loading) {
      showFab = false;
      showTopActions = false;
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
    showTopActions = !loading;
    body = (
      <>
        {ready?.truncated === true ? <TruncatedNote messageKey="calendar.truncated" /> : null}
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
                <KindLegend />
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
        {/* R6B F3ค: สร้างนัดของกลุ่มที่เลือกอยู่ (สิทธิ์ appointment.create ตรวจที่ API) */}
        {showTopActions && group ? <CreateAppointmentButton groupId={group.id} groupName={group.name} memberCount={group.memberCount} tz={groupTz} userId={userId} className="btn btn-secondary wide-only" testId="appt-add-top" /> : null}
        {showTopActions ? (
          <button type="button" className="btn btn-secondary wide-only" data-testid="busy-add-top" onClick={() => openForm(null)}>
            <Icon name="plus" />
            <span>{t("busy.add")}</span>
          </button>
        ) : null}
        <Bell />
      </header>
      <main className="main wide cal-main" id="main" data-view={view}>
        <h1 className="sr-only">{t("nav.calendar")}</h1>
        <div className="segmented cols-4 cal-views" role="group" aria-label={t("calendar.view.label")}>
          {VIEWS.map((v) => (
            <button type="button" key={v} aria-pressed={view === v} data-testid={`cal-view-${v}`} data-emphasis={v === "free" ? "true" : undefined} onClick={() => changeView(v)}>
              {v === "free" ? <Icon name="circle-check" size="sm" /> : null}
              {t(`calendar.view.${v}`)}
            </button>
          ))}
        </div>
        {missingShown ? (
          <div className="alert alert-warn" role="status" data-testid="cal-group-missing">
            <Icon name="info" />
            <div>
              <span>{t("calendar.groupMissing")}</span>
            </div>
          </div>
        ) : null}
        {toast ? (
          <div data-testid="cal-toast">
            <Notice kind={toast.result === "gone" ? "error" : "ok"}>{toastText(toast.result, toast.count)}</Notice>
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
        <div className="fab-row mobile-only" data-testid="fab-row">
          {group ? <CreateAppointmentButton groupId={group.id} groupName={group.name} memberCount={group.memberCount} tz={groupTz} userId={userId} className="btn btn-secondary fab fab-appt" testId="appt-add-fab" /> : null}
          <button type="button" className="btn btn-primary fab" data-testid="busy-add" onClick={() => openForm(null)}>
            <Icon name="plus" />
            <span>{t("busy.add")}</span>
          </button>
        </div>
      ) : null}

      {switching ? <GroupSwitchSheet groups={groups} currentId={gid} onPick={pickGroup} onClose={() => setSwitching(false)} /> : null}
      {form ? (
        <BusyFormSheet edit={form.edit} defaultDate={form.defaultDate} today={form.today} groupCount={groups.length} userId={userId} onClose={() => setForm(null)} onDone={onDone} />
      ) : null}
    </>
  );
}
