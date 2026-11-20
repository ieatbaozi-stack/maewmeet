// R18 H1 (security-r16 Info 1) — api:read เกินโควตา → 429 *ก่อน* handler อ่านฐาน
//  - เดิม (R16 H3) จองช่องขนานกับ handler แล้วทิ้งผล → handler ยังอ่านฐาน + เขียน audit การอ่านของ super admin ทั้งที่ได้ 429
//  - ตอนนี้: จองช่องเสร็จก่อน · เต็ม → 429 RATE_LIMITED + Retry-After โดยไม่มี query ของ handler และไม่มี audit การอ่าน
//  ตรวจ "ไม่มี query" ด้วยการดัก SQL ที่ client ของแอปส่งระหว่างคำขอ — อนุญาตเฉพาะตารางของด่านก่อน handler (session/user/rate_limit_bucket/pepper)
import type { Client as LibsqlClient, InStatement, Transaction } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { rateKey, type RateSpec } from '@/lib/auth/throttle';
import { resetReadBlockMemoForTests } from '@/lib/data/read-limit';
import { windowStartOf } from '@/lib/data/repos/rate-limit-bucket';
import { API_READ_RATE_LIMIT } from '@/lib/shared/limits';
import { get, join, makeGroup, person, setupHarness, type Harness, type Person } from '../groups/harness';

const NOW = Date.UTC(2026, 10, 20, 3); // 2026-11-20 10:00 BKK

let h: Harness;
afterEach(async () => {
  resetReadBlockMemoForTests();
  await h?.cleanup();
});

async function seedBucket(spec: RateSpec, userId: string, n: number): Promise<void> {
  await h.rows('INSERT INTO rate_limit_bucket (key, window_start, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count', [
    rateKey(spec, userId),
    windowStartOf(h.clock.now(), spec.windowMs),
    n,
  ]);
}

/** ดัก SQL ทุกคำสั่งที่ client ของแอป (getDb) ส่งระหว่าง fn — execute / batch / ในธุรกรรม */
async function captureSql<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  const client = getDb().$client as LibsqlClient;
  const seen: string[] = [];
  const text = (s: InStatement): string => (typeof s === 'string' ? s : s.sql);
  const origExecute = client.execute.bind(client);
  const origBatch = client.batch.bind(client);
  const origTx = client.transaction.bind(client);
  const c = client as unknown as Record<string, unknown>;
  c.execute = (s: InStatement, ...rest: unknown[]) => {
    seen.push(text(s));
    return (origExecute as (...a: unknown[]) => unknown)(s, ...rest);
  };
  c.batch = (stmts: InStatement[], ...rest: unknown[]) => {
    for (const s of stmts) seen.push(text(s));
    return (origBatch as (...a: unknown[]) => unknown)(stmts, ...rest);
  };
  c.transaction = async (...args: unknown[]) => {
    const tx = (await (origTx as (...a: unknown[]) => Promise<Transaction>)(...args)) as Transaction;
    const txExecute = tx.execute.bind(tx);
    (tx as unknown as Record<string, unknown>).execute = (s: InStatement) => {
      seen.push(text(s));
      return txExecute(s);
    };
    return tx;
  };
  try {
    return { result: await fn(), sql: seen };
  } finally {
    c.execute = origExecute;
    c.batch = origBatch;
    c.transaction = origTx;
  }
}

