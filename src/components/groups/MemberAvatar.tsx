import { memberInitial, memberSlot } from "./helpers";

export interface MemberAvatarProps {
  displayName: string;
  /** 0–9 จาก API (MemberDto.colorIndex) */
  colorIndex: number;
  /** 0–9 จาก API (MemberDto.shapeIndex) — อิสระจากสี (R6C) */
  shapeIndex: number;
  size?: "sm" | "md" | "lg";
}

/**
 * อวาตาร์สมาชิก: สีพื้น (data-color) + รูปทรง (data-shape) + ตัวอักษรย่อ — ไม่พึ่งสีอย่างเดียว (WCAG 1.4.1 · members.css)
 * ตกแต่งล้วน (aria-hidden) ชื่อและบทบาทอ่านจากแถว
 */
export function MemberAvatar({ displayName, colorIndex, shapeIndex, size = "md" }: MemberAvatarProps) {
  return (
    <span className={size === "md" ? "member-avatar" : `member-avatar ${size}`} data-color={memberSlot(colorIndex)} data-shape={memberSlot(shapeIndex)} aria-hidden="true">
      <span className="member-initial">{memberInitial(displayName)}</span>
    </span>
  );
}
