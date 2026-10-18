// pepper: ตรวจ fingerprint + fail closed (AUTH_MAINTENANCE) — ADR 0002 §7.1–§7.3
//
// กติกาเหล็ก (R1_CONTRACT §2, §6 R1-7):
//  - ไฟล์นี้ **ไม่สร้าง/สุ่ม/เดา pepper** ไม่มีค่าดีฟอลต์ ไม่ fallback เป็น "ไม่มี pepper" (เทสต์ข้อ 16 ค้นไฟล์นี้)
//  - ตรวจก่อนการนับ throttle ใด ๆ — pepper ใช้ไม่ได้ → AUTH_MAINTENANCE (503) โดยไม่มีใครถูกนับว่า PIN ผิด
//  - ไม่ log/ส่งออกค่า pepper หรือ fingerprint เต็ม (log มีแค่ชื่อตัวแปร/เวอร์ชัน · หน้า admin ใช้ fingerprintPrefix 8 ตัว)
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DbOrTx } from '@/db/client';
import {
  getPepperFingerprint,
  insertPepperFingerprintIfAbsent,
  listPepperFingerprints,
} from '@/lib/data/repos/pepper-fingerprint';
import { countUsersWithPinByPepperVersion } from '@/lib/data/repos/user';
import { AppError } from '@/lib/shared/errors';
import { readPepperEnv, type EnvSource } from '@/lib/shared/env';
import type { Pepper } from './pin';

export const FINGERPRINT_MESSAGE = 'maewmeet/pepper-fingerprint/v1';
export const FINGERPRINT_PREFIX_LENGTH = 8;

/** fingerprint = hex(HMAC-SHA256(key = pepper, msg = "maewmeet/pepper-fingerprint/v1")) — ทางเดียว */
export function pepperFingerprint(pepper: Buffer): string {
  return createHmac('sha256', pepper).update(FINGERPRINT_MESSAGE, 'utf8').digest('hex');
}

/** 8 ตัวแรก — ส่วนเดียวที่แสดงในหน้า super admin / สคริปต์ซ้อมกู้คืนได้ */
export const fingerprintPrefix = (fingerprint: string): string => fingerprint.slice(0, FINGERPRINT_PREFIX_LENGTH);

export type PepperContext = {
  readonly currentVersion: number;
  readonly versions: ReadonlyMap<number, Buffer>;
};

export type PepperProblem = 'ENV_INVALID' | 'FINGERPRINT_MISMATCH' | 'FINGERPRINT_ROW_MISSING';

export type PepperResult =
  | { readonly ok: true; readonly ctx: PepperContext }
  | { readonly ok: false; readonly problem: PepperProblem; readonly detail: readonly string[] };

