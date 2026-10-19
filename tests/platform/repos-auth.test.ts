// R1 Platform: repos ของบัญชี/session/throttle/rate limit/reset/audit/notification/pepper fingerprint
// DB จริง (libSQL file: + migration จริง) · นาฬิกา inject เป็นพารามิเตอร์ `now`
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/lib/shared/clock';
import { newId } from '@/lib/shared/id';
import { createTestDb, type TestDb } from '../helpers/db';
import {
  clearUserPinHash,
  countUsersWithPinByPepperVersion,
  findUserById,
  findUserByUsernameNormalized,
  insertUser,
  listSuperAdminUsernames,
  rehashUserPin,
  setMustChangePin,
  setUserPin,
} from '@/lib/data/repos/user';
import {
  deleteAllSessionsOfUser,
  deleteExpiredSessions,
  deleteOtherSessionsOfUser,
  deleteSession,
  findSessionWithUser,
  insertSession,
  SESSION_TTL_MS,
  touchSession,
} from '@/lib/data/repos/session';
import { getLoginThrottle, lockRemainingSec, reserveLoginAttempt, resetLoginThrottle } from '@/lib/data/repos/login-throttle';
import { hitBucket, peekBucket, refundBucket, reserveBucket, windowStartOf } from '@/lib/data/repos/rate-limit-bucket';
import {
  approvePinReset,
  cancelPendingPinResetOfUser,
  createPendingPinReset,
  findLatestPinResetByDevice,
  findOpenPinResetByUser,
  findPinResetById,
  findUsableApprovedPinReset,
  listPendingPinResets,
  markPinResetUsed,
  PIN_RESET_APPROVED_TTL_MS,
  PIN_RESET_PENDING_TTL_MS,
  rejectPinReset,
} from '@/lib/data/repos/pin-reset-request';
import { insertAuditLog, listAuditLog } from '@/lib/data/repos/audit-log';
import {
  countUnreadNotifications,
  insertNotification,
  listNotificationsOfUser,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/data/repos/notification';
import { getPepperFingerprint, insertPepperFingerprintIfAbsent, listPepperFingerprints } from '@/lib/data/repos/pepper-fingerprint';

const T0 = 1_760_000_000_000;
let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.cleanup();
});
beforeEach(async () => {
  const db = t.db;
  for (const tbl of [
    schema.notification,
    schema.auditLog,
    schema.pinResetRequest,
    schema.session,
    schema.loginThrottle,
    schema.rateLimitBucket,
    schema.pepperFingerprint,
  ]) {
    await db.delete(tbl);
  }
  await db.delete(schema.user);
});

async function mkUser(name: string, extra: { pinHash?: string; version?: number } = {}) {
  const u = await insertUser(
    t.db,
    {
      id: newId(),
      username: name,
      usernameNormalized: name.toLowerCase(),
      displayName: name,
      pinHash: extra.pinHash ?? `hash-${name}`,
      pinPepperVersion: extra.version ?? 1,
    },
    T0,
  );
  return u!;
}

