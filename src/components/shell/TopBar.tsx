import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand";
import { Bell } from "./Bell";

/** หัวหน้าแท็บ: หน้าหลักแสดงหัวแมว + ชื่อแอป · แท็บอื่นแสดงชื่อหน้า (h1) · กระดิ่งแจ้งเตือนอยู่ขวาสุดทุกแท็บ (R4B X64) */
export async function TopBar({ title }: { title?: string }) {
  if (title) {
    return (
      <header className="topbar">
        <h1 className="title">{title}</h1>
        <Bell />
      </header>
    );
  }
  const t = await getTranslations("brand");
  return (
    <header className="topbar">
      <div className="brand">
        <Logo variant="mark" />
        <span className="brand-name">{t("appName")}</span>
      </div>
      <Bell />
    </header>
  );
}
