// ประกาศความเป็นส่วนตัวครั้งแรกของฟอร์มลง busy (UX X31): "เห็นแล้ว" จำต่อผู้ใช้ต่ออุปกรณ์ใน localStorage — เป็นแค่ความสะดวก
// ทุกการอ่าน/เขียนครอบ try/catch (private window / บล็อกข้อมูลไซต์) · อ่าน/เขียนไม่ได้ = โชว์ซ้ำได้ ไม่เป็นไร (ในหน้าเดียวกันจำไว้ในหน่วยความจำ)
const memory = new Set<string>();
const listeners = new Set<() => void>();

export const noticeKey = (userId: string): string => `mm_busy_notice_seen:${userId}`;

export function hasSeenNotice(userId: string): boolean {
  if (memory.has(userId)) return true;
  try {
    return window.localStorage.getItem(noticeKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function markNoticeSeen(userId: string): void {
  memory.add(userId);
  try {
    window.localStorage.setItem(noticeKey(userId), "1");
  } catch {
    /* ไม่มี storage — จำแค่ในหน่วยความจำ */
  }
  for (const l of listeners) l();
}

export function subscribeNotice(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** ล้างหน่วยความจำ (เทสต์) */
export function resetNoticeMemory(): void {
  memory.clear();
}