describe('user repo', () => {
  it('insert/find และ username_normalized ซ้ำ → null (ไม่โยน)', async () => {
    const a = await mkUser('Alice');
    expect(a.mustChangePin).toBe(false);
    expect(a.isAdmin).toBe(false);
    expect((await findUserById(t.db, a.id))?.username).toBe('Alice');
    expect((await findUserByUsernameNormalized(t.db, 'alice'))?.id).toBe(a.id);
    const dup = await insertUser(
      t.db,
      { id: newId(), username: 'ALICE', usernameNormalized: 'alice', displayName: 'x', pinHash: 'h', pinPepperVersion: 1 },
      T0,
    );
    expect(dup).toBeNull();
    expect(await findUserById(t.db, 'nope')).toBeNull();
  });

  it('setUserPin / clearUserPinHash / setMustChangePin / rehash แบบมีเงื่อนไข', async () => {
    const a = await mkUser('bob');
    await setUserPin(t.db, a.id, { pinHash: 'h2', pinPepperVersion: 2, mustChangePin: true }, T0 + 1);
    let r = (await findUserById(t.db, a.id))!;
    expect([r.pinHash, r.pinPepperVersion, r.mustChangePin, r.updatedAt]).toEqual(['h2', 2, true, T0 + 1]);
    await setUserPin(t.db, a.id, { pinHash: 'h3', pinPepperVersion: 2 }, T0 + 2); // ไม่ระบุ = ไม่แตะ must_change_pin
    expect((await findUserById(t.db, a.id))!.mustChangePin).toBe(true);
    await setMustChangePin(t.db, a.id, false, T0 + 3);
    expect((await findUserById(t.db, a.id))!.mustChangePin).toBe(false);

    expect(await rehashUserPin(t.db, a.id, 'WRONG', { pinHash: 'h4', pinPepperVersion: 3 }, T0 + 4)).toBe(false);
    expect(await rehashUserPin(t.db, a.id, 'h3', { pinHash: 'h4', pinPepperVersion: 3 }, T0 + 4)).toBe(true);
    await clearUserPinHash(t.db, a.id, T0 + 5);
    r = (await findUserById(t.db, a.id))!;
    expect(r.pinHash).toBeNull();
    // hash เป็น NULL แล้ว rehash ด้วย expected เดิมต้องไม่ติด
    expect(await rehashUserPin(t.db, a.id, 'h4', { pinHash: 'zz', pinPepperVersion: 3 }, T0 + 6)).toBe(false);
  });

  it('countUsersWithPinByPepperVersion นับเฉพาะที่มี pin_hash แยกเวอร์ชัน', async () => {
    await mkUser('u1', { version: 1 });
    await mkUser('u2', { version: 1 });
    const u3 = await mkUser('u3', { version: 2 });
    const u4 = await mkUser('u4', { version: 2 });
    await clearUserPinHash(t.db, u4.id, T0);
    expect(await countUsersWithPinByPepperVersion(t.db)).toEqual({ 1: 2, 2: 1 });
    expect(u3.pinPepperVersion).toBe(2);
  });

  it('is_admin อ่านสดและไม่มี repo ฟังก์ชันตั้งค่า (ตั้งด้วย SQL เท่านั้น)', async () => {
    const a = await mkUser('boss');
    expect(await listSuperAdminUsernames(t.db)).toEqual([]);
    await t.db.$client.execute({ sql: "UPDATE user SET is_admin = 1 WHERE username = ?", args: ['boss'] });
    expect(await listSuperAdminUsernames(t.db)).toEqual(['boss']);
    expect((await findUserById(t.db, a.id))!.isAdmin).toBe(true);
  });
});

