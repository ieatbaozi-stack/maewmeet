// เรียก API ของหน้าหลักจากเบราว์เซอร์ — คืนเป็นข้อมูล ไม่ throw
import { callApi, type ApiResult } from "@/components/auth/api";
import { apiErrorMessage } from "@/i18n/errors";
import { HOME_LIMIT, isRsvpAnswer, type HomeAppointment, type RsvpAnswer, type RsvpSummary } from "./model";

export function fetchMyAppointments(opts: { limit?: number; signal?: AbortSignal } = {}): Promise<ApiResult<{ appointments: HomeAppointment[] }>> {
  return callApi<{ appointments: HomeAppointment[] }>(`/api/me/appointments?limit=${opts.limit ?? HOME_LIMIT}`, {
    method: "GET",
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** อ่าน rsvp ({counts, mine}) จากคำตอบ PUT /api/appointments/:id/rsvp — รูปร่างผิด → null */
export function rsvpFromResponse(data: unknown): RsvpSummary | null {
  const rsvp = (data as { appointment?: { rsvp?: { counts?: Record<string, unknown>; mine?: unknown } } } | undefined)?.appointment?.rsvp;
  if (!rsvp?.counts) return null;
  const c = rsvp.counts;
  return {
    counts: { going: num(c.going), maybe: num(c.maybe), not_going: num(c.not_going), noResponse: num(c.noResponse) },
    mine: isRsvpAnswer(rsvp.mine) ? rsvp.mine : null,
  };
}

/** PUT /api/appointments/:id/rsvp {response} (callApi ไม่รองรับ PUT จึงเรียกเอง — same-origin JSON ตามกติกา CSRF) */
export async function putRsvp(id: string, response: RsvpAnswer): Promise<ApiResult<RsvpSummary>> {
  let res: Response;
  try {
    res = await fetch(`/api/appointments/${encodeURIComponent(id)}/rsvp`, {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    });
  } catch {
    return { ok: false, kind: "network" };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (res.ok) {
    const data = typeof json === "object" && json !== null && "data" in json ? (json as { data: unknown }).data : undefined;
    const summary = rsvpFromResponse(data);
    return summary ? { ok: true, data: summary } : { ok: false, kind: "api", status: res.status, error: apiErrorMessage(undefined) };
  }
  return { ok: false, kind: "api", status: res.status, error: apiErrorMessage(json) };
}
