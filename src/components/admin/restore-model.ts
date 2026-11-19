// ตัวช่วยล้วนของ "กู้คืนกลุ่ม" (R17 G3) — ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/admin-restore-model.test.ts
import type { RawResult } from "@/components/account/api";
import { DEFAULT_TZ, daysUntil } from "@/lib/calendar";

type Failure = Extract<RawResult<unknown>, { ok: false }>;

/** เหลืออีกกี่วันก่อนลบถาวร (วันปฏิทิน Asia/Bangkok ผ่าน lib กลาง · ไม่ติดลบ) — null เมื่อไม่มีกำหนด */
export function purgeDaysLeft(purgeAt: number | null, nowMs: number): number | null {
  if (purgeAt === null || !Number.isFinite(purgeAt)) return null;
  return Math.max(0, daysUntil(nowMs, purgeAt, DEFAULT_TZ));
}

/** ≤ 7 วัน → เน้นสี danger-ink (พร้อมข้อความ/ไอคอน ไม่พึ่งสีอย่างเดียว) */
export const PURGE_WARN_DAYS = 7;

export type RestoreErrorKey = "expired" | "noAdmin" | "purged" | "alreadyRestored";

export type RestoreOutcome =
  | { kind: "restored" }
  /** 200 changed:false — มีคนกู้ไปแล้ว */
  | { kind: "already" }
  /** เหตุที่รู้จัก: หลังแสดงข้อความให้รีเฟรชแถว (noAdmin คงปุ่มไว้) */
  | { kind: "blocked"; reason: "expired" | "noAdmin" | "purged" }
  /** อย่างอื่น (429, 403, 5xx, เครือข่าย) → ใช้ข้อความ error กลาง */
  | { kind: "error"; failure: Failure };

/** POST /api/admin/groups/:gid/restore → ผลที่ UI ต้องตัดสิน (R17 §1 G1) */
export function restoreOutcome(res: RawResult<{ group?: { changed?: boolean } }>): RestoreOutcome {
  if (res.ok) return res.data?.group?.changed === false ? { kind: "already" } : { kind: "restored" };
  if (res.kind === "network") return { kind: "error", failure: res };
  const { code } = res.error;
  if (code === "CONFLICT") {
    const reason = (res.params as { reason?: unknown }).reason;
    if (reason === "RETENTION_EXPIRED") return { kind: "blocked", reason: "expired" };
    if (reason === "NO_ACTIVE_ADMIN") return { kind: "blocked", reason: "noAdmin" };
  }
  if (code === "NOT_FOUND" || res.status === 404) return { kind: "blocked", reason: "purged" };
  return { kind: "error", failure: res };
}
