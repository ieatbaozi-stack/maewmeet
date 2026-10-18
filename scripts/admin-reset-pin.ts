/**
 * scripts/admin-reset-pin.ts — ทางกู้ฉุกเฉิน (break-glass) ของ super admin · เจ้าของ: OPS #10 · ADR 0002 §7.4, §6
 *
 * ใช้เมื่อ **pepper หายจริงทุกสำเนา** จน super admin ล็อกอินและอนุมัติ reset ให้ใครไม่ได้ (docs/OPERATIONS.md G7)
 * สิ่งที่ทำ (ใน transaction เดียว) ให้บัญชี super admin ที่ระบุ:
 *   1) ยกเลิกคำขอ reset ที่ค้างอยู่ (pending/approved) ของบัญชีนั้น
 *   2) เปิดคำขอ reset สถานะ approved หมดอายุใน 24 ชม. ผูกกับ "device token" ที่สคริปต์สร้างและพิมพ์ให้ (ADR 0002 §6)
 *   3) user.pin_hash = NULL และ must_change_pin = 1 → login ด้วย PIN ชั่วคราวของ flow reset บนเครื่องที่มี token → ถูกบังคับตั้ง PIN ใหม่
 *   4) audit_log 1 แถว (actor = ระบบ, meta ไม่มีความลับ)
 * ไม่ทำ: ไม่สร้างหรือเปลี่ยน is_admin (ตั้งด้วย SQL เท่านั้น) · ไม่แตะ session เดิม · ไม่แตะผู้ใช้อื่น · ไม่สร้าง pepper
 *
 * วิธีใช้ (PowerShell — ค่าเชื่อมฐานอยู่ใน env ของ process เท่านั้น ไม่รับเป็น argument):
 *   $env:TURSO_DATABASE_URL = "libsql://maewmeet-prod-xxxx.turso.io"
 *   $env:TURSO_AUTH_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'TURSO_AUTH_TOKEN')).Password
 *   npx tsx scripts/admin-reset-pin.ts --username <ชื่อ> --confirm-username <ชื่อเดิมซ้ำ> --confirm-pepper-lost
 *
 * ปฏิเสธ (ไม่แตะฐาน) ถ้า: ขาดแฟลกยืนยัน · confirm-username ไม่ตรง · ไม่มีบัญชี/ไม่ใช่ super admin/ไม่ active ·
 *   env ในเครื่องนี้มี pepper ที่ยังตรงกับ fingerprint ในฐาน (= pepper ยังไม่หายจริง ให้แก้ที่ Vercel แทน)
 * พิมพ์เฉพาะ: ชื่อบัญชี, device token (ใส่เป็น cookie บนเครื่องที่จะ login), เวลาหมดอายุ · ไม่พิมพ์ PIN/pepper/token ของ Turso
 *
 * exit code: 0 สำเร็จ · 1 ผิดพลาดตอนทำงาน · 2 ใช้ผิดวิธี/ขาดการยืนยัน · 3 ปฏิเสธตามเงื่อนไขความปลอดภัย
 */
import { pathToFileURL } from 'node:url';
import { createDb, type Db } from '../src/db/client';
import { insertAuditLog } from '../src/lib/data/repos/audit-log';
import { listPepperFingerprints } from '../src/lib/data/repos/pepper-fingerprint';
import { PIN_RESET_APPROVED_TTL_MS, PIN_RESET_PENDING_TTL_MS } from '../src/lib/data/repos/pin-reset-request';
import { clearUserPinHash, findUserByUsernameNormalized, setMustChangePin } from '../src/lib/data/repos/user';
import { pinResetRequest } from '../src/db/schema';
import { RESET_COOKIE_DEV, RESET_COOKIE_PROD } from '../src/lib/auth/session';
import { pepperFingerprint } from '../src/lib/auth/pepper';
import { normalizeUsername } from '../src/lib/auth/pin-rules';
import { newDeviceToken, sha256Hex } from '../src/lib/auth/tokens';
import { readPepperEnv, type EnvSource } from '../src/lib/shared/env';
import { newId } from '../src/lib/shared/id';
import { and, eq, inArray } from 'drizzle-orm';

export const AUDIT_ACTION = 'script.adminResetPin';
export const REQUESTER_LABEL = 'scripts/admin-reset-pin';

export type Args = { username?: string; confirmUsername?: string; confirmPepperLost: boolean; unknown: string[] };