describe('session repo', () => {
  it('insert → find (JOIN user สด) · ไม่เก็บ/ไม่รู้จัก token ดิบ · UA ตัดที่ 200', async () => {
    const u = await mkUser('carol');
    const s = await insertSession(t.db, { id: 'sha-1', userId: u.id, userAgent: 'x'.repeat(500) }, T0);
    expect(s.expiresAt).toBe(T0 + SESSION_TTL_MS);
    expect(s.userAgent).toHaveLength(200);
    const found = await findSessionWithUser(t.db, 'sha-1', T0 + 1);
    expect(found?.user).toMatchObject({ id: u.id, isAdmin: false, status: 'active', mustChangePin: false });
    // สิทธิ์อ่านสดทุกครั้ง
    await t.db.update(schema.user).set({ status: 'suspended', mustChangePin: true, isAdmin: true }).where(eq(schema.user.id, u.id));
    expect((await findSessionWithUser(t.db, 'sha-1', T0 + 2))?.user).toMatchObject({
      status: 'suspended',
      mustChangePin: true,
      isAdmin: true,
    });
  });

  it('หมดอายุ (expires_at <= now) → ไม่พบ', async () => {
    const u = await mkUser('dave');
    await insertSession(t.db, { id: 's', userId: u.id }, T0);
    expect(await findSessionWithUser(t.db, 's', T0 + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(await findSessionWithUser(t.db, 's', T0 + SESSION_TTL_MS)).toBeNull();
    expect(await findSessionWithUser(t.db, 'missing', T0)).toBeNull();
    expect(await deleteExpiredSessions(t.db, T0 + SESSION_TTL_MS)).toBe(1);
  });

  it('sliding: เหลือ >= 30 วันและเห็นล่าสุด < 1 วัน → ไม่เขียน · เหลือ < 30 วัน → ต่อเป็น now+60 วัน · last_seen วันละครั้ง', async () => {
    const u = await mkUser('erin');
    const s = await insertSession(t.db, { id: 's', userId: u.id }, T0);
    expect(await touchSession(t.db, s, T0 + HOUR_MS)).toBeNull();
    // 1 วันผ่านไป: อัปเดต last_seen แต่ยังไม่ต่ออายุ (เหลือ 59 วัน)
    const a = (await touchSession(t.db, s, T0 + DAY_MS))!;
    expect(a.lastSeenAt).toBe(T0 + DAY_MS);
    expect(a.expiresAt).toBe(T0 + SESSION_TTL_MS);
    // วันที่ 31: เหลือ 29 วัน → ต่อ
    const d31 = T0 + 31 * DAY_MS;
    const b = (await touchSession(t.db, a, d31))!;
    expect(b.expiresAt).toBe(d31 + SESSION_TTL_MS);
    expect(b.lastSeenAt).toBe(d31);
  });

  it('ลบ: เฉพาะตัว / ทุกเครื่อง / เหลือเครื่องปัจจุบัน', async () => {
    const u = await mkUser('fay');
    const other = await mkUser('gus');
    for (const id of ['a', 'b', 'c']) await insertSession(t.db, { id, userId: u.id }, T0);
    await insertSession(t.db, { id: 'z', userId: other.id }, T0);
    expect(await deleteOtherSessionsOfUser(t.db, u.id, 'a')).toBe(2);
    expect((await t.db.select().from(schema.session).where(eq(schema.session.userId, u.id))).map((r) => r.id)).toEqual(['a']);
    await deleteSession(t.db, 'a');
    await insertSession(t.db, { id: 'd', userId: u.id }, T0);
    expect(await deleteAllSessionsOfUser(t.db, u.id)).toBe(1);
    expect((await t.db.select().from(schema.session)).map((r) => r.id)).toEqual(['z']);
  });
});

describe('login_throttle repo', () => {
  const sched = (f: number) => (f >= 5 ? Math.min(2 ** (f - 5) * MINUTE_MS, DAY_MS) : 0);
  /** จองแล้วคืนแถว (ต้อง admitted) */
  const reserve = async (key: string, now: number) => {
    const r = await reserveLoginAttempt(t.db, key, now, sched);
    if (!r.admitted) throw new Error('expected admitted');
    return r.row;
  };

  it('จองครั้งที่ 1–4 ไม่ล็อก · ครั้งที่ 5 ล็อก 1 นาที · 6 → 2 นาที · เพดาน 24 ชม.', async () => {
    const key = 'u:alice';
    for (let f = 1; f <= 4; f++) {
      const r = await reserve(key, T0);
      expect(r.failures).toBe(f);
      expect(r.lockedUntil).toBeNull();
    }
    let r = await reserve(key, T0);
    expect(r.failures).toBe(5);
    expect(lockRemainingSec(r, T0)).toBe(60);
    expect(lockRemainingSec(r, T0 + 59_001)).toBe(1);
    expect(lockRemainingSec(r, T0 + 60_000)).toBe(0);
    r = await reserve(key, T0 + 60_000);
    expect(lockRemainingSec(r, T0 + 60_000)).toBe(120);
    // ตารางครบทุกขั้นเหมือน lockMsFor (SQL CASE สร้างจากฟังก์ชันเดียวกัน)
    const seen: number[] = [];
    for (let i = 0; i < 14; i++) {
      const now = r.lockedUntil! + i; // พ้นล็อกเดิมเสมอ
      r = await reserve(key, now);
      seen.push(lockRemainingSec(r, now));
    }
    expect(seen).toEqual([240, 480, 960, 1920, 3840, 7680, 15360, 30720, 61440, 86400, 86400, 86400, 86400, 86400]);
  });

  it('ล็อกอยู่ → ปฏิเสธโดยไม่แก้แถว (failures/locked_until คงเดิม) · พ้นล็อกแล้วจองได้อีก', async () => {
    const key = 'u:locked';
    for (let i = 0; i < 5; i++) await reserve(key, T0);
    const before = (await getLoginThrottle(t.db, key))!;
    for (let i = 0; i < 20; i++) {
      const r = await reserveLoginAttempt(t.db, key, T0 + 1000 + i, sched);
      expect(r).toEqual({ admitted: false, lockedUntil: before.lockedUntil });
    }
    expect(await getLoginThrottle(t.db, key)).toEqual(before);
    expect((await reserve(key, before.lockedUntil!)).failures).toBe(6);
  });

  it('จองพร้อมกัน 60 ครั้ง: admitted ได้ 5 เท่านั้น (failures 1..5) ที่เหลือถูกปฏิเสธ', async () => {
    const rs = await Promise.all(Array.from({ length: 60 }, () => reserveLoginAttempt(t.db, 'u:burst', T0, sched)));
    const admitted = rs.filter((r) => r.admitted);
    expect(admitted).toHaveLength(5);
    expect(admitted.map((r) => (r.admitted ? r.row.failures : 0)).sort()).toEqual([1, 2, 3, 4, 5]);
    expect((await getLoginThrottle(t.db, 'u:burst'))!.failures).toBe(5);
  });

  it('reset ล้างตัวนับและล็อก · ไม่มีแถว = ไม่ล็อก · กุญแจต่างกันไม่ปนกัน', async () => {
    expect(lockRemainingSec(await getLoginThrottle(t.db, 'u:none'), T0)).toBe(0);
    for (let i = 0; i < 3; i++) await reserve('u:par', T0);
    expect((await getLoginThrottle(t.db, 'u:par'))!.failures).toBe(3);
    await resetLoginThrottle(t.db, 'u:par', T0 + 1);
    const row = (await getLoginThrottle(t.db, 'u:par'))!;
    expect([row.failures, row.lockedUntil]).toEqual([0, null]);
    await reserve('u:x', T0);
    expect((await getLoginThrottle(t.db, 'u:y'))).toBeNull();
  });
});

describe('rate_limit_bucket repo (UPSERT อะตอมมิก)', () => {
  const W = 15 * MINUTE_MS;

  it('นับ 1,2,3 ในหน้าต่างเดียว · หน้าต่างใหม่เริ่ม 1 · peek ไม่นับ', async () => {
    const now = windowStartOf(T0, W) + 10;
    expect((await hitBucket(t.db, 'login:ip:a', W, now)).count).toBe(1);
    expect((await hitBucket(t.db, 'login:ip:a', W, now + 5)).count).toBe(2);
    const peek = await peekBucket(t.db, 'login:ip:a', W, now + 6);
    expect(peek.count).toBe(2);
    expect((await peekBucket(t.db, 'login:ip:a', W, now + 6)).count).toBe(2);
    const h3 = await hitBucket(t.db, 'login:ip:a', W, now + 7);
    expect(h3).toMatchObject({ count: 3, windowEnd: h3.windowStart + W });
    // หน้าต่างถัดไป
    const next = await hitBucket(t.db, 'login:ip:a', W, h3.windowEnd);
    expect(next.count).toBe(1);
    expect((await peekBucket(t.db, 'login:ip:a', W, h3.windowEnd - 1)).count).toBe(0); // หน้าต่างเก่าไม่เห็นค่าของหน้าต่างใหม่
    expect((await peekBucket(t.db, 'never', W, now)).count).toBe(0);
    const rows = await t.db.select().from(schema.rateLimitBucket).where(eq(schema.rateLimitBucket.key, 'login:ip:a'));
    expect(rows).toHaveLength(1); // แถวเดียวต่อคีย์
  });

  it('เพิ่มพร้อมกัน 50 ครั้ง ได้ค่า 1..50 ไม่ซ้ำไม่ตก (atomic)', async () => {
    const now = windowStartOf(T0, W) + 1;
    const hits = await Promise.all(Array.from({ length: 50 }, () => hitBucket(t.db, 'signup:ip:p', W, now)));
    const counts = hits.map((h) => h.count).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect((await peekBucket(t.db, 'signup:ip:p', W, now)).count).toBe(50);
  });

  it('reserveBucket: เต็ม limit แล้วปฏิเสธโดยไม่เพิ่ม · พร้อมกัน 60 ได้ admitted = limit · refund คืนช่อง · หน้าต่างใหม่เริ่มใหม่', async () => {
    const now = windowStartOf(T0, W) + 1;
    const rs = await Promise.all(Array.from({ length: 60 }, () => reserveBucket(t.db, 'login:ip:r', W, 20, now)));
    expect(rs.filter((r) => r.admitted)).toHaveLength(20);
    expect((await peekBucket(t.db, 'login:ip:r', W, now)).count).toBe(20); // ผู้ถูกปฏิเสธไม่ดันเกิน
    expect(rs[0]!.windowEnd).toBe(windowStartOf(now, W) + W);
    await refundBucket(t.db, 'login:ip:r', W, now);
    expect((await peekBucket(t.db, 'login:ip:r', W, now)).count).toBe(19);
    expect((await reserveBucket(t.db, 'login:ip:r', W, 20, now)).admitted).toBe(true);
    expect((await reserveBucket(t.db, 'login:ip:r', W, 20, now)).admitted).toBe(false);
    const later = windowStartOf(now, W) + W;
    expect((await reserveBucket(t.db, 'login:ip:r', W, 20, later)).admitted).toBe(true);
    expect((await peekBucket(t.db, 'login:ip:r', W, later)).count).toBe(1);
    await refundBucket(t.db, 'login:ip:r', W, now); // หน้าต่างเก่า → ไม่แตะค่าของหน้าต่างใหม่
    expect((await peekBucket(t.db, 'login:ip:r', W, later)).count).toBe(1);
    await refundBucket(t.db, 'never', W, now); // ไม่มีแถว → ไม่ error
  });

  it('windowMs ไม่ถูกต้อง → โยน', () => {
    expect(() => windowStartOf(T0, 0)).toThrow(RangeError);
    expect(() => windowStartOf(T0, 1.5)).toThrow(RangeError);
  });
});

describe('pin_reset_request repo', () => {
  const dev = 'device-hash-1';
  async function req(userId: string, now = T0, deviceTokenHash = dev) {
    return createPendingPinReset(t.db, { id: newId(), userId, deviceTokenHash, requesterUa: 'iPhone · Safari', requesterCountry: 'TH' }, now);
  }

  it('สร้าง pending: ตั้ง pending_expires_at = +7 วัน · ซ้ำขณะ pending/approved → null (partial unique index) ไม่โยน', async () => {
    const u = await mkUser('hana');
    const r1 = (await req(u.id))!;
    expect(r1).toMatchObject({ status: 'pending', requestedAt: T0, pendingExpiresAt: T0 + PIN_RESET_PENDING_TTL_MS, requesterCountry: 'TH' });
    expect(await req(u.id, T0 + 1000)).toBeNull();
    expect(await t.db.select().from(schema.pinResetRequest)).toHaveLength(1);
  });

  it('partial unique index ปฏิเสธ insert ตรงที่ข้าม repo (pending และ approved) แต่ยอมเมื่อแถวเดิมปิดแล้ว', async () => {
    const u = await mkUser('ivy');
    const adm = await mkUser('adm');
    const raw = (id: string, status: string) =>
      t.db.$client.execute({
        sql: 'insert into pin_reset_request(id,user_id,status,device_token_hash,requested_at,pending_expires_at) values (?,?,?,?,?,?)',
        args: [id, u.id, status, 'd', T0, T0 + PIN_RESET_PENDING_TTL_MS],
      });
    await raw('p1', 'pending');
    await expect(raw('p2', 'pending')).rejects.toThrow(/constraint/i);
    await expect(raw('p3', 'approved')).rejects.toThrow(/constraint/i);
    expect(await rejectPinReset(t.db, 'p1', adm.id, T0 + 1)).not.toBeNull();
    await raw('p4', 'pending'); // ปิดแล้ว (rejected) → ขอใหม่ได้
    await expect(raw('p5', 'approved')).rejects.toThrow(/constraint/i);
  });

  it('approve: pending→approved, expires_at=+24 ชม., บันทึกผู้อนุมัติ · approve ซ้ำ/reject หลัง approve → null', async () => {
    const u = await mkUser('jon');
    const adm = await mkUser('sa');
    const r = (await req(u.id))!;
    const a = (await approvePinReset(t.db, r.id, adm.id, T0 + HOUR_MS))!;
    expect(a).toMatchObject({ status: 'approved', decidedBy: adm.id, decidedAt: T0 + HOUR_MS, expiresAt: T0 + HOUR_MS + PIN_RESET_APPROVED_TTL_MS });
    expect(await approvePinReset(t.db, r.id, adm.id, T0 + HOUR_MS)).toBeNull();
    expect(await rejectPinReset(t.db, r.id, adm.id, T0 + HOUR_MS)).toBeNull();
    expect(await req(u.id, T0 + HOUR_MS)).toBeNull(); // approved ยังนับเป็นเปิดอยู่
    expect((await findOpenPinResetByUser(t.db, u.id, T0 + HOUR_MS))?.id).toBe(r.id);
  });

  it('lazy expiry: pending เลย 7 วัน → expired (ตอนอ่านและเมื่อ approve) และไม่บังคำขอใหม่', async () => {
    const u = await mkUser('kim');
    const adm = await mkUser('sa2');
    const r = (await req(u.id))!;
    const late = T0 + PIN_RESET_PENDING_TTL_MS;
    expect(await approvePinReset(t.db, r.id, adm.id, late)).toBeNull(); // เลยเวลา = ตัดสินไม่ได้
    expect((await findPinResetById(t.db, r.id, late))!.status).toBe('expired');
    expect(await listPendingPinResets(t.db, late)).toEqual([]);
    const fresh = await req(u.id, late); // ขอใหม่ได้
    expect(fresh?.status).toBe('pending');
  });

  it('lazy expiry: approved เลย 24 ชม. (+1 วินาที) → expired, ใช้ไม่ได้, ขอใหม่ได้ · ก่อนหน้านั้นยังใช้ได้', async () => {
    const u = await mkUser('lee');
    const adm = await mkUser('sa3');
    const r = (await req(u.id))!;
    await approvePinReset(t.db, r.id, adm.id, T0);
    const edge = T0 + PIN_RESET_APPROVED_TTL_MS;
    expect((await findUsableApprovedPinReset(t.db, u.id, edge - 1))?.id).toBe(r.id);
    expect(await findUsableApprovedPinReset(t.db, u.id, edge + 1000)).toBeNull();
    expect((await findPinResetById(t.db, r.id, edge + 1000))!.status).toBe('expired');
    expect(await markPinResetUsed(t.db, r.id, edge + 1000)).toBeNull();
    expect(await findOpenPinResetByUser(t.db, u.id, edge + 1000)).toBeNull();
    expect(await req(u.id, edge + 1000)).not.toBeNull();
  });

  it('markPinResetUsed ใช้ได้ครั้งเดียว (ครั้งที่สอง null) และเลย expires_at ไม่ได้แม้ยังไม่ถูก expire ด้วย lazy', async () => {
    const u = await mkUser('max');
    const adm = await mkUser('sa4');
    const r = (await req(u.id))!;
    expect(await markPinResetUsed(t.db, r.id, T0)).toBeNull(); // pending ใช้ไม่ได้
    await approvePinReset(t.db, r.id, adm.id, T0);
    const used = (await markPinResetUsed(t.db, r.id, T0 + 5))!;
    expect(used).toMatchObject({ status: 'used', usedAt: T0 + 5 });
    expect(await markPinResetUsed(t.db, r.id, T0 + 6)).toBeNull();
    expect(await findUsableApprovedPinReset(t.db, u.id, T0 + 7)).toBeNull();
    // เส้นตายใน WHERE เอง: แถว approved ที่เลยเวลาแต่ยังไม่ถูกแตะ
    const u2 = await mkUser('nan');
    const r2 = (await req(u2.id, T0, 'dev2'))!;
    await approvePinReset(t.db, r2.id, adm.id, T0);
    expect(await markPinResetUsed(t.db, r2.id, T0 + PIN_RESET_APPROVED_TTL_MS)).toBeNull();
  });

  it('cancelPending: เฉพาะ pending (approved ไม่ถูกแตะ) · ไม่มี pending → null', async () => {
    const u = await mkUser('oat');
    const adm = await mkUser('sa5');
    expect(await cancelPendingPinResetOfUser(t.db, u.id, T0)).toBeNull();
    const r = (await req(u.id))!;
    expect((await cancelPendingPinResetOfUser(t.db, u.id, T0 + 1))?.status).toBe('cancelled');
    const r2 = (await req(u.id, T0 + 2))!;
    await approvePinReset(t.db, r2.id, adm.id, T0 + 3);
    expect(await cancelPendingPinResetOfUser(t.db, u.id, T0 + 4)).toBeNull();
    expect((await findPinResetById(t.db, r2.id, T0 + 4))!.status).toBe('approved');
    expect(r.id).not.toBe(r2.id);
  });

  it('listPending join user, เก่าสุดก่อน, ไม่รวมสถานะอื่น · findLatestByDevice คืนล่าสุดของเครื่องนั้น', async () => {
    const u1 = await mkUser('p1');
    const u2 = await mkUser('p2');
    const u3 = await mkUser('p3');
    const adm = await mkUser('sa6');
    const r2 = (await req(u2.id, T0 + 20, 'dev-b'))!;
    const r1 = (await req(u1.id, T0 + 10, 'dev-a'))!;
    const r3 = (await req(u3.id, T0 + 30, 'dev-c'))!;
    await rejectPinReset(t.db, r3.id, adm.id, T0 + 40);
    const list = await listPendingPinResets(t.db, T0 + 50);
    expect(list.map((x) => [x.id, x.username, x.requesterUa, x.requesterCountry])).toEqual([
      [r1.id, 'p1', 'iPhone · Safari', 'TH'],
      [r2.id, 'p2', 'iPhone · Safari', 'TH'],
    ]);
    expect((await findLatestPinResetByDevice(t.db, 'dev-c', T0 + 50))?.status).toBe('rejected');
    // เครื่องเดียวขอหลายครั้ง → ล่าสุด
    const again = (await req(u3.id, T0 + 60, 'dev-c'))!;
    expect((await findLatestPinResetByDevice(t.db, 'dev-c', T0 + 61))?.id).toBe(again.id);
    expect(await findLatestPinResetByDevice(t.db, 'unknown', T0)).toBeNull();
  });

  it('ลบ user → คำขอถูกลบตาม (cascade) · ผู้ตัดสินถูกลบ → decided_by เป็น NULL', async () => {
    const u = await mkUser('qin');
    const adm = await mkUser('sa7');
    const r = (await req(u.id))!;
    await approvePinReset(t.db, r.id, adm.id, T0);
    await t.db.delete(schema.user).where(eq(schema.user.id, adm.id));
    expect((await findPinResetById(t.db, r.id, T0 + 1))!.decidedBy).toBeNull();
    await t.db.delete(schema.user).where(eq(schema.user.id, u.id));
    expect(await findPinResetById(t.db, r.id, T0 + 1)).toBeNull();
  });
});

describe('audit_log repo', () => {
  it('insert/list เรียงใหม่→เก่า, กรองด้วย target/actor, actor=null (ระบบ)', async () => {
    const adm = await mkUser('auditor');
    await insertAuditLog(t.db, { id: 'a1', actorId: adm.id, action: 'pinReset.decide', targetType: 'pin_reset', targetId: 'r1', meta: { decision: 'approve', ownerId: 'u1' } }, T0);
    await insertAuditLog(t.db, { id: 'a2', actorId: null, action: 'cron.x', targetType: 'system', targetId: 's' }, T0 + 5);
    await insertAuditLog(t.db, { id: 'a3', actorId: adm.id, action: 'pinReset.decide', targetType: 'pin_reset', targetId: 'r2', groupId: 'g' }, T0 + 9);
    expect((await listAuditLog(t.db)).map((r) => r.id)).toEqual(['a3', 'a2', 'a1']);
    expect((await listAuditLog(t.db, { targetType: 'pin_reset', targetId: 'r1' })).map((r) => r.id)).toEqual(['a1']);
    expect((await listAuditLog(t.db, { actorId: adm.id, limit: 1 })).map((r) => r.id)).toEqual(['a3']);
    const a1 = (await listAuditLog(t.db, { targetId: 'r1' }))[0]!;
    expect(a1.meta).toEqual({ decision: 'approve', ownerId: 'u1' });
    expect((await listAuditLog(t.db, { targetId: 's' }))[0]!.actorId).toBeNull();
  });

  it('meta ที่มีคีย์ pin/token/hash/secret/pepper/code ถูกปฏิเสธและไม่เขียนแถว', async () => {
    for (const bad of [{ pin: '1' }, { nested: { sessionToken: 'x' } }, { pinHash: 'x' }, { PEPPER: 'x' }, { inviteCode: 'x' }]) {
      await expect(insertAuditLog(t.db, { id: newId(), actorId: null, action: 'a', targetType: 't', targetId: 'x', meta: bad }, T0)).rejects.toThrow(/not allowed/);
    }
    expect(await listAuditLog(t.db)).toEqual([]);
  });

  it('actor ถูกลบ → actor_id เป็น NULL แต่แถว audit อยู่ (set null)', async () => {
    const adm = await mkUser('gone');
    await insertAuditLog(t.db, { id: 'k', actorId: adm.id, action: 'a', targetType: 't', targetId: 'x' }, T0);
    await t.db.delete(schema.user).where(eq(schema.user.id, adm.id));
    expect((await listAuditLog(t.db))[0]!.actorId).toBeNull();
  });
});

describe('notification repo', () => {
  it('insert/list/unread/mark เฉพาะของเจ้าของ', async () => {
    const a = await mkUser('na');
    const b = await mkUser('nb');
    await insertNotification(t.db, { id: 'n1', userId: a.id, kind: 'pin_reset.approved', params: { requestId: 'r1' } }, T0);
    await insertNotification(t.db, { id: 'n2', userId: a.id, kind: 'pin_reset.cancelled_by_login' }, T0 + 1);
    await insertNotification(t.db, { id: 'n3', userId: b.id, kind: 'pin_reset.approved' }, T0 + 2);
    const list = await listNotificationsOfUser(t.db, a.id);
    expect(list.map((n) => n.id)).toEqual(['n2', 'n1']);
    expect(list[1]!.params).toEqual({ requestId: 'r1' });
    expect(list[0]!.params).toEqual({});
    expect(await countUnreadNotifications(t.db, a.id)).toBe(2);
    expect(await markNotificationRead(t.db, b.id, 'n1', T0 + 9)).toBe(false); // ของคนอื่น
    expect(await markNotificationRead(t.db, a.id, 'n1', T0 + 9)).toBe(true);
    expect(await markNotificationRead(t.db, a.id, 'n1', T0 + 10)).toBe(false); // อ่านแล้ว
    expect(await countUnreadNotifications(t.db, a.id)).toBe(1);
    expect(await markAllNotificationsRead(t.db, a.id, T0 + 11)).toBe(1);
    expect(await countUnreadNotifications(t.db, a.id)).toBe(0);
    expect(await countUnreadNotifications(t.db, b.id)).toBe(1);
  });
});

describe('pepper_fingerprint repo', () => {
  it('insert ครั้งแรก, ซ้ำไม่เขียนทับ, list เรียงเวอร์ชัน', async () => {
    expect(await getPepperFingerprint(t.db, 1)).toBeNull();
    expect(await insertPepperFingerprintIfAbsent(t.db, 1, 'aa'.repeat(32), T0)).toBe(true);
    expect(await insertPepperFingerprintIfAbsent(t.db, 1, 'bb'.repeat(32), T0 + 1)).toBe(false);
    expect((await getPepperFingerprint(t.db, 1))!.fingerprint).toBe('aa'.repeat(32));
    await insertPepperFingerprintIfAbsent(t.db, 3, 'cc', T0);
    await insertPepperFingerprintIfAbsent(t.db, 2, 'dd', T0);
    expect((await listPepperFingerprints(t.db)).map((r) => r.version)).toEqual([1, 2, 3]);
  });
});
