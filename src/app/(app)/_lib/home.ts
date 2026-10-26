// โหลดข้อมูลหน้าหลักฝั่งเซิร์ฟเวอร์ — เรียก service ตรง (authorize ที่ service) · ไม่มีกลุ่ม → "no-group" · ล้มเหลว → "error"
// (ให้ UI ขึ้นสถานะผิดพลาด + ลองอีกครั้ง ไม่โยนทั้งหน้า) · นัดที่ยกเลิกไม่ถูกส่งมาจาก API นี้จึงไม่แสดงบนหน้าหลัก
import { pageRequest } from "@/app/_lib/session";
import { HOME_LIMIT, type HomeAppointment } from "@/components/home/model";
import { getActor } from "@/lib/auth/session";
import { dataCtx } from "@/lib/data/context";
import { listMyAppointments } from "@/lib/data/services/appointments";
import { listMyGroups } from "@/lib/data/services/groups";
import { clock } from "@/lib/shared/clock";

export type HomeData =
  | { kind: "no-group"; nowMs: number }
  | { kind: "error"; nowMs: number }
  | { kind: "ready"; nowMs: number; appointments: HomeAppointment[] };

export async function loadHome(): Promise<HomeData> {
  const nowMs = clock.now();
  try {
    const req = await pageRequest();
    const actor = await getActor(req);
    const ctx = dataCtx(req, nowMs);
    const { groups } = await listMyGroups(actor, ctx);
    if (groups.length === 0) return { kind: "no-group", nowMs };
    const { appointments } = await listMyAppointments(actor, { limit: String(HOME_LIMIT) }, ctx);
    return { kind: "ready", nowMs, appointments: appointments as HomeAppointment[] };
  } catch {
    return { kind: "error", nowMs };
  }
}
