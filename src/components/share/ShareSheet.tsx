"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApiFull } from "@/components/appointments/api";
import { ConfirmDialog } from "@/components/groups/ConfirmDialog";
import { Icon } from "@/components/icons/Icon";
import { withNames } from "@/components/Name";
import { whenLabel } from "@/components/notifications/model";
import { Sheet } from "@/components/shell/Sheet";
import { Spinner } from "@/components/shell/Spinner";
import type { CalendarLocale } from "@/lib/calendar";
import type { ShareLinkDto } from "@/lib/data/serializers/share";
import { guestLimit, othersLinks, shareErrorKey, type ShareLinkLike } from "./model";

export interface ShareSheetProps {
  appointmentId: string;
  title: string;
  startAt: number;
  tz: string;
  /** ชื่อของฉัน — ใน "ลิงก์นี้เป็นของคุณ … มากับ {name}" */
  myName: string;
  guestCount: number;
  guestMax: number;
  /** ลิงก์ที่ผู้ดูเห็น (ใช้แสดงลิงก์ของคนอื่นที่ปิดได้) — url ไม่มีสำหรับลิงก์ของคนอื่น */
  links: readonly ShareLinkDto[];
  onClose: () => void;
  /** ปิดลิงก์สำเร็จ: mine = ลิงก์ของฉัน · ใช้อัปเดตรายการ + แจ้งผล */
  onRevoked: (linkId: string) => void;
}

type Made = { url: string; linkId: string };
type Phase = { kind: "loading" } | { kind: "ok"; link: Made } | { kind: "error"; key: string };

const subscribe = (): (() => void) => () => {};
const canWebShare = (): boolean => typeof navigator !== "undefined" && typeof navigator.share === "function";
/** ปุ่ม "ส่งต่อ" เฉพาะเครื่องที่มี Web Share (server/hydrate รอบแรก = ซ่อน) */
const useCanShare = (): boolean => useSyncExternalStore(subscribe, canWebShare, () => false);

/**
 * Sheet "ชวนคนนอก" (UX R18_SHARE_FLOW §2): เปิดแล้วขอลิงก์ (get-or-create — กดซ้ำได้ลิงก์เดิม) → คัดลอก/ส่งต่อ
 * บอกชัดว่าคนเปิดลิงก์เห็น/ไม่เห็นอะไร · ปิดลิงก์ของฉัน = ConfirmDialog 1 ขั้น · ข้อความแชร์ไม่มีชื่อกลุ่ม/สถานที่/ชื่อสมาชิก
 * สิทธิ์สร้าง/ปิดตรวจที่เซิร์ฟเวอร์เสมอ (ปุ่มนี้แค่ UX)
 */
