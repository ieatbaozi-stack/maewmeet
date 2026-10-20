"use client";

import { type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { memberSlot } from "@/components/groups/helpers";
import { Name } from "@/components/Name";
import { format, weekdayLabels, type CalendarLocale, type DateISO } from "@/lib/calendar";
import { dotLayout, type MemberInfo, type MonthModel } from "./model";

const DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export interface MonthGridProps {
  model: MonthModel;
  /** ตัวหัวตาราง "ตุลาคม พ.ศ. 2569" — ใช้เป็นชื่อตารางสำหรับ screen reader */
  monthTitle: string;
  members: readonly MemberInfo[];
  /** วัน → userId ที่ติดวันนั้น */
  busyByDate: ReadonlyMap<DateISO, ReadonlySet<string>>;
  /** วันที่เลือก (iPad แผงขวา) — มือถือไม่เน้น */
  selected: DateISO | null;
  loading: boolean;
  onSelect: (date: DateISO) => void;
}

/**
 * ตารางเดือน (UX X22–X25): หัว จ–อา (WEEK_START) · ช่องวัน = ปุ่มสูงตาม --cell-h (≥ เป้าแตะขั้นต่ำ) · จุดสีสมาชิก + "+N" · วันนี้ = กรอบหนา · นอกเดือน = ตัวเลขจาง
 * role=grid > row > gridcell(ปุ่ม) · aria-label ของช่อง = วันที่เต็ม + วันนี้/นอกเดือน + จำนวนคนที่ติด · ลูกศรเลื่อนโฟกัสเป็นส่วนเสริม (Tab ถึงทุกช่อง)
 */
export function MonthGrid({ model, monthTitle, members, busyByDate, selected, loading, onSelect }: MonthGridProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const dowShort = weekdayLabels(locale, "short");
  const dowLong = weekdayLabels(locale, "long");

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
    const date = (e.target as HTMLElement).dataset.date;
    if (!delta || !date) return;
    const dest = model.cells[model.cells.findIndex((c) => c.date === date) + delta];
    if (!dest) return;
    e.preventDefault();
    e.currentTarget.querySelector<HTMLElement>(`[data-date="${dest.date}"]`)?.focus();
  }

  const weeks = Array.from({ length: model.weeks }, (_, w) => model.cells.slice(w * 7, w * 7 + 7));

  return (
    <div
      className="cal-month"
      role="grid"
      aria-label={t("calendar.month.gridAria", { month: monthTitle })}
      aria-busy={loading}
      data-testid="cal-month"
      data-weeks={model.weeks}
      onKeyDown={onKeyDown}
    >
      <div className="cal-head-row" role="row">
        {DOW.map((d, i) => (
          <div className="cal-dow" role="columnheader" key={d}>
            <span aria-hidden="true">{t(`calendar.dow.${d}`)}</span>
            <span className="sr-only">{dowLong[i] ?? dowShort[i]}</span>
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div className="cal-week" role="row" key={week[0]?.date}>
          {week.map((c) => {
            if (loading) {
              return (
                <div className="cal-gc" role="gridcell" key={c.date}>
                  <span className="cal-cell is-skeleton" aria-hidden="true" />
                </div>
              );
            }
            const busy = busyByDate.get(c.date);
            const ids = busy ? members.filter((m) => busy.has(m.userId)) : [];
            const layout = dotLayout(ids.length);
            const cls = ["cal-cell", c.outside ? "is-outside" : "", c.today ? "is-today" : "", c.date === selected ? "is-selected" : ""].filter(Boolean).join(" ");
            return (
              <div className="cal-gc" role="gridcell" key={c.date}>
                <button
                  type="button"
                  className={cls}
                  data-date={c.date}
                  data-testid={`cal-cell-${c.date}`}
                  data-count={ids.length}
                  aria-current={c.today ? "date" : undefined}
                  aria-pressed={c.date === selected ? true : undefined}
                  aria-label={t("calendar.cell.aria", {
                    date: format(c.date, { locale, style: "date-full" }),
                    today: c.today ? "yes" : "no",
                    outside: c.outside ? "yes" : "no",
                    count: ids.length,
                  })}
                  onClick={() => onSelect(c.date)}
                >
                  <span className="dn" aria-hidden="true">
                    {c.day}
                  </span>
                  <span className="cal-dots" aria-hidden="true">
                    {ids.slice(0, layout.shown).map((m) => (
                      <span className="member-dot" data-slot={memberSlot(m.colorIndex)} key={m.userId} />
                    ))}
                    {layout.more > 0 ? <span className={layout.wide ? "more wide" : "more"}>{t("calendar.cell.more", { count: layout.more })}</span> : null}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** ใครสีไหน (UX X24): จุด + ชื่อ ใต้ตาราง — บอกด้วยรูปทรง+ชื่อ ไม่ใช่สีอย่างเดียว */
export function MemberLegend({ members, myId }: { members: readonly MemberInfo[]; myId: string }) {
  const t = useTranslations();
  return (
    <div className="cal-legend" data-testid="cal-who">
      <h3 className="sub-h" id="cal-who-h">
        {t("calendar.busyLegend.whoTitle")}
      </h3>
      <ul className="cal-who" aria-labelledby="cal-who-h">
        {members.map((m) => (
          <li key={m.userId} data-testid={`cal-who-${m.userId}`}>
            <span className="member-dot" data-slot={memberSlot(m.colorIndex)} aria-hidden="true" />
            <span className="nm">
              <Name>{m.displayName}</Name>
            </span>
            {m.userId === myId ? <span className="you small muted">{t("group.members.you")}</span> : null}
          </li>
        ))}
      </ul>
      <p className="cal-note">{t("calendar.busyLegend.hint")}</p>
      {members.length > 8 ? <p className="cal-note">{t("calendar.busyLegend.more")}</p> : null}
      {members.length > 10 ? <p className="cal-note">{t("calendar.busyLegend.sameColour")}</p> : null}
    </div>
  );
}
