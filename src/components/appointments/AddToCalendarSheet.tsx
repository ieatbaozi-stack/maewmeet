"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { Sheet } from "@/components/shell/Sheet";
import { googleCalendarUrl } from "@/lib/calendar";
import { calendarIcsHref, calendarOpenExternalHref, calendarSheetMode, type CalendarOption, type CalendarSheetMode } from "./model";

export interface AddToCalendarSheetProps {
  appointment: { id: string; title: string; placeName: string | null; mapUrl: string | null; startAt: number; endAt: number; tz: string };
  /** origin ของแอป ไม่มี `/` ท้าย (จาก page.tsx) */
  appOrigin: string;
  onClose: () => void;
}

/** sheet นี้ mount เฉพาะตอนเปิด (ฝั่ง client) จึงอ่าน navigator ได้โดยไม่ทำให้ hydrate ไม่ตรง */
function detectMode(): CalendarSheetMode {
  if (typeof navigator === "undefined") return { kind: "options", order: ["google", "ics"] };
  return calendarSheetMode(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

/** R12 §4.2/§4.4 — เลือกปลายทางเพิ่มนัดลงปฏิทิน · ลิงก์ล้วน ไม่มี fetch จึงไม่มี loading/error */
export function AddToCalendarSheet({ appointment: a, appOrigin, onClose }: AddToCalendarSheetProps) {
  const t = useTranslations("appointments.calendar");
  const uid = useId();
  const [mode] = useState<CalendarSheetMode>(detectMode);
  const noteId = `${uid}-gn`;

  const row = (option: CalendarOption, primary: boolean) => {
    const cls = `btn ${primary ? "btn-primary" : "btn-secondary"} cal-add-row`;
    if (option === "ics") {
      return (
        <a key="ics" className={cls} href={calendarIcsHref(a.id)} data-testid="cal-add-ics">
          <Icon name="calendar-plus" />
          <span>{t("device")}</span>
        </a>
      );
    }
    return (
      <div className="cal-add-item" key="google">
        <a className={cls} href={googleCalendarUrl({ id: a.id, title: a.title, placeName: a.placeName, mapUrl: a.mapUrl, startAt: a.startAt, endAt: a.endAt, tz: a.tz, appOrigin, labels: { map: t("labelMap"), plan: t("labelPlan") } })} target="_blank" rel="noopener noreferrer" aria-describedby={noteId} data-testid="cal-add-google">
          <Icon name="external-link" />
          <span>{t("google")}</span>
        </a>
        <p className="cal-add-note" id={noteId} data-testid="cal-add-google-note">
          {t("googleNote")}
        </p>
      </div>
    );
  };

  return (
    <Sheet title={t("sheetTitle")} onClose={onClose}>
      <div className="cal-add" data-testid="cal-add-sheet" data-mode={mode.kind === "line" ? "line" : mode.order[0]}>
        <div className="cal-add-once" data-testid="cal-add-onetime">
          <Icon name="info" />
          <p>{t("oneTime")}</p>
        </div>
        {mode.kind === "line" ? (
          <>
            <p className="cal-add-note" data-testid="cal-add-line-hint">
              {t("lineHint")}
            </p>
            <a className="btn btn-primary cal-add-row" href={calendarOpenExternalHref(a.id)} data-testid="cal-add-line-open">
              <Icon name="external-link" />
              <span>{t("lineOpen")}</span>
            </a>
          </>
        ) : (
          mode.order.map((o, i) => row(o, i === 0))
        )}
      </div>
    </Sheet>
  );
}
