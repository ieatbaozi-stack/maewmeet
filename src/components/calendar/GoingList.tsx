"use client";

import Link from "next/link";
import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { goingWhen } from "@/components/appointments/model";
import { Icon } from "@/components/icons/Icon";
import { withNames } from "@/components/Name";
import { weekdayShort } from "@/components/shell/weekday";
import { toLocal, type CalendarLocale } from "@/lib/calendar";
import type { AppointmentDto } from "@/lib/data/serializers/appointments";

export interface GoingListProps {
  /** นัดที่ฉันตอบ "ไป" (GET /api/me/appointments?rsvp=going) · null = โหลดไม่สำเร็จ */
  items: readonly AppointmentDto[] | null;
  onRetry: () => void;
}

/**
 * แท็บ "ของฉัน" ส่อง "นัดที่ฉันตอบไป" (R6D): อ่านอย่างเดียว — ทั้งแถวเป็นลิงก์ไปหน้านัด ไม่มีปุ่มแก้/ลบที่นี่
 * (การแก้คำตอบ/เวลาทำที่หน้านัด) · แสดงชื่อกลุ่มของตัวเอง (เห็นเฉพาะเจ้าตัว)
 */
export function GoingList({ items, onRetry }: GoingListProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const uid = useId();
  return (
    <section className="busy-going" aria-labelledby={`${uid}-h`} data-testid="mine-going-section">
      <h3 className="busy-going-title" id={`${uid}-h`}>
        {t("busy.mine.going.title")}
      </h3>
      <p className="small muted">{t("busy.mine.going.lead")}</p>
      {items === null ? (
        <div data-testid="mine-going-error">
          <p className="alert alert-warn" role="alert">
            <Icon name="circle-alert" />
            <span>{t("busy.mine.error.title")}</span>
          </p>
          <button type="button" className="btn btn-secondary cal-retry" onClick={onRetry}>
            <Icon name="refresh-cw" />
            <span>{t("states.retry")}</span>
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="muted busy-going-empty" data-testid="mine-going-empty">
          {t("busy.mine.going.empty")}
        </p>
      ) : (
        <>
          <ul className="rows busy-list" data-testid="mine-going-list">
            {items.map((a) => {
              const w = goingWhen(a, locale);
              const whenText = t(w.key, w.values);
              const first = toLocal(a.startAt, a.tz).date;
              return (
                <li key={a.id}>
                  <Link
                    className="row"
                    href={`/appointments/${encodeURIComponent(a.id)}`}
                    aria-label={t("busy.mine.going.openAria", { title: a.title, group: a.groupName, when: whenText })}
                    data-testid="mine-going-row"
                    data-appt-id={a.id}
                  >
                    <span className="datebox" aria-hidden="true">
                      <span className="d">{Number(first.slice(8, 10))}</span>
                      <span className="m">{weekdayShort(first, { locale })}</span>
                    </span>
                    <span className="row-main">
                      <span className="row-title">{withNames((n) => t("busy.mine.going.row", { title: n.title, group: n.group }), { title: a.title, group: a.groupName })}</span>
                      <span className="row-meta">{whenText}</span>
                    </span>
                    <Icon name="chevron-right" className="chev" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="small muted busy-going-note">{t("busy.mine.going.editNote")}</p>
        </>
      )}
    </section>
  );
}