/** ตารางที่ด่านก่อน handler แตะได้: resolveActor (session/user + pepper) และถัง rate limit */
const PRE_HANDLER_TABLES = new Set(['session', 'user', 'rate_limit_bucket', 'pepper_fingerprint']);
/** ชื่อตารางหลัง FROM/INTO/UPDATE/JOIN (ข้าม `DO UPDATE SET` ของ UPSERT) */
function tablesOf(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/\b(?:from|into|update|join)\s+(?!set\b)["`]?([a-z_]+)["`]?/gi)) out.push(m[1]!.toLowerCase());
  return out;
}

describe('R18 H1 api:read เกินโควตา → 429 ก่อนอ่านฐาน', () => {
  let a: Person;
  let boss: Person;
  let gid: string;
  const setup = async () => {
    h = await setupHarness({ startAt: NOW });
    a = await person(h, 'alice');
    boss = await person(h, 'boss', { admin: true }); // super admin ที่ไม่ใช่สมาชิก — GET ของ SA เขียน audit การอ่าน
    const m = await person(h, 'mew');
    gid = await makeGroup(a, 'ก๊วนลับ');
    await join(a, m, gid);
  };

  it('ควบคุม: ช่องยังว่าง → SA อ่านกลุ่มได้ 200 และมี audit group.view (handler รันจริง)', async () => {
    await setup();
    expect((await get(boss.c, `/api/groups/${gid}`)).status).toBe(200);
    expect(await h.count("audit_log WHERE action = 'group.view' AND actor_id = ?", [boss.id])).toBe(1);
  });

  it('ถังเต็ม (ไม่มีทางลัดในหน่วยความจำ) → 429 + Retry-After · ไม่มี query ของ handler · ไม่มี audit การอ่านของ SA · ถังไม่โตเกิน limit', async () => {
    await setup();
    await seedBucket(API_READ_RATE_LIMIT, boss.id, API_READ_RATE_LIMIT.limit);
    const auditBefore = await h.count('audit_log');
    const routes = [
      `/api/groups/${gid}`,
      `/api/groups/${gid}/invites`,
      `/api/groups/${gid}/calendar?from=2026-11-01&to=2026-11-30`,
      `/api/groups/${gid}/availability?from=2026-11-24&to=2026-11-24`,
      `/api/groups/${gid}/appointments`,
      '/api/groups',
      '/api/me/notifications',
    ];
    for (const p of routes) {
      resetReadBlockMemoForTests(); // บังคับเส้นทาง "ถาม DB แล้วถูกปฏิเสธ" ทุกครั้ง (ไม่ใช่ทางลัด)
      const { result: r, sql } = await captureSql(() => get(boss.c, p));
      expect([r.status, r.code], p).toEqual([429, 'RATE_LIMITED']);
      expect(r.text, p).toBe('{"error":{"code":"RATE_LIMITED"}}');
      expect(Number(r.headers.get('retry-after')), p).toBeGreaterThan(0);
      const touched = sql.flatMap(tablesOf);
      expect(touched.length, `${p}: ต้องถามถังอย่างน้อย 1 ครั้ง`).toBeGreaterThan(0);
      expect(touched.includes('rate_limit_bucket'), p).toBe(true);
      const beyond = touched.filter((t) => !PRE_HANDLER_TABLES.has(t));
      expect(beyond, `${p}: query ของ handler หลุดมา: ${sql.join(' | ')}`).toEqual([]);
    }
    // เผื่อ handler ที่ (ถ้าเคย) วิ่งขนานเขียน audit หลังคำตอบ → รอ event loop ให้ค้างทั้งหมดจบก่อนนับ
    await new Promise((r) => setTimeout(r, 50));
    expect(await h.count('audit_log')).toBe(auditBefore);
    expect(await h.count("audit_log WHERE actor_id = ? AND action IN ('group.view', 'invite.list', 'group.calendar.view')", [boss.id])).toBe(0);
    const bucket = await h.rows<{ count: number }>('SELECT count FROM rate_limit_bucket WHERE key = ?', [rateKey(API_READ_RATE_LIMIT, boss.id)]);
    expect(Number(bucket[0]?.count)).toBe(API_READ_RATE_LIMIT.limit);
  });

  it('ช่องสุดท้าย → 200 (handler รัน) · คำขอถัดไป → 429 ไม่รัน handler', async () => {
    await setup();
    await seedBucket(API_READ_RATE_LIMIT, boss.id, API_READ_RATE_LIMIT.limit - 1);
    expect((await get(boss.c, `/api/groups/${gid}`)).status).toBe(200);
    expect(await h.count("audit_log WHERE action = 'group.view' AND actor_id = ?", [boss.id])).toBe(1);
    resetReadBlockMemoForTests();
    const { result: r, sql } = await captureSql(() => get(boss.c, `/api/groups/${gid}`));
    expect(r.status).toBe(429);
    expect(sql.flatMap(tablesOf).filter((t) => !PRE_HANDLER_TABLES.has(t))).toEqual([]);
    await new Promise((res) => setTimeout(res, 50));
    expect(await h.count("audit_log WHERE action = 'group.view' AND actor_id = ?", [boss.id])).toBe(1);
  });

  it('ทางลัดในหน่วยความจำ (เพิ่งถูกปฏิเสธ) → 429 โดยไม่แตะถังและไม่มี query ของ handler', async () => {
    await setup();
    await seedBucket(API_READ_RATE_LIMIT, boss.id, API_READ_RATE_LIMIT.limit);
    expect((await get(boss.c, '/api/groups')).status).toBe(429); // จำไว้ใน process
    const { result: r, sql } = await captureSql(() => get(boss.c, `/api/groups/${gid}`));
    expect(r.status).toBe(429);
    const touched = sql.flatMap(tablesOf);
    expect(touched.includes('rate_limit_bucket')).toBe(false);
    expect(touched.filter((t) => !PRE_HANDLER_TABLES.has(t))).toEqual([]);
  });

  it('พร้อมกัน 5 คำขอเมื่อเหลือ 2 ช่อง → 200 สองครั้ง 429 สามครั้ง · audit group.view = 2 (ไม่บันทึกเกินจริง)', async () => {
    await setup();
    await seedBucket(API_READ_RATE_LIMIT, boss.id, API_READ_RATE_LIMIT.limit - 2);
    const res = await Promise.all(Array.from({ length: 5 }, () => get(boss.c, `/api/groups/${gid}`)));
    expect(res.filter((r) => r.status === 200)).toHaveLength(2);
    expect(res.filter((r) => r.status === 429)).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 50));
    expect(await h.count("audit_log WHERE action = 'group.view' AND actor_id = ?", [boss.id])).toBe(2);
  });
});
