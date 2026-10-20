"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { withNames } from "@/components/Name";
import { joinNames, type MemberInfo } from "@/components/calendar/model";
import { format, type CalendarLocale, type DateISO } from "@/lib/calendar";
import { durationMsg, nameParts, namesOf, segmentMinutes, weekdayDate, type Summary } from "./model";

type T = ReturnType<typeof useTranslations>;

/**
 * ประโยคที่มี {names} ตามกติกาชื่อ (UX §8.5): ≤ 3 คน = เชื่อมด้วยคำเชื่อมของภาษา (joinNames — ไม่ใช้ Intl.ListFormat เพราะ ICU เซิร์ฟเวอร์/เบราว์เซอร์ต่างกัน → hydrate ไม่ตรง)
 * > 3 คน = 3 ชื่อแรกคั่น ", " + "และอีก N คน" · ชื่อครอบ <bdi> ด้วย withNames
 */
export function namesSentence(t: T, locale: CalendarLocale, key: string, names: readonly string[]): React.ReactNode {
  const { shown, more } = nameParts(names);
  const joined = more > 0 ? shown.join(", ") : joinNames(shown, t("calendar.day.listAnd"), locale);
  return withNames((n) => t(key, { names: more > 0 ? t("availability.day.names.more", { names: n.names, count: more }) : n.names }), { names: joined });
}

export interface FreeSummaryProps {
  summary: Summary;
  members: readonly MemberInfo[];
  /** ผู้ที่ปรับตั้งค่ากลุ่มได้ → ลิงก์ "ปรับช่วงเวลา" */
  canEditWindow: boolean;
  gid: string;
  onOpenDay: (date: DateISO) => void;
  onNextMonth: (() => void) | null;
}

/**
 * การ์ดสรุปบนสุด (X37): พบวันว่างร่วม = การ์ดเขียวแตะได้ (เปิดรายละเอียดวันนั้น) · ไม่พบ = การ์ดกลาง + วันใกล้เคียง + [ดูเดือนถัดไป] + ลิงก์ปรับช่วงเวลา
 */
export function FreeSummary({ summary, members, canEditWindow, gid, onOpenDay, onNextMonth }: FreeSummaryProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;

  if (summary.kind === "first") {
    const { day, longest, relativeDays, count } = summary;
    const dur = durationMsg(segmentMinutes(longest));
    return (
      <button
        type="button"
        className="av-summary"
        data-testid="free-summary"
        data-date={day.date}
        aria-label={t("availability.summary.openAria", { date: format(day.date, { locale, style: "date-full" }) })}
        onClick={() => onOpenDay(day.date)}
      >
        <span className="av-badge" aria-hidden="true">
          <Icon name="check" />
        </span>
        <span>
          <span className="st">{t("availability.summary.title")}</span>
          <span className="when">
            <b suppressHydrationWarning>{weekdayDate(day.date, locale, "long")}</b>
            <span className="rel">{t("availability.summary.relative", { days: relativeDays })}</span>
          </span>
          <span className="best">{t("availability.summary.best", { start: longest.start, end: longest.end, duration: t(dur.key, dur.values) })}</span>
          {count >= 2 ? <span className="more">{t("availability.summary.count", { count })}</span> : null}
        </span>
        <Icon name="chevron-right" className="chev" />
      </button>
    );
  }

  const { closest } = summary;
  return (
    <section className="av-summary is-none" role="status" data-testid="free-summary-none">
      <span className="st">{t("availability.summary.none.title")}</span>
      {closest ? (
        <>
          <p className="hl" suppressHydrationWarning>
            {summary.closestNoOverlap
              ? t("availability.summary.none.closestNoOverlap", { date: weekdayDate(closest.date, locale, "short") })
              : t("availability.summary.none.closest", { date: weekdayDate(closest.date, locale, "short"), free: closest.freeMembers, total: closest.totalMembers })}
          </p>
          {!summary.closestNoOverlap && summary.closestBlockerIds.length > 0 ? (
            <p>{namesSentence(t, locale, "availability.summary.none.blockers", namesOf(summary.closestBlockerIds, members))}</p>
          ) : null}
        </>
      ) : null}
      <div className="actions">
        {onNextMonth ? (
          <button type="button" className="btn btn-secondary" data-testid="free-next-month" onClick={onNextMonth}>
            <span>{t("availability.summary.none.next")}</span>
            <Icon name="chevron-right" />
          </button>
        ) : null}
        {canEditWindow ? (
          <Link className="av-link" href={`/groups/${gid}/settings#window`} aria-label={t("availability.window.editAria")} data-testid="free-window-edit-top">
            {t("availability.window.edit")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
