import { Icon, type IconName } from "@/components/icons/Icon";
import type { GroupRole } from "./helpers";

const ROLE_ICON: Record<GroupRole, IconName> = { admin: "crown", moderator: "shield", member: "user" };

/** ป้ายบทบาท = ไอคอน + ข้อความ ไม่พึ่งสี (UX §4 R2) — label แปลแล้วจากผู้เรียก (roles.<role>) */
export function RoleTag({ role, label }: { role: GroupRole; label: string }) {
  return (
    <span className={role === "admin" ? "tag tag-role is-admin" : "tag tag-role"}>
      <Icon name={ROLE_ICON[role]} size="sm" />
      <span>{label}</span>
    </span>
  );
}
