"use client";

import "@/components/groups/groups.css";
import "@/components/calendar/calendar-view.css";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { DateRangePicker } from "@/components/busy/DateRangePicker";
import { TIME_OPTIONS, durationRef } from "@/components/busy/form-model";
import { Icon } from "@/components/icons/Icon";
import { withNames } from "@/components/Name";
import { PlaceField } from "@/components/places/PlaceField";
import { Sheet } from "@/components/shell/Sheet";
import { format, todayIn, type CalendarLocale, type DateISO } from "@/lib/calendar";
import type { AppointmentDetailDto, OverlapDto } from "@/lib/data/serializers/appointments";
import { clock } from "@/lib/shared/clock";
import { callApiFull } from "./api";
import { OverlapNotice } from "./OverlapNotice";
import {
  DESCRIPTION_MAX,
  TITLE_MAX,
  buildCreatePayload,
  buildPatchPayload,
  durationMinutes,
  emptyForm,
  formStateOfAppointment,
  mapFormFailure,
  overlapView,
  resolveEnd,
  textLength,
  type ApptFormState,
  type FieldPos,
  type FormProblem,
  type OverlapView,
} from "./model";
import { BusyButton } from "@/components/shell/BusyButton";

export interface AppointmentFormSheetProps {
  mode: "create" | "edit";
  groupId: string;
  groupName: string;
  /** จำนวนสมาชิกปัจจุบัน (บรรทัด "สมาชิกอีก N คนจะเห็น…") */
  memberCount: number;
  tz: string;
  userId: string;
  /** สร้างใหม่: ค่าตั้งต้นของวัน/เวลา (เช่น จากช่วงว่างร่วม) */
  initial?: { date: DateISO; startTime: string; endTime: string } | null;
  /** แสดงบรรทัด "เติมวันและเวลาจากช่วงที่ทุกคนว่างให้แล้ว" */
  prefilled?: boolean;
  /** โหมดแก้ไข: นัดเดิม */
  edit?: AppointmentDetailDto;
  onClose: () => void;
  /** แก้ไขสำเร็จ */
  onSaved?: (appointment: AppointmentDetailDto) => void;
  /** แก้ไข: เซิร์ฟเวอร์บอกว่านัดไม่มีแล้ว (404) */
  onGone?: () => void;
}

type Problems = Partial<Record<FieldPos, FormProblem>>;
const toProblems = (list: FormProblem[]): Problems => Object.fromEntries(list.map((p) => [p.pos, p]));

const CHECK_DEBOUNCE_MS = 450;

const clip = (v: string, max: number): string => {
  const chars = [...v];
  return chars.length > max ? chars.slice(0, max).join("") : v;
};

type CheckResult = { key: string; view: OverlapView };

