// ADR 0002 Test requirement 15 (§7.2): fingerprint ของ pepper ในฐานข้อมูล
// DB มี fingerprint ของ V1 → ตั้ง env V1 เป็นค่าอื่น → login ด้วย PIN ถูก → 503 AUTH_MAINTENANCE (ไม่ใช่ INVALID_CREDENTIALS) และ throttle ไม่ขยับ ·
// ใส่ค่าถูกคืน → login ได้ทันที · DB ไม่มีแถว V1 แต่มีผู้ใช้ V1 → fail closed · DB ว่าง + ไม่มีผู้ใช้ → insert fingerprint ครั้งแรก ·
// เวอร์ชันเก่าถูกลบออกจาก env ทั้งที่ยังมีผู้ใช้ → เฉพาะผู้ใช้กลุ่มนั้นได้ AUTH_MAINTENANCE
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fingerprintPrefix,
  FINGERPRINT_MESSAGE,
  listPepperFingerprintPrefixes,
  pepperFingerprint,
  readPepperHealth,
  resolvePepper,
} from '@/lib/auth/pepper';
import { Client, freshPepper, GOOD_PIN, OTHER_PIN, setPepperEnv, setupHarness, type Harness } from './harness';

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

const fps = (hh: Harness) => hh.rows<{ version: number; fingerprint: string }>('SELECT version, fingerprint FROM pepper_fingerprint ORDER BY version');

describe('fingerprint = HMAC-SHA256(key = pepper, msg = "maewmeet/pepper-fingerprint/v1")', () => {
  it('ตรงสูตรใน ADR และเป็น hex 64 ตัว · 8 ตัวแรกเท่านั้นที่เป็น prefix สำหรับแสดง', () => {
    const secret = Buffer.from(freshPepper(), 'base64');
    const expected = createHmac('sha256', secret).update('maewmeet/pepper-fingerprint/v1').digest('hex');
    expect(FINGERPRINT_MESSAGE).toBe('maewmeet/pepper-fingerprint/v1');
    expect(pepperFingerprint(secret)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintPrefix(expected)).toBe(expected.slice(0, 8));
    expect(pepperFingerprint(Buffer.from(freshPepper(), 'base64'))).not.toBe(expected);
  });
});

