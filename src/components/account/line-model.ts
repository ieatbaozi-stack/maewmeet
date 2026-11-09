// view-model ล้วนของส่วนเชื่อม LINE ใน /me (R10 §2 · docs/design/R10_LINE.md) — ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/line-model.test.ts
// โค้ดเชื่อมต่อเป็นความลับระยะสั้น: อยู่ใน state ของคอมโพเนนต์เท่านั้น ห้ามลง URL/storage/log

export interface LineStatus {
  available: boolean;
  addFriendUrl: string | null;
  linked: boolean;
  pendingExpiresAt: number | null;
}

export interface LineCode {
  code: string;
  expiresAt: number;
}

/** ช่วงตรวจสถานะระหว่างรอผู้ใช้ส่งโค้ดในแชท (ไม่ถี่ — ตรวจตอนกลับมาที่แท็บด้วย) */
export const LINE_POLL_MS = 20_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** รับ response ของ GET /api/me/line แบบไม่เชื่อรูปร่าง: ผิดรูป = null (ซ่อนส่วนนี้ ไม่เดา) */
export function parseLineStatus(data: unknown): LineStatus | null {
  if (!isObj(data) || typeof data.available !== "boolean" || typeof data.linked !== "boolean") return null;
  const url = typeof data.addFriendUrl === "string" && /^https:\/\//.test(data.addFriendUrl) ? data.addFriendUrl : null;
  const exp = typeof data.pendingExpiresAt === "number" && Number.isFinite(data.pendingExpiresAt) ? data.pendingExpiresAt : null;
  return { available: data.available, addFriendUrl: url, linked: data.linked, pendingExpiresAt: exp };
}

export function parseLineCode(data: unknown): LineCode | null {
  if (!isObj(data) || typeof data.code !== "string" || data.code === "" || typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt)) return null;
  return { code: data.code, expiresAt: data.expiresAt };
}

/** โค้ดยังไม่หมดอายุ ณ เวลา now (หมดพอดี = หมด) */
export const codeActive = (c: LineCode | null, nowMs: number): c is LineCode => c !== null && c.expiresAt > nowMs;

/** ms ที่เหลือก่อนหมดอายุ (ไม่ติดลบ) — ใช้ตั้ง timer กลับไปสถานะ "ยังไม่เชื่อม" */
export const msUntil = (expiresAt: number, nowMs: number): number => Math.max(0, expiresAt - nowMs);

export type LineView = "hidden" | "idle" | "code" | "linked";

/** สถานะที่แสดง: ช่องทางปิด/ยังไม่รู้สถานะ = ซ่อน · เชื่อมแล้วชนะโค้ดค้าง */
export function lineView(status: LineStatus | null, code: LineCode | null, nowMs: number): LineView {
  if (!status || !status.available) return "hidden";
  if (status.linked) return "linked";
  return codeActive(code, nowMs) ? "code" : "idle";
}

/**
 * ข้อความ error ใต้ปุ่ม: ใช้ me.line.error เป็นหลัก · ทำถี่เกิน/ช่องทางปิด ใช้ข้อความกลางที่ตรงเหตุกว่า (errors.*)
 * 409 ไม่แสดงเป็นข้อผิดพลาด (ผู้เรียกโหลดสถานะใหม่แทน — เช่น เชื่อมไปแล้วจากอีกแท็บ)
 */
export function lineErrorKey(res: { ok: false; kind: "network" } | { ok: false; kind: "api"; status: number }): string {
  if (res.kind === "api" && res.status === 429) return "errors.RATE_LIMITED";
  if (res.kind === "api" && res.status === 503) return "errors.FEATURE_DISABLED";
  return "me.line.error";
}

export const lineIsConflict = (res: { ok: false; kind: "network" } | { ok: false; kind: "api"; status: number }): boolean =>
  res.kind === "api" && res.status === 409;
