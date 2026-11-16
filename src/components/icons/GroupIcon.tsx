import { createElement } from "react";
import { displayGroupIcon } from "@/lib/shared/group-icons";
import { GROUP_ICON_NODES } from "./group-icons";

export interface GroupIconProps {
  /** คีย์จากเซิร์ฟเวอร์ (null/ไม่รู้จัก → แมว) */
  icon: string | null | undefined;
  /** tile = ไอคอนบนพื้น accent-soft · glyph = ไอคอนเปล่าสี ink-muted (บรรทัดกลุ่มในการ์ด/แถวนัด) */
  variant?: "tile" | "glyph";
  /** ขนาด tile (sm 28 · md 44 · lg 56) — glyph ไม่ใช้ */
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * ไอคอนกลุ่ม (R15a §1.3) — ตกแต่งเสมอ (aria-hidden) เพราะชื่อกลุ่มอยู่ข้างๆ เป็นข้อความ
 * ใช้ Lucide 22 แบบ + badminton/soccer วาดเอง (group-icons.ts) · ค่าไม่รู้จัก/null → cat (ไม่ error)
 */
export function GroupIcon({ icon, variant = "tile", size = "md", className }: GroupIconProps) {
  const key = displayGroupIcon(icon);
  const svg = (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {GROUP_ICON_NODES[key].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
  if (variant === "glyph") {
    return (
      <span className={["gi-glyph", className ?? ""].filter(Boolean).join(" ")} aria-hidden="true" data-icon={key}>
        {svg}
      </span>
    );
  }
  return (
    <span className={["gi", className ?? ""].filter(Boolean).join(" ")} data-size={size} aria-hidden="true" data-icon={key}>
      {svg}
    </span>
  );
}
