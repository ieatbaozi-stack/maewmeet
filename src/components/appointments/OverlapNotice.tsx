"use client";

import { useTranslations } from "next-intl";
import { MemberAvatar } from "@/components/groups/MemberAvatar";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import type { OverlapPerson, OverlapView } from "./model";

/**
 * คำเตือน "คนอาจไม่ว่าง" (X55) — ไม่บล็อกการสร้างนัด · aria-live=polite (กล่องห่อมีอยู่เสมอเพื่อให้ผลที่เปลี่ยนถูกอ่าน)
 * unknown ไม่เคยบอกว่า "ไม่มีใครติด" · รายการซ่อน/ไม่ใส่ชื่อ = "ไม่ว่าง"
 */
export function OverlapNotice({ view, onRetry }: { view: OverlapView; onRetry: () => void }) {
  const t = useTranslations();
  return (
    <div aria-live="polite" data-testid="appt-overlap" data-state={view.kind}>
      {view.kind === "checking" ? (
        <div className="ov is-checking">
          <p className="ov-head">
            <Icon name="refresh-cw" size="sm" className="ov-spin" />
            <span>{t("appointments.overlap.checking")}</span>
          </p>
        </div>
      ) : null}
      {view.kind === "clear" ? (
        <div className="ov is-clear">
          <p className="ov-head">
            <Icon name="circle-check" size="sm" />
            <span>{t("appointments.overlap.clear")}</span>
          </p>
        </div>
      ) : null}
      {view.kind === "error" ? (
        <div className="ov is-error">
          <p className="ov-head">
            <Icon name="info" size="sm" />
            <span>{t("appointments.overlap.error")}</span>
          </p>
          <button type="button" className="btn btn-secondary ov-retry" data-testid="appt-overlap-retry" onClick={onRetry}>
            <Icon name="refresh-cw" size="sm" />
            <span>{t("states.retry")}</span>
          </button>
        </div>
      ) : null}
      {view.kind === "warn" ? (
        <div className="ov is-warn">
          <p className="ov-head">
            <Icon name="triangle-alert" size="sm" />
            <span>{t("appointments.overlap.title", { count: view.total })}</span>
          </p>
          <People people={view.people} more={view.more} />
          <p className="ov-body">{t("appointments.overlap.nonBlocking")}</p>
          <p className="ov-body">{t("availability.explain")}</p>
        </div>
      ) : null}
      {view.kind === "unknown" ? (
        <div className="ov is-unknown">
          <p className="ov-head">
            <Icon name="triangle-alert" size="sm" />
            <span>{t("appointments.overlap.unknown.title")}</span>
          </p>
          <p className="ov-body">{t("appointments.overlap.unknown.body")}</p>
          {view.people.length > 0 ? (
            <>
              <People people={view.people} more={view.more} />
              <p className="ov-body">{t("availability.explain")}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function People({ people, more }: { people: OverlapPerson[]; more: number }) {
  const t = useTranslations();
  return (
    <>
      <ul className="ov-list" aria-label={t("appointments.overlap.groupAria")} data-testid="appt-overlap-list">
        {people.map((p) => (
          <li key={p.userId} data-testid="appt-overlap-person">
            <MemberAvatar displayName={p.displayName} colorIndex={p.colorIndex} shapeIndex={p.shapeIndex} size="sm" />
            <span className="ov-who">
              <span className="ov-name">
                <Name>{p.displayName}</Name>
                {p.you ? <span className="you">({t("group.members.you")})</span> : null}
              </span>
              {p.rows.map((r) => (
                <span className="ov-why" key={r.key}>
                  <span className="num">{t(r.when.key, r.when.values)}</span>
                  {" · "}
                  {r.title !== null ? (
                    <span className="t">
                      <Name>{r.title}</Name>
                    </span>
                  ) : (
                    <span className="t">{t("calendar.day.busyPlain")}</span>
                  )}
                </span>
              ))}
              {p.moreRows > 0 ? <span className="ov-why">{t("appointments.overlap.more", { count: p.moreRows })}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="ov-more">{t("appointments.overlap.more", { count: more })}</p> : null}
    </>
  );
}
