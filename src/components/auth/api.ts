// เรียก /api/* จากเบราว์เซอร์ — JSON + same-origin (route wrapper ตรวจ Origin + content-type: CSRF)
// non-GET (รวม DELETE) ส่ง Content-Type: application/json + body เสมอ (route wrapper ตรวจ CSRF ที่ทุก non-GET)
// ไม่ log และไม่เก็บ body (มี PIN / โค้ดเชิญ) ไว้ที่ใด · ผลลัพธ์เป็นข้อมูล ไม่ throw
import { apiErrorMessage, type ApiErrorMessage } from "@/i18n/errors";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "api"; status: number; error: ApiErrorMessage }
  | { ok: false; kind: "network" };

export interface CallOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export async function callApi<T>(path: string, opts: CallOptions = {}): Promise<ApiResult<T>> {
  const method = opts.method ?? "POST";
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
      ...(method === "GET"
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts.body ?? {}) }),
    });
  } catch {
    return { ok: false, kind: "network" };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (res.ok) {
    const data = typeof json === "object" && json !== null && "data" in json ? (json as { data: T }).data : undefined;
    return { ok: true, data: data as T };
  }
  return { ok: false, kind: "api", status: res.status, error: apiErrorMessage(json) };
}
