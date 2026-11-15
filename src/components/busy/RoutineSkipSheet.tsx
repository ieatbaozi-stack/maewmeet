"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApiFull } from "@/components/appointments/api";
import { Cat } from "@/components/brand";
import { Icon } from "@/components/icons/Icon";
import { BusyButton } from "@/components/shell/BusyButton";
import { Sheet } from "@/components/shell/Sheet";
import { format, todayIn, type CalendarLocale, type DateISO } from "@/lib/calendar";
import { clock } from "@/lib/shared/clock";
import type { RoutineDone, RoutineView } from "./routine-model";
import {
  SKIP_MAX_DAYS,
  ariaState,
  atLimit,
  buildSkipMonth,
  dayState,
  doneCount,
  initialMode,
  initialMonth,
  isInteractive,
  mapSkipFailure,
  poolMonths,
  shiftMonth,
  skipPool,
  skipRequest,
  togglePick,
  type DayState,
  type SkipMode,
} from "./skip-model";

const DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export interface RoutineSkipSheetProps {
  routine: RoutineView;
  onClose: () => void;
  /** สำเร็จ (หรือชุดหาย) → หน้าปิดแผ่น + toast + โหลดรายการ/ปฏิทินใหม่ */
  onDone: (done: RoutineDone) => void;
}

const DAY_CLASS: Record<DayState, string> = {
  plain: "sk-day",
  picked: "sk-day",
  skipped: "sk-day is-skipped",
  restorable: "sk-day is-skipped",
  restorePicked: "sk-day is-skipped",
  locked: "sk-day is-locked",
};

/**
 * sheet "เว้นบางวัน" (R15_FEEDBACK §3.2): ปฏิทินเล็กของวันในชุดที่ยังไม่ผ่าน · เลือกหลายวัน · ยืนยันครั้งเดียว · แท็บ "วันที่เว้นไว้" เอากลับ
 * เพดาน 31 วัน/คำขอ (ช่องที่เหลือล็อกก่อนกด) · error ไม่ล้างค่าที่เลือก · สิทธิ์/วันที่ผ่านแล้วตัดสินที่เซิร์ฟเวอร์ (POST /api/me/busy-routines/:id/skips)
 */
