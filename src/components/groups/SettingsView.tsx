"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import type { GroupDetailDto, InviteDto } from "@/lib/data/serializers/groups";
import { AppearanceSection } from "./AppearanceSection";
import { DeleteSection, LeaveSection, TransferSection } from "./DangerSections";
import { canEditSettings, viewerRole } from "./helpers";
import { InviteSection } from "./InviteSection";
import { MemberList } from "./MemberList";
import { NameSection } from "./NameSection";
import { FlashNotice, Notice } from "./Notice";
import { WindowSection } from "./WindowSection";

type Note = { kind: "ok" | "error"; text: string } | null;

/**
 * ตั้งค่ากลุ่ม (UX: group-settings) — ปุ่ม/ส่วนที่ role ทำไม่ได้ถูกซ่อน และเซิร์ฟเวอร์ตรวจซ้ำทุกคำขอ (CLAUDE.md ข้อ 6)
 * admin: ทุกส่วน · moderator: ชื่อ/ช่วงเวลา/ลบสมาชิก + ชวน + ออก · member: อ่านอย่างเดียว + ชวน + ออก
 * state ของข้อความสถานะอยู่ที่นี่ จึงอยู่รอดหลัง router.refresh() (ส่วนที่หายไปตาม role ใหม่ เช่น หลังโอน admin)
 */
export function SettingsView({ group, invites, myId }: { group: GroupDetailDto; invites: InviteDto[]; myId: string }) {
  const t = useTranslations("groupSettings");
  const [note, setNote] = useState<Note>(null);
  const viewer = viewerRole(group.myRole);
  const editable = canEditSettings(viewer);
  const isAdmin = viewer === "admin";
  const candidates = group.members.filter((m) => m.userId !== myId && m.role !== "admin");
  const base = { groupId: group.id, notify: setNote };

  return (
    <>
      <FlashNotice />
      {note ? <Notice kind={note.kind}>{note.text}</Notice> : null}
      {!editable ? (
        <p className="note-box note-first">
          <Icon name="info" size="sm" />
          <span>{t("memberNote")}</span>
        </p>
      ) : null}

      <NameSection {...base} name={group.name} editable={editable} />
      <WindowSection
        {...base}
        editable={editable}
        saved={{ start: group.freeWindowStartMin, end: group.freeWindowEndMin, min: group.minFreeMinutes }}
      />

      <section className="set-sec" aria-labelledby="set-members-h">
        <h2 id="set-members-h">{t("members.title")}</h2>
        <MemberList groupId={group.id} members={group.members} viewer={viewer} myId={myId} />
      </section>

      {group.myAppearance ? (
        <AppearanceSection groupId={group.id} displayName={group.members.find((m) => m.userId === myId)?.displayName ?? ""} initial={group.myAppearance} />
      ) : null}

      <InviteSection {...base} groupName={group.name} invites={invites} seesOthers={editable} />

      {isAdmin && candidates.length > 0 ? <TransferSection {...base} candidates={candidates} /> : null}
      {group.myRole !== null ? <LeaveSection groupId={group.id} groupName={group.name} isAdmin={group.myRole === "admin"} /> : null}
      {isAdmin ? <DeleteSection groupId={group.id} groupName={group.name} /> : null}
    </>
  );
}
