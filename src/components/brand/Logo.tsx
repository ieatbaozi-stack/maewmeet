import { LOGO_ART, type LogoVariant } from "./brand-svg.generated";
import { renderSvgNodes } from "./svg-render";
import "./brand.css";

export type { LogoVariant } from "./brand-svg.generated";

export interface LogoProps {
  /** "mark" = หัวแมว (หัวหน้า, ขนาด --logo-mark) · "th" / "en" = หัวแมว + ชื่อแอป (หน้าเข้าสู่ระบบ, สูง --logo-h) */
  variant: LogoVariant;
  /** ชื่อแอปที่แปลแล้ว (t('brand.appName')) — ไม่ส่ง = ตกแต่ง → aria-hidden (ใช้เมื่อมีชื่อแอปเป็นตัวอักษรข้างๆ อยู่แล้ว) */
  title?: string;
  className?: string;
}

/** โลโก้แมวเจอกัน / maewmeet แบบ inline SVG — Server Component · สี = --cat-line (= --ink) */
export function Logo({ variant, title, className }: LogoProps) {
  const art = LOGO_ART[variant];
  const a11y = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={art.viewBox}
      className={className ? `mm-logo ${className}` : "mm-logo"}
      data-variant={variant}
      focusable="false"
      {...art.rootAttrs}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {renderSvgNodes(art.nodes)}
    </svg>
  );
}
