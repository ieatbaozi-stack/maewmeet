"use client";

import { useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { arrowTarget, type MonthModel } from "@/components/calendar/model";
import { Icon } from "@/components/icons/Icon";
import { format, weekdayLabels, type CalendarLocale, type DateISO } from "@/lib/calendar";
import { classifyDay, isSelectable, showsFraction, type AvDay, type DayClass } from "./model";

const DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export interface FreeMonthGridProps {
  model: MonthModel;
  monthTitle: string;
  today: DateISO;
  /** วัน → ผลของวันนั้น (ไม่มี = นอกช่วงที่ API รับ 2000–2100) */
  days: ReadonlyMap<DateISO, AvDay>;
  /** วันที่เน้น (มือถือ = วันที่เปิด sheet อยู่ · iPad = วันที่แผงขวา) */
  selected: DateISO | null;
  loading: boolean;
  onSelect: (date: DateISO) => void;
}

/**
 * ตารางเดือนมุมมอง "ว่างตรงกัน" (UX X35–X36): โครง role=grid > row > gridcell(ปุ่ม) + roving tabindex เหมือนตารางเดือน R3
 * 4 สถานะ + ผ่านแล้ว แยกด้วยรูปทรง/ตัวอักษร (ไม่พึ่งสี): ว่างร่วม = กรอบทึบ + ✓ · ว่างครบแต่ไม่ตรง = กรอบประ + "n/n" · ว่าง X/Y (+ลายเฉียงถ้าไม่ถึงครึ่ง) · 0/Y
 * วันที่ผ่านแล้ว = เป็นกลาง aria-disabled กดไม่ได้ (แต่ยังโฟกัสด้วยลูกศรได้ ตาม ARIA)
 */
export function FreeMonthGrid({ model, monthTitle, today, days, selected, loading, onSelect }: FreeMonthGridProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const dowShort = weekdayLabels(locale, "short");
  const dowLong = weekdayLabels(locale, "long");

  const [focusDate, setFocusDate] = useState<DateISO | null>(null);
  const has = (d: DateISO | null) => d !== null && model.cells.some((c) => c.date === d);
  const stop = has(focusDate)
    ? focusDate
    : has(selected)
      ? selected
      : (model.cells.find((c) => c.today && !c.outside) ?? model.cells.find((c) => !c.outside) ?? model.cells[0])?.date;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const date = (e.target as HTMLElement).dataset.date;
    if (!date) return;
    const dest = arrowTarget(model.cells, date, e.key);
    if (!dest) return;
    e.preventDefault();
    setFocusDate(dest);
    e.currentTarget.querySelector<HTMLElement>(`[data-date="${dest}"]`)?.focus();
  }

  const weeks = Array.from({ length: model.weeks }, (_, w) => model.cells.slice(w * 7, w * 7 + 7));

  return (
    <div
      className="cal-month"
      role="grid"
      aria-label={t("calendar.month.gridAria", { month: monthTitle })}
      aria-busy={loading}
      data-testid="free-month"
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
            const day = days.get(c.date);
            // ไม่มีข้อมูล (นอก 2000–2100) → เป็นกลางเหมือนผ่านแล้ว
            const cls: DayClass | null = day ? classifyDay(day, today) : null;
            const state = cls?.state ?? "past";
            const classes = [
              "cal-cell",
              "av-cell",
              `is-${state}`,
              cls?.level ? `l-${cls.level}` : "",
              c.outside ? "is-outside" : "",
              c.today ? "is-today" : "",
              c.date === selected ? "is-selected" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const selectable = isSelectable(cls);
            const dateLong = format(c.date, { locale, style: "date-full" });
            const label = day
              ? t("availability.cell.aria", {
                  date: dateLong,
                  today: c.today ? "yes" : "no",
                  outside: c.outside ? "yes" : "no",
                  state,
                  free: day.freeMembers,
                  total: day.totalMembers,
                })
              : dateLong;
            return (
              <div className="cal-gc" role="gridcell" key={c.date}>
                <button
                  type="button"
                  className={classes}
                  data-date={c.date}
                  data-testid={`free-cell-${c.date}`}
                  data-state={state}
                  data-free={day?.freeMembers}
                  data-total={day?.totalMembers}
                  aria-current={c.today ? "date" : undefined}
                  aria-pressed={selectable && c.date === selected ? true : undefined}
                  aria-disabled={selectable ? undefined : true}
                  aria-label={label}
                  tabIndex={c.date === stop ? 0 : -1}
                  onFocus={() => setFocusDate(c.date)}
                  onClick={() => {
                    if (selectable) onSelect(c.date);
                  }}
                  suppressHydrationWarning
                >
                  <span className="dn" aria-hidden="true">
                    {c.day}
                  </span>
                  <span className="av-mark" aria-hidden="true">
                    {state === "all" ? (
                      <span className="av-badge">
                        <Icon name="check" />
                      </span>
                    ) : day && showsFraction(state) ? (
                      <span className="av-frac">{t("availability.cell.fraction", { free: day.freeMembers, total: day.totalMembers })}</span>
                    ) : null}
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
