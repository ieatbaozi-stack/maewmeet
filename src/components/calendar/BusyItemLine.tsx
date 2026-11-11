"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { Name, withNames } from "@/components/Name";
import type { BusyKind } from "./model";

export interface BusyItemLineProps {
  kind: BusyKind;
  /** ข้อความเวลาที่แปลแล้ว */
  whenText: string;
  /** ชื่อรายการ (busy ที่ลงชื่อไว้ / ชื่อนัดของกลุ่มนี้) · null = ซ่อน/ไม่ได้ใส่ */
  title: string | null;
  /** ชื่อเจ้าของช่วง (ไว้ใช้ใน aria-label) */
  memberName: string;
  /** kind 'appointment' เท่านั้น: ลิงก์ไปหน้านัด */
  href: string | null;
  /** "วันที่ n จาก m" ฯลฯ */
  subText: string | null;
  /** data-testid ของรายการ busy ปกติ (ของเดิม — cal-item / free-item) */
  busyTestId: string;
  /** R14: วันของ routine ของฉันเอง (เจ้าของเท่านั้น) → ป้าย "ประจำ" + ปุ่มแก้/ลบ (เปิด sheet เลือกขอบเขต) */
  routine?: { onEdit: () => void; onDelete: () => void; editAria: string; deleteAria: string };
}

/**
 * รายการช่วงไม่ว่าง 1 แถวในมุมมองวัน / รายละเอียดวันว่างตรงกัน (R6D) — 3 ชนิดแยกกันด้วยไอคอน+ข้อความ ไม่ใช้สีอย่างเดียว:
 *  busy = ข้อความเดิม · appointment = ไอคอนปฏิทิน + "นัด: <ชื่อ>" แตะไปหน้านัด · other_group_appointment = ไอคอนกุญแจ + "ติดนัดกลุ่มอื่น" แตะไม่ได้
 * นัดกลุ่มอื่นไม่มีชื่อนัด/กลุ่ม/สถานที่ในข้อมูลอยู่แล้ว — ที่นี่ไม่ใส่อะไรเพิ่มใน DOM / title / aria
 */
export function BusyItemLine({ kind, whenText, title, memberName, href, subText, busyTestId, routine }: BusyItemLineProps) {
  const t = useTranslations();
  if (kind === "other_group_appointment") {
    return (
      <div className="cal-item is-other" role="group" aria-label={t("calendar.kind.otherAria", { name: memberName, time: whenText })} data-testid="cal-item-other-group">
        <span className="when">{whenText}</span>
        <span className="what kind-label">
          <Icon name="lock" size="sm" />
          <span>{t("calendar.kind.otherLabel")}</span>
        </span>
        {subText ? <span className="sub">{subText}</span> : null}
      </div>
    );
  }
  if (kind === "appointment") {
    const name = title ?? "";
    const body = (
      <>
        <span className="when">{whenText}</span>
        <span className="what kind-label">
          <Icon name="calendar" size="sm" />
          <span>{withNames((n) => t("calendar.kind.appointmentLabel", { title: n.title }), { title: name })}</span>
        </span>
        {subText ? <span className="sub">{subText}</span> : null}
      </>
    );
    return href ? (
      <Link className="cal-item is-appt is-link" href={href} aria-label={t("calendar.kind.appointmentAria", { name: memberName, title: name, time: whenText })} data-testid="cal-item-appointment">
        {body}
      </Link>
    ) : (
      <div className="cal-item is-appt" data-testid="cal-item-appointment">
        {body}
      </div>
    );
  }
  return (
    <div className={routine ? "cal-item is-routine" : "cal-item"} data-testid={busyTestId}>
      <span className="when">{whenText}</span>
      {title ? (
        <span className="what">
          <Name>{title}</Name>
        </span>
      ) : (
        <span className="what plain">{t("calendar.day.busyPlain")}</span>
      )}
      {subText ? <span className="sub">{subText}</span> : null}
      {routine ? (
        <span className="rt-day-tools">
          <span className="rt-tag" aria-label={t("busy.routine.calendar.tagAria")} data-testid="routine-tag">
            <Icon name="repeat" size="sm" />
            <span>{t("busy.routine.calendar.tag")}</span>
          </span>
          <button type="button" className="icon-btn" aria-label={routine.editAria} data-testid="routine-day-edit" onClick={routine.onEdit}>
            <Icon name="pencil" />
          </button>
          <button type="button" className="icon-btn" aria-label={routine.deleteAria} data-testid="routine-day-delete" onClick={routine.onDelete}>
            <Icon name="trash-2" />
          </button>
        </span>
      ) : null}
    </div>
  );
}
