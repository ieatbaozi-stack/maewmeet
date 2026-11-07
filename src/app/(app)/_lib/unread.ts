// จำนวนแจ้งเตือนที่ยังไม่อ่านสำหรับ layout (ไม่มีแฟลชของป้ายกระดิ่ง) — เรียก service ตรง (authorize ที่ service)
// ล้มเหลว → null (กระดิ่งไม่โชว์ตัวเลข ไม่ทำให้ทั้งหน้าพัง)
import { getRequestSession } from "@/lib/auth/page-session";
import { dataCtx } from "@/lib/data/context";
import { listMyNotifications } from "@/lib/data/services/notifications";
import { clock } from "@/lib/shared/clock";

export async function loadUnreadCount(): Promise<number | null> {
  try {
    const { req, actor } = await getRequestSession();
    const r = await listMyNotifications(actor, { limit: "1" }, dataCtx(req, clock.now()));
    return r.unreadCount;
  } catch {
    return null;
  }
}