/** ฟอร์มสร้าง/แก้ไขนัด (UX X53–X58) — sheet สูง · กลุ่มมาจากบริบท · เตือนนัดทับแบบ debounce ไม่บล็อก · สำเร็จ → ไปหน้ารายละเอียดนัด */
export function AppointmentFormSheet({ mode, groupId, groupName, memberCount, tz, userId, initial, prefilled = false, edit, onClose, onSaved, onGone }: AppointmentFormSheetProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const router = useRouter();
  const uid = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const today = todayIn(tz, clock.now());

  const [s, setS] = useState<ApptFormState>(() => {
    if (edit) return formStateOfAppointment(edit);
    const base = emptyForm(initial?.date ?? null);
    return initial ? { ...base, startTime: initial.startTime, endTime: initial.endTime } : base;
  });
  const [problems, setProblems] = useState<Problems>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [forcePaste, setForcePaste] = useState(false);
  const [tick, setTick] = useState(0);
  const [check, setCheck] = useState<CheckResult | null>(null);

  function patch(next: Partial<ApptFormState>, clear: FieldPos[] = []) {
    setS((cur) => ({ ...cur, ...next }));
    setProblems((cur) => {
      const copy = { ...cur };
      delete copy.banner;
      for (const k of clear) delete copy[k];
      return copy;
    });
  }

  // ───────── เตือนนัดทับ: debounce + กันผลเก่า (key ไม่ตรง = ผลของช่วงเวลาก่อนหน้า) ─────────
  const end = resolveEnd(s);
  const scheduleKey = s.date && end ? `${s.date}|${s.startTime}|${end.endDate}|${s.endTime}|${tick}` : null;
  useEffect(() => {
    if (!scheduleKey || !s.date || !end) return;
    let cancelled = false;
    // แก้นัด: ส่ง appointmentId เพื่อไม่ให้ตรวจชนกับตัวเอง (ตอบ "ไป" ไว้แล้ว = busy ของตัวเอง)
    const body = { startDate: s.date, startTime: s.startTime, endDate: end.endDate, endTime: s.endTime, ...(edit ? { appointmentId: edit.id } : {}) };
    const timer = setTimeout(async () => {
      const res = await callApiFull<{ overlap: OverlapDto }>(`/api/groups/${groupId}/appointments/check`, { method: "POST", body });
      if (cancelled) return;
      if (!res.ok) {
        setCheck({ key: scheduleKey, view: { kind: "error" } });
        return;
      }
      setCheck({ key: scheduleKey, view: overlapView(res.data.overlap, { myId: userId, tz, locale }) });
    }, CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // end/s.date ถูกครอบด้วย scheduleKey แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleKey, groupId, userId, tz, locale]);
  const overlap: OverlapView = scheduleKey === null ? { kind: "idle" } : check && check.key === scheduleKey ? check.view : { kind: "checking" };

  // ───────── บันทึก ─────────
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const ctx = { tz, nowMs: clock.now() };
    setForcePaste(false);
    if (mode === "create") {
      const built = buildCreatePayload(s, { ...ctx, checkPast: true });
      if (!built.ok) {
        setProblems(toProblems(built.problems));
        return;
      }
      setSaving(true);
      setProblems({});
      const res = await callApiFull<{ appointment: AppointmentDetailDto }>(`/api/groups/${groupId}/appointments`, { method: "POST", body: built.payload });
      if (res.ok) {
        router.push(`/appointments/${res.data.appointment.id}`);
        return; // คง saving ไว้จนหน้าเปลี่ยน (กันกดซ้ำ)
      }
      setSaving(false);
      fail(mapFormFailure(res, "create"));
      return;
    }
    if (!edit) return;
    const built = buildPatchPayload(s, edit, ctx);
    if (!built.ok) {
      setProblems(toProblems(built.problems));
      return;
    }
    if (built.payload === null) {
      onClose();
      return;
    }
    setSaving(true);
    setProblems({});
    const res = await callApiFull<{ appointment: AppointmentDetailDto }>(`/api/appointments/${edit.id}`, { method: "PATCH", body: built.payload });
    setSaving(false);
    if (res.ok) {
      onSaved?.(res.data.appointment);
      return;
    }
    fail(mapFormFailure(res, "edit"));
  }

  function fail(f: ReturnType<typeof mapFormFailure>) {
    if (f.type === "gone") {
      if (onGone) onGone();
      else setProblems({ banner: { pos: "banner", ref: { key: "appointments.form.error.gone", values: {} } } });
      return;
    }
    setProblems(toProblems(f.problems));
    setForcePaste(f.openPaste);
  }

  const formId = `${uid}-form`;
  const dateSummary = s.date ? format(s.date, { locale, style: "date-long" }) : null;
  const minutes = durationMinutes(s, tz);
  const dur = minutes !== null ? durationRef(minutes) : null;
  const titleCount = textLength(s.title);
  const descCount = [...s.description].length;
  const others = Math.max(0, memberCount - 1);
  const err = (pos: FieldPos) => (problems[pos] ? t(problems[pos]!.ref.key, problems[pos]!.ref.values) : null);

  const sheetTitle = t(mode === "edit" ? "appointments.form.editTitle" : "appointments.form.createTitle");

  return (
    <Sheet
      tall
      title={sheetTitle}
      onClose={onClose}
      initialFocusRef={titleRef}
      footer={
        <>
          {mode === "create" ? (
            <p className="notify-line" data-testid="appt-notify-line">
              <Icon name="users" size="sm" />
              <span>{t("appointments.form.notifyLine", { count: others })}</span>
            </p>
          ) : null}
          <div className="appt-foot-actions">
            <button type="button" className="btn btn-secondary" data-testid="appt-form-cancel" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <BusyButton type="submit" form={formId} className="btn btn-primary" busy={saving} data-testid="appt-submit" busyLabel={mode === "edit" ? t("appointments.form.submit.saving") : t("appointments.form.submit.creating")} label={mode === "edit" ? t("appointments.form.submit.save") : t("appointments.form.submit.create")} />
          </div>
        </>
      }
    >
      <form id={formId} data-testid="appt-form" onSubmit={(e) => void submit(e)} noValidate>
        <p className="appt-form-sub">
          {withNames((n) => t("appointments.form.inGroup", { group: n.group }), { group: groupName })}
        </p>
        {problems.banner ? (
          <div className="alert form-alert" role="alert" data-testid="appt-form-error">
            <Icon name="circle-alert" />
            <div>
              <span>{t(problems.banner.ref.key, problems.banner.ref.values)}</span>
            </div>
          </div>
        ) : null}
        {mode === "create" && prefilled ? (
          <p className="appt-prefill" data-testid="appt-prefilled">
            <Icon name="info" size="sm" />
            <span>{t("appointments.form.prefilled")}</span>
          </p>
        ) : null}
        {mode === "edit" ? (
          <p className="appt-form-edit-note" data-testid="appt-edit-note">
            <Icon name="info" size="sm" />
            <span>{t("appointments.form.editNote")}</span>
          </p>
        ) : null}

        <div className="field" style={{ marginTop: "var(--space-3)" }}>
          <div className="field-label-row">
            <label htmlFor={`${uid}-title`}>{t("appointments.form.title.label")}</label>
          </div>
          <div className={problems.title ? "input has-error" : "input"}>
            <input
              id={`${uid}-title`}
              ref={titleRef}
              className="input-bare"
              value={s.title}
              autoComplete="off"
              placeholder={t("appointments.form.title.placeholder")}
              aria-describedby={`${uid}-title-h`}
              aria-invalid={problems.title ? true : undefined}
              data-testid="appt-title"
              onChange={(e) => patch({ title: clip(e.target.value, TITLE_MAX) }, ["title"])}
            />
            <span className="counter num" aria-hidden="true">
              {titleCount}/{TITLE_MAX}
            </span>
          </div>
          {problems.title ? (
            <p className="field-error" role="alert" data-testid="appt-title-error">
              <Icon name="circle-alert" size="sm" />
              <span>{err("title")}</span>
            </p>
          ) : null}
          <p className="field-hint" id={`${uid}-title-h`}>
            {t("appointments.form.title.hint", { max: TITLE_MAX })}
          </p>
        </div>

        <div className="field">
          <span className="label" id={`${uid}-date-l`}>
            {t("appointments.form.date.label")}
          </span>
          <button
            type="button"
            className={problems.date ? "input select has-error" : "input select"}
            aria-expanded={pickerOpen}
            aria-controls={pickerOpen ? `${uid}-picker` : undefined}
            aria-labelledby={`${uid}-date-l ${uid}-date-v`}
            data-testid="appt-date-toggle"
            onClick={() => setPickerOpen((o) => !o)}
          >
            <Icon name="calendar" />
            <span id={`${uid}-date-v`} style={{ flex: 1, textAlign: "left" }} className={s.date ? undefined : "muted"}>
              {dateSummary ?? t("busy.form.date.none")}
            </span>
            <Icon name="chevron-down" />
          </button>
          {problems.date ? (
            <p className="field-error" role="alert" data-testid="appt-date-error">
              <Icon name="circle-alert" size="sm" />
              <span>{err("date")}</span>
            </p>
          ) : null}
          {pickerOpen ? (
            <div id={`${uid}-picker`}>
              <DateRangePicker
                mode="single"
                start={s.date}
                end={s.date}
                minDate={today}
                today={today}
                initialMonth={s.date ?? today}
                onPick={(d) => {
                  patch({ date: d }, ["date", "time"]);
                  setPickerOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="pair2" style={{ marginTop: "var(--space-3)" }}>
          <TimeSelect id={`${uid}-st`} label={t("busy.form.time.start")} ariaLabel={t("busy.form.time.startAria")} value={s.startTime} invalid={!!problems.time} describedBy={problems.time ? `${uid}-time-err` : undefined} testId="appt-start-time" onChange={(v) => patch({ startTime: v }, ["time"])} />
          <TimeSelect id={`${uid}-et`} label={t("busy.form.time.end")} ariaLabel={t("busy.form.time.endAria")} value={s.endTime} invalid={!!problems.time} describedBy={problems.time ? `${uid}-time-err` : undefined} testId="appt-end-time" onChange={(v) => patch({ endTime: v }, ["time"])} />
        </div>
        {problems.time ? (
          <p className="field-error" id={`${uid}-time-err`} role="alert" data-testid="appt-time-error">
            <Icon name="circle-alert" size="sm" />
            <span>{err("time")}</span>
          </p>
        ) : null}
        {s.date && !problems.time ? (
          <p className="cal-summary-line" data-testid="appt-summary">
            {dur ? <span>{t("busy.form.total", { total: t(dur.key, dur.values) })}</span> : null}
            {end?.overnight ? (
              <span className="tag tag-event" data-testid="appt-overnight">
                <Icon name="clock" size="sm" />
                <span>{t("appointments.form.time.endsOn", { date: format(end.endDate, { locale, style: "day-month" }) })}</span>
              </span>
            ) : null}
          </p>
        ) : null}
        <p className="field-hint" style={{ marginTop: "var(--space-1)" }}>
          {t("appointments.form.time.stepHint")}
        </p>

        <OverlapNotice view={overlap} onRetry={() => setTick((n) => n + 1)} />

        <PlaceField value={s.place} onChange={(place) => patch({ place }, ["place"])} problem={problems.place ?? null} forcePaste={forcePaste} />

        <div className="field">
          <div className="field-label-row">
            <label htmlFor={`${uid}-desc`}>
              {t("appointments.form.description.label")} <span className="opt">({t("appointments.form.optional")})</span>
            </label>
          </div>
          <div className={problems.description ? "input has-error" : "input"}>
            <textarea
              id={`${uid}-desc`}
              className="input-bare textarea-bare"
              rows={3}
              value={s.description}
              placeholder={t("appointments.form.description.placeholder")}
              aria-describedby={`${uid}-desc-h`}
              aria-invalid={problems.description ? true : undefined}
              data-testid="appt-description"
              onChange={(e) => patch({ description: clip(e.target.value, DESCRIPTION_MAX + 200) }, ["description"])}
            />
          </div>
          {problems.description ? (
            <p className="field-error" role="alert" data-testid="appt-description-error">
              <Icon name="circle-alert" size="sm" />
              <span>{err("description")}</span>
            </p>
          ) : null}
          <p className="field-hint" id={`${uid}-desc-h`}>
            {t("appointments.form.description.hint", { max: DESCRIPTION_MAX })} · <span className="num">{descCount}/{DESCRIPTION_MAX}</span>
          </p>
        </div>
      </form>
    </Sheet>
  );
}

function TimeSelect({ id, label, ariaLabel, value, invalid, describedBy, testId, onChange }: { id: string; label: string; ariaLabel: string; value: string; invalid: boolean; describedBy: string | undefined; testId: string; onChange: (v: string) => void }) {
  return (
    <div className="field" style={{ marginTop: 0 }}>
      <label htmlFor={id}>{label}</label>
      <div className={invalid ? "input select has-error" : "input select"}>
        <select id={id} className="input-bare select-bare num" value={value} aria-label={ariaLabel} aria-invalid={invalid || undefined} aria-describedby={describedBy} data-testid={testId} onChange={(e) => onChange(e.target.value)}>
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
