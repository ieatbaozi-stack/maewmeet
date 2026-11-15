// สัญญาณ "เริ่มนำทาง" จากโค้ด (router.push) ให้ NavProgress แสดงแถบ progress เหมือนตอนคลิกลิงก์ (R15a §1.4)
// App Router ไม่มี event ของ router → ผู้เรียก router.push เรียก signalNavStart(href) ก่อนสั่ง push · ฟังก์ชันล้วน (ไม่ import React)
export const NAV_START_EVENT = "mm:nav-start";

/** href ปลายทางเป็นหน้าอื่น (pathname ต่าง) ในโดเมนเดียวกันหรือไม่ — query/hash เปลี่ยนอย่างเดียวไม่ใช่การเปลี่ยนหน้า (ไม่มี skeleton) */
export function isPathChange(href: string, current: { origin: string; pathname: string }): boolean {
  let url: URL;
  try {
    url = new URL(href, current.origin);
  } catch {
    return false;
  }
  return url.origin === current.origin && url.pathname !== current.pathname;
}

export function signalNavStart(href: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ href: string }>(NAV_START_EVENT, { detail: { href } }));
}
