"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MemberAvatar } from "@/components/groups/MemberAvatar";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import type { CalendarLocale } from "@/lib/calendar";
import { dayBlockers, durationMsg, longestSegment, namesOf, statusVariant, type AvData, type AvDay } from "./model";
import { namesSentence } from "./FreeSummary";

export interface FreeDetailProps {
  day: AvDay;
  data: AvData;
  myId: string;
  /** sheet = ข้อความคำอธิบายปุ่มอยู่ในเนื้อหา (ปุ่มอยู่ท้าย sheet) · panel = ปุ่ม + คำอธิบายอยู่ท้ายแผง */
  variant: "sheet" | "panel";
  /** id ของข้อความอธิบายปุ่ม "สร้างนัด" (aria-describedby) */
  hintId: string;
}

/** ปุ่ม "สร้างนัด" ที่ยังไม่เปิดใช้ (R4B, X45): aria-disabled ไม่ใช่ disabled → โฟกัส/อ่านคำอธิบายได้ · กดแล้วไม่เกิดอะไร */
export function CreateCta({ hintId, withHint }: { hintId: string; withHint: boolean }) {
  const t = useTranslations("availability.cta");
  return (
    <div className="av-cta">
      <button type="button" className="btn btn-secondary" aria-disabled="true" aria-describedby={hintId} data-testid="free-create" onClick={(e) => e.preventDefault()}>
        <Icon name="calendar" />
        <span>{t("create")}</span>
        <span className="tag soon">{t("soon")}</span>
      </button>
      {withHint ? (
        <p className="av-hint" id={hintId}>
          {t("soonHint")}
        </p>
      ) : null}
    </div>
  );
}

/** เนื้อหารายละเอียดวัน (X39–X43): กล่องสถานะ → ช่วงว่างร่วม → ใครไม่ว่างเมื่อไร → ที่มาของผล */
export function FreeDetail({ day, data, myId, variant, hintId }: FreeDetailProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const uid = useId();
  const variantName = statusVariant(day);
  const minDur = durationMsg(data.group.minFreeMinutes);
  const minDurText = t(minDur.key, minDur.values);
  const longest = longestSegment(day.segments);
  const { rows, noBusy } = dayBlockers(day, data.members, data.group.tz, data.busy);
  const flaggedAny = rows.some((r) => r.flagged);
  const notFreeNames = namesOf(day.notFreeUserIds, data.members);

  return (
    <div className="av-detail-body" data-testid="free-detail" data-date={day.date} data-status={variantName}>
      <div className={`av-status is-${variantName}`} role="status" data-testid="free-status">
        {variantName === "all" ? (
          <span className="av-badge" aria-hidden="true">
            <Icon name="check" />
          </span>
        ) : (
          <span className="ico" aria-hidden="true">
            <Icon name={variantName === "partial" ? "users" : variantName === "nocommon" ? "circle-dashed" : "ban"} />
          </span>
        )}
        <div>
          {variantName === "all" ? (
            <>
              <b>{t("availability.day.status.all")}</b>
              <span>{t("availability.day.status.allBody", { total: day.totalMembers })}</span>
            </>
          ) : variantName === "partial" ? (
            <>
              <b>{t("availability.day.status.partial", { free: day.freeMembers, total: day.totalMembers })}</b>
              <span>{namesSentence(t, locale, "availability.day.status.partialBody", notFreeNames)}</span>
            </>
          ) : variantName === "nocommon" ? (
            <>
              <b>{t("availability.day.status.nocommon")}</b>
              <span>{t("availability.day.status.nocommonBody", { duration: minDurText })}</span>
            </>
          ) : (
            <>
              <b>{t("availability.day.status.none")}</b>
              <span>{t("availability.day.status.noneBody", { duration: minDurText })}</span>
            </>
          )}
        </div>
      </div>

      {day.segments.length > 0 ? (
        <>
          <h3 className="sub" id={`${uid}-seg`}>
            {t("availability.day.segments.title")}
          </h3>
          <ul className="av-segs" aria-labelledby={`${uid}-seg`} data-testid="free-segments">
            {day.segments.map((s) => {
              const dur = durationMsg(Math.round((s.endAt - s.startAt) / 60_000));
              return (
                <li className="av-seg" key={s.startAt} data-testid="free-segment">
                  <Icon name="clock" size="sm" />
                  <span className="tm">{t("availability.day.segments.row", { start: s.start, end: s.end })}</span>
                  <span className="du">{t(dur.key, dur.values)}</span>
                  {day.segments.length >= 2 && longest === s ? <span className="tag" data-testid="free-longest">{t("availability.day.segments.longest")}</span> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <h3 className="sub" id={`${uid}-bl`}>
        {t("availability.day.blockers.title")}
      </h3>
      {rows.length > 0 ? (
        <ul className="cal-people" aria-labelledby={`${uid}-bl`} data-testid="free-blockers">
          {rows.map(({ member, flagged, entries }) => (
            <li className="cal-person" key={member.userId} data-testid={`free-blocker-${member.userId}`} data-flagged={flagged ? "true" : undefined}>
              <MemberAvatar displayName={member.displayName} colorIndex={member.colorIndex} size="sm" />
              <span className="pn">
                <span>
                  <Name>{member.displayName}</Name>
                  {member.userId === myId ? <span className="you small muted">{t("group.members.you")}</span> : null}
                </span>
                {flagged ? (
                  <span className="tag tag-busy av-flag" data-testid="free-flag">
                    <Icon name="ban" size="sm" />
                    <span>{t("availability.day.blockers.flag")}</span>
                  </span>
                ) : null}
              </span>
              <div className="items">
                {entries.map((en) => (
                  <div className="cal-item" key={en.key} data-testid="free-item">
                    <span className="when">{t(en.when.key, en.when.values)}</span>
                    {en.title ? (
                      <span className="what">
                        <Name>{en.title}</Name>
                      </span>
                    ) : (
                      <span className="what plain">{t("calendar.day.busyPlain")}</span>
                    )}
                    {en.dayOf ? <span className="sub">{t(en.dayOf.key, en.dayOf.values)}</span> : null}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="av-hint" data-testid="free-blockers-empty">
          {t("availability.day.blockers.empty")}
        </p>
      )}
      {flaggedAny ? <p className="av-hint">{t("availability.day.blockers.flagHint", { duration: minDurText })}</p> : null}
      {noBusy.length > 0 ? (
        <p className="cal-others" data-testid="free-nobusy">
          {namesSentence(t, locale, "availability.day.blockers.noBusy", noBusy.map((m) => m.displayName))}
        </p>
      ) : null}

      <p className="av-info">
        <Icon name="info" size="sm" />
        <span>{t("availability.explain")}</span>
      </p>
      {variant === "sheet" ? (
        <p className="av-hint" id={hintId}>
          {t("availability.cta.soonHint")}
        </p>
      ) : (
        <CreateCta hintId={hintId} withHint />
      )}
    </div>
  );
}
