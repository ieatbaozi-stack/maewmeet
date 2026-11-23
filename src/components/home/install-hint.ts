/**
 * R18 G1 — แบนเนอร์ "เพิ่มไปหน้าจอโฮม" บน iPhone/iPad Safari (docs/design/V1_UI_AUDIT.md §6)
 * ตรรกะตัดสินแสดง/ซ่อนเป็นฟังก์ชันล้ว (ทดสอบที่ tests/ui/install-hint.test.ts) · ธง "ปิดแล้ว" เก็บใน localStorage ของเครื่อง (ไม่ผูกบัญชี)
 * เขียน/อ่านไม่ได้ (โหมดส่วนตัว) → ปิดในหน่วยความจำของเซสชันนี้ ไม่ error
 */
export const INSTALL_HINT_KEY = "mm_install_hint_dismissed";

/** เบราว์เซอร์ทางเลือก/ในแอปที่ "เพิ่มไปหน้าจอโฮม" ไม่ได้ (ต้องเป็น Safari เท่านั้น) */
const NOT_SAFARI = /\b(CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|Line)\b/;

/** iPhone/iPad/iPod Safari (รวม iPadOS ที่ UA เป็น Macintosh + จอสัมผัส) — ไม่รวม Chrome/Firefox/Edge iOS และเบราว์เซอร์ในแอป */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const apple = /\b(iPhone|iPad|iPod)\b/.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1);
  return apple && /\bSafari\//.test(userAgent) && !NOT_SAFARI.test(userAgent);
}

export interface InstallHintEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** navigator.standalone (iOS) */
  navigatorStandalone: boolean | undefined;
  /** matchMedia('(display-mode: standalone)').matches */
  displayStandalone: boolean;
  /** localStorage[INSTALL_HINT_KEY] === "1" (หรือปิดในหน่วยความจำแล้ว) */
  dismissed: boolean;
  /** การ์ดแนะนำหน้าหลัก (home-intro) ปิดแล้ว — ยังเปิดอยู่ = รอก่อน กันสองการ์ดซ้อนกัน */
  introDismissed: boolean;
}

export function shouldShowInstallHint(e: InstallHintEnv): boolean {
  return isIosSafari(e.userAgent, e.maxTouchPoints) && e.navigatorStandalone !== true && !e.displayStandalone && !e.dismissed && e.introDismissed;
}

// ───────── สถานะฝั่งเบราว์เซอร์ ─────────
let dismissedInMemory = false;
const listeners = new Set<() => void>();
const emit = (): void => {
  for (const l of listeners) l();
};

export function readInstallDismissed(): boolean {
  if (dismissedInMemory) return true;
  try {
    return window.localStorage.getItem(INSTALL_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissInstallHint(): void {
  dismissedInMemory = true;
  try {
    window.localStorage.setItem(INSTALL_HINT_KEY, "1");
  } catch {
    /* เขียนไม่ได้: ซ่อนในเซสชันนี้พอ */
  }
  emit();
}

export function subscribeInstallHint(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** snapshot ฝั่ง client (boolean คงที่ให้ useSyncExternalStore เทียบค่า) — introDismissed ส่งเข้ามาจากผู้เรียก */
export function installHintSnapshot(introDismissed: boolean): boolean {
  if (typeof window === "undefined") return false;
  let displayStandalone = false;
  try {
    displayStandalone = window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    /* ไม่รองรับ matchMedia */
  }
  return shouldShowInstallHint({
    userAgent: window.navigator.userAgent,
    maxTouchPoints: window.navigator.maxTouchPoints ?? 0,
    navigatorStandalone: (window.navigator as Navigator & { standalone?: boolean }).standalone,
    displayStandalone,
    dismissed: readInstallDismissed(),
    introDismissed,
  });
}
