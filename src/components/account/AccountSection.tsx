"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import "@/components/groups/groups.css";
import { Icon } from "@/components/icons/Icon";
import { resetIntro } from "@/components/home/intro-flag";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import { RenameSheet } from "./RenameSheet";

type Open = null | "rename" | "delete";

/**
 * ส่วน "บัญชี" ของแท็บ ฉัน (R5 §2 ข้อ 4): เปลี่ยนชื่อที่แสดง · ความเป็นส่วนตัว · ลบบัญชี
 * super admin ลบตัวเองในแอปไม่ได้ (เซิร์ฟเวอร์ตอบ 403) — แสดงเหตุผลแทนปุ่ม
 */
export function AccountSection({ displayName, isSuperAdmin }: { displayName: string; isSuperAdmin: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState<Open>(null);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <section className="settings" aria-labelledby={`${id}-h`}>
      <h2 className="h-section" id={`${id}-h`}>
        {t("me.account")}
      </h2>
      {toast ? (
        <div className="alert alert-free toast" role="status">
          <Icon name="circle-check" />
          <div>{toast}</div>
        </div>
      ) : null}
      <button
        type="button"
        className="btn btn-secondary btn-block"
        data-testid="me-rename"
        onClick={() => {
          setToast(null);
          setOpen("rename");
        }}
      >
        <Icon name="pencil" />
        <span>{t("me.rename")}</span>
      </button>
      {/* R8: เปิดการ์ดแนะนำหน้าหลักอีกครั้ง — ล้างธงแล้วไปหน้าหลัก */}
      <Link className="menu-row" href="/" onClick={resetIntro} data-testid="me-howto">
        <span>
          <span>{t("me.howTo")}</span>
          <span className="field-hint">{t("me.howToHint")}</span>
        </span>
        <Icon name="chevron-right" />
      </Link>
      <Link className="menu-row" href="/privacy" data-testid="me-privacy">
        <span>{t("me.privacy")}</span>
        <Icon name="chevron-right" />
      </Link>
      {isSuperAdmin ? (
        <p className="field-hint" data-testid="me-delete-sa">
          {t("account.delete.superAdmin")}
        </p>
      ) : (
        <div className="setting">
          <button type="button" className="btn btn-danger-outline btn-block" data-testid="me-delete" onClick={() => setOpen("delete")}>
            <Icon name="trash-2" />
            <span>{t("me.deleteAccount")}</span>
          </button>
          <p className="field-hint">{t("me.deleteAccountHint")}</p>
        </div>
      )}

      {open === "rename" ? (
        <RenameSheet
          current={displayName}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            setToast(t("account.rename.done"));
            router.refresh();
          }}
        />
      ) : null}
      {open === "delete" ? <DeleteAccountSheet onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