describe('ตารางสถานะ ADR §7.2', () => {
  it('DB ว่าง + ไม่มีผู้ใช้ → insert fingerprint ของเวอร์ชันปัจจุบันครั้งแรก (ครั้งเดียว ไม่เขียนทับ)', async () => {
    h = await setupHarness({ initFingerprint: false });
    expect(await fps(h)).toHaveLength(0);
    const r = await resolvePepper(h.db, h.clock.now());
    expect(r.ok).toBe(true);
    const rows = await fps(h);
    expect(rows).toEqual([{ version: 1, fingerprint: pepperFingerprint(Buffer.from(h.peppers[1]!, 'base64')) }]);
    await resolvePepper(h.db, h.clock.now() + 1000);
    expect(await fps(h)).toEqual(rows);
  });

  it('เรียกพร้อมกันหลาย request ตอนฐานว่าง → ได้แถวเดียว ไม่ error', async () => {
    h = await setupHarness({ initFingerprint: false });
    const rs = await Promise.all(Array.from({ length: 6 }, () => resolvePepper(h!.db, h!.clock.now())));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(await fps(h)).toHaveLength(1);
  });

  it('มีแถว V1 แต่ env เป็นค่าอื่น → login ด้วย PIN ถูก = 503 AUTH_MAINTENANCE (ไม่ใช่ INVALID_CREDENTIALS) · throttle ไม่ขยับ · ใส่ค่าถูกคืนแล้วเข้าได้ทันที', async () => {
    h = await setupHarness();
    const good = h.peppers[1]!;
    await h.seedUser('alice');
    expect((await new Client().login('alice', GOOD_PIN)).status).toBe(200); // ปกติเข้าได้
    const before = {
      throttle: await h.rows('SELECT * FROM login_throttle'),
      buckets: await h.rows('SELECT * FROM rate_limit_bucket'),
      fps: await fps(h),
    };

    setPepperEnv({ 1: freshPepper() }, 1); // env ถูกแก้เป็นค่าผิด
    const c = new Client();
    for (const pin of [GOOD_PIN, OTHER_PIN]) {
      const r = await c.login('alice', pin);
      expect(r.status).toBe(503);
      expect(r.code).toBe('AUTH_MAINTENANCE');
    }
    expect((await c.post('/api/auth/signup', { username: 'zz_new', displayName: 'Z', pin: '482915', pinConfirm: '482915' })).code).toBe('AUTH_MAINTENANCE');
    expect(await h.rows('SELECT * FROM login_throttle')).toEqual(before.throttle);
    expect(await h.rows('SELECT * FROM rate_limit_bucket')).toEqual(before.buckets);
    expect(await fps(h)).toEqual(before.fps); // fingerprint เดิมไม่ถูกเขียนทับด้วยค่าผิด
    expect((await readPepperHealth(h.db, h.clock.now())).ok).toBe(false);

    setPepperEnv({ 1: good }, 1);
    expect((await new Client().login('alice', GOOD_PIN)).status).toBe(200);
  });

  it('DB ไม่มีแถว V1 แต่มีผู้ใช้ที่ hash ด้วย V1 → fail closed (แถวหายผิดปกติ)', async () => {
    h = await setupHarness({ initFingerprint: false });
    await h.seedUser('alice');
    const r = await new Client().login('alice', GOOD_PIN);
    expect(r.code).toBe('AUTH_MAINTENANCE');
    expect(await fps(h)).toHaveLength(0); // และไม่ "แก้" เองโดยเขียน fingerprint ใหม่
    expect(await h.count('login_throttle')).toBe(0);
  });

  it('เวอร์ชันเก่าที่ไม่ใช่ current: fingerprint ไม่ตรง → fail closed ทั้งระบบ · มีแถวหาย + มีผู้ใช้ → fail closed', async () => {
    h = await setupHarness();
    const p1 = h.peppers[1]!;
    await h.seedUser('old', GOOD_PIN, { version: 1 });
    const p2 = freshPepper();
    setPepperEnv({ 1: p1, 2: p2 }, 2);
    expect((await new Client().login('old', GOOD_PIN)).status).toBe(200); // หมุนปกติ: V2 ถูกตั้ง fingerprint
    expect((await fps(h)).map((r) => r.version)).toEqual([1, 2]);

    setPepperEnv({ 1: freshPepper(), 2: p2 }, 2); // V1 ถูกแก้เป็นค่าผิด (current ยังถูก)
    expect((await new Client().login('old', GOOD_PIN)).code).toBe('AUTH_MAINTENANCE');
  });

  it('เวอร์ชันเก่าถูกลบออกจาก env ทั้งที่ยังมีผู้ใช้ → เฉพาะผู้ใช้กลุ่มนั้นได้ AUTH_MAINTENANCE · คนอื่นเข้าได้', async () => {
    h = await setupHarness();
    const p1 = h.peppers[1]!;
    await h.seedUser('stuck', GOOD_PIN, { version: 1 });
    const p2 = freshPepper();
    setPepperEnv({ 1: p1, 2: p2 }, 2);
    expect((await resolvePepper(h.db, h.clock.now())).ok).toBe(true); // request แรกหลัง deploy V2: ตั้ง fingerprint V2 (ยังไม่มีผู้ใช้ V2)
    await h.seedUser('fine', GOOD_PIN, { version: 2, pepper: p2 });
    setPepperEnv({ 2: p2 }, 2);
    expect((await new Client().login('stuck', GOOD_PIN)).code).toBe('AUTH_MAINTENANCE');
    expect((await new Client().login('fine', GOOD_PIN)).status).toBe(200);
    expect(await h.count("login_throttle WHERE key = 'u:stuck'")).toBe(0);
  });
});

describe('ไม่เปิดเผยค่าเต็ม (ข้อ 17 ส่วน fingerprint)', () => {
  it('หน้า admin ได้เฉพาะ prefix 8 ตัว · health มีแค่ ok/currentVersion/usersByVersion', async () => {
    h = await setupHarness();
    await h.seedUser('alice');
    const full = (await fps(h))[0]!.fingerprint;
    const prefixes = await listPepperFingerprintPrefixes(h.db);
    expect(prefixes).toEqual([{ version: 1, prefix: full.slice(0, 8) }]);
    expect(JSON.stringify(prefixes)).not.toContain(full);
    const health = await readPepperHealth(h.db, h.clock.now());
    expect(Object.keys(health).sort()).toEqual(['currentVersion', 'ok', 'usersByVersion']);
    expect(JSON.stringify(health)).not.toContain(full.slice(0, 16));
    expect(JSON.stringify(health)).not.toContain(h.peppers[1]!);
  });
});
