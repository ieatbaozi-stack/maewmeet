// จับคู่ error ของ API → ข้อความ "ตามบริบท" (UX §4 R2 "จับคู่ error → ข้อความ") · ล้วน ทดสอบที่ tests/ui/groups-errors.test.ts
import type { ApiResult } from "@/components/auth/api";
import { messageRefOf, type MessageRef } from "@/i18n/auth-messages";
import { GROUP_LIMITS } from "@/lib/shared/limits";

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Failure = Extract<ApiResult<unknown>, { ok: false }>;

export type FailureContext =
  | "generic"
  | "join" // ใส่โค้ดเชิญ
  | "groupName" // สร้างกลุ่ม / เปลี่ยนชื่อ
  | "directInvite" // ชวนตรงด้วย username
  | "respondInvite" // รับ/ปฏิเสธคำเชิญตรง
  | "leave";

export interface FailureExtra {
  /** username ที่ผู้ใช้พิมพ์ (directInvite → alreadyInvited) */
  username?: string;
}

/** ข้อความของความล้มเหลว (เครือข่าย → states.error.network) ตามบริบท — ไม่รู้จัก → errors.<CODE> ตรงๆ */
export function failureRef(ctx: FailureContext, res: Failure, extra: FailureExtra = {}): MessageRef {
  if (res.kind === "network") return { key: "states.error.network", values: {} };
  const { code } = res.error;
  switch (ctx) {
    case "groupName":
      // ชื่อผิดกติกา → ข้อความใต้ช่อง (ส่ง max จากค่าคงที่ ไม่เขียน 40 ซ้ำ)
      if (code === "VALIDATION") return { key: "groups.createSheet.nameInvalid", values: { max: GROUP_LIMITS.nameMax } };
      break;
    case "directInvite":
      // CONFLICT = มีคำเชิญค้างอยู่แล้ว (ไม่ใช้ errors.CONFLICT ที่ผิดบริบท)
      if (code === "CONFLICT") return { key: "groupSettings.invite.direct.alreadyInvited", values: { username: extra.username ?? "" } };
      break;
    case "respondInvite":
      if (code === "NOT_FOUND" || code === "CONFLICT") return { key: "groups.invites.unavailable", values: {} };
      break;
    case "leave":
      if (code === "ADMIN_TRANSFER_REQUIRED") return { key: "groupSettings.leave.adminBlocked", values: {} };
      break;
    case "join":
    case "generic":
      break;
  }
  return messageRefOf(res.error);
}

/** ข้อความที่แปลแล้ว */
export function failureMessage(t: Translate, ctx: FailureContext, res: Failure, extra: FailureExtra = {}): string {
  const ref = failureRef(ctx, res, extra);
  return t(ref.key, ref.values);
}

/** เซิร์ฟเวอร์บอกว่าไม่มีทรัพยากรนี้แล้ว (กลุ่มถูกลบ / ไม่ใช่สมาชิกแล้ว) — UI ควร refresh/ออกจากหน้า */
export const isGone = (res: Failure): boolean => res.kind === "api" && res.status === 404;
