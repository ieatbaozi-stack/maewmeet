"use client";

import { useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { buildMonth, shiftMonth, ymOf } from "@/components/calendar/model";
import { format, weekdayLabels, type CalendarLocale, type DateISO } from "@/lib/calendar";

export interface DateRangePickerProps {
  mode: "single" | "range";
  start: DateISO | null;
  end: DateISO | null;
  /** วันก่อนหน้านี้กดไม่ได้ (aria-disabled) */
  minDate: DateISO;
  today: DateISO;
  /** เดือนที่เปิดอยู่ตอนเริ่ม */
  initialMonth: DateISO;
  /** ผู้ใช้แตะวัน (ผ่านแล้วเท่านั้น: วันก่อน minDate ไม่ถูกเรียก) */
  onPick: (date: DateISO) => void;
}

const DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * ตัวเลือกวันของฟอร์ม busy (UX X30) — ใช้รูปแบบเดียวทั้ง 3 แบบ · ไม่พึ่ง <input type=date> (แสดงตามเบราว์เซอร์ ไม่ตามภาษาแอป — ADR 0004 §6)
 * ปุ่มวัน aria-pressed ที่วันเริ่ม/จบ · วันที่ผิดกติกา aria-disabled + ข้ามโฟกัส · ลูกศรเลื่อนวันเป็นส่วนเสริม
 */
export function DateRangePicker({ mode, start, end, minDate, today, initialMonth, onPick }: DateRangePickerProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const [ym, setYm] = useState(() => ymOf(initialMonth));
  const model = buildMonth(ym.year, ym.month, today);
  const prev = shiftMonth(ym.year, ym.month, -1);
  const next = shiftMonth(ym.year, ym.month, 1);
  const monthTitle = format(`${ym.year}-${String(ym.month).padStart(2, "0")}-01`, { locale, style: "month-year" });
  const dow = weekdayLabels(locale, "short");
  const dowLong = weekdayLabels(locale, "long");

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
    const target = e.target as HTMLElement;
    const date = target.dataset.date;
    if (!delta || !date) return;
    const index = model.cells.findIndex((c) => c.date === date);
    const dest = model.cells[index + delta];
    if (!dest) return;
    e.preventDefault();
    e.currentTarget.querySelector<HTMLElement>(`[data-date="${dest.date}"]`)?.focus();
  }

  return (
    <div className="cal-picker" data-testid="busy-picker">
      <div className="cal-nav">
        <button type="button" className="icon-btn" aria-label={t("calendar.nav.prevMonth")} disabled={!prev} onClick={() => prev && setYm(prev)}>
          <Icon name="chevron-left" />
        </button>
        <h3 className="cal-picker-title">{monthTitle}</h3>
        <button type="button" className="icon-btn" aria-label={t("calendar.nav.nextMonth")} disabled={!next} onClick={() => next && setYm(next)}>
          <Icon name="chevron-right" />
        </button>
      </div>
      <div className="cal-month" role="group" aria-label={t("calendar.month.gridAria", { month: monthTitle })} onKeyDown={onKeyDown}>
        {DOW.map((d, i) => (
          <span className="cal-dow" key={d}>
            <span aria-hidden="true">{dow[i]}</span>
            <span className="sr-only">{dowLong[i]}</span>
          </span>
        ))}
        {model.cells.map((c) => {
          const isStart = c.date === start;
          const isEnd = c.date === end;
          const inRange = mode === "range" && start !== null && end !== null && c.date > start && c.date < end;
          const disabled = c.date < minDate;
          const cls = [
            "pk-cell",
            c.outside ? "is-outside" : "",
            c.today ? "is-today" : "",
            isStart ? "is-start" : "",
            isEnd ? "is-end" : "",
            isStart && start !== end ? "has-range" : "",
            inRange ? "is-range" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={c.date}
              className={cls}
              data-date={c.date}
              data-testid={`pk-${c.date}`}
              aria-label={format(c.date, { locale, style: "date-full" })}
              aria-pressed={isStart || isEnd}
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : undefined}
              onClick={() => {
                if (!disabled) onPick(c.date);
              }}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
