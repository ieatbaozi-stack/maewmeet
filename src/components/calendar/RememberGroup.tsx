"use client";

import { useEffect } from "react";
import { callApiFull } from "@/components/appointments/api";

/**
 * จำกลุ่มปัจจุบันของเครื่องนี้ (R6D G1 · ADR 0009 §5): PUT /api/me/current-group → เซิร์ฟเวอร์ตั้งคุกกี้ mm_group
 * (Server Component ตั้งคุกกี้ไม่ได้ จึงให้ไคลเอนต์เรียก) · ยิงแล้วไม่รอผล ไม่แจ้ง error ผู้ใช้ — ล้มเหลว = แค่ไม่จำ ใช้งานต่อได้
 * ใช้ callApiFull → Content-Type: application/json + same-origin ตามกติกา CSRF ของ route wrapper
 */
export function rememberGroup(gid: string): void {
  void callApiFull("/api/me/current-group", { method: "PUT", body: { gid } }).catch(() => undefined);
}

/** เรนเดอร์แล้วจำกลุ่มครั้งเดียวต่อ gid (ไม่แสดงอะไร) */
export function RememberGroup({ gid }: { gid: string }) {
  useEffect(() => {
    rememberGroup(gid);
  }, [gid]);
  return null;
}
