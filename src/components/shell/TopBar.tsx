import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand";

/** หัวหน้า: หน้าหลักแสดงหัวแมว + ชื่อแอป · แท็บอื่นแสดงชื่อหน้า (h1) */
export async function TopBar({ title }: { title?: string }) {
  if (title) {
    return (
      <header className="topbar">
        <h1 className="title">{title}</h1>
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
    </header>
  );
}
