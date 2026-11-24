"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { whenRef } from "@/components/calendar/model";
import { failureRef } from "@/components/groups/errors";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { BusyButton } from "@/components/shell/BusyButton";
import { Sheet } from "@/components/shell/Sheet";
import { icsBulkActionDisabled, initialIcsSelection } from "./ics-import-model";
import {
  ICS_IMPORT_DEFAULT_WINDOW_DAYS,
  ICS_IMPORT_MAX_BYTES,
  ICS_IMPORT_WINDOW_OPTIONS,
  type CalendarLocale,
  type IcsImportWindowDays,
  type IcsSkipCounts,
} from "@/lib/calendar";

export interface IcsPreviewItem {
  kind: "all_day" | "timed";
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  tz: string;
  title: string | null;
  rounded: boolean;
  duplicate: boolean;
}

interface PreviewResponse {
  windowDays: IcsImportWindowDays;
  totalEvents: number;
  skipped: IcsSkipCounts;
  quota: { used: number; max: number; remaining: number };
  maxImportPerBatch: number;
  items: IcsPreviewItem[];
}

interface ConfirmResponse {
  created: number;
  skippedDuplicates: number;
}

export interface IcsImportSheetProps {
  onClose: () => void;
  onImported: (createdCount: number) => void;
}

const SKIP_KEYS: readonly (keyof IcsSkipCounts)[] = [
  "rrule",
  "cancelled",
  "transparent",
  "past",
  "tooFarAhead",
  "tooLong",
  "invalid",
];

/**
 * Sheet นำเข้าไฟล์ `.ics` แบบ 2 ขั้น (ICS_IMPORT_CONTRACT U1–U2 · docs/design/ICS_IMPORT.md):
 * ขั้น 1: เลือกไฟล์ `.ics` + ช่วงล่วงหน้า (30/60/90/180 วัน ดีฟอลต์ 90)
 * ขั้น 2: Preview รายการ + สวิตช์ซ่อนรายละเอียด (ดีฟอลต์เปิด · B3) + เลือกรายการ + โควตา X/300 + ยืนยันนำเข้า
 */
