// นาฬิกากลางของแอป — ARCHITECTURE §2 "เวลา 'ตอนนี้' มาจาก clock.now() ที่ inject ได้"
// คืน epoch ms UTC (number) เท่านั้น · การแปลงเป็นวัน/เวลาท้องถิ่นทำใน src/lib/calendar/** (ADR 0004)
// ไฟล์นี้เป็นที่เดียวนอก calendar ที่อ่านเวลาเครื่อง (ผ่าน Date.now — ไม่ใช่ new Date)

export interface Clock {
  /** epoch milliseconds UTC */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

let current: Clock = systemClock;

/** นาฬิกาที่ทั้งแอปใช้ — เรียก clock.now() ทุกครั้ง (อย่าเก็บค่าไว้ข้าม request) */
export const clock: Clock = {
  now: () => current.now(),
};

/** แทนนาฬิกา (เทสต์ / สคริปต์) — คืนฟังก์ชันคืนค่าเดิม */
export function setClock(next: Clock): () => void {
  const prev = current;
  current = next;
  return () => {
    current = prev;
  };
}

export function resetClock(): void {
  current = systemClock;
}

/** นาฬิกาหยุดนิ่งที่เลื่อนได้ด้วยมือ — สำหรับเทสต์ */
export function fixedClock(epochMs: number): Clock & { set(ms: number): void; advance(ms: number): void } {
  let t = epochMs;
  return {
    now: () => t,
    set: (ms: number) => {
      t = ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
