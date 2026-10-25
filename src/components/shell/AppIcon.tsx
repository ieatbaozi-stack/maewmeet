import { createElement } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import type { IconNode } from "@/components/icons/lucide";

/**
 * ไอคอนเพิ่มของ R4B (กระดิ่ง/หน้าหลัก/แจ้งเตือน) ที่ยังไม่อยู่ใน src/components/icons/lucide.ts (ของ Front-end B)
 * path คัดลอกจาก Lucide ชุดเดียวกับตัวอย่างของ UX (docs/design/samples/{home,notifications}.html) — ห้ามผสมชุด
 * Lead: ตอน integrate ย้ายเข้า lucide.ts แล้วลบไฟล์นี้ได้ (ชื่อเดียวกัน)
 */
const EXTRA = {
  bell: [
    ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0" }],
    ["path", { d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" }],
  ],
  "external-link": [
    ["path", { d: "M15 3h6v6" }],
    ["path", { d: "M10 14 21 3" }],
    ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
  ],
  "circle-help": [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }],
    ["path", { d: "M12 17h.01" }],
  ],
  "circle-x": [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "m15 9-6 6" }],
    ["path", { d: "m9 9 6 6" }],
  ],
  "calendar-plus": [
    ["path", { d: "M16 18h6" }],
    ["path", { d: "M16 2v3" }],
    ["path", { d: "M19 15v6" }],
    ["path", { d: "M21 11.5V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h8.3" }],
    ["path", { d: "M3 9h18" }],
    ["path", { d: "M8 2v3" }],
  ],
} as const satisfies Record<string, readonly IconNode[]>;

export type ExtraIconName = keyof typeof EXTRA;
export type AppIconName = IconName | ExtraIconName;

const isExtra = (n: AppIconName): n is ExtraIconName => Object.prototype.hasOwnProperty.call(EXTRA, n);

export function AppIcon({ name, size = "md", className }: { name: AppIconName; size?: "sm" | "md" | "lg"; className?: string }) {
  if (!isExtra(name)) return <Icon name={name} size={size} {...(className ? { className } : {})} />;
  const cls = ["icon", size === "md" ? "" : size, className ?? ""].filter(Boolean).join(" ");
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {EXTRA[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