export function IcsImportSheet({ onClose, onImported }: IcsImportSheetProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const uid = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickBtnRef = useRef<HTMLButtonElement>(null);

  const [step, setStep] = useState<"pick" | "preview">("pick");
  const [windowDays, setWindowDays] = useState<IcsImportWindowDays>(ICS_IMPORT_DEFAULT_WINDOW_DAYS);
  const [fileName, setFileName] = useState<string>("");
  const [icsText, setIcsText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  // B3 = (ก): เปิดซ่อนรายละเอียดจากคนในกลุ่มเป็นค่าเริ่มต้น
  const [hideDetail, setHideDetail] = useState(true);

  async function requestPreview(text: string, days: IcsImportWindowDays, nextFileName?: string) {
    setLoading(true);
    setErrorMsg(null);
    const res = await callApi<PreviewResponse>("/api/me/busy/import/preview", {
      method: "POST",
      body: { icsText: text, windowDays: days },
    });
    setLoading(false);
    if (!res.ok) {
      const f = failureRef("generic", res);
      setErrorMsg(t(f.key, f.values));
      return;
    }
    const maxCap = Math.min(res.data.quota.remaining, res.data.maxImportPerBatch);
    if (nextFileName !== undefined) setFileName(nextFileName);
    setIcsText(text);
    setWindowDays(days);
    setPreview(res.data);
    setSelected(initialIcsSelection(res.data.items, maxCap));
    setStep("preview");
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // รีเซ็ตค่าเพื่อให้เลือกไฟล์เดิมซ้ำได้
    e.target.value = "";
    if (!file || loading || submitting) return;
    setErrorMsg(null);

    if (file.size > ICS_IMPORT_MAX_BYTES) {
      setErrorMsg(t("errors.ICS_TOO_LARGE"));
      return;
    }
    if (file.size === 0) {
      setErrorMsg(t("errors.ICS_INVALID"));
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      setErrorMsg(t("errors.ICS_INVALID"));
      return;
    }
    await requestPreview(text, windowDays, file.name);
  }

  async function changeWindow(days: IcsImportWindowDays) {
    if (days === windowDays || loading || submitting) return;
    if (step === "preview" && icsText) {
      await requestPreview(icsText, days);
      return;
    }
    setWindowDays(days);
  }

  function toggleIndex(index: number) {
    setSelected((prev) => prev.map((v, i) => (i === index ? !v : v)));
  }

  function selectAllNonDupes() {
    if (!preview) return;
    const maxCap = Math.min(preview.quota.remaining, preview.maxImportPerBatch);
    setSelected(initialIcsSelection(preview.items, maxCap));
  }

  function selectNone() {
    setSelected((prev) => prev.map(() => false));
  }

  const chosenItems = preview ? preview.items.filter((_, i) => selected[i]) : [];
  const selectedCount = chosenItems.length;
  const overQuota = preview !== null && selectedCount > preview.quota.remaining;
  const overBatch = preview !== null && selectedCount > preview.maxImportPerBatch;
  const hasRounded = preview !== null && preview.items.some((it) => it.rounded);
  const allDuplicates = preview !== null && preview.items.length > 0 && preview.items.every((it) => it.duplicate);
  const skippedTotal = preview ? SKIP_KEYS.reduce((acc, k) => acc + preview.skipped[k], 0) : 0;
  const canSubmit = !loading && !submitting && selectedCount > 0 && !overQuota && !overBatch;
  const bulkDisabled = icsBulkActionDisabled({
    loading,
    submitting,
    allDuplicates,
    quotaRemaining: preview?.quota.remaining ?? 0,
    selectedCount,
  });

  async function onConfirm() {
    if (!preview || !canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    const hasSelectedDuplicate = chosenItems.some((it) => it.duplicate);
    const payload = {
      items: chosenItems.map(({ kind, startDate, endDate, startTime, endTime, tz, title }) => ({
        kind,
        startDate,
        endDate,
        ...(startTime !== undefined ? { startTime } : {}),
        ...(endTime !== undefined ? { endTime } : {}),
        tz,
        title,
      })),
      hideDetail,
      skipDuplicates: !hasSelectedDuplicate,
    };
    const res = await callApi<ConfirmResponse>("/api/me/busy/import", { method: "POST", body: payload });
    setSubmitting(false);
    if (!res.ok) {
      const f = failureRef("generic", res);
      setErrorMsg(t(f.key, f.values));
      return;
    }
    onImported(res.data.created);
  }

  const hideId = `${uid}-hide`;
  const winId = `${uid}-win`;

  const windowPicker = (
    <div className="field">
      <label id={winId}>{t("busy.import.window.label")}</label>
      <div className="segmented cols-4" role="group" aria-labelledby={winId}>
        {ICS_IMPORT_WINDOW_OPTIONS.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={windowDays === w}
            disabled={loading || submitting}
            data-testid={`ics-window-${w}`}
            onClick={() => void changeWindow(w)}
          >
            {t(`busy.import.window.d${w}`)}
          </button>
        ))}
      </div>
    </div>
  );

  const footer =
    step === "preview" ? (
      <>
        <BusyButton
          type="button"
          className="btn btn-primary btn-block"
          busy={submitting}
          busyLabel={t("busy.import.preview.submitting")}
          idleLabel={t("busy.import.preview.submit", { count: selectedCount })}
          disabled={!canSubmit}
          data-testid="ics-import-submit"
          onClick={() => void onConfirm()}
        />
        <button type="button" className="btn btn-secondary btn-block" disabled={submitting} onClick={onClose}>
          {t("common.cancel")}
        </button>
      </>
    ) : (
      <button type="button" className="btn btn-secondary btn-block" disabled={loading} onClick={onClose}>
        {t("common.cancel")}
      </button>
    );

  const sheetTitle = step === "pick" ? t("busy.import.title") : t("busy.import.preview.title");

  return (
    <Sheet
      title={sheetTitle}
      onClose={onClose}
      tall
      footer={footer}
      initialFocusRef={pickBtnRef}
    >
      <div className="ics-sheet" data-testid="ics-import-sheet" aria-busy={loading || submitting}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ics,text/calendar"
          className="sr-only"
          data-testid="ics-file-input"
          onChange={(e) => void onFileChange(e)}
        />

        {errorMsg ? (
          <div className="alert alert-err" role="alert" data-testid="ics-import-error">
            <Icon name="circle-alert" />
            <div>
              <span>{errorMsg}</span>
            </div>
          </div>
        ) : null}

        {step === "pick" ? (
          <>
            <p className="muted small">{t("busy.import.lead")}</p>
            {windowPicker}
            <button
              ref={pickBtnRef}
              type="button"
              className="ics-dropzone"
              disabled={loading}
              aria-busy={loading}
              data-testid="ics-pick-button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="calendar-plus" size="lg" />
              <span className="ics-dropzone-cta">{loading ? t("busy.import.loading") : t("busy.import.pick.cta")}</span>
              <span className="small muted">{t("busy.import.pick.hint")}</span>
            </button>
            <div className="alert alert-info ics-privacy" role="note">
              <Icon name="lock" />
              <div>
                <span>{t("busy.import.privacyNote")}</span>
              </div>
            </div>
          </>
        ) : preview ? (
          <>
            <div className="ics-file-bar">
              <span className="ics-file-name">
                <Name>{fileName}</Name>
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || submitting}
                data-testid="ics-change-file"
                onClick={() => fileInputRef.current?.click()}
              >
                {t("busy.import.preview.changeFile")}
              </button>
            </div>

            {windowPicker}

            {loading ? (
              <div className="ics-loading small muted" role="status" data-testid="ics-preview-loading">
                {t("busy.import.loading")}
              </div>
            ) : null}

            <div className="ics-summary" role="status" data-testid="ics-preview-summary">
              <p className="ics-summary-main">{t("busy.import.preview.found", { total: preview.items.length, selected: selectedCount })}</p>
              <p className="small muted num" data-testid="ics-preview-quota">
                {t("busy.import.preview.quota", {
                  used: preview.quota.used,
                  max: preview.quota.max,
                  remaining: preview.quota.remaining,
                })}
              </p>
            </div>

            {overQuota ? (
              <div className="alert alert-warn" role="alert" data-testid="ics-over-quota">
                <Icon name="triangle-alert" />
                <div>
                  <span>{t("busy.import.preview.overQuota", { remaining: preview.quota.remaining })}</span>
                </div>
              </div>
            ) : null}

            {overBatch ? (
              <div className="alert alert-warn" role="alert" data-testid="ics-over-batch">
                <Icon name="triangle-alert" />
                <div>
                  <span>{t("busy.import.preview.overBatch", { max: preview.maxImportPerBatch })}</span>
                </div>
              </div>
            ) : null}

            {preview.items.length > 0 ? (
              <div className="switch-row">
                <div className="tx">
                  <b id={hideId}>{t("busy.import.preview.hideDetail")}</b>
                  <span>{t("busy.import.preview.hideDetailHint")}</span>
                </div>
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={hideDetail}
                  aria-labelledby={hideId}
                  disabled={submitting}
                  data-testid="ics-hide-detail"
                  onClick={() => setHideDetail((v) => !v)}
                />
              </div>
            ) : null}

            {hasRounded ? (
              <div className="alert alert-info" role="note" data-testid="ics-rounded-note">
                <Icon name="info" />
                <div>
                  <span>{t("busy.import.preview.roundedNote")}</span>
                </div>
              </div>
            ) : null}

            {skippedTotal > 0 ? (
              <details className="ics-skipped" data-testid="ics-skipped-details">
                <summary className="ics-skipped-summary">
                  <Icon name="chevron-right" size="sm" className="ics-skipped-chevron" />
                  <span>{t("busy.import.skipped.summary", { count: skippedTotal })}</span>
                </summary>
                <ul className="ics-skipped-list">
                  {SKIP_KEYS.filter((k) => preview.skipped[k] > 0).map((k) => (
                    <li key={k} data-testid={`ics-skip-${k}`}>
                      {t(`busy.import.skipped.${k}`, { count: preview.skipped[k] })}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {preview.items.length === 0 ? (
              <div className="ics-empty" data-testid="ics-preview-empty">
                <h3 className="h-section">{t("busy.import.empty.title")}</h3>
                <p className="muted small">{t("busy.import.empty.body")}</p>
              </div>
            ) : (
              <>
                {allDuplicates ? (
                  <div className="alert alert-info" role="status" data-testid="ics-all-duplicates">
                    <Icon name="info" />
                    <div>
                      <span>{t("busy.import.preview.allDuplicates")}</span>
                    </div>
                  </div>
                ) : null}

                <div className="ics-bulk-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={bulkDisabled.selectAll}
                    data-testid="ics-select-all"
                    onClick={selectAllNonDupes}
                  >
                    {t("busy.import.preview.selectAll")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={bulkDisabled.selectNone}
                    data-testid="ics-select-none"
                    onClick={selectNone}
                  >
                    {t("busy.import.preview.selectNone")}
                  </button>
                </div>

                <ul className="ics-items" data-testid="ics-preview-list">
                  {preview.items.map((item, idx) => {
                    const checked = selected[idx] === true;
                    const when = whenRef(
                      {
                        allDay: item.kind === "all_day",
                        startDate: item.startDate,
                        endDate: item.endDate,
                        startTime: item.startTime,
                        endTime: item.endTime,
                      },
                      locale,
                    );
                    const whenText = t(when.key, when.values);
                    const checkId = `${uid}-item-${idx}`;
                    return (
                      <li key={`${item.startDate}-${item.startTime ?? "all"}-${idx}`} className="ics-item">
                        <label className="ics-item-label" htmlFor={checkId}>
                          <input
                            id={checkId}
                            type="checkbox"
                            className="ics-checkbox"
                            checked={checked}
                            disabled={submitting}
                            data-testid={`ics-item-check-${idx}`}
                            onChange={() => toggleIndex(idx)}
                          />
                          <span className="ics-item-body">
                            <span className="ics-item-title">
                              {item.title ? <Name>{item.title}</Name> : <span className="muted">{t("busy.import.preview.noTitle")}</span>}
                            </span>
                            <span className="small muted">{whenText}</span>
                            {item.rounded || item.duplicate ? (
                              <span className="tags">
                                {item.rounded ? (
                                  <span className="tag tag-muted" data-testid={`ics-item-rounded-${idx}`}>
                                    <Icon name="clock" size="sm" />
                                    <span>{t("busy.import.preview.roundedTag")}</span>
                                  </span>
                                ) : null}
                                {item.duplicate ? (
                                  <span className="tag tag-muted" data-testid={`ics-item-dup-${idx}`}>
                                    <Icon name="check" size="sm" />
                                    <span>{t("busy.import.preview.duplicateTag")}</span>
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
