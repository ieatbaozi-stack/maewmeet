// กติกา PIN + username — ADR 0002 §2 · PRD U1 (D2)
import { AppError } from '@/lib/shared/errors';

/** PIN ชั่วคราวหลัง reset ได้รับอนุมัติ — ค่าตายตัวของระบบ ไม่ใช่ความลับ (ADR 0002 §5) */
export const RESET_PIN = '123456';

export const PIN_RE = /^\d{6}$/;

const REPEATED = ['000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999'];
const ASCENDING = ['012345', '123456', '234567', '345678', '456789'];
const DESCENDING = ['987654', '876543', '765432', '654321', '543210'];

/** 20 PIN ต้องห้ามตอนตั้งเอง: เลขซ้ำ 10 + เรียงขึ้น 5 + เรียงลง 5 (`123456` อยู่ในกลุ่มเรียงขึ้น) */
export const FORBIDDEN_PINS: readonly string[] = Object.freeze([...REPEATED, ...ASCENDING, ...DESCENDING]);

const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_PINS);

export const isPinFormat = (pin: string): boolean => PIN_RE.test(pin);
export const isForbiddenPin = (pin: string): boolean => FORBIDDEN_SET.has(pin);

/** ตรวจ PIN ที่ผู้ใช้ตั้งเอง → โยน PIN_FORMAT / PIN_TOO_WEAK (ลำดับ: รูปแบบ ก่อน ความอ่อน) */
export function assertAcceptableNewPin(pin: string): void {
  if (!isPinFormat(pin)) throw new AppError('PIN_FORMAT');
  if (isForbiddenPin(pin)) throw new AppError('PIN_TOO_WEAK');
}

// ───────── username (D2: ไม่สนตัวพิมพ์) ─────────
export const USERNAME_MAX_INPUT = 64; // เพดานก่อน normalize (zod ของ route) — กัน key ยาวผิดปกติ
const USERNAME_RE = /^[a-z0-9._]{3,20}$/;

/** NFKC + ตัดช่องว่างหัวท้าย + lowercase → ค่าที่ใช้ค้น/unique/คีย์ throttle */
export function normalizeUsername(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

export const isValidUsername = (normalized: string): boolean => USERNAME_RE.test(normalized);

/** username สำหรับสมัคร: คืน {username (แสดงผล, NFKC), normalized} หรือโยน USERNAME_FORMAT */
export function parseNewUsername(raw: string): { username: string; usernameNormalized: string } {
  const username = raw.normalize('NFKC').trim();
  const usernameNormalized = username.toLowerCase();
  if (!isValidUsername(usernameNormalized)) throw new AppError('USERNAME_FORMAT');
  return { username, usernameNormalized };
}

export const DISPLAY_NAME_MAX = 40;
