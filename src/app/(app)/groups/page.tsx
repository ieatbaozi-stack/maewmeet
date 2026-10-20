import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { GroupsView } from "@/components/groups/GroupsView";
import { TopBar } from "@/components/shell/TopBar";
import { loadGroupsTab } from "./_lib/load";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("groups") };
}

/** กลุ่ม (UX W9): รายการกลุ่ม · สร้างกลุ่ม · ใส่โค้ดเชิญ · คำเชิญตรงที่ค้าง */
export default async function GroupsPage() {
  await requireUser();
  const t = await getTranslations("nav");
  const { groups, invites } = await loadGroupsTab();
  return (
    <>
      <Aurora intensity="soft" />
      <TopBar title={t("groups")} />
      <main className="main stack-lg" id="main">
        <GroupsView groups={groups} invites={invites} />
      </main>
    </>
  );
}
