// เรียก /api/* สำหรับนัด/สถานที่ — ต่างจาก callApi ตรงที่เก็บ params.fields (VALIDATION) และรองรับ PUT
// (callApi ทิ้งพารามิเตอร์ที่เป็นอ็อบเจกต์ → จับคู่ error → ช่องฟอร์มไม่ได้) · ไม่ log/เก็บ body · ผลลัพธ์เป็นข้อมูล ไม่ throw
import { apiErrorMessage, type ApiErrorMessage } from "@/i18n/errors";

export type FullResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "api"; status: number; error: ApiErrorMessage; fields: Record<string, string> }
  | { ok: false; kind: "network" };

export type Failure = Extract<FullResult<unknown>, { ok: false }>;

export interface FullOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** params.fields → { ช่อง: เหตุผล } (เฉพาะค่าสตริง) */
export function fieldsOf(json: unknown): Record<string, string> {
  const params = typeof json === "object" && json !== null && "error" in json ? (json as { error?: { params?: unknown } }).error?.params : undefined;
  const raw = typeof params === "object" && params !== null ? (params as { fields?: unknown }).fields : undefined;
  const out: Record<string, string> = {};
  if (typeof raw === "object" && raw !== null) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function callApiFull<T>(path: string, opts: FullOptions = {}): Promise<FullResult<T>> {
  const method = opts.method ?? "GET";
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
  return { ok: false, kind: "api", status: res.status, error: apiErrorMessage(json), fields: fieldsOf(json) };
}