/** `--name value` หรือ `--name=value` · ไม่รู้จัก/ซ้ำ → อยู่ใน unknown (ปฏิเสธทั้งหมด) */
export function parseArgs(argv: readonly string[]): Args {
  const out: Args = { confirmPepperLost: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    const eq = raw.indexOf('=');
    const name = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    const value = (): string | undefined => inline ?? (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') ? argv[++i] : undefined);
    if (name === '--username' && out.username === undefined) out.username = value();
    else if (name === '--confirm-username' && out.confirmUsername === undefined) out.confirmUsername = value();
    else if (name === '--confirm-pepper-lost' && inline === undefined && !out.confirmPepperLost) out.confirmPepperLost = true;
    else out.unknown.push(name); // ไม่ echo ค่า
  }
  return out;
}

export type Outcome =
  | { ok: true; username: string; deviceToken: string; cookieName: string; expiresAt: number; requestId: string }
  | { ok: false; code: 2 | 3; message: string };

/** ตรวจแฟลกยืนยัน — ก่อนต่อฐานด้วยซ้ำ */
export function checkConfirmation(args: Args): string | null {
  if (args.unknown.length) return `ไม่รู้จัก/ซ้ำ argument: ${args.unknown.join(' ')}`;
  if (!args.username) return 'ต้องระบุ --username <ชื่อบัญชี super admin>';
  if (!args.confirmPepperLost) {
    return 'ต้องใส่ --confirm-pepper-lost เพื่อยืนยันว่า pepper หายจริงทุกสำเนา (ตัวจัดการรหัสผ่าน + สำเนาออฟไลน์) และตรวจแล้ว';
  }
  if (!args.confirmUsername || normalizeUsername(args.confirmUsername) !== normalizeUsername(args.username)) {
    return 'ต้องใส่ --confirm-username <ชื่อบัญชีเดิมซ้ำ> ให้ตรงกับ --username';
  }
  return null;
}

/** pepper ในเครื่องนี้ยังใช้ได้และตรงกับ fingerprint ในฐานหรือไม่ — ถ้าใช่ แปลว่า pepper ไม่ได้หายจริง */
async function localPepperStillMatches(db: Db, source: EnvSource): Promise<boolean> {
  const env = readPepperEnv(source);
  if (!env.ok) return false;
  const rows = await listPepperFingerprints(db);
  return rows.some((r) => {
    const secret = env.versions.get(r.version);
    return secret !== undefined && pepperFingerprint(secret) === r.fingerprint;
  });
}

/** ทำงานจริง (เทสต์เรียกตรงกับ DB ชั่วคราว) · `cookieName` ตามชนิดของฐาน: file: = ชื่อ dev, อื่น ๆ = ชื่อ production */
export async function breakGlassReset(
  db: Db,
  args: Args,
  now: number,
  options: { env?: EnvSource; cookieName?: string } = {},
): Promise<Outcome> {
  const problem = checkConfirmation(args);
  if (problem) return { ok: false, code: 2, message: problem };

  const normalized = normalizeUsername(args.username!);
  const target = await findUserByUsernameNormalized(db, normalized);
  // ข้อความเดียวกันทุกกรณีที่ไม่เข้าเงื่อนไข — สคริปต์รันโดยเจ้าของระบบ แต่ไม่ต้องบอกเกินจำเป็น
  if (!target || target.status !== 'active' || !target.isAdmin) {
    return { ok: false, code: 3, message: 'ไม่พบบัญชี super admin ที่ active ชื่อนี้ (สคริปต์นี้ใช้กับ super admin เท่านั้น — ผู้ใช้อื่นให้ใช้หน้า admin)' };
  }
  if (await localPepperStillMatches(db, options.env ?? process.env)) {
    return {
      ok: false,
      code: 3,
      message: 'pepper ใน env ของเครื่องนี้ยังตรงกับ fingerprint ในฐาน = pepper ไม่ได้หายจริง → ใส่ค่าที่ถูกคืนใน Vercel (ส่วน G7 ข้อ 1) แทนการรันสคริปต์นี้',
    };
  }

  const deviceToken = newDeviceToken();
  const requestId = newId();
  const expiresAt = now + PIN_RESET_APPROVED_TTL_MS;
  await db.transaction(async (tx) => {
    // partial unique index อนุญาตคำขอเปิดได้ 1 ต่อ user → ปิดของเก่าก่อน
    await tx
      .update(pinResetRequest)
      .set({ status: 'cancelled' })
      .where(and(eq(pinResetRequest.userId, target.id), inArray(pinResetRequest.status, ['pending', 'approved'])));
    await tx.insert(pinResetRequest).values({
      id: requestId,
      userId: target.id,
      status: 'approved',
      deviceTokenHash: sha256Hex(deviceToken),
      requesterUa: REQUESTER_LABEL,
      requesterCountry: null,
      requestedAt: now,
      pendingExpiresAt: now + PIN_RESET_PENDING_TTL_MS,
      decidedBy: null, // ไม่มีผู้อนุมัติในระบบ — break-glass ผ่านสิทธิ์ฐานข้อมูล
      decidedAt: now,
      expiresAt,
    });
    await clearUserPinHash(tx, target.id, now);
    await setMustChangePin(tx, target.id, true, now);
    await insertAuditLog(
      tx,
      { id: newId(), actorId: null, action: AUDIT_ACTION, targetType: 'pin_reset', targetId: requestId, meta: { targetUserId: target.id } },
      now,
    );
  });
  return {
    ok: true,
    username: target.username,
    deviceToken,
    cookieName: options.cookieName ?? RESET_COOKIE_PROD,
    expiresAt,
    requestId,
  };
}

const bangkok = (ms: number): string =>
  new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium' }).format(ms);

export async function main(argv: readonly string[], env: EnvSource = process.env, now: number = Date.now()): Promise<number> {
  const args = parseArgs(argv);
  const problem = checkConfirmation(args);
  if (problem) {
    console.error(`ไม่ทำงาน: ${problem}`);
    console.error('ตัวอย่าง: npx tsx scripts/admin-reset-pin.ts --username <ชื่อ> --confirm-username <ชื่อ> --confirm-pepper-lost');
    return 2;
  }
  const url = env.TURSO_DATABASE_URL?.trim();
  const authToken = env.TURSO_AUTH_TOKEN?.trim() || undefined;
  if (!url) {
    console.error('ไม่ทำงาน: ต้องตั้ง TURSO_DATABASE_URL ใน environment ของ PowerShell ก่อน (ดู docs/OPERATIONS.md G7)');
    return 2;
  }
  const isFile = url.startsWith('file:');
  if (!isFile && !authToken) {
    console.error('ไม่ทำงาน: ต้องตั้ง TURSO_AUTH_TOKEN ใน environment (อย่าใส่ใน argument)');
    return 2;
  }

  const db = createDb({ url, authToken });
  try {
    const r = await breakGlassReset(db, args, now, { env, cookieName: isFile ? RESET_COOKIE_DEV : RESET_COOKIE_PROD });
    if (!r.ok) {
      console.error(`ไม่ทำงาน: ${r.message}`);
      return r.code;
    }
    console.log(`เปิดคำขอ reset แบบอนุมัติแล้วสำหรับบัญชี: ${r.username}`);
    console.log(`หมดอายุ: ${bangkok(r.expiresAt)} (เวลาไทย) · ใช้ได้ครั้งเดียว · ใช้ได้เฉพาะเบราว์เซอร์ที่มี cookie ด้านล่าง`);
    console.log('');
    console.log(`ชื่อ cookie : ${r.cookieName}`);
    console.log(`ค่า cookie  : ${r.deviceToken}`);
    console.log('');
    console.log('ขั้นต่อไป: ตั้ง cookie นี้ในเบราว์เซอร์ที่จะ login (Path = /, Secure) แล้ว login ด้วย PIN ชั่วคราวตาม docs/OPERATIONS.md G7');
    console.log('ระบบจะบังคับตั้ง PIN ใหม่ทันที · อย่าส่งค่า cookie นี้ให้ใคร และปิดหน้าต่างนี้เมื่อเสร็จ');
    return 0;
  } catch {
    // ไม่พิมพ์รายละเอียด error ดิบ — อาจมี URL/ข้อมูลเชื่อมต่อ
    console.error('ผิดพลาดระหว่างเขียนฐานข้อมูล (ไม่มีการเปลี่ยนแปลงถ้า transaction ล้ม) — ตรวจ URL/token แล้วลองใหม่');
    return 1;
  } finally {
    db.$client.close();
  }
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.error('ผิดพลาดที่ไม่คาดคิด');
      process.exitCode = 1;
    },
  );
}
