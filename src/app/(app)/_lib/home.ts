// โหลดข้อมูลหน้าหลักฝั่งเซิร์ฟเวอร์ — เรียก service ตรง (authorize ที่ service) · ไม่มีกลุ่ม → "no-group" · ล้มเหลว → "error"
// (ให้ UI ขึ้นสถานะผิดพลาด + ลองอีกครั้ง ไม่โยนทั้งหน้า) · นัดที่ยกเลิกไม่ถูกส่งมาจาก API นี้จึงไม่แสดงบนหน้าหลัก
import { getRequestSession } from "@/lib/auth/page-session";
import { HOME_LIMIT, type HomeAppointment } from "@/components/home/model";
import { dataCtx } from "@/lib/data/context";
import { getHomeFeed } from "@/lib/data/services/home";
import { clock } from "@/lib/shared/clock";

export type HomeData =
  | { kind: "no-group"; nowMs: number }
  | { kind: "error"; nowMs: number }
  | { kind: "ready"; nowMs: number; appointments: HomeAppointment[] };

export async function loadHome(): Promise<HomeData> {
  const nowMs = clock.now();
  try {
    const { req, actor } = await getRequestSession();
    const { hasGroups, appointments } = await getHomeFeed(actor, { limit: String(HOME_LIMIT) }, dataCtx(req, nowMs));
    if (!hasGroups) return { kind: "no-group", nowMs };
    return { kind: "ready", nowMs, appointments: appointments as HomeAppointment[] };
  } catch {
    return { kind: "error", nowMs };
  }
}
