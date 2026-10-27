// เรียก /api/* แบบเดียวกับ components/auth/api.ts แต่คืน params ดิบของ error ด้วย
// (409 ADMIN_TRANSFER_REQUIRED มี groups:[{id,name}] · VALIDATION มี fields:{displayName} — apiErrorMessage เก็บแค่ค่าพื้นฐาน)
// ไม่ log และไม่เก็บ body (มี PIN) ไว้ที่ใด · ผลลัพธ์เป็นข้อมูล ไม่ throw
import { apiErrorMessage, type ApiErrorMessage } from "@/i18n/errors";
import type { CallOptions } from "@/components/auth/api";

export type RawResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "api"; status: number; error: ApiErrorMessage; params: Record<string, unknown> }
  | { ok: false; kind: "network" };

export async function callApiRaw<T>(path: string, opts: CallOptions = {}): Promise<RawResult<T>> {
  const method = opts.method ?? "POST";
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
      ...(method === "GET" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts.body ?? {}) }),
    });
  } catch {
    return { ok: false, kind: "network" };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (res.ok) {
    const data = typeof json === "object" && json !== null && "data" in json ? (json as { data: T }).data : undefined;
    return { ok: true, data: data as T };
  }
  const raw = typeof json === "object" && json !== null ? (json as { error?: { params?: unknown } }).error?.params : undefined;
  const params = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { ok: false, kind: "api", status: res.status, error: apiErrorMessage(json), params };
}
