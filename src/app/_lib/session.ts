// ตัวช่วยฝั่งเซิร์ฟเวอร์ของหน้าเว็บ (server components): หาผู้ใช้จาก cookie + guard ตาม R1_CONTRACT §2
//  - ใช้ getActor ของ Auth (อ่าน session/is_admin/must_change_pin สดจาก DB ทุก request — ADR 0002 §4)
//  - guard อยู่ในหน้า/เลย์เอาต์ ไม่ใช่ proxy (ADR 0001 §1: ไม่ใช้ proxy.ts ใน v1) · สิทธิ์จริงของ API ตรวจที่ route เสมอ
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authCtx } from "@/lib/auth/context";
import { getPinResetStatus, type PinResetStatus } from "@/lib/auth/services/pin-reset";
import { getActor } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { findUserById, type UserRow } from "@/lib/data/repos/user";
import type { UserActor } from "@/lib/rbac/types";
import { clock } from "@/lib/shared/clock";

/** Request เทียมที่มีแต่ cookie ของ request ปัจจุบัน — ให้ getActor/service อ่าน cookie ชุดเดียวกับ route handler */
export async function pageRequest(): Promise<Request> {
  const header = (await cookies()).toString();
  return new Request("http://internal.invalid/", { headers: header ? { cookie: header } : {} });
}

export type PageUser = Pick<UserRow, "id" | "username" | "displayName" | "isAdmin" | "mustChangePin">;

export const getPageUser = cache(async (): Promise<PageUser | null> => {
  const req = await pageRequest();
  const actor = await getActor(req);
  if (actor.kind !== "user") return null;
  const row = await findUserById(getDb(), (actor as UserActor).id);
  if (!row || row.status !== "active") return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    isAdmin: row.isAdmin,
    mustChangePin: row.mustChangePin,
  };
});

/** หน้าที่ต้องล็อกอิน: ไม่ล็อกอิน → /login · ต้องเปลี่ยน PIN → /set-pin */
export async function requireUser(): Promise<PageUser> {
  const user = await getPageUser();
  if (!user) redirect("/login");
  if (user.mustChangePin) redirect("/set-pin");
  return user;
}

/** /admin/** : ไม่ใช่ super admin → 404 (ไม่เปิดเผยว่ามีหน้านี้) */
export async function requireSuperAdmin(): Promise<PageUser> {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}

/** หน้า /set-pin: ต้องล็อกอิน และยังติด must_change_pin เท่านั้น */
export async function requireMustChangePin(): Promise<PageUser> {
  const user = await getPageUser();
  if (!user) redirect("/login");
  if (!user.mustChangePin) redirect("/");
  return user;
}

/** หน้าสาธารณะ (login/signup/forgot): ล็อกอินอยู่แล้วไม่ต้องเห็น */
export async function redirectIfSignedIn(): Promise<void> {
  const user = await getPageUser();
  if (user) redirect(user.mustChangePin ? "/set-pin" : "/");
}

/** สถานะคำขอ reset ของเครื่องนี้ (cookie mm_reset) — ใช้แสดงแบนเนอร์ที่ /login และสถานะเริ่มต้นที่ /forgot */
export async function getResetStatus(): Promise<PinResetStatus> {
  const req = await pageRequest();
  return getPinResetStatus({ kind: "anonymous" }, authCtx(req, clock.now()));
}
