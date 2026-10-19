// hash PIN: argon2id ผ่าน node:crypto (built-in, ไม่มี native addon) + pepper — ADR 0002 §1, §7
// - พารามิเตอร์ OWASP ขั้นต่ำ: m = 19456 KiB, t = 2, p = 1, salt 16 ไบต์, tag 32 ไบต์
// - เก็บเป็น PHC `$argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64>` · pepper ส่งเป็น `secret` (ไม่อยู่ใน PHC)
// - ไฟล์นี้ **ไม่อ่าน env** และไม่รู้จักที่มาของ pepper (ผู้เรียกส่ง Buffer มา) · ไม่มี log
import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';

export const ARGON2_MEMORY_KIB = 19456;
export const ARGON2_PASSES = 2;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_TAG_BYTES = 32;
export const ARGON2_SALT_BYTES = 16;

// เพดานตอน verify จาก PHC ที่อ่านจากฐาน — กัน hash ที่ถูกแก้ให้ใช้ทรัพยากรเกินจริง
const MAX_MEMORY_KIB = 65536;
const MAX_PASSES = 6;

export type Pepper = { readonly version: number; readonly secret: Buffer };

function derive(
  message: string,
  salt: Buffer,
  secret: Buffer,
  params: { m: number; t: number; p: number; tagLength: number },
): Promise<Buffer> {
  const parameters: Argon2Parameters = {
    message: Buffer.from(message, 'utf8'),
    nonce: salt,
    secret,
    parallelism: params.p,
    tagLength: params.tagLength,
    memory: params.m,
    passes: params.t,
  };
  return new Promise<Buffer>((resolve, reject) => {
    argon2('argon2id', parameters, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const b64 = (b: Buffer): string => b.toString('base64').replace(/=+$/, '');

export async function hashPin(pin: string, pepper: Pepper): Promise<string> {
  const salt = randomBytes(ARGON2_SALT_BYTES);
  const key = await derive(pin, salt, pepper.secret, {
    m: ARGON2_MEMORY_KIB,
    t: ARGON2_PASSES,
    p: ARGON2_PARALLELISM,
    tagLength: ARGON2_TAG_BYTES,
  });
  return `$argon2id$v=19$m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}$${b64(salt)}$${b64(key)}`;
}

const PHC_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

type ParsedPhc = { m: number; t: number; p: number; salt: Buffer; hash: Buffer };

export function parsePhc(phc: string): ParsedPhc | null {
  const m = PHC_RE.exec(phc);
  if (!m) return null;
  const mem = Number(m[1]);
  const t = Number(m[2]);
  const p = Number(m[3]);
  if (mem < 8 || mem > MAX_MEMORY_KIB || t < 1 || t > MAX_PASSES || p !== 1) return null;
  const salt = Buffer.from(m[4]!, 'base64');
  const hash = Buffer.from(m[5]!, 'base64');
  if (salt.length < 8 || hash.length < 16 || hash.length > 64) return null;
  return { m: mem, t, p, salt, hash };
}

/** ตรวจ PIN กับ PHC · PHC เสีย/อ่านไม่ได้ = false (ไม่โยน) · เทียบด้วย timingSafeEqual */
export async function verifyPin(pin: string, phc: string, secret: Buffer): Promise<boolean> {
  const parsed = parsePhc(phc);
  if (!parsed) return false;
  const key = await derive(pin, parsed.salt, secret, {
    m: parsed.m,
    t: parsed.t,
    p: parsed.p,
    tagLength: parsed.hash.length,
  });
  return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
}

// ───────── dummy hash (กัน timing: ผู้ใช้ไม่มีจริง/ไม่มี pin_hash ยังเสียเวลา verify เท่ากัน) ─────────
// ค่าคงที่ที่ไม่ใช่ความลับ — hash ครั้งเดียวตอนใช้ครั้งแรกของ instance (cold start) แล้ว cache
const DUMMY_SECRET = Buffer.alloc(32, 0x5a);
let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPin('000000-dummy-not-a-real-pin', { version: 0, secret: DUMMY_SECRET });
  return dummyHash;
}

/** verify หลอก ใช้เวลาเท่า verify จริง · คืน false เสมอ */
export async function verifyDummy(pin: string): Promise<false> {
  const phc = await getDummyHash();
  await verifyPin(pin, phc, DUMMY_SECRET);
  return false;
}

/** เพื่อให้ cold start (hash dummy ครั้งแรก) ไม่ไปตกอยู่ใน request แรก */
export function warmDummyHash(): Promise<string> {
  return getDummyHash();
}
