// R18 H2 + H3 — การใช้โค้ดเชิญ (POST /api/invites/redeem)
//  H2: pre-check ราคาถูกก่อนเข้าคิว serialized → ผู้ที่ติดลิมิตอยู่แล้ว (ถังผู้ใช้/IP/รวมทั้งระบบ) ได้ 429 ทันที ไม่ต้องรอคิว
//      ผู้ที่ยังไม่ติดลิมิตยังผ่านคิวเหมือนเดิม (การจองแบบอะตอมมิกยังเป็นด่านจริง)
//  H3: ถังรวมทั้งระบบสำหรับการใช้โค้ดผิด (redeem:all) นอกเหนือจากต่อผู้ใช้/ต่อ IP — เกินเพดาน → 429 ข้อความเดิม · ผู้ใช้ปกติไม่โดน · ไม่มีโค้ดใน log/ฐาน
//  security-v1 Low 1: ถังรวมเต็มบล็อกเฉพาะผู้เรียกที่ "ไม่สะอาด" (มีครั้งผิด/คำขอค้างในถัง IP หรือผู้ใช้ของตัวเอง) — ผู้ที่สะอาดยังได้ตรวจโค้ด
//      → ผู้โจมตีที่เติมถังรวมจนเต็มปิดการใช้โค้ดถูกของคนอื่นไม่ได้ · คู่ (IP, บัญชี) ใหม่ได้เดาเพิ่มอย่างมาก 1 ครั้ง/หน้าต่าง
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { windowStartOf } from '@/lib/data/repos/rate-limit-bucket';
import { INVITE_RATE_LIMITS, REDEEM_GLOBAL_KEY } from '@/lib/data/services/invites';
import { GROUP_MEMBERSHIP_RATE_LIMIT } from '@/lib/shared/limits';
import { serialized } from '@/lib/data/tx';
import { sameResponse } from './harness';
import { Client, makeCode, makeGroup, person, post, setupHarness, type Harness, type Person } from '../groups/harness';

const G = INVITE_RATE_LIMITS.redeemGlobal;

