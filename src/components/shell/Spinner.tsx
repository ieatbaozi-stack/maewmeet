/**
 * วงหมุนเล็ก (R6E E12) — ตกแต่งล้วน (aria-hidden) · ความหมายอยู่ที่ข้อความข้างๆ / role=status ของโซน
 * ขนาด/สีมาจาก token (--spinner-size, --spinner-arc, --spinner-track) · reduced-motion = ครึ่งวงนิ่ง (CSS)
 */
export function Spinner({ size = "sm", className }: { size?: "sm" | "lg"; className?: string }) {
  return <span className={["spinner", size === "lg" ? "spinner-lg" : "", className ?? ""].filter(Boolean).join(" ")} aria-hidden="true" />;
}
