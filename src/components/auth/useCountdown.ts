"use client";

import { useEffect, useState } from "react";

/**
 * วินาทีที่เหลือถึง `untilMs` (epoch ms ของเบราว์เซอร์) · เดินทุก 1 วินาที · เป็น 0 เมื่อถึงเวลา/ไม่มีเป้าหมาย
 * ใช้แสดงนับถอยหลังล็อกอิน — เวลาที่ถูกต้องจริงอยู่ที่เซิร์ฟเวอร์เสมอ (ลองใหม่แล้วยังล็อกอยู่ก็ได้ข้อความใหม่)
 */
export function useCountdown(untilMs: number | null): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (untilMs === null) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [untilMs]);
  if (untilMs === null) return 0;
  return Math.max(0, Math.ceil((untilMs - now) / 1000));
}