let h: Harness;
let a: Person;
let gid: string;
let seq = 0;
beforeEach(async () => {
  h = await setupHarness();
  a = await person(h, 'alice');
  gid = await makeGroup(a);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

const redeem = (p: Person, code: string) => post<{ groupId: string; alreadyMember: boolean }>(p.c, '/api/invites/redeem', { code });
const wrongCode = () => `ZZZZ-${String(seq++).padStart(4, '2').replace(/[01]/g, '2')}`;
const fresh = (prefix: string) => person(h, `${prefix}${seq++}`);

/** ตั้งค่าถังโดยตรง (จำลองว่ามีการใช้ผิดมาก่อนแล้วในหน้าต่างปัจจุบัน) */
async function setBucket(key: string, windowMs: number, count: number): Promise<void> {
  const ws = windowStartOf(h.clock.now(), windowMs);
  await h.rows('INSERT INTO rate_limit_bucket (key, window_start, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count', [key, ws, count]);
}
const bucket = async (key: string): Promise<number> => Number((await h.rows<{ count: number }>('SELECT count FROM rate_limit_bucket WHERE key = ?', [key]))[0]?.count ?? 0);
const bucketsLike = (pattern: string) => h.rows<{ key: string; count: number }>('SELECT key, count FROM rate_limit_bucket WHERE key LIKE ? ORDER BY key', [pattern]);

/** ปิดคิว serialized ของ db ที่ route ใช้จริง จนกว่าจะเรียก release() */
function blockQueue(): { release: () => void; entered: Promise<void> } {
  let release!: () => void;
  let markEntered!: () => void;
  const entered = new Promise<void>((r) => (markEntered = r));
  const gate = new Promise<void>((r) => (release = r));
  void serialized(getDb(), async () => {
    markEntered();
    await gate;
  });
  return { release, entered };
}

/** settle ภายใน ms หรือไม่ (ไม่ใช้ fake timer — นาฬิกาของ harness เป็นของแอป ไม่ใช่ setTimeout) */
async function settlesWithin<T>(p: Promise<T>, ms: number): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ settled: false }>((r) => (timer = setTimeout(() => r({ settled: false }), ms)));
  try {
    return await Promise.race([p.then((value) => ({ settled: true as const, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe('H2 — pre-check ก่อนเข้าคิว serialized', () => {
  it('ผู้ใช้ที่ติดลิมิตอยู่แล้ว → 429 ทันทีขณะคิวถูกยึด (ไม่รอคิว) · ไม่เขียนถังใด ๆ', async () => {
    const b = await fresh('lim');
    for (let i = 0; i < INVITE_RATE_LIMITS.redeemUser.limit; i++) expect((await redeem(b, wrongCode())).code).toBe('INVITE_INVALID');
    const before = await bucketsLike('redeem:%');

    const q = blockQueue();
    await q.entered;
    try {
      const r = await settlesWithin(redeem(b, wrongCode()), 2_000);
      expect(r.settled).toBe(true);
      if (r.settled) {
        expect([r.value.status, r.value.code]).toEqual([429, 'RATE_LIMITED']);
        expect(Number(r.value.headers.get('retry-after'))).toBeGreaterThan(0);
      }
      expect(await bucketsLike('redeem:%')).toEqual(before); // pre-check อ่านอย่างเดียว
    } finally {
      q.release();
    }
  });

  it('IP ที่ติดลิมิตอยู่แล้ว (ผู้ใช้คนใหม่) → 429 ทันทีขณะคิวถูกยึด', async () => {
    const ip = '203.0.113.50';
    const users = await Promise.all([1, 2, 3].map(() => fresh('ipu')));
    for (const u of users) {
      for (let i = 0; i < 10; i++) await post(u.c, '/api/invites/redeem', { code: wrongCode() }, { headers: { 'x-real-ip': ip } });
    }
    const late = await fresh('late');
    const q = blockQueue();
    await q.entered;
    try {
      const r = await settlesWithin(post(late.c, '/api/invites/redeem', { code: wrongCode() }, { headers: { 'x-real-ip': ip } }), 2_000);
      expect(r.settled).toBe(true);
      if (r.settled) expect([r.value.status, r.value.code]).toEqual([429, 'RATE_LIMITED']);
      expect(await bucket(`redeem:u:${late.id}`)).toBe(0); // ไม่ได้จองถังผู้ใช้
    } finally {
      q.release();
    }
  });

  it('ถังรวมทั้งระบบเต็มอยู่แล้ว + ผู้เรียกเคยผิดในหน้าต่างนี้ → 429 ทันทีขณะคิวถูกยึด', async () => {
    const b = await fresh('glob');
    expect((await redeem(b, wrongCode())).code).toBe('INVITE_INVALID');
    await setBucket(REDEEM_GLOBAL_KEY, G.windowMs, G.limit);
    const q = blockQueue();
    await q.entered;
    try {
      const r = await settlesWithin(redeem(b, wrongCode()), 2_000);
      expect(r.settled).toBe(true);
      if (r.settled) expect([r.value.status, r.value.code]).toEqual([429, 'RATE_LIMITED']);
    } finally {
      q.release();
    }
  });

  it('ตัวควบคุม: ผู้ที่ยังไม่ติดลิมิต ยังต่อคิวตามเดิม (รอจนคิวว่าง แล้วได้ผลตามจริง)', async () => {
    const b = await fresh('ok');
    const code = await makeCode(a, gid);
    const q = blockQueue();
    await q.entered;
    const pending = redeem(b, code);
    expect((await settlesWithin(pending, 300)).settled).toBe(false); // ยังรอคิว
    q.release();
    const r = await pending;
    expect(r.status).toBe(200);
  });

  it('พฤติกรรมการจองเดิมไม่เปลี่ยน: ผู้ใช้เดียวเดาผิดพร้อมกัน 25 ครั้ง → ตรวจโค้ดได้ 10 ที่เหลือ 429 · ถังผู้ใช้ = 10 ไม่เกิน', async () => {
    const b = await fresh('race');
    const rs = await Promise.all(Array.from({ length: 25 }, () => redeem(b, wrongCode())));
    expect(rs.filter((r) => r.code === 'INVITE_INVALID')).toHaveLength(10);
    expect(rs.filter((r) => r.code === 'RATE_LIMITED')).toHaveLength(15);
    expect(await bucket(`redeem:u:${b.id}`)).toBe(10);
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(10); // ผู้ที่ถูกปฏิเสธจากถังของตัวเองไม่กินช่องรวม
  });
});

describe('H3 — ลิมิตการใช้โค้ดผิดรวมทั้งระบบ', () => {
  it('ค่าเพดาน: 300 ครั้ง / 15 นาที · คีย์ไม่มีข้อมูลผู้ใช้', () => {
    expect(G).toEqual({ prefix: 'redeem:all', limit: 300, windowMs: 15 * 60_000 });
    expect(REDEEM_GLOBAL_KEY).toBe('redeem:all:global');
  });

  it('ผู้ใช้ปกติไม่โดน: ใช้ผิดไม่กี่ครั้งแล้วใช้ถูก → 200 · สำเร็จคืนช่องรวม (นับเฉพาะที่ผิด)', async () => {
    const b = await fresh('norm');
    for (let i = 0; i < 3; i++) expect((await redeem(b, wrongCode())).code).toBe('INVITE_INVALID');
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(3);
    const r = await redeem(b, await makeCode(a, gid));
    expect(r.status).toBe(200);
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(3); // ครั้งที่สำเร็จไม่ค้างในถังรวม
    // สมาชิกเดิมใช้ซ้ำ (alreadyMember) ก็ไม่ค้าง
    expect((await redeem(b, await makeCode(a, gid))).data.alreadyMember).toBe(true);
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(3);
  });

  it('เกินเพดานรวม + ผู้เรียกเคยผิด → 429 ข้อความเดิม (เหมือนลิมิตต่อผู้ใช้ทุกไบต์) ทั้งโค้ดถูกและผิด · คืนช่องผู้ใช้/IP ของครั้งนี้ · ครบหน้าต่างใช้ได้อีก', async () => {
    const code = await makeCode(a, gid);
    // อ้างอิง: 429 จากลิมิตต่อผู้ใช้ (ข้อความเดิมที่มีอยู่แล้ว)
    const ref = await fresh('ref');
    for (let i = 0; i < 10; i++) await redeem(ref, wrongCode());
    const perUser429 = await redeem(ref, wrongCode());
    expect(perUser429.status).toBe(429);

    const b = await fresh('blocked');
    expect((await redeem(b, wrongCode())).code).toBe('INVITE_INVALID'); // b ไม่สะอาดแล้ว
    await setBucket(REDEEM_GLOBAL_KEY, G.windowMs, G.limit - 1);
    const last = await fresh('last');
    expect((await redeem(last, wrongCode())).code).toBe('INVITE_INVALID'); // ช่องสุดท้าย
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(G.limit);

    const ipBefore = await bucketsLike('redeem:ip:%');
    const right = await redeem(b, code);
    const wrong = await redeem(b, wrongCode());
    expect([right.status, right.code]).toEqual([429, 'RATE_LIMITED']);
    sameResponse(right, wrong); // โค้ดถูก/ผิดตอบเหมือนกัน (ไม่เป็น oracle)
    sameResponse(right, perUser429); // ข้อความ/รูปแบบเดิมของ RATE_LIMITED
    expect(await bucket(`redeem:u:${b.id}`)).toBe(1); // เหลือแค่ครั้งที่ผิดก่อนหน้า
    expect(await bucketsLike('redeem:ip:%')).toEqual(ipBefore); // ไม่เพิ่ม
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [gid, b.id])).toBe(0);

    h.clock.advance(G.windowMs);
    expect((await redeem(b, code)).status).toBe(200);
  });

  it('Low 1 (การโจมตี): 30 บัญชี × 10 IP เดาผิดจนถังรวมเต็ม → ผู้ใช้จริงที่ถือโค้ดถูกยังเข้ากลุ่มได้ · การเดาผิดต่อยัง 429', async () => {
    const code = await makeCode(a, gid);
    // ผู้โจมตี: 10 IP × 3 บัญชี × 10 ครั้ง = 300 (พอดีเพดานต่อผู้ใช้ 10 / ต่อ IP 30 / รวม 300)
    const attackers: Person[] = [];
    for (let ip = 0; ip < 10; ip++) {
      for (let k = 0; k < 3; k++) {
        const u = await fresh('atk');
        u.c.ip = `198.51.100.${ip + 1}`;
        attackers.push(u);
      }
    }
    for (const u of attackers) {
      for (let i = 0; i < INVITE_RATE_LIMITS.redeemUser.limit; i++) expect((await redeem(u, wrongCode())).code).toBe('INVITE_INVALID');
    }
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(G.limit);

    // ผู้ใช้จริง (บัญชีใหม่ IP ของตัวเอง) ใช้โค้ดถูก → 200 · ไม่กินถังรวม · ถังของตัวเองคืนครบ
    const legit = await fresh('legit');
    const ok = await redeem(legit, code);
    expect(ok.status).toBe(200);
    expect(ok.data.groupId).toBe(gid);
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(G.limit);
    expect(await bucket(`redeem:u:${legit.id}`)).toBe(0);
    // คนถัดไปก็ยังใช้โค้ดถูกได้ (ทั้งระบบยังใช้ได้ ไม่ใช่แค่คนแรก)
    const legit2 = await fresh('legit');
    expect((await redeem(legit2, await makeCode(a, gid))).status).toBe(200);

    // ผู้โจมตี: บัญชีใหม่บน IP ใหม่ได้เดาอย่างมาก 1 ครั้ง แล้ว 429 — ทั้งโค้ดถูกและผิดตอบเหมือนกัน
    const fresh1 = await fresh('atk2');
    fresh1.c.ip = '198.51.100.200';
    expect((await redeem(fresh1, wrongCode())).code).toBe('INVITE_INVALID');
    const w = await redeem(fresh1, wrongCode());
    const r = await redeem(fresh1, code);
    expect([w.status, w.code]).toEqual([429, 'RATE_LIMITED']);
    sameResponse(w, r);
    expect(await h.count('group_member WHERE group_id = ? AND user_id = ?', [gid, fresh1.id])).toBe(0);
    // บัญชีใหม่บน IP เดิมที่เคยผิด → 429 (IP ไม่สะอาด) · บัญชีเดิมย้าย IP ใหม่ → 429 (บัญชีไม่สะอาด)
    const sameIp = await fresh('atk3');
    sameIp.c.ip = '198.51.100.200';
    expect((await redeem(sameIp, wrongCode())).code).toBe('RATE_LIMITED');
    fresh1.c.ip = '198.51.100.201';
    expect((await redeem(fresh1, wrongCode())).code).toBe('RATE_LIMITED');
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(G.limit); // ไม่เกินเพดาน
  }, 60_000); // 30 ล็อกอิน + 300 คำขอจริง

  it('Low 1: ผู้ที่สะอาดส่งเดาพร้อมกัน 5 ครั้งขณะถังรวมเต็ม → ตรวจโค้ดได้ 1 ครั้ง ที่เหลือ 429', async () => {
    await setBucket(REDEEM_GLOBAL_KEY, G.windowMs, G.limit);
    const b = await fresh('par');
    const rs = await Promise.all(Array.from({ length: 5 }, () => redeem(b, wrongCode())));
    expect(rs.filter((r) => r.code === 'INVITE_INVALID')).toHaveLength(1);
    expect(rs.filter((r) => r.code === 'RATE_LIMITED')).toHaveLength(4);
    expect(await bucket(`redeem:u:${b.id}`)).toBe(1);
  });

  it('หลายบัญชีหลาย IP เดาพร้อมกันที่ช่องสุดท้าย 5 ช่อง → ถังรวมไม่เกินเพดาน · คู่ (IP, บัญชี) ใหม่ได้คนละ 1 ครั้งเท่านั้น · รอบสองโดน 429 ทั้งหมด', async () => {
    await setBucket(REDEEM_GLOBAL_KEY, G.windowMs, G.limit - 5);
    const users = await Promise.all(Array.from({ length: 20 }, () => fresh('dist')));
    const rs = await Promise.all(users.map((u) => redeem(u, wrongCode())));
    expect(rs.filter((r) => r.code === 'INVITE_INVALID')).toHaveLength(20); // 5 ใช้ช่องรวม + 15 สะอาด
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(G.limit);
    const again = await Promise.all(users.map((u) => redeem(u, wrongCode())));
    expect(again.filter((r) => r.code === 'RATE_LIMITED')).toHaveLength(20);
    const userCounts = (await bucketsLike('redeem:u:%')).map((x) => x.count);
    expect(userCounts.reduce((s, n) => s + n, 0)).toBe(20);
    const ipCounts = (await bucketsLike('redeem:ip:%')).map((x) => x.count);
    expect(ipCounts.reduce((s, n) => s + n, 0)).toBe(20);
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(G.limit);
  });

  it('ถูกปฏิเสธด้วยถังเข้า/ออกกลุ่ม (หลังจองถัง redeem แล้ว) → คืนช่องรวมด้วย ไม่นับเป็นการเดาผิด', async () => {
    await setBucket(REDEEM_GLOBAL_KEY, G.windowMs, 7);
    const b = await fresh('memb');
    await setBucket(`${GROUP_MEMBERSHIP_RATE_LIMIT.prefix}:${b.id}`, GROUP_MEMBERSHIP_RATE_LIMIT.windowMs, GROUP_MEMBERSHIP_RATE_LIMIT.limit);
    const r = await redeem(b, await makeCode(a, gid));
    expect([r.status, r.code]).toEqual([429, 'RATE_LIMITED']);
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(7);
    expect(await bucket(`redeem:u:${b.id}`)).toBe(0);
  });

  it('ไม่มีข้อยกเว้นตามบทบาท: super admin/admin กลุ่มที่เคยผิดก็ถูกจำกัดเมื่อถังรวมเต็ม (ผู้สะอาดผ่านทุกบทบาท) · ไม่ได้ล็อกอิน → 401 ไม่แตะถัง', async () => {
    const sa = await person(h, `root${seq++}`, { admin: true });
    expect((await redeem(sa, wrongCode())).code).toBe('INVITE_INVALID');
    expect((await redeem(a, wrongCode())).code).toBe('INVITE_INVALID');
    await setBucket(REDEEM_GLOBAL_KEY, G.windowMs, G.limit);
    expect((await redeem(sa, await makeCode(a, gid))).code).toBe('RATE_LIMITED');
    // admin ของกลุ่มใช้โค้ดของกลุ่มตัวเองก็ถูกจำกัดเหมือนกัน (ไม่รู้ว่าโค้ดเป็นของใครจนกว่าจะตรวจ)
    expect((await redeem(a, await makeCode(a, gid))).code).toBe('RATE_LIMITED');
    const sa2 = await person(h, `root${seq++}`, { admin: true });
    expect((await redeem(sa2, await makeCode(a, gid))).status).toBe(200); // super admin ที่สะอาด = เหมือนผู้ใช้สะอาดทั่วไป
    const anon = new Client();
    const r = await anon.call('POST', '/api/invites/redeem', { code: 'AAAA-BBBB' });
    expect(r.status).toBe(401);
    expect(await bucket(REDEEM_GLOBAL_KEY)).toBe(G.limit);
  });

  it('ไม่มีโค้ดใน log หรือในถัง rate limit (ทั้งตอนผิด ตอนติดลิมิตรวม และตอนสำเร็จ)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const code = await makeCode(a, gid);
    const guess = wrongCode();
    const b = await fresh('nolog');
    await redeem(b, guess);
    await setBucket(REDEEM_GLOBAL_KEY, G.windowMs, G.limit);
    await redeem(b, code);
    h.clock.advance(G.windowMs);
    expect((await redeem(b, code)).status).toBe(200);
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c))).join('\n');
    const bare = (s: string) => s.replace(/-/g, '');
    for (const c of [code, guess]) {
      expect(logged).not.toContain(c);
      expect(logged).not.toContain(bare(c));
    }
    const keys = JSON.stringify(await bucketsLike('%'));
    for (const c of [code, guess]) {
      expect(keys).not.toContain(c);
      expect(keys).not.toContain(bare(c));
    }
  });
});