const equalHex = (a: string, b: string): boolean => {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

// cache ผลที่ "ผ่าน" ต่อ (db, ชุด fingerprint จาก env) — เปลี่ยน env หรือ DB = ตรวจใหม่ · ผลที่ไม่ผ่านไม่ cache (แก้แล้วกลับมาใช้ได้ทันที)
const passed = new WeakMap<object, string>();
const loggedProblems = new Set<string>();

export function resetPepperCache(): void {
  loggedProblems.clear();
  // WeakMap ล้างไม่ได้ทั้งก้อน — เทสต์สร้าง db ใหม่ต่อเทสต์อยู่แล้ว
}

function logProblem(problem: PepperProblem, detail: readonly string[]): void {
  const line = `[auth] PEPPER_CHECK_FAILED ${problem}${detail.length ? ` ${detail.join(',')}` : ''}`;
  if (loggedProblems.has(line)) return;
  loggedProblems.add(line);
  console.error(line); // ชื่อตัวแปร/เวอร์ชันเท่านั้น ไม่มีค่า
}

/**
 * ตรวจ pepper ทั้งชุด (ADR 0002 §7.1–§7.2) — ไม่โยนเรื่อง pepper (คืน ok:false) · DB ล่มจะโยนตามปกติ
 * 1) env ครบ/ถูกรูป 2) ทุกเวอร์ชันใน env: เทียบ fingerprint ในฐาน (ตารางใน ADR §7.2)
 */
export async function resolvePepper(db: DbOrTx, now: number, source: EnvSource = process.env): Promise<PepperResult> {
  const env = readPepperEnv(source);
  if (!env.ok) {
    logProblem('ENV_INVALID', env.problems);
    return { ok: false, problem: 'ENV_INVALID', detail: env.problems };
  }

  const computed = [...env.versions.entries()]
    .sort(([a], [b]) => a - b)
    .map(([version, secret]) => ({ version, fingerprint: pepperFingerprint(secret) }));
  const cacheKey = `${env.currentVersion}|${computed.map((c) => `${c.version}:${c.fingerprint}`).join(',')}`;
  const ctx: PepperContext = { currentVersion: env.currentVersion, versions: env.versions };
  if (passed.get(db) === cacheKey) return { ok: true, ctx };

  const usersByVersion = await countUsersWithPinByPepperVersion(db);
  for (const { version, fingerprint } of computed) {
    let row = await getPepperFingerprint(db, version);
    if (!row) {
      if ((usersByVersion[version] ?? 0) > 0) {
        // ไม่มีแถว แต่มีผู้ใช้ที่ hash ด้วยเวอร์ชันนี้ → แถวหายผิดปกติ ต้องให้คนตรวจ
        logProblem('FINGERPRINT_ROW_MISSING', [`V${version}`]);
        return { ok: false, problem: 'FINGERPRINT_ROW_MISSING', detail: [`V${version}`] };
      }
      if (version !== env.currentVersion) continue; // เวอร์ชันเก่าที่ไม่มีใครใช้ — ไม่ตั้งให้
      await insertPepperFingerprintIfAbsent(db, version, fingerprint, now); // ตั้งเวอร์ชันครั้งแรก
      row = await getPepperFingerprint(db, version); // แข่งกับ instance อื่น → เทียบกับแถวที่ชนะ
      if (!row) continue;
    }
    if (!equalHex(row.fingerprint, fingerprint)) {
      logProblem('FINGERPRINT_MISMATCH', [`V${version}`]);
      return { ok: false, problem: 'FINGERPRINT_MISMATCH', detail: [`V${version}`] };
    }
  }
  passed.set(db, cacheKey);
  return { ok: true, ctx };
}

/** ใช้ต้นทุกบริการที่ต้องใช้ pepper (signup / login / เปลี่ยน PIN) — ไม่ผ่าน → 503 AUTH_MAINTENANCE */
export async function requirePepper(db: DbOrTx, now: number, source: EnvSource = process.env): Promise<PepperContext> {
  const r = await resolvePepper(db, now, source);
  if (!r.ok) throw new AppError('AUTH_MAINTENANCE');
  return r.ctx;
}

export const currentPepper = (ctx: PepperContext): Pepper => ({
  version: ctx.currentVersion,
  secret: ctx.versions.get(ctx.currentVersion)!,
});

/** pepper ของเวอร์ชันนั้น · ไม่มีใน env → null (ผู้ใช้กลุ่มนั้นได้ AUTH_MAINTENANCE — §7.2 แถวสุดท้าย) */
export function pepperOfVersion(ctx: PepperContext, version: number): Pepper | null {
  const secret = ctx.versions.get(version);
  return secret ? { version, secret } : null;
}

export type PepperHealth = {
  readonly ok: boolean;
  readonly currentVersion: number | null;
  readonly usersByVersion: Readonly<Record<number, number>>;
};

/**
 * ข้อมูลให้ GET /api/health (OPS): `pepper: {ok, currentVersion, usersByVersion}` — ไม่โยน ไม่มีค่า/fingerprint
 * ok = env + fingerprint ผ่าน และทุกเวอร์ชันที่ยังมีผู้ใช้ (ที่มี pin_hash) มี pepper ใน env
 */
export async function readPepperHealth(db: DbOrTx, now: number, source: EnvSource = process.env): Promise<PepperHealth> {
  const rawCurrent = Number(source.PIN_PEPPER_CURRENT_VERSION);
  const currentVersion = Number.isInteger(rawCurrent) && rawCurrent >= 1 ? rawCurrent : null;
  try {
    const r = await resolvePepper(db, now, source);
    const usersByVersion = await countUsersWithPinByPepperVersion(db);
    const missing = Object.entries(usersByVersion).some(
      ([v, n]) => n > 0 && !(r.ok && r.ctx.versions.has(Number(v))),
    );
    return { ok: r.ok && !missing, currentVersion, usersByVersion };
  } catch {
    return { ok: false, currentVersion, usersByVersion: {} };
  }
}

/** สำหรับหน้า super admin: เวอร์ชัน + fingerprint 8 ตัวแรกเท่านั้น (ADR 0002 §7.2, เทสต์ข้อ 17) */
export async function listPepperFingerprintPrefixes(
  db: DbOrTx,
): Promise<{ version: number; prefix: string }[]> {
  const rows = await listPepperFingerprints(db);
  return rows.map((r) => ({ version: r.version, prefix: fingerprintPrefix(r.fingerprint) }));
}
