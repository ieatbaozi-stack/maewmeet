// เรียก API แจ้งเตือนจากเบราว์เซอร์ — คืนเป็นข้อมูล ไม่ throw (callApi ของ auth: same-origin JSON)
import { callApi, type ApiResult } from "@/components/auth/api";
import { apiErrorMessage } from "@/i18n/errors";
import { NOTIFICATION_PAGE_SIZE, type NotificationPage } from "./model";

export function fetchNotifications(opts: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}): Promise<ApiResult<NotificationPage>> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? NOTIFICATION_PAGE_SIZE) });
  if (opts.cursor) q.set("cursor", opts.cursor);
  return callApi<NotificationPage>(`/api/me/notifications?${q.toString()}`, { method: "GET", ...(opts.signal ? { signal: opts.signal } : {}) });
}

/** จำนวนยังไม่อ่าน: ไม่มี endpoint แยก → ขอหน้าแรก limit=1 แล้วอ่าน unreadCount */
export async function fetchUnreadCount(signal?: AbortSignal): Promise<number | null> {
  const r = await fetchNotifications({ limit: 1, ...(signal ? { signal } : {}) });
  return r.ok && typeof r.data.unreadCount === "number" ? r.data.unreadCount : null;
}

export interface MarkReadResult {
  updated: number;
  unreadCount: number;
}

/**
 * POST /api/me/notifications/read — {ids} หรือ {all:true}
 * keepalive: แตะแถวแล้วเปลี่ยนหน้าทันที คำขอต้องไม่ถูกยกเลิกตอนหน้าเดิมถูกถอด
 */
export async function markRead(body: { ids: string[] } | { all: true }, opts: { keepalive?: boolean } = {}): Promise<ApiResult<MarkReadResult>> {
  let res: Response;
  try {
    res = await fetch("/api/me/notifications/read", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: opts.keepalive === true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, kind: "network" };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (res.ok) {
    const data = typeof json === "object" && json !== null && "data" in json ? (json as { data: MarkReadResult }).data : undefined;
    return data ? { ok: true, data } : { ok: false, kind: "api", status: res.status, error: apiErrorMessage(undefined) };
  }
  return { ok: false, kind: "api", status: res.status, error: apiErrorMessage(json) };
}
