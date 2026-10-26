// ตัวช่วยล้วนของบัญชี/หน้า admin (R5) — ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/account-model.test.ts
import type { MessageRef } from "@/i18n/auth-messages";
import { messageRefOf } from "@/i18n/auth-messages";
import { DISPLAY_NAME_MAX } from "@/lib/auth/pin-rules";
import { ACCOUNT_RATE_LIMITS } from "@/lib/shared/limits";
import type { RawResult } from "./api";

type Failure = Extract<RawResult<unknown>, { ok: false }>;

/** username ของบัญชีที่ลบแล้ว (repos/account.ts DELETED_USERNAME_PREFIX) — ใช้ตัดสินการแสดง "บัญชีที่ถูกลบ" ใน audit */
export const DELETED_USERNAME_PREFIX = "deleted-";

/**
 * ชื่อที่จะแสดง: ชื่อว่าง (บัญชีที่ถูกลบ → display_name = '') หรือ username แบบ deleted-<id> → ป้าย "บัญชีที่ถูกลบ"
 * ไม่ trim ชื่อจริง (ชื่อที่ผ่านกติกามีตัวอักษรที่มองเห็นเสมอ)
 */
export function shownName(name: string | null | undefined, deletedLabel: string): string {
  if (typeof name !== "string" || name.trim() === "" || name.startsWith(DELETED_USERNAME_PREFIX)) return deletedLabel;
  return name;
}

export type GroupRef = { id: string; name: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** 409 ADMIN_TRANSFER_REQUIRED → params.groups [{id,name}] (ตรวจรูปร่างทีละตัว · ตัวที่ผิดรูปข้าม) */
export function transferGroupsOf(params: unknown): GroupRef[] {
  if (typeof params !== "object" || params === null) return [];
  const groups = (params as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((g): GroupRef[] => {
    if (typeof g !== "object" || g === null) return [];
    const { id, name } = g as { id?: unknown; name?: unknown };
    return typeof id === "string" && ID.test(id) && typeof name === "string" ? [{ id, name }] : [];
  });
}

/** ข้อความผิดพลาดของการเปลี่ยนชื่อ — VALIDATION ของ displayName บอกเหตุผลตรงตัว · RATE_LIMITED บอกเพดานต่อวัน */
export function renameErrorRef(res: Failure): MessageRef {
  if (res.kind === "network") return { key: "states.error.network", values: {} };
  const { code } = res.error;
  if (code === "VALIDATION") {
    const fields = (res.params as { fields?: unknown }).fields;
    const reason = typeof fields === "object" && fields !== null ? (fields as { displayName?: unknown }).displayName : undefined;
    if (typeof reason === "string") return { key: "account.rename.invalid", values: { reason, max: DISPLAY_NAME_MAX } };
  }
  if (code === "RATE_LIMITED") return { key: "account.rename.rateLimited", values: { perDay: ACCOUNT_RATE_LIMITS.rename.limit } };
  return messageRefOf(res.error);
}

/** ตรวจชื่อฝั่งเครื่องก่อนส่ง (แค่กันกดส่งชื่อว่าง/ยาวเกิน — กติกาจริงตรวจที่เซิร์ฟเวอร์) */
export function renameLocalProblem(value: string): "TOO_SHORT" | "TOO_LONG" | null {
  const v = value.normalize("NFC").trim();
  if (v === "") return "TOO_SHORT";
  if ([...v].length > DISPLAY_NAME_MAX) return "TOO_LONG";
  return null;
}

/** ผลลบบัญชีที่ล้มเหลว → สิ่งที่ sheet ควรแสดง */
export type DeleteOutcome =
  | { kind: "transfer"; groups: GroupRef[] }
  | { kind: "superAdmin" }
  | { kind: "authLost" }
  | { kind: "error"; ref: MessageRef; resetPin: boolean };

export function deleteOutcome(res: Failure): DeleteOutcome {
  if (res.kind === "network") return { kind: "error", ref: { key: "states.error.network", values: {} }, resetPin: false };
  const { code } = res.error;
  if (code === "ADMIN_TRANSFER_REQUIRED") return { kind: "transfer", groups: transferGroupsOf(res.params) };
  if (code === "FORBIDDEN") return { kind: "superAdmin" };
  if (code === "AUTH_REQUIRED" || code === "ACCOUNT_SUSPENDED") return { kind: "authLost" };
  // PIN ผิด/ล็อก/รูปแบบผิด → ล้างจุด PIN ให้ใส่ใหม่
  return { kind: "error", ref: messageRefOf(res.error), resetPin: true };
}

// ───────── หน้า admin ─────────

/** รายการแบบ cursor: ต่อหน้าใหม่ท้ายรายการ ตัด id ซ้ำ (ระหว่างโหลดอาจมีแถวใหม่ทำให้ขอบหน้าเลื่อน) */
export function appendUnique<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(existing.map((i) => i.id));
  return [...existing, ...incoming.filter((i) => !seen.has(i.id))];
}

/** query string จากค่าที่ไม่ว่าง (ลำดับคงที่) */
export function queryString(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v.trim() !== "") q.set(k, v.trim());
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** id ยาว (uuid) → 8 ตัวแรก สำหรับแสดงในการ์ด (ค่าเต็มอยู่ใน title/ตัวกรอง) */
export const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…` : id);

export type AuditMetaValue = string | number | boolean | null | string[];

/**
 * meta ที่ UI แสดงได้ (ชุดเดียวกับ AUDIT_META_WHITELIST ของ serializer — เซิร์ฟเวอร์กรองแล้ว ที่นี่กรองซ้ำ)
 * คีย์ที่ไม่รู้จักไม่ถูกแสดง ไม่ว่าเซิร์ฟเวอร์จะส่งอะไรมา
 */
export const AUDIT_META_KEYS = [
  "decision",
  "state",
  "targetUserId",
  "fromUserId",
  "toUserId",
  "inviteeUserId",
  "targetRole",
  "from",
  "to",
  "fields",
  "kind",
  "scope",
  "inviteId",
  "appointmentId",
  "wasLocked",
  "filtered",
  "asSuperAdmin",
] as const;
export type AuditMetaKey = (typeof AUDIT_META_KEYS)[number];

/** คีย์ที่ค่าเป็น id → แสดงแบบย่อ */
export const AUDIT_ID_KEYS: ReadonlySet<AuditMetaKey> = new Set(["targetUserId", "fromUserId", "toUserId", "inviteeUserId", "inviteId", "appointmentId"]);

export function visibleMeta(meta: unknown): { key: AuditMetaKey; value: AuditMetaValue }[] {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return [];
  const m = meta as Record<string, unknown>;
  return AUDIT_META_KEYS.flatMap((key): { key: AuditMetaKey; value: AuditMetaValue }[] => {
    if (!Object.prototype.hasOwnProperty.call(m, key)) return [];
    const v = m[key];
    if (v === null || typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) return [{ key, value: v }];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return [{ key, value: v as string[] }];
    return [];
  });
}
