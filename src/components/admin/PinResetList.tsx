"use client";

import { useEffect, useId, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { callApi, type ApiResult } from "@/components/auth/api";
import { failureText } from "@/components/auth/errors";
import { Icon } from "@/components/icons/Icon";
import { Sheet } from "@/components/shell/Sheet";
import { deviceLabel, regionName } from "@/i18n/auth-messages";

interface ResetItem {
  id: string;
  username: string;
  displayName: string;
  requestedAt: number;
  pendingExpiresAt: number;
  device: string | null;
  country: string | null;
}

type Failure = Extract<ApiResult<unknown>, { ok: false }>;
type Load = { kind: "loading" } | { kind: "error"; failure: Failure } | { kind: "ready"; items: ResetItem[] };
type Decision = { kind: "approve" | "reject"; item: ResetItem };

/**
 * รายการคำขอ reset PIN ที่รออนุมัติ (UX W12 · super admin เท่านั้น — สิทธิ์ตรวจที่เซิร์ฟเวอร์ ทุก endpoint)
 * อนุมัติต้องติ๊ก "ยืนยันกับเจ้าของบัญชีนอกระบบแล้ว" (ADR 0002 §6) · แสดงเวลา อุปกรณ์ ประเทศของผู้ขอ
 */
export function PinResetList() {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const id = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [decision, setDecision] = useState<Decision | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void callApi<{ items: ResetItem[] }>("/api/auth/admin/pin-resets?status=pending", { method: "GET" }).then((res) => {
      if (cancelled) return;
      setLoad(res.ok ? { kind: "ready", items: res.data.items } : { kind: "error", failure: res });
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function open(kind: Decision["kind"], item: ResetItem) {
    setDecision({ kind, item });
    setConfirmed(false);
    setSheetError(null);
  }

  function close() {
    if (busy) return;
    setDecision(null);
  }

  async function submit() {
    if (!decision || busy) return;
    if (decision.kind === "approve" && !confirmed) return;
    setBusy(true);
    setSheetError(null);
    const { kind, item } = decision;
    const res = await callApi(`/api/auth/admin/pin-resets/${encodeURIComponent(item.id)}/${kind}`);
    setBusy(false);
    if (res.ok) {
      setDecision(null);
      setToast(t(kind === "approve" ? "adminResets.approvedToast" : "adminResets.rejectedToast", { username: item.username }));
      setLoad((cur) => (cur.kind === "ready" ? { kind: "ready", items: cur.items.filter((i) => i.id !== item.id) } : cur));
      return;
    }
    setSheetError(failureText(t, res));
    // อีกคนตัดสินไปแล้ว / รายการหาย → โหลดรายการใหม่ให้ตรงความจริง
    if (res.kind === "api" && (res.error.code === "CONFLICT" || res.error.code === "NOT_FOUND")) setReloadKey((k) => k + 1);
  }

  const when = (ms: number) =>
    format.dateTime(ms, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="alert alert-warn" role="note">
        <Icon name="triangle-alert" />
        <div>
          <b>{t("adminResets.warningTitle")}</b>
          <span>{t("adminResets.warningBody")}</span>
        </div>
      </div>

      {toast ? (
        <div className="alert alert-free toast" role="status">
          <Icon name="circle-check" />
          <div>{toast}</div>
        </div>
      ) : null}

      {load.kind === "loading" ? (
        <div className="admin-loading" aria-busy="true">
          <div className="skeleton skeleton-req" />
          <div className="skeleton skeleton-req" />
          <p className="loading-note" role="status">
            {t("states.loading")}
          </p>
        </div>
      ) : null}

      {load.kind === "error" ? (
        <div className="admin-loading">
          <div className="alert" role="alert">
            <Icon name="circle-alert" />
            <div>
              <b>{failureText(t, load.failure)}</b>
              <span>{t("states.error.dataSafe")}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setLoad({ kind: "loading" });
              setReloadKey((k) => k + 1);
            }}
          >
            <Icon name="refresh-cw" />
            <span>{t("states.retry")}</span>
          </button>
        </div>
      ) : null}

      {load.kind === "ready" && load.items.length === 0 ? (
        <div className="empty admin-empty">
          <h2 className="h-section">{t("adminResets.empty.title")}</h2>
          <p className="muted">{t("adminResets.empty.body")}</p>
        </div>
      ) : null}

      {load.kind === "ready" && load.items.length > 0 ? (
        <section aria-labelledby={`${id}-h`}>
          <h2 className="sub-h" id={`${id}-h`}>
            {t("adminResets.tabPending", { count: load.items.length })}
          </h2>
          <ul className="reqs">
            {load.items.map((item) => {
              const country = regionName(locale, item.country);
              return (
                <li className="req" key={item.id}>
                  <div className="req-top">
                    <span className="req-user">{item.username}</span>
                    <span className="tag tag-wait">
                      <Icon name="clock" size="sm" />
                      <span>{t("adminResets.status.pending")}</span>
                    </span>
                  </div>
                  <ul className="req-facts">
                    <li>
                      <Icon name="clock" size="sm" />
                      <span className="v">{t("adminResets.requestedAt", { when: when(item.requestedAt) })}</span>
                    </li>
                    <li>
                      <Icon name="user" size="sm" />
                      <span className="v">{deviceLabel(item.device) ?? t("adminResets.deviceUnknown")}</span>
                    </li>
                    <li>
                      <Icon name="map-pin" size="sm" />
                      <span className="v">{country ?? t("adminResets.countryUnknown")}</span>
                    </li>
                  </ul>
                  <div className="req-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      aria-label={t("adminResets.approveFor", { username: item.username })}
                      onClick={() => open("approve", item)}
                    >
                      {t("adminResets.approve")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label={t("adminResets.rejectFor", { username: item.username })}
                      onClick={() => open("reject", item)}
                    >
                      {t("adminResets.reject")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {decision ? (
        <Sheet
          center
          title={t(decision.kind === "approve" ? "adminResets.approveSheet.title" : "adminResets.rejectSheet.title", {
            username: decision.item.username,
          })}
          onClose={close}
          footer={
            <>
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={busy || (decision.kind === "approve" && !confirmed)}
                aria-busy={busy}
                onClick={() => void submit()}
              >
                {t(decision.kind === "approve" ? "adminResets.approveSheet.confirm" : "adminResets.rejectSheet.confirm")}
              </button>
              <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={close}>
                {t("common.cancel")}
              </button>
            </>
          }
        >
          <p>
            {t(decision.kind === "approve" ? "adminResets.approveSheet.body" : "adminResets.rejectSheet.body", {
              username: decision.item.username,
            })}
          </p>
          {decision.kind === "approve" ? (
            <label className="sheet-check">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>{t("adminResets.approveSheet.check")}</span>
            </label>
          ) : null}
          {sheetError ? (
            <p className="form-error sheet-error" role="alert">
              {sheetError}
            </p>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}
