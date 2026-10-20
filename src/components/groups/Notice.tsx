"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import type { MessageRef } from "@/i18n/auth-messages";
import { takeFlash } from "./flash";

/** แถบสถานะ (สำเร็จ = เขียว, ผิดพลาด = แดง) — role=status/alert เพื่อให้ screen reader อ่าน */
export function Notice({ kind, children }: { kind: "ok" | "error"; children: React.ReactNode }) {
  return (
    <div className={kind === "ok" ? "alert alert-free toast" : "alert toast"} role={kind === "ok" ? "status" : "alert"}>
      <Icon name={kind === "ok" ? "circle-check" : "circle-alert"} />
      <div>{children}</div>
    </div>
  );
}

/** ข้อความจากหน้าก่อนหน้า (เช่น "สร้างกลุ่มแล้ว") — อ่านครั้งเดียวแล้วลบ */
export function FlashNotice() {
  const t = useTranslations();
  const [ref, setRef] = useState<MessageRef | null>(null);
  useEffect(() => {
    // sessionStorage อ่านได้หลัง mount เท่านั้น (SSR ไม่มี) และ takeFlash ลบค่าทิ้ง จึงเป็นการซิงก์กับระบบภายนอกครั้งเดียว
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRef(takeFlash());
  }, []);
  if (!ref) return null;
  return <Notice kind="ok">{t(ref.key, ref.values)}</Notice>;
}
