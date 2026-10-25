"use client";

import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/icons/Icon";
import { RSVP_ANSWERS, type Rsvp, type RsvpClosedReason } from "./model";

export const ANSWER_ICON: Record<Rsvp | "none", IconName> = {
  going: "circle-check",
  maybe: "circle-help",
  not_going: "circle-x",
  none: "circle-dashed",
};

/** ICU `answer` ของ rsvp.saved / yourAnswer ใช้ notGoing (ไม่มีขีดล่าง) */
export const answerParam = (a: Rsvp): "going" | "maybe" | "notGoing" => (a === "not_going" ? "notGoing" : a);

export interface RsvpControlProps {
  value: Rsvp | null;
  /** ปิดด้วยเหตุผลนี้ (ปุ่ม disabled + คำอธิบาย) · null = ตอบได้ */
  closed: RsvpClosedReason;
  saving: boolean;
  /** บันทึกไม่สำเร็จ — ข้อความ (แปลแล้ว) ใต้ปุ่ม · คงคำตอบเดิม */
  error: string | null;
  /** บันทึกสำเร็จล่าสุด */
  saved: Rsvp | null;
  labelledBy: string;
  onPick: (answer: Rsvp) => void;
  testIdPrefix?: string;
}

/**
 * ปุ่ม RSVP 3 ปุ่ม (X51): ไอคอนคนละรูป + ข้อความ + กรอบหนา/ตัวหนาเมื่อเลือก (ไม่พึ่งสีอย่างเดียว) · aria-pressed
 * ปิด (ยกเลิก/ผ่านแล้ว/ไม่มีสิทธิ์) = disabled + บรรทัดอธิบาย · กำลังบันทึก = aria-busy
 */
export function RsvpControl({ value, closed, saving, error, saved, labelledBy, onPick, testIdPrefix = "appt-rsvp" }: RsvpControlProps) {
  const t = useTranslations();
  const disabled = closed !== null;
  return (
    <div className="rsvp" data-testid={`${testIdPrefix}-block`} style={{ marginTop: 0 }}>
      <div className={saving ? "segmented rsvp-choice is-saving" : "segmented rsvp-choice"} role="group" aria-labelledby={labelledBy} aria-busy={saving || undefined}>
        {RSVP_ANSWERS.map((a) => (
          <button
            type="button"
            key={a}
            data-answer={a}
            data-testid={`${testIdPrefix}-${a}`}
            aria-pressed={value === a}
            disabled={disabled}
            onClick={() => onPick(a)}
          >
            <Icon name={ANSWER_ICON[a]} size="sm" />
            <span>{t(`appointments.rsvp.answer.${a}`)}</span>
          </button>
        ))}
      </div>
      {saving ? (
        <p className="rsvp-note" role="status">
          <Icon name="refresh-cw" size="sm" className="ov-spin" />
          <span>{t("appointments.rsvp.saving")}</span>
        </p>
      ) : null}
      {error ? (
        <p className="rsvp-error" role="alert" data-testid={`${testIdPrefix}-error`}>
          <Icon name="circle-alert" size="sm" />
          <span>{error}</span>
        </p>
      ) : null}
      {!saving && !error && saved ? (
        <p className="rsvp-note" role="status" data-testid={`${testIdPrefix}-saved`}>
          <Icon name="check" size="sm" />
          <span>{t("appointments.rsvp.saved", { answer: answerParam(saved) })}</span>
        </p>
      ) : null}
      {closed ? (
        <p className="rsvp-note" data-testid={`${testIdPrefix}-closed`}>
          <Icon name="info" size="sm" />
          <span>{closed === "cancelled" ? t("appointments.rsvp.closedCancelled") : closed === "past" ? t("appointments.rsvp.closedPast") : t("errors.FORBIDDEN")}</span>
        </p>
      ) : null}
    </div>
  );
}
