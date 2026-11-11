"use client";

import { useLocale, useTranslations } from "next-intl";
import { Cat } from "@/components/brand";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { format, type CalendarLocale, type DateISO } from "@/lib/calendar";
import { BUSY_ROUTINE_MAX_ACTIVE } from "@/lib/shared/limits";
import { canExtend, isEnded, nearRoutineLimit, splitRoutines, weekdaysText, type RoutineView } from "./routine-model";

/** สถานะโหลดของส่วน "แบบประจำของฉัน" — โหลด/ผิดพลาดเฉพาะส่วนนี้ ไม่ทำให้รายการ busy เดี่ยวหาย */
export type RoutineListState = { status: "loading" } | { status: "error" } | { status: "ready"; routines: RoutineView[]; truncated: boolean };

export interface RoutineListProps {
  state: RoutineListState;
  today: DateISO;
  onAdd: () => void;
  onRetry: () => void;
  /** แตะแถว = แก้ (sheet เลือกขอบเขต) */
  onEdit: (r: RoutineView) => void;
  onDelete: (r: RoutineView) => void;
  /** ต่ออายุ = เปิดฟอร์มแก้ "ทั้งหมดที่ยังไม่ถึง" โฟกัสช่อง "ถึง" */
  onExtend: (r: RoutineView) => void;
}

/**
 * ส่วน "แบบประจำของฉัน" ใต้รายการ busy เดี่ยว (design §3) — แถวละชุด: ชื่อ · วัน/เวลา · ช่วงวันที่ + เหลืออีก N วัน
 * ปุ่ม "ต่ออายุ" เมื่อเหลือ ≤ 14 วันหรือจบแล้ว · ถังขยะ = ลบ (ผ่าน sheet ขอบเขต) · ชุดที่จบแล้วแสดงต่อท้าย
 * ข้อมูลจาก GET /api/me/busy-routines (เจ้าของเท่านั้น)
 */
export function RoutineList({ state, today, onAdd, onRetry, onEdit, onDelete, onExtend }: RoutineListProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;

  return (
    <section className="rt-section" aria-labelledby="rt-mine-title" data-testid="routine-mine">
      <div className="rt-head">
        <h3 id="rt-mine-title">{t("busy.routine.mine.title")}</h3>
        <p className="small muted">{t("busy.routine.mine.lead")}</p>
      </div>
      {state.status === "loading" ? (
        <div aria-busy="true" data-testid="routine-mine-loading">
          <div className="skeleton cal-skel" />
          <p className="loading-note" role="status">
            {t("busy.routine.mine.loading")}
          </p>
        </div>
      ) : state.status === "error" ? (
        <div data-testid="routine-mine-error">
          <div className="alert" role="alert">
            <Icon name="circle-alert" />
            <div>
              <b>{t("busy.routine.mine.error.title")}</b>
              <span>{t("busy.routine.mine.error.body")}</span>
            </div>
          </div>
          <button type="button" className="btn btn-secondary cal-retry" onClick={onRetry}>
            <Icon name="refresh-cw" />
            <span>{t("states.retry")}</span>
          </button>
        </div>
      ) : state.routines.length === 0 ? (
        <div className="rt-empty" data-testid="routine-mine-empty">
          <Cat pose="sleep" size="md" />
          <b>{t("busy.routine.mine.empty.title")}</b>
          <p className="muted">{t("busy.routine.mine.empty.body")}</p>
          <button type="button" className="btn btn-secondary" data-testid="routine-add-empty" onClick={onAdd}>
            <Icon name="repeat" />
            <span>{t("busy.routine.add")}</span>
          </button>
        </div>
      ) : (
        <RoutineRows routines={state.routines} today={today} locale={locale} onEdit={onEdit} onDelete={onDelete} onExtend={onExtend} />
      )}
    </section>
  );
}

function RoutineRows({ routines, today, locale, onEdit, onDelete, onExtend }: { routines: RoutineView[]; today: DateISO; locale: CalendarLocale } & Pick<RoutineListProps, "onEdit" | "onDelete" | "onExtend">) {
  const t = useTranslations();
  const { active, ended } = splitRoutines(routines, today);
  const row = (r: RoutineView) => {
    const done = isEnded(r, today);
    const days = weekdaysText(t, r.weekdays);
    const when = r.allDay ? t("busy.routine.mine.whenAllDay", { days }) : t("busy.routine.mine.when", { days, time: `${r.startTime}–${r.endTime}` });
    const span = t("busy.routine.mine.span", { start: format(r.startDate, { locale, style: "date-medium" }), end: format(r.endDate, { locale, style: "date-medium" }) });
    const name = r.title && r.title !== "" ? r.title : null;
    return (
      <li key={r.id} className="rt-item" data-testid={`routine-row-${r.id}`} data-ended={done || undefined}>
        <button type="button" className="row rt-open" aria-label={t("busy.routine.mine.openAria", { title: name ?? t("busy.mine.noTitle"), days: when, span })} data-testid={`routine-open-${r.id}`} onClick={() => onEdit(r)}>
          <span className="row-main">
            {name ? (
              <span className="row-title">
                <Name>{name}</Name>
              </span>
            ) : (
              <span className="row-title plain">{t("busy.mine.noTitle")}</span>
            )}
            <span className="row-meta">{when}</span>
            <span className="row-meta">
              {span} ·{" "}
              <b className="rt-remaining" data-testid="routine-remaining">
                {done ? t("busy.routine.mine.ended") : t("busy.routine.mine.remaining", { count: r.remaining })}
              </b>
            </span>
            {r.hidden ? (
              <span className="tags">
                <span className="tag tag-muted">
                  <Icon name="eye-off" size="sm" />
                  <span>{t("busy.mine.hiddenTag")}</span>
                </span>
              </span>
            ) : null}
          </span>
          <Icon name="chevron-right" className="chev" />
        </button>
        <div className="rt-actions">
          {canExtend(r, today) ? (
            <button type="button" className="btn btn-secondary rt-extend" data-testid={`routine-extend-${r.id}`} onClick={() => onExtend(r)}>
              <Icon name="refresh-cw" size="sm" />
              <span>{t("busy.routine.mine.extend")}</span>
            </button>
          ) : null}
          <button type="button" className="icon-btn" aria-label={`${t("busy.form.delete")}: ${name ?? t("busy.mine.noTitle")}`} data-testid={`routine-delete-${r.id}`} onClick={() => onDelete(r)}>
            <Icon name="trash-2" />
          </button>
        </div>
      </li>
    );
  };
  return (
    <div data-testid="routine-mine-list">
      <p className="small muted cal-mine-count" role="status" data-testid="routine-count">
        {t("busy.routine.mine.count", { count: active.length })}
      </p>
      {nearRoutineLimit(active.length) ? (
        <p className="alert alert-warn" data-testid="routine-near">
          <Icon name="triangle-alert" />
          <span>{t("busy.routine.mine.limitNear", { count: active.length, max: BUSY_ROUTINE_MAX_ACTIVE })}</span>
        </p>
      ) : null}
      {active.length > 0 ? <ul className="rows busy-list rt-list">{active.map(row)}</ul> : null}
      {ended.length > 0 ? <ul className="rows busy-list rt-list rt-ended" data-testid="routine-ended-list">{ended.map(row)}</ul> : null}
    </div>
  );
}
