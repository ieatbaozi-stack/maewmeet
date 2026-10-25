// โหลดหน้าแรกของแจ้งเตือนฝั่งเซิร์ฟเวอร์ — เรียก service ตรง (authorize ที่ service: เฉพาะของตัวเอง)
// ล้มเหลว → null แล้วให้ UI แสดงสถานะผิดพลาด + ลองอีกครั้ง (ไม่โยนทั้งหน้า)
import { pageRequest } from "@/app/_lib/session";
import { NOTIFICATION_PAGE_SIZE, type NotificationPage } from "@/components/notifications/model";
import { getActor } from "@/lib/auth/session";
import { dataCtx } from "@/lib/data/context";
import { listMyNotifications } from "@/lib/data/services/notifications";
import { clock } from "@/lib/shared/clock";

export async function loadNotificationsPage(): Promise<{ page: NotificationPage | null; nowMs: number }> {
  const nowMs = clock.now();
  try {
    const req = await pageRequest();
    const actor = await getActor(req);
    const page = await listMyNotifications(actor, { limit: String(NOTIFICATION_PAGE_SIZE) }, dataCtx(req, nowMs));
    return { page, nowMs };
  } catch {
    return { page: null, nowMs };
  }
}
