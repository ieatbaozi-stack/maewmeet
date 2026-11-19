"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { callApiRaw } from "@/components/account/api";
import { failureText } from "@/components/auth/errors";
import { ConfirmDialog } from "@/components/groups/ConfirmDialog";
import { restoreOutcome } from "./restore-model";

/** ผลที่หน้าที่เรียกต้องทำต่อ: รีเฟรชข้อมูล + (ถ้ามี) แจ้งผ่าน toast */
export type RestoreDone = { refresh: true; notice: "done" | "alreadyRestored" | "expired" | "purged" };

/**
 * ยืนยันกู้คืนกลุ่ม (R17 G3 · L1 tone primary) — POST /api/admin/groups/:gid/restore
 * เหตุที่ไม่สำเร็จแสดงใน dialog (form-error): expired/purged/alreadyRestored = เหตุสุดท้าย → ปิดปุ่มกู้ + ขอรีเฟรชแถว · noAdmin คงปุ่มไว้
 * สิทธิ์ตรวจที่เซิร์ฟเวอร์ (ไม่ใช่ SA ได้ 403) — ที่นี่แค่ส่งคำขอและแสดงผล
 */
export function RestoreGroupDialog({
  group,
  onClose,
  onDone,
}: {
  group: { id: string; name: string };
  onClose: () => void;
  onDone: (r: RestoreDone) => void;
}) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await callApiRaw<{ group?: { changed?: boolean } }>(`/api/admin/groups/${encodeURIComponent(group.id)}/restore`, { body: {} });
    setBusy(false);
    const out = restoreOutcome(res);
    if (out.kind === "restored") return onDone({ refresh: true, notice: "done" });
    if (out.kind === "already") {
      setError(t("adminGroup.restore.error.alreadyRestored"));
      setFinal(true);
      return onDone({ refresh: true, notice: "alreadyRestored" });
    }
    if (out.kind === "blocked") {
      setError(t(`adminGroup.restore.error.${out.reason}`));
      if (out.reason !== "noAdmin") {
        setFinal(true);
        onDone({ refresh: true, notice: out.reason });
      }
      return;
    }
    setError(failureText(t, out.failure));
  }

  return (
    <ConfirmDialog
      tone="primary"
      title={t("adminGroup.restore.confirm.title", { group: group.name })}
      body={t("adminGroup.restore.confirm.body")}
      confirmLabel={t("adminGroup.restore.confirm.confirm")}
      confirmDisabled={final}
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() => void confirm()}
    />
  );
}
