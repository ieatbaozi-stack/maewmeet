"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import "./line.css";
import { Icon } from "@/components/icons/Icon";
import { BusyButton } from "@/components/shell/BusyButton";
import { Sheet } from "@/components/shell/Sheet";
import { clock } from "@/lib/shared/clock";
import { callApiRaw } from "./api";
import { LINE_POLL_MS, lineErrorKey, lineIsConflict, lineView, msUntil, parseLineCode, parseLineStatus, type LineCode, type LineStatus } from "./line-model";

/**
 * ส่วนเชื่อม LINE ใน แท็บ ฉัน (R10 §2 · docs/design/R10_LINE.md)
 * ช่องทางปิด (available=false) = ไม่แสดงอะไรเลย · โค้ดอยู่ใน state เท่านั้น (ไม่ลง URL/storage/log) · สิทธิ์ตรวจที่ API
 * รอผู้ใช้ส่งโค้ด: ตรวจสถานะตอนกลับมาที่แท็บ + ทุก LINE_POLL_MS · หมดอายุ → กลับสถานะ "ยังไม่เชื่อม"
 */
export function LineSection() {
  const t = useTranslations();
  const id = useId();
  const [status, setStatus] = useState<LineStatus | null>(null);
  const [code, setCode] = useState<LineCode | null>(null);
  const [now, setNow] = useState(() => clock.now());
  const [busy, setBusy] = useState<null | "connect" | "disconnect">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    const res = await callApiRaw<unknown>("/api/me/line", { method: "GET" });
    if (!aliveRef.current || !res.ok) return; // ล้มเหลว: คงสถานะเดิม ไม่ล้างโค้ด
    const next = parseLineStatus(res.data);
    if (!next) return;
    setNow(clock.now());
    setStatus(next);
    if (next.linked) setCode(null);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // โหลดครั้งแรก: เรียกใน callback หลัง await (ไม่ setState ซิงก์ใน effect)
    const first = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(first);
      aliveRef.current = false;
    };
  }, [load]);

  const view = lineView(status, code, now);
  const waiting = view === "code";

  // รอส่งโค้ด: ตรวจเมื่อกลับมาที่แท็บ + ช่วงห่าง ๆ · ตั้ง timer ให้โค้ดหมดอายุแล้วกลับสถานะแรก
  useEffect(() => {
    if (!waiting || !code) return;
    const expire = setTimeout(() => setNow(clock.now()), msUntil(code.expiresAt, clock.now()) + 50);
    const poll = setInterval(() => void load(), LINE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(expire);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [waiting, code, load]);

  async function connect() {
    if (busy) return;
    setBusy("connect");
    setError(null);
    const res = await callApiRaw<unknown>("/api/me/line", { method: "POST", body: {} });
    if (!aliveRef.current) return;
    setBusy(null);
    if (res.ok) {
      const c = parseLineCode(res.data);
      if (c) {
        setNow(clock.now());
        setCode(c);
      } else setError(t("me.line.error"));
      return;
    }
    if (lineIsConflict(res)) {
      await load(); // เชื่อมไปแล้วจากอีกที่ — โหลดสถานะจริง
      return;
    }
    setError(t(lineErrorKey(res)));
  }

  async function disconnect() {
    if (busy) return;
    setBusy("disconnect");
    setError(null);
    const res = await callApiRaw<unknown>("/api/me/line", { method: "DELETE", body: {} });
    if (!aliveRef.current) return;
    setBusy(null);
    setConfirming(false);
    if (res.ok) {
      setCode(null);
      setStatus((s) => (s ? { ...s, linked: false, pendingExpiresAt: null } : s));
      return;
    }
    setError(t(lineErrorKey(res)));
  }

  if (view === "hidden") return null;

  return (
    <section className="settings" aria-labelledby={`${id}-h`} data-testid="me-line" data-state={view}>
      <h2 className="h-section" id={`${id}-h`}>
        {t("me.line.title")}
      </h2>

      {view === "linked" ? (
        <>
          <p className="line-linked" data-testid="me-line-connected">
            <Icon name="circle-check" />
            <span>{t("me.line.connected")}</span>
          </p>
          <button type="button" className="btn btn-secondary btn-block" data-testid="me-line-disconnect" disabled={busy !== null} onClick={() => setConfirming(true)}>
            {t("me.line.disconnect")}
          </button>
        </>
      ) : (
        <>
          <p className="field-hint">{t("me.line.hint")}</p>
          {view === "code" && code ? (
            <div className="setting" aria-live="polite">
              <p className="setting-label">{t("me.line.codeLabel")}</p>
              <p className="line-code" data-testid="me-line-code">
                {code.code}
              </p>
              <p className="field-hint">{t("me.line.codeHint")}</p>
              {status?.addFriendUrl ? (
                <div className="line-actions">
                  <a className="btn btn-primary btn-block" href={status.addFriendUrl} target="_blank" rel="noopener noreferrer" data-testid="me-line-add-friend">
                    <span>{t("me.line.addFriend")}</span>
                  </a>
                </div>
              ) : null}
            </div>
          ) : (
            <BusyButton
              type="button"
              className="btn btn-primary btn-block"
              busy={busy === "connect"}
              busyLabel={t("common.loading")}
              idleLabel={t("me.line.connect")}
              data-testid="me-line-connect"
              onClick={() => void connect()}
            />
          )}
        </>
      )}

      {error ? (
        <p className="form-error" role="alert" data-testid="me-line-error">
          {error}
        </p>
      ) : null}

      {confirming ? (
        <Sheet
          alert
          title={t("me.line.title")}
          initialFocusRef={cancelRef}
          onClose={() => (busy ? undefined : setConfirming(false))}
          footer={
            <>
              <BusyButton
                type="button"
                className="btn btn-danger-outline btn-block"
                busy={busy === "disconnect"}
                busyLabel={t("common.loading")}
                idleLabel={t("me.line.disconnect")}
                data-testid="me-line-disconnect-confirm"
                onClick={() => void disconnect()}
              />
              <button ref={cancelRef} type="button" className="btn btn-secondary btn-block" disabled={busy !== null} onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </button>
            </>
          }
        >
          <p>{t("me.line.disconnectConfirm")}</p>
        </Sheet>
      ) : null}
    </section>
  );
}
