"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { format, toLocal, type CalendarLocale } from "@/lib/calendar";
import type { AppointmentDto } from "@/lib/data/serializers/appointments";
import { weekdayShort } from "@/components/shell/weekday";
import { ANSWER_ICON } from "./RsvpControl";
import { appointmentWhen, apptPhase, dateBox, hhmm, rowState } from "./model";

/** แถวนัดในรายการของกลุ่ม (X62): datebox · ชื่อ (ตัด …) · เวลา · จำนวนคนไป + คำตอบของฉัน · ยกเลิก = ขีดฆ่า + ป้ายไอคอน ban */
export function AppointmentRow({ a, nowMs }: { a: AppointmentDto; nowMs: number }) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const phase = apptPhase(a, nowMs);
  const box = dateBox(a.localDate, locale);
  const when = appointmentWhen(a, locale);
  const start = toLocal(a.startAt, a.tz);
  const whenPlain = `${weekdayShort(a.localDate, { locale })} ${format(a.localDate, { locale, style: "day-month" })} ${hhmm(start.minute)}`;
  const mine = a.rsvp.mine;
  const cls = phase === "cancelled" ? " is-cancelled" : phase === "past" ? " is-past" : "";
  return (
    <li>
      <Link
        className={`appt-row${cls}`}
        href={`/appointments/${a.id}`}
        aria-label={t("appointments.row.aria", { title: `⁨${a.title}⁩`, when: whenPlain, state: rowState(a) })}
        data-testid="appt-row"
        data-status={a.status}
        data-appt-id={a.id}
      >
        <span className="appt-datebox" aria-hidden="true">
          <span className="d">{box.day}</span>
          <span className="m">{box.month}</span>
        </span>
        <span className="appt-row-main" aria-hidden="true">
          <span className="appt-row-title">
            <Name>{a.title}</Name>
          </span>
          <span className="appt-row-meta">
            {weekdayShort(a.localDate, { locale })} · <span className="num">{t(when.key, when.values)}</span>
          </span>
          <span className="appt-row-pills">
            {phase === "cancelled" ? (
              <span className="tag tag-busy" data-testid="appt-row-cancelled">
                <Icon name="ban" size="sm" />
                <span>{t("appointments.status.cancelled")}</span>
              </span>
            ) : (
              <>
                <span>{t("appointments.rsvp.summary.going", { count: a.rsvp.counts.going })}</span>
                <span className="rsvp-pill" data-answer={mine ?? "none"}>
                  <Icon name={ANSWER_ICON[mine ?? "none"]} size="sm" />
                  {t(`appointments.rsvp.mine.${mine ?? "none"}`)}
                </span>
              </>
            )}
          </span>
        </span>
        <Icon name="chevron-right" className="chev" />
      </Link>
    </li>
  );
}
