import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/app/_lib/session";
import { Aurora, Cat } from "@/components/brand";
import { FlashNotice } from "@/components/groups/Notice";
import { MemberList } from "@/components/groups/MemberList";
import { viewerRole } from "@/components/groups/helpers";
import { Icon } from "@/components/icons/Icon";
import { loadGroup } from "../_lib/load";

export async function generateMetadata({ params }: { params: Promise<{ gid: string }> }): Promise<Metadata> {
  const { gid } = await params;
  const group = await loadGroup(gid);
  return { title: group.name };
}

/** หน้ากลุ่ม (UX: group) — หัวกลุ่ม · ชวนเพื่อน · สมาชิกพร้อมบทบาท · ที่ว่างของปฏิทิน (R3–R4) */
export default async function GroupPage({ params }: { params: Promise<{ gid: string }> }) {
  const user = await requireUser();
  const { gid } = await params;
  const group = await loadGroup(gid);
  const t = await getTranslations();
  const solo = group.memberCount <= 1;
  const invitePath = `/groups/${group.id}/settings#invite`;
  const inviteButton = (
    <Link className="btn btn-primary" href={invitePath}>
      <Icon name="user-plus" />
      <span>{t("group.invite")}</span>
    </Link>
  );

  return (
    <>
      <Aurora intensity="soft" />
      <header className="topbar">
        <Link className="icon-btn" href="/groups" aria-label={t("group.back")}>
          <Icon name="chevron-left" />
        </Link>
        <span className="title" />
        <Link className="icon-btn" href={`/groups/${group.id}/settings`} aria-label={t("group.settings")}>
          <Icon name="settings" />
        </Link>
      </header>
      <main className="main group-main" id="main">
        <div className="group-head">
          <h1>{group.name}</h1>
          <p className="meta">
            <span>{t("groups.memberCount", { count: group.memberCount })}</span>
            <span aria-hidden="true">·</span>
            <span>{t("group.yourRole", { role: group.myRole ?? "admin" })}</span>
          </p>
        </div>

        <FlashNotice />

        {solo ? (
          <section className="empty panel solo-panel">
            <Cat pose="sit" size="md" />
            <h2 className="h-section">{t("group.solo.title")}</h2>
            <p className="muted">{t("group.solo.body")}</p>
            {inviteButton}
          </section>
        ) : (
          <div className="btn-row">{inviteButton}</div>
        )}

        <section aria-labelledby="mem-h" className="members-section">
          <h2 className="h-section" id="mem-h">
            {t("group.members.title")}
          </h2>
          <MemberList groupId={group.id} members={group.members} viewer={viewerRole(group.myRole)} myId={user.id} />
        </section>

        {!solo ? (
          <section className="panel soon" aria-labelledby="soon-h">
            <Cat pose="calendar" size="md" />
            <div>
              <h2 className="h-section" id="soon-h">
                {t("group.calendarSoon.title")}
              </h2>
              <p>{t("group.calendarSoon.body")}</p>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
