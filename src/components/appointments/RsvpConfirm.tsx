"use client";

import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { withNames } from "@/components/Name";
import { Sheet } from "@/components/shell/Sheet";
import type { CalendarLocale } from "@/lib/calendar";
import { conflictWhen, goingConfirmKey, type MyConflict, type Rsvp } from "./model";
import { BusyButton } from "@/components/shell/BusyButton";

export interface RsvpConfirmProps {
  /** to = เปลี่ยนเป็น "ไป" · from = เปลี่ยนจาก "ไป" */
  direction: "to" | "from";
  /** คำตอบเดิม (ใช้ตั้งชื่อปุ่ม "คงเดิม" ตอน to) */
  prev: Rsvp | null;
  /** คำตอบใหม่ (ใช้ตั้งชื่อปุ่มตอน from) */
  next: Rsvp;
  /** นัด/busy ของฉันที่ชนกับนัดนี้ (เฉพาะ to) — ของเจ้าตัวเท่านั้น */
  conflicts: readonly MyConflict[];
  /** เซิร์ฟเวอร์ตัดรายการที่ 5 (มีมากกว่านั้น) */
  truncated: boolean;
  /** กลุ่มของนัดนี้ — แถวนัดที่อยู่กลุ่มอื่นของฉันบอกชื่อกลุ่มด้วย */
  groupId: string;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * popup ยืนยัน RSVP (R6D) — ใช้ Sheet เดิม (ไม่ทำ modal ใหม่ · ไม่ซ้อน popup) ·
 * โฟกัสเริ่มที่ปุ่มคงเดิม (ปลอดภัย) · Esc/scrim/X = ยกเลิก = คำตอบไม่เปลี่ยน · ไม่เลือกปุ่มยืนยันไว้ก่อน ·
 * ปุ่มเป็นชื่อผลลัพธ์ · ชนกับนัดอื่น = เตือนไม่บล็อก (เปลี่ยนชื่อปุ่ม + บรรทัดอธิบาย ไม่มี popup ที่สอง)
 */
export function RsvpConfirm({ direction, prev, next, conflicts, truncated, groupId, saving, onConfirm, onCancel }: RsvpConfirmProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const keepRef = useRef<HTMLButtonElement>(null);
  const to = direction === "to";
  const hasConflict = to && conflicts.length > 0;
  const confirmLabel = to
    ? t(`appointments.goingConfirm.${goingConfirmKey(conflicts, truncated)}`)
    : t("appointments.goingConfirm.fromConfirm", { next: next === "maybe" ? "maybe" : "notGoing" });
  const keepLabel = to ? t("appointments.goingConfirm.keep", { prev: prev === "maybe" || prev === "not_going" ? prev : "none" }) : t("appointments.goingConfirm.fromKeep");

  return (
    <Sheet
      title={t(to ? "appointments.goingConfirm.toTitle" : "appointments.goingConfirm.fromTitle")}
      onClose={() => !saving && onCancel()}
      initialFocusRef={keepRef}
      footer={
        <>
          <button ref={keepRef} type="button" className="btn btn-secondary btn-block" style={{ minHeight: "var(--tap-lg)" }} disabled={saving} data-testid="rsvp-confirm-cancel" onClick={onCancel}>
            {keepLabel}
          </button>
          <BusyButton className="btn btn-primary btn-block" style={{ minHeight: "var(--tap-lg)" }} busy={saving} data-testid="rsvp-confirm-ok" onClick={onConfirm} busyLabel={t("appointments.rsvp.saving")} idleLabel={confirmLabel} />
        </>
      }
    >
      <div data-testid="rsvp-confirm" data-direction={direction}>
        <p>{t(to ? "appointments.goingConfirm.toBody" : "appointments.goingConfirm.fromBody")}</p>
        {hasConflict ? (
          <div className="rsvp-conflicts" data-testid="rsvp-conflicts">
            <h3>
              <Icon name="triangle-alert" size="sm" />
              <span>{t("appointments.goingConfirm.conflictTitle")}</span>
            </h3>
            <ul>
              {conflicts.map((c) => {
                const w = conflictWhen(c, locale);
                const time = t(w.key, w.values);
                let line;
                if (c.kind === "appointment") {
                  line =
                    c.groupId !== groupId
                      ? withNames((n) => t("appointments.goingConfirm.conflictApptGroup", { title: n.title, group: n.group, time }), { title: c.title, group: c.groupName })
                      : withNames((n) => t("appointments.goingConfirm.conflictAppt", { title: n.title, time }), { title: c.title });
                } else {
                  line = c.title ? withNames((n) => t("appointments.goingConfirm.conflictBusy", { title: n.title, time }), { title: c.title }) : t("appointments.goingConfirm.conflictBusyPlain", { time });
                }
                return (
                  <li key={c.kind === "appointment" ? `a-${c.appointmentId}` : `b-${c.busyId}`}>
                    <Icon name={c.kind === "appointment" ? "calendar" : "clock"} size="sm" />
                    <span>{line}</span>
                  </li>
                );
              })}
            </ul>
            {truncated ? <p className="rsvp-conflicts-more">{t("appointments.goingConfirm.conflictMore")}</p> : null}
            <p className="rsvp-conflicts-note">{t("appointments.goingConfirm.conflictNote")}</p>
          </div>
        ) : null}
        <p className="rsvp-confirm-status small muted" role="status" aria-live="polite">
          {saving ? t("appointments.rsvp.saving") : ""}
        </p>
      </div>
    </Sheet>
  );
}
