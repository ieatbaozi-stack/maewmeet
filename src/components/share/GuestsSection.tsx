"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { callApiFull } from "@/components/appointments/api";
import { actionFailureRef } from "@/components/appointments/model";
import { ConfirmDialog } from "@/components/groups/ConfirmDialog";
import { MemberAvatar } from "@/components/groups/MemberAvatar";
import { Icon } from "@/components/icons/Icon";
import { Name, withNames } from "@/components/Name";
import { isolate } from "@/components/notifications/model";
import type { GuestsBlockDto } from "@/lib/data/serializers/share";
import { guestAnswerKey, guestLimit } from "./model";

export interface GuestsSectionProps {
  appointmentId: string;
  guests: GuestsBlockDto;
  /** ผู้ถูกนำออกสำเร็จ: ให้ผู้เรียกเอาออกจากรายการ + แจ้งผล */
  onRemoved: (userId: string, name: string) => void;
}

/**
 * ส่วน "แขกนอกกลุ่ม" ในหน้านัดของสมาชิก (UX R18_SHARE_FLOW §6) — แสดงเสมอ (ว่าง = บอกว่ามีฟีเจอร์นี้)
 * ปุ่ม "นำออก" ซ่อนตาม canRemove ที่เซิร์ฟเวอร์ส่ง (ซ่อนปุ่มไม่ใช่การป้องกัน — DELETE ตรวจสิทธิ์ที่เซิร์ฟเวอร์)
 * นำออก = ConfirmDialog 1 ขั้น บอกว่ากลับเข้านัดนี้ไม่ได้อีกไม่ว่าลิงก์ไหน
 */
export function GuestsSection({ appointmentId, guests, onRemoved }: GuestsSectionProps) {
  const t = useTranslations();
  const uid = useId();
  const [target, setTarget] = useState<{ userId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = guestLimit(guests.items.length, guests.max);

  async function remove() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    const res = await callApiFull<{ removed: true }>(`/api/appointments/${encodeURIComponent(appointmentId)}/guests/${encodeURIComponent(target.userId)}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      const done = target;
      setTarget(null);
      onRemoved(done.userId, done.name);
      return;
    }
    const ref = actionFailureRef(res, "guests.removeError");
    setError(t(ref.key, ref.values));
  }

  return (
    <section className="appt-section" aria-labelledby={`${uid}-g`} data-testid="appt-guests">
      <div className="guests-head">
        <h2 id={`${uid}-g`}>{t("guests.title", { count: guests.items.length })}</h2>
        <span className={limit.full ? "guests-limit is-full" : "guests-limit"} data-testid="guests-limit">
          {t("guests.limit", { count: limit.count, max: limit.max })}
        </span>
      </div>
      {guests.items.length === 0 ? (
        <p className="muted" data-testid="guests-empty">
          {t("guests.empty")}
        </p>
      ) : (
        <ul className="guest-list" aria-label={t("guests.listAria")} data-testid="guests-list">
          {guests.items.map((g, i) => (
            <li className="guest-row" key={g.userId} data-testid="guest-row" data-user-id={g.userId}>
              <MemberAvatar displayName={g.displayName} colorIndex={i} shapeIndex={i} size="sm" />
              <div className="guest-main">
                <p className="guest-line">
                  <span className="nm">
                    <Name>{g.displayName}</Name>
                  </span>
                  <span className="tag tag-wait">{t("guests.badge")}</span>
                  <span className="guest-answer">{t(guestAnswerKey(g.response))}</span>
                </p>
                {g.invitedBy ? <p className="guest-with">{withNames((n) => t("guests.with", { name: n.name }), { name: g.invitedBy.displayName })}</p> : null}
              </div>
              {g.canRemove ? (
                <button
                  type="button"
                  className="share-danger-text guest-remove"
                  aria-label={t("guests.removeAria", { name: isolate(g.displayName) })}
                  onClick={() => {
                    setError(null);
                    setTarget({ userId: g.userId, name: g.displayName });
                  }}
                  data-testid="guest-remove"
                >
                  <Icon name="user-minus" size="sm" />
                  <span>{t("guests.remove")}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {target ? (
        <ConfirmDialog
          title={t("guests.removeConfirm.title", { name: isolate(target.name) })}
          body={withNames((n) => t("guests.removeConfirm.body", { name: n.name }), { name: target.name })}
          confirmLabel={t("guests.removeConfirm.confirm")}
          onConfirm={() => void remove()}
          onClose={() => {
            if (!busy) setTarget(null);
          }}
          busy={busy}
          error={error}
        />
      ) : null}
    </section>
  );
}
