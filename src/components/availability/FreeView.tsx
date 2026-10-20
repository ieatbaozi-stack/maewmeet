"use client";

import Link from "next/link";
import { useId, useMemo, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { MonthModel } from "@/components/calendar/model";
import { Icon } from "@/components/icons/Icon";
import { Sheet } from "@/components/shell/Sheet";
import { format, type CalendarLocale, type DateISO } from "@/lib/calendar";
import { CreateCta, FreeDetail } from "./FreeDetail";
import { FreeMonthGrid } from "./FreeMonthGrid";
import { FreeSummary } from "./FreeSummary";
import { clockOf, dayMap, defaultPanelDate, durationMsg, nobodyLoggedBusy, summarize, type AvData } from "./model";

export interface FreeViewProps {
  /** null = กำลังโหลด (โครงตาราง) */
  data: AvData | null;
  gid: string;
  myId: string;
  month: MonthModel;
  monthTitle: string;
  /** ปุ่มเลื่อนเดือน/วันนี้ (ใช้ร่วมกับมุมมองเดือน) */
  nav: ReactNode;
  today: DateISO;
  /** วันที่ผู้ใช้เลือกในมุมมองนี้ (null = ยังไม่เลือก) */
  picked: DateISO | null;
  /** มือถือ: เปิด sheet รายละเอียดวัน */
  sheetOpen: boolean;
  wide: boolean;
  canEditWindow: boolean;
  /** ผู้ใช้ที่ปรับตั้งค่ากลุ่มได้ */
  onPick: (date: DateISO) => void;
  onCloseSheet: () => void;
  onNextMonth: (() => void) | null;
  onAddBusy: () => void;
}

/**
 * มุมมอง "ว่างตรงกัน" (UX §8, W14/W15): แถบสถานะ (ตัดทอน/ไม่มีใครลง) · การ์ดสรุป · เดือน · คำอธิบายช่อง · ที่มาของผล · ช่วงเวลาที่นับ
 * รายละเอียดวัน: มือถือ = bottom sheet · iPad (≥ 768) = แผงขวา (วันตั้งต้น = วันแรกที่ว่างร่วม ถ้าไม่มีใช้วันใกล้เคียงที่สุด)
 */
export function FreeView({ data, gid, myId, month, monthTitle, nav, today, picked, sheetOpen, wide, canEditWindow, onPick, onCloseSheet, onNextMonth, onAddBusy }: FreeViewProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const hintId = useId();

  const days = useMemo(() => dayMap(data?.days ?? []), [data]);
  const summary = useMemo(() => (data ? summarize(data.days, today) : null), [data, today]);
  const nobody = useMemo(() => (data ? nobodyLoggedBusy(data.days) : false), [data]);
  const panelDate = useMemo(() => {
    if (!data) return null;
    if (picked && days.has(picked)) return picked;
    return defaultPanelDate(data.days, today);
  }, [data, days, picked, today]);
  const detailDay = wide ? (panelDate ? days.get(panelDate) : undefined) : sheetOpen && picked ? days.get(picked) : undefined;
  const highlight = wide ? panelDate : sheetOpen ? picked : null;

  const win = data ? data.group : null;
  const minDur = win ? durationMsg(win.minFreeMinutes) : null;

  const main = (
    <section aria-label={t("availability.region")} data-testid="free-region">
      {data?.truncated ? (
        <div className="alert alert-warn" role="status" data-testid="free-truncated">
          <Icon name="info" />
          <div>
            <span>{t("availability.truncated")}</span>
          </div>
        </div>
      ) : null}
      {data && nobody ? (
        <div className="alert alert-warn" role="status" data-testid="free-nobody">
          <Icon name="info" />
          <div>
            <b>{t("availability.nobody.title")}</b>
            <span>{t("availability.nobody.body")}</span>
            <div className="av-nobody-cta">
              <button type="button" className="btn btn-secondary" data-testid="free-nobody-add" onClick={onAddBusy}>
                <Icon name="plus" />
                <span>{t("availability.nobody.cta")}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {summary && data ? (
        <FreeSummary summary={summary} members={data.members} canEditWindow={canEditWindow} gid={gid} onOpenDay={onPick} onNextMonth={onNextMonth} />
      ) : (
        <div className="av-summary is-loading" aria-hidden="true" />
      )}

      <div>
        {nav}
        <FreeMonthGrid model={month} monthTitle={monthTitle} today={today} days={days} selected={highlight} loading={data === null} onSelect={onPick} />
      </div>

      {data ? (
        <>
          <section className="av-legend" aria-labelledby={`${hintId}-lg`} data-testid="free-legend">
            <h3 id={`${hintId}-lg`}>{t("availability.legend.title")}</h3>
            <ul>
              <li>
                <span className="av-sw is-all" aria-hidden="true">
                  <span className="av-badge">
                    <Icon name="check" />
                  </span>
                </span>
                <span>{t("availability.legend.all")}</span>
              </li>
              <li>
                <span className="av-sw is-nocommon" aria-hidden="true">
                  <span className="av-frac">{t("availability.cell.fraction", { free: 6, total: 6 })}</span>
                </span>
                <span>{t("availability.legend.nocommon")}</span>
              </li>
              <li>
                <span className="av-sw is-partial l-mid" aria-hidden="true">
                  <span className="av-frac">{t("availability.cell.fraction", { free: 4, total: 6 })}</span>
                </span>
                <span>{t("availability.legend.partial")}</span>
              </li>
              <li>
                <span className="av-sw is-partial l-few" aria-hidden="true">
                  <span className="av-frac">{t("availability.cell.fraction", { free: 2, total: 6 })}</span>
                </span>
                <span>{t("availability.legend.few")}</span>
              </li>
              <li>
                <span className="av-sw is-none" aria-hidden="true">
                  <span className="av-frac">{t("availability.cell.fraction", { free: 0, total: 6 })}</span>
                </span>
                <span>{t("availability.legend.none")}</span>
              </li>
            </ul>
            <p className="av-note-fraction">{t("availability.legend.fractionNote")}</p>
          </section>
          <p className="av-info" data-testid="free-explain">
            <Icon name="info" size="sm" />
            <span>{t("availability.explain")}</span>
          </p>
          {win && minDur ? (
            <div className="av-window" data-testid="free-window">
              <span className="lbl">{t("availability.window.title")}</span>
              <span className="val">
                {t("availability.window.line", { start: clockOf(win.windowStartMin), end: clockOf(win.windowEndMin), duration: t(minDur.key, minDur.values) })}
              </span>
              {canEditWindow ? (
                <Link className="av-link" href={`/groups/${gid}/settings#window`} aria-label={t("availability.window.editAria")} data-testid="free-window-edit">
                  {t("availability.window.edit")}
                </Link>
              ) : (
                <span className="av-admin-only">{t("availability.window.adminOnly")}</span>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <p className="loading-note cal-load-note" role="status" data-testid="free-loading">
          {t("availability.loading")}
        </p>
      )}
    </section>
  );

  const dateTitle = (d: DateISO) => format(d, { locale, style: "date-full" });

  return (
    <>
      <div className={wide ? "cal-split" : undefined}>
        {main}
        {wide && data ? (
          <aside className="cal-side" data-testid="free-side">
            {detailDay ? (
              <section className="cal-card av-detail" aria-live="polite" style={{ marginTop: 0 }}>
                <h2 data-testid="free-detail-title" suppressHydrationWarning>
                  {dateTitle(detailDay.date)}
                </h2>
                <FreeDetail day={detailDay} data={data} myId={myId} variant="panel" hintId={hintId} />
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
      {!wide && data && detailDay ? (
        <Sheet title={dateTitle(detailDay.date)} onClose={onCloseSheet} footer={<CreateCta hintId={hintId} withHint={false} />} className="av-sheet">
          <div className="av-detail" data-testid="free-sheet">
            <FreeDetail day={detailDay} data={data} myId={myId} variant="sheet" hintId={hintId} />
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
