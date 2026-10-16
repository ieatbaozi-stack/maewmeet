import { createElement } from "react";
import { ICONS, type IconName } from "./lucide";

export type { IconName } from "./lucide";

export interface IconProps {
  name: IconName;
  /** sm = --icon-sm (16) · md = --icon (20) · lg = --icon-lg (24) */
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** ไอคอน Lucide แบบ inline SVG — เส้น var(--icon-stroke) (1.75) ผ่าน CSS · ตกแต่งเสมอ (aria-hidden) ป้ายอยู่ที่ปุ่ม/ลิงก์ */
export function Icon({ name, size = "md", className }: IconProps) {
  const cls = ["icon", size === "md" ? "" : size, className ?? ""].filter(Boolean).join(" ");
  return (
    <svg
      className={cls}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
