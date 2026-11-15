/**
 * R15a §1.4 / R15_FEEDBACK §4.2 — "เคยเปิดดูวันว่างตรงกันของกลุ่มนี้แล้ว" (ขั้น 3 ของแถบขั้นตอน) เก็บใน localStorage ของเครื่องล้วน
 * คีย์ `mm:free-seen:v1:<userId>:<groupId>` = "1" · ไม่ส่งเซิร์ฟเวอร์ (คำใบ้ onboarding ไม่ใช่ข้อมูลธุรกิจ/PDPA)
 * อ่าน/เขียนไม่ได้ (โหมดส่วนตัว/ถูกบล็อก) → ถือว่ายังไม่เห็น (อ่าน) · เก็บในหน่วยความจำของแท็บแทน (เขียน) ทุกครั้งครอบ try/catch
 */
const PREFIX = "mm:free-seen:v1:";

export const freeSeenKey = (userId: string, groupId: string): string => `${PREFIX}${userId}:${groupId}`;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const memory = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readFreeSeen(userId: string, groupId: string, storage: StorageLike | null = browserStorage()): boolean {
  const key = freeSeenKey(userId, groupId);
  if (memory.has(key)) return true;
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markFreeSeen(userId: string, groupId: string, storage: StorageLike | null = browserStorage()): void {
  const key = freeSeenKey(userId, groupId);
  const already = readFreeSeen(userId, groupId, storage);
  memory.add(key);
  try {
    storage?.setItem(key, "1");
  } catch {
    /* เก็บไม่ได้ก็ไม่เป็นไร: เครื่องนี้ขั้น 3 อาจกลับมาเป็น "ถัดไป" อีกครั้งหลังรีเฟรช */
  }
  if (!already) emit();
}

/** สมัครรับการเปลี่ยนแปลง: เขียนในแท็บนี้ + `storage` event จากแท็บอื่น */
export function subscribeFreeSeen(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) cb();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** ล้างหน่วยความจำ (เทสต์) */
export function resetFreeSeenMemory(): void {
  memory.clear();
}
