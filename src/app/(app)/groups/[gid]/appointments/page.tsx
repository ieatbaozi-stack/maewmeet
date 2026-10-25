import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { AppointmentList } from "@/components/appointments/AppointmentList";
import { clock } from "@/lib/shared/clock";
import { loadGroup } from "../../_lib/load";
import { loadGroupAppointments } from "../../../appointments/_lib/load";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("appointments.list");
  return { title: t("title") };
}

/** นัดของกลุ่ม (UX §9 W23) — กำลังจะถึง (โหลดฝั่งเซิร์ฟเวอร์) | ที่ผ่านมา (โหลดเมื่อเปิดแท็บ) */
export default async function GroupAppointmentsPage({ params }: { params: Promise<{ gid: string }> }) {
  const user = await requireUser();
  const { gid } = await params;
  const group = await loadGroup(gid);
  const initial = await loadGroupAppointments(gid);
  return (
    <>
      <Aurora intensity="soft" />
      <AppointmentList groupId={group.id} groupName={group.name} memberCount={group.memberCount} tz={group.tz} userId={user.id} nowMs={clock.now()} initial={initial} />
    </>
  );
}
