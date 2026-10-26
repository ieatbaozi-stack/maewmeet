import type { Metadata } from "next";
import { getPageUser, requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { AppointmentDetail } from "@/components/appointments/AppointmentDetail";
import { clock } from "@/lib/shared/clock";
import { memberColorIndex } from "@/lib/shared/member-color";
import { loadAppointment } from "../_lib/load";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  // ชื่อนัดเป็นข้อมูลของสมาชิก: ไม่ล็อกอิน/ต้องเปลี่ยน PIN → title เริ่มต้น (หน้าเองจะ redirect)
  const user = await getPageUser().catch(() => null);
  if (!user || user.mustChangePin) return {};
  const { id } = await params;
  try {
    return { title: (await loadAppointment(id)).title };
  } catch {
    return {}; // 404/ผิดพลาดอื่น: ให้ตัวหน้าตัดสินเอง
  }
}

/** รายละเอียดนัด (UX §9 W21) — โหลดฝั่งเซิร์ฟเวอร์ผ่าน service (สิทธิ์ตัดสินที่ service) */
export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const appointment = await loadAppointment(id);
  return (
    <>
      <Aurora intensity="soft" />
      <AppointmentDetail
        initial={appointment}
        me={{ userId: user.id, displayName: user.displayName, colorIndex: memberColorIndex(appointment.groupId, user.id) }}
        nowMs={clock.now()}
      />
    </>
  );
}
