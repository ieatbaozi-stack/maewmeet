"use client";

import { useId, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Cat } from "@/components/brand";
import { MemberAvatar } from "@/components/groups/MemberAvatar";
import { memberSlot } from "@/components/groups/helpers";
import { Icon } from "@/components/icons/Icon";
import { Name, withNames } from "@/components/Name";
import { format, type CalendarLocale, type DateISO } from "@/lib/calendar";
import { BusyItemLine } from "./BusyItemLine";
import { busyKindOf, dayRows, itemApptHref, joinNames, nowPercent, segmentLabel, segmentTitle, stripBox, type ItemSpan, type MemberInfo } from "./model";

const AXIS = [0, 6, 12, 18, 24] as const;

export interface DayPanelProps {
  date: DateISO;
  today: DateISO;
  members: readonly MemberInfo[];
  spans: readonly ItemSpan[];
  myId: string;
  /** นาทีปัจจุบันในวันนี้ของกลุ่ม (null = ไม่แสดงเส้น "ตอนนี้") */
  nowMinute: number | null;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onAdd: () => void;
}

/**
 * มุมมองวัน (UX X26–X29): หัววัน + ปุ่มก่อน/ถัด/วันนี้ · "ติด N จาก M คน" · แถบเวลา 00–24 ต่อสมาชิก (aria-hidden — ข้อมูลเดียวกันอยู่ในรายการข้อความ) ·
 * รายการ "ใครไม่ว่างเมื่อไร" · รายการซ่อน/ไม่ได้ใส่ → "ไม่ว่าง" · คนที่ไม่มีรายการ = "ไม่ได้ลงว่าติด" (ไม่ใช่ "ว่าง" — X29)
 */
export function DayPanel({ date, today, members, spans, myId, nowMinute, onPrev, onNext, onToday, onAdd }: DayPanelProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const uid = useId();
  const rows = dayRows(members, spans, date);
  const busyRows = rows.filter((r) => r.segments.length > 0);
  const idle = rows.filter((r) => r.segments.length === 0).map((r) => r.member.displayName);

  return (
    <div className="cal-day" data-testid="cal-day-panel" data-date={date}>
      <div className="cal-day-head">
        {/* ICU ของ Node กับเบราว์เซอร์จัดรูปแบบวันที่เต็มของอังกฤษไม่เหมือนกัน ("Friday, 23" vs "Friday 23") — ข้อความนี้มาจาก Intl จึงข้ามการเตือน hydrate */}
        <h2 data-testid="cal-day-title" suppressHydrationWarning>{format(date, { locale, style: "date-full" })}</h2>
        <button type="button" className="icon-btn" aria-label={t("calendar.nav.prevDay")} data-testid="cal-day-prev" onClick={onPrev}>
          <Icon name="chevron-left" />
        </button>
        <button type="button" className="icon-btn" aria-label={t("calendar.nav.nextDay")} data-testid="cal-day-next" onClick={onNext}>
          <Icon name="chevron-right" />
        </button>
        <button type="button" className="btn btn-secondary" aria-label={t("calendar.nav.todayAria")} data-testid="cal-day-today" onClick={onToday}>
          {t("calendar.nav.today")}
        </button>
      </div>
      <p className="cal-summary" role="status" data-testid="cal-day-summary">
        {t("calendar.day.summary", { count: busyRows.length, total: members.length })}
      </p>

      <section className="cal-card" aria-labelledby={`${uid}-tl`}>
        <h3 id={`${uid}-tl`}>{t("calendar.day.timeline")}</h3>
        <div className="cal-axis" aria-hidden="true">
          {AXIS.map((h) => (
            <span key={h} style={{ "--at": `${(h / 24) * 100}%` } as CSSProperties}>
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
        <div className="cal-rows">
          {rows.map(({ member, segments }) => (
            <div className="cal-row" key={member.userId} data-testid={`cal-strip-${member.userId}`}>
              <span className="cal-name">
                <MemberAvatar displayName={member.displayName} colorIndex={member.colorIndex} shapeIndex={member.shapeIndex} size="sm" />
                <span className="nm">
                  <Name>{member.displayName}</Name>
                </span>
              </span>
              <span className="cal-track" aria-hidden="true">
                {segments.map((seg) => {
                  const box = stripBox(seg);
                  return (
                    <span
                      key={`${seg.item.id}-${seg.from}`}
                      className={["cal-bar", seg.cutStart ? "cut-start" : "", seg.cutEnd ? "cut-end" : "", `kind-${busyKindOf(seg.item)}`].filter(Boolean).join(" ")}
                      data-kind={busyKindOf(seg.item)}
                      data-color={memberSlot(member.colorIndex)} data-shape={memberSlot(member.shapeIndex)}
                      data-testid="cal-bar"
                      style={{ "--s": box.start, "--w": box.width } as CSSProperties}
                    />
                  );
                })}
              </span>
            </div>
          ))}
          {nowMinute !== null ? (
            <div className="cal-now-layer" aria-hidden="true">
              <span className="cal-now-tag" style={{ "--at": nowPercent(nowMinute) } as CSSProperties}>
                {t("calendar.day.now")}
              </span>
              <span className="cal-now" style={{ "--at": nowPercent(nowMinute) } as CSSProperties} />
            </div>
          ) : null}
        </div>
        <p className="hint-line">{t("calendar.day.timelineHint")}</p>
      </section>

      {busyRows.length > 0 ? (
        <section className="cal-card" aria-labelledby={`${uid}-ls`}>
          <h3 id={`${uid}-ls`}>{t("calendar.day.listTitle")}</h3>
          <ul className="cal-people" data-testid="cal-people">
            {busyRows.map(({ member, segments }) => (
              <li className="cal-person" key={member.userId} data-testid={`cal-person-${member.userId}`}>
                <MemberAvatar displayName={member.displayName} colorIndex={member.colorIndex} shapeIndex={member.shapeIndex} size="sm" />
                <span className="pn">
                  <Name>{member.displayName}</Name>
                  {member.userId === myId ? <span className="you small muted">{t("group.members.you")}</span> : null}
                </span>
                <div className="items">
                  {segments.map((seg) => {
                    const label = segmentLabel(seg);
                    const title = segmentTitle(seg);
                    return (
                      <BusyItemLine
                        key={`${seg.item.id}-${seg.from}`}
                        kind={busyKindOf(seg.item)}
                        whenText={t(label.ref.key, label.ref.values)}
                        title={title}
                        memberName={member.displayName}
                        href={itemApptHref(seg.item)}
                        subText={label.dayOf ? t(label.dayOf.key, label.dayOf.values) : null}
                        busyTestId="cal-item"
                      />
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
          {idle.length > 0 ? (
            <p className="cal-others" data-testid="cal-others">
              {withNames((n) => t("calendar.day.othersFree", { names: n.names }), { names: joinNames(idle, t("calendar.day.listAnd"), locale) })}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="empty panel cal-empty-day" data-testid="cal-day-empty">
          <Cat pose="calendar" size="md" />
          <h3 className="h-section">{t("calendar.day.empty.title", { when: date === today ? "today" : "other" })}</h3>
          <p className="muted">{t("calendar.day.empty.body")}</p>
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            <Icon name="plus" />
            <span>{t("busy.add")}</span>
          </button>
        </section>
      )}
    </div>
  );
}
