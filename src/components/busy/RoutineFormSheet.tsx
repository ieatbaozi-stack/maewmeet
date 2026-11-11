"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApiFull } from "@/components/appointments/api";
import { Icon } from "@/components/icons/Icon";
import { BusyButton } from "@/components/shell/BusyButton";
import { Sheet } from "@/components/shell/Sheet";
import { DEFAULT_TZ, format, startOfWeek, todayIn, type CalendarLocale, type DateISO } from "@/lib/calendar";
import { clock } from "@/lib/shared/clock";
import {
  END_OPTIONS,
  MAX_MONTHS,
  MAX_WEEKS,
  MONTH_OPTION_COUNT,
  NOTE_MAX,
  PRESET_IDS,
  QUICK_WEEKDAYS,
  SHORTCUT_IDS,
  START_OPTIONS,
  TITLE_MAX,
  WEEKDAY_KEYS,
  WEEKDAYS_ALL,
  WEEK_OPTION_COUNT,
  applyPreset,
  applyShortcut,
  buildRoutinePayload,
  canSubmit,
  clipText,
  formStateOfRoutine,
  initialRoutineState,
  isMidnightEnd,
  isOvernightTimes,
  isSplitEdit,
  mapRoutineFailure,
  monthLabel,
  nextWeekday,
  periodOptions,
  quickMatch,
  rangeValues,
  setRangeFrom,
  setRangeKind,
  setRangeTo,
  summarize,
  timeInvalid,
  toOptionDisabled,
  toggleWeekday,
  updateRequest,
  weekRangeValues,
  weekdaysText,
  timeRangeText,
  ymOf,
  type EditScope,
  type PeriodOption,
  type PresetId,
  type QuickWeekdays,
  type RoutineDone,
  type RoutineFormState,
  type RoutineProblem,
  type RoutineRangeKind,
  type RoutineView,
} from "./routine-model";

export type RoutineFormMode =
  | { type: "create" }
  /** แก้ทั้งหมดที่ยังไม่ถึง (scope all) หรือตั้งแต่ช่วงที่เลือก (scope from · ช่อง "ตั้งแต่" ล็อก) */
  | { type: "edit"; routine: RoutineView; scope: EditScope; periodStart: DateISO; focusTo?: boolean };

export interface RoutineFormSheetProps {
  mode: RoutineFormMode;
  /** จำนวนกลุ่มของผู้ใช้ (บรรทัดความเป็นส่วนตัว) */
  groupCount: number;
  onClose: () => void;
  onDone: (result: RoutineDone) => void;
  /** CONFLICT: ให้หน้าโหลดรายการใหม่ (ฟอร์มยังเปิดอยู่ ลองบันทึกซ้ำได้) */
  onStale: () => void;
}

type Problems = Record<RoutineProblem["pos"], RoutineProblem | null>;
const NO_PROBLEMS: Problems = { banner: null, weekdays: null, time: null, range: null, to: null, summary: null };

/**
 * ฟอร์มลง/แก้ busy แบบ routine (R14b · design R14_BUSY_ROUTINE §2) — sheet สูง · ทุกข้อความมาจาก messages
 * ส่งวันจันทร์ของสัปดาห์ / YYYY-MM ของเดือน · จำนวน "จะลง N วัน" นับด้วย planRoutine ตัวเดียวกับเซิร์ฟเวอร์ · สิทธิ์/เพดานตัดสินที่เซิร์ฟเวอร์
 */
