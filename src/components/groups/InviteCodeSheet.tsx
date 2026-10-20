"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { Sheet } from "@/components/shell/Sheet";
import { formatShortDate } from "./helpers";

const noopSubscribe = () => () => {};
const canWebShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

export interface CreatedCode {
  /** โค้ดเต็ม XXXX-XXXX — อยู่ในหน่วยความจำของ sheet นี้เท่านั้น: ห้ามเก็บ localStorage/URL/log/telemetry (UX §4, R2-10) */
  code: string;
  expiresAt: number;
}

/**
 * sheet แสดงโค้ดเชิญเต็ม "ครั้งเดียว" (U5): คัดลอก · แชร์ (Web Share API ถ้ามี ไม่มี → ซ่อนปุ่ม) · เสร็จแล้ว
 * ปิดแล้วผู้เรียกล้าง state ทิ้ง — ดูโค้ดเต็มซ้ำไม่ได้
 */
export function InviteCodeSheet({ groupName, created, onClose }: { groupName: string; created: CreatedCode; onClose: () => void }) {
  const t = useTranslations("groupSettings.invite");
  const tAll = useTranslations();
  const locale = useLocale();
  const doneRef = useRef<HTMLButtonElement>(null);
  const canShare = useSyncExternalStore(noopSubscribe, canWebShare, () => false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expires = formatShortDate(created.expiresAt, locale);

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(created.code);
      setCopied(true);
    } catch {
      setCopied(false);
      setError(tAll("errors.UNKNOWN"));
    }
  }

  async function share() {
    setError(null);
    try {
      await navigator.share({ text: t("sheet.shareText", { group: groupName, code: created.code, expires }) });
    } catch (e) {
      // ผู้ใช้กดยกเลิกหน้าต่างแชร์ = ไม่ใช่ข้อผิดพลาด
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(tAll("errors.UNKNOWN"));
    }
  }

  return (
    <Sheet
      title={t("sheet.title")}
      onClose={onClose}
      initialFocusRef={doneRef}
      footer={
        <>
          <button type="button" className="btn btn-primary btn-block" onClick={() => void copy()}>
            <Icon name={copied ? "check" : "copy"} />
            <span>{copied ? t("sheet.copied") : t("sheet.copy")}</span>
          </button>
          {canShare ? (
            <button type="button" className="btn btn-secondary btn-block" onClick={() => void share()}>
              <Icon name="share-2" />
              <span>{t("sheet.share")}</span>
            </button>
          ) : null}
          <button ref={doneRef} type="button" className="btn btn-text btn-block" onClick={onClose}>
            {t("sheet.done")}
          </button>
        </>
      }
    >
      <div className="alert alert-warn" role="note">
        <Icon name="triangle-alert" />
        <div>
          <b>{t("sheet.onceTitle")}</b>
          <span>{t("sheet.onceBody")}</span>
        </div>
      </div>
      <div className="code-box" data-testid="invite-code">
        {created.code}
      </div>
      <p className="sheet-hint code-expires">{t("code.expires", { date: expires })}</p>
      <p className="sr-only" role="status">
        {copied ? t("sheet.copied") : ""}
      </p>
      {error ? (
        <p className="form-error sheet-error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
