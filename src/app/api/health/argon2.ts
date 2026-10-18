// ตรวจว่า runtime นี้ใช้ crypto.argon2 ได้จริง (ADR 0002 §1: เพิ่มใน Node v24.7.0) — R0_CONTRACT §3 `argon2: bool`
// เจ้าของ: OPS (#10) · ไฟล์แยกจาก route.ts เพราะ Next ตรวจ export ของ route.ts (ห้าม export อื่นนอกจาก method/config)
//
// ไม่ใช่แค่ `typeof crypto.argon2 === 'function'` แต่ "hash จริง 1 ครั้ง" ด้วยพารามิเตอร์ OWASP เดียวกับ ADR 0002 §1
// (m = 19456 KiB, t = 2, p = 1, tag 32 ไบต์) เพื่อพิสูจน์ว่าหน่วยความจำ/CPU ของ instance บน Vercel รับได้
// ทำครั้งเดียวต่อ instance แล้ว cache ผล (ใช้เวลา ~10–20 ms) · ข้อมูลที่ hash เป็นค่าคงที่ ไม่ใช่ PIN/ความลับ
import * as nodeCrypto from 'node:crypto';

type Argon2Fn = (
  algorithm: 'argon2id',
  parameters: { message: Buffer; nonce: Buffer; parallelism: number; tagLength: number; memory: number; passes: number },
  callback: (err: Error | null, derivedKey: Buffer) => void,
) => void;

export const ARGON2_PROBE_PARAMS = { parallelism: 1, tagLength: 32, memory: 19456, passes: 2 } as const;

let cached: Promise<boolean> | undefined;

/** ทดลอง argon2id จริงหนึ่งครั้ง — ไม่โยน (false ถ้าไม่มีฟังก์ชันหรือคำนวณไม่สำเร็จ) */
export function probeArgon2(impl: unknown = (nodeCrypto as Record<string, unknown>).argon2): Promise<boolean> {
  if (typeof impl !== 'function') return Promise.resolve(false);
  const argon2 = impl as Argon2Fn;
  return new Promise<boolean>((resolve) => {
    try {
      argon2(
        'argon2id',
        {
          message: Buffer.from('maewmeet/health/argon2-probe', 'utf8'),
          nonce: Buffer.alloc(16, 7),
          ...ARGON2_PROBE_PARAMS,
        },
        (err, key) => resolve(!err && Buffer.isBuffer(key) && key.length === ARGON2_PROBE_PARAMS.tagLength),
      );
    } catch {
      resolve(false);
    }
  });
}

/** ผลที่ cache ต่อ instance — ถ้าล้มจะลองใหม่ครั้งถัดไป (ไม่ cache ค่า false) */
export async function argon2Available(): Promise<boolean> {
  cached ??= probeArgon2();
  const ok = await cached;
  if (!ok) cached = undefined;
  return ok;
}

/** สำหรับเทสต์ */
export function resetArgon2Cache(): void {
  cached = undefined;
}
