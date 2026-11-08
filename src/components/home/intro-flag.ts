/**
 * R8 — ธง "เข้าใจแล้ว" ของการ์ดแนะนำหน้าหลัก เก็บใน localStorage ของเครื่อง (ไม่ผูกบัญชี · ไม่มีข้อมูลส่วนตัว)
 * อ่าน/เขียนไม่ได้ (โหมดส่วนตัว/ถูกบล็อก) → ถือว่ายังไม่เคยปิด = แสดงการ์ด
 */
export const INTRO_KEY = "mm_intro_seen";

export type IntroSnapshot = "pending" | "show" | "hidden";

/** ปิดในหน่วยความจำด้วย เผื่อเขียน localStorage ไม่ได้ — การ์ดต้องหายหลังกดอยู่ดี */
let dismissedInMemory = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function readDismissed(): boolean {
  if (dismissedInMemory) return true;
  try {
    return window.localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissIntro(): void {
  dismissedInMemory = true;
  try {
    window.localStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* เก็บไม่ได้ก็ไม่เป็นไร: รอบหน้าการ์ดแสดงอีก */
  }
  emit();
}

/** เปิดการ์ดใหม่ (จากแท็บ ฉัน) */
export function resetIntro(): void {
  dismissedInMemory = false;
  try {
    window.localStorage.removeItem(INTRO_KEY);
  } catch {
    /* ไม่มีอะไรให้ล้าง */
  }
  emit();
}

export function subscribeIntro(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const getIntroSnapshot = (): IntroSnapshot => (readDismissed() ? "hidden" : "show");
/** เซิร์ฟเวอร์/hydration: ยังไม่รู้ → ไม่เรนเดอร์ แล้วค่อยตัดสินหลัง mount (ไม่เกิด mismatch) */
export const getIntroServerSnapshot = (): IntroSnapshot => "pending";
