"use client";

import { useLocale, useTranslations } from "next-intl";
import { Cat } from "@/components/brand";
import { Icon } from "@/components/icons/Icon";
import { weekdayShort } from "@/components/shell/weekday";
import { Name } from "@/components/Name";
import { format, type CalendarLocale, type EpochMs } from "@/lib/calendar";
import { BUSY_MAX_PER_USER } from "@/lib/shared/limits";
import { groupMineByMonth, isOngoing, nearLimit, whenPartsOfOwn, whenRef, type OwnBusy } from "./model";

export interface MineListProps {
  items: readonly OwnBusy[];
  nowMs: EpochMs;
  onOpen: (item: OwnBusy) => void;
  onAdd: () => void;
}

/** "ของฉัน" (UX X32): รายการช่วงไม่ว่างที่ยังไม่สิ้นสุด ใช้ทุกกลุ่ม · แตะแถว = เปิดฟอร์มแก้ไข */
export function MineList({ items, nowMs, onOpen, onAdd }: MineListProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;

  if (items.length === 0) {
    return (
      <section className="empty panel" data-testid="busy-mine-empty">
        <Cat pose="sleep" size="lg" />
        <h3 className="h-section">{t("busy.mine.empty.title")}</h3>
        <p className="muted">{t("busy.mine.empty.body")}</p>
        <button type="button" className="btn btn-primary" onClick={onAdd}>
          <Icon name="plus" />
          <span>{t("busy.add")}</span>
        </button>
      </section>
    );
  }

  return (
    <div data-testid="busy-mine-list">
      <p className="small muted cal-mine-count" role="status">
        {t("busy.mine.count", { count: items.length })}
      </p>
      {nearLimit(items.length, BUSY_MAX_PER_USER) ? (
        <p className="alert alert-warn" data-testid="busy-mine-near">
          <Icon name="triangle-alert" />
          <span>{t("busy.mine.limitNear", { count: items.length, max: BUSY_MAX_PER_USER })}</span>
        </p>
      ) : null}
      {groupMineByMonth(items).map((g) => (
        <section key={g.month} aria-labelledby={`mine-${g.month}`}>
          <h3 className="busy-month" id={`mine-${g.month}`}>
            {format(g.month, { locale, style: "month-year" })}
          </h3>
          <ul className="rows busy-list">
            {g.items.map((it) => {
              const parts = whenPartsOfOwn(it);
              const when = whenRef(parts, locale);
              const whenText = t(when.key, when.values);
              const first = parts.startDate;
              const ongoing = isOngoing(it, nowMs);
              const title = it.title && it.title !== "" ? it.title : null;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    className="row"
                    data-testid={`busy-row-${it.id}`}
                    aria-label={t("busy.mine.openAria", { title: title ?? t("busy.mine.noTitle"), when: whenText })}
                    onClick={() => onOpen(it)}
                  >
                    <span className="datebox" aria-hidden="true">
                      <span className="d">{Number(first.slice(8, 10))}</span>
                      <span className="m">{weekdayShort(first, { locale })}</span>
                    </span>
                    <span className="row-main">
                      {title ? (
                        <span className="row-title">
                          <Name>{title}</Name>
                        </span>
                      ) : (
                        <span className="row-title plain">{t("busy.mine.noTitle")}</span>
                      )}
                      <span className="row-meta">{whenText}</span>
                      {ongoing || it.hidden || it.note || it.seriesId ? (
                        <span className="tags">
                          {ongoing ? (
                            <span className="tag tag-busy">
                              <Icon name="clock" size="sm" />
                              <span>{t("busy.mine.ongoing")}</span>
                            </span>
                          ) : null}
                          {it.hidden ? (
                            <span className="tag tag-muted">
                              <Icon name="eye-off" size="sm" />
                              <span>{t("busy.mine.hiddenTag")}</span>
                            </span>
                          ) : null}
                          {it.seriesId ? (
                            <span className="tag tag-muted" aria-label={t("busy.series.tagAria")} data-testid="busy-series-tag">
                              <Icon name="calendar" size="sm" />
                              <span>{t("busy.series.tag")}</span>
                            </span>
                          ) : null}
                          {it.note ? (
                            <span className="tag tag-muted">
                              <Icon name="lock" size="sm" />
                              <span>{t("busy.mine.hasNote")}</span>
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                    <Icon name="chevron-right" className="chev" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
