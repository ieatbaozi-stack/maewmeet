import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { SettingsView } from "@/components/groups/SettingsView";
import { Icon } from "@/components/icons/Icon";
import { loadGroupSettings } from "../../_lib/load";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("groupSettings");
  return { title: t("title") };
}

/** ตั้งค่ากลุ่ม — แก้ชื่อ/ช่วงเวลา · สมาชิก · ชวนเพื่อน · โอน admin · ออก/ลบกลุ่ม (ส่วนที่ role ใช้ไม่ได้ถูกซ่อน) */
export default async function GroupSettingsPage({ params }: { params: Promise<{ gid: string }> }) {
  const user = await requireUser();
  const { gid } = await params;
  const { group, invites } = await loadGroupSettings(gid);
  const t = await getTranslations();
  return (
    <>
      <Aurora intensity="soft" />
      <header className="topbar">
        <Link className="icon-btn" href={`/groups/${group.id}`} aria-label={t("groupSettings.back")}>
          <Icon name="chevron-left" />
        </Link>
        <h1 className="title">{t("groupSettings.title")}</h1>
      </header>
      <main className="main settings-main" id="main">
        <p className="muted small settings-sub">
          {group.name}
          {group.myRole !== null ? ` · ${t("group.yourRole", { role: group.myRole })}` : null /* super admin ที่ไม่ใช่สมาชิก: ไม่แสดงป้ายบทบาท */}
        </p>
        <SettingsView group={group} invites={invites} myId={user.id} />
      </main>
    </>
  );
}
