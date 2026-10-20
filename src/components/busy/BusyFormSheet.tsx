"use client";

import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { Cat } from "@/components/brand";
import { whenRef, type OwnBusy } from "@/components/calendar/model";
import { ConfirmDialog } from "@/components/groups/ConfirmDialog";
import { failureRef } from "@/components/groups/errors";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { Sheet } from "@/components/shell/Sheet";
import type { CalendarLocale, DateISO } from "@/lib/calendar";
import { DateRangePicker } from "./DateRangePicker";
import {
  NOTE_MAX,
  TIME_OPTIONS,
  TITLE_MAX,
  buildPayload,
  durationRef,
  formStateOfOwn,
  initialFormState,
  mapSaveFailure,
  minPickDate,
  pickDate,
  resolveTimedEnd,
  timedMinutes,
  totalDays,
  type BusyFormState,
  type BusyKindChoice,
  type FormProblem,
} from "./form-model";
import { hasSeenNotice, markNoticeSeen, subscribeNotice } from "./notice";

export type BusyDone = "created" | "updated" | "deleted" | "gone";

export interface BusyFormSheetProps {
  /** รายการที่แก้ (null = ลงใหม่) */
  edit: OwnBusy | null;
  /** ลงใหม่: วันที่ตั้งต้น */
  defaultDate: DateISO;
  /** วันนี้ (ใช้คำนวณวันแรกที่เลือกได้ = วันนี้ − 7) */
  today: DateISO;
  /** จำนวนกลุ่มของผู้ใช้ (บรรทัดความเป็นส่วนตัว) */
  groupCount: number;
  userId: string;
  onClose: () => void;
  onDone: (result: BusyDone) => void;
}

interface Problems {
  date: FormProblem | null;
  time: FormProblem | null;
  banner: FormProblem | null;
}
const NO_PROBLEMS: Problems = { date: null, time: null, banner: null };

const KINDS: readonly BusyKindChoice[] = ["allDay", "timed", "multi"];
const HELP_KEY: Record<BusyKindChoice, string> = { allDay: "allDay", timed: "timed", multi: "multi" };
const PICK_HINT: Record<BusyKindChoice, string> = { allDay: "pick", timed: "pickTimed", multi: "pickRange" };

const clip = (v: string, max: number): string => {
  const chars = [...v];
  return chars.length > max ? chars.slice(0, max).join("") : v;
};

