"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { AppointmentFormSheet } from "./AppointmentFormSheet";

export interface CreateAppointmentButtonProps {
  groupId: string;
  groupName: string;
  memberCount: number;
  tz: string;
  userId: string;
  /** primary = ปุ่มหลักของหน้า (เต็มความกว้าง) */
  className?: string;
  testId?: string;
}

/** ปุ่ม "สร้างนัด" + sheet ฟอร์ม (หน้ากลุ่ม / หน้ารายการนัดของกลุ่ม) — กลุ่มมาจากบริบท ไม่มีตัวเลือกกลุ่ม */
export function CreateAppointmentButton({ groupId, groupName, memberCount, tz, userId, className = "btn btn-primary", testId = "appt-create" }: CreateAppointmentButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} data-testid={testId} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="calendar-plus" />
        <span>{t("appointments.create")}</span>
      </button>
      {open ? <AppointmentFormSheet mode="create" groupId={groupId} groupName={groupName} memberCount={memberCount} tz={tz} userId={userId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