export function RoutineFormSheet({ mode, groupCount, onClose, onDone, onStale }: RoutineFormSheetProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const uid = useId();
  const edit = mode.type === "edit" ? mode : null;
  const firstRef = useRef<HTMLButtonElement>(null);
  const toRef = useRef<HTMLSelectElement>(null);
  const [now] = useState(() => clock.now());
  const today = todayIn(DEFAULT_TZ, now);
  const [s, setS] = useState<RoutineFormState>(() => (edit ? formStateOfRoutine(edit.routine, edit.scope, edit.periodStart, today) : initialRoutineState(today)));
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const [saving, setSaving] = useState(false);
  // "เลือกอย่างน้อย 1 วัน": จาง (muted) ตอนเริ่ม เป็นสีผิดพลาดเมื่อผู้ใช้เลิกเลือกจนว่าง
  const [deselected, setDeselected] = useState(false);

  const split = edit ? isSplitEdit(edit.routine, edit.scope, edit.periodStart, today) : false;
  const fromLocked = edit !== null && edit.scope === "from";
  const summary = useMemo(() => summarize(s, now, split ? { splitStart: edit!.periodStart } : {}), [s, now, split, edit]);
  const submittable = canSubmit(s, summary);
  const text = (r: { key: string; values: Record<string, string | number> }) => t(r.key, r.values);

  function patch(next: RoutineFormState) {
    setS(next);
    setProblems(NO_PROBLEMS);
  }

  // ───────── ข้อความช่วย ─────────
  const short = (d: number) => t(`busy.routine.weekdays.short.${WEEKDAY_KEYS[d - 1]}`);
  const long = (d: number) => t(`busy.routine.weekdays.long.${WEEKDAY_KEYS[d - 1]}`);
  const daysText = weekdaysText(t, s.weekdays);
  const timeText = timeRangeText(s.startTime, s.endTime);
  const okCount = summary.kind === "ok" ? summary.count : null;
  const summaryAria = okCount !== null ? t("busy.routine.summary.aria", { count: okCount, days: daysText }) : undefined;
  const optionLabel = (kind: RoutineRangeKind, o: PeriodOption): string => {
    const base = kind === "weeks" ? t("busy.routine.range.week", weekRangeValues(o.value, locale)) : monthLabel(o.value, locale);
    return o.current ? `${base} (${t(kind === "weeks" ? "busy.routine.range.thisWeek" : "busy.routine.range.thisMonth")})` : base;
  };
  const rv = rangeValues(s);
  const firstFrom = s.rangeKind === "weeks" ? startOfWeek(today) : ymOf(today);
  const count = s.rangeKind === "weeks" ? WEEK_OPTION_COUNT : MONTH_OPTION_COUNT;
  const fromOptions = periodOptions(s.rangeKind, firstFrom, count, today);
  const toOptions = periodOptions(s.rangeKind, rv.from, count, today);
  const fromSel = periodOptions(s.rangeKind, rv.from, 1, today)[0]!;
  const limitKey = s.rangeKind === "weeks" ? "busy.routine.range.limitWeeks" : "busy.routine.range.limitMonths";
  const overnight = !s.allDay && isOvernightTimes(s.startTime, s.endTime);
  const exampleDay = s.weekdays[0] ?? 1;

  // ───────── บันทึก ─────────
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving || !submittable) return;
    setSaving(true);
    setProblems(NO_PROBLEMS);
    const res = edit
      ? await (() => {
          const rq = updateRequest(edit.routine.id, s, edit.scope, edit.periodStart);
          return callApiFull<{ count?: number }>(rq.path, { method: "PATCH", body: rq.body });
        })()
      : await callApiFull<{ count?: number }>("/api/me/busy-routines", { method: "POST", body: buildRoutinePayload(s) });
    setSaving(false);
    if (res.ok) {
      const n = res.data?.count;
      onDone(edit ? { type: "updated" } : { type: "created", count: typeof n === "number" ? n : summary.kind === "ok" ? summary.count : 0 });
      return;
    }
    const f = mapRoutineFailure(res, { mode: edit ? (split ? "editSplit" : "edit") : "create", rangeKind: s.rangeKind });
    if (f.type === "gone") {
      onDone({ type: "gone" });
      return;
    }
    if (f.type === "conflict") onStale();
    setProblems({ ...NO_PROBLEMS, [f.problem.pos]: f.problem });
  }

  // ───────── ส่วนย่อย ─────────
  const err = (p: RoutineProblem | null, id: string, testId: string) =>
    p ? (
      <div className="field-error" id={id} role="alert" data-testid={testId}>
        <Icon name="circle-alert" size="sm" />
        <span>{p.refs.map((r, i) => <span key={i} className="rt-err-line">{text(r)}</span>)}</span>
      </div>
    ) : null;
  const rangeProblem = problems.range ?? (summary.kind === "invalid" && summary.problem.pos === "range" ? summary.problem : null);
  const toProblem = problems.to ?? (summary.kind === "invalid" && summary.problem.pos === "to" ? summary.problem : null);
  const timeProblem = problems.time ?? (summary.kind === "invalid" && summary.problem.pos === "time" ? summary.problem : null);
  const bannerProblem = problems.banner ?? (summary.kind === "invalid" && summary.problem.pos === "banner" ? summary.problem : null);
  const quick = quickMatch(s.weekdays);
  const titleCount = [...s.title].length;
  const noteCount = [...s.note].length;
  const formId = `${uid}-form`;
  const hideId = `${uid}-hide`;

  return (
    <Sheet
      tall
      title={edit ? t("busy.routine.form.editTitle") : t("busy.routine.form.title")}
      onClose={onClose}
      initialFocusRef={edit?.focusTo ? toRef : firstRef}
      footer={
        <>
          <p className="visibility-line" data-testid="routine-visibility">
            <Icon name="users" size="sm" />
            <span>
              {t("busy.routine.visibility")}
              {groupCount > 0 ? <small>{t("busy.form.visibilityGroups", { count: groupCount })}</small> : null}
              <small className="rt-hide-hint" data-testid="routine-visibility-hide">{t("busy.routine.visibilityHide")}</small>
            </span>
          </p>
          <BusyButton
            type="submit"
            form={formId}
            className="btn btn-primary btn-block"
            busy={saving}
            disabled={!submittable}
            data-testid="routine-submit"
            busyLabel={t("busy.form.saving")}
            idleLabel={edit ? t("busy.routine.form.submitEdit") : summary.kind === "ok" ? t("busy.routine.form.submit", { count: summary.count }) : t("busy.routine.form.title")}
          />
        </>
      }
    >
      <form id={formId} className="busy-form rt-form" data-testid="routine-form" onSubmit={(e) => void submit(e)} noValidate>
        {edit ? (
          <p className="rt-scope-line" data-testid="routine-editing">
            {edit.scope === "all"
              ? t("busy.routine.form.editing.all")
              : s.rangeKind === "weeks"
                ? t("busy.routine.form.editing.fromWeek", { range: t("busy.routine.range.week", weekRangeValues(edit.periodStart, locale)) })
                : t("busy.routine.form.editing.fromMonth", { month: monthLabel(ymOf(edit.periodStart), locale) })}
          </p>
        ) : null}

        {bannerProblem ? (
          <div className="alert busy-form-alert" role="alert" data-testid="routine-error">
            <Icon name="circle-alert" />
            <div>{bannerProblem.refs.map((r, i) => <span key={i}>{text(r)}</span>)}</div>
          </div>
        ) : null}

        {/* 1. preset (สร้างใหม่เท่านั้น — แก้ไม่ต้องเริ่มจากแบบ) */}
        {!edit ? (
          <div className="field field-first">
            <span className="label" id={`${uid}-preset`}>
              {t("busy.routine.preset.label")}
            </span>
            <p className="field-hint">{t("busy.routine.preset.hint")}</p>
            <div className="rt-chips" role="group" aria-labelledby={`${uid}-preset`}>
              {PRESET_IDS.map((id: PresetId, i) => (
                <button
                  type="button"
                  key={id}
                  ref={i === 0 ? firstRef : undefined}
                  className="rt-chip"
                  aria-pressed={s.preset === id}
                  data-testid={`routine-preset-${id}`}
                  onClick={() => patch(applyPreset(s, id, id === "custom" ? "" : t(`busy.routine.preset.${id === "weekend" ? "weekendTitle" : id}`)))}
                >
                  {t(`busy.routine.preset.${id}`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* 2. วัน */}
        <div className={edit ? "field field-first" : "field"}>
          <span className="label" id={`${uid}-wd`}>
            {t("busy.routine.weekdays.label")}
          </span>
          <p className="field-hint">{t("busy.routine.weekdays.help")}</p>
          <div className="rt-days" role="group" aria-label={t("busy.routine.weekdays.groupAria")} data-testid="routine-weekdays">
            {WEEKDAYS_ALL.map((d) => {
              const on = s.weekdays.includes(d);
              return (
                <button
                  type="button"
                  key={d}
                  className="rt-day"
                  aria-pressed={on}
                  aria-label={long(d)}
                  data-testid={`routine-day-${d}`}
                  onClick={() => {
                    const next = toggleWeekday(s.weekdays, d);
                    setDeselected(next.length === 0);
                    patch({ ...s, weekdays: next });
                  }}
                >
                  <span aria-hidden="true">{short(d)}</span>
                  {on ? <Icon name="check" size="sm" /> : null}
                </button>
              );
            })}
          </div>
          <div className="rt-quick">
            {(["weekdays", "weekend", "every"] as QuickWeekdays[]).map((k) => (
              <button type="button" key={k} className="link-btn rt-quick-btn" aria-pressed={quick === k} data-testid={`routine-quick-${k}`} onClick={() => patch({ ...s, weekdays: [...QUICK_WEEKDAYS[k]] })}>
                {t(`busy.routine.weekdays.quick.${k}`)}
              </button>
            ))}
          </div>
          {s.weekdays.length === 0 ? (
            <p className={deselected ? "field-error" : "field-hint rt-required-muted"} role={deselected ? "alert" : undefined} data-testid="routine-weekdays-required">
              <Icon name="circle-alert" size="sm" />
              <span>{t("busy.routine.weekdays.required")}</span>
            </p>
          ) : null}
          {err(problems.weekdays, `${uid}-wd-err`, "routine-weekdays-error")}
        </div>

        {/* 3. เวลา */}
        <div className="field">
          <span className="label" id={`${uid}-time`}>
            {t("busy.routine.time.label")}
          </span>
          <div className="segmented cols-2 busy-types" role="group" aria-labelledby={`${uid}-time`}>
            <button type="button" aria-pressed={!s.allDay} data-testid="routine-time-timed" onClick={() => patch({ ...s, allDay: false })}>
              {t("busy.routine.time.timed")}
            </button>
            <button type="button" aria-pressed={s.allDay} data-testid="routine-time-allday" onClick={() => patch({ ...s, allDay: true })}>
              {t("busy.routine.time.allDay")}
            </button>
          </div>
          {s.allDay ? <p className="busy-type-help">{t("busy.routine.time.allDayHelp")}</p> : null}
        </div>
        {!s.allDay ? (
          <>
            <div className="pair2 busy-timerow-pair">
              <RtSelect id={`${uid}-st`} label={t("busy.routine.time.start")} value={s.startTime} invalid={timeInvalid(s) || !!timeProblem} describedBy={timeProblem ? `${uid}-time-err` : undefined} testId="routine-start" onChange={(v) => patch({ ...s, startTime: v })}>
                {START_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </RtSelect>
              <RtSelect id={`${uid}-et`} label={t("busy.routine.time.end")} value={s.endTime} invalid={timeInvalid(s) || !!timeProblem} describedBy={timeProblem ? `${uid}-time-err` : undefined} testId="routine-end" onChange={(v) => patch({ ...s, endTime: v })}>
                {END_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {isMidnightEnd(o) ? t("busy.routine.time.endMidnight") : o}
                  </option>
                ))}
              </RtSelect>
            </div>
            {timeInvalid(s) && !timeProblem ? (
              <p className="field-error" role="alert" data-testid="routine-time-same">
                <Icon name="circle-alert" size="sm" />
                <span>{t("busy.routine.error.end")}</span>
              </p>
            ) : null}
            {err(timeProblem, `${uid}-time-err`, "routine-time-error")}
            {isMidnightEnd(s.endTime) ? (
              <p className="field-hint" data-testid="routine-midnight-note">
                {t("busy.routine.time.midnightNote")}
              </p>
            ) : null}
            {overnight ? (
              <div className="rt-overnight" data-testid="routine-overnight">
                <span className="tag tag-event">
                  <Icon name="clock" size="sm" />
                  <span>{t("busy.routine.time.overnight")}</span>
                </span>
                <p className="field-hint">
                  {t("busy.routine.time.overnightNote", { day: long(exampleDay), nextDay: long(nextWeekday(exampleDay)), start: s.startTime, end: s.endTime })}
                </p>
              </div>
            ) : null}
          </>
        ) : null}

        {/* 4. ช่วงที่ใช้ */}
        <div className="field">
          <span className="label" id={`${uid}-range`}>
            {t("busy.routine.range.label")}
          </span>
          {!edit ? (
            <div className="segmented cols-2 busy-types" role="group" aria-labelledby={`${uid}-range`}>
              {(["weeks", "months"] as RoutineRangeKind[]).map((k) => (
                <button type="button" key={k} aria-pressed={s.rangeKind === k} data-testid={`routine-kind-${k}`} onClick={() => patch(setRangeKind(s, k))}>
                  {t(`busy.routine.range.kind.${k}`)}
                </button>
              ))}
            </div>
          ) : null}
          <p className="busy-type-help" data-testid="routine-limit">
            {t(limitKey, { max: s.rangeKind === "weeks" ? MAX_WEEKS : MAX_MONTHS })}
          </p>
          {!edit ? (
            <div className="rt-shortcuts">
              <span className="small muted" id={`${uid}-sc`}>
                {t("busy.routine.range.shortcut.label")}
              </span>
              <div className="rt-chips" role="group" aria-labelledby={`${uid}-sc`}>
                {SHORTCUT_IDS.map((id) => (
                  <button type="button" key={id} className="rt-chip" data-testid={`routine-shortcut-${id}`} onClick={() => patch(applyShortcut(s, id, today))}>
                    {t(`busy.routine.range.shortcut.${id}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rt-range">
            {fromLocked ? (
              <div className="field" data-testid="routine-from-locked">
                <span className="label">{t("busy.routine.range.from")}</span>
                <p className="rt-locked">{t("busy.routine.range.fromLocked", { start: optionLabel(s.rangeKind, fromSel) })}</p>
              </div>
            ) : (
              <RtSelect
                id={`${uid}-from`}
                label={t("busy.routine.range.from")}
                ariaLabel={t("busy.routine.range.fromAria", { value: optionLabel(s.rangeKind, fromSel) })}
                value={rv.from}
                invalid={!!rangeProblem}
                describedBy={rangeProblem ? `${uid}-range-err` : undefined}
                testId="routine-from"
                onChange={(v) => patch(setRangeFrom(s, v))}
              >
                {fromOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {optionLabel(s.rangeKind, o)}
                  </option>
                ))}
              </RtSelect>
            )}
            <RtSelect
              id={`${uid}-to`}
              selectRef={toRef}
              label={t("busy.routine.range.to")}
              ariaLabel={t("busy.routine.range.toAria", { value: optionLabel(s.rangeKind, periodOptions(s.rangeKind, rv.to, 1, today)[0]!) })}
              value={rv.to}
              invalid={!!toProblem || !!rangeProblem}
              describedBy={toProblem ? `${uid}-to-err` : rangeProblem ? `${uid}-range-err` : undefined}
              testId="routine-to"
              onChange={(v) => patch(setRangeTo(s, v))}
            >
              {toOptions.map((o) => (
                <option key={o.value} value={o.value} disabled={toOptionDisabled(s.rangeKind, rv.from, o, today)}>
                  {optionLabel(s.rangeKind, o)}
                </option>
              ))}
            </RtSelect>
          </div>
          {err(rangeProblem, `${uid}-range-err`, "routine-range-error")}
          {err(toProblem, `${uid}-to-err`, "routine-to-error")}
          {summary.kind === "ok" && summary.pastStart ? (
            <p className="field-hint" data-testid="routine-past-note">
              {t("busy.routine.range.pastNote")}
            </p>
          ) : null}
        </div>

        {/* 5. ชื่อ / ซ่อน / บันทึก — ใช้คีย์ของฟอร์ม busy เดิม */}
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
              data-testid="routine-title"
              onChange={(e) => patch({ ...s, title: clipText(e.target.value, TITLE_MAX) })}
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
          <button type="button" className="switch" role="switch" aria-checked={s.hideDetail} aria-labelledby={hideId} data-testid="routine-hide" onClick={() => patch({ ...s, hideDetail: !s.hideDetail })} />
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
              data-testid="routine-note"
              onChange={(e) => patch({ ...s, note: clipText(e.target.value, NOTE_MAX) })}
            />
          </div>
          <p className="field-hint" id={`${uid}-note-h`}>
            {t("busy.form.note.help")} <span className="num">{noteCount}/{NOTE_MAX}</span>
          </p>
        </div>

        {/* 6. สรุปก่อนบันทึก */}
        {summary.kind === "ok" || summary.kind === "zero" ? (
          <div className="rt-summary" role="group" aria-live="polite" aria-label={summaryAria} data-testid="routine-summary">
            {summary.kind === "ok" ? (
              <>
                <p className="rt-summary-big" data-testid="routine-summary-days">
                  {t("busy.routine.summary.days", { count: summary.count })}
                </p>
                <p>{s.allDay ? t("busy.routine.summary.lineAllDay", { days: daysText }) : t("busy.routine.summary.line", { days: daysText, time: timeText })}</p>
                <p className="muted small">
                  {t("busy.routine.summary.span", { start: format(summary.rangeStart, { locale, style: "day-month" }), end: format(summary.rangeEnd, { locale, style: "date-medium" }) })}
                </p>
                {summary.pastStart ? <p className="muted small">{t("busy.routine.summary.pastNote")}</p> : null}
              </>
            ) : (
              <p className="rt-summary-big" data-testid="routine-summary-zero">
                {t("busy.routine.summary.zero")}
              </p>
            )}
          </div>
        ) : null}
        {err(problems.summary, `${uid}-sum-err`, "routine-noocc-error")}

      </form>
    </Sheet>
  );
}

/** ตัวเลือกแบบ select ของแอป (เหมือน TimeSelect ในฟอร์ม busy): label ผูก htmlFor + aria-label เมื่อค่าที่เลือกต้องอ่านเต็ม */
function RtSelect({
  id,
  label,
  ariaLabel,
  value,
  invalid,
  describedBy,
  testId,
  selectRef,
  onChange,
  children,
}: {
  id: string;
  label: string;
  ariaLabel?: string;
  value: string;
  invalid: boolean;
  describedBy: string | undefined;
  testId: string;
  selectRef?: React.RefObject<HTMLSelectElement | null>;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={invalid ? "input select is-invalid" : "input select"}>
        <select
          id={id}
          ref={selectRef}
          className="input-bare select-bare num"
          value={value}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        >
          {children}
        </select>
        <Icon name="chevron-down" />
      </div>
    </div>
  );
}
