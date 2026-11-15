"use client";

import { useEffect, useState } from "react";
import { clock } from "@/lib/shared/clock";

/** skeleton ที่ขึ้นแล้วต้องค้างอย่างน้อยเท่านี้ (R15a §1.4) — กัน "ขึ้นแล้วหายทันที" ที่ดูเป็นกะพริบ */
export const SKELETON_MIN_MS = 250;
/** ค่าสำรองของ --loading-delay (tokens) — skeleton เริ่มเห็นหลังโหลดไปแล้วเท่านี้ */
export const SKELETON_DELAY_MS = 150;

/**
 * ล้วน: โหลดเริ่มที่ since จบที่ now — skeleton เริ่มเห็นที่ since+delay · ถ้าจบหลังจุดนั้น (เคยเห็นแล้ว) ให้ค้างจนถึง since+delay+min
 * คืน epoch ms ที่ต้องค้างถึง หรือ 0 = ไม่ต้องค้าง (โหลดเร็วกว่า delay = ไม่เคยเห็น skeleton จึงไม่มีอะไรให้กะพริบ)
 */
export function skeletonHoldUntil(since: number, now: number, delay: number = SKELETON_DELAY_MS, min: number = SKELETON_MIN_MS): number {
  const shownAt = since + delay;
  if (now <= shownAt) return 0;
  const until = shownAt + min;
  return now >= until ? 0 : until;
}

/**
 * true = ควรแสดง skeleton: กำลังโหลด หรือเพิ่งโหลดเสร็จแต่ skeleton ที่เคยเห็นยังไม่ครบ 250 ms
 * เปลี่ยนสถานะระหว่าง render (รูปแบบ "ปรับ state ตาม prop" ของ React) จึงไม่เห็นเนื้อหาแวบเดียวก่อนกลับเป็น skeleton
 */
export function useMinSkeleton(loading: boolean, min: number = SKELETON_MIN_MS): boolean {
  const [s, setS] = useState(() => ({ loading, since: loading ? clock.now() : 0, until: 0 }));
  if (s.loading !== loading) {
    setS(loading ? { loading: true, since: clock.now(), until: 0 } : { loading: false, since: s.since, until: skeletonHoldUntil(s.since, clock.now(), SKELETON_DELAY_MS, min) });
  }
  const until = s.until;
  useEffect(() => {
    if (until === 0) return;
    const id = setTimeout(() => setS((cur) => (cur.until === until ? { ...cur, until: 0 } : cur)), Math.max(0, until - clock.now()));
    return () => clearTimeout(id);
  }, [until]);
  return loading || until !== 0;
}