export function ShareSheet({ appointmentId, title, startAt, tz, myName, guestCount, guestMax, links, onClose, onRevoked }: ShareSheetProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const canShare = useCanShare();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [revoking, setRevoking] = useState<{ linkId: string; mine: boolean; name: string } | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());
  const copyRef = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const make = useCallback(async () => {
    setPhase({ kind: "loading" });
    const res = await callApiFull<{ url: string; linkId: string; createdAt: number; reused: boolean }>(`/api/appointments/${encodeURIComponent(appointmentId)}/share-link`, { method: "POST", body: {} });
    if (!alive.current) return;
    if (res.ok) setPhase({ kind: "ok", link: { url: res.data.url, linkId: res.data.linkId } });
    else setPhase({ kind: "error", key: shareErrorKey(res) });
  }, [appointmentId]);

  useEffect(() => {
    alive.current = true;
    // ขอลิงก์ตอนเปิด sheet (โหลดจากเครือข่าย = ซิงก์กับระบบภายนอก)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void make();
    return () => {
      alive.current = false;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [make]);

  const link = phase.kind === "ok" ? phase.link : null;
  const limit = guestLimit(guestCount, guestMax);
  const others = othersLinks<ShareLinkLike & ShareLinkDto>(links).filter((l) => !revoked.has(l.id));
  const when = whenLabel(startAt, tz, locale);

  function flash(kind: "ok" | "failed") {
    setCopied(kind);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 2000);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      flash("ok");
    } catch {
      flash("failed");
    }
  }

  async function share() {
    if (!link) return;
    try {
      await navigator.share({ title: t("share.shareTitle", { title }), text: t("share.shareText", { title, when }), url: link.url });
    } catch {
      /* ผู้ใช้ปิดแผ่นแชร์ (AbortError) หรือแชร์ไม่ได้ — ไม่ถือเป็นข้อผิดพลาด ยังคัดลอกได้ */
    }
  }

  async function doRevoke() {
    if (!revoking || revokeBusy) return;
    setRevokeBusy(true);
    setRevokeError(null);
    const res = await callApiFull<{ revoked: true }>(`/api/appointments/${encodeURIComponent(appointmentId)}/share-links/${encodeURIComponent(revoking.linkId)}`, { method: "DELETE" });
    setRevokeBusy(false);
    if (res.ok) {
      const id = revoking.linkId;
      const mine = revoking.mine;
      setRevoking(null);
      setRevoked((s) => new Set(s).add(id));
      onRevoked(id);
      if (mine) onClose();
      return;
    }
    setRevokeError(t(shareErrorKey(res, "revoke")));
  }

  if (revoking) {
    return (
      <ConfirmDialog
        title={t("share.revoke.title")}
        body={t("share.revoke.body")}
        confirmLabel={t("share.revoke.confirm")}
        onConfirm={() => void doRevoke()}
        onClose={() => {
          if (!revokeBusy) setRevoking(null);
        }}
        busy={revokeBusy}
        error={revokeError}
      />
    );
  }

  return (
    <Sheet
      title={t("share.sheet.title")}
      onClose={onClose}
      initialFocusRef={copyRef}
      footer={
        <button type="button" className="btn btn-secondary btn-block" onClick={onClose} data-testid="share-done">
          {t("share.sheet.done")}
        </button>
      }
    >
      <div className="share-sheet" data-testid="share-sheet" aria-busy={phase.kind === "loading"}>
        <p className="share-lead">{t("share.sheet.lead")}</p>

        <div>
          <p className="share-link-label" id="share-link-label">
            {t("share.link.label")}
          </p>
          {phase.kind === "loading" ? (
            <div className="input share-skeleton" role="status" data-testid="share-creating">
              <Spinner />
              <span className="muted">{t("share.sheet.creating")}</span>
            </div>
          ) : (
            <input
              className="input share-link-field"
              readOnly
              value={link?.url ?? ""}
              aria-labelledby="share-link-label"
              onFocus={(e) => e.currentTarget.select()}
              inputMode="url"
              spellCheck={false}
              data-testid="share-url"
            />
          )}
        </div>

        {phase.kind === "error" ? (
          <div className="alert" role="alert" data-testid="share-error">
            <Icon name="circle-alert" />
            <div>
              <span>{t(phase.key)}</span>
            </div>
          </div>
        ) : null}

        <div className="share-link-actions">
          {phase.kind === "error" ? (
            <button type="button" className="btn btn-primary" onClick={() => void make()} data-testid="share-retry">
              <Icon name="refresh-cw" />
              <span>{t("states.retry")}</span>
            </button>
          ) : (
            <button ref={copyRef} type="button" className="btn btn-primary" aria-disabled={link ? undefined : true} onClick={() => void copy()} data-testid="share-copy">
              <Icon name={copied === "ok" ? "check" : "copy"} />
              <span>{t("share.copy")}</span>
            </button>
          )}
          {canShare && phase.kind !== "error" ? (
            <button type="button" className="btn btn-secondary" aria-disabled={link ? undefined : true} onClick={() => void share()} data-testid="share-native">
              <Icon name="share-2" />
              <span>{t("share.share")}</span>
            </button>
          ) : null}
        </div>
        <p className={copied === "failed" ? "form-error" : "sr-only"} role="status" aria-live="polite" data-testid="share-copy-status">
          {copied === "ok" ? t("share.copied") : copied === "failed" ? t("share.copyFailed") : ""}
        </p>

        <div className="share-sees">
          <div className="share-sees-row" data-kind="sees">
            <Icon name="check" />
            <p>
              <b>{t("share.sheet.seesTitle")}</b>
              {t("share.sheet.sees")}
            </p>
          </div>
          <div className="share-sees-row" data-kind="hides">
            <Icon name="x" />
            <p>
              <b>{t("share.sheet.hidesTitle")}</b>
              {t("share.sheet.hides")}
            </p>
          </div>
        </div>

        <p className="share-note">{withNames((n) => t("share.sheet.mine", { name: n.name }), { name: myName })}</p>
        <p className={limit.full ? "share-limit is-full" : "share-limit"} data-testid="share-limit">
          {limit.full ? <Icon name="triangle-alert" size="sm" /> : null}
          <span>{t("share.sheet.limit", { max: limit.max, count: limit.count })}</span>
        </p>
        <p className="share-note">{t("share.sheet.valid")}</p>

        {others.length > 0 ? (
          <div className="share-links" data-testid="share-links">
            <h3>{t("share.links.title")}</h3>
            <ul>
              {others.map((l) => {
                const name = l.createdBy?.displayName ?? "";
                return (
                  <li key={l.id}>
                    <span>{withNames((n) => t("share.links.item", { name: n.name }), { name })}</span>
                    <button
                      type="button"
                      className="share-danger-text"
                      aria-label={t("share.links.revokeAria", { name })}
                      onClick={() => {
                        setRevokeError(null);
                        setRevoking({ linkId: l.id, mine: false, name });
                      }}
                      data-testid="share-revoke-other"
                    >
                      {t("share.revoke.confirm")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {link ? (
          <button
            type="button"
            className="share-danger-text"
            onClick={() => {
              setRevokeError(null);
              setRevoking({ linkId: link.linkId, mine: true, name: "" });
            }}
            data-testid="share-revoke-mine"
          >
            {t("share.revoke.cta")}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
