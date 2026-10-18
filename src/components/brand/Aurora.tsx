import { AuroraPause } from "./AuroraPause";
import "./aurora.css";

/** hero = หน้าเข้าสู่ระบบ/สมัคร, หน้าว่าง, หน้าสำเร็จ, หน้าหลัก · soft = ปฏิทิน, ฟอร์ม, รายการ · หน้า admin ไม่ใช้ aurora */
export type AuroraIntensity = "hero" | "soft";

export interface AuroraProps {
  intensity?: AuroraIntensity;
}

/**
 * ชั้นพื้นหลัง aurora (UI_DIRECTION §3.5) — Server Component, CSS ล้วน
 * - วางครั้งเดียวต่อหน้า เป็นลูกแรกของ layout (position: fixed, z-index --z-aurora, pointer-events: none)
 * - เนื้อหาต้องอยู่เหนือด้วย position: relative + z-index: var(--z-content)
 * - 1 เลเยอร์ filter (.aurora-field) · 4 ก้อน · reduced-motion หยุดนิ่ง · แท็บไม่ active หยุด (<AuroraPause>)
 */
export function Aurora({ intensity = "soft" }: AuroraProps) {
  return (
    <>
      <div className="aurora" data-intensity={intensity} aria-hidden="true">
        <div className="aurora-field">
          <span className="aurora-blob b1" />
          <span className="aurora-blob b2" />
          <span className="aurora-blob b3" />
          <span className="aurora-blob b4" />
        </div>
      </div>
      <AuroraPause />
    </>
  );
}
