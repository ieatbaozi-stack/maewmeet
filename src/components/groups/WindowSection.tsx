"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { failureMessage, isGone } from "./errors";
import {
  WINDOW_END_OPTIONS,
  WINDOW_MIN_OPTIONS,
  WINDOW_START_OPTIONS,
  durationRef,
  formatClock,
  isWindowValid,
} from "./helpers";
import type { SectionProps } from "./NameSection";
import { SelectField } from "./SelectField";

export interface WindowValue {
  start: number;
  end: number;
  min: number;
}

/** ช่วงเวลาที่นับว่าว่าง (D9, ก้าว 30 นาที) — บันทึกได้แต่ยังไม่ถูกใช้คำนวณจนถึง R4 (ข้อความ window.body บอกผู้ใช้ตรงๆ) */
export function WindowSection({ groupId, editable, notify, saved }: SectionProps & { saved: WindowValue }) {
  const t = useTranslations("groupSettings");
  const tAll = useTranslations();
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState<WindowValue>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationText = (min: number) => {
    const d = durationRef(min);
    return t(`window.${d.key}`, d.values);
  };
  const summary = (v: WindowValue) =>
    t("window.summary", { start: formatClock(v.start), end: formatClock(v.end), duration: durationText(v.min) });

  const valid = isWindowValid(value.start, value.end, value.min);
  const unchanged = value.start === saved.start && value.end === saved.end && value.min === saved.min;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !valid || unchanged) return;
    setBusy(true);
    setError(null);
    notify(null);
    const res = await callApi(`/api/groups/${groupId}`, {
      method: "PATCH",
      body: { freeWindowStartMin: value.start, freeWindowEndMin: value.end, minFreeMinutes: value.min },
    });
    setBusy(false);
    if (res.ok) {
      notify({ kind: "ok", text: t("window.saved") });
      router.refresh();
      return;
    }
    setError(failureMessage(tAll, "generic", res));
    if (isGone(res)) router.refresh();
  }

  return (
    <section className="set-sec" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{t("window.title")}</h2>
      <p className="lead">{t("window.body")}</p>
      {editable ? (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <div className="pair2">
            <SelectField
              id={`${id}-s`}
              label={t("window.start")}
              value={value.start}
              options={WINDOW_START_OPTIONS.map((m) => ({ value: m, label: formatClock(m) }))}
              onChange={(start) => setValue((v) => ({ ...v, start }))}
            />
            <SelectField
              id={`${id}-e`}
              label={t("window.end")}
              value={value.end}
              options={WINDOW_END_OPTIONS.map((m) => ({ value: m, label: formatClock(m) }))}
              onChange={(end) => setValue((v) => ({ ...v, end }))}
            />
          </div>
          <SelectField
            id={`${id}-m`}
            label={t("window.min")}
            value={value.min}
            options={WINDOW_MIN_OPTIONS.map((m) => ({ value: m, label: durationText(m) }))}
            onChange={(min) => setValue((v) => ({ ...v, min }))}
          />
          <p className="field-hint">{t("window.stepHint")}</p>
          <p className="field-hint" aria-live="polite">
            {valid ? summary(value) : tAll("errors.INVALID_WINDOW")}
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={busy || !valid || unchanged}>
            {tAll("common.save")}
          </button>
        </form>
      ) : (
        <p className="readonly">{summary(saved)}</p>
      )}
    </section>
  );
}
