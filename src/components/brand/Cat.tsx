import { CAT_ART, type CatPose } from "./brand-svg.generated";
import { renderSvgNodes } from "./svg-render";
import "./brand.css";

export type { CatPose } from "./brand-svg.generated";
export { CAT_POSES } from "./brand-svg.generated";

/** sm = 48 (ขั้นต่ำของแมวเต็มตัว) · md = 96 · lg = 144 — ค่าจาก token --cat-sm/md/lg */
export type CatSize = "sm" | "md" | "lg";

export interface CatProps {
  /** ท่า: sit | wave | calendar | map | tea | pin | cheer | sleep | peek | lost (ดู public/brand/cats/manifest.json) */
  pose: CatPose;
  /** ค่าเริ่มต้น "lg" (หน้าว่างเต็มแท็บ / 404) */
  size?: CatSize;
  /** ข้อความแทนภาพ (แปลแล้ว) — ไม่ส่ง = ภาพตกแต่ง → aria-hidden */
  title?: string;
  className?: string;
}

/**
 * แมวแบรนด์แบบ inline SVG (รับ CSS var ทั้งสองธีม) — Server Component
 * สีเส้น = --cat-line, ขน = --cat-coat, ลงสี = --cat-fill / --cat-fill-2
 * ใช้เฉพาะจุดที่ UI_DIRECTION §3 "แมว" กำหนด (หน้าว่าง, 404/ผิดพลาด, หน้าสำเร็จ, หน้าเข้าสู่ระบบ)
 */
export function Cat({ pose, size = "lg", title, className }: CatProps) {
  const art = CAT_ART[pose];
  const a11y = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={art.viewBox}
      className={className ? `mm-cat ${className}` : "mm-cat"}
      data-size={size}
      data-pose={pose}
      focusable="false"
      {...art.rootAttrs}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {renderSvgNodes(art.nodes)}
    </svg>
  );
}