export function RoutineSkipSheet({ routine, onClose, onDone }: RoutineSkipSheetProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  // "วันนี้" ใน tz ของชุด (เซิร์ฟเวอร์ตัดสินด้วยค่าเดียวกัน) — คำนวณครั้งเดียวตอนเปิดแผ่น
  const [today] = useState<DateISO>(() => todayIn(routine.tz, clock.now()));
  const pool = useMemo(() => skipPool(routine, today), [routine, today]);
  const months = useMemo(() => poolMonths(pool.days), [pool]);
  const [mode, setMode] = useState<SkipMode>(() => initialMode(pool));
  const [ym, setYm] = useState<string | null>(() => initialMonth(pool, initialMode(pool)));
  const [pickSkip, setPickSkip] = useState<DateISO[]>([]);
  const [pickRestore, setPickRestore] = useState<DateISO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = mode === "skip" ? pickSkip : pickRestore;
  const setPicked = mode === "skip" ? setPickSkip : setPickRestore;
  const empty = mode === "skip" && pool.available.length === 0;
  const limit = atLimit(picked);
  const n = picked.length;
  const cells = useMemo(() => (ym ? buildSkipMonth(ym, pool) : []), [ym, pool]);
  const monthTitle = ym ? format(`${ym}-01`, { locale, style: "month-year" }) : "";
  const prev = ym ? shiftMonth(months, ym, -1) : null;
  const next = ym ? shiftMonth(months, ym, 1) : null;
  const text = (ref: { key: string; values: Record<string, string | number> }) => t(ref.key, ref.values);

  function changeMode(m: SkipMode) {
    if (busy || m === mode) return;
    setMode(m);
    setError(null);
    const cur = ym && months.includes(ym) ? ym : null;
    setYm(cur ?? initialMonth(pool, m));
  }

  function toggle(date: DateISO) {
    if (busy) return;
    setError(null);
    setPicked((p) => togglePick(p, date));
  }

  async function submit() {
    if (busy || n === 0) return;
    setBusy(true);
    setError(null);
    const rq = skipRequest(routine.id, mode, picked);
    const res = await callApiFull<{ skipped?: number; restored?: number }>(rq.path, { method: "POST", body: rq.body });
    setBusy(false);
    if (res.ok) {
      const count = doneCount(mode, res.data, n);
      onDone({ type: mode === "skip" ? "skipped" : "restored", count });
      return;
    }
    const f = mapSkipFailure(res);
    if (f.type === "gone") {
      onDone({ type: "gone" });
      return;
    }
    setError(f.refs.map(text).join(" "));
  }

  function dayCell(cell: Extract<ReturnType<typeof buildSkipMonth>[number], { type: "day" }>) {
    const st = dayState(mode, cell, picked);
    const live = isInteractive(st);
    const on = st === "picked" || st === "restorePicked";
    const date = format(cell.date, { locale, style: "day-month" });
    return (
      <button
        key={cell.key}
        type="button"
        className={DAY_CLASS[st]}
        aria-pressed={on ? true : live || st === "locked" ? false : undefined}
        aria-disabled={live ? undefined : true}
        aria-label={t("busy.routine.skip.day.aria", { date, state: ariaState(st) })}
        data-testid={`skip-day-${cell.date}`}
        data-state={st}
        onClick={live ? () => toggle(cell.date) : undefined}
      >
        <span>{cell.day}</span>
        {on ? <Icon name="check" size="sm" /> : null}
      </button>
    );
  }

  const tabs =
    pool.skipped.length > 0 ? (
      <div className="segmented cols-2 sk-tabs" role="group" aria-label={t("busy.routine.skip.mode.label")}>
        <button type="button" aria-pressed={mode === "skip"} data-testid="skip-mode-skip" onClick={() => changeMode("skip")}>
          {t("busy.routine.skip.mode.skip")}
        </button>
        <button type="button" aria-pressed={mode === "restore"} data-testid="skip-mode-restore" onClick={() => changeMode("restore")}>
          {t("busy.routine.skip.mode.restore", { count: pool.skipped.length })}
        </button>
      </div>
    ) : null;

  const footer = empty ? null : (
    <div className="sk-foot">
      <button type="button" className="link-btn" aria-disabled={n === 0 || busy || undefined} data-testid="skip-clear" onClick={() => (n > 0 && !busy ? setPicked([]) : undefined)}>
        {t("busy.routine.skip.clear")}
      </button>
      <BusyButton
        type="button"
        className="btn btn-primary"
        busy={busy}
        busyLabel={t("busy.routine.skip.saving")}
        idleLabel={t(mode === "skip" ? "busy.routine.skip.confirm" : "busy.routine.skip.confirmRestore", { count: n })}
        aria-disabled={n === 0 || undefined}
        data-testid="skip-confirm"
        onClick={() => void submit()}
      />
    </div>
  );

  return (
    <Sheet title={t("busy.routine.skip.title")} tall onClose={() => (busy ? undefined : onClose())} footer={footer}>
      <div data-testid="skip-sheet" data-mode={mode}>
        {empty ? (
          <>
            {tabs}
            <div className="sk-empty" data-testid="skip-empty">
              <Cat pose="sleep" size="md" />
              <b>{t("busy.routine.skip.empty.title")}</b>
              <p className="muted">{t("busy.routine.skip.empty.body")}</p>
            </div>
          </>
        ) : (
          <>
            <p>{t("busy.routine.skip.lead")}</p>
            {tabs}
            <div className="sk-nav">
              <button type="button" className="icon-btn" aria-label={t("busy.routine.skip.calendar.prev")} aria-disabled={prev === null || undefined} data-testid="skip-prev" onClick={() => (prev ? setYm(prev) : undefined)}>
                <Icon name="chevron-left" />
              </button>
              <b aria-live="polite" data-testid="skip-month">
                {monthTitle}
              </b>
              <button type="button" className="icon-btn" aria-label={t("busy.routine.skip.calendar.next")} aria-disabled={next === null || undefined} data-testid="skip-next" onClick={() => (next ? setYm(next) : undefined)}>
                <Icon name="chevron-right" />
              </button>
            </div>
            <div className="sk-dow" aria-hidden="true">
              {DOW.map((k) => (
                <span key={k}>{t(`calendar.dow.${k}`)}</span>
              ))}
            </div>
            <div className="sk-grid" role="group" aria-label={t(mode === "skip" ? "busy.routine.skip.calendar.aria" : "busy.routine.skip.restoreCalendarAria", { month: monthTitle })} data-testid="skip-grid">
              {cells.map((c) =>
                c.type === "day" ? (
                  dayCell(c)
                ) : c.type === "off" ? (
                  <span key={c.key} className="sk-off" aria-hidden="true">
                    {c.day}
                  </span>
                ) : (
                  <span key={c.key} aria-hidden="true" />
                ),
              )}
            </div>
            <div className="sk-legend">
              <span>
                <i className="sk-sw" />
                {t("busy.routine.skip.legend.available")}
              </span>
              <span>
                <i className="sk-sw sel">
                  <Icon name="check" size="sm" />
                </i>
                {t("busy.routine.skip.legend.selected")}
              </span>
              {pool.skipped.length > 0 ? (
                <span>
                  <i className="sk-sw skp" />
                  {t("busy.routine.skip.legend.skipped")}
                </span>
              ) : null}
            </div>
            <p className="sk-count" role="status" data-testid="skip-count">
              {t("busy.routine.skip.count", { count: n })}
            </p>
            {limit ? (
              <p className="sk-limit" data-testid="skip-limit">
                <Icon name="info" size="sm" />
                <span>{t("busy.routine.skip.limit", { max: SKIP_MAX_DAYS })}</span>
              </p>
            ) : null}
            <p className="sk-note">{t("busy.routine.skip.note")}</p>
            {error ? (
              <div className="alert sk-alert" role="alert" data-testid="skip-error">
                <Icon name="circle-alert" />
                <div>
                  <span>{error}</span>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}