/** ฟอร์มลง/แก้ช่วงไม่ว่าง (UX §7 X30–X33) — sheet สูง · ทุกข้อความมาจาก messages · วันที่ส่ง ISO ค.ศ. */
export function BusyFormSheet({ edit, defaultDate, today, groupCount, userId, onClose, onDone }: BusyFormSheetProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const uid = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  const minDate = minPickDate(today);
  const [s, setS] = useState<BusyFormState>(() => (edit ? formStateOfOwn(edit) : initialFormState(defaultDate < minDate ? today : defaultDate)));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const [invalid, setInvalid] = useState({ date: false, time: false });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ประกาศครั้งแรก: SSR/ก่อนอ่าน storage ถือว่า "เห็นแล้ว" (ไม่กระพริบ) · ใช้เฉพาะตอนลงใหม่
  const seen = useSyncExternalStore(
    subscribeNotice,
    () => hasSeenNotice(userId),
    () => true,
  );
  const showNotice = edit === null && !seen;

  const text = (ref: { key: string; values: Record<string, string | number> }) => t(ref.key, ref.values);

  function patch(next: Partial<BusyFormState>) {
    setS((cur) => ({ ...cur, ...next }));
    setProblems(NO_PROBLEMS);
    setInvalid({ date: false, time: false });
  }

  function chooseKind(kind: BusyKindChoice) {
    if (kind === s.kind) return;
    setPending(false);
    patch({ kind, ...(kind === "allDay" && s.pickStart ? { pickEnd: s.pickStart } : {}) });
    setPickerOpen(kind !== "timed");
  }

  function onPick(date: DateISO) {
    const res = pickDate(s.kind === "allDay" ? "single" : "range", { start: s.pickStart, end: s.pickEnd, pending }, date);
    patch({ pickStart: res.start, pickEnd: res.end });
    setPending(res.pending);
    if (res.done) setPickerOpen(false);
  }

  // ───────── สรุปวัน/เวลา ─────────
  const endInfo = s.kind === "timed" ? resolveTimedEnd(s) : null;
  const summary = (() => {
    if (!s.pickStart || !s.pickEnd) return null;
    if (s.kind === "timed") {
      return whenRef({ allDay: false, startDate: s.pickStart, endDate: endInfo?.endDate ?? s.pickStart, startTime: s.startTime, endTime: s.endTime }, locale);
    }
    return whenRef({ allDay: true, startDate: s.pickStart, endDate: s.kind === "allDay" ? s.pickStart : s.pickEnd }, locale);
  })();
  const summaryText = summary ? text(summary) : t("busy.form.date.none");
  const minutes = s.kind === "timed" ? timedMinutes(s) : null;
  const dur = minutes !== null ? durationRef(minutes) : null;
  const days = s.kind === "multi" ? totalDays(s) : null;

  // ───────── บันทึก / ลบ ─────────
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const built = buildPayload(s, edit ? { tz: edit.tz } : {});
    if (!built.ok) {
      const p = built.problem;
      setProblems({ date: p.pos === "date" ? p : null, time: p.pos === "time" ? p : null, banner: p.pos === "banner" ? p : null });
      setInvalid({ date: p.pos === "date", time: p.pos === "time" });
      return;
    }
    setSaving(true);
    setProblems(NO_PROBLEMS);
    const res = edit
      ? await callApi(`/api/me/busy/${edit.id}`, { method: "PATCH", body: built.payload })
      : await callApi("/api/me/busy", { method: "POST", body: built.payload });
    setSaving(false);
    if (res.ok) {
      onDone(edit ? "updated" : "created");
      return;
    }
    const f = mapSaveFailure(res, s.kind);
    if (f.type === "gone") {
      onDone("gone");
      return;
    }
    const p = f.problem;
    setProblems({ date: p.pos === "date" ? p : null, time: p.pos === "time" ? p : null, banner: p.pos === "banner" ? p : null });
    setInvalid({ date: f.invalidDate, time: f.invalidTime });
  }

  async function remove() {
    if (!edit || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await callApi(`/api/me/busy/${edit.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      onDone("deleted");
      return;
    }
    if (res.kind === "api" && res.status === 404) {
      onDone("gone");
      return;
    }
    setDeleteError(text(failureRef("generic", res)));
  }

  const formId = `${uid}-form`;
  const dateErrId = `${uid}-date-err`;
  const timeErrId = `${uid}-time-err`;
  const pickerId = `${uid}-picker`;
  const hideId = `${uid}-hide`;
  const titleCount = [...s.title].length;
  const noteCount = [...s.note].length;
  const groupsLine = t("busy.form.visibilityGroups", { count: groupCount });

  return (
    <>
      <Sheet
        tall
        title={edit ? t("busy.form.editTitle") : t("busy.form.title")}
        onClose={onClose}
        initialFocusRef={firstRef}
        footer={
          <>
            <p className="visibility-line" data-testid="busy-visibility">
              <Icon name="info" size="sm" />
              <span>
                {t("busy.form.visibility")}
                {groupCount > 0 ? <small>{groupsLine}</small> : null}
              </span>
            </p>
            <button type="submit" form={formId} className="btn btn-primary btn-block" disabled={saving} data-testid="busy-submit">
              {saving ? t("busy.form.saving") : t("busy.form.submit")}
            </button>
          </>
        }
      >
        <form id={formId} className="busy-form" data-testid="busy-form" onSubmit={(e) => void submit(e)} noValidate>
          {showNotice ? (
            <div className="busy-notice" role="note" data-testid="busy-notice">
              <Cat pose="peek" size="sm" />
              <div>
                <b>{t("busy.form.notice.title")}</b>
                <p>{t("busy.form.notice.body")}</p>
                <button type="button" className="btn btn-secondary" onClick={() => markNoticeSeen(userId)} data-testid="busy-notice-ok">
                  {t("busy.form.notice.cta")}
                </button>
              </div>
            </div>
          ) : null}

          {problems.banner ? (
            <div className="alert busy-form-alert" role="alert" data-testid="busy-error">
              <Icon name="circle-alert" />
              <div>
                <span>{text(problems.banner.ref)}</span>
              </div>
            </div>
          ) : null}

          <div className={showNotice || problems.banner ? "field" : "field field-first"}>
            <span className="label" id={`${uid}-kind`}>
              {t("busy.form.type.label")}
            </span>
            <div className="segmented busy-types" role="group" aria-labelledby={`${uid}-kind`}>
              {KINDS.map((k, i) => (
                <button
                  type="button"
                  key={k}
                  ref={i === 0 ? firstRef : undefined}
                  aria-pressed={s.kind === k}
                  data-testid={`busy-type-${k}`}
                  onClick={() => chooseKind(k)}
                >
                  {t(`busy.form.type.${k}`)}
                </button>
              ))}
            </div>
            <p className="busy-type-help">{t(`busy.form.type.help.${HELP_KEY[s.kind]}`)}</p>
          </div>

          <div className="field">
            <span className="label" id={`${uid}-date`}>
              {t("busy.form.date.label")}
            </span>
            <button
              type="button"
              className={invalid.date ? "input date-btn is-invalid" : "input date-btn"}
              aria-expanded={pickerOpen}
              aria-controls={pickerOpen ? pickerId : undefined}
              aria-describedby={problems.date ? dateErrId : undefined}
              aria-label={t("busy.form.date.toggleAria", { summary: summaryText })}
              data-testid="busy-date-toggle"
              onClick={() => {
                setPending(false);
                setPickerOpen((o) => !o);
              }}
            >
              <Icon name="calendar" />
              <span>{summaryText}</span>
              <Icon name="chevron-down" />
            </button>
            {problems.date ? (
              <p className="field-error" id={dateErrId} role="alert" data-testid="busy-date-error">
                <Icon name="circle-alert" size="sm" />
                <span>{text(problems.date.ref)}</span>
              </p>
            ) : null}
            {pickerOpen ? (
              <div id={pickerId}>
                <p className="field-hint">{t(`busy.form.date.${PICK_HINT[s.kind]}`)}</p>
                <DateRangePicker
                  mode={s.kind === "allDay" ? "single" : "range"}
                  start={s.pickStart}
                  end={s.kind === "allDay" ? s.pickStart : s.pickEnd}
                  minDate={minDate}
                  today={today}
                  initialMonth={s.pickStart ?? today}
                  onPick={onPick}
                />
              </div>
            ) : null}
          </div>

          {s.kind === "timed" ? (
            <>
              <div className="pair2 busy-timerow-pair">
                <TimeSelect
                  id={`${uid}-st`}
                  label={t("busy.form.time.start")}
                  ariaLabel={t("busy.form.time.startAria")}
                  value={s.startTime}
                  invalid={invalid.time}
                  describedBy={problems.time ? timeErrId : undefined}
                  testId="busy-start-time"
                  onChange={(v) => patch({ startTime: v })}
                />
                <TimeSelect
                  id={`${uid}-et`}
                  label={t("busy.form.time.end")}
                  ariaLabel={t("busy.form.time.endAria")}
                  value={s.endTime}
                  invalid={invalid.time}
                  describedBy={problems.time ? timeErrId : undefined}
                  testId="busy-end-time"
                  onChange={(v) => patch({ endTime: v })}
                />
              </div>
              {problems.time ? (
                <p className="field-error" id={timeErrId} role="alert" data-testid="busy-time-error">
                  <Icon name="circle-alert" size="sm" />
                  <span>{text(problems.time.ref)}</span>
                </p>
              ) : null}
              {summary ? (
                <p className="cal-summary-line" data-testid="busy-summary">
                  <span>{text(summary)}</span>
                  {endInfo?.overnight ? (
                    <span className="tag tag-event">
                      <Icon name="clock" size="sm" />
                      <span>{t("busy.form.overnight")}</span>
                    </span>
                  ) : null}
                  {dur ? <span className="muted small">{t("busy.form.total", { total: t(dur.key, dur.values) })}</span> : null}
                </p>
              ) : null}
            </>
          ) : null}

          {s.kind === "multi" && summary ? (
            <p className="cal-summary-line" data-testid="busy-summary">
              <span>{text(summary)}</span>
              {days !== null ? <span className="muted small">{t("busy.form.totalDays", { count: days })}</span> : null}
            </p>
          ) : null}

          <div className="field">
            <div className="field-label-row">
              <label htmlFor={`${uid}-what`}>
                {t("busy.form.what.label")} <span className="opt">({t("busy.form.what.optional")})</span>
              </label>
            </div>
            <div className="input">
              <input
                id={`${uid}-what`}
                className="input-bare"
                value={s.title}
                autoComplete="off"
                placeholder={t("busy.form.what.placeholder")}
                aria-describedby={`${uid}-what-h`}
                data-testid="busy-title"
                onChange={(e) => patch({ title: clip(e.target.value, TITLE_MAX) })}
              />
              <span className="counter num" aria-hidden="true">
                {titleCount}/{TITLE_MAX}
              </span>
            </div>
            <p className="field-hint" id={`${uid}-what-h`}>
              {t("busy.form.what.hint", { max: TITLE_MAX })}
            </p>
          </div>

          <div className="switch-row">
            <div className="tx">
              <b id={hideId}>{t("busy.form.hide.label")}</b>
              <span>{t("busy.form.hide.help")}</span>
            </div>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={s.hideDetail}
              aria-labelledby={hideId}
              data-testid="busy-hide"
              onClick={() => patch({ hideDetail: !s.hideDetail })}
            />
          </div>

          <div className="field">
            <div className="field-label-row">
              <label htmlFor={`${uid}-note`}>{t("busy.form.note.label")}</label>
              <span className="private-badge">
                <Icon name="lock" size="sm" />
                <span>{t("busy.form.note.badge")}</span>
              </span>
            </div>
            <div className="input">
              <textarea
                id={`${uid}-note`}
                className="input-bare textarea-bare"
                rows={3}
                value={s.note}
                placeholder={t("busy.form.note.placeholder")}
                aria-describedby={`${uid}-note-h`}
                data-testid="busy-note"
                onChange={(e) => patch({ note: clip(e.target.value, NOTE_MAX) })}
              />
            </div>
            <p className="field-hint" id={`${uid}-note-h`}>
              {t("busy.form.note.help")} <span className="num">{noteCount}/{NOTE_MAX}</span>
            </p>
          </div>

          {edit ? (
            <button type="button" className="btn btn-danger-quiet btn-block busy-delete" data-testid="busy-delete" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash-2" />
              <span>{t("busy.form.delete")}</span>
            </button>
          ) : null}
        </form>
      </Sheet>

      {confirmDelete && edit ? (
        <ConfirmDialog
          title={t("busy.delete.title")}
          body={t("busy.delete.body")}
          confirmLabel={t("busy.delete.confirm")}
          busy={deleting}
          error={deleteError}
          onConfirm={() => void remove()}
          onClose={() => {
            setConfirmDelete(false);
            setDeleteError(null);
          }}
        >
          <p className="small muted" data-testid="busy-delete-summary">
            <b>{summaryText}</b>
            {edit.title ? (
              <>
                {" · "}
                <Name>{edit.title}</Name>
              </>
            ) : null}
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function TimeSelect({
  id,
  label,
  ariaLabel,
  value,
  invalid,
  describedBy,
  testId,
  onChange,
}: {
  id: string;
  label: string;
  ariaLabel: string;
  value: string;
  invalid: boolean;
  describedBy: string | undefined;
  testId: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={invalid ? "input select is-invalid" : "input select"}>
        <select
          id={id}
          className="input-bare select-bare num"
          value={value}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        >
          {TIME_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" />
      </div>
    </div>
  );
}
