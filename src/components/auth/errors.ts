import { messageRefOf } from "@/i18n/auth-messages";
import type { ApiResult } from "./api";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** ข้อความผิดพลาดของผลเรียก API ที่ล้มเหลว (เครือข่าย → states.error.network) */
export function failureText(t: Translate, res: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (res.kind === "network") return t("states.error.network");
  const ref = messageRefOf(res.error);
  return t(ref.key, ref.values);
}
